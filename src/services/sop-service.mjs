import { randomUUID } from 'node:crypto';
import { escapeHtml, HttpError } from '../lib/http.mjs';

function createBaseDocument({ title, interviewSummary = null, processModel = null, references = [] } = {}) {
  const summary = interviewSummary ?? {};
  return {
    title: title || summary.title || 'Untitled SOP',
    sections: [
      { id: 'purpose', title: 'Purpose', text: summary.purpose || '[CONFIRM] Add SOP purpose.' },
      { id: 'scope', title: 'Scope', text: summary.scope || '[CONFIRM] Add SOP scope.' },
      {
        id: 'responsibilities',
        title: 'Responsibilities',
        text: Array.isArray(summary.roles) && summary.roles.length
          ? summary.roles.join(', ')
          : '[CONFIRM] Add roles and responsibilities.',
      },
      {
        id: 'procedure',
        title: 'Procedure',
        text: summary.procedureDraft || '[CONFIRM] Add procedural steps.',
      },
      {
        id: 'records',
        title: 'Records',
        text: '[CONFIRM] Add required records and retention details.',
      },
      {
        id: 'exceptions',
        title: 'Exceptions',
        text: '[CONFIRM] Add exceptions and escalation rules.',
      },
    ],
    processModel: processModel ?? { steps: [] },
    references: Array.isArray(references) ? references : [],
    trainingTaskIds: [],
  };
}

function buildChangeSummary(previousDocument, nextDocument) {
  const previousSections = Array.isArray(previousDocument?.sections) ? previousDocument.sections : [];
  const nextSections = Array.isArray(nextDocument?.sections) ? nextDocument.sections : [];

  const changed = [];
  const nextById = new Map(nextSections.map((section) => [section.id || section.title, section]));

  for (const section of previousSections) {
    const key = section.id || section.title;
    const counterpart = nextById.get(key);
    if (!counterpart) {
      changed.push(`Removed section: ${key}`);
      continue;
    }
    if (String(counterpart.text || '') !== String(section.text || '')) {
      changed.push(`Updated section: ${key}`);
    }
  }

  for (const section of nextSections) {
    const key = section.id || section.title;
    const existsBefore = previousSections.some((item) => (item.id || item.title) === key);
    if (!existsBefore) {
      changed.push(`Added section: ${key}`);
    }
  }

  return changed.length ? changed : ['No section-level changes detected.'];
}

function renderTemplate(template, params = {}) {
  let output = String(template || '');
  for (const [key, value] of Object.entries(params)) {
    const token = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    output = output.replace(token, String(value));
  }
  return output;
}

function normalizeSectionPath(pathValue) {
  return String(pathValue || '').trim();
}

export class SopService {
  constructor({
    documentStore,
    auditStore,
    validationService,
    workflowService,
    llmService,
    resolveUsers = async () => [],
    resolveTrainingPolicy = async () => ({
      dueDays: 30,
      quizPassScore: 80,
      requiresTrainerSignoff: true,
      retrainingOnMajorRevision: true,
    }),
    resolveSopCode = async () => null,
  }) {
    this.documentStore = documentStore;
    this.auditStore = auditStore;
    this.validationService = validationService;
    this.workflowService = workflowService;
    this.llmService = llmService;
    this.resolveUsers = resolveUsers;
    this.resolveTrainingPolicy = resolveTrainingPolicy;
    this.resolveSopCode = resolveSopCode;
  }

  async initialize() {
    await this.documentStore.ensureWorkspace();
    await this.auditStore.initialize();
    await this.validationService.initialize();
  }

  async listSops() {
    return this.documentStore.listSops();
  }

  async createSop({ actor, payload = {} }) {
    const sopId = payload.id || `sop-${randomUUID().slice(0, 8)}`;
    const interviewSummary = payload.interviewSummary ?? null;
    const document = payload.document ?? createBaseDocument({
      title: payload.title,
      interviewSummary,
      processModel: payload.processModel,
      references: payload.references,
    });

    const generatedCode = payload.code
      ? null
      : await this.resolveSopCode({
        actor,
        payload,
      });

    const meta = {
      id: sopId,
      title: payload.title || document.title || 'Untitled SOP',
      code: payload.code || generatedCode || `SOP-${Date.now()}`,
      ownerId: actor.id,
      ownerRole: actor.role,
      status: 'Draft',
      area: payload.area || 'General',
      targetRoles: Array.isArray(payload.targetRoles) ? payload.targetRoles : [],
      nextReviewDate: payload.nextReviewDate || null,
    };

    const created = await this.documentStore.createSop({
      sopId,
      meta,
      initialDocument: document,
      actorId: actor.id,
      changeSummary: 'Initial draft created.',
    });

    await this.auditStore.append({
      actorId: actor.id,
      action: 'sop.create',
      entityType: 'sop',
      entityId: sopId,
      payload: {
        title: meta.title,
        versionId: created.version.versionId,
      },
    });

    return {
      meta: created.meta,
      version: created.version,
    };
  }

  async getSop(sopId) {
    const sop = await this.documentStore.getSop(sopId);
    if (!sop) {
      throw new HttpError(404, `SOP "${sopId}" not found.`);
    }
    return sop;
  }

  async listVersions(sopId) {
    await this.getSop(sopId);
    return this.documentStore.listVersions(sopId);
  }

  async createVersion({ sopId, actor, document, changeSummary = null }) {
    const sop = await this.getSop(sopId);
    const previousDocument = sop.latestVersion?.document ?? {};
    const computedSummary = buildChangeSummary(previousDocument, document);
    const summaryText = changeSummary || computedSummary.join('; ');

    const version = await this.documentStore.createVersion({
      sopId,
      document,
      actorId: actor.id,
      changeSummary: summaryText,
    });

    await this.auditStore.append({
      actorId: actor.id,
      action: 'sop.version.create',
      entityType: 'sop',
      entityId: sopId,
      payload: {
        versionId: version.versionId,
        changeSummary: summaryText,
      },
    });

    return version;
  }

  async validateSop({ sopId, document = null }) {
    const sop = await this.getSop(sopId);
    const targetDocument = document ?? sop.latestVersion?.document;
    const status = sop.meta.status;
    const result = this.validationService.validate(targetDocument, {
      status,
      trainingTaskIds: sop.meta.trainingTaskIds || [],
    });

    return {
      sopId,
      versionId: sop.meta.currentVersionId,
      ...result,
    };
  }

  async transitionSop({
    sopId,
    actor,
    toStatus,
    reason = '',
    eSignature = null,
  }) {
    const sop = await this.getSop(sopId);
    const validation = await this.validateSop({ sopId });
    const requiresESignature = toStatus === 'Approved';

    this.workflowService.ensureTransitionAllowed({
      fromStatus: sop.meta.status,
      toStatus,
      findings: validation.findings,
      reason,
      requiresESignature,
      reauthenticated: Boolean(eSignature?.reauthenticated),
    });

    const patch = {
      status: toStatus,
      workflowUpdatedAt: new Date().toISOString(),
    };

    if (requiresESignature) {
      patch.lastApproval = {
        actorId: actor.id,
        actorRole: actor.role,
        reason,
        approvedAt: new Date().toISOString(),
      };
    }

    const meta = await this.documentStore.updateSopMeta(sopId, patch);

    await this.auditStore.append({
      actorId: actor.id,
      action: 'sop.workflow.transition',
      entityType: 'sop',
      entityId: sopId,
      payload: {
        fromStatus: sop.meta.status,
        toStatus,
        reason,
      },
    });

    return {
      meta,
      validationSummary: validation.summary,
    };
  }

  async publishSop({ sopId, actor }) {
    const sop = await this.getSop(sopId);
    if (sop.meta.status !== 'Approved') {
      throw new HttpError(409, 'SOP must be in Approved status before publish.');
    }

    const [users, trainingPolicy] = await Promise.all([
      this.resolveUsers(),
      this.resolveTrainingPolicy(),
    ]);
    const targetRoles = Array.isArray(sop.meta.targetRoles) ? sop.meta.targetRoles : [];
    const recipients = users.filter((user) => {
      if (user.active === false) {
        return false;
      }
      if (!targetRoles.length) {
        return true;
      }
      const roles = Array.isArray(user.essentialRoles) && user.essentialRoles.length
        ? user.essentialRoles
        : [user.role];
      return targetRoles.some((role) => roles.includes(role));
    });

    const now = new Date().toISOString();
    const dueDays = Number(trainingPolicy?.dueDays) > 0 ? Number(trainingPolicy.dueDays) : 30;
    const dueAt = new Date(Date.now() + dueDays * 24 * 60 * 60 * 1000).toISOString();
    const quizPassScore = Number(trainingPolicy?.quizPassScore) >= 0
      ? Number(trainingPolicy.quizPassScore)
      : 80;
    const tasks = recipients.map((user) => ({
      id: `tt-${randomUUID().slice(0, 8)}`,
      sopId,
      versionId: sop.meta.currentVersionId,
      sopCode: sop.meta.code,
      sopTitle: sop.meta.title,
      userId: user.id,
      username: user.username,
      role: user.role,
      essentialRoles: Array.isArray(user.essentialRoles) ? user.essentialRoles : [user.role],
      assignmentType: 'read-and-understand',
      status: 'assigned',
      assignedAt: now,
      dueAt,
      readAcknowledgedAt: null,
      readAcknowledgedBy: null,
      quiz: {
        passScore: quizPassScore,
        attempts: 0,
        latestScore: null,
        passedAt: null,
        history: [],
      },
      trainerSignoffAt: null,
      trainerSignoffBy: null,
      gxpEvidence: {
        requiresTrainerSignoff: Boolean(trainingPolicy?.requiresTrainerSignoff),
        retrainingOnMajorRevision: Boolean(trainingPolicy?.retrainingOnMajorRevision),
      },
      createdAt: now,
      updatedAt: now,
    }));

    await this.documentStore.appendTrainingTasks(tasks);
    const quiz = await this.llmService.generateQuiz(sop.latestVersion?.document || {});

    const trainingTaskIds = tasks.map((task) => task.id);
    const meta = await this.documentStore.updateSopMeta(sopId, {
      status: 'Effective',
      effectiveAt: now,
      trainingTaskIds,
      quiz,
    });

    await this.auditStore.append({
      actorId: actor.id,
      action: 'sop.publish',
      entityType: 'sop',
      entityId: sopId,
      payload: {
        status: 'Effective',
        generatedTasks: trainingTaskIds.length,
      },
    });

    return {
      meta,
      trainingTasks: tasks,
      quiz,
    };
  }

  async listTrainingTasks({ sopId = null, userId = null } = {}) {
    return this.documentStore.queryTrainingTasks({ sopId, userId });
  }

  async listAuditEvents({ entityId = null, entityType = null, limit = 200 } = {}) {
    const events = await this.auditStore.readAll();
    const filtered = events.filter((event) => {
      if (entityId && event.entityId !== entityId) {
        return false;
      }
      if (entityType && event.entityType !== entityType) {
        return false;
      }
      return true;
    });

    return filtered.reverse().slice(0, Math.max(1, Number(limit || 200)));
  }

  async listBlocks() {
    return this.documentStore.listBlocks();
  }

  async createBlock({ actor, payload = {} }) {
    if (!payload.title || !String(payload.title).trim()) {
      throw new HttpError(400, 'Block title is required.');
    }
    if (!payload.contentTemplate || !String(payload.contentTemplate).trim()) {
      throw new HttpError(400, 'Block contentTemplate is required.');
    }

    const block = await this.documentStore.createBlock({
      blockId: payload.id,
      title: payload.title,
      contentTemplate: payload.contentTemplate,
      parameterSchema: payload.parameterSchema,
      mode: payload.mode,
      actorId: actor.id,
    });

    await this.auditStore.append({
      actorId: actor.id,
      action: 'block.create',
      entityType: 'block',
      entityId: block.id,
      payload: {
        title: block.title,
        mode: block.mode,
      },
    });

    return block;
  }

  async instantiateBlock({ sopId, actor, blockId, mode = null, parameters = {}, sectionId = null }) {
    const sop = await this.getSop(sopId);
    const block = await this.documentStore.getBlock(blockId);
    if (!block) {
      throw new HttpError(404, `Block "${blockId}" not found.`);
    }

    const document = structuredClone(sop.latestVersion?.document || createBaseDocument({}));
    const rendered = renderTemplate(block.contentTemplate, parameters || {});
    const finalMode = mode || block.mode || 'linked';
    const generatedSectionId = sectionId || `block-${blockId}-${Date.now()}`;

    const section = {
      id: generatedSectionId,
      title: block.title,
      text: rendered,
      source: {
        type: 'block',
        blockId: block.id,
        mode: finalMode === 'detached' ? 'detached' : 'linked',
        parameters: parameters || {},
      },
    };

    if (!Array.isArray(document.sections)) {
      document.sections = [];
    }
    document.sections.push(section);

    const version = await this.createVersion({
      sopId,
      actor,
      document,
      changeSummary: `Instantiated block ${block.id} as ${section.id}.`,
    });

    await this.auditStore.append({
      actorId: actor.id,
      action: 'block.instantiate',
      entityType: 'sop',
      entityId: sopId,
      payload: {
        blockId: block.id,
        mode: section.source.mode,
        sectionId: section.id,
      },
    });

    return {
      section,
      version,
    };
  }

  async listReviewComments(sopId) {
    await this.getSop(sopId);
    return this.documentStore.listReviewComments(sopId);
  }

  async addReviewComment({ sopId, actor, sectionPath, text }) {
    await this.getSop(sopId);
    const normalizedText = String(text || '').trim();
    if (!normalizedText) {
      throw new HttpError(400, 'Comment text is required.');
    }

    const comment = await this.documentStore.addReviewComment({
      sopId,
      sectionPath: normalizeSectionPath(sectionPath),
      text: normalizedText,
      actor,
    });

    await this.auditStore.append({
      actorId: actor.id,
      action: 'review.comment.add',
      entityType: 'sop',
      entityId: sopId,
      payload: {
        commentId: comment.id,
        sectionPath: comment.sectionPath,
      },
    });

    return comment;
  }

  async resolveReviewComment({ sopId, actor, commentId }) {
    await this.getSop(sopId);
    const comment = await this.documentStore.resolveReviewComment({ sopId, commentId, actor });
    if (!comment) {
      throw new HttpError(404, `Comment "${commentId}" not found.`);
    }

    await this.auditStore.append({
      actorId: actor.id,
      action: 'review.comment.resolve',
      entityType: 'sop',
      entityId: sopId,
      payload: {
        commentId,
      },
    });

    return comment;
  }

  async extractProcessModel(rawText) {
    return this.llmService.extractProcessModel(rawText);
  }

  async analyzeImpact(sopId) {
    const target = await this.getSop(sopId);
    const doc = target.latestVersion?.document || {};
    const references = Array.isArray(doc.references) ? doc.references : [];
    const sections = Array.isArray(doc.sections) ? doc.sections : [];
    const linkedBlocks = sections
      .filter((section) => section?.source?.type === 'block' && section?.source?.mode === 'linked')
      .map((section) => ({
        sectionId: section.id,
        blockId: section.source.blockId,
      }));

    const allSops = await this.listSops();
    const reverseReferences = [];

    for (const item of allSops) {
      if (item.id === sopId) {
        continue;
      }
      const candidate = await this.getSop(item.id);
      const candidateReferences = Array.isArray(candidate.latestVersion?.document?.references)
        ? candidate.latestVersion.document.references
        : [];
      const matched = candidateReferences.some((ref) => ref?.target === sopId || ref?.target === target.meta.code);
      if (matched) {
        reverseReferences.push({
          sopId: candidate.meta.id,
          title: candidate.meta.title,
          status: candidate.meta.status,
        });
      }
    }

    return {
      sopId,
      references: references.map((reference) => ({
        label: reference.label || '',
        target: reference.target || '',
        type: reference.type || '',
      })),
      linkedBlocks,
      reverseReferences,
    };
  }

  async exportSopHtml(sopId) {
    const sop = await this.getSop(sopId);
    const document = sop.latestVersion?.document ?? {};
    const sections = Array.isArray(document.sections) ? document.sections : [];
    const versions = await this.documentStore.listVersions(sopId);
    const recentChanges = versions.slice(-5).reverse();

    const rows = sections
      .map(
        (section) => `
          <section class="section">
            <h2>${escapeHtml(section.title || section.id || 'Section')}</h2>
            <p>${escapeHtml(section.text || '')}</p>
          </section>`,
      )
      .join('\n');

    const changeRows = recentChanges
      .map((version) => `<li>${escapeHtml(version.versionId)} - ${escapeHtml(version.changeSummary || '')}</li>`)
      .join('\n');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(sop.meta.title)} - Export</title>
  <style>
    body { font-family: "Times New Roman", serif; margin: 32px; color: #111; }
    h1, h2 { margin: 0 0 8px; }
    .meta { margin: 0 0 18px; font-size: 14px; color: #444; }
    .section { margin: 0 0 18px; page-break-inside: avoid; }
    .changes { margin-top: 24px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(sop.meta.title)}</h1>
  <div class="meta">
    <div>Code: ${escapeHtml(sop.meta.code || '-')}</div>
    <div>Status: ${escapeHtml(sop.meta.status || '-')}</div>
    <div>Version: ${escapeHtml(sop.meta.currentVersionId || '-')}</div>
    <div>Exported At: ${escapeHtml(new Date().toISOString())}</div>
  </div>
  ${rows}
  <section class="changes">
    <h2>Recent Change Summary</h2>
    <ul>${changeRows}</ul>
  </section>
</body>
</html>`;
  }

  async summarizeInterview(interviewPayload) {
    return this.llmService.summarizeInterview(interviewPayload);
  }

  async verifyAudit() {
    return this.auditStore.verify();
  }
}

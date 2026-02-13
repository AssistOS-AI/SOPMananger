import { randomUUID } from 'node:crypto';
import { HttpError } from '../lib/http.mjs';
import {
  buildChangeSummary,
  createBaseDocument,
  normalizeSectionPath,
  renderSopExportHtml,
} from './sop-document-utils.mjs';
import {
  analyzeSopImpact,
  createSopBlock,
  instantiateSopBlock,
} from './sop-block-impact-ops.mjs';

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
    let document = payload.document ?? createBaseDocument({
      title: payload.title,
      interviewSummary,
      processModel: payload.processModel,
      references: payload.references,
    });
    const goal = String(payload.goal || '').trim();
    const instructions = String(payload.authoringInstructions || '').trim();
    const templateGuidanceNote = String(payload.templateGuidanceNote || '').trim();
    if (goal || instructions || templateGuidanceNote) {
      document = {
        ...document,
        authorContext: {
          goal,
          instructions,
          templateGuidanceNote,
        },
      };
    }

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
    return createSopBlock(this, { actor, payload });
  }

  async instantiateBlock({ sopId, actor, blockId, mode = null, parameters = {}, sectionId = null }) {
    return instantiateSopBlock(this, {
      sopId,
      actor,
      blockId,
      mode,
      parameters,
      sectionId,
    });
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
    return analyzeSopImpact(this, sopId);
  }

  async exportSopHtml(sopId) {
    const sop = await this.getSop(sopId);
    const versions = await this.documentStore.listVersions(sopId);
    return renderSopExportHtml({
      sopMeta: sop.meta,
      document: sop.latestVersion?.document ?? {},
      versions,
    });
  }

  async summarizeInterview(interviewPayload) {
    return this.llmService.summarizeInterview(interviewPayload);
  }

  async verifyAudit() {
    return this.auditStore.verify();
  }
}

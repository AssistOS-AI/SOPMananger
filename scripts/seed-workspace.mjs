import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app.mjs';
import { BLOCK_DEFINITIONS, SOP_DEFINITIONS } from './seed-fixtures.mjs';

const args = new Set(process.argv.slice(2));
const reset = args.has('--reset');
const dataRoot = path.join(process.cwd(), 'data');
const workspacePath = path.join(dataRoot, 'workspaces', 'default');

async function main() {
  if (reset) {
    await fs.rm(workspacePath, { recursive: true, force: true });
  }

  const app = await createApp({
    dataRoot,
    quiet: true,
    llmEnabled: false,
  });
  const {
    sopService,
    authService,
    trainingService,
    automationService,
    templateService,
  } = app.services;

  const tryCredentials = async (username, candidates) => {
    for (const password of candidates) {
      const user = await authService.verifyCredentials(username, password);
      if (user) {
        return user;
      }
    }
    return null;
  };

  const admin = await tryCredentials('admin', ['', 'admin123']);
  const author = await tryCredentials('author', ['', 'author123']);
  const reviewer = await tryCredentials('reviewer', ['', 'reviewer123']);
  const approver = await tryCredentials('approver', ['', 'approver123']);

  if (!admin || !author || !reviewer || !approver) {
    throw new Error('Default users are not available.');
  }
  const actorById = new Map([
    [admin.id, admin],
    [author.id, author],
    [reviewer.id, reviewer],
    [approver.id, approver],
  ]);

  const ensureBlock = async (definition) => {
    const blocks = await sopService.listBlocks();
    const existing = blocks.find((block) => block.id === definition.id);
    if (existing) {
      return { block: existing, created: false };
    }
    const block = await sopService.createBlock({
      actor: admin,
      payload: definition,
    });
    return { block, created: true };
  };

  const ensureSop = async (definition) => {
    const list = await sopService.listSops();
    const existing = list.find((item) => item.code === definition.code);
    if (existing) {
      return { meta: existing, created: false };
    }

    const created = await sopService.createSop({
      actor: author,
      payload: {
        title: definition.title,
        code: definition.code,
        area: definition.area,
        targetRoles: definition.targetRoles,
        document: definition.document,
      },
    });
    return { meta: created.meta, created: true };
  };

  const ensureBlockSection = async ({ sopId, blockId, sectionId, parameters, mode = 'linked' }) => {
    const sop = await sopService.getSop(sopId);
    const sections = Array.isArray(sop.latestVersion?.document?.sections) ? sop.latestVersion.document.sections : [];
    const found = sections.some((section) => section?.source?.type === 'block' && section?.source?.blockId === blockId);
    if (found) {
      return false;
    }
    await sopService.instantiateBlock({
      sopId,
      actor: author,
      blockId,
      mode,
      sectionId,
      parameters,
    });
    return true;
  };

  const ensureInReview = async (sopId, reason) => {
    const sop = await sopService.getSop(sopId);
    if (sop.meta.status !== 'Draft') {
      return false;
    }
    await sopService.transitionSop({
      sopId,
      actor: author,
      toStatus: 'In Review',
      reason,
      eSignature: { reauthenticated: true },
    });
    return true;
  };

  const ensureApproved = async (sopId, reason) => {
    const sop = await sopService.getSop(sopId);
    if (sop.meta.status === 'Approved' || sop.meta.status === 'Effective') {
      return false;
    }
    if (sop.meta.status === 'Draft') {
      await ensureInReview(sopId, `${reason} - routed to review`);
    }
    const current = await sopService.getSop(sopId);
    if (current.meta.status !== 'In Review') {
      return false;
    }
    await sopService.transitionSop({
      sopId,
      actor: approver,
      toStatus: 'Approved',
      reason,
      eSignature: { reauthenticated: true },
    });
    return true;
  };

  const ensureEffective = async (sopId, reason) => {
    const sop = await sopService.getSop(sopId);
    if (sop.meta.status === 'Effective') {
      return false;
    }
    await ensureApproved(sopId, reason);
    const approved = await sopService.getSop(sopId);
    if (approved.meta.status !== 'Approved') {
      return false;
    }
    await sopService.publishSop({
      sopId,
      actor: approver,
    });
    return true;
  };

  const ensureComments = async (sopId) => {
    const comments = await sopService.listReviewComments(sopId);
    if (!comments.length) {
      const first = await sopService.addReviewComment({
        sopId,
        actor: reviewer,
        sectionPath: 'sections.3',
        text: 'Clarify acceptance criteria for cleaning pass/fail.',
      });
      await sopService.addReviewComment({
        sopId,
        actor: reviewer,
        sectionPath: 'sections.4',
        text: 'Retention period should include legal hold case.',
      });
      await sopService.resolveReviewComment({
        sopId,
        actor: approver,
        commentId: first.id,
      });
      return;
    }

    const hasOpen = comments.some((comment) => comment.status === 'open');
    if (!hasOpen) {
      await sopService.addReviewComment({
        sopId,
        actor: reviewer,
        sectionPath: 'sections.1',
        text: 'Please keep role naming aligned with organizational chart.',
      });
    }
  };

  const ensureTrainingProgress = async (sopId) => {
    const tasks = await trainingService.listTasks({ sopId });
    if (!tasks.length) {
      return await trainingService.getOverview({ sopId });
    }

    const first = tasks[0];
    const firstActor = actorById.get(first.userId) || admin;
    if (!first.readAcknowledgedAt) {
      await trainingService.markRead({
        taskId: first.id,
        actor: firstActor,
      });
    }
    const firstRefreshed = (await trainingService.listTasks({ sopId })).find((item) => item.id === first.id);
    if (firstRefreshed && !firstRefreshed.quiz?.passedAt) {
      await trainingService.submitQuiz({
        taskId: first.id,
        actor: firstActor,
        score: 93,
      });
    }
    const firstLatest = (await trainingService.listTasks({ sopId })).find((item) => item.id === first.id);
    if (firstLatest && !firstLatest.trainerSignoffAt) {
      await trainingService.signoff({
        taskId: first.id,
        actor: reviewer,
        note: 'Seeded completion evidence.',
      });
    }

    if (tasks[1] && !tasks[1].readAcknowledgedAt) {
      const secondActor = actorById.get(tasks[1].userId) || admin;
      await trainingService.markRead({
        taskId: tasks[1].id,
        actor: secondActor,
      });
    }

    return await trainingService.getOverview({ sopId });
  };

  const ensureAutomationJob = async () => {
    const jobs = await automationService.listJobs();
    if (jobs.some((job) => job.title === 'Nightly assurance sweep')) {
      return false;
    }
    await automationService.createJob({
      actor: admin,
      payload: {
        title: 'Nightly assurance sweep',
        type: 'assurance-scan',
        intervalMinutes: 1440,
        input: {
          highLevelSpec: 'Run full workspace assurance sweep for internal and regulatory alignment.',
          constraints: 'Report contradictions and unresolved critical control gaps.',
          narrative: 'Scheduled quality surveillance run.',
        },
      },
    });
    return true;
  };

  for (const definition of BLOCK_DEFINITIONS) {
    await ensureBlock(definition);
  }

  const sopResults = [];
  for (const definition of SOP_DEFINITIONS) {
    sopResults.push(await ensureSop(definition));
  }

  const sopByCode = {};
  for (const definition of SOP_DEFINITIONS) {
    const fresh = await sopService.listSops();
    const meta = fresh.find((item) => item.code === definition.code);
    if (!meta) {
      throw new Error(`Failed to locate seeded SOP ${definition.code}.`);
    }
    sopByCode[definition.code] = meta.id;
  }

  await ensureBlockSection({
    sopId: sopByCode['SOP-QA-001'],
    blockId: 'block-safety-ppe-gate',
    sectionId: 'safety-gate',
    parameters: { ppeItems: 'goggles, gloves, mask', area: 'receiving bay' },
  });

  await ensureBlockSection({
    sopId: sopByCode['SOP-OPS-010'],
    blockId: 'block-record-retention',
    sectionId: 'retention-rule',
    parameters: { storage: 'QMS archive', period: '5 years' },
  });

  await ensureBlockSection({
    sopId: sopByCode['SOP-QA-020'],
    blockId: 'block-deviation-trigger',
    sectionId: 'deviation-trigger',
    mode: 'detached',
    parameters: { threshold: 'major severity', channel: 'QA escalation board' },
  });

  await ensureInReview(sopByCode['SOP-OPS-010'], 'Routed for SME review');
  await ensureApproved(sopByCode['SOP-QA-030'], 'Ready for controlled release decision');
  await ensureEffective(sopByCode['SOP-QA-001'], 'Validated and approved for operational use');

  await ensureComments(sopByCode['SOP-OPS-010']);
  const trainingOverview = await ensureTrainingProgress(sopByCode['SOP-QA-001']);
  const automationCreated = await ensureAutomationJob();

  const impact = await sopService.analyzeImpact(sopByCode['SOP-QA-001']);
  const trainingForPrimary = await trainingService.listTasks({ sopId: sopByCode['SOP-QA-001'] });
  const auditVerification = await sopService.verifyAudit();

  const finalSops = await sopService.listSops();
  const statusBreakdown = finalSops.reduce((acc, sop) => {
    acc[sop.status] = (acc[sop.status] || 0) + 1;
    return acc;
  }, {});

  const summary = {
    workspacePath,
    resetApplied: reset,
    templates: {
      total: (await templateService.listTemplates()).length,
      customCreated: 0,
    },
    sops: {
      total: finalSops.length,
      created: sopResults.filter((item) => item.created).length,
      statusBreakdown,
      primarySopId: sopByCode['SOP-QA-001'],
    },
    review: {
      sopId: sopByCode['SOP-OPS-010'],
      comments: (await sopService.listReviewComments(sopByCode['SOP-OPS-010'])).length,
    },
    training: {
      primaryTasks: trainingForPrimary.length,
      completed: trainingOverview.summary.completed,
      inProgress: trainingOverview.summary.in_progress,
      overdue: trainingOverview.summary.overdue,
    },
    automation: {
      total: (await automationService.listJobs()).length,
      created: automationCreated,
    },
    impact: {
      primaryReverseReferences: impact.reverseReferences.length,
      primaryReusableLinks: impact.linkedBlocks.length,
    },
    audit: auditVerification,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

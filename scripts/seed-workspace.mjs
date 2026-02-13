import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app.mjs';

const args = new Set(process.argv.slice(2));
const reset = args.has('--reset');
const dataRoot = path.join(process.cwd(), 'data');
const workspacePath = path.join(dataRoot, 'workspaces', 'default');

function buildDocument({
  title,
  purpose,
  scope,
  responsibilities,
  procedure,
  records,
  exceptions,
  references = [],
  steps = [],
}) {
  return {
    title,
    sections: [
      { id: 'purpose', title: 'Purpose', text: purpose },
      { id: 'scope', title: 'Scope', text: scope },
      { id: 'responsibilities', title: 'Responsibilities', text: responsibilities },
      { id: 'procedure', title: 'Procedure', text: procedure },
      { id: 'records', title: 'Records', text: records },
      { id: 'exceptions', title: 'Exceptions', text: exceptions },
    ],
    processModel: {
      steps: steps.map((step, index) => ({
        order: index + 1,
        name: step.name,
        role: step.role,
        inputs: step.inputs || [],
        outputs: step.outputs || [],
        records: step.records || [],
        exceptions: step.exceptions || [],
      })),
    },
    references,
    trainingTaskIds: [],
  };
}

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

  const blocks = [
    {
      id: 'block-safety-ppe-gate',
      title: 'Safety PPE Gate',
      mode: 'linked',
      parameterSchema: ['ppeItems', 'area'],
      contentTemplate: 'Before execution in {{area}}, verify PPE: {{ppeItems}}.',
    },
    {
      id: 'block-record-retention',
      title: 'Record Retention Clause',
      mode: 'linked',
      parameterSchema: ['storage', 'period'],
      contentTemplate: 'Store generated records in {{storage}} for {{period}}.',
    },
    {
      id: 'block-deviation-trigger',
      title: 'Deviation Trigger Rule',
      mode: 'detached',
      parameterSchema: ['threshold', 'channel'],
      contentTemplate: 'If deviation exceeds {{threshold}}, escalate through {{channel}} immediately.',
    },
  ];

  for (const definition of blocks) {
    await ensureBlock(definition);
  }

  const sopDefinitions = [
    {
      code: 'SOP-QA-001',
      title: 'Raw Material Receiving and Inspection',
      area: 'Quality Assurance',
      targetRoles: ['author', 'reviewer', 'approver'],
      document: buildDocument({
        title: 'Raw Material Receiving and Inspection',
        purpose: 'Define controlled receiving and inspection steps for incoming raw materials.',
        scope: 'Applies to all incoming raw materials at site warehouse and quality hold area.',
        responsibilities: 'Warehouse Operator receives material; QA Inspector performs acceptance checks.',
        procedure: 'Receive shipment, verify supplier documents, inspect packaging integrity, sample as required, release or quarantine.',
        records: 'Receiving Log RM-01, Inspection Checklist RM-02, Quarantine Report RM-03.',
        exceptions: 'Damaged lots are quarantined and escalated to QA Lead and Procurement within 2 hours.',
        references: [
          { label: 'Receiving Form', type: 'form', target: 'FORM-RM-01' },
          { label: 'Vendor Qualification', type: 'sop', target: 'SOP-SCM-004' },
        ],
        steps: [
          { name: 'Receive shipment at controlled dock', role: 'warehouse_operator', inputs: ['delivery_note'], outputs: ['received_lot'], records: ['RM-01'] },
          { name: 'Verify supplier documentation', role: 'warehouse_operator', inputs: ['certificate_of_analysis'], outputs: ['doc_check_result'], records: ['RM-02'] },
          { name: 'Inspect packaging and labels', role: 'qa_inspector', inputs: ['received_lot'], outputs: ['inspection_outcome'], records: ['RM-02'] },
          { name: 'Release or quarantine lot', role: 'qa_inspector', inputs: ['inspection_outcome'], outputs: ['released_lot_or_quarantine'], records: ['RM-03'], exceptions: ['damaged_packaging'] },
        ],
      }),
    },
    {
      code: 'SOP-OPS-010',
      title: 'Equipment Cleaning and Line Release',
      area: 'Operations',
      targetRoles: ['author', 'reviewer'],
      document: buildDocument({
        title: 'Equipment Cleaning and Line Release',
        purpose: 'Ensure equipment cleaning and release before production startup.',
        scope: 'Applies to all granulation and compression lines.',
        responsibilities: 'Operator executes cleaning; Supervisor verifies completeness.',
        procedure: 'Stop line, isolate utilities, execute cleaning sequence, verify residues, complete release checklist.',
        records: 'Cleaning Log CL-11 and Release Checklist CL-12.',
        exceptions: 'Residual contamination above limit triggers deviation and recleaning.',
        references: [
          { label: 'Incoming Material SOP', type: 'sop', target: 'SOP-QA-001' },
        ],
        steps: [
          { name: 'Isolate line and utilities', role: 'line_operator', inputs: ['line_status'], outputs: ['safe_state'], records: ['CL-11'] },
          { name: 'Execute cleaning protocol', role: 'line_operator', inputs: ['cleaning_kit'], outputs: ['cleaned_equipment'], records: ['CL-11'] },
          { name: 'Supervisor verification and release', role: 'production_supervisor', inputs: ['cleaned_equipment'], outputs: ['line_release_status'], records: ['CL-12'] },
        ],
      }),
    },
    {
      code: 'SOP-QA-020',
      title: 'Deviation Handling and CAPA Trigger',
      area: 'Quality Assurance',
      targetRoles: ['author', 'reviewer', 'approver'],
      document: buildDocument({
        title: 'Deviation Handling and CAPA Trigger',
        purpose: 'Define the standard method for managing process deviations and CAPA initiation.',
        scope: 'Applies to all GMP-impacting deviations in production and quality operations.',
        responsibilities: 'Process Owner reports deviation; QA Manager classifies and approves CAPA path.',
        procedure: 'Log deviation, perform preliminary classification, execute root-cause analysis, decide CAPA as needed.',
        records: 'Deviation Ticket DV-01, Investigation Record DV-02, CAPA Plan DV-03.',
        exceptions: 'Critical deviations require immediate escalation to Site Head.',
        references: [
          { label: 'Cleaning SOP', type: 'sop', target: 'SOP-OPS-010' },
        ],
        steps: [
          { name: 'Register deviation in system', role: 'process_owner', inputs: ['deviation_signal'], outputs: ['deviation_ticket'], records: ['DV-01'] },
          { name: 'Classify deviation severity', role: 'qa_manager', inputs: ['deviation_ticket'], outputs: ['severity_class'], records: ['DV-02'] },
          { name: 'Define CAPA requirement', role: 'qa_manager', inputs: ['severity_class'], outputs: ['capa_decision'], records: ['DV-03'] },
        ],
      }),
    },
    {
      code: 'SOP-QA-030',
      title: 'Batch Record Final Review and Release',
      area: 'Quality Assurance',
      targetRoles: ['reviewer', 'approver'],
      document: buildDocument({
        title: 'Batch Record Final Review and Release',
        purpose: 'Ensure complete review and release decision for executed batch records.',
        scope: 'Covers completed manufacturing batches pending final QA release.',
        responsibilities: 'QA Reviewer performs record check; QA Approver provides release decision.',
        procedure: 'Collect full batch package, review critical entries, verify deviations and CAPAs, sign release decision.',
        records: 'Batch Review Checklist BR-01 and Release Authorization BR-02.',
        exceptions: 'Incomplete records trigger hold status and remediation request.',
        references: [
          { label: 'Incoming Material SOP', type: 'sop', target: 'SOP-QA-001' },
          { label: 'Cleaning SOP', type: 'sop', target: 'SOP-OPS-010' },
          { label: 'Deviation SOP', type: 'sop', target: 'SOP-QA-020' },
        ],
        steps: [
          { name: 'Assemble executed batch record package', role: 'qa_reviewer', inputs: ['batch_documents'], outputs: ['review_package'], records: ['BR-01'] },
          { name: 'Perform completeness and compliance review', role: 'qa_reviewer', inputs: ['review_package'], outputs: ['review_outcome'], records: ['BR-01'] },
          { name: 'Approve or hold batch release', role: 'qa_approver', inputs: ['review_outcome'], outputs: ['release_status'], records: ['BR-02'] },
        ],
      }),
    },
  ];

  const sopResults = [];
  for (const definition of sopDefinitions) {
    sopResults.push(await ensureSop(definition));
  }

  const sopByCode = {};
  for (const definition of sopDefinitions) {
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

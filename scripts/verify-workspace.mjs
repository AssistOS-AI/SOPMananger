import path from 'node:path';
import { createApp } from '../src/app.mjs';

const dataRoot = path.join(process.cwd(), 'data');

function fail(message) {
  throw new Error(message);
}

async function main() {
  const app = await createApp({
    dataRoot,
    quiet: true,
    llmEnabled: false,
  });

  const {
    sopService,
    authService,
    settingsService,
    trainingService,
    templateService,
  } = app.services;
  const users = await authService.listUsers();
  if (!users.length) {
    fail('No users found.');
  }

  const passwordlessAuthor = await authService.verifyCredentials('author', '');
  if (!passwordlessAuthor) {
    fail('Expected passwordless login to work for author user.');
  }

  const requiredCodes = ['SOP-QA-001', 'SOP-OPS-010', 'SOP-QA-020', 'SOP-QA-030'];
  const sops = await sopService.listSops();
  for (const code of requiredCodes) {
    if (!sops.some((item) => item.code === code)) {
      fail(`Missing expected SOP code: ${code}`);
    }
  }

  const byCode = {};
  for (const item of sops) {
    byCode[item.code] = item;
  }

  const primary = byCode['SOP-QA-001'];
  if (primary.status !== 'Effective') {
    fail(`SOP-QA-001 expected status Effective, got ${primary.status}.`);
  }

  const reviewSop = byCode['SOP-OPS-010'];
  if (!['In Review', 'Approved', 'Effective'].includes(reviewSop.status)) {
    fail(`SOP-OPS-010 expected at least In Review status, got ${reviewSop.status}.`);
  }

  const templates = await templateService.listTemplates();
  if (templates.length < 3) {
    fail(`Expected at least 3 templates, found ${templates.length}.`);
  }

  const comments = await sopService.listReviewComments(reviewSop.id);
  if (!comments.length) {
    fail('Expected review comments on SOP-OPS-010.');
  }

  const training = await sopService.listTrainingTasks({ sopId: primary.id });
  if (!training.length) {
    fail('Expected generated training tasks for SOP-QA-001.');
  }
  if (!training.every((task) => task.dueAt && task.quiz && Number.isFinite(Number(task.quiz.passScore)))) {
    fail('Expected generated training tasks to include due date and quiz policy.');
  }

  const trainingOverview = await trainingService.getOverview({ sopId: primary.id });
  if (!trainingOverview?.summary || !Number.isFinite(trainingOverview.summary.total)) {
    fail('Expected training overview summary for primary SOP.');
  }

  const profile = await settingsService.getRegulatoryProfile();
  if (!profile?.profileName || !Array.isArray(profile.assuranceChecks) || !profile.assuranceChecks.length) {
    fail('Expected configured regulatory profile with assurance checks.');
  }

  const impact = await sopService.analyzeImpact(primary.id);
  if (!impact.reverseReferences.length) {
    fail('Expected reverse references for SOP-QA-001 impact analysis.');
  }
  if (!impact.linkedBlocks.length) {
    fail('Expected reusable section links on SOP-QA-001.');
  }

  const validation = await sopService.validateSop({ sopId: primary.id });
  if (validation.summary.blocking > 0) {
    fail(`Expected zero blocking findings for SOP-QA-001, got ${validation.summary.blocking}.`);
  }

  const auditVerification = await sopService.verifyAudit();
  if (!auditVerification.ok) {
    fail(`Audit verification failed: ${auditVerification.reason || 'unknown reason'}`);
  }

  const auditEvents = await sopService.listAuditEvents({ entityId: primary.id, limit: 20 });
  if (!auditEvents.length) {
    fail('Expected audit events for SOP-QA-001.');
  }

  const summary = {
    users: users.length,
    passwordlessAuthorLogin: true,
    sops: sops.length,
    templates: templates.length,
    reviewComments: comments.length,
    trainingTasksForPrimary: training.length,
    trainingCompletionRate: trainingOverview.summary.completionRate,
    regulatoryProfile: profile.profileName,
    primaryStatus: primary.status,
    primaryReusableLinks: impact.linkedBlocks.length,
    primaryBlockingFindings: validation.summary.blocking,
    primaryAuditEvents: auditEvents.length,
    auditChain: 'ok',
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DocumentStore } from '../src/storage/document-store.mjs';
import { AuditStore } from '../src/storage/audit-store.mjs';
import { SettingsService } from '../src/services/settings-service.mjs';
import { TrainingService } from '../src/services/training-service.mjs';

test('TrainingService supports read acknowledgement, quiz, sign-off, and overview', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sop-training-test-'));
  const documentStore = new DocumentStore({ dataRoot: root, workspaceId: 'default' });
  await documentStore.ensureWorkspace();

  const auditStore = new AuditStore({ workspacePath: documentStore.workspacePath });
  await auditStore.initialize();
  const settingsService = new SettingsService({ documentStore, auditStore });
  await settingsService.initialize();

  const trainingService = new TrainingService({
    documentStore,
    auditStore,
    settingsService,
  });

  const now = new Date().toISOString();
  const dueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  await documentStore.saveTrainingTasks([
    {
      id: 'tt-001',
      sopId: 'sop-1',
      sopCode: 'SOP-001',
      sopTitle: 'Sample SOP',
      versionId: 'v1',
      userId: 'u-author',
      username: 'author',
      role: 'author',
      essentialRoles: ['author'],
      assignmentType: 'read-and-understand',
      assignedAt: now,
      dueAt,
      readAcknowledgedAt: null,
      readAcknowledgedBy: null,
      quiz: {
        passScore: 80,
        attempts: 0,
        latestScore: null,
        passedAt: null,
        history: [],
      },
      trainerSignoffAt: null,
      trainerSignoffBy: null,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  let tasks = await trainingService.listTasks({});
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, 'assigned');

  await trainingService.markRead({
    taskId: 'tt-001',
    actor: { id: 'u-author', role: 'author' },
  });
  tasks = await trainingService.listTasks({});
  assert.equal(tasks[0].status, 'in_progress');
  assert.ok(tasks[0].readAcknowledgedAt);

  await trainingService.submitQuiz({
    taskId: 'tt-001',
    actor: { id: 'u-author', role: 'author' },
    score: 91,
  });
  tasks = await trainingService.listTasks({});
  assert.equal(tasks[0].quiz.latestScore, 91);
  assert.ok(tasks[0].quiz.passedAt);
  assert.equal(tasks[0].status, 'in_progress');

  await trainingService.signoff({
    taskId: 'tt-001',
    actor: { id: 'u-reviewer', role: 'reviewer' },
    note: 'Completed under supervision.',
  });
  tasks = await trainingService.listTasks({});
  assert.equal(tasks[0].status, 'completed');
  assert.ok(tasks[0].trainerSignoffAt);

  const overview = await trainingService.getOverview({});
  assert.equal(overview.summary.total, 1);
  assert.equal(overview.summary.completed, 1);
  assert.equal(overview.summary.completionRate, 100);

  await fs.rm(root, { recursive: true, force: true });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DocumentStore } from '../src/storage/document-store.mjs';
import { AuditStore } from '../src/storage/audit-store.mjs';
import { ValidationService } from '../src/services/validation-service.mjs';
import { WorkflowService } from '../src/services/workflow-service.mjs';
import { LLMService } from '../src/services/llm-service.mjs';
import { SopService } from '../src/services/sop-service.mjs';

function buildRules() {
  return {
    requiredSections: [
      { id: 'purpose', title: 'Purpose' },
      { id: 'scope', title: 'Scope' },
      { id: 'responsibilities', title: 'Responsibilities' },
      { id: 'procedure', title: 'Procedure' },
      { id: 'records', title: 'Records' },
      { id: 'exceptions', title: 'Exceptions' },
    ],
    ambiguousTerms: [],
  };
}

test('SopService supports block instantiation, review comments, and impact analysis', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sop-service-test-'));
  const workspaceId = 'default';
  const documentStore = new DocumentStore({ dataRoot: root, workspaceId });
  const auditStore = new AuditStore({ workspacePath: documentStore.workspacePath });
  const validationService = new ValidationService({ rules: buildRules() });
  const workflowService = new WorkflowService();
  const llmService = new LLMService({ enabled: false });

  const users = [
    { id: 'u-author', username: 'author', role: 'author', active: true },
    { id: 'u-reviewer', username: 'reviewer', role: 'reviewer', active: true },
  ];

  const service = new SopService({
    documentStore,
    auditStore,
    validationService,
    workflowService,
    llmService,
    resolveUsers: async () => users,
  });
  await service.initialize();

  const author = users[0];
  const created = await service.createSop({
    actor: author,
    payload: {
      title: 'Primary SOP',
      code: 'SOP-PRIMARY',
      targetRoles: ['author'],
    },
  });
  const sopId = created.meta.id;

  const block = await service.createBlock({
    actor: author,
    payload: {
      title: 'Safety Notice',
      mode: 'linked',
      contentTemplate: 'Use system {{system}} before execution.',
    },
  });

  const instantiated = await service.instantiateBlock({
    sopId,
    actor: author,
    blockId: block.id,
    parameters: { system: 'ERP-X' },
  });

  assert.equal(instantiated.section.source.type, 'block');
  assert.equal(instantiated.section.source.blockId, block.id);
  assert.match(instantiated.section.text, /ERP-X/);

  const addedComment = await service.addReviewComment({
    sopId,
    actor: users[1],
    sectionPath: 'sections.0',
    text: 'Clarify acceptance criteria.',
  });
  assert.equal(addedComment.status, 'open');

  const resolved = await service.resolveReviewComment({
    sopId,
    actor: users[1],
    commentId: addedComment.id,
  });
  assert.equal(resolved.status, 'resolved');

  const secondary = await service.createSop({
    actor: author,
    payload: {
      title: 'Secondary SOP',
      code: 'SOP-SECONDARY',
      document: {
        title: 'Secondary SOP',
        sections: [
          { id: 'purpose', title: 'Purpose', text: 'Purpose text' },
          { id: 'scope', title: 'Scope', text: 'Scope text' },
          { id: 'responsibilities', title: 'Responsibilities', text: 'Ops' },
          { id: 'procedure', title: 'Procedure', text: 'Run task' },
          { id: 'records', title: 'Records', text: 'Store log' },
          { id: 'exceptions', title: 'Exceptions', text: 'Escalate' },
        ],
        processModel: { steps: [{ name: 'Run', role: 'operator' }] },
        references: [{ label: 'Depends On', type: 'sop', target: sopId }],
        trainingTaskIds: [],
      },
    },
  });
  assert.ok(secondary.meta.id);

  const impact = await service.analyzeImpact(sopId);
  assert.equal(Array.isArray(impact.linkedBlocks), true);
  assert.equal(impact.linkedBlocks.length >= 1, true);
  assert.equal(impact.reverseReferences.some((item) => item.sopId === secondary.meta.id), true);

  await fs.rm(root, { recursive: true, force: true });
});

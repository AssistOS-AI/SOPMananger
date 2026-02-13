import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.mjs';

test('ChatAgentService supports operational commands and role checks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sop-chat-test-'));
  const app = await createApp({
    dataRoot: root,
    quiet: true,
    llmEnabled: false,
  });

  const { authService, sopService, chatAgentService } = app.services;
  const author = await authService.verifyCredentials('author', '');
  const approver = await authService.verifyCredentials('approver', '');

  const created = await sopService.createSop({
    actor: author,
    payload: {
      title: 'Chat Controlled SOP',
      code: 'SOP-CHAT-001',
      area: 'Operations',
      targetRoles: ['author', 'approver'],
    },
  });

  const openResult = await chatAgentService.handleMessage({
    actor: author,
    message: 'open SOP-CHAT-001',
  });
  assert.equal(openResult.selectedSopId, created.meta.id);

  const validateResult = await chatAgentService.handleMessage({
    actor: author,
    selectedSopId: created.meta.id,
    message: 'validate',
  });
  assert.match(validateResult.reply, /Validation complete/i);

  const reviewResult = await chatAgentService.handleMessage({
    actor: author,
    selectedSopId: created.meta.id,
    message: 'submit to review because ready for SME',
  });
  assert.match(reviewResult.reply, /In Review/i);

  let forbidden = null;
  try {
    await chatAgentService.handleMessage({
      actor: author,
      selectedSopId: created.meta.id,
      message: 'approve because looks good',
      canReauthenticate: async () => true,
    });
  } catch (error) {
    forbidden = error;
  }
  assert.ok(forbidden);
  assert.equal(forbidden.status, 403);

  const approveResult = await chatAgentService.handleMessage({
    actor: approver,
    selectedSopId: created.meta.id,
    message: 'approve because all checks pass',
    password: '',
    canReauthenticate: async () => true,
  });
  assert.match(approveResult.reply, /approved/i);

  const importResult = await chatAgentService.handleMessage({
    actor: author,
    message: 'create sop from attachment',
    attachments: [
      {
        name: 'line-clearance-notes.txt',
        mimeType: 'text/plain',
        size: 120,
        content: 'Purpose: line clearance checks.\nStep 1: isolate utilities.\nStep 2: verify residues.',
      },
    ],
  });
  assert.match(importResult.reply, /Created SOP/i);
  assert.ok(importResult.selectedSopId);

  const summarizeOnlyAttachment = await chatAgentService.handleMessage({
    actor: author,
    message: '',
    attachments: [
      {
        name: 'notes.md',
        mimeType: 'text/markdown',
        size: 48,
        content: 'Deviation report summary for CAPA readiness.',
      },
    ],
  });
  assert.match(summarizeOnlyAttachment.reply, /notes\.md|Attachment summary|CAPA/i);

  await fs.rm(root, { recursive: true, force: true });
});

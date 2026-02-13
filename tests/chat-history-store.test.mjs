import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DocumentStore } from '../src/storage/document-store.mjs';

test('DocumentStore persists chat history per user', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sop-chat-history-'));
  const store = new DocumentStore({ dataRoot: root, workspaceId: 'default' });
  await store.ensureWorkspace();

  const first = [
    { role: 'assistant', text: 'hello', at: new Date().toISOString(), attachments: [], actions: [] },
    { role: 'user', text: 'list sops', at: new Date().toISOString(), attachments: [], actions: [] },
  ];
  const second = [
    { role: 'assistant', text: 'other user thread', at: new Date().toISOString(), attachments: [], actions: [] },
  ];

  await store.saveChatHistory('u-author', first);
  await store.saveChatHistory('u-reviewer', second);

  const loadedAuthor = await store.getChatHistory('u-author');
  const loadedReviewer = await store.getChatHistory('u-reviewer');
  const missing = await store.getChatHistory('u-missing');

  assert.equal(loadedAuthor.length, 2);
  assert.equal(loadedReviewer.length, 1);
  assert.equal(loadedReviewer[0].text, 'other user thread');
  assert.deepEqual(missing, []);

  await fs.rm(root, { recursive: true, force: true });
});

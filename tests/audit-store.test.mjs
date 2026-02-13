import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AuditStore } from '../src/storage/audit-store.mjs';

async function makeTempWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sop-audit-test-'));
  const workspacePath = path.join(root, 'workspaces', 'default');
  await fs.mkdir(path.join(workspacePath, 'audit'), { recursive: true });
  return { root, workspacePath };
}

test('AuditStore appends and verifies hash chain', async () => {
  const { root, workspacePath } = await makeTempWorkspace();
  const audit = new AuditStore({ workspacePath });
  await audit.initialize();

  await audit.append({
    actorId: 'u-1',
    action: 'sop.create',
    entityType: 'sop',
    entityId: 'sop-1',
    payload: { title: 'Doc 1' },
  });
  await audit.append({
    actorId: 'u-1',
    action: 'sop.version.create',
    entityType: 'sop',
    entityId: 'sop-1',
    payload: { versionId: 'v2' },
  });

  const verified = await audit.verify();
  assert.equal(verified.ok, true);
  assert.equal(verified.count, 2);

  await fs.rm(root, { recursive: true, force: true });
});

test('AuditStore detects tampering', async () => {
  const { root, workspacePath } = await makeTempWorkspace();
  const audit = new AuditStore({ workspacePath });
  await audit.initialize();

  await audit.append({
    actorId: 'u-2',
    action: 'sop.create',
    entityType: 'sop',
    entityId: 'sop-2',
    payload: { title: 'Doc 2' },
  });

  const logPath = path.join(workspacePath, 'audit', 'audit.log.jsonl');
  const raw = await fs.readFile(logPath, 'utf8');
  const first = JSON.parse(raw.trim());
  first.payload.title = 'Tampered';
  await fs.writeFile(logPath, `${JSON.stringify(first)}\n`, 'utf8');

  const verified = await audit.verify();
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, 'Hash mismatch.');

  await fs.rm(root, { recursive: true, force: true });
});

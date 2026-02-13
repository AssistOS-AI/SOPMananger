import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AuthService } from '../src/services/auth-service.mjs';

test('AuthService hashes and verifies credentials and session csrf', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sop-auth-test-'));
  const usersFilePath = path.join(root, 'users', 'users.json');
  await fs.mkdir(path.dirname(usersFilePath), { recursive: true });

  const auth = new AuthService({ usersFilePath, secureCookies: false });
  await auth.ensureDefaultUsers();

  const user = await auth.verifyCredentials('admin', '');
  assert.ok(user);
  assert.equal(user.username, 'admin');
  assert.equal(user.role, 'admin');
  assert.equal(user.passwordEnabled, false);

  const invalid = await auth.verifyCredentials('admin', 'wrong-password');
  assert.equal(invalid, null);

  const session = auth.createSession(user);
  assert.ok(session.sessionId);
  assert.ok(session.csrfToken);
  assert.equal(auth.validateCsrf(session, session.csrfToken), true);
  assert.equal(auth.validateCsrf(session, 'bad-token'), false);

  const updated = await auth.updatePasswordForSession(session, {
    currentPassword: '',
    newPassword: 'secure-pass',
  });
  assert.equal(updated.passwordEnabled, true);

  const oldAfterSet = await auth.verifyCredentials('admin', '');
  assert.equal(oldAfterSet, null);
  const newAfterSet = await auth.verifyCredentials('admin', 'secure-pass');
  assert.ok(newAfterSet);
  assert.equal(newAfterSet.passwordEnabled, true);

  const cleared = await auth.updatePasswordForSession(session, {
    currentPassword: 'secure-pass',
    newPassword: '',
  });
  assert.equal(cleared.passwordEnabled, false);
  const loginAfterClear = await auth.verifyCredentials('admin', '');
  assert.ok(loginAfterClear);
  assert.equal(loginAfterClear.passwordEnabled, false);

  const created = await auth.createUser({
    username: 'qa.operator',
    displayName: 'QA Operator',
    role: 'reviewer',
    essentialRoles: ['reviewer', 'trainer'],
    department: 'Quality Assurance',
    site: 'Plant A',
    password: '',
  });
  assert.equal(created.username, 'qa.operator');
  assert.equal(created.role, 'reviewer');
  assert.deepEqual(created.essentialRoles, ['reviewer', 'trainer']);

  const updatedUser = await auth.updateUser(created.id, {
    role: 'approver',
    essentialRoles: ['approver'],
    active: false,
  });
  assert.equal(updatedUser.role, 'approver');
  assert.deepEqual(updatedUser.essentialRoles, ['approver']);
  assert.equal(updatedUser.active, false);

  await fs.rm(root, { recursive: true, force: true });
});

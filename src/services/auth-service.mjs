import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { buildCookie, HttpError, parseCookies } from '../lib/http.mjs';
import { fileExists, readJson, writeJsonAtomic } from '../storage/json-store.mjs';

const scrypt = promisify(scryptCallback);

export const SESSION_COOKIE = 'sop_sid';
export const PRIMARY_ROLES = ['admin', 'author', 'reviewer', 'approver'];
export const ESSENTIAL_ROLE_SET = ['author', 'reviewer', 'approver', 'trainer'];

function normalizeEssentialRoles(value, fallbackRole = null) {
  const incoming = Array.isArray(value) ? value : [];
  const cleaned = incoming
    .map((item) => String(item || '').trim())
    .filter((item) => ESSENTIAL_ROLE_SET.includes(item));
  if (fallbackRole && ESSENTIAL_ROLE_SET.includes(fallbackRole) && !cleaned.includes(fallbackRole)) {
    cleaned.unshift(fallbackRole);
  }
  const unique = [...new Set(cleaned)];
  return unique;
}

function sanitizeUser(user, options = {}) {
  const { passwordEnabled = undefined } = options;
  if (!user) {
    return null;
  }
  const payload = {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    department: user.department || '',
    site: user.site || '',
    jobTitle: user.jobTitle || '',
    role: user.role,
    essentialRoles: normalizeEssentialRoles(user.essentialRoles, user.role),
    active: user.active !== false,
  };
  if (typeof passwordEnabled === 'boolean') {
    payload.passwordEnabled = passwordEnabled;
  }
  return payload;
}

export class AuthService {
  constructor({ usersFilePath, secureCookies = false, sessionTtlSeconds = 8 * 3600 }) {
    this.usersFilePath = usersFilePath;
    this.secureCookies = secureCookies;
    this.sessionTtlSeconds = sessionTtlSeconds;
    this.sessions = new Map();
  }

  async hashPassword(password, salt = randomBytes(16).toString('hex')) {
    const derived = await scrypt(password, salt, 64);
    return `${salt}:${Buffer.from(derived).toString('hex')}`;
  }

  async verifyPassword(password, storedHash) {
    const [salt, expected] = String(storedHash || '').split(':');
    if (!salt || !expected) {
      return false;
    }

    const derived = await scrypt(password, salt, 64);
    const expectedBuffer = Buffer.from(expected, 'hex');
    const derivedBuffer = Buffer.from(derived);

    if (expectedBuffer.length !== derivedBuffer.length) {
      return false;
    }
    return timingSafeEqual(expectedBuffer, derivedBuffer);
  }

  async ensureDefaultUsers() {
    if (await fileExists(this.usersFilePath)) {
      return;
    }

    const defaults = [
      {
        id: 'u-admin',
        username: 'admin',
        displayName: 'Quality Systems Admin',
        department: 'Quality Systems',
        site: 'HQ',
        jobTitle: 'System Administrator',
        role: 'admin',
        essentialRoles: ['author', 'reviewer', 'approver', 'trainer'],
        password: '',
      },
      {
        id: 'u-author',
        username: 'author',
        displayName: 'Process Author',
        department: 'Operations',
        site: 'Plant A',
        jobTitle: 'Process Owner',
        role: 'author',
        essentialRoles: ['author'],
        password: '',
      },
      {
        id: 'u-reviewer',
        username: 'reviewer',
        displayName: 'SME Reviewer',
        department: 'Quality Assurance',
        site: 'Plant A',
        jobTitle: 'QA Specialist',
        role: 'reviewer',
        essentialRoles: ['reviewer', 'trainer'],
        password: '',
      },
      {
        id: 'u-approver',
        username: 'approver',
        displayName: 'Final Approver',
        department: 'Quality Unit',
        site: 'Plant A',
        jobTitle: 'Qualified Person',
        role: 'approver',
        essentialRoles: ['approver'],
        password: '',
      },
    ];

    const users = [];
    for (const item of defaults) {
      const passwordHash = await this.hashPassword(item.password);
      users.push({
        id: item.id,
        username: item.username,
        displayName: item.displayName || item.username,
        department: item.department || '',
        site: item.site || '',
        jobTitle: item.jobTitle || '',
        role: item.role,
        essentialRoles: normalizeEssentialRoles(item.essentialRoles, item.role),
        passwordHash,
        passwordEnabled: false,
        active: true,
        createdAt: new Date().toISOString(),
      });
    }

    await writeJsonAtomic(this.usersFilePath, users);
  }

  async loadUsers() {
    const users = await readJson(this.usersFilePath, []);
    return Array.isArray(users) ? users : [];
  }

  async findUserByUsername(username) {
    const users = await this.loadUsers();
    return users.find((user) => user.username === username) ?? null;
  }

  async findUserById(userId) {
    const users = await this.loadUsers();
    return users.find((user) => user.id === userId) ?? null;
  }

  async resolvePasswordEnabled(user) {
    if (!user) {
      return false;
    }
    if (typeof user.passwordEnabled === 'boolean') {
      return user.passwordEnabled;
    }
    if (!user.passwordHash) {
      return false;
    }
    const isEmptyPassword = await this.verifyPassword('', user.passwordHash);
    return !isEmptyPassword;
  }

  async verifyCredentials(username, password = '') {
    const user = await this.findUserByUsername(username);
    if (!user || user.active === false) {
      return null;
    }

    const valid = await this.verifyPassword(String(password ?? ''), user.passwordHash);
    if (!valid) {
      return null;
    }

    const passwordEnabled = await this.resolvePasswordEnabled(user);
    return sanitizeUser(user, { passwordEnabled });
  }

  createSession(user) {
    const sessionId = randomBytes(24).toString('hex');
    const csrfToken = randomBytes(16).toString('hex');
    const now = Date.now();
    const expiresAt = now + this.sessionTtlSeconds * 1000;
    const session = {
      sessionId,
      csrfToken,
      user,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  getSessionById(sessionId) {
    if (!sessionId) {
      return null;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    session.lastSeenAt = Date.now();
    return session;
  }

  getSessionFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie || '');
    const sessionId = cookies[SESSION_COOKIE];
    return this.getSessionById(sessionId);
  }

  buildLoginCookie(session) {
    return buildCookie(SESSION_COOKIE, session.sessionId, {
      httpOnly: true,
      secure: this.secureCookies,
      sameSite: 'Lax',
      path: '/',
      maxAge: this.sessionTtlSeconds,
    });
  }

  buildLogoutCookie() {
    return buildCookie(SESSION_COOKIE, '', {
      httpOnly: true,
      secure: this.secureCookies,
      sameSite: 'Lax',
      path: '/',
      maxAge: 0,
    });
  }

  logout(sessionId) {
    if (!sessionId) {
      return;
    }
    this.sessions.delete(sessionId);
  }

  validateCsrf(session, providedToken) {
    if (!session || !providedToken) {
      return false;
    }
    return session.csrfToken === providedToken;
  }

  requireAuthenticated(session) {
    if (!session?.user) {
      throw new HttpError(401, 'Authentication required.');
    }
  }

  requireRole(session, allowedRoles) {
    this.requireAuthenticated(session);
    if (!Array.isArray(allowedRoles) || !allowedRoles.length) {
      return;
    }
    if (!allowedRoles.includes(session.user.role) && session.user.role !== 'admin') {
      throw new HttpError(403, 'Insufficient role for this operation.');
    }
  }

  async reauthenticate(session, password) {
    this.requireAuthenticated(session);
    if (!password || typeof password !== 'string') {
      return false;
    }
    const user = await this.verifyCredentials(session.user.username, password);
    return Boolean(user);
  }

  async listUsers() {
    const users = await this.loadUsers();
    const sanitized = [];
    for (const user of users) {
      const passwordEnabled = await this.resolvePasswordEnabled(user);
      sanitized.push(sanitizeUser(user, { passwordEnabled }));
    }
    return sanitized;
  }

  _normalizePrimaryRole(role) {
    const normalized = String(role || '').trim();
    if (!PRIMARY_ROLES.includes(normalized)) {
      throw new HttpError(400, `Role must be one of: ${PRIMARY_ROLES.join(', ')}.`);
    }
    return normalized;
  }

  _normalizeUsername(username) {
    const normalized = String(username || '').trim().toLowerCase();
    if (!normalized) {
      throw new HttpError(400, 'username is required.');
    }
    if (!/^[a-z0-9._-]{3,40}$/.test(normalized)) {
      throw new HttpError(400, 'username must be 3-40 chars: lowercase letters, numbers, ".", "_" or "-".');
    }
    return normalized;
  }

  async createUser(payload = {}) {
    const username = this._normalizeUsername(payload.username);
    const role = this._normalizePrimaryRole(payload.role);
    const password = typeof payload.password === 'string' ? payload.password : '';
    if (password.length > 0 && password.length < 4) {
      throw new HttpError(400, 'Password must be empty or at least 4 characters long.');
    }

    const users = await this.loadUsers();
    if (users.some((item) => item.username === username)) {
      throw new HttpError(409, `Username "${username}" already exists.`);
    }

    const now = new Date().toISOString();
    const created = {
      id: `u-${randomBytes(4).toString('hex')}`,
      username,
      displayName: String(payload.displayName || username).trim() || username,
      department: String(payload.department || '').trim(),
      site: String(payload.site || '').trim(),
      jobTitle: String(payload.jobTitle || '').trim(),
      role,
      essentialRoles: normalizeEssentialRoles(payload.essentialRoles, role),
      passwordHash: await this.hashPassword(password),
      passwordEnabled: password.length > 0,
      active: payload.active !== false,
      createdAt: now,
      updatedAt: now,
    };

    users.push(created);
    await writeJsonAtomic(this.usersFilePath, users);

    return sanitizeUser(created, { passwordEnabled: created.passwordEnabled });
  }

  async updateUser(userId, patch = {}) {
    const users = await this.loadUsers();
    const index = users.findIndex((item) => item.id === userId);
    if (index === -1) {
      throw new HttpError(404, `User "${userId}" not found.`);
    }
    const existing = users[index];

    const nextRole = patch.role != null
      ? this._normalizePrimaryRole(patch.role)
      : existing.role;

    const password = patch.password;
    const passwordUpdate = typeof password === 'string';
    if (passwordUpdate && password.length > 0 && password.length < 4) {
      throw new HttpError(400, 'Password must be empty or at least 4 characters long.');
    }

    const now = new Date().toISOString();
    const updated = {
      ...existing,
      displayName: patch.displayName != null
        ? String(patch.displayName || existing.username).trim()
        : existing.displayName,
      department: patch.department != null ? String(patch.department || '').trim() : existing.department,
      site: patch.site != null ? String(patch.site || '').trim() : existing.site,
      jobTitle: patch.jobTitle != null ? String(patch.jobTitle || '').trim() : existing.jobTitle,
      role: nextRole,
      essentialRoles: patch.essentialRoles != null
        ? normalizeEssentialRoles(patch.essentialRoles, nextRole)
        : normalizeEssentialRoles(existing.essentialRoles, nextRole),
      active: patch.active != null ? Boolean(patch.active) : existing.active !== false,
      updatedAt: now,
    };

    if (passwordUpdate) {
      updated.passwordHash = await this.hashPassword(password);
      updated.passwordEnabled = password.length > 0;
    }

    users[index] = updated;
    await writeJsonAtomic(this.usersFilePath, users);
    const passwordEnabled = await this.resolvePasswordEnabled(updated);
    return sanitizeUser(updated, { passwordEnabled });
  }

  async updatePasswordForSession(session, { currentPassword = '', newPassword } = {}) {
    this.requireAuthenticated(session);
    if (typeof newPassword !== 'string') {
      throw new HttpError(400, 'newPassword must be a string (empty string allowed).');
    }
    if (newPassword.length > 0 && newPassword.length < 4) {
      throw new HttpError(400, 'Password must be empty or at least 4 characters long.');
    }

    const users = await this.loadUsers();
    const index = users.findIndex((item) => item.id === session.user.id);
    if (index === -1) {
      throw new HttpError(404, 'User not found.');
    }

    const user = users[index];
    const passwordEnabled = await this.resolvePasswordEnabled(user);

    if (passwordEnabled) {
      const validCurrent = await this.verifyPassword(String(currentPassword ?? ''), user.passwordHash);
      if (!validCurrent) {
        throw new HttpError(401, 'Current password is invalid.');
      }
    }

    const now = new Date().toISOString();
    users[index] = {
      ...user,
      passwordHash: await this.hashPassword(newPassword),
      passwordEnabled: newPassword.length > 0,
      updatedAt: now,
    };
    await writeJsonAtomic(this.usersFilePath, users);

    const updatedUser = sanitizeUser(users[index], { passwordEnabled: users[index].passwordEnabled });
    session.user = updatedUser;
    return updatedUser;
  }
}

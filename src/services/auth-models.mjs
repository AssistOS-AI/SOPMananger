export const PRIMARY_ROLES = ['admin', 'author', 'reviewer', 'approver'];
export const ESSENTIAL_ROLE_SET = ['author', 'reviewer', 'approver', 'trainer'];

export function normalizeEssentialRoles(value, fallbackRole = null) {
  const incoming = Array.isArray(value) ? value : [];
  const cleaned = incoming
    .map((item) => String(item || '').trim())
    .filter((item) => ESSENTIAL_ROLE_SET.includes(item));
  if (fallbackRole && ESSENTIAL_ROLE_SET.includes(fallbackRole) && !cleaned.includes(fallbackRole)) {
    cleaned.unshift(fallbackRole);
  }
  return [...new Set(cleaned)];
}

export function sanitizeUser(user, options = {}) {
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

export function defaultUserProfiles() {
  return [
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
}

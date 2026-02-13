function getStatusCounts(state) {
  const counts = {
    total: state.sops.length,
    Draft: 0,
    'In Review': 0,
    Approved: 0,
    Effective: 0,
    Superseded: 0,
  };
  for (const sop of state.sops) {
    counts[sop.status] = (counts[sop.status] || 0) + 1;
  }
  return counts;
}

function renderRoleCheckboxes(fieldName, selected) {
  const roles = ['author', 'reviewer', 'approver', 'trainer'];
  return roles
    .map((role) => `<label class="check-inline"><input type="checkbox" name="${fieldName}" value="${role}" ${selected.includes(role) ? 'checked' : ''} /> ${role}</label>`)
    .join('');
}

export function renderDashboard({ state, esc, fmtDate, icon }) {
  const counts = getStatusCounts(state);
  const overview = state.trainingOverview?.summary || {
    total: 0,
    overdue: 0,
    completionRate: 0,
  };
  const distribution = [
    ['Draft', counts.Draft, 'status-draft'],
    ['In Review', counts['In Review'], 'status-in-review'],
    ['Approved', counts.Approved, 'status-approved'],
    ['Effective', counts.Effective, 'status-effective'],
    ['Superseded', counts.Superseded, 'status-superseded'],
  ]
    .map(([label, value, className]) => `
      <div class="status-item">
        <span class="status-segment ${className}" aria-hidden="true"></span>
        <span class="muted">${esc(label)}: <strong>${esc(value)}</strong></span>
      </div>
    `)
    .join('');

  const cards = [
    { status: 'all', label: 'Total SOPs', value: counts.total },
    { status: 'Draft', label: 'Draft', value: counts.Draft, className: 'status-draft' },
    { status: 'In Review', label: 'In Review', value: counts['In Review'], className: 'status-in-review' },
    { status: 'Approved', label: 'Approved', value: counts.Approved, className: 'status-approved' },
    { status: 'Effective', label: 'Effective', value: counts.Effective, className: 'status-effective' },
    { status: 'Superseded', label: 'Superseded', value: counts.Superseded, className: 'status-superseded' },
  ]
    .map((item) => `
      <button class="stat ${esc(item.className || '')}" data-action="open-sop-list-status" data-status="${esc(item.status)}">
        <span class="muted">${esc(item.label)}</span>
        <strong>${esc(item.value)}</strong>
      </button>
    `)
    .join('');

  const recentRows = state.sops
    .slice(0, 8)
    .map((item) => `
      <tr>
        <td>${esc(item.code)}</td>
        <td>${esc(item.title)}</td>
        <td><span class="badge">${esc(item.status)}</span></td>
        <td>${fmtDate(item.updatedAt)}</td>
        <td><button class="btn" data-action="open-sop-edit" data-sop-id="${esc(item.id)}">Open</button></td>
      </tr>
    `)
    .join('');

  return `
    <section class="card">
      <div class="card-head"><h3>Dashboard</h3></div>
      <div class="card-body">
        <div class="message"><strong>Operational flow:</strong> Create SOP -> Edit -> Validate -> Review -> Approve -> Publish -> Train.</div>
        <div class="muted">Each status card opens the matching filtered SOP list.</div>
        <div class="stat-grid">${cards}</div>
        <div class="status-distribution">${distribution}</div>
        <div class="actions">
          <a class="btn primary" href="#/sops/create">${icon('create', 'btn-icon')}<span>Create New SOP</span></a>
          <a class="btn" href="#/sops">${icon('sops', 'btn-icon')}<span>Open SOP List</span></a>
          <a class="btn" href="#/tasks">${icon('tasks', 'btn-icon')}<span>Open Task Monitor</span></a>
        </div>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h3>Compliance Snapshot</h3></div>
      <div class="card-body grid-3">
        <article class="section-card">
          <strong>Training Tasks</strong>
          <div class="muted">Total assigned: ${esc(overview.total)}</div>
        </article>
        <article class="section-card">
          <strong>Overdue Training</strong>
          <div class="muted">${esc(overview.overdue)} tasks require attention.</div>
        </article>
        <article class="section-card">
          <strong>Completion Rate</strong>
          <div class="muted">${esc(overview.completionRate)}%</div>
        </article>
      </div>
      <div class="card-body actions">
        <a class="btn" href="#/training">${icon('training', 'btn-icon')}<span>Open Training Compliance</span></a>
        <a class="btn" href="#/automation">${icon('automation', 'btn-icon')}<span>Open Automation & Scans</span></a>
      </div>
    </section>
    <section class="card">
      <div class="card-head">
        <h3>Recently Updated SOPs</h3>
        <a class="btn" href="#/sops">View all</a>
      </div>
      <div class="card-body table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Title</th><th>Status</th><th>Updated</th><th></th></tr></thead>
          <tbody>${recentRows || '<tr><td colspan="5">No SOPs available.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

export function renderUserManagement({ state, esc }) {
  if (state.session.role !== 'admin') {
    return `
      <section class="card">
        <div class="card-head"><h3>User Management</h3></div>
        <div class="card-body">
          <div class="message">Only admin users can manage accounts and role assignments.</div>
        </div>
      </section>
    `;
  }

  const current = state.users.find((item) => item.id === state.userEditTargetId) || state.users[0] || null;
  const rows = state.users
    .map((user) => `
      <tr>
        <td>${esc(user.username)}</td>
        <td>${esc(user.displayName || '-')}</td>
        <td>${esc(user.department || '-')}</td>
        <td>${esc(user.role)}</td>
        <td>${esc((user.essentialRoles || []).join(', ') || '-')}</td>
        <td>${user.active ? 'Active' : 'Disabled'}</td>
        <td>${user.passwordEnabled ? 'Enabled' : 'Passwordless'}</td>
        <td><button class="btn" data-action="pick-user-edit" data-user-id="${esc(user.id)}">Edit</button></td>
      </tr>
    `)
    .join('');

  const userSelectOptions = state.users
    .map((item) => `<option value="${esc(item.id)}" ${current?.id === item.id ? 'selected' : ''}>${esc(item.username)} - ${esc(item.displayName || item.username)}</option>`)
    .join('');

  const tabs = [
    ['list', 'User List'],
    ['create', 'Create User'],
    ['edit', 'Edit User'],
  ]
    .map(([tab, label]) => `<button class="tab-btn ${state.userManagementTab === tab ? 'active' : ''}" type="button" data-action="set-user-tab" data-tab="${tab}">${label}</button>`)
    .join('');

  return `
    <section class="card">
      <div class="card-head">
        <h3>User Management</h3>
        <button class="btn" data-action="refresh-users">Refresh</button>
      </div>
      <div class="card-body compact">
        <div class="studio-tabs">${tabs}</div>
      </div>
      <div class="card-body">
        ${state.userManagementTab === 'list' ? `
      <div class="row spaced panel-inline-head">
        <strong>Users</strong>
        <button class="btn primary" type="button" data-action="set-user-tab" data-tab="create">+ Create User</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Username</th><th>Display Name</th><th>Department</th><th>Primary Role</th><th>Essential Roles</th><th>Status</th><th>Password Mode</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8">No users found.</td></tr>'}</tbody>
        </table>
      </div>
    ` : ''}

        ${state.userManagementTab === 'create' ? `
      <form class="stack-form" data-action="create-user">
        <div class="row spaced panel-inline-head"><strong>Create User</strong></div>
        <div class="grid-3">
          <label>Username <input name="username" required placeholder="qa.operator" /></label>
          <label>Display Name <input name="displayName" required placeholder="QA Operator" /></label>
          <label>Primary Role
            <select name="role">
              <option value="author">author</option>
              <option value="reviewer">reviewer</option>
              <option value="approver">approver</option>
              <option value="admin">admin</option>
            </select>
          </label>
        </div>
        <div class="grid-3">
          <label>Department <input name="department" placeholder="Quality Assurance" /></label>
          <label>Site <input name="site" placeholder="Plant A" /></label>
          <label>Job Title <input name="jobTitle" placeholder="QA Specialist" /></label>
        </div>
        <div class="grid-2">
          <div>
            <div class="muted">Essential Roles</div>
            <div class="grid-2">${renderRoleCheckboxes('essentialRoles', ['author'])}</div>
          </div>
          <label>Initial Password (leave empty for passwordless)
            <input name="password" type="password" />
          </label>
        </div>
        <label class="check-inline"><input type="checkbox" name="active" checked /> Active account</label>
        <div class="actions">
          <button class="btn primary" type="submit">Create User</button>
          <button class="btn" type="button" data-action="set-user-tab" data-tab="list">Back to list</button>
        </div>
      </form>
    ` : ''}

        ${state.userManagementTab === 'edit' ? `
      <form class="stack-form" data-action="update-user">
        <div class="row spaced panel-inline-head"><strong>Edit User</strong></div>
        <label>User
          <select name="userId" data-action="set-user-edit-target">
            ${userSelectOptions || '<option value="">No user</option>'}
          </select>
        </label>
        ${current ? `
          <div class="grid-3">
            <label>Display Name <input name="displayName" value="${esc(current.displayName || '')}" /></label>
            <label>Department <input name="department" value="${esc(current.department || '')}" /></label>
            <label>Site <input name="site" value="${esc(current.site || '')}" /></label>
          </div>
          <div class="grid-3">
            <label>Job Title <input name="jobTitle" value="${esc(current.jobTitle || '')}" /></label>
            <label>Primary Role
              <select name="role">
                <option value="author" ${current.role === 'author' ? 'selected' : ''}>author</option>
                <option value="reviewer" ${current.role === 'reviewer' ? 'selected' : ''}>reviewer</option>
                <option value="approver" ${current.role === 'approver' ? 'selected' : ''}>approver</option>
                <option value="admin" ${current.role === 'admin' ? 'selected' : ''}>admin</option>
              </select>
            </label>
            <label>Reset Password
              <input name="password" type="password" />
            </label>
          </div>
          <div>
            <div class="muted">Essential Roles</div>
            <div class="grid-2">${renderRoleCheckboxes('essentialRoles', current.essentialRoles || [])}</div>
          </div>
          <label class="check-inline"><input type="checkbox" name="active" ${current.active ? 'checked' : ''} /> Active account</label>
          <div class="actions">
            <button class="btn primary" type="submit">Save User</button>
            <button class="btn" type="button" data-action="set-user-tab" data-tab="list">Back to list</button>
          </div>
        ` : '<div class="muted">No user selected.</div>'}
      </form>
    ` : ''}
      </div>
    </section>
  `;
}

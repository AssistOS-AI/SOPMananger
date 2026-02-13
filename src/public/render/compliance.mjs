export function renderTraining({ state, esc, fmtDate }) {
  const canSignoff = ['admin', 'reviewer', 'approver'].includes(state.session?.role);
  const options = [
    '<option value="all">All SOPs</option>',
    ...state.sops.map((item) => `<option value="${esc(item.id)}" ${state.trainingFilterSopId === item.id ? 'selected' : ''}>${esc(item.code)} - ${esc(item.title)}</option>`),
  ].join('');

  const statusOptions = [
    ['all', 'All statuses'],
    ['assigned', 'assigned'],
    ['in_progress', 'in_progress'],
    ['overdue', 'overdue'],
    ['completed', 'completed'],
  ]
    .map(([value, label]) => `<option value="${value}" ${state.trainingFilterStatus === value ? 'selected' : ''}>${label}</option>`)
    .join('');

  const summary = state.trainingOverview?.summary || {
    total: 0,
    assigned: 0,
    in_progress: 0,
    overdue: 0,
    completed: 0,
    signoffPending: 0,
    completionRate: 0,
  };

  const rows = state.trainingTasks
    .map((task) => {
      const canSelfManage = state.session?.role === 'admin' || task.userId === state.session?.id;
      return `
        <tr>
          <td>${esc(task.sopCode || task.sopId)}</td>
          <td>${esc(task.username || task.userId)}</td>
          <td>${esc(task.role || '-')}</td>
          <td>${fmtDate(task.dueAt)}</td>
          <td>${fmtDate(task.readAcknowledgedAt)}</td>
          <td>${task.quiz?.latestScore == null ? '-' : `${esc(task.quiz.latestScore)} / ${esc(task.quiz.passScore)}`}</td>
          <td>${fmtDate(task.trainerSignoffAt)}</td>
          <td><span class="status-dot ${esc(task.status || '')}"></span><span class="badge ${esc(task.status || '')}">${esc(task.status || '-')}</span></td>
          <td>
            <div class="actions">
              ${canSelfManage ? `<button class="btn" data-action="training-mark-read" data-task-id="${esc(task.id)}">Read Ack</button>` : ''}
              ${canSelfManage ? `<button class="btn" data-action="training-submit-quiz-prompt" data-task-id="${esc(task.id)}">Submit Quiz</button>` : ''}
              ${canSignoff ? `<button class="btn" data-action="training-signoff" data-task-id="${esc(task.id)}">Sign-off</button>` : ''}
              ${!canSelfManage && !canSignoff ? '<span class="muted">No actions</span>' : ''}
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    <section class="card">
      <div class="card-head"><h3>GxP Training Overview</h3></div>
      <div class="card-body compact">
        <div class="stat-grid training-overview-grid">
          <article class="stat static"><span class="muted">Total</span><strong>${esc(summary.total)}</strong></article>
          <article class="stat static"><span class="muted">Assigned</span><strong>${esc(summary.assigned)}</strong></article>
          <article class="stat static"><span class="muted">In Progress</span><strong>${esc(summary.in_progress)}</strong></article>
          <article class="stat static"><span class="muted">Overdue</span><strong>${esc(summary.overdue)}</strong></article>
          <article class="stat static"><span class="muted">Completed</span><strong>${esc(summary.completed)}</strong></article>
        </div>
        <div class="message">
          Completion rate: <strong>${esc(summary.completionRate)}%</strong>.
          Pending trainer sign-off: <strong>${esc(summary.signoffPending)}</strong>.
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>Training Matrix</h3></div>
      <div class="card-body compact grid-3 filter-inline">
        <label>SOP Filter
          <select data-action="set-training-filter">${options}</select>
        </label>
        <label>Status Filter
          <select data-action="set-training-status-filter">${statusOptions}</select>
        </label>
        <div class="actions">
          <button class="btn" data-action="apply-training-filter">Apply Filter</button>
          <button class="btn" data-action="refresh-training">Refresh</button>
        </div>
      </div>
      <div class="card-body table-wrap">
        <table>
          <thead><tr><th>SOP</th><th>User</th><th>Primary Role</th><th>Due</th><th>Read Ack</th><th>Quiz</th><th>Sign-off</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="9">No tasks found.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

export function renderAudit({ state, esc, fmtDate, userLabelById, sopLabelById, actionLabel }) {
  const options = [
    '<option value="all">All Entities</option>',
    ...state.sops.map((item) => `<option value="${esc(item.id)}" ${state.auditFilterEntityId === item.id ? 'selected' : ''}>${esc(item.code)} - ${esc(item.title)}</option>`),
  ].join('');

  const rows = state.auditEvents
    .map((event) => `
      <tr>
        <td>${fmtDate(event.timestamp)}</td>
        <td><span title="${esc(event.action)}">${esc(actionLabel(event.action))}</span></td>
        <td>${esc(event.entityType)}</td>
        <td>${event.entityType === 'sop' ? esc(sopLabelById(event.entityId)) : esc(event.entityId)}</td>
        <td>${esc(userLabelById(event.actorId))}</td>
      </tr>
    `)
    .join('');

  return `
    <section class="card">
      <div class="card-head"><h3>Audit Timeline</h3></div>
      <div class="card-body">
        <div class="filter-inline grid-3">
          <label>Entity Filter
            <select data-action="set-audit-filter">${options}</select>
          </label>
          <div class="actions">
            <button class="btn" data-action="apply-audit-filter">Apply Filter</button>
            <button class="btn" data-action="refresh-audit">Refresh Events</button>
          </div>
          <div class="actions">
            <button class="btn warn" data-action="verify-audit">Verify Chain</button>
          </div>
        </div>
        ${state.auditVerify ? `<div class="message ${state.auditVerify.ok ? '' : 'error'}">Audit chain: ${state.auditVerify.ok ? 'OK' : 'FAILED'} ${state.auditVerify.reason ? `- ${esc(state.auditVerify.reason)}` : ''}</div>` : ''}
      </div>
      <div class="card-body table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Action</th><th>Type</th><th>Entity</th><th>Actor</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5">No events.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

export function renderSettings({ state, esc }) {
  const enabled = Boolean(state.session?.passwordEnabled);
  const profile = state.settings?.regulatoryProfile || {
    profileName: '',
    regulations: [],
    nationalInstitutions: [],
    internalPolicies: [],
    assuranceChecks: [],
    trainingPolicy: {
      dueDays: 30,
      quizPassScore: 80,
      requiresTrainerSignoff: true,
      retrainingOnMajorRevision: true,
    },
  };
  const sopCodePolicy = state.settings?.sopCodePolicy || {
    pattern: 'SOP-{AREA}-{YYYY}-{SEQ4}',
    nextSequence: 1,
  };
  const checkItems = (state.assuranceCheckCatalog || [])
    .map((item) => `
      <label class="check-inline">
        <input type="checkbox" name="assuranceCheck" value="${esc(item.id)}" ${profile.assuranceChecks?.includes(item.id) ? 'checked' : ''} />
        ${esc(item.label)}
      </label>
    `)
    .join('');

  const tabs = [
    ['regulatory', 'Regulatory Profile'],
    ['codes', 'SOP Code Policy'],
    ['security', 'Account Security'],
  ]
    .map(([tab, label]) => `<button class="tab-btn ${state.settingsTab === tab ? 'active' : ''}" type="button" data-action="set-settings-tab" data-tab="${tab}">${label}</button>`)
    .join('');

  let panelHtml = '';

  if (state.settingsTab === 'regulatory') {
    panelHtml = state.session.role !== 'admin'
      ? `
        <div class="message">Only admin can modify regulatory profile. Current profile: <strong>${esc(profile.profileName || '-')}</strong>.</div>
      `
      : `
        <form class="stack-form" data-action="update-regulatory-profile">
          <div class="grid-2">
            <label>Profile Name <input name="profileName" value="${esc(profile.profileName || '')}" /></label>
            <label>Training Due Days <input name="dueDays" type="number" min="1" max="365" value="${esc(profile.trainingPolicy?.dueDays || 30)}" /></label>
          </div>
          <div class="grid-2">
            <label>Regulations (one per line)
              <textarea name="regulations">${esc((profile.regulations || []).join('\n'))}</textarea>
            </label>
            <label>National Institutions (one per line)
              <textarea name="nationalInstitutions">${esc((profile.nationalInstitutions || []).join('\n'))}</textarea>
            </label>
          </div>
          <label>Internal Policies (one per line)
            <textarea name="internalPolicies">${esc((profile.internalPolicies || []).join('\n'))}</textarea>
          </label>
          <div class="grid-3">${checkItems}</div>
          <div class="grid-3">
            <label>Quiz Pass Score
              <input name="quizPassScore" type="number" min="0" max="100" value="${esc(profile.trainingPolicy?.quizPassScore || 80)}" />
            </label>
            <label class="check-inline"><input type="checkbox" name="requiresTrainerSignoff" ${profile.trainingPolicy?.requiresTrainerSignoff ? 'checked' : ''} /> Requires trainer sign-off</label>
            <label class="check-inline"><input type="checkbox" name="retrainingOnMajorRevision" ${profile.trainingPolicy?.retrainingOnMajorRevision ? 'checked' : ''} /> Retraining on major revision</label>
          </div>
          <div class="actions">
            <button class="btn primary" type="submit">Save Regulatory Profile</button>
          </div>
        </form>
      `;
  } else if (state.settingsTab === 'codes') {
    panelHtml = state.session.role !== 'admin'
      ? `
        <div class="message">Only admin can modify SOP code allocation policy.</div>
        <div class="muted">Pattern: <strong>${esc(sopCodePolicy.pattern)}</strong></div>
        <div class="muted">Next sequence: <strong>${esc(sopCodePolicy.nextSequence)}</strong></div>
      `
      : `
        <form class="stack-form" data-action="update-sop-code-policy">
          <div class="grid-2">
            <label>Pattern
              <input name="pattern" value="${esc(sopCodePolicy.pattern)}" />
            </label>
            <label>Next Sequence
              <input name="nextSequence" type="number" min="1" value="${esc(sopCodePolicy.nextSequence)}" />
            </label>
          </div>
          <div class="muted">Supported tokens: <code>{AREA}</code>, <code>{YYYY}</code>, <code>{YY}</code>, <code>{SEQ}</code>, <code>{SEQ4}</code>.</div>
          <div class="actions">
            <button class="btn primary" type="submit">Save SOP Code Policy</button>
          </div>
        </form>
      `;
  } else {
    panelHtml = `
      <form class="stack-form" data-action="update-password">
        <div class="message">Password protection is <strong>${enabled ? 'ENABLED' : 'DISABLED'}</strong>. Empty new password disables it.</div>
        <div class="grid-2">
          <label>Current Password
            <input name="currentPassword" type="password" />
          </label>
          <label>New Password
            <input name="newPassword" type="password" />
          </label>
        </div>
        <div class="actions">
          <button class="btn primary" type="submit">Save Password Settings</button>
        </div>
      </form>
    `;
  }

  return `
    <section class="card">
      <div class="card-head"><h3>Settings</h3></div>
      <div class="card-body compact">
        <div class="studio-tabs">${tabs}</div>
      </div>
      <div class="card-body">
        ${panelHtml}
      </div>
    </section>
  `;
}

function renderTemplateCheckboxGroup(name, values = [], selected = [], esc) {
  return values
    .map((value) => `
      <label class="check-inline"><input type="checkbox" name="${name}" value="${esc(value)}" ${selected.includes(value) ? 'checked' : ''} /> ${esc(value)}</label>
    `)
    .join('');
}

function renderMarkdownBasic(text, esc) {
  const safe = esc(text || '');
  return safe
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br />');
}

export function renderAssistant({ state, esc, fmtBytes, fmtDate, icon }) {
  const contextOptions = [
    `<option value="" ${state.currentSopId ? '' : 'selected'}>No SOP context</option>`,
    ...state.sops.map((item) => `<option value="${esc(item.id)}" ${state.currentSopId === item.id ? 'selected' : ''}>${esc(item.code)} - ${esc(item.title)}</option>`),
  ].join('');

  const pendingAttachments = state.chatPendingAttachments
    .map((item) => `
      <div class="chat-attachment-chip">
        <span class="chat-attachment-name">${esc(item.name)}</span>
        <span class="chat-attachment-meta">${esc(fmtBytes(item.size))}${item.warning ? ` · ${esc(item.warning)}` : ''}</span>
        <button class="btn danger" type="button" data-action="remove-chat-attachment" data-attachment-id="${esc(item.id)}">Remove</button>
      </div>
    `)
    .join('');

  const history = state.chatMessages
    .map((entry) => {
      const attachments = Array.isArray(entry.attachments) ? entry.attachments : [];
      const attachmentRows = attachments
        .map((item) => `<li>${esc(item.name)} <span class="muted">(${esc(fmtBytes(item.size || 0))})</span></li>`)
        .join('');
      const actions = Array.isArray(entry.actions) && entry.actions.length
        ? `<div class="chat-actions-row">${entry.actions.map((item) => `<span class="badge">${esc(item)}</span>`).join('')}</div>`
        : '';
      const streaming = entry.streaming ? '<div class="muted">Processing...</div>' : '';
      return `
        <li class="chat-line ${entry.role === 'assistant' ? 'assistant' : 'user'}">
          <article class="chat-bubble">
            <div class="chat-meta">
              <strong>${esc(entry.role === 'assistant' ? 'SOP Agent' : 'You')}</strong>
              <span class="muted">${fmtDate(entry.at)}</span>
            </div>
            <div class="chat-text">${renderMarkdownBasic(entry.text || '', esc)}</div>
            ${attachmentRows ? `<ul class="chat-attachment-list">${attachmentRows}</ul>` : ''}
            ${streaming}
            ${actions}
          </article>
        </li>
      `;
    })
    .join('');

  return `
    <section class="card chat-shell-card">
      <div class="card-head">
        <h3>Agent Chat</h3>
        <div class="muted">Use Tools for quick actions and approval credentials.</div>
      </div>
      <div class="chat-thread-wrap">
        <ul class="chat-thread">${history}</ul>
      </div>
      <form class="chat-composer" id="chat-composer-form" data-action="send-chat-message">
        <input id="chat-file-input" data-action="chat-file-input" type="file" multiple hidden />
        <div class="chat-input-row">
          <textarea name="message" data-action="chat-message-input" placeholder="Write a command or ask for help..."></textarea>
        </div>
        ${pendingAttachments ? `<div class="chat-pending-list">${pendingAttachments}</div>` : ''}
        <div class="chat-composer-actions">
          <div class="chat-actions-left">
            <label>Current SOP
              <select data-action="set-chat-context">${contextOptions}</select>
            </label>
            ${state.currentSopId
    ? `<span class="badge">${esc(state.sops.find((item) => item.id === state.currentSopId)?.code || state.currentSopId)}</span>`
    : '<span class="badge">No SOP context</span>'}
            <button class="btn" type="button" data-action="open-chat-file-picker">${icon('attach', 'btn-icon')}<span>Attach Files</span></button>
            <div class="chat-tools-wrap">
              <button class="btn" type="button" data-action="toggle-chat-tools">${icon('tools', 'btn-icon')}<span>${state.chatToolsOpen ? 'Hide Tools' : 'Tools'}</span></button>
              ${state.chatToolsOpen
    ? `
                <div class="chat-tools-popup">
                  <div class="chat-tools-head"><strong>Chat Tools</strong></div>
                  <div class="chat-tools-quick">
                    <button class="btn" type="button" data-action="chat-quick" data-command="list sops">${icon('sops', 'btn-icon')}<span>List SOPs</span></button>
                    <button class="btn" type="button" data-action="chat-quick" data-command="run assurance scan">${icon('automation', 'btn-icon')}<span>Run Assurance</span></button>
                    <button class="btn" type="button" data-action="chat-quick" data-command="training status">${icon('training', 'btn-icon')}<span>Training Status</span></button>
                  </div>
                  <label>Approval Password
                    <input name="password" type="password" />
                  </label>
                </div>
              `
    : ''}
            </div>
          </div>
          <button class="btn primary" type="submit">${icon('send', 'btn-icon')}<span>Send</span></button>
        </div>
      </form>
    </section>
  `;
}

export function renderAutomation({ state, esc, fmtDate }) {
  const profile = state.settings?.regulatoryProfile || null;
  const canManageJobs = state.session?.role === 'admin';
  const checkOptions = (state.assuranceCheckCatalog || [])
    .map((item) => `<label class="check-inline"><input type="checkbox" name="check" value="${esc(item.id)}" ${profile?.assuranceChecks?.includes(item.id) ? 'checked' : ''} /> ${esc(item.label)}</label>`)
    .join('');

  const jobRows = state.automationJobs
    .map((job) => `
      <tr>
        <td>${esc(job.title)}</td>
        <td>${esc(job.type)}</td>
        <td>${esc(String(job.intervalMinutes))} min</td>
        <td>${job.enabled ? 'Enabled' : 'Disabled'}</td>
        <td>${fmtDate(job.nextRunAt)}</td>
        <td>${fmtDate(job.lastRunAt)}</td>
        <td class="actions">${canManageJobs
    ? `
            <button class="btn" data-action="run-automation-job" data-job-id="${esc(job.id)}">Run Now</button>
            <button class="btn" data-action="toggle-automation-job" data-job-id="${esc(job.id)}" data-enabled="${job.enabled ? '1' : '0'}">${job.enabled ? 'Disable' : 'Enable'}</button>
          `
    : '<span class="muted">Admin only</span>'}</td>
      </tr>
    `)
    .join('');

  const tabs = [
    ['assurance', 'Assurance Scan'],
    ['generation', 'Draft Generation'],
    ['jobs', 'Scheduled Jobs'],
  ]
    .map(([tab, label]) => `<button class="tab-btn ${state.automationTab === tab ? 'active' : ''}" type="button" data-action="set-automation-tab" data-tab="${tab}">${label}</button>`)
    .join('');

  let panelHtml = '';
  if (state.automationTab === 'assurance') {
    panelHtml = `
      <form class="stack-form" data-action="run-assurance-task">
        <div class="row spaced panel-inline-head"><strong>Run Assurance Scan</strong></div>
        <div class="grid-3">
          <label>Title <input name="title" value="Comprehensive SOP Assurance Scan" /></label>
          <label>Scope
            <select name="scope">
              <option value="all">All SOPs</option>
              <option value="selected">Selected SOP only</option>
            </select>
          </label>
          <label>Target SOP
            <select name="selectedSopId">
              <option value="">Use selected context</option>
              ${state.sops.map((item) => `<option value="${esc(item.id)}">${esc(item.code)} - ${esc(item.title)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="grid-2">
          <label>High-Level Specification <textarea name="highLevelSpec"></textarea></label>
          <label>Hard Constraints <textarea name="constraints"></textarea></label>
        </div>
        <label>General Narrative Context <textarea name="narrative"></textarea></label>
        <div class="grid-2">${checkOptions}</div>
        <div class="actions">
          <button class="btn primary" type="submit">Start Assurance Task</button>
          <a class="btn" href="#/tasks">Open Task Monitor</a>
        </div>
      </form>
    `;
  } else if (state.automationTab === 'generation') {
    panelHtml = `
      <form class="stack-form" data-action="run-generation-task">
        <div class="row spaced panel-inline-head"><strong>Structured Draft Generation</strong></div>
        <div class="grid-2">
          <label>Draft Title <input name="title" value="Generated SOP Draft" /></label>
          <label>Create SOP from result
            <select name="autoCreate">
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </label>
        </div>
        <div class="grid-2">
          <label>High-Level Specification <textarea name="highLevelSpec"></textarea></label>
          <label>Hard Constraints <textarea name="constraints"></textarea></label>
        </div>
        <label>General Narrative Context <textarea name="narrative"></textarea></label>
        <div class="actions">
          <button class="btn primary" type="submit">Start Generation Task</button>
        </div>
      </form>
    `;
  } else {
    panelHtml = `
      <div class="row spaced panel-inline-head">
        <strong>Scheduled Jobs (Cron-like)</strong>
        <div class="actions">
          ${canManageJobs ? `<button class="btn primary" type="button" data-action="toggle-automation-create-job">${state.automationShowCreateJob ? 'Close Create Job' : '+ Create Job'}</button>` : ''}
          <button class="btn" type="button" data-action="refresh-automation-jobs">Refresh Jobs</button>
        </div>
      </div>
      ${canManageJobs && state.automationShowCreateJob
    ? `
      <form class="stack-form" data-action="create-automation-job">
        <div class="grid-3">
          <label>Title <input name="title" required value="Nightly assurance sweep" /></label>
          <label>Type
            <select name="type">
              <option value="assurance-scan">assurance-scan</option>
              <option value="sop-draft-generation">sop-draft-generation</option>
            </select>
          </label>
          <label>Interval (minutes) <input name="intervalMinutes" type="number" min="5" value="1440" /></label>
        </div>
        <div class="grid-2">
          <label>High-Level Specification <textarea name="highLevelSpec"></textarea></label>
          <label>Hard Constraints <textarea name="constraints"></textarea></label>
        </div>
        <label>General Narrative Context <textarea name="narrative"></textarea></label>
        <div class="actions">
          <button class="btn primary" type="submit">Create Scheduled Job</button>
        </div>
      </form>
      `
    : `
      <div class="message">${canManageJobs ? 'Use + Create Job to define a scheduled run.' : 'Only admin can create or edit scheduled jobs. Existing schedules remain visible below.'}</div>
      `}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Title</th><th>Type</th><th>Interval</th><th>Status</th><th>Next Run</th><th>Last Run</th><th>Actions</th></tr></thead>
          <tbody>${jobRows || '<tr><td colspan="7">No scheduled jobs configured.</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }

  return `
    <section class="card">
      <div class="card-head"><h3>Automation & Scans</h3></div>
      <div class="card-body compact">
        <div class="message">
          Active regulatory profile:
          <strong>${esc(profile?.profileName || 'Not configured')}</strong>.
          Update profile in <a href="#/settings">Settings</a>.
        </div>
        <div class="studio-tabs">${tabs}</div>
      </div>
      <div class="card-body">
        ${panelHtml}
      </div>
    </section>
  `;
}

export function renderTasks({ state, esc, fmtDate }) {
  const taskType = state.taskFilterType || 'all';
  const visible = state.tasks.filter((task) => (taskType === 'all' ? true : task.type === taskType));
  const rows = visible
    .map((task) => `
      <tr>
        <td>${esc(task.id)}</td>
        <td>${esc(task.type)}</td>
        <td>${esc(task.status)}</td>
        <td>${esc(String(task.progress || 0))}%</td>
        <td>${fmtDate(task.createdAt)}</td>
        <td><button class="btn" data-action="select-task" data-task-id="${esc(task.id)}">Open</button></td>
      </tr>
    `)
    .join('');

  const task = state.selectedTask;
  const progressValue = Math.max(0, Math.min(100, Number(task?.progress || 0)));
  const detail = task
    ? `
      <div class="task-detail-grid">
        <article class="section-card"><strong>Task ID</strong><div class="muted">${esc(task.id)}</div></article>
        <article class="section-card"><strong>Type</strong><div class="muted">${esc(task.type)}</div></article>
        <article class="section-card"><strong>Status</strong><div><span class="badge ${esc(task.status || '')}">${esc(task.status || '-')}</span></div></article>
        <article class="section-card">
          <strong>Progress</strong>
          <progress class="progress-meter" value="${esc(progressValue)}" max="100"></progress>
          <div class="muted">${esc(progressValue)}%</div>
        </article>
      </div>
      <div class="grid-2">
        <article class="section-card">
          <strong>Timing</strong>
          <div class="muted">Created: ${fmtDate(task.createdAt)}</div>
          <div class="muted">Started: ${fmtDate(task.startedAt)}</div>
          <div class="muted">Finished: ${fmtDate(task.finishedAt)}</div>
        </article>
        <article class="section-card">
          <strong>Result Summary</strong>
          <div class="muted">${esc(task.error ? `Error: ${task.error}` : 'No error')}</div>
          <div class="muted">${task.result ? 'Result payload available.' : 'No result payload.'}</div>
          ${task.type === 'sop-draft-generation' && task.result ? '<button class="btn primary" type="button" data-action="create-sop-from-task-draft">Create SOP from this draft</button>' : ''}
        </article>
      </div>
      <details>
        <summary>Raw Task JSON</summary>
        <pre>${esc(JSON.stringify(task, null, 2))}</pre>
      </details>
    `
    : '<div class="muted">Select a task to inspect details.</div>';

  return `
    <section class="card">
      <div class="card-head"><h3>Task Monitor</h3></div>
      <div class="card-body compact filter-inline grid-2">
        <label>Task Type
          <select data-action="set-task-type-filter">
            <option value="all" ${taskType === 'all' ? 'selected' : ''}>All task types</option>
            <option value="assurance-scan" ${taskType === 'assurance-scan' ? 'selected' : ''}>assurance-scan</option>
            <option value="sop-draft-generation" ${taskType === 'sop-draft-generation' ? 'selected' : ''}>sop-draft-generation</option>
          </select>
        </label>
        <div class="actions">
          <button class="btn" data-action="refresh-tasks">Refresh</button>
        </div>
      </div>
      <div class="card-body table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Progress</th><th>Created</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6">No tasks.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="card-body">${detail}</div>
    </section>
  `;
}

export function renderTemplates({ state, esc }) {
  const items = state.templates
    .map((template) => {
      const areas = Array.isArray(template.areas) && template.areas.length
        ? template.areas.join(', ')
        : 'General';
      const roles = Array.isArray(template.targetRoles) && template.targetRoles.length
        ? template.targetRoles.join(', ')
        : '-';
      const sections = Array.isArray(template.sections) ? template.sections : [];
      return `
        <li class="list-item">
          <div class="row spaced">
            <strong>${esc(template.title)}</strong>
            <span class="badge">${esc(template.id)}</span>
          </div>
          <div class="muted">${esc(template.description || 'No description')}</div>
          <div class="muted">Areas: ${esc(areas)} | Suggested roles: ${esc(roles)}</div>
          <details>
            <summary>Section guidance (${sections.length})</summary>
            <ul>
              ${sections.map((section) => `<li><strong>${esc(section.title || section.id)}</strong>: ${esc(section.guidance || '')}</li>`).join('')}
            </ul>
          </details>
        </li>
      `;
    })
    .join('');

  const commonAreas = state.pharmaAreas.length ? state.pharmaAreas : [
    'Quality Assurance',
    'Quality Control',
    'QC Laboratory',
    'Manufacturing',
    'Production',
    'Warehouse',
    'Regulatory Affairs',
    'Validation',
    'General',
  ];
  const roleValues = ['author', 'reviewer', 'approver'];

  return `
    <section class="card">
      <div class="card-head">
        <h3>Templates Library</h3>
        <button class="btn" type="button" data-action="refresh-templates">Refresh</button>
      </div>
      <div class="card-body">
        <div class="message">Templates define default structure and writing constraints when creating SOPs.</div>
        <ul class="list-plain">${items || '<li class="muted">No templates available.</li>'}</ul>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>Create Template</h3></div>
      <form class="card-body" data-action="create-template">
        <div class="grid-2">
          <label>Template ID<input name="id" placeholder="tpl-site-cleaning" /></label>
          <label>Title<input name="title" required /></label>
        </div>
        <label>Description<textarea name="description"></textarea></label>
        <div>
          <div class="muted">Applicable Areas</div>
          <div class="grid-3">${renderTemplateCheckboxGroup('areas', commonAreas, ['General'], esc)}</div>
        </div>
        <div>
          <div class="muted">Suggested Target Roles</div>
          <div class="grid-3">${renderTemplateCheckboxGroup('targetRoles', roleValues, ['author', 'reviewer'], esc)}</div>
        </div>
        <label>Section Guidance JSON
          <textarea name="sectionsJson" placeholder='[{"id":"purpose","title":"Purpose","guidance":"..."}]'></textarea>
        </label>
        <div class="actions">
          <button class="btn" type="button" data-action="load-template-section-defaults">Load defaults</button>
        </div>
        <div class="actions">
          <button class="btn primary" type="submit">Create Template</button>
        </div>
      </form>
    </section>
  `;
}

function defaultChatMessages() {
  return [
    {
      role: 'assistant',
      text: 'Assistant ready. Try: "list sops", "open SOP-QA-001", "validate", "submit to review because ...".',
      at: new Date().toISOString(),
      attachments: [],
      actions: [],
    },
  ];
}

const state = {
  session: null,
  csrfToken: '',
  busy: false,
  message: null,

  route: {
    view: 'dashboard',
    params: {},
    query: {},
  },

  sops: [],
  currentSopId: null,
  currentSop: null,
  workingDoc: null,
  versions: [],
  reviewComments: [],
  validation: null,
  impact: null,
  sopTrainingTasks: [],
  sopEditTab: 'content',

  interviewSummary: null,
  processExtraction: null,

  templates: [],
  selectedTemplateId: '',
  pharmaAreas: [],

  users: [],
  userEditTargetId: null,

  settings: null,
  assuranceCheckCatalog: [],

  automationJobs: [],

  trainingTasks: [],
  trainingFilterSopId: 'all',
  trainingFilterStatus: 'all',
  trainingOverview: null,

  auditEvents: [],
  auditFilterEntityId: 'all',
  auditVerify: null,

  tasks: [],
  taskFilterType: 'all',
  selectedTaskId: null,
  selectedTask: null,

  chatMessages: defaultChatMessages(),
  chatPendingAttachments: [],
  chatHistoryLoadedForUserId: null,
  chatToolsOpen: false,
};

const app = document.querySelector('#app');
let messageTimeoutId = null;
let chatHistoryPersistTimerId = null;
let chatStreamTimerId = null;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function deepClone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function fmtDate(value) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function fmtBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value < 1024) {
    return `${Math.max(0, Math.round(value))} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function setMessage(text, type = 'info') {
  if (messageTimeoutId) {
    clearTimeout(messageTimeoutId);
    messageTimeoutId = null;
  }
  state.message = text ? { text, type } : null;
  render();
  if (state.message && type === 'info') {
    messageTimeoutId = setTimeout(() => {
      state.message = null;
      render();
    }, 2600);
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error(`Failed to read "${file.name}".`));
    reader.readAsText(file);
  });
}

function isProbablyTextFile(file) {
  const mime = String(file?.type || '').toLowerCase();
  if (mime.startsWith('text/')) {
    return true;
  }
  if (mime.includes('json') || mime.includes('xml') || mime.includes('yaml')) {
    return true;
  }
  const name = String(file?.name || '').toLowerCase();
  return /\.(txt|md|csv|json|xml|yaml|yml|html|htm|log|mjs|js|css)$/i.test(name);
}

async function createChatAttachment(file) {
  const maxBytes = 1024 * 1024;
  const attachment = {
    id: `att-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: file.name,
    mimeType: file.type || '',
    size: Number(file.size || 0),
    content: '',
    status: 'ready',
    warning: '',
  };

  if (!isProbablyTextFile(file)) {
    attachment.status = 'metadata-only';
    attachment.warning = 'Binary file attached as metadata only.';
    return attachment;
  }
  if (attachment.size > maxBytes) {
    attachment.status = 'metadata-only';
    attachment.warning = 'File too large for inline content. Metadata sent only.';
    return attachment;
  }

  const text = await readFileAsText(file);
  attachment.content = text.slice(0, 30000);
  if (text.length > attachment.content.length) {
    attachment.warning = 'Attachment content truncated for request safety.';
  }
  return attachment;
}

function requestChatAutoScroll() {
  if (state.route.view !== 'assistant') {
    return;
  }
  requestAnimationFrame(() => {
    const wrap = app.querySelector('.chat-thread-wrap');
    if (wrap) {
      wrap.scrollTop = wrap.scrollHeight;
    }
  });
}

function normalizeChatEntry(entry = {}) {
  const attachments = Array.isArray(entry.attachments)
    ? entry.attachments.slice(0, 6).map((item, index) => ({
      id: String(item?.id || `a-${index + 1}`).slice(0, 64),
      name: String(item?.name || 'attachment').slice(0, 160),
      mimeType: String(item?.mimeType || '').slice(0, 120),
      size: Number(item?.size || 0),
    }))
    : [];
  const actions = Array.isArray(entry.actions)
    ? entry.actions.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
    : [];
  return {
    role: entry.role === 'assistant' ? 'assistant' : 'user',
    text: String(entry.text || '').slice(0, 12000),
    at: String(entry.at || '').trim() || new Date().toISOString(),
    attachments,
    actions,
  };
}

function queueChatHistoryPersist() {
  if (!state.session?.id) {
    return;
  }
  if (chatHistoryPersistTimerId) {
    clearTimeout(chatHistoryPersistTimerId);
  }
  chatHistoryPersistTimerId = setTimeout(async () => {
    chatHistoryPersistTimerId = null;
    try {
      const items = state.chatMessages.slice(-200).map((entry) => normalizeChatEntry(entry));
      await api('/api/chat/history', {
        method: 'POST',
        body: { items },
      });
    } catch {
      // non-blocking persistence
    }
  }, 260);
}

async function loadChatHistory() {
  if (!state.session?.id) {
    state.chatMessages = defaultChatMessages();
    state.chatHistoryLoadedForUserId = null;
    return;
  }
  if (state.chatHistoryLoadedForUserId === state.session.id) {
    return;
  }
  try {
    const data = await api('/api/chat/history');
    const items = Array.isArray(data?.items) ? data.items.map((item) => normalizeChatEntry(item)) : [];
    state.chatMessages = items.length ? items : defaultChatMessages();
  } catch {
    state.chatMessages = defaultChatMessages();
  }
  state.chatHistoryLoadedForUserId = state.session.id;
}

function startAssistantProgressStream(messageEntry) {
  stopAssistantProgressStream();
  messageEntry.streaming = true;
  messageEntry.text = 'Working on your request...';
  render();
  requestChatAutoScroll();
}

function stopAssistantProgressStream() {
  if (chatStreamTimerId) {
    clearInterval(chatStreamTimerId);
    chatStreamTimerId = null;
  }
}

async function streamAssistantFinalText(messageEntry, finalText) {
  stopAssistantProgressStream();
  messageEntry.text = String(finalText || '');
  messageEntry.streaming = false;
  render();
  requestChatAutoScroll();
}

async function api(path, { method = 'GET', body = null, signal = null } = {}) {
  const headers = {};
  const isWrite = !['GET', 'HEAD'].includes(method.toUpperCase());

  let payload;
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  if (isWrite && state.csrfToken) {
    headers['x-csrf-token'] = state.csrfToken;
  }

  const response = await fetch(path, {
    method,
    headers,
    body: payload,
    credentials: 'include',
    signal,
  });

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const errorText = typeof data === 'string'
      ? data
      : data?.error || 'Request failed.';
    throw new Error(errorText);
  }

  return data;
}

async function withBusy(work) {
  if (state.busy) {
    return;
  }
  state.busy = true;
  render();
  try {
    await work();
  } finally {
    state.busy = false;
    render();
  }
}

function parseHashRoute() {
  const raw = (window.location.hash || '#/dashboard').slice(1);
  const [rawPath = '/dashboard', rawQuery = ''] = raw.split('?');
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const segments = path.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(rawQuery).entries());

  if (segments.length === 0 || segments[0] === 'dashboard') {
    return { view: 'dashboard', params: {}, query };
  }
  if (segments[0] === 'sops' && segments[1] === 'create') {
    return { view: 'sopCreate', params: {}, query };
  }
  if (segments[0] === 'sops' && segments[1] && segments[2] === 'edit') {
    return { view: 'sopEdit', params: { sopId: segments[1] }, query };
  }
  if (segments[0] === 'sops') {
    return { view: 'sopList', params: {}, query };
  }
  if (segments[0] === 'assistant') {
    return { view: 'assistant', params: {}, query };
  }
  if (segments[0] === 'assurance' || segments[0] === 'automation') {
    return { view: 'automation', params: {}, query };
  }
  if (segments[0] === 'tasks') {
    return { view: 'tasks', params: {}, query };
  }
  if (segments[0] === 'templates' || segments[0] === 'blocks') {
    return { view: 'templates', params: {}, query };
  }
  if (segments[0] === 'training') {
    return { view: 'training', params: {}, query };
  }
  if (segments[0] === 'users') {
    return { view: 'users', params: {}, query };
  }
  if (segments[0] === 'audit') {
    return { view: 'audit', params: {}, query };
  }
  if (segments[0] === 'settings') {
    return { view: 'settings', params: {}, query };
  }
  return { view: 'dashboard', params: {}, query };
}

function navigate(path) {
  const normalized = path.startsWith('#') ? path : `#${path}`;
  if (window.location.hash === normalized) {
    void syncRoute();
    return;
  }
  window.location.hash = normalized;
}

function navLink(path, label) {
  const targetHash = `#${path}`;
  const active = window.location.hash === targetHash
    || (path !== '/dashboard' && window.location.hash.startsWith(`${targetHash}?`));
  return `<a class="nav-btn ${active ? 'active' : ''}" href="${targetHash}">${esc(label)}</a>`;
}

async function loadSession() {
  try {
    const session = await api('/api/auth/session');
    state.session = session.user;
    state.csrfToken = session.csrfToken;
  } catch {
    state.session = null;
    state.csrfToken = '';
    if (chatHistoryPersistTimerId) {
      clearTimeout(chatHistoryPersistTimerId);
      chatHistoryPersistTimerId = null;
    }
    stopAssistantProgressStream();
    state.chatMessages = defaultChatMessages();
    state.chatPendingAttachments = [];
    state.chatHistoryLoadedForUserId = null;
    state.chatToolsOpen = false;
  }
}

async function loadSops() {
  const data = await api('/api/sops');
  state.sops = data.items || [];
}

async function loadSopContext(sopId) {
  if (!sopId) {
    state.currentSopId = null;
    state.currentSop = null;
    state.workingDoc = null;
    state.versions = [];
    state.reviewComments = [];
    state.validation = null;
    state.impact = null;
    state.sopTrainingTasks = [];
    return;
  }

  const [sop, versions, comments, impact, training] = await Promise.all([
    api(`/api/sops/${encodeURIComponent(sopId)}`),
    api(`/api/sops/${encodeURIComponent(sopId)}/versions`),
    api(`/api/sops/${encodeURIComponent(sopId)}/review/comments`),
    api(`/api/sops/${encodeURIComponent(sopId)}/impact`),
    api(`/api/sops/${encodeURIComponent(sopId)}/training`),
  ]);

  state.currentSopId = sopId;
  state.currentSop = sop;
  state.versions = versions.items || [];
  state.reviewComments = comments.items || [];
  state.impact = impact;
  state.sopTrainingTasks = training.items || [];
  state.workingDoc = deepClone(sop.latestVersion?.document || {
    title: sop.meta.title,
    sections: [],
    processModel: { steps: [] },
    references: [],
    trainingTaskIds: [],
  });
}

async function loadTemplates() {
  const data = await api('/api/templates');
  state.templates = data.items || [];
  if (!state.selectedTemplateId && state.templates.length) {
    state.selectedTemplateId = state.templates[0].id;
  }
}

async function loadUsers() {
  const data = await api('/api/users');
  state.users = data.items || [];
  if (!state.userEditTargetId && state.users.length) {
    state.userEditTargetId = state.users[0].id;
  }
}

async function loadSettings() {
  const data = await api('/api/settings');
  state.settings = data;
  state.assuranceCheckCatalog = data.assuranceCheckCatalog || [];
  state.pharmaAreas = Array.isArray(data.pharmaAreas) ? data.pharmaAreas : [];
}

async function loadAutomationJobs() {
  const data = await api('/api/automation/jobs');
  state.automationJobs = data.items || [];
}

async function loadTraining({ sopId = null, status = null } = {}) {
  const params = new URLSearchParams();
  if (sopId) {
    params.set('sopId', sopId);
  }
  if (status) {
    params.set('status', status);
  }
  const qs = params.toString();
  const data = await api(`/api/training/tasks${qs ? `?${qs}` : ''}`);
  state.trainingTasks = data.items || [];
}

async function loadTrainingOverview({ sopId = null } = {}) {
  const qs = sopId ? `?sopId=${encodeURIComponent(sopId)}` : '';
  state.trainingOverview = await api(`/api/training/overview${qs}`);
}

async function loadAuditEvents({ entityId = null } = {}) {
  const params = new URLSearchParams();
  params.set('limit', '200');
  if (entityId) {
    params.set('entityId', entityId);
  }
  const data = await api(`/api/audit/events?${params.toString()}`);
  state.auditEvents = data.items || [];
}

async function refreshAuditVerification() {
  try {
    state.auditVerify = await api('/api/audit/verify');
  } catch (error) {
    state.auditVerify = {
      ok: false,
      reason: error.message,
    };
  }
}

async function loadTasks({ type = null } = {}) {
  const params = new URLSearchParams();
  params.set('limit', '120');
  if (type) {
    params.set('type', type);
  }
  const data = await api(`/api/tasks?${params.toString()}`);
  state.tasks = data.items || [];
}

async function loadTask(taskId) {
  if (!taskId) {
    state.selectedTaskId = null;
    state.selectedTask = null;
    return null;
  }
  const task = await api(`/api/tasks/${encodeURIComponent(taskId)}`);
  state.selectedTaskId = taskId;
  state.selectedTask = task;
  return task;
}

async function pollTask(taskId, { attempts = 80, intervalMs = 1200 } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    const task = await loadTask(taskId);
    await loadTasks();
    if (task && ['completed', 'failed'].includes(task.status)) {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return state.selectedTask;
}

function checkedValues(form, name) {
  return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map((item) => item.value);
}

function collectEditorDocument() {
  const root = document.querySelector('[data-editor-form]');
  if (!root || !state.currentSop) {
    return;
  }
  const title = root.querySelector('[name="document-title"]')?.value?.trim() || state.currentSop.meta.title;

  const sections = [];
  root.querySelectorAll('[data-section-card]').forEach((card) => {
    const id = card.querySelector('[data-field="section-id"]')?.value?.trim() || '';
    const sectionTitle = card.querySelector('[data-field="section-title"]')?.value?.trim() || '';
    const text = card.querySelector('[data-field="section-text"]')?.value || '';
    if (!id && !sectionTitle && !text.trim()) {
      return;
    }
    sections.push({
      id: id || sectionTitle || `section-${sections.length + 1}`,
      title: sectionTitle || id || `Section ${sections.length + 1}`,
      text,
    });
  });

  const steps = [];
  root.querySelectorAll('[data-step-row]').forEach((row, index) => {
    const name = row.querySelector('[data-field="step-name"]')?.value?.trim() || '';
    const role = row.querySelector('[data-field="step-role"]')?.value?.trim() || '';
    const inputs = row.querySelector('[data-field="step-inputs"]')?.value || '';
    const outputs = row.querySelector('[data-field="step-outputs"]')?.value || '';
    const records = row.querySelector('[data-field="step-records"]')?.value || '';
    const exceptions = row.querySelector('[data-field="step-exceptions"]')?.value || '';
    if (!name && !role && !inputs && !outputs && !records && !exceptions) {
      return;
    }
    steps.push({
      order: index + 1,
      name,
      role,
      inputs: inputs.split(',').map((value) => value.trim()).filter(Boolean),
      outputs: outputs.split(',').map((value) => value.trim()).filter(Boolean),
      records: records.split(',').map((value) => value.trim()).filter(Boolean),
      exceptions: exceptions.split(',').map((value) => value.trim()).filter(Boolean),
    });
  });

  const references = [];
  root.querySelectorAll('[data-ref-row]').forEach((row) => {
    const label = row.querySelector('[data-field="ref-label"]')?.value?.trim() || '';
    const type = row.querySelector('[data-field="ref-type"]')?.value?.trim() || '';
    const target = row.querySelector('[data-field="ref-target"]')?.value?.trim() || '';
    if (!label && !type && !target) {
      return;
    }
    references.push({ label, type, target });
  });

  state.workingDoc = {
    ...state.workingDoc,
    title,
    sections,
    processModel: { steps },
    references,
  };
}

function sopLabelById(sopId) {
  const found = state.sops.find((item) => item.id === sopId);
  if (!found) {
    return sopId;
  }
  return `${found.code} - ${found.title}`;
}

function renderMessage() {
  if (!state.message) {
    return '';
  }
  return `<div class="message ${state.message.type === 'error' ? 'error' : ''}">${esc(state.message.text)}</div>`;
}

function renderLogin() {
  return `
    <main class="login-page">
      <div class="login-card">
        <div class="login-head">
          <h1>SOP Manager Studio</h1>
          <p>Governed SOP authoring with quality, review, release, and audit workflows.</p>
        </div>
        <form class="login-body" data-action="login">
          ${renderMessage()}
          <label>Username
            <input name="username" required autocomplete="username" />
          </label>
          <label>Password (optional)
            <input name="password" type="password" autocomplete="current-password" />
          </label>
          <button class="btn primary" type="submit">Sign In</button>
          <div class="muted">Default accounts: admin, author, reviewer, approver.</div>
        </form>
      </div>
    </main>
  `;
}

function renderShell(contentHtml) {
  const nav = [
    navLink('/dashboard', 'Dashboard'),
    navLink('/sops', 'SOP List'),
    navLink('/sops/create', 'Create SOP'),
    navLink('/users', 'User Management'),
    navLink('/training', 'Training Compliance'),
    navLink('/automation', 'Automation & Scans'),
    navLink('/tasks', 'Task Monitor'),
    navLink('/assistant', 'Agent Chat'),
    navLink('/templates', 'Templates'),
    navLink('/audit', 'Audit'),
    navLink('/settings', 'Settings'),
  ].join('');

  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <h2>SOP Manager</h2>
          <p>Structured Governance Workspace</p>
        </div>
        <nav class="nav-list">${nav}</nav>
        <div class="side-footer">
          <div>Signed in as <strong>${esc(state.session.username)}</strong></div>
          <div>Role: ${esc(state.session.role)}</div>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="top-left">
            <span class="pill">${esc(state.session.role)}</span>
            <span class="status-line">Signed in as <strong>${esc(state.session.displayName || state.session.username)}</strong></span>
          </div>
          <div class="actions">
            <button class="btn" data-action="clear-message">Clear Message</button>
            <button class="btn danger" data-action="logout">Logout</button>
          </div>
        </header>
        <section class="content">
          ${renderMessage()}
          ${contentHtml}
        </section>
      </main>
    </div>
  `;
}

function getStatusCounts() {
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

function renderDashboard() {
  const counts = getStatusCounts();
  const overview = state.trainingOverview?.summary || {
    total: 0,
    overdue: 0,
    completionRate: 0,
  };
  const cards = [
    { status: 'all', label: 'Total SOPs', value: counts.total },
    { status: 'Draft', label: 'Draft', value: counts.Draft },
    { status: 'In Review', label: 'In Review', value: counts['In Review'] },
    { status: 'Approved', label: 'Approved', value: counts.Approved },
    { status: 'Effective', label: 'Effective', value: counts.Effective },
    { status: 'Superseded', label: 'Superseded', value: counts.Superseded },
  ]
    .map((item) => `
      <button class="stat" data-action="open-sop-list-status" data-status="${esc(item.status)}">
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
        <div class="actions">
          <a class="btn primary" href="#/sops/create">Create New SOP</a>
          <a class="btn" href="#/sops">Open SOP List</a>
          <a class="btn" href="#/tasks">Open Task Monitor</a>
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
        <a class="btn" href="#/training">Open Training Compliance</a>
        <a class="btn" href="#/automation">Open Automation & Scans</a>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h3>Recently Updated SOPs</h3></div>
      <div class="card-body table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Title</th><th>Status</th><th>Updated</th><th></th></tr></thead>
          <tbody>${recentRows || '<tr><td colspan="5">No SOPs available.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderSopList() {
  const statusFilter = state.route.query.status || 'all';
  const searchFilter = (state.route.query.search || '').toLowerCase();
  const filtered = state.sops.filter((item) => {
    const statusOk = statusFilter === 'all' ? true : item.status === statusFilter;
    const searchOk = searchFilter
      ? (`${item.code} ${item.title} ${item.area || ''}`.toLowerCase().includes(searchFilter))
      : true;
    return statusOk && searchOk;
  });

  const rows = filtered
    .map((item) => `
      <tr>
        <td>${esc(item.code)}</td>
        <td>${esc(item.title)}</td>
        <td>${esc(item.area || '-')}</td>
        <td><span class="badge">${esc(item.status)}</span></td>
        <td>${fmtDate(item.updatedAt)}</td>
        <td>
          <div class="actions">
            <button class="btn" data-action="open-sop-edit" data-sop-id="${esc(item.id)}">Edit</button>
          </div>
        </td>
      </tr>
    `)
    .join('');

  return `
    <section class="card">
      <div class="card-head"><h3>SOP List</h3></div>
      <form class="card-body grid-3" data-action="apply-sop-list-filter">
        <label>Status
          <select name="status">
            <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All</option>
            <option value="Draft" ${statusFilter === 'Draft' ? 'selected' : ''}>Draft</option>
            <option value="In Review" ${statusFilter === 'In Review' ? 'selected' : ''}>In Review</option>
            <option value="Approved" ${statusFilter === 'Approved' ? 'selected' : ''}>Approved</option>
            <option value="Effective" ${statusFilter === 'Effective' ? 'selected' : ''}>Effective</option>
            <option value="Superseded" ${statusFilter === 'Superseded' ? 'selected' : ''}>Superseded</option>
          </select>
        </label>
        <label>Search
          <input name="search" value="${esc(state.route.query.search || '')}" placeholder="code, title, area" />
        </label>
        <div class="actions">
          <button class="btn primary" type="submit">Apply</button>
          <a class="btn" href="#/sops/create">Create SOP</a>
        </div>
      </form>
    </section>
    <section class="card">
      <div class="card-head"><h3>Results (${filtered.length})</h3></div>
      <div class="card-body table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Title</th><th>Area</th><th>Status</th><th>Updated</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6">No SOPs found for current filter.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRoleCheckboxes(fieldName, selected) {
  const roles = ['author', 'reviewer', 'approver', 'trainer'];
  return roles
    .map((role) => `<label><input type="checkbox" name="${fieldName}" value="${role}" ${selected.includes(role) ? 'checked' : ''} /> ${role}</label>`)
    .join('');
}

function renderUserManagement() {
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

  return `
    <section class="card">
      <div class="card-head">
        <h3>User Management</h3>
        <button class="btn" data-action="refresh-users">Refresh</button>
      </div>
      <div class="card-body table-wrap">
        <table>
          <thead><tr><th>Username</th><th>Display Name</th><th>Department</th><th>Primary Role</th><th>Essential Roles</th><th>Status</th><th>Password Mode</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8">No users found.</td></tr>'}</tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>Create User</h3></div>
      <form class="card-body" data-action="create-user">
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
          <label>Initial Password (optional, empty = passwordless)
            <input name="password" type="password" />
          </label>
        </div>
        <label><input type="checkbox" name="active" checked /> Active account</label>
        <div class="actions">
          <button class="btn primary" type="submit">Create User</button>
        </div>
      </form>
    </section>

    <section class="card">
      <div class="card-head"><h3>Edit User</h3></div>
      <form class="card-body" data-action="update-user">
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
            <label>Reset Password (optional)
              <input name="password" type="password" />
            </label>
          </div>
          <div>
            <div class="muted">Essential Roles</div>
            <div class="grid-2">${renderRoleCheckboxes('essentialRoles', current.essentialRoles || [])}</div>
          </div>
          <label><input type="checkbox" name="active" ${current.active ? 'checked' : ''} /> Active account</label>
          <div class="actions">
            <button class="btn primary" type="submit">Save User</button>
          </div>
        ` : '<div class="muted">No user selected.</div>'}
      </form>
    </section>
  `;
}

function renderSopCreate() {
  const areaOptions = (state.pharmaAreas.length ? state.pharmaAreas : [
    'Quality Assurance',
    'Quality Control',
    'QC Laboratory',
    'Manufacturing',
    'Production',
    'Warehouse',
    'Supply Chain',
    'Validation',
    'Regulatory Affairs',
    'General',
  ])
    .map((area) => `<option value="${esc(area)}">${esc(area)}</option>`)
    .join('');

  const templateOptions = [
    '<option value="">No template</option>',
    ...state.templates.map((template) => `<option value="${esc(template.id)}" ${state.selectedTemplateId === template.id ? 'selected' : ''}>${esc(template.title)}</option>`),
  ].join('');

  const targetRoleOptions = ['author', 'reviewer', 'approver', 'trainer'];

  return `
    <section class="card">
      <div class="card-head"><h3>Create SOP</h3></div>
      <form class="card-body" data-action="create-sop">
        <div class="grid-2">
          <label>Title <input name="title" required /></label>
          <label>Area
            <select name="area">${areaOptions}</select>
          </label>
        </div>
        <label>Template
          <select name="templateId" data-action="set-template">${templateOptions}</select>
        </label>
        <label>Template Guidance Notes (optional)
          <textarea name="templateGuidanceNote" placeholder="Extra constraints for selected template"></textarea>
        </label>
        <div>
          <div class="muted">Target Roles Affected</div>
          <div class="grid-3">
            ${targetRoleOptions.map((role) => `<label><input type="checkbox" name="targetRoles" value="${role}" ${['author', 'reviewer'].includes(role) ? 'checked' : ''} /> ${role}</label>`).join('')}
          </div>
        </div>
        <div class="muted">SOP code is generated automatically from Settings pattern.</div>
        <div class="actions">
          <button class="btn primary" type="submit">Create and Open Editor</button>
          <a class="btn" href="#/sops">Back to SOP List</a>
        </div>
      </form>
    </section>
  `;
}

function renderEditTabs() {
  const tabs = [
    ['content', 'Content'],
    ['quality', 'Quality'],
    ['review', 'Review'],
    ['release', 'Release'],
    ['links', 'Links'],
  ];
  return tabs
    .map(([id, label]) => `
      <button class="tab-btn ${state.sopEditTab === id ? 'active' : ''}" data-action="switch-edit-tab" data-tab="${id}">
        ${esc(label)}
      </button>
    `)
    .join('');
}

function renderEditorContentTab() {
  const doc = state.workingDoc || { title: '', sections: [], processModel: { steps: [] }, references: [] };
  const sections = (doc.sections || [])
    .map((section, index) => `
      <div class="section-card" data-section-card data-index="${index}">
        <div class="row spaced">
          <strong>Section ${index + 1}</strong>
          <button class="btn danger" type="button" data-action="remove-editor-section" data-index="${index}">Remove</button>
        </div>
        <div class="grid-2">
          <label>ID <input data-field="section-id" value="${esc(section.id || '')}" /></label>
          <label>Title <input data-field="section-title" value="${esc(section.title || '')}" /></label>
        </div>
        <label>Text <textarea data-field="section-text">${esc(section.text || '')}</textarea></label>
      </div>
    `)
    .join('');

  const steps = (doc.processModel?.steps || [])
    .map((step, index) => `
      <tr data-step-row data-index="${index}">
        <td>${index + 1}</td>
        <td><input data-field="step-name" value="${esc(step.name || '')}" /></td>
        <td><input data-field="step-role" value="${esc(step.role || '')}" /></td>
        <td><input data-field="step-inputs" value="${esc((step.inputs || []).join(', '))}" /></td>
        <td><input data-field="step-outputs" value="${esc((step.outputs || []).join(', '))}" /></td>
        <td><input data-field="step-records" value="${esc((step.records || []).join(', '))}" /></td>
        <td><input data-field="step-exceptions" value="${esc((step.exceptions || []).join(', '))}" /></td>
        <td><button class="btn danger" type="button" data-action="remove-editor-step" data-index="${index}">X</button></td>
      </tr>
    `)
    .join('');

  const refs = (doc.references || [])
    .map((ref, index) => `
      <tr data-ref-row data-index="${index}">
        <td><input data-field="ref-label" value="${esc(ref.label || '')}" /></td>
        <td><input data-field="ref-type" value="${esc(ref.type || '')}" /></td>
        <td><input data-field="ref-target" value="${esc(ref.target || '')}" /></td>
        <td><button class="btn danger" type="button" data-action="remove-editor-ref" data-index="${index}">X</button></td>
      </tr>
    `)
    .join('');

  return `
    <form class="card" data-action="save-sop-version" data-editor-form>
      <div class="card-head">
        <h3>Editor</h3>
        <div class="actions">
          <button class="btn" type="button" data-action="add-editor-section">Add Section</button>
          <button class="btn" type="button" data-action="add-editor-step">Add Step</button>
          <button class="btn" type="button" data-action="add-editor-ref">Add Reference</button>
        </div>
      </div>
      <div class="card-body">
        <label>Document Title <input name="document-title" value="${esc(doc.title || '')}" /></label>
        <label>Change Summary <input name="changeSummary" placeholder="Summarize this version update" /></label>

        <div class="row"><strong>Sections</strong></div>
        ${sections || '<div class="muted">No sections defined.</div>'}

        <div class="row"><strong>Process Steps</strong></div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>Name</th><th>Role</th><th>Inputs</th><th>Outputs</th><th>Records</th><th>Exceptions</th><th></th></tr>
            </thead>
            <tbody>${steps || '<tr><td colspan="8">No process steps.</td></tr>'}</tbody>
          </table>
        </div>

        <div class="row"><strong>References</strong></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Label</th><th>Type</th><th>Target</th><th></th></tr></thead>
            <tbody>${refs || '<tr><td colspan="4">No references.</td></tr>'}</tbody>
          </table>
        </div>

        <div class="actions">
          <button class="btn primary" type="submit">Save Version</button>
          <button class="btn" type="button" data-action="run-current-validation">Run Validation</button>
        </div>
      </div>
    </form>

    <section class="card">
      <div class="card-head"><h3>AI Helpers</h3></div>
      <div class="card-body">
        <form data-action="generate-interview-summary">
          <div class="grid-3">
            <label>Purpose <input name="q_purpose" /></label>
            <label>Scope <input name="q_scope" /></label>
            <label>Roles <input name="q_roles" /></label>
          </div>
          <label>Procedure Notes <textarea name="q_steps"></textarea></label>
          <div class="actions">
            <button class="btn" type="submit">Generate Interview Summary</button>
            <button class="btn" type="button" data-action="apply-interview-summary">Apply Summary</button>
          </div>
        </form>
        <form data-action="extract-process-model">
          <label>Process Narrative
            <textarea name="rawText"></textarea>
          </label>
          <div class="actions">
            <button class="btn" type="submit">Extract Process Model</button>
            <button class="btn" type="button" data-action="apply-process-extraction">Apply Process Model</button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderEditQualityTab() {
  const summary = state.validation?.summary
    ? `
      <div class="stat-grid">
        <div class="stat"><span class="muted">Blocking</span><strong>${esc(state.validation.summary.blocking)}</strong></div>
        <div class="stat"><span class="muted">Warning</span><strong>${esc(state.validation.summary.warning)}</strong></div>
        <div class="stat"><span class="muted">Suggestion</span><strong>${esc(state.validation.summary.suggestion)}</strong></div>
      </div>
    `
    : '<div class="muted">No validation run yet.</div>';

  const findings = (state.validation?.findings || [])
    .map((item) => `
      <li class="list-item">
        <div class="row spaced">
          <strong>${esc(item.ruleId)}</strong>
          <span class="badge ${esc(item.severity)}">${esc(item.severity)}</span>
        </div>
        <div>${esc(item.message)}</div>
        <div class="muted">Path: ${esc(item.sectionPath || '-')}</div>
        <div class="muted">Suggestion: ${esc(item.suggestion || '-')}</div>
      </li>
    `)
    .join('');

  return `
    <section class="card">
      <div class="card-head">
        <h3>Quality Validation</h3>
        <button class="btn primary" data-action="run-current-validation">Run Validation</button>
      </div>
      <div class="card-body">
        ${summary}
        <ul class="list-plain">${findings || '<li class="muted">No findings.</li>'}</ul>
      </div>
    </section>
  `;
}

function renderEditReviewTab() {
  const comments = state.reviewComments
    .map((comment) => `
      <li class="list-item">
        <div class="row spaced">
          <strong>${esc(comment.sectionPath || 'General')}</strong>
          <span class="badge">${esc(comment.status)}</span>
        </div>
        <div>${esc(comment.text)}</div>
        <div class="muted">${esc(comment.authorId)} · ${fmtDate(comment.createdAt)}</div>
        ${comment.status === 'open'
          ? `<button class="btn" data-action="resolve-comment" data-comment-id="${esc(comment.id)}">Resolve</button>`
          : `<div class="muted">Resolved by ${esc(comment.resolvedBy || '-')} at ${fmtDate(comment.resolvedAt)}</div>`}
      </li>
    `)
    .join('');

  return `
    <section class="card">
      <div class="card-head"><h3>Review Collaboration</h3></div>
      <form class="card-body" data-action="add-review-comment">
        <div class="grid-2">
          <label>Section Path <input name="sectionPath" placeholder="sections.2" /></label>
          <label>Comment <input name="text" required /></label>
        </div>
        <div class="actions">
          <button class="btn primary" type="submit">Add Comment</button>
          <button class="btn" type="button" data-action="transition-review">Submit to In Review</button>
        </div>
      </form>
    </section>
    <section class="card">
      <div class="card-head"><h3>Comments</h3></div>
      <div class="card-body">
        <ul class="list-plain">${comments || '<li class="muted">No comments yet.</li>'}</ul>
      </div>
    </section>
  `;
}

function renderEditReleaseTab() {
  return `
    <section class="card">
      <div class="card-head"><h3>Release Workflow</h3></div>
      <form class="card-body" data-action="transition-workflow">
        <div class="muted">Current Status: <strong>${esc(state.currentSop?.meta?.status || '-')}</strong></div>
        <div class="grid-3">
          <label>Next Status
            <select name="toStatus">
              <option value="Draft">Draft</option>
              <option value="In Review">In Review</option>
              <option value="Approved">Approved</option>
              <option value="Superseded">Superseded</option>
            </select>
          </label>
          <label>Reason <input name="reason" placeholder="Transition reason" /></label>
          <label>Password (for approval when enabled) <input name="password" type="password" /></label>
        </div>
        <div class="actions">
          <button class="btn primary" type="submit">Apply Transition</button>
          <button class="btn" type="button" data-action="publish-sop">Publish Effective</button>
        </div>
      </form>
    </section>
  `;
}

function renderEditLinksTab() {
  const impact = state.impact || { references: [], linkedBlocks: [], reverseReferences: [] };
  const references = impact.references
    .map((item) => `<li>${esc(item.label || '-')} -> ${esc(item.target || '-')} <span class="muted">(${esc(item.type || '-')})</span></li>`)
    .join('');
  const reusableLinks = impact.linkedBlocks
    .map((item) => `<li>${esc(item.sectionId)} uses reusable source ${esc(item.blockId)}</li>`)
    .join('');
  const reverse = impact.reverseReferences
    .map((item) => `<li>${esc(item.title)} (${esc(item.status)})</li>`)
    .join('');
  const training = state.sopTrainingTasks
    .map((item) => `<li>${esc(item.username || item.userId)} - ${esc(item.status)}</li>`)
    .join('');

  const finalPreview = (state.currentSop?.latestVersion?.document?.sections || [])
    .map((section) => `
      <article class="section-card">
        <strong>${esc(section.title || section.id || 'Section')}</strong>
        <div class="muted">${esc((section.text || '').slice(0, 260))}${(section.text || '').length > 260 ? '...' : ''}</div>
      </article>
    `)
    .join('');

  return `
    <section class="card">
      <div class="card-head"><h3>Impact and Training</h3></div>
      <div class="card-body grid-3">
        <div><strong>Outgoing References</strong><ul>${references || '<li class="muted">None</li>'}</ul></div>
        <div><strong>Reusable Section Links</strong><ul>${reusableLinks || '<li class="muted">None</li>'}</ul></div>
        <div><strong>Reverse References</strong><ul>${reverse || '<li class="muted">None</li>'}</ul></div>
      </div>
      <div class="card-body">
        <strong>Training Tasks</strong>
        <ul>${training || '<li class="muted">No tasks generated.</li>'}</ul>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h3>Final SOP View</h3></div>
      <div class="card-body">
        <div class="message">
          ${esc(state.currentSop?.meta?.code || '-')} · ${esc(state.currentSop?.meta?.title || '-')} ·
          Status: ${esc(state.currentSop?.meta?.status || '-')} · Version: ${esc(state.currentSop?.meta?.currentVersionId || '-')}
        </div>
        <div class="actions">
          <a class="btn primary" target="_blank" href="/api/sops/${encodeURIComponent(state.currentSopId)}/export/html">Open Print-Ready HTML</a>
        </div>
        <div class="grid-2">${finalPreview || '<div class="muted">No section content.</div>'}</div>
      </div>
    </section>
  `;
}

function renderSopEdit() {
  if (!state.currentSop) {
    return `
      <section class="card">
        <div class="card-head"><h3>SOP Editor</h3></div>
        <div class="card-body">
          <div class="muted">Select an SOP from the list first.</div>
          <a class="btn" href="#/sops">Go to SOP List</a>
        </div>
      </section>
    `;
  }

  let tabHtml = renderEditContentTab();
  if (state.sopEditTab === 'quality') {
    tabHtml = renderEditQualityTab();
  } else if (state.sopEditTab === 'review') {
    tabHtml = renderEditReviewTab();
  } else if (state.sopEditTab === 'release') {
    tabHtml = renderEditReleaseTab();
  } else if (state.sopEditTab === 'links') {
    tabHtml = renderEditLinksTab();
  }

  return `
    <section class="card">
      <div class="card-head">
        <h3>${esc(state.currentSop.meta.code)} - ${esc(state.currentSop.meta.title)}</h3>
        <div class="actions">
          <span class="badge">${esc(state.currentSop.meta.status)}</span>
          <a class="btn" href="#/sops">Back to SOP List</a>
        </div>
      </div>
      <div class="card-body">
        <div class="grid-3">
          <div><strong>Area</strong><div class="muted">${esc(state.currentSop.meta.area || '-')}</div></div>
          <div><strong>Version</strong><div class="muted">${esc(state.currentSop.meta.currentVersionId || '-')}</div></div>
          <div><strong>Updated</strong><div class="muted">${fmtDate(state.currentSop.meta.updatedAt)}</div></div>
        </div>
        <div class="studio-tabs">${renderEditTabs()}</div>
      </div>
    </section>
    ${tabHtml}
  `;
}

function renderAssistant() {
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
            <div class="chat-text">${esc(entry.text || '')}</div>
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
        <div class="actions">
          <button class="btn" type="button" data-action="chat-quick" data-command="list sops">List SOPs</button>
          <button class="btn" type="button" data-action="chat-quick" data-command="run assurance scan">Run Assurance</button>
          <button class="btn" type="button" data-action="chat-quick" data-command="training status">Training Status</button>
        </div>
      </div>
      <div class="chat-thread-wrap">
        <ul class="chat-thread">${history}</ul>
      </div>
      <form class="chat-composer" id="chat-composer-form" data-action="send-chat-message">
        <input id="chat-file-input" data-action="chat-file-input" type="file" multiple hidden />
        <div class="chat-input-row">
          <textarea name="message" placeholder="Write a command or ask for help..."></textarea>
        </div>
        ${pendingAttachments ? `<div class="chat-pending-list">${pendingAttachments}</div>` : ''}
        ${state.chatToolsOpen
    ? `
          <div class="chat-tools-panel">
            <div class="grid-2">
              <label>Current SOP
                <select data-action="set-chat-context">${contextOptions}</select>
              </label>
              <label>Password (only for approval e-sign)
                <input name="password" type="password" />
              </label>
            </div>
          </div>
        `
    : ''}
        <div class="chat-composer-actions">
          <div class="actions">
            <button class="btn" type="button" data-action="open-chat-file-picker">Attach Files</button>
            <button class="btn" type="button" data-action="toggle-chat-tools">${state.chatToolsOpen ? 'Hide Tools' : 'Tools'}</button>
          </div>
          <button class="btn primary" type="submit">Send</button>
        </div>
      </form>
    </section>
  `;
}

function renderAutomation() {
  const profile = state.settings?.regulatoryProfile || null;
  const canManageJobs = state.session?.role === 'admin';
  const checkOptions = (state.assuranceCheckCatalog || [])
    .map((item) => `<label><input type="checkbox" name="check" value="${esc(item.id)}" ${profile?.assuranceChecks?.includes(item.id) ? 'checked' : ''} /> ${esc(item.label)}</label>`)
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

  return `
    <section class="card">
      <div class="card-head"><h3>Automation & Scans</h3></div>
      <div class="card-body">
        <div class="message">
          Active regulatory profile:
          <strong>${esc(profile?.profileName || 'Not configured')}</strong>.
          Update profile in <a href="#/settings">Settings</a>.
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>Run Assurance Scan (Manual)</h3></div>
      <form class="card-body" data-action="run-assurance-task">
        <div class="grid-3">
          <label>Title <input name="title" value="Comprehensive SOP Assurance Scan" /></label>
          <label>Scope
            <select name="scope">
              <option value="all">All SOPs</option>
              <option value="selected">Selected SOP only</option>
            </select>
          </label>
          <label>Target SOP (optional)
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
    </section>

    <section class="card">
      <div class="card-head"><h3>Structured Draft Generation</h3></div>
      <form class="card-body" data-action="run-generation-task">
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
    </section>

    <section class="card">
      <div class="card-head"><h3>Scheduled Jobs (Cron-like)</h3></div>
      ${canManageJobs
    ? `
      <form class="card-body" data-action="create-automation-job">
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
          <button class="btn" type="button" data-action="refresh-automation-jobs">Refresh Jobs</button>
        </div>
      </form>
      `
    : `
      <div class="card-body">
        <div class="message">Only admin can create or edit scheduled jobs. Existing schedules remain visible below.</div>
        <div class="actions"><button class="btn" type="button" data-action="refresh-automation-jobs">Refresh Jobs</button></div>
      </div>
      `}
      <div class="card-body table-wrap">
        <table>
          <thead><tr><th>Title</th><th>Type</th><th>Interval</th><th>Status</th><th>Next Run</th><th>Last Run</th><th>Actions</th></tr></thead>
          <tbody>${jobRows || '<tr><td colspan="7">No scheduled jobs configured.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderTasks() {
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

  const detail = state.selectedTask
    ? `<pre>${esc(JSON.stringify(state.selectedTask, null, 2))}</pre>`
    : '<div class="muted">Select a task to inspect details.</div>';

  return `
    <section class="card">
      <div class="card-head">
        <h3>Task Monitor</h3>
        <div class="actions">
          <select data-action="set-task-type-filter">
            <option value="all" ${taskType === 'all' ? 'selected' : ''}>All task types</option>
            <option value="assurance-scan" ${taskType === 'assurance-scan' ? 'selected' : ''}>assurance-scan</option>
            <option value="sop-draft-generation" ${taskType === 'sop-draft-generation' ? 'selected' : ''}>sop-draft-generation</option>
          </select>
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

function renderTemplateCheckboxGroup(name, values = [], selected = []) {
  return values
    .map((value) => `
      <label><input type="checkbox" name="${name}" value="${esc(value)}" ${selected.includes(value) ? 'checked' : ''} /> ${esc(value)}</label>
    `)
    .join('');
}

function renderTemplates() {
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
          <label>Template ID (optional)<input name="id" placeholder="tpl-site-cleaning" /></label>
          <label>Title<input name="title" required /></label>
        </div>
        <label>Description<textarea name="description"></textarea></label>
        <div>
          <div class="muted">Applicable Areas</div>
          <div class="grid-3">${renderTemplateCheckboxGroup('areas', commonAreas, ['General'])}</div>
        </div>
        <div>
          <div class="muted">Suggested Target Roles</div>
          <div class="grid-3">${renderTemplateCheckboxGroup('targetRoles', roleValues, ['author', 'reviewer'])}</div>
        </div>
        <label>Section Guidance JSON
          <textarea name="sectionsJson" placeholder='[{"id":"purpose","title":"Purpose","guidance":"..."}]'></textarea>
        </label>
        <div class="actions">
          <button class="btn primary" type="submit">Create Template</button>
        </div>
      </form>
    </section>
  `;
}

function renderTraining() {
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
          <td><span class="badge">${esc(task.status || '-')}</span></td>
          <td>
            <div class="actions">
              ${canSelfManage ? `<button class="btn" data-action="training-mark-read" data-task-id="${esc(task.id)}">Read Ack</button>` : ''}
              ${canSelfManage ? `
                <form data-action="training-submit-quiz">
                  <input type="hidden" name="taskId" value="${esc(task.id)}" />
                  <input name="score" type="number" min="0" max="100" placeholder="score" style="width:90px" />
                  <button class="btn" type="submit">Quiz</button>
                </form>
              ` : ''}
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
      <div class="card-body stat-grid">
        <article class="stat"><span class="muted">Total</span><strong>${esc(summary.total)}</strong></article>
        <article class="stat"><span class="muted">Assigned</span><strong>${esc(summary.assigned)}</strong></article>
        <article class="stat"><span class="muted">In Progress</span><strong>${esc(summary.in_progress)}</strong></article>
        <article class="stat"><span class="muted">Overdue</span><strong>${esc(summary.overdue)}</strong></article>
        <article class="stat"><span class="muted">Completed</span><strong>${esc(summary.completed)}</strong></article>
      </div>
      <div class="card-body">
        <div class="message">
          Completion rate: <strong>${esc(summary.completionRate)}%</strong>.
          Pending trainer sign-off: <strong>${esc(summary.signoffPending)}</strong>.
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>Training Matrix</h3></div>
      <div class="card-body">
        <div class="actions">
          <select data-action="set-training-filter">${options}</select>
          <select data-action="set-training-status-filter">${statusOptions}</select>
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

function renderAudit() {
  const options = [
    '<option value="all">All Entities</option>',
    ...state.sops.map((item) => `<option value="${esc(item.id)}" ${state.auditFilterEntityId === item.id ? 'selected' : ''}>${esc(item.code)} - ${esc(item.title)}</option>`),
  ].join('');

  const rows = state.auditEvents
    .map((event) => `
      <tr>
        <td>${fmtDate(event.timestamp)}</td>
        <td>${esc(event.action)}</td>
        <td>${esc(event.entityType)}</td>
        <td>${esc(event.entityId)}</td>
        <td>${esc(event.actorId)}</td>
      </tr>
    `)
    .join('');

  return `
    <section class="card">
      <div class="card-head"><h3>Audit Timeline</h3></div>
      <div class="card-body">
        <div class="actions">
          <select data-action="set-audit-filter">${options}</select>
          <button class="btn" data-action="apply-audit-filter">Apply Filter</button>
          <button class="btn" data-action="refresh-audit">Refresh Events</button>
          <button class="btn warn" data-action="verify-audit">Verify Chain</button>
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

function renderSettings() {
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
      <label>
        <input type="checkbox" name="assuranceCheck" value="${esc(item.id)}" ${profile.assuranceChecks?.includes(item.id) ? 'checked' : ''} />
        ${esc(item.label)}
      </label>
    `)
    .join('');

  return `
    <section class="card">
      <div class="card-head"><h3>Security Settings</h3></div>
      <form class="card-body" data-action="update-password">
        <div class="message">Password protection is <strong>${enabled ? 'ENABLED' : 'DISABLED'}</strong>. Empty new password disables it.</div>
        <div class="grid-2">
          <label>Current Password ${enabled ? '(required)' : '(optional)'}
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
    </section>

    <section class="card">
      <div class="card-head"><h3>Regulatory Profile</h3></div>
      ${state.session.role !== 'admin'
    ? `
        <div class="card-body">
          <div class="message">Only admin can modify regulatory profile. Current profile: <strong>${esc(profile.profileName || '-')}</strong>.</div>
        </div>
      `
    : `
        <form class="card-body" data-action="update-regulatory-profile">
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
            <label><input type="checkbox" name="requiresTrainerSignoff" ${profile.trainingPolicy?.requiresTrainerSignoff ? 'checked' : ''} /> Requires trainer sign-off</label>
            <label><input type="checkbox" name="retrainingOnMajorRevision" ${profile.trainingPolicy?.retrainingOnMajorRevision ? 'checked' : ''} /> Retraining on major revision</label>
          </div>
          <div class="actions">
            <button class="btn primary" type="submit">Save Regulatory Profile</button>
          </div>
        </form>
      `}
    </section>

    <section class="card">
      <div class="card-head"><h3>SOP Code Policy</h3></div>
      ${state.session.role !== 'admin'
    ? `
        <div class="card-body">
          <div class="message">Only admin can modify SOP code allocation policy.</div>
          <div class="muted">Pattern: <strong>${esc(sopCodePolicy.pattern)}</strong></div>
          <div class="muted">Next sequence: <strong>${esc(sopCodePolicy.nextSequence)}</strong></div>
        </div>
      `
    : `
        <form class="card-body" data-action="update-sop-code-policy">
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
      `}
    </section>
  `;
}

function renderMainView() {
  if (state.route.view === 'dashboard') {
    return renderDashboard();
  }
  if (state.route.view === 'sopList') {
    return renderSopList();
  }
  if (state.route.view === 'sopCreate') {
    return renderSopCreate();
  }
  if (state.route.view === 'sopEdit') {
    return renderSopEdit();
  }
  if (state.route.view === 'assistant') {
    return renderAssistant();
  }
  if (state.route.view === 'automation') {
    return renderAutomation();
  }
  if (state.route.view === 'tasks') {
    return renderTasks();
  }
  if (state.route.view === 'templates') {
    return renderTemplates();
  }
  if (state.route.view === 'training') {
    return renderTraining();
  }
  if (state.route.view === 'users') {
    return renderUserManagement();
  }
  if (state.route.view === 'audit') {
    return renderAudit();
  }
  if (state.route.view === 'settings') {
    return renderSettings();
  }
  return renderDashboard();
}

function render() {
  if (!state.session) {
    app.innerHTML = renderLogin();
    return;
  }
  app.innerHTML = renderShell(renderMainView());
  requestChatAutoScroll();
}

async function syncRoute() {
  state.route = parseHashRoute();
  if (!state.session) {
    render();
    return;
  }

  if (!state.sops.length) {
    await loadSops();
  }
  if (state.route.view === 'assistant') {
    await loadChatHistory();
  }

  if (state.route.view === 'sopEdit') {
    const sopId = state.route.params.sopId;
    if (!sopId) {
      navigate('/sops');
      return;
    }
    if (state.currentSopId !== sopId) {
      await loadSopContext(sopId);
      state.sopEditTab = 'content';
    }
  } else if (state.route.view === 'dashboard') {
    await loadTrainingOverview();
  } else if (state.route.view === 'users') {
    if (state.session.role === 'admin') {
      await loadUsers();
    }
  } else if (state.route.view === 'settings') {
    await loadSettings();
  } else if (state.route.view === 'automation') {
    await Promise.all([
      loadSettings(),
      loadAutomationJobs(),
      loadTasks(),
    ]);
    if (state.selectedTaskId) {
      await loadTask(state.selectedTaskId);
    }
  } else if (state.route.view === 'templates' || state.route.view === 'sopCreate') {
    await Promise.all([
      loadTemplates(),
      loadSettings(),
    ]);
  } else if (state.route.view === 'training') {
    const sopId = state.trainingFilterSopId !== 'all' ? state.trainingFilterSopId : null;
    const status = state.trainingFilterStatus !== 'all' ? state.trainingFilterStatus : null;
    await Promise.all([
      loadTraining({ sopId, status }),
      loadTrainingOverview({ sopId }),
    ]);
  } else if (state.route.view === 'audit') {
    const entityId = state.auditFilterEntityId !== 'all' ? state.auditFilterEntityId : null;
    await loadAuditEvents({ entityId });
  } else if (state.route.view === 'tasks') {
    const type = state.taskFilterType !== 'all' ? state.taskFilterType : null;
    await loadTasks({ type });
    if (state.selectedTaskId) {
      await loadTask(state.selectedTaskId);
    }
  }

  render();
}

async function bootstrap() {
  await loadSession();
  if (state.session) {
    await Promise.all([
      loadSops(),
      loadChatHistory(),
    ]);
  }
  await syncRoute();
}

async function handleSubmit(event) {
  const form = event.target.closest('form[data-action]');
  if (!form) {
    return;
  }
  event.preventDefault();
  const action = form.dataset.action;

  await withBusy(async () => {
    try {
      if (action === 'apply-sop-list-filter') {
        return;
      }

      if (action === 'login') {
        const username = form.querySelector('[name="username"]').value.trim();
        const password = form.querySelector('[name="password"]').value;
        const result = await api('/api/auth/login', {
          method: 'POST',
          body: { username, password },
        });
        state.session = result.user;
        state.csrfToken = result.csrfToken;
        await Promise.all([
          loadSops(),
          loadChatHistory(),
        ]);
        navigate('/dashboard');
        return;
      }

      if (action === 'create-sop') {
        const title = form.querySelector('[name="title"]').value.trim();
        const area = form.querySelector('[name="area"]').value.trim();
        const targetRoles = checkedValues(form, 'targetRoles');
        const templateId = form.querySelector('[name="templateId"]').value.trim();
        const templateGuidanceNote = form.querySelector('[name="templateGuidanceNote"]').value.trim();
        const created = await api('/api/sops', {
          method: 'POST',
          body: {
            title,
            area,
            targetRoles,
            templateId: templateId || undefined,
            templateGuidanceNote,
          },
        });
        await loadSops();
        navigate(`/sops/${created.meta.id}/edit`);
        setMessage(`Created SOP ${created.meta.code}.`);
        return;
      }

      if (action === 'create-user') {
        const username = form.querySelector('[name="username"]').value.trim();
        const displayName = form.querySelector('[name="displayName"]').value.trim();
        const role = form.querySelector('[name="role"]').value;
        const department = form.querySelector('[name="department"]').value.trim();
        const site = form.querySelector('[name="site"]').value.trim();
        const jobTitle = form.querySelector('[name="jobTitle"]').value.trim();
        const essentialRoles = checkedValues(form, 'essentialRoles');
        const password = form.querySelector('[name="password"]').value;
        const active = form.querySelector('[name="active"]').checked;
        const created = await api('/api/users', {
          method: 'POST',
          body: {
            username,
            displayName,
            role,
            department,
            site,
            jobTitle,
            essentialRoles,
            password,
            active,
          },
        });
        await loadUsers();
        state.userEditTargetId = created.id;
        form.reset();
        setMessage(`User ${created.username} created.`);
        return;
      }

      if (action === 'update-user') {
        const userId = form.querySelector('[name="userId"]').value;
        if (!userId) {
          throw new Error('Select a user first.');
        }
        const body = {
          displayName: form.querySelector('[name="displayName"]')?.value?.trim() || '',
          department: form.querySelector('[name="department"]')?.value?.trim() || '',
          site: form.querySelector('[name="site"]')?.value?.trim() || '',
          jobTitle: form.querySelector('[name="jobTitle"]')?.value?.trim() || '',
          role: form.querySelector('[name="role"]')?.value || 'author',
          essentialRoles: checkedValues(form, 'essentialRoles'),
          active: form.querySelector('[name="active"]')?.checked ?? true,
        };
        const password = form.querySelector('[name="password"]')?.value ?? '';
        if (password.length > 0) {
          body.password = password;
        }
        await api(`/api/users/${encodeURIComponent(userId)}`, {
          method: 'PATCH',
          body,
        });
        await loadUsers();
        state.userEditTargetId = userId;
        setMessage('User updated.');
        return;
      }

      if (action === 'save-sop-version') {
        collectEditorDocument();
        const changeSummary = form.querySelector('[name="changeSummary"]').value.trim();
        await api(`/api/sops/${encodeURIComponent(state.currentSopId)}/versions`, {
          method: 'POST',
          body: {
            document: state.workingDoc,
            changeSummary: changeSummary || 'Updated from editor.',
          },
        });
        await loadSops();
        await loadSopContext(state.currentSopId);
        setMessage('Version saved.');
        return;
      }

      if (action === 'generate-interview-summary') {
        const answers = [
          ['Purpose', form.querySelector('[name="q_purpose"]').value],
          ['Scope', form.querySelector('[name="q_scope"]').value],
          ['Roles', form.querySelector('[name="q_roles"]').value],
          ['Procedure', form.querySelector('[name="q_steps"]').value],
        ].map(([question, answer]) => ({ question, answer }));
        state.interviewSummary = await api('/api/interviews/summarize', {
          method: 'POST',
          body: {
            title: state.currentSop?.meta?.title || '',
            answers,
          },
        });
        setMessage('Interview summary generated.');
        return;
      }

      if (action === 'extract-process-model') {
        const rawText = form.querySelector('[name="rawText"]').value;
        state.processExtraction = await api('/api/process/extract', {
          method: 'POST',
          body: { rawText },
        });
        setMessage('Process model extracted.');
        return;
      }

      if (action === 'add-review-comment') {
        const sectionPath = form.querySelector('[name="sectionPath"]').value.trim();
        const text = form.querySelector('[name="text"]').value.trim();
        await api(`/api/sops/${encodeURIComponent(state.currentSopId)}/review/comments`, {
          method: 'POST',
          body: { sectionPath, text },
        });
        await loadSopContext(state.currentSopId);
        setMessage('Review comment added.');
        return;
      }

      if (action === 'transition-workflow') {
        const toStatus = form.querySelector('[name="toStatus"]').value;
        const reason = form.querySelector('[name="reason"]').value.trim();
        const password = form.querySelector('[name="password"]').value;
        await api(`/api/sops/${encodeURIComponent(state.currentSopId)}/workflow/transition`, {
          method: 'POST',
          body: { toStatus, reason, password },
        });
        await loadSops();
        await loadSopContext(state.currentSopId);
        setMessage(`Transitioned SOP to ${toStatus}.`);
        return;
      }

      if (action === 'update-password') {
        const currentPassword = form.querySelector('[name="currentPassword"]').value;
        const newPassword = form.querySelector('[name="newPassword"]').value;
        const result = await api('/api/auth/password', {
          method: 'POST',
          body: { currentPassword, newPassword },
        });
        state.session = result.user;
        setMessage(result.user.passwordEnabled ? 'Password enabled.' : 'Password disabled.');
        return;
      }

      if (action === 'update-regulatory-profile') {
        const profileName = form.querySelector('[name="profileName"]').value.trim();
        const dueDays = Number(form.querySelector('[name="dueDays"]').value || 30);
        const regulations = form.querySelector('[name="regulations"]').value
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean);
        const nationalInstitutions = form.querySelector('[name="nationalInstitutions"]').value
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean);
        const internalPolicies = form.querySelector('[name="internalPolicies"]').value
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean);
        const assuranceChecks = Array.from(form.querySelectorAll('input[name="assuranceCheck"]:checked'))
          .map((item) => item.value);
        const quizPassScore = Number(form.querySelector('[name="quizPassScore"]').value || 80);
        const requiresTrainerSignoff = form.querySelector('[name="requiresTrainerSignoff"]').checked;
        const retrainingOnMajorRevision = form.querySelector('[name="retrainingOnMajorRevision"]').checked;

        const updated = await api('/api/settings/regulatory-profile', {
          method: 'POST',
          body: {
            profileName,
            regulations,
            nationalInstitutions,
            internalPolicies,
            assuranceChecks,
            trainingPolicy: {
              dueDays,
              quizPassScore,
              requiresTrainerSignoff,
              retrainingOnMajorRevision,
            },
          },
        });
        state.settings = updated;
        state.assuranceCheckCatalog = updated.assuranceCheckCatalog || state.assuranceCheckCatalog;
        setMessage('Regulatory profile updated.');
        return;
      }

      if (action === 'update-sop-code-policy') {
        const pattern = form.querySelector('[name="pattern"]').value.trim();
        const nextSequence = Number(form.querySelector('[name="nextSequence"]').value || 1);
        const updated = await api('/api/settings/sop-code-policy', {
          method: 'POST',
          body: {
            pattern,
            nextSequence,
          },
        });
        state.settings = updated;
        state.assuranceCheckCatalog = updated.assuranceCheckCatalog || state.assuranceCheckCatalog;
        state.pharmaAreas = Array.isArray(updated.pharmaAreas) ? updated.pharmaAreas : state.pharmaAreas;
        setMessage('SOP code policy updated.');
        return;
      }

      if (action === 'send-chat-message') {
        const message = form.querySelector('[name="message"]').value.trim();
        const passwordField = form.querySelector('[name="password"]');
        const password = passwordField?.value || '';
        const attachments = state.chatPendingAttachments.map((item) => ({
          id: item.id,
          name: item.name,
          mimeType: item.mimeType,
          size: item.size,
          content: item.content || '',
        }));
        if (!message && !attachments.length) {
          throw new Error('Enter a message or attach at least one file.');
        }
        state.chatMessages.push({
          role: 'user',
          text: message || '[Attachment upload]',
          at: new Date().toISOString(),
          attachments,
          actions: [],
        });
        queueChatHistoryPersist();
        requestChatAutoScroll();

        const assistantEntry = {
          role: 'assistant',
          text: 'Analyzing your request...',
          at: new Date().toISOString(),
          attachments: [],
          actions: [],
          streaming: true,
        };
        state.chatMessages.push(assistantEntry);
        state.chatPendingAttachments = [];
        render();
        requestChatAutoScroll();
        startAssistantProgressStream(assistantEntry);

        const startedAt = Date.now();
        let response;
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 45000);
        try {
          response = await api('/api/chat/message', {
            method: 'POST',
            body: {
              message,
              password,
              selectedSopId: state.currentSopId,
              attachments,
            },
            signal: abortController.signal,
          });
        } catch (error) {
          stopAssistantProgressStream();
          const messageText = error.name === 'AbortError'
            ? 'Request timed out after 45s. Check Task Monitor for long operations.'
            : `Request failed: ${error.message}`;
          assistantEntry.text = messageText;
          assistantEntry.actions = ['error'];
          assistantEntry.streaming = false;
          queueChatHistoryPersist();
          render();
          requestChatAutoScroll();
          throw new Error(messageText);
        } finally {
          clearTimeout(timeoutId);
        }

        const reply = response.reply || 'No response.';
        const elapsed = Date.now() - startedAt;
        if (elapsed < 400 && reply.length < 120) {
          stopAssistantProgressStream();
          assistantEntry.text = reply;
          assistantEntry.streaming = false;
          render();
          requestChatAutoScroll();
        } else {
          await streamAssistantFinalText(assistantEntry, reply);
        }
        assistantEntry.actions = Array.isArray(response.actions) ? response.actions : [];
        delete assistantEntry.streaming;

        if (response.selectedSopId) {
          await loadSopContext(response.selectedSopId);
        }
        await loadSops();
        queueChatHistoryPersist();
        form.reset();
        return;
      }

      if (action === 'run-assurance-task') {
        const checks = Array.from(form.querySelectorAll('input[name="check"]:checked')).map((item) => item.value);
        const scope = form.querySelector('[name="scope"]').value;
        const selectedFromForm = form.querySelector('[name="selectedSopId"]').value || '';
        const selectedId = selectedFromForm || state.currentSopId;
        const selectedSopIds = scope === 'selected' && selectedId ? [selectedId] : [];
        const task = await api('/api/tasks/assurance', {
          method: 'POST',
          body: {
            title: form.querySelector('[name="title"]').value.trim(),
            checks,
            selectedSopIds,
            highLevelSpec: form.querySelector('[name="highLevelSpec"]').value,
            constraints: form.querySelector('[name="constraints"]').value,
            narrative: form.querySelector('[name="narrative"]').value,
          },
        });
        await loadTasks();
        const completed = await pollTask(task.id, { attempts: 70, intervalMs: 1000 });
        setMessage(completed?.status === 'completed'
          ? 'Assurance scan completed.'
          : 'Assurance scan ended with failure.');
        return;
      }

      if (action === 'run-generation-task') {
        const autoCreate = form.querySelector('[name="autoCreate"]').value === 'yes';
        const task = await api('/api/tasks/generate-draft', {
          method: 'POST',
          body: {
            title: form.querySelector('[name="title"]').value.trim(),
            highLevelSpec: form.querySelector('[name="highLevelSpec"]').value,
            constraints: form.querySelector('[name="constraints"]').value,
            narrative: form.querySelector('[name="narrative"]').value,
          },
        });
        await loadTasks();
        const completed = await pollTask(task.id, { attempts: 70, intervalMs: 1000 });
        if (completed?.status === 'completed' && autoCreate && completed.result) {
          const created = await api('/api/sops', {
            method: 'POST',
            body: {
              title: completed.result.title || 'Generated SOP',
              area: 'Generated',
              targetRoles: ['author', 'reviewer'],
              document: completed.result,
            },
          });
          await loadSops();
          navigate(`/sops/${created.meta.id}/edit`);
          setMessage(`Generated draft created as SOP ${created.meta.code}.`);
          return;
        }
        setMessage(completed?.status === 'completed'
          ? 'Generation task completed.'
          : 'Generation task failed.');
        return;
      }

      if (action === 'create-automation-job') {
        const created = await api('/api/automation/jobs', {
          method: 'POST',
          body: {
            title: form.querySelector('[name="title"]').value.trim(),
            type: form.querySelector('[name="type"]').value,
            intervalMinutes: Number(form.querySelector('[name="intervalMinutes"]').value || 60),
            input: {
              highLevelSpec: form.querySelector('[name="highLevelSpec"]').value,
              constraints: form.querySelector('[name="constraints"]').value,
              narrative: form.querySelector('[name="narrative"]').value,
            },
          },
        });
        await loadAutomationJobs();
        setMessage(`Automation job ${created.id} created.`);
        return;
      }

      if (action === 'training-submit-quiz') {
        const taskId = form.querySelector('[name="taskId"]').value;
        const score = Number(form.querySelector('[name="score"]').value);
        if (!taskId) {
          throw new Error('Missing training task id.');
        }
        await api(`/api/training/tasks/${encodeURIComponent(taskId)}/quiz`, {
          method: 'POST',
          body: { score },
        });
        const sopId = state.trainingFilterSopId !== 'all' ? state.trainingFilterSopId : null;
        const status = state.trainingFilterStatus !== 'all' ? state.trainingFilterStatus : null;
        await Promise.all([
          loadTraining({ sopId, status }),
          loadTrainingOverview({ sopId }),
        ]);
        setMessage('Quiz result submitted.');
        return;
      }

      if (action === 'create-template') {
        const id = form.querySelector('[name="id"]').value.trim();
        const title = form.querySelector('[name="title"]').value.trim();
        const description = form.querySelector('[name="description"]').value.trim();
        const areas = checkedValues(form, 'areas');
        const targetRoles = checkedValues(form, 'targetRoles');
        const sectionsJson = form.querySelector('[name="sectionsJson"]').value.trim();
        let sections = undefined;
        if (sectionsJson) {
          try {
            sections = JSON.parse(sectionsJson);
          } catch {
            throw new Error('Section Guidance JSON is not valid JSON.');
          }
        }
        await api('/api/templates', {
          method: 'POST',
          body: {
            id: id || undefined,
            title,
            description,
            areas,
            targetRoles,
            sections,
          },
        });
        await loadTemplates();
        setMessage('Template created.');
        return;
      }
    } catch (error) {
      setMessage(error.message, 'error');
    }
  });
}

async function handleClick(event) {
  const el = event.target.closest('[data-action]');
  if (!el) {
    return;
  }

  const type = (el.getAttribute('type') || '').toLowerCase();
  const inForm = Boolean(el.closest('form'));
  const isSubmit = inForm && (type === 'submit' || type === '');
  if (isSubmit) {
    return;
  }

  const action = el.dataset.action;
  await withBusy(async () => {
    try {
      if (action === 'clear-message') {
        state.message = null;
        return;
      }

      if (action === 'logout') {
        await api('/api/auth/logout', { method: 'POST', body: {} });
        if (chatHistoryPersistTimerId) {
          clearTimeout(chatHistoryPersistTimerId);
          chatHistoryPersistTimerId = null;
        }
        stopAssistantProgressStream();
        state.session = null;
        state.csrfToken = '';
        state.route = { view: 'dashboard', params: {}, query: {} };
        state.message = null;
        state.chatMessages = defaultChatMessages();
        state.chatPendingAttachments = [];
        state.chatHistoryLoadedForUserId = null;
        state.chatToolsOpen = false;
        render();
        return;
      }

      if (action === 'open-sop-list-status') {
        const status = el.dataset.status || 'all';
        navigate(`/sops?status=${encodeURIComponent(status)}`);
        return;
      }

      if (action === 'open-sop-edit') {
        navigate(`/sops/${encodeURIComponent(el.dataset.sopId)}/edit`);
        return;
      }

      if (action === 'refresh-users') {
        await loadUsers();
        setMessage('Users refreshed.');
        return;
      }

      if (action === 'pick-user-edit') {
        state.userEditTargetId = el.dataset.userId || null;
        return;
      }

      if (action === 'apply-training-filter') {
        const sopId = state.trainingFilterSopId === 'all' ? null : state.trainingFilterSopId;
        const status = state.trainingFilterStatus === 'all' ? null : state.trainingFilterStatus;
        await Promise.all([
          loadTraining({ sopId, status }),
          loadTrainingOverview({ sopId }),
        ]);
        setMessage('Training filter applied.');
        return;
      }

      if (action === 'refresh-training') {
        const sopId = state.trainingFilterSopId === 'all' ? null : state.trainingFilterSopId;
        const status = state.trainingFilterStatus === 'all' ? null : state.trainingFilterStatus;
        await Promise.all([
          loadTraining({ sopId, status }),
          loadTrainingOverview({ sopId }),
        ]);
        setMessage('Training refreshed.');
        return;
      }

      if (action === 'training-mark-read') {
        const taskId = el.dataset.taskId;
        await api(`/api/training/tasks/${encodeURIComponent(taskId)}/read`, {
          method: 'POST',
          body: {},
        });
        const sopId = state.trainingFilterSopId === 'all' ? null : state.trainingFilterSopId;
        const status = state.trainingFilterStatus === 'all' ? null : state.trainingFilterStatus;
        await Promise.all([
          loadTraining({ sopId, status }),
          loadTrainingOverview({ sopId }),
        ]);
        setMessage(`Read acknowledgement recorded for ${taskId}.`);
        return;
      }

      if (action === 'training-signoff') {
        const taskId = el.dataset.taskId;
        await api(`/api/training/tasks/${encodeURIComponent(taskId)}/signoff`, {
          method: 'POST',
          body: {},
        });
        const sopId = state.trainingFilterSopId === 'all' ? null : state.trainingFilterSopId;
        const status = state.trainingFilterStatus === 'all' ? null : state.trainingFilterStatus;
        await Promise.all([
          loadTraining({ sopId, status }),
          loadTrainingOverview({ sopId }),
        ]);
        setMessage(`Training sign-off recorded for ${taskId}.`);
        return;
      }

      if (action === 'apply-audit-filter') {
        const entityId = state.auditFilterEntityId === 'all' ? null : state.auditFilterEntityId;
        await loadAuditEvents({ entityId });
        setMessage('Audit filter applied.');
        return;
      }

      if (action === 'refresh-audit') {
        const entityId = state.auditFilterEntityId === 'all' ? null : state.auditFilterEntityId;
        await loadAuditEvents({ entityId });
        setMessage('Audit refreshed.');
        return;
      }

      if (action === 'verify-audit') {
        await refreshAuditVerification();
        setMessage(state.auditVerify?.ok ? 'Audit verification passed.' : 'Audit verification failed.');
        return;
      }

      if (action === 'run-current-validation') {
        collectEditorDocument();
        state.validation = await api(`/api/sops/${encodeURIComponent(state.currentSopId)}/validate`, {
          method: 'POST',
          body: { document: state.workingDoc },
        });
        state.sopEditTab = 'quality';
        setMessage('Validation completed.');
        return;
      }

      if (action === 'switch-edit-tab') {
        state.sopEditTab = el.dataset.tab || 'content';
        return;
      }

      if (action === 'add-editor-section') {
        state.workingDoc.sections.push({
          id: `section-${state.workingDoc.sections.length + 1}`,
          title: 'New Section',
          text: '',
        });
        return;
      }

      if (action === 'remove-editor-section') {
        const index = Number(el.dataset.index);
        state.workingDoc.sections.splice(index, 1);
        return;
      }

      if (action === 'add-editor-step') {
        state.workingDoc.processModel.steps.push({
          order: state.workingDoc.processModel.steps.length + 1,
          name: '',
          role: '',
          inputs: [],
          outputs: [],
          records: [],
          exceptions: [],
        });
        return;
      }

      if (action === 'remove-editor-step') {
        const index = Number(el.dataset.index);
        state.workingDoc.processModel.steps.splice(index, 1);
        return;
      }

      if (action === 'add-editor-ref') {
        state.workingDoc.references.push({ label: '', type: '', target: '' });
        return;
      }

      if (action === 'remove-editor-ref') {
        const index = Number(el.dataset.index);
        state.workingDoc.references.splice(index, 1);
        return;
      }

      if (action === 'apply-interview-summary') {
        if (!state.interviewSummary) {
          throw new Error('Generate interview summary first.');
        }
        const map = [
          ['purpose', 'Purpose', state.interviewSummary.purpose || ''],
          ['scope', 'Scope', state.interviewSummary.scope || ''],
          ['responsibilities', 'Responsibilities', Array.isArray(state.interviewSummary.roles) ? state.interviewSummary.roles.join(', ') : ''],
          ['procedure', 'Procedure', state.interviewSummary.procedureDraft || ''],
          ['records', 'Records', Array.isArray(state.interviewSummary.records) ? state.interviewSummary.records.join('\n') : ''],
          ['exceptions', 'Exceptions', Array.isArray(state.interviewSummary.exceptions) ? state.interviewSummary.exceptions.join('\n') : ''],
        ];
        for (const [id, title, text] of map) {
          const index = state.workingDoc.sections.findIndex((section) => section.id === id);
          if (index === -1) {
            state.workingDoc.sections.push({ id, title, text });
          } else {
            state.workingDoc.sections[index] = {
              ...state.workingDoc.sections[index],
              title,
              text,
            };
          }
        }
        setMessage('Interview summary applied to document.');
        return;
      }

      if (action === 'apply-process-extraction') {
        if (!state.processExtraction?.steps) {
          throw new Error('Extract process model first.');
        }
        state.workingDoc.processModel.steps = deepClone(state.processExtraction.steps);
        setMessage('Process model applied.');
        return;
      }

      if (action === 'resolve-comment') {
        await api(`/api/sops/${encodeURIComponent(state.currentSopId)}/review/comments/${encodeURIComponent(el.dataset.commentId)}/resolve`, {
          method: 'POST',
          body: {},
        });
        await loadSopContext(state.currentSopId);
        setMessage('Comment resolved.');
        return;
      }

      if (action === 'transition-review') {
        await api(`/api/sops/${encodeURIComponent(state.currentSopId)}/workflow/transition`, {
          method: 'POST',
          body: {
            toStatus: 'In Review',
            reason: 'Submitted for review from editor.',
            password: '',
          },
        });
        await loadSops();
        await loadSopContext(state.currentSopId);
        state.sopEditTab = 'release';
        setMessage('SOP moved to In Review.');
        return;
      }

      if (action === 'publish-sop') {
        await api(`/api/sops/${encodeURIComponent(state.currentSopId)}/publish`, {
          method: 'POST',
          body: {},
        });
        await loadSops();
        await loadSopContext(state.currentSopId);
        setMessage('SOP published.');
        return;
      }

      if (action === 'chat-quick') {
        const command = el.dataset.command || '';
        const form = document.querySelector('form[data-action="send-chat-message"]');
        if (form) {
          const input = form.querySelector('[name="message"]');
          if (input) {
            input.value = command;
            input.focus();
          }
        }
        return;
      }

      if (action === 'open-chat-file-picker') {
        const input = document.querySelector('#chat-file-input');
        if (input) {
          input.click();
        }
        return;
      }

      if (action === 'toggle-chat-tools') {
        state.chatToolsOpen = !state.chatToolsOpen;
        return;
      }

      if (action === 'remove-chat-attachment') {
        const attachmentId = el.dataset.attachmentId;
        state.chatPendingAttachments = state.chatPendingAttachments.filter((item) => item.id !== attachmentId);
        return;
      }

      if (action === 'refresh-tasks') {
        const typeFilter = state.taskFilterType === 'all' ? null : state.taskFilterType;
        await loadTasks({ type: typeFilter });
        if (state.selectedTaskId) {
          await loadTask(state.selectedTaskId);
        }
        setMessage('Tasks refreshed.');
        return;
      }

      if (action === 'select-task') {
        await loadTask(el.dataset.taskId);
        setMessage(`Loaded task ${el.dataset.taskId}.`);
        return;
      }

      if (action === 'refresh-automation-jobs') {
        await loadAutomationJobs();
        setMessage('Automation jobs refreshed.');
        return;
      }

      if (action === 'run-automation-job') {
        const jobId = el.dataset.jobId;
        const result = await api(`/api/automation/jobs/${encodeURIComponent(jobId)}/run`, {
          method: 'POST',
          body: {},
        });
        await Promise.all([
          loadAutomationJobs(),
          loadTasks(),
        ]);
        if (result?.task?.id) {
          await loadTask(result.task.id);
        }
        setMessage(`Automation job ${jobId} executed.`);
        return;
      }

      if (action === 'toggle-automation-job') {
        const jobId = el.dataset.jobId;
        const enabled = el.dataset.enabled === '1';
        await api(`/api/automation/jobs/${encodeURIComponent(jobId)}`, {
          method: 'PATCH',
          body: {
            enabled: !enabled,
          },
        });
        await loadAutomationJobs();
        setMessage(`Automation job ${jobId} ${enabled ? 'disabled' : 'enabled'}.`);
        return;
      }

      if (action === 'refresh-templates') {
        await loadTemplates();
        setMessage('Templates refreshed.');
        return;
      }
    } catch (error) {
      setMessage(error.message, 'error');
    }
  });
}

async function handleChange(event) {
  const el = event.target;
  const action = el.dataset.action;
  if (!action) {
    return;
  }

  if (action === 'set-training-filter') {
    state.trainingFilterSopId = el.value || 'all';
    return;
  }
  if (action === 'set-chat-context') {
    const nextSopId = el.value || null;
    state.currentSopId = nextSopId;
    if (nextSopId) {
      await loadSopContext(nextSopId);
    } else {
      await loadSopContext(null);
    }
    render();
    return;
  }
  if (action === 'chat-file-input') {
    const files = Array.from(el.files || []);
    const parsed = [];
    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      parsed.push(await createChatAttachment(file));
    }
    state.chatPendingAttachments = state.chatPendingAttachments.concat(parsed);
    el.value = '';
    render();
    return;
  }
  if (action === 'set-training-status-filter') {
    state.trainingFilterStatus = el.value || 'all';
    return;
  }
  if (action === 'set-audit-filter') {
    state.auditFilterEntityId = el.value || 'all';
    return;
  }
  if (action === 'set-user-edit-target') {
    state.userEditTargetId = el.value || null;
    render();
    return;
  }
  if (action === 'set-task-type-filter') {
    state.taskFilterType = el.value || 'all';
    if (state.route.view === 'tasks') {
      const type = state.taskFilterType !== 'all' ? state.taskFilterType : null;
      await loadTasks({ type });
    }
    render();
    return;
  }
  if (action === 'set-template') {
    state.selectedTemplateId = el.value || '';
    return;
  }
}

async function handleFilterSubmit(form) {
  if (form.dataset.action !== 'apply-sop-list-filter') {
    return false;
  }
  const status = form.querySelector('[name="status"]').value || 'all';
  const search = form.querySelector('[name="search"]').value.trim();
  const params = new URLSearchParams();
  if (status && status !== 'all') {
    params.set('status', status);
  } else {
    params.set('status', 'all');
  }
  if (search) {
    params.set('search', search);
  }
  navigate(`/sops?${params.toString()}`);
  return true;
}

async function submitRouter(event) {
  const form = event.target.closest('form[data-action]');
  if (!form) {
    return;
  }
  if (await handleFilterSubmit(form)) {
    event.preventDefault();
    return;
  }
  await handleSubmit(event);
}

window.addEventListener('hashchange', () => {
  void withBusy(syncRoute);
});

app.addEventListener('submit', (event) => {
  void submitRouter(event);
});

app.addEventListener('click', (event) => {
  void handleClick(event);
});

app.addEventListener('change', (event) => {
  void handleChange(event);
});

bootstrap().catch((error) => {
  state.message = { text: error.message, type: 'error' };
  render();
});

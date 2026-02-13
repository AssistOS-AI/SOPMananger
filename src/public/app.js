import {
  icon as renderIcon,
  renderLogin,
  renderShell,
} from './render/layout.mjs';
import {
  renderDashboard,
  renderUserManagement,
} from './render/dashboard-users.mjs';
import {
  renderSopList,
  renderSopCreate,
} from './render/sop-list-create.mjs';
import { renderSopEdit } from './render/sop-editor.mjs';
import {
  renderAssistant,
  renderAutomation,
  renderTasks,
  renderTemplates,
} from './render/operations.mjs';
import {
  renderTraining,
  renderAudit,
  renderSettings,
} from './render/compliance.mjs';
import { createDataClient } from './lib/data-client.mjs';
import { handleSubmit as handleSubmitAction } from './handlers/submit-actions.mjs';
import { handleClick as handleClickAction } from './handlers/click-actions.mjs';
import { handleChange as handleChangeAction } from './handlers/change-actions.mjs';
import { submitRouter } from './handlers/submit-router.mjs';

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
  route: { view: 'dashboard', params: {}, query: {} },

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
    }, 4200);
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

function checkedValues(form, name) {
  return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map((item) => item.value);
}

function collectEditorDocument() {
  const root = document.querySelector('[data-editor-form]');
  if (!root || !state.currentSop) {
    throw new Error('Editor context is not available. Reload the SOP editor and try again.');
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

function renderMainView() {
  const icon = (name, extraClass = '') => renderIcon(name, extraClass, { esc });
  if (state.route.view === 'dashboard') return renderDashboard({ state, esc, fmtDate, icon });
  if (state.route.view === 'sopList') return renderSopList({ state, esc, fmtDate });
  if (state.route.view === 'sopCreate') return renderSopCreate({ state, esc });
  if (state.route.view === 'sopEdit') return renderSopEdit({ state, esc, fmtDate });
  if (state.route.view === 'assistant') return renderAssistant({ state, esc, fmtBytes, fmtDate, icon });
  if (state.route.view === 'automation') return renderAutomation({ state, esc, fmtDate });
  if (state.route.view === 'tasks') return renderTasks({ state, esc, fmtDate });
  if (state.route.view === 'templates') return renderTemplates({ state, esc });
  if (state.route.view === 'training') return renderTraining({ state, esc, fmtDate });
  if (state.route.view === 'users') return renderUserManagement({ state, esc });
  if (state.route.view === 'audit') return renderAudit({ state, esc, fmtDate });
  if (state.route.view === 'settings') return renderSettings({ state, esc });
  return renderDashboard({ state, esc, fmtDate, icon });
}

function render() {
  if (!state.session) {
    app.innerHTML = renderLogin({ state, esc });
    return;
  }
  app.innerHTML = renderShell(renderMainView(), { state, esc });
}

const dataClient = createDataClient({
  state,
  app,
  defaultChatMessages,
  deepClone,
  render,
});

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

async function syncRoute() {
  state.route = parseHashRoute();
  if (!state.session) {
    render();
    return;
  }

  if (!state.sops.length) {
    await dataClient.loadSops();
  }
  if (state.route.view === 'assistant') {
    await dataClient.loadChatHistory();
  }

  if (state.route.view === 'sopEdit') {
    const sopId = state.route.params.sopId;
    if (!sopId) {
      navigate('/sops');
      return;
    }
    if (state.currentSopId !== sopId) {
      await dataClient.loadSopContext(sopId);
      state.sopEditTab = 'content';
    }
  } else if (state.route.view === 'dashboard') {
    await dataClient.loadTrainingOverview();
  } else if (state.route.view === 'users') {
    if (state.session.role === 'admin') {
      await dataClient.loadUsers();
    }
  } else if (state.route.view === 'settings') {
    await dataClient.loadSettings();
  } else if (state.route.view === 'automation') {
    await Promise.all([
      dataClient.loadSettings(),
      dataClient.loadAutomationJobs(),
      dataClient.loadTasks(),
    ]);
    if (state.selectedTaskId) {
      await dataClient.loadTask(state.selectedTaskId);
    }
  } else if (state.route.view === 'templates' || state.route.view === 'sopCreate') {
    await Promise.all([dataClient.loadTemplates(), dataClient.loadSettings()]);
  } else if (state.route.view === 'training') {
    const sopId = state.trainingFilterSopId !== 'all' ? state.trainingFilterSopId : null;
    const status = state.trainingFilterStatus !== 'all' ? state.trainingFilterStatus : null;
    await Promise.all([
      dataClient.loadTraining({ sopId, status }),
      dataClient.loadTrainingOverview({ sopId }),
    ]);
  } else if (state.route.view === 'audit') {
    const entityId = state.auditFilterEntityId !== 'all' ? state.auditFilterEntityId : null;
    await dataClient.loadAuditEvents({ entityId });
  } else if (state.route.view === 'tasks') {
    const type = state.taskFilterType !== 'all' ? state.taskFilterType : null;
    await dataClient.loadTasks({ type });
    if (state.selectedTaskId) {
      await dataClient.loadTask(state.selectedTaskId);
    }
  }

  render();
  if (state.route.view === 'assistant') {
    dataClient.requestChatAutoScroll({ force: true });
  }
}

async function bootstrap() {
  await dataClient.loadSession();
  if (state.session) {
    await Promise.all([
      dataClient.loadSops(),
      dataClient.loadChatHistory(),
    ]);
  }
  await syncRoute();
}

function handlerContext() {
  return {
    state,
    withBusy,
    setMessage,
    navigate,
    render,
    deepClone,
    checkedValues,
    collectEditorDocument,
    sopLabelById,
    defaultChatMessages,
    ...dataClient,
  };
}

window.addEventListener('hashchange', () => {
  void withBusy(syncRoute);
});

app.addEventListener('submit', (event) => {
  const ctx = handlerContext();
  void submitRouter(event, {
    ...ctx,
    handleSubmit: handleSubmitAction,
  });
});

app.addEventListener('click', (event) => {
  if (
    state.chatToolsOpen
    && !event.target.closest('.chat-tools-wrap')
    && !event.target.closest('[data-action="toggle-chat-tools"]')
    && !event.target.closest('[data-action="open-chat-file-picker"]')
  ) {
    state.chatToolsOpen = false;
    render();
    return;
  }
  void handleClickAction(event, handlerContext());
});

app.addEventListener('change', (event) => {
  void handleChangeAction(event, handlerContext());
});

app.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.chatToolsOpen) {
    state.chatToolsOpen = false;
    render();
  }
});

bootstrap().catch((error) => {
  state.message = { text: error.message, type: 'error' };
  render();
});

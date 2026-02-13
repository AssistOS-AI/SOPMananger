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
import {
  esc,
  deepClone,
  fmtDate,
  fmtBytes,
  parseHashRoute,
  checkedValues,
  collectEditorDocument,
  sopLabelById,
  userLabelById,
  actionLabel,
  breadcrumbs,
} from './lib/ui-helpers.mjs';
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
  messageHistory: [],
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
  sopLinksTab: 'impact',
  editorDirty: false,
  selectedHistoryVersionId: null,
  releaseToStatus: '',

  interviewSummary: null,
  processExtraction: null,

  templates: [],
  selectedTemplateId: '',
  templateSectionsBuilder: [],
  pharmaAreas: [],

  users: [],
  userEditTargetId: null,
  userManagementTab: 'list',

  settings: null,
  assuranceCheckCatalog: [],
  settingsTab: 'regulatory',

  automationJobs: [],
  automationTab: 'assurance',
  automationShowCreateJob: false,

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
  activeTaskCount: 0,

  chatMessages: defaultChatMessages(),
  chatPendingAttachments: [],
  chatHistoryLoadedForUserId: null,
  chatToolsOpen: false,
};

const app = document.querySelector('#app');
let messageTimeoutId = null;
let taskBadgeTimerId = null;
let lastConfirmedHash = window.location.hash || '#/dashboard';
let suppressHashGuard = false;

function setMessage(text, type = 'info') {
  if (messageTimeoutId) {
    clearTimeout(messageTimeoutId);
    messageTimeoutId = null;
  }
  state.message = text ? { text, type } : null;
  if (text) {
    state.messageHistory = [
      ...state.messageHistory,
      {
        text: String(text),
        type: type === 'error' ? 'error' : 'info',
        at: new Date().toISOString(),
      },
    ].slice(-12);
  }
  render();
  if (state.message && type === 'info') {
    messageTimeoutId = setTimeout(() => {
      state.message = null;
      render();
    }, 4200);
  }
}

function navigate(path) {
  const normalized = path.startsWith('#') ? path : `#${path}`;
  if (window.location.hash === normalized) {
    void syncRoute();
    return;
  }
  window.location.hash = normalized;
}

const sopLabel = (sopId) => sopLabelById(state, sopId);
const userLabel = (userId) => userLabelById(state, userId);

function renderMainView() {
  const icon = (name, extraClass = '') => renderIcon(name, extraClass, { esc });
  if (state.route.view === 'dashboard') return renderDashboard({ state, esc, fmtDate, icon });
  if (state.route.view === 'sopList') return renderSopList({ state, esc, fmtDate });
  if (state.route.view === 'sopCreate') return renderSopCreate({ state, esc });
  if (state.route.view === 'sopEdit') return renderSopEdit({
    state,
    esc,
    fmtDate,
    userLabelById: userLabel,
  });
  if (state.route.view === 'assistant') return renderAssistant({ state, esc, fmtBytes, fmtDate, icon });
  if (state.route.view === 'automation') return renderAutomation({ state, esc, fmtDate });
  if (state.route.view === 'tasks') return renderTasks({ state, esc, fmtDate });
  if (state.route.view === 'templates') return renderTemplates({ state, esc });
  if (state.route.view === 'training') return renderTraining({ state, esc, fmtDate });
  if (state.route.view === 'users') return renderUserManagement({ state, esc });
  if (state.route.view === 'audit') return renderAudit({
    state,
    esc,
    fmtDate,
    userLabelById: userLabel,
    sopLabelById: sopLabel,
    actionLabel,
  });
  if (state.route.view === 'settings') return renderSettings({ state, esc });
  return renderDashboard({ state, esc, fmtDate, icon });
}

function render() {
  if (!state.session) {
    app.innerHTML = renderLogin({ state, esc });
    return;
  }
  app.innerHTML = renderShell(renderMainView(), {
    state,
    esc,
    breadcrumbs: breadcrumbs(state),
  });
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

function shouldAllowRouteChange(nextHash) {
  if (!state.editorDirty) {
    return true;
  }
  if (state.route.view !== 'sopEdit') {
    return true;
  }
  const currentEditHash = state.currentSopId ? `#/sops/${state.currentSopId}/edit` : '#/sops';
  if (nextHash.startsWith(currentEditHash)) {
    return true;
  }
  return window.confirm('You have unsaved SOP edits. Leave this page and discard unsaved changes?');
}

function ensureTaskBadgePolling() {
  if (taskBadgeTimerId) {
    return;
  }
  taskBadgeTimerId = setInterval(async () => {
    if (!state.session) {
      return;
    }
    try {
      await dataClient.loadTasks({ type: null });
      render();
    } catch {
      // non-blocking badge refresh
    }
  }, 15000);
}

function stopTaskBadgePolling() {
  if (!taskBadgeTimerId) {
    return;
  }
  clearInterval(taskBadgeTimerId);
  taskBadgeTimerId = null;
}

async function syncRoute() {
  state.route = parseHashRoute();
  if (!state.session) {
    render();
    return;
  }

  ensureTaskBadgePolling();

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
      dataClient.loadTasks(),
    ]);
    ensureTaskBadgePolling();
  }
  await syncRoute();
  lastConfirmedHash = window.location.hash || '#/dashboard';
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
    collectEditorDocument: () => collectEditorDocument(state),
    sopLabelById: sopLabel,
    defaultChatMessages,
    stopTaskBadgePolling,
    ...dataClient,
  };
}

window.addEventListener('hashchange', () => {
  const nextHash = window.location.hash || '#/dashboard';
  if (suppressHashGuard) {
    suppressHashGuard = false;
    lastConfirmedHash = nextHash;
    void withBusy(syncRoute);
    return;
  }
  if (!shouldAllowRouteChange(nextHash)) {
    suppressHashGuard = true;
    window.location.hash = lastConfirmedHash;
    return;
  }
  lastConfirmedHash = nextHash;
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

app.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  if (target.closest('[data-editor-form]')) {
    if (!state.editorDirty) {
      state.editorDirty = true;
      const dirtyBadge = app.querySelector('.editor-actions-sticky .badge');
      if (dirtyBadge) {
        dirtyBadge.className = 'badge warning';
        dirtyBadge.textContent = 'Unsaved changes';
      }
    }
  }
});

app.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.chatToolsOpen) {
    state.chatToolsOpen = false;
    render();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && state.route.view === 'sopEdit') {
    event.preventDefault();
    if (state.busy) {
      return;
    }
    const form = app.querySelector('form[data-action="save-sop-version"]');
    if (form instanceof HTMLFormElement) {
      form.requestSubmit();
    }
    return;
  }

  if (event.key === 'Enter' && !event.shiftKey && state.route.view === 'assistant') {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement && target.name === 'message') {
      event.preventDefault();
      const form = target.closest('form[data-action="send-chat-message"]');
      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
      }
    }
  }
});

window.addEventListener('beforeunload', (event) => {
  if (!state.editorDirty || state.route.view !== 'sopEdit') {
    return;
  }
  event.preventDefault();
  event.returnValue = '';
});

bootstrap().catch((error) => {
  state.message = { text: error.message, type: 'error' };
  render();
});

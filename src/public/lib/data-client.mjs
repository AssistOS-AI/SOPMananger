export function createDataClient({
  state,
  app,
  defaultChatMessages,
  deepClone,
  render,
}) {
  let chatHistoryPersistTimerId = null;
  let chatStreamTimerId = null;

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

  function requestChatAutoScroll({ force = false } = {}) {
    if (state.route.view !== 'assistant') {
      return;
    }
    requestAnimationFrame(() => {
      const wrap = app.querySelector('.chat-thread-wrap');
      if (wrap) {
        const distanceToBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight;
        if (force || distanceToBottom < 120) {
          wrap.scrollTop = wrap.scrollHeight;
        }
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
    requestChatAutoScroll({ force: true });
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
    requestChatAutoScroll({ force: true });
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
      if (index % 4 === 0) {
        await loadTasks();
      }
      if (task && ['completed', 'failed'].includes(task.status)) {
        return task;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return state.selectedTask;
  }

  function clearChatHistoryPersistTimer() {
    if (chatHistoryPersistTimerId) {
      clearTimeout(chatHistoryPersistTimerId);
      chatHistoryPersistTimerId = null;
    }
  }

  return {
    api,
    createChatAttachment,
    queueChatHistoryPersist,
    loadChatHistory,
    requestChatAutoScroll,
    startAssistantProgressStream,
    stopAssistantProgressStream,
    streamAssistantFinalText,
    loadSession,
    loadSops,
    loadSopContext,
    loadTemplates,
    loadUsers,
    loadSettings,
    loadAutomationJobs,
    loadTraining,
    loadTrainingOverview,
    loadAuditEvents,
    refreshAuditVerification,
    loadTasks,
    loadTask,
    pollTask,
    clearChatHistoryPersistTimer,
  };
}

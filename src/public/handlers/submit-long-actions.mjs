export async function handleSendChatMessage(form, ctx) {
  const {
    state,
    api,
    render,
    queueChatHistoryPersist,
    requestChatAutoScroll,
    startAssistantProgressStream,
    stopAssistantProgressStream,
    streamAssistantFinalText,
    loadSopContext,
    loadSops,
  } = ctx;

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
  requestChatAutoScroll({ force: true });

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
  requestChatAutoScroll({ force: true });
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
    requestChatAutoScroll({ force: true });
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
    requestChatAutoScroll({ force: true });
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
  state.chatToolsOpen = false;
  form.reset();
}

export async function handleRunAssuranceTask(form, ctx) {
  const {
    state,
    api,
    loadTasks,
    pollTask,
    setMessage,
  } = ctx;

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
}

export async function handleRunGenerationTask(form, ctx) {
  const {
    api,
    loadTasks,
    pollTask,
    loadSops,
    navigate,
    setMessage,
  } = ctx;

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
}

export async function handleCreateAutomationJob(form, ctx) {
  const {
    api,
    loadAutomationJobs,
    setMessage,
  } = ctx;

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
}

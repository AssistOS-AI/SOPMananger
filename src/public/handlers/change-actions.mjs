export async function handleChange(event, ctx) {
  const {
    state,
    loadSopContext,
    render,
    createChatAttachment,
    loadTasks,
  } = ctx;

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
  if (action === 'chat-message-input') {
    return;
  }
  if (action === 'set-release-status') {
    state.releaseToStatus = el.value || '';
    render();
  }
}

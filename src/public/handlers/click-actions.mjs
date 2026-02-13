import { handleTrainingClickAction } from './click-training-actions.mjs';

export async function handleClick(event, ctx) {
  const {
    state,
    withBusy,
    api,
    setMessage,
    render,
    defaultChatMessages,
    stopAssistantProgressStream,
    deepClone,
    loadUsers,
    loadAuditEvents,
    refreshAuditVerification,
    collectEditorDocument,
    loadSopContext,
    loadSops,
    requestChatAutoScroll,
    loadTasks,
    loadTask,
    loadAutomationJobs,
    loadTemplates,
    stopTaskBadgePolling,
  } = ctx;

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
      if (action === 'clear-message' || action === 'close-message') {
        state.message = null;
        return;
      }

      if (action === 'logout') {
        if (state.editorDirty && !window.confirm('You have unsaved SOP edits. Logout anyway?')) {
          return;
        }
        await api('/api/auth/logout', { method: 'POST', body: {} });
        if (ctx.clearChatHistoryPersistTimer) {
          ctx.clearChatHistoryPersistTimer();
        }
        if (typeof stopTaskBadgePolling === 'function') {
          stopTaskBadgePolling();
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

      if (action === 'set-user-tab') {
        state.userManagementTab = el.dataset.tab || 'list';
        if (state.userManagementTab === 'edit' && !state.userEditTargetId && state.users.length) {
          state.userEditTargetId = state.users[0].id;
        }
        return;
      }

      if (action === 'set-settings-tab') {
        state.settingsTab = el.dataset.tab || 'security';
        return;
      }

      if (action === 'set-automation-tab') {
        state.automationTab = el.dataset.tab || 'assurance';
        return;
      }

      if (action === 'toggle-automation-create-job') {
        state.automationShowCreateJob = !state.automationShowCreateJob;
        return;
      }

      if (action === 'open-sop-list-status') {
        const status = el.dataset.status || 'all';
        ctx.navigate(`/sops?status=${encodeURIComponent(status)}`);
        return;
      }

      if (action === 'open-sop-edit') {
        ctx.navigate(`/sops/${encodeURIComponent(el.dataset.sopId)}/edit`);
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

      if (await handleTrainingClickAction(action, el, ctx)) {
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
        state.editorDirty = true;
        return;
      }

      if (action === 'remove-editor-section') {
        const index = Number(el.dataset.index);
        if (!window.confirm('Remove this section?')) {
          return;
        }
        state.workingDoc.sections.splice(index, 1);
        state.editorDirty = true;
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
        state.editorDirty = true;
        return;
      }

      if (action === 'remove-editor-step') {
        const index = Number(el.dataset.index);
        if (!window.confirm('Remove this process step?')) {
          return;
        }
        state.workingDoc.processModel.steps.splice(index, 1);
        state.editorDirty = true;
        return;
      }

      if (action === 'add-editor-ref') {
        state.workingDoc.references.push({ label: '', type: '', target: '' });
        state.editorDirty = true;
        return;
      }

      if (action === 'remove-editor-ref') {
        const index = Number(el.dataset.index);
        if (!window.confirm('Remove this reference?')) {
          return;
        }
        state.workingDoc.references.splice(index, 1);
        state.editorDirty = true;
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
        state.editorDirty = true;
        setMessage('Interview summary applied to document.');
        return;
      }

      if (action === 'apply-process-extraction') {
        if (!state.processExtraction?.steps) {
          throw new Error('Extract process model first.');
        }
        state.workingDoc.processModel.steps = deepClone(state.processExtraction.steps);
        state.editorDirty = true;
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
        if (!window.confirm('Submit this SOP to In Review?')) {
          return;
        }
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
        if (!window.confirm('Publish this SOP as Effective and generate training assignments?')) {
          return;
        }
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
        state.chatToolsOpen = false;
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

      if (action === 'create-sop-from-task-draft') {
        if (!state.selectedTask?.result) {
          throw new Error('Selected task has no draft result.');
        }
        const created = await api('/api/sops', {
          method: 'POST',
          body: {
            title: state.selectedTask.result.title || 'Generated SOP',
            area: 'Generated',
            targetRoles: ['author', 'reviewer'],
            document: state.selectedTask.result,
          },
        });
        await loadSops();
        ctx.navigate(`/sops/${created.meta.id}/edit`);
        setMessage(`Created SOP ${created.meta.code} from selected task.`);
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

      if (action === 'set-sop-links-tab') {
        state.sopLinksTab = el.dataset.tab || 'impact';
        return;
      }

      if (action === 'select-history-version') {
        state.selectedHistoryVersionId = el.dataset.versionId || null;
        return;
      }

      if (action === 'load-template-section-defaults') {
        const form = el.closest('form[data-action=\"create-template\"]');
        if (!form) {
          return;
        }
        const defaults = [
          { id: 'purpose', title: 'Purpose', guidance: 'Define objective and intended outcome.' },
          { id: 'scope', title: 'Scope', guidance: 'Define applicability, boundaries, and exclusions.' },
          { id: 'responsibilities', title: 'Responsibilities', guidance: 'List accountable and supporting roles.' },
          { id: 'procedure', title: 'Procedure', guidance: 'Describe steps and acceptance criteria.' },
          { id: 'records', title: 'Records', guidance: 'Define records, storage, retention, and integrity controls.' },
          { id: 'exceptions', title: 'Exceptions', guidance: 'Define deviation handling and escalation path.' },
        ];
        const target = form.querySelector('[name=\"sectionsJson\"]');
        if (target) {
          target.value = JSON.stringify(defaults, null, 2);
        }
        setMessage('Loaded default section guidance JSON.');
        return;
      }

      if (action === 'refresh-templates') {
        await loadTemplates();
        setMessage('Templates refreshed.');
      }
    } catch (error) {
      setMessage(error.message, 'error');
    }
  });

}

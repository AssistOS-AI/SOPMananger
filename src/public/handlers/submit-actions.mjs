import {
  handleCreateAutomationJob,
  handleRunAssuranceTask,
  handleRunGenerationTask,
  handleSendChatMessage,
} from './submit-long-actions.mjs';

export async function handleSubmit(event, ctx) {
  const {
    state,
    withBusy,
    api,
    checkedValues,
    loadSops,
    loadChatHistory,
    loadTasks,
    navigate,
    setMessage,
    loadUsers,
    collectEditorDocument,
    loadSopContext,
    loadTemplates,
    loadTraining,
    loadTrainingOverview,
  } = ctx;

  const form = event.target.closest('form[data-action]');
  if (!form) {
    return;
  }
  event.preventDefault();
  const action = form.dataset.action;

  if (['send-chat-message', 'run-assurance-task', 'run-generation-task'].includes(action)) {
    try {
      if (action === 'send-chat-message') {
        await handleSendChatMessage(form, ctx);
        return;
      }
      if (action === 'run-assurance-task') {
        await handleRunAssuranceTask(form, ctx);
        return;
      }
      if (action === 'run-generation-task') {
        await handleRunGenerationTask(form, ctx);
        return;
      }
    } catch (error) {
      setMessage(error.message, 'error');
      return;
    }
  }

  await withBusy(async () => {
    try {
      if (action === 'apply-sop-list-filter') {
        return;
      }

      if (action === 'login') {
        const username = form.querySelector('[name="username"]').value.trim();
        const password = form.querySelector('[name="password"]')?.value ?? '';
        const result = await api('/api/auth/login', {
          method: 'POST',
          body: { username, password },
        });
        state.session = result.user;
        state.csrfToken = result.csrfToken;
        await Promise.all([
          loadSops(),
          loadChatHistory(),
          loadTasks(),
        ]);
        navigate('/dashboard');
        return;
      }

      if (action === 'create-sop') {
        const title = form.querySelector('[name="title"]').value.trim();
        const area = form.querySelector('[name="area"]').value.trim();
        const targetRoles = checkedValues(form, 'targetRoles');
        const templateId = form.querySelector('[name="templateId"]').value.trim();
        const goal = form.querySelector('[name="goal"]').value.trim();
        const authoringInstructions = form.querySelector('[name="authoringInstructions"]').value.trim();
        const templateGuidanceNote = form.querySelector('[name="templateGuidanceNote"]').value.trim();
        const created = await api('/api/sops', {
          method: 'POST',
          body: {
            title,
            area,
            targetRoles,
            templateId: templateId || undefined,
            goal,
            authoringInstructions,
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
        state.editorDirty = false;
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

      if (action === 'create-automation-job') {
        await handleCreateAutomationJob(form, ctx);
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
        let sections;
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
      }
    } catch (error) {
      setMessage(error.message, 'error');
    }
  });
}

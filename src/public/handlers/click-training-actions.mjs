function currentTrainingFilter(state) {
  return {
    sopId: state.trainingFilterSopId === 'all' ? null : state.trainingFilterSopId,
    status: state.trainingFilterStatus === 'all' ? null : state.trainingFilterStatus,
  };
}

async function refreshTraining(ctx) {
  const {
    state,
    loadTraining,
    loadTrainingOverview,
  } = ctx;
  const { sopId, status } = currentTrainingFilter(state);
  await Promise.all([
    loadTraining({ sopId, status }),
    loadTrainingOverview({ sopId }),
  ]);
}

export async function handleTrainingClickAction(action, el, ctx) {
  const {
    api,
    setMessage,
  } = ctx;

  if (action === 'apply-training-filter') {
    await refreshTraining(ctx);
    setMessage('Training filter applied.');
    return true;
  }

  if (action === 'refresh-training') {
    await refreshTraining(ctx);
    setMessage('Training refreshed.');
    return true;
  }

  if (action === 'training-mark-read') {
    const taskId = el.dataset.taskId;
    await api(`/api/training/tasks/${encodeURIComponent(taskId)}/read`, {
      method: 'POST',
      body: {},
    });
    await refreshTraining(ctx);
    setMessage(`Read acknowledgement recorded for ${taskId}.`);
    return true;
  }

  if (action === 'training-signoff') {
    const taskId = el.dataset.taskId;
    if (!window.confirm('Confirm trainer sign-off for this training task?')) {
      return true;
    }
    await api(`/api/training/tasks/${encodeURIComponent(taskId)}/signoff`, {
      method: 'POST',
      body: {},
    });
    await refreshTraining(ctx);
    setMessage(`Training sign-off recorded for ${taskId}.`);
    return true;
  }

  if (action === 'training-submit-quiz-prompt') {
    const taskId = el.dataset.taskId;
    const scoreInput = window.prompt('Enter quiz score (0-100):', '90');
    if (scoreInput === null) {
      return true;
    }
    const score = Number(scoreInput);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error('Quiz score must be a number between 0 and 100.');
    }
    await api(`/api/training/tasks/${encodeURIComponent(taskId)}/quiz`, {
      method: 'POST',
      body: { score },
    });
    await refreshTraining(ctx);
    setMessage('Quiz result submitted.');
    return true;
  }

  return false;
}

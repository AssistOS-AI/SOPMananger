import { HttpError } from '../lib/http.mjs';

function toDate(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? null : date;
}

function nowIso() {
  return new Date().toISOString();
}

function isPrivileged(actor) {
  return ['admin', 'reviewer', 'approver'].includes(actor?.role);
}

function normalizeQuiz(task, trainingPolicy) {
  const quiz = task?.quiz && typeof task.quiz === 'object' ? task.quiz : {};
  const passScore = Number(quiz.passScore);
  const policyPassScore = Number(trainingPolicy?.quizPassScore);
  return {
    passScore: Number.isFinite(passScore) ? passScore : (Number.isFinite(policyPassScore) ? policyPassScore : 80),
    attempts: Number(quiz.attempts || 0),
    latestScore: Number.isFinite(Number(quiz.latestScore)) ? Number(quiz.latestScore) : null,
    passedAt: quiz.passedAt || null,
    history: Array.isArray(quiz.history) ? quiz.history : [],
  };
}

function computeStatus(task, trainingPolicy) {
  if (task.completedAt) {
    return 'completed';
  }

  const dueAtDate = toDate(task.dueAt);
  const overdue = dueAtDate ? dueAtDate.getTime() < Date.now() : false;
  const readDone = Boolean(task.readAcknowledgedAt);
  const quiz = normalizeQuiz(task, trainingPolicy);
  const quizPassed = Boolean(quiz.passedAt);
  const signoffRequired = Boolean(trainingPolicy?.requiresTrainerSignoff);
  const signoffDone = Boolean(task.trainerSignoffAt);

  if (readDone && quizPassed && (!signoffRequired || signoffDone)) {
    return 'completed';
  }
  if (overdue) {
    return 'overdue';
  }
  if (readDone || quiz.attempts > 0) {
    return 'in_progress';
  }
  return 'assigned';
}

function normalizeTask(task, trainingPolicy) {
  const quiz = normalizeQuiz(task, trainingPolicy);
  const status = computeStatus(task, trainingPolicy);
  const readDone = Boolean(task.readAcknowledgedAt);
  const quizPassed = Boolean(quiz.passedAt);
  const signoffRequired = Boolean(trainingPolicy?.requiresTrainerSignoff);
  const signoffDone = Boolean(task.trainerSignoffAt);
  const completed = status === 'completed';

  return {
    ...task,
    quiz,
    status,
    compliance: {
      readAcknowledged: readDone,
      quizPassed,
      signoffRequired,
      signoffCompleted: signoffDone,
      readyForSignoff: readDone && quizPassed && !signoffDone,
      complete: completed,
    },
  };
}

function assertNumericScore(score) {
  const value = Number(score);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new HttpError(400, 'Quiz score must be a number between 0 and 100.');
  }
  return Math.round(value);
}

export class TrainingService {
  constructor({ documentStore, auditStore, settingsService }) {
    this.documentStore = documentStore;
    this.auditStore = auditStore;
    this.settingsService = settingsService;
  }

  async _loadAllRaw() {
    const items = await this.documentStore.listTrainingTasks();
    return Array.isArray(items) ? items : [];
  }

  async _saveAllRaw(items) {
    await this.documentStore.saveTrainingTasks(items);
  }

  async _policy() {
    return this.settingsService.getTrainingPolicy();
  }

  async listTasks({ sopId = null, userId = null, status = null } = {}) {
    const [raw, policy] = await Promise.all([this._loadAllRaw(), this._policy()]);
    const normalized = raw.map((item) => normalizeTask(item, policy));
    return normalized
      .filter((task) => {
        if (sopId && task.sopId !== sopId) {
          return false;
        }
        if (userId && task.userId !== userId) {
          return false;
        }
        if (status && task.status !== status) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        const leftDue = toDate(left.dueAt)?.getTime() || Number.MAX_SAFE_INTEGER;
        const rightDue = toDate(right.dueAt)?.getTime() || Number.MAX_SAFE_INTEGER;
        if (leftDue !== rightDue) {
          return leftDue - rightDue;
        }
        return left.createdAt < right.createdAt ? 1 : -1;
      });
  }

  async getOverview({ sopId = null } = {}) {
    const tasks = await this.listTasks({ sopId });
    const summary = {
      total: tasks.length,
      assigned: 0,
      in_progress: 0,
      overdue: 0,
      completed: 0,
      signoffPending: 0,
      completionRate: 0,
    };
    const byRole = {};
    const byUser = {};

    for (const task of tasks) {
      summary[task.status] = (summary[task.status] || 0) + 1;
      if (task.compliance?.readyForSignoff) {
        summary.signoffPending += 1;
      }

      byRole[task.role || 'unassigned'] = byRole[task.role || 'unassigned'] || {
        role: task.role || 'unassigned',
        total: 0,
        completed: 0,
      };
      byRole[task.role || 'unassigned'].total += 1;
      if (task.status === 'completed') {
        byRole[task.role || 'unassigned'].completed += 1;
      }

      byUser[task.userId] = byUser[task.userId] || {
        userId: task.userId,
        username: task.username || task.userId,
        total: 0,
        completed: 0,
        overdue: 0,
      };
      byUser[task.userId].total += 1;
      if (task.status === 'completed') {
        byUser[task.userId].completed += 1;
      }
      if (task.status === 'overdue') {
        byUser[task.userId].overdue += 1;
      }
    }

    if (summary.total > 0) {
      summary.completionRate = Math.round((summary.completed / summary.total) * 100);
    }

    return {
      summary,
      byRole: Object.values(byRole).sort((a, b) => a.role.localeCompare(b.role)),
      byUser: Object.values(byUser).sort((a, b) => a.username.localeCompare(b.username)),
    };
  }

  async _updateTask(taskId, updater) {
    const [raw, policy] = await Promise.all([this._loadAllRaw(), this._policy()]);
    const index = raw.findIndex((item) => item.id === taskId);
    if (index === -1) {
      throw new HttpError(404, `Training task "${taskId}" not found.`);
    }

    const base = normalizeTask(raw[index], policy);
    const next = updater(base, policy) || base;
    const completedStatus = computeStatus(next, policy);
    const finalized = {
      ...next,
      status: completedStatus,
      updatedAt: nowIso(),
    };
    if (completedStatus === 'completed' && !finalized.completedAt) {
      finalized.completedAt = finalized.updatedAt;
    }

    raw[index] = finalized;
    await this._saveAllRaw(raw);
    return normalizeTask(finalized, policy);
  }

  async markRead({ taskId, actor, note = '' }) {
    if (!actor?.id) {
      throw new HttpError(401, 'Authentication required.');
    }

    const updated = await this._updateTask(taskId, (task) => {
      if (!isPrivileged(actor) && task.userId !== actor.id) {
        throw new HttpError(403, 'Cannot acknowledge read for another user.');
      }
      return {
        ...task,
        readAcknowledgedAt: nowIso(),
        readAcknowledgedBy: actor.id,
        readAcknowledgementNote: String(note || '').trim() || null,
      };
    });

    await this.auditStore.append({
      actorId: actor.id,
      action: 'training.task.read-ack',
      entityType: 'training-task',
      entityId: taskId,
      payload: {
        sopId: updated.sopId,
        userId: updated.userId,
      },
    });

    return updated;
  }

  async submitQuiz({ taskId, actor, score }) {
    if (!actor?.id) {
      throw new HttpError(401, 'Authentication required.');
    }
    const normalizedScore = assertNumericScore(score);

    const updated = await this._updateTask(taskId, (task, policy) => {
      if (!isPrivileged(actor) && task.userId !== actor.id) {
        throw new HttpError(403, 'Cannot submit quiz for another user.');
      }
      const quiz = normalizeQuiz(task, policy);
      const nextAttempts = quiz.attempts + 1;
      const passed = normalizedScore >= quiz.passScore;
      const history = quiz.history.concat({
        score: normalizedScore,
        submittedAt: nowIso(),
        actorId: actor.id,
      }).slice(-12);

      return {
        ...task,
        quiz: {
          ...quiz,
          attempts: nextAttempts,
          latestScore: normalizedScore,
          passedAt: passed ? (quiz.passedAt || nowIso()) : (quiz.passedAt || null),
          history,
        },
      };
    });

    await this.auditStore.append({
      actorId: actor.id,
      action: 'training.task.quiz-submit',
      entityType: 'training-task',
      entityId: taskId,
      payload: {
        sopId: updated.sopId,
        userId: updated.userId,
        score: updated.quiz.latestScore,
        passScore: updated.quiz.passScore,
      },
    });

    return updated;
  }

  async signoff({ taskId, actor, note = '' }) {
    if (!actor?.id) {
      throw new HttpError(401, 'Authentication required.');
    }
    if (!isPrivileged(actor)) {
      throw new HttpError(403, 'Only reviewer/approver/admin can sign off training.');
    }

    const updated = await this._updateTask(taskId, (task, policy) => {
      const quiz = normalizeQuiz(task, policy);
      if (!task.readAcknowledgedAt) {
        throw new HttpError(409, 'Read acknowledgement is required before sign-off.');
      }
      if (!quiz.passedAt) {
        throw new HttpError(409, 'Passing quiz result is required before sign-off.');
      }
      return {
        ...task,
        trainerSignoffAt: nowIso(),
        trainerSignoffBy: actor.id,
        trainerSignoffNote: String(note || '').trim() || null,
        completedAt: nowIso(),
      };
    });

    await this.auditStore.append({
      actorId: actor.id,
      action: 'training.task.signoff',
      entityType: 'training-task',
      entityId: taskId,
      payload: {
        sopId: updated.sopId,
        userId: updated.userId,
      },
    });

    return updated;
  }
}

import { randomUUID } from 'node:crypto';
import { HttpError } from '../lib/http.mjs';

function nowIso() {
  return new Date().toISOString();
}

export class TaskService {
  constructor({ maxTasks = 500 } = {}) {
    this.maxTasks = maxTasks;
    this.tasks = new Map();
  }

  _toPublic(task) {
    return {
      id: task.id,
      type: task.type,
      title: task.title,
      status: task.status,
      progress: task.progress,
      actorId: task.actorId,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      summary: task.summary,
      error: task.error,
      logs: task.logs,
      result: task.result,
      input: task.input,
    };
  }

  _trimHistory() {
    const items = [...this.tasks.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (items.length <= this.maxTasks) {
      return;
    }
    for (let index = this.maxTasks; index < items.length; index += 1) {
      this.tasks.delete(items[index].id);
    }
  }

  async createTask({ type, title, actorId, input = {}, runner }) {
    if (!type || typeof runner !== 'function') {
      throw new Error('Task type and runner are required.');
    }

    const task = {
      id: `task-${randomUUID().slice(0, 10)}`,
      type,
      title: title || type,
      actorId,
      input,
      status: 'queued',
      progress: 0,
      summary: '',
      error: null,
      result: null,
      logs: [{ at: nowIso(), level: 'info', message: 'Task queued.' }],
      createdAt: nowIso(),
      startedAt: null,
      finishedAt: null,
    };
    this.tasks.set(task.id, task);
    this._trimHistory();

    const update = ({ progress = null, message = null, level = 'info', summary = null }) => {
      if (typeof progress === 'number' && Number.isFinite(progress)) {
        task.progress = Math.max(0, Math.min(100, Math.round(progress)));
      }
      if (typeof summary === 'string') {
        task.summary = summary;
      }
      if (message) {
        task.logs.push({
          at: nowIso(),
          level,
          message: String(message),
        });
        if (task.logs.length > 200) {
          task.logs = task.logs.slice(-200);
        }
      }
    };

    (async () => {
      task.status = 'running';
      task.startedAt = nowIso();
      update({ progress: 3, message: 'Task execution started.' });
      try {
        const result = await runner({
          update,
          taskId: task.id,
          input,
        });
        task.result = result ?? null;
        task.status = 'completed';
        task.progress = 100;
        task.finishedAt = nowIso();
        update({ message: 'Task completed successfully.' });
      } catch (error) {
        task.status = 'failed';
        task.error = error?.message || 'Task execution failed.';
        task.finishedAt = nowIso();
        update({ level: 'error', message: task.error });
      }
    })();

    return this._toPublic(task);
  }

  listTasks({ actorId = null, type = null, limit = 100 } = {}) {
    let items = [...this.tasks.values()];
    if (actorId) {
      items = items.filter((task) => task.actorId === actorId);
    }
    if (type) {
      items = items.filter((task) => task.type === type);
    }
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return items.slice(0, Math.max(1, Number(limit || 100))).map((task) => this._toPublic(task));
  }

  getTask(taskId, { actorId = null, isAdmin = false } = {}) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new HttpError(404, `Task "${taskId}" not found.`);
    }
    if (!isAdmin && actorId && task.actorId !== actorId) {
      throw new HttpError(403, 'Task visibility denied.');
    }
    return this._toPublic(task);
  }
}

import { randomUUID } from 'node:crypto';
import { HttpError } from '../lib/http.mjs';

const JOB_TYPES = new Set(['assurance-scan', 'sop-draft-generation']);

function cleanList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((item) => String(item || '').trim()).filter(Boolean);
}

function nowIso() {
  return new Date().toISOString();
}

function computeNextRun(intervalMinutes, baseIso = nowIso()) {
  const base = new Date(baseIso);
  const next = new Date(base.getTime() + intervalMinutes * 60 * 1000);
  return next.toISOString();
}

function normalizeInput(input = {}) {
  return {
    selectedSopIds: cleanList(input.selectedSopIds),
    checks: cleanList(input.checks),
    highLevelSpec: String(input.highLevelSpec || '').trim(),
    constraints: String(input.constraints || '').trim(),
    narrative: String(input.narrative || '').trim(),
    title: String(input.title || '').trim(),
  };
}

function normalizeJob(job) {
  return {
    ...job,
    input: normalizeInput(job.input || {}),
  };
}

export class AutomationService {
  constructor({
    documentStore,
    auditStore,
    taskService,
    assuranceService,
    settingsService,
    tickMs = 15000,
  }) {
    this.documentStore = documentStore;
    this.auditStore = auditStore;
    this.taskService = taskService;
    this.assuranceService = assuranceService;
    this.settingsService = settingsService;
    this.tickMs = tickMs;
    this.timer = null;
    this.runningDue = false;
  }

  async initialize() {
    const jobs = await this.documentStore.listAutomationJobs();
    const normalized = Array.isArray(jobs) ? jobs.map((item) => normalizeJob(item)) : [];
    await this.documentStore.saveAutomationJobs(normalized);
  }

  start() {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runDueJobs();
    }, this.tickMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async listJobs() {
    const jobs = await this.documentStore.listAutomationJobs();
    return jobs
      .map((item) => normalizeJob(item))
      .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));
  }

  _normalizeType(value) {
    const type = String(value || '').trim();
    if (!JOB_TYPES.has(type)) {
      throw new HttpError(400, `Unsupported job type "${type}".`);
    }
    return type;
  }

  _normalizeInterval(value) {
    const intervalMinutes = Number(value);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 7 * 24 * 60) {
      throw new HttpError(400, 'intervalMinutes must be between 5 and 10080.');
    }
    return Math.round(intervalMinutes);
  }

  async createJob({ actor, payload = {} }) {
    if (!actor?.id) {
      throw new HttpError(401, 'Authenticated actor is required.');
    }
    const type = this._normalizeType(payload.type);
    const intervalMinutes = this._normalizeInterval(payload.intervalMinutes ?? 60);
    const title = String(payload.title || '').trim();
    if (!title) {
      throw new HttpError(400, 'Job title is required.');
    }
    const enabled = payload.enabled !== false;
    const now = nowIso();

    const job = normalizeJob({
      id: `job-${randomUUID().slice(0, 10)}`,
      title,
      type,
      enabled,
      intervalMinutes,
      nextRunAt: enabled ? computeNextRun(intervalMinutes, now) : null,
      lastRunAt: null,
      lastTaskId: null,
      input: payload.input || {},
      createdAt: now,
      createdBy: actor.id,
      updatedAt: now,
      updatedBy: actor.id,
    });

    const jobs = await this.documentStore.listAutomationJobs();
    jobs.push(job);
    await this.documentStore.saveAutomationJobs(jobs);

    await this.auditStore.append({
      actorId: actor.id,
      action: 'automation.job.create',
      entityType: 'automation-job',
      entityId: job.id,
      payload: {
        type: job.type,
        intervalMinutes: job.intervalMinutes,
        enabled: job.enabled,
      },
    });

    return job;
  }

  async updateJob({ actor, jobId, patch = {} }) {
    if (!actor?.id) {
      throw new HttpError(401, 'Authenticated actor is required.');
    }
    const jobs = await this.documentStore.listAutomationJobs();
    const index = jobs.findIndex((item) => item.id === jobId);
    if (index === -1) {
      throw new HttpError(404, `Automation job "${jobId}" not found.`);
    }
    const current = normalizeJob(jobs[index]);

    const nextType = patch.type ? this._normalizeType(patch.type) : current.type;
    const nextInterval = patch.intervalMinutes != null
      ? this._normalizeInterval(patch.intervalMinutes)
      : current.intervalMinutes;
    const nextEnabled = patch.enabled != null ? Boolean(patch.enabled) : current.enabled;
    const now = nowIso();

    const updated = normalizeJob({
      ...current,
      type: nextType,
      title: patch.title != null ? String(patch.title || '').trim() : current.title,
      intervalMinutes: nextInterval,
      enabled: nextEnabled,
      input: patch.input != null ? patch.input : current.input,
      updatedAt: now,
      updatedBy: actor.id,
    });

    if (!updated.title) {
      throw new HttpError(400, 'Job title is required.');
    }

    if (!updated.enabled) {
      updated.nextRunAt = null;
    } else {
      const previousDue = new Date(current.nextRunAt || 0).getTime();
      updated.nextRunAt = Number.isFinite(previousDue) && previousDue > Date.now()
        ? current.nextRunAt
        : computeNextRun(updated.intervalMinutes, now);
    }

    jobs[index] = updated;
    await this.documentStore.saveAutomationJobs(jobs);

    await this.auditStore.append({
      actorId: actor.id,
      action: 'automation.job.update',
      entityType: 'automation-job',
      entityId: updated.id,
      payload: {
        type: updated.type,
        intervalMinutes: updated.intervalMinutes,
        enabled: updated.enabled,
      },
    });

    return updated;
  }

  async _spawnTaskForJob(job, { actorId }) {
    const profile = await this.settingsService.getRegulatoryProfile();
    if (job.type === 'assurance-scan') {
      return this.taskService.createTask({
        type: 'assurance-scan',
        title: job.title,
        actorId,
        input: {
          ...job.input,
          regulatoryProfile: profile,
        },
        runner: async ({ update, input }) => this.assuranceService.runAssuranceTask({ update, input }),
      });
    }

    if (job.type === 'sop-draft-generation') {
      return this.taskService.createTask({
        type: 'sop-draft-generation',
        title: job.title,
        actorId,
        input: {
          ...job.input,
          regulatoryProfile: profile,
        },
        runner: async ({ update, input }) => this.assuranceService.runDraftGenerationTask({ update, input }),
      });
    }

    throw new HttpError(400, `Unsupported job type "${job.type}".`);
  }

  async runJobNow({ actor, jobId, trigger = 'manual' }) {
    const jobs = await this.documentStore.listAutomationJobs();
    const index = jobs.findIndex((item) => item.id === jobId);
    if (index === -1) {
      throw new HttpError(404, `Automation job "${jobId}" not found.`);
    }
    const job = normalizeJob(jobs[index]);
    const task = await this._spawnTaskForJob(job, { actorId: actor?.id || 'system' });
    const now = nowIso();

    const updated = {
      ...job,
      lastRunAt: now,
      lastTaskId: task.id,
      nextRunAt: job.enabled ? computeNextRun(job.intervalMinutes, now) : null,
      updatedAt: now,
      updatedBy: actor?.id || 'system',
    };
    jobs[index] = updated;
    await this.documentStore.saveAutomationJobs(jobs);

    await this.auditStore.append({
      actorId: actor?.id || 'system',
      action: 'automation.job.run',
      entityType: 'automation-job',
      entityId: job.id,
      payload: {
        trigger,
        taskId: task.id,
      },
    });

    return {
      job: updated,
      task,
    };
  }

  async runDueJobs() {
    if (this.runningDue) {
      return;
    }
    this.runningDue = true;
    try {
      const jobs = await this.listJobs();
      const now = Date.now();
      for (const job of jobs) {
        if (!job.enabled || !job.nextRunAt) {
          continue;
        }
        const dueAt = new Date(job.nextRunAt).getTime();
        if (!Number.isFinite(dueAt) || dueAt > now) {
          continue;
        }
        try {
          await this.runJobNow({
            actor: { id: 'system', role: 'admin' },
            jobId: job.id,
            trigger: 'scheduler',
          });
        } catch {
          // ignore scheduler errors; task/audit handles traceability for successful runs
        }
      }
    } finally {
      this.runningDue = false;
    }
  }
}

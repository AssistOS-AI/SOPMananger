import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import {
  ensureDir,
  fileExists,
  readJson,
  writeJsonAtomic,
  listSubdirectories,
} from './json-store.mjs';

export class DocumentStore {
  constructor({ dataRoot, workspaceId = 'default' }) {
    this.dataRoot = dataRoot;
    this.workspaceId = workspaceId;
  }

  get workspacePath() {
    return path.join(this.dataRoot, 'workspaces', this.workspaceId);
  }

  get usersFilePath() {
    return path.join(this.workspacePath, 'users', 'users.json');
  }

  get settingsFilePath() {
    return path.join(this.workspacePath, 'settings', 'workspace-settings.json');
  }

  get automationJobsFilePath() {
    return path.join(this.workspacePath, 'automation', 'jobs.json');
  }

  get templatesFilePath() {
    return path.join(this.workspacePath, 'templates', 'templates.json');
  }

  get trainingFilePath() {
    return path.join(this.workspacePath, 'training', 'tasks.json');
  }

  get chatHistoriesFilePath() {
    return path.join(this.workspacePath, 'chat', 'histories.json');
  }

  get sopsRoot() {
    return path.join(this.workspacePath, 'sops');
  }

  get blocksRoot() {
    return path.join(this.workspacePath, 'blocks');
  }

  sopPath(sopId) {
    return path.join(this.sopsRoot, sopId);
  }

  sopMetaPath(sopId) {
    return path.join(this.sopPath(sopId), 'meta.json');
  }

  sopVersionsPath(sopId) {
    return path.join(this.sopPath(sopId), 'versions');
  }

  sopVersionPath(sopId, versionId) {
    return path.join(this.sopVersionsPath(sopId), `${versionId}.json`);
  }

  sopReviewCommentsPath(sopId) {
    return path.join(this.sopPath(sopId), 'review-comments.json');
  }

  blockPath(blockId) {
    return path.join(this.blocksRoot, `${blockId}.json`);
  }

  async ensureWorkspace() {
    const base = this.workspacePath;
    const dirs = [
      path.join(base, 'users'),
      path.join(base, 'settings'),
      path.join(base, 'automation'),
      path.join(base, 'templates'),
      path.join(base, 'sops'),
      path.join(base, 'blocks'),
      path.join(base, 'process-models'),
      path.join(base, 'training'),
      path.join(base, 'chat'),
      path.join(base, 'indexes'),
      path.join(base, 'audit'),
    ];

    await Promise.all(dirs.map((dir) => ensureDir(dir)));

    if (!(await fileExists(this.trainingFilePath))) {
      await writeJsonAtomic(this.trainingFilePath, []);
    }
    if (!(await fileExists(this.settingsFilePath))) {
      await writeJsonAtomic(this.settingsFilePath, {});
    }
    if (!(await fileExists(this.automationJobsFilePath))) {
      await writeJsonAtomic(this.automationJobsFilePath, []);
    }
    if (!(await fileExists(this.templatesFilePath))) {
      await writeJsonAtomic(this.templatesFilePath, []);
    }
    if (!(await fileExists(this.chatHistoriesFilePath))) {
      await writeJsonAtomic(this.chatHistoriesFilePath, {});
    }
  }

  async listSops() {
    const sopIds = await listSubdirectories(this.sopsRoot);
    const result = [];

    for (const sopId of sopIds) {
      const meta = await readJson(this.sopMetaPath(sopId));
      if (meta) {
        result.push(meta);
      }
    }

    result.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return result;
  }

  async getSopMeta(sopId) {
    const meta = await readJson(this.sopMetaPath(sopId));
    return meta ?? null;
  }

  async saveSopMeta(sopId, meta) {
    await writeJsonAtomic(this.sopMetaPath(sopId), meta);
    return meta;
  }

  async getVersion(sopId, versionId) {
    const version = await readJson(this.sopVersionPath(sopId, versionId));
    return version ?? null;
  }

  async getLatestVersion(sopId) {
    const meta = await this.getSopMeta(sopId);
    if (!meta || !meta.currentVersionId) {
      return null;
    }
    return this.getVersion(sopId, meta.currentVersionId);
  }

  async getSop(sopId) {
    const meta = await this.getSopMeta(sopId);
    if (!meta) {
      return null;
    }
    const latestVersion = await this.getLatestVersion(sopId);
    return { meta, latestVersion };
  }

  async createSop({ sopId = randomUUID(), meta, initialDocument, actorId, changeSummary = 'Initial draft' }) {
    const sopDir = this.sopPath(sopId);
    if (await fileExists(this.sopMetaPath(sopId))) {
      throw new Error(`SOP "${sopId}" already exists.`);
    }

    await ensureDir(sopDir);
    await ensureDir(this.sopVersionsPath(sopId));
    await writeJsonAtomic(this.sopReviewCommentsPath(sopId), []);

    const now = new Date().toISOString();
    const storedMeta = {
      id: sopId,
      status: 'Draft',
      versionCounter: 0,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
      ...meta,
    };

    await this.saveSopMeta(sopId, storedMeta);
    const version = await this.createVersion({
      sopId,
      document: initialDocument,
      actorId,
      changeSummary,
    });

    return {
      meta: await this.getSopMeta(sopId),
      version,
    };
  }

  async createVersion({ sopId, document, actorId, changeSummary = 'Updated draft' }) {
    const meta = await this.getSopMeta(sopId);
    if (!meta) {
      throw new Error(`SOP "${sopId}" not found.`);
    }

    const nextCounter = Number(meta.versionCounter || 0) + 1;
    const versionId = `v${nextCounter}`;
    const createdAt = new Date().toISOString();

    const versionRecord = {
      sopId,
      versionId,
      createdAt,
      actorId,
      changeSummary,
      document,
    };

    await writeJsonAtomic(this.sopVersionPath(sopId, versionId), versionRecord);

    const updatedMeta = {
      ...meta,
      versionCounter: nextCounter,
      currentVersionId: versionId,
      updatedAt: createdAt,
    };

    await this.saveSopMeta(sopId, updatedMeta);
    return versionRecord;
  }

  async updateSopMeta(sopId, patch) {
    const meta = await this.getSopMeta(sopId);
    if (!meta) {
      throw new Error(`SOP "${sopId}" not found.`);
    }

    const updated = {
      ...meta,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    await this.saveSopMeta(sopId, updated);
    return updated;
  }

  async listTrainingTasks() {
    return readJson(this.trainingFilePath, []);
  }

  async queryTrainingTasks({ sopId = null, userId = null } = {}) {
    const tasks = await this.listTrainingTasks();
    return tasks.filter((task) => {
      if (sopId && task.sopId !== sopId) {
        return false;
      }
      if (userId && task.userId !== userId) {
        return false;
      }
      return true;
    });
  }

  async appendTrainingTasks(tasks) {
    const existing = await this.listTrainingTasks();
    const merged = existing.concat(tasks);
    await writeJsonAtomic(this.trainingFilePath, merged);
    return tasks;
  }

  async saveTrainingTasks(tasks) {
    const normalized = Array.isArray(tasks) ? tasks : [];
    await writeJsonAtomic(this.trainingFilePath, normalized);
    return normalized;
  }

  async getWorkspaceSettings() {
    return readJson(this.settingsFilePath, {});
  }

  async saveWorkspaceSettings(settings) {
    const payload = settings && typeof settings === 'object' ? settings : {};
    await writeJsonAtomic(this.settingsFilePath, payload);
    return payload;
  }

  async listAutomationJobs() {
    const jobs = await readJson(this.automationJobsFilePath, []);
    return Array.isArray(jobs) ? jobs : [];
  }

  async saveAutomationJobs(jobs) {
    const payload = Array.isArray(jobs) ? jobs : [];
    await writeJsonAtomic(this.automationJobsFilePath, payload);
    return payload;
  }

  async listTemplates() {
    const items = await readJson(this.templatesFilePath, []);
    return Array.isArray(items) ? items : [];
  }

  async saveTemplates(templates) {
    const payload = Array.isArray(templates) ? templates : [];
    await writeJsonAtomic(this.templatesFilePath, payload);
    return payload;
  }

  async _loadChatHistories() {
    const payload = await readJson(this.chatHistoriesFilePath, {});
    return payload && typeof payload === 'object' ? payload : {};
  }

  async getChatHistory(userId) {
    const histories = await this._loadChatHistories();
    const items = histories[userId];
    return Array.isArray(items) ? items : [];
  }

  async saveChatHistory(userId, items) {
    const histories = await this._loadChatHistories();
    histories[userId] = Array.isArray(items) ? items : [];
    await writeJsonAtomic(this.chatHistoriesFilePath, histories);
    return histories[userId];
  }

  async listVersions(sopId) {
    const versionsDir = this.sopVersionsPath(sopId);
    try {
      const entries = await fs.readdir(versionsDir, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name.slice(0, -5));

      const versions = [];
      for (const versionId of files) {
        const version = await this.getVersion(sopId, versionId);
        if (version) {
          versions.push(version);
        }
      }

      versions.sort((a, b) => (a.versionId < b.versionId ? -1 : 1));
      return versions;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async listBlocks() {
    try {
      const entries = await fs.readdir(this.blocksRoot, { withFileTypes: true });
      const blocks = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
          continue;
        }
        const block = await readJson(path.join(this.blocksRoot, entry.name));
        if (block) {
          blocks.push(block);
        }
      }
      blocks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return blocks;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async getBlock(blockId) {
    return readJson(this.blockPath(blockId), null);
  }

  async createBlock({
    blockId = `block-${randomUUID().slice(0, 8)}`,
    title,
    contentTemplate,
    parameterSchema = [],
    mode = 'linked',
    actorId,
  }) {
    if (await fileExists(this.blockPath(blockId))) {
      throw new Error(`Block "${blockId}" already exists.`);
    }

    const now = new Date().toISOString();
    const block = {
      id: blockId,
      title: title || 'Untitled Block',
      contentTemplate: contentTemplate || '',
      parameterSchema: Array.isArray(parameterSchema) ? parameterSchema : [],
      mode: mode === 'detached' ? 'detached' : 'linked',
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    };

    await writeJsonAtomic(this.blockPath(blockId), block);
    return block;
  }

  async listReviewComments(sopId) {
    return readJson(this.sopReviewCommentsPath(sopId), []);
  }

  async addReviewComment({ sopId, sectionPath, text, actor }) {
    const existing = await this.listReviewComments(sopId);
    const now = new Date().toISOString();
    const comment = {
      id: `c-${randomUUID().slice(0, 8)}`,
      sectionPath: sectionPath || '',
      text: text || '',
      status: 'open',
      authorId: actor.id,
      authorRole: actor.role,
      createdAt: now,
      updatedAt: now,
      resolvedBy: null,
      resolvedAt: null,
    };
    existing.push(comment);
    await writeJsonAtomic(this.sopReviewCommentsPath(sopId), existing);
    return comment;
  }

  async resolveReviewComment({ sopId, commentId, actor }) {
    const existing = await this.listReviewComments(sopId);
    const now = new Date().toISOString();
    const updated = existing.map((comment) => {
      if (comment.id !== commentId) {
        return comment;
      }
      return {
        ...comment,
        status: 'resolved',
        resolvedBy: actor.id,
        resolvedAt: now,
        updatedAt: now,
      };
    });

    const found = updated.find((comment) => comment.id === commentId);
    if (!found) {
      return null;
    }

    await writeJsonAtomic(this.sopReviewCommentsPath(sopId), updated);
    return found;
  }
}

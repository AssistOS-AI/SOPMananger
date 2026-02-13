import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  appendJsonLine,
  ensureDir,
  readJson,
  readJsonLines,
  writeJsonAtomic,
} from './json-store.mjs';

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value && typeof value === 'object') {
    const sorted = Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableValue(value[key]);
        return acc;
      }, {});
    return sorted;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export class AuditStore {
  constructor({ workspacePath }) {
    this.auditDir = path.join(workspacePath, 'audit');
    this.logPath = path.join(this.auditDir, 'audit.log.jsonl');
    this.statePath = path.join(this.auditDir, 'state.json');
    this.genesisHash = 'GENESIS';
  }

  async initialize() {
    await ensureDir(this.auditDir);
    const state = await readJson(this.statePath, null);
    if (!state) {
      await writeJsonAtomic(this.statePath, {
        lastHash: this.genesisHash,
        count: 0,
      });
    }
  }

  async _readState() {
    const state = await readJson(this.statePath, null);
    if (state) {
      return state;
    }
    return {
      lastHash: this.genesisHash,
      count: 0,
    };
  }

  _computeHash(recordWithoutHash) {
    return sha256(stableStringify(recordWithoutHash));
  }

  async append({ actorId, action, entityType, entityId, payload = {} }) {
    const now = new Date().toISOString();
    const state = await this._readState();
    const prevHash = state.lastHash || this.genesisHash;
    const payloadHash = sha256(stableStringify(payload));

    const baseRecord = {
      eventId: randomUUID(),
      timestamp: now,
      actorId,
      action,
      entityType,
      entityId,
      payloadHash,
      payload,
      prevHash,
    };

    const hash = this._computeHash(baseRecord);
    const record = { ...baseRecord, hash };

    await appendJsonLine(this.logPath, record);
    await writeJsonAtomic(this.statePath, {
      lastHash: hash,
      count: Number(state.count || 0) + 1,
      updatedAt: now,
    });

    return record;
  }

  async readAll() {
    return readJsonLines(this.logPath);
  }

  async verify() {
    const records = await this.readAll();
    const state = await this._readState();

    let expectedPrev = this.genesisHash;

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record.prevHash !== expectedPrev) {
        return {
          ok: false,
          reason: 'Broken previous hash link.',
          index,
          expectedPrev,
          actualPrev: record.prevHash,
        };
      }

      const { hash, ...withoutHash } = record;
      const computed = this._computeHash(withoutHash);
      if (hash !== computed) {
        return {
          ok: false,
          reason: 'Hash mismatch.',
          index,
          expectedHash: computed,
          actualHash: hash,
        };
      }

      expectedPrev = hash;
    }

    if (records.length !== Number(state.count || 0)) {
      return {
        ok: false,
        reason: 'State count does not match log size.',
        expectedCount: records.length,
        actualCount: state.count,
      };
    }

    if (expectedPrev !== (state.lastHash || this.genesisHash)) {
      return {
        ok: false,
        reason: 'State last hash does not match log tail hash.',
        expectedLastHash: expectedPrev,
        actualLastHash: state.lastHash,
      };
    }

    return {
      ok: true,
      count: records.length,
      lastHash: expectedPrev,
    };
  }
}

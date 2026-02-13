import { HttpError } from '../lib/http.mjs';

export const ASSURANCE_CHECK_CATALOG = [
  { id: 'internal_consistency', label: 'Internal SOP consistency' },
  { id: 'cross_sop_consistency', label: 'Cross-SOP consistency' },
  { id: 'terminology_consistency', label: 'Terminology consistency' },
  { id: 'role_traceability', label: 'Role accountability traceability' },
  { id: 'record_integrity', label: 'Record integrity and retention' },
  { id: 'gxp_baseline', label: 'GxP baseline controls' },
  { id: 'fda_part_11', label: '21 CFR Part 11 expectations' },
  { id: 'eu_annex_11', label: 'EU Annex 11 expectations' },
  { id: 'national_regulations', label: 'National authority requirements' },
  { id: 'internal_policies', label: 'Internal policy controls' },
];

export const DEFAULT_REGULATORY_PROFILE = {
  profileName: 'Global GxP Baseline',
  regulations: [
    'GxP Baseline',
    'FDA 21 CFR Part 11',
    'EU Annex 11',
  ],
  nationalInstitutions: [
    'FDA',
    'EMA',
    'ANMDMR',
  ],
  internalPolicies: [
    'Document Control',
    'Data Integrity',
    'Training and Competency',
    'Change Control',
  ],
  assuranceChecks: ASSURANCE_CHECK_CATALOG.map((item) => item.id),
  trainingPolicy: {
    dueDays: 30,
    quizPassScore: 80,
    requiresTrainerSignoff: true,
    retrainingOnMajorRevision: true,
  },
};

export const DEFAULT_SOP_CODE_POLICY = {
  pattern: 'SOP-{AREA}-{YYYY}-{SEQ4}',
  nextSequence: 1,
};

function cleanList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeTrainingPolicy(policy = {}) {
  const dueDays = Number(policy.dueDays);
  const quizPassScore = Number(policy.quizPassScore);
  return {
    dueDays: Number.isFinite(dueDays) && dueDays >= 1 && dueDays <= 365 ? Math.round(dueDays) : 30,
    quizPassScore: Number.isFinite(quizPassScore) && quizPassScore >= 0 && quizPassScore <= 100
      ? Math.round(quizPassScore)
      : 80,
    requiresTrainerSignoff: Boolean(policy.requiresTrainerSignoff),
    retrainingOnMajorRevision: Boolean(policy.retrainingOnMajorRevision),
  };
}

function normalizeProfile(profile = {}) {
  const regulations = cleanList(profile.regulations);
  const institutions = cleanList(profile.nationalInstitutions);
  const internalPolicies = cleanList(profile.internalPolicies);
  const checks = cleanList(profile.assuranceChecks);
  const allowedCheckIds = new Set(ASSURANCE_CHECK_CATALOG.map((item) => item.id));
  const normalizedChecks = checks.filter((id) => allowedCheckIds.has(id));

  return {
    profileName: String(profile.profileName || '').trim() || DEFAULT_REGULATORY_PROFILE.profileName,
    regulations: regulations.length ? unique(regulations) : DEFAULT_REGULATORY_PROFILE.regulations,
    nationalInstitutions: institutions.length ? unique(institutions) : DEFAULT_REGULATORY_PROFILE.nationalInstitutions,
    internalPolicies: internalPolicies.length ? unique(internalPolicies) : DEFAULT_REGULATORY_PROFILE.internalPolicies,
    assuranceChecks: normalizedChecks.length ? unique(normalizedChecks) : DEFAULT_REGULATORY_PROFILE.assuranceChecks,
    trainingPolicy: normalizeTrainingPolicy(profile.trainingPolicy),
  };
}

function normalizeSopCodePolicy(policy = {}) {
  const pattern = String(policy.pattern || '').trim() || DEFAULT_SOP_CODE_POLICY.pattern;
  const nextSequence = Number(policy.nextSequence);
  return {
    pattern,
    nextSequence: Number.isFinite(nextSequence) && nextSequence >= 1
      ? Math.round(nextSequence)
      : DEFAULT_SOP_CODE_POLICY.nextSequence,
  };
}

function toAreaCode(areaValue = '') {
  const cleaned = String(areaValue || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .trim();
  if (!cleaned) {
    return 'GEN';
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.slice(0, 4).map((word) => word[0]).join('');
  }
  return words[0].slice(0, 4);
}

function applySequencePattern(pattern, sequence) {
  let output = pattern;
  output = output.replace(/\{SEQ(\d+)\}/g, (_, digitsRaw) => {
    const digits = Number(digitsRaw);
    const width = Number.isFinite(digits) && digits > 0 ? digits : 4;
    return String(sequence).padStart(width, '0');
  });
  output = output.replace(/\{SEQ\}/g, String(sequence).padStart(4, '0'));
  return output;
}

function formatSopCode({ pattern, area, sequence, now = new Date() }) {
  let output = String(pattern || DEFAULT_SOP_CODE_POLICY.pattern);
  output = output.replace(/\{AREA\}/g, toAreaCode(area));
  output = output.replace(/\{YYYY\}/g, String(now.getFullYear()));
  output = output.replace(/\{YY\}/g, String(now.getFullYear()).slice(-2));
  output = applySequencePattern(output, sequence);
  return output;
}

function normalizeSettings(settings = {}) {
  const profile = normalizeProfile({
    ...DEFAULT_REGULATORY_PROFILE,
    ...settings.regulatoryProfile,
    trainingPolicy: {
      ...DEFAULT_REGULATORY_PROFILE.trainingPolicy,
      ...(settings.regulatoryProfile?.trainingPolicy || {}),
    },
  });
  return {
    regulatoryProfile: profile,
    sopCodePolicy: normalizeSopCodePolicy(settings.sopCodePolicy),
    updatedAt: settings.updatedAt || null,
    updatedBy: settings.updatedBy || null,
  };
}

export class SettingsService {
  constructor({ documentStore, auditStore = null }) {
    this.documentStore = documentStore;
    this.auditStore = auditStore;
  }

  async initialize() {
    const settings = await this.documentStore.getWorkspaceSettings();
    const normalized = normalizeSettings(settings || {});
    await this.documentStore.saveWorkspaceSettings(normalized);
  }

  async getSettings() {
    const settings = await this.documentStore.getWorkspaceSettings();
    return normalizeSettings(settings || {});
  }

  async getRegulatoryProfile() {
    const settings = await this.getSettings();
    return settings.regulatoryProfile;
  }

  async getTrainingPolicy() {
    const profile = await this.getRegulatoryProfile();
    return profile.trainingPolicy;
  }

  async getSopCodePolicy() {
    const settings = await this.getSettings();
    return settings.sopCodePolicy;
  }

  async updateRegulatoryProfile({ actor, payload }) {
    if (!actor?.id) {
      throw new HttpError(401, 'Authenticated actor is required.');
    }
    const current = await this.getSettings();
    const nextProfile = normalizeProfile({
      ...current.regulatoryProfile,
      ...(payload || {}),
      trainingPolicy: {
        ...(current.regulatoryProfile?.trainingPolicy || {}),
        ...(payload?.trainingPolicy || {}),
      },
    });
    const updated = {
      ...current,
      regulatoryProfile: nextProfile,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.id,
    };
    await this.documentStore.saveWorkspaceSettings(updated);

    if (this.auditStore) {
      await this.auditStore.append({
        actorId: actor.id,
        action: 'settings.regulatory-profile.update',
        entityType: 'settings',
        entityId: 'regulatory-profile',
        payload: {
          profileName: nextProfile.profileName,
          assuranceChecks: nextProfile.assuranceChecks,
          dueDays: nextProfile.trainingPolicy.dueDays,
          quizPassScore: nextProfile.trainingPolicy.quizPassScore,
          requiresTrainerSignoff: nextProfile.trainingPolicy.requiresTrainerSignoff,
        },
      });
    }

    return updated;
  }

  async updateSopCodePolicy({ actor, payload }) {
    if (!actor?.id) {
      throw new HttpError(401, 'Authenticated actor is required.');
    }
    const current = await this.getSettings();
    const nextPolicy = normalizeSopCodePolicy({
      ...current.sopCodePolicy,
      ...(payload || {}),
    });
    const updated = {
      ...current,
      sopCodePolicy: nextPolicy,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.id,
    };
    await this.documentStore.saveWorkspaceSettings(updated);

    if (this.auditStore) {
      await this.auditStore.append({
        actorId: actor.id,
        action: 'settings.sop-code-policy.update',
        entityType: 'settings',
        entityId: 'sop-code-policy',
        payload: nextPolicy,
      });
    }

    return updated;
  }

  async allocateSopCode({ actor, area = 'General' } = {}) {
    const current = await this.getSettings();
    const policy = normalizeSopCodePolicy(current.sopCodePolicy);
    const sequence = policy.nextSequence;
    const code = formatSopCode({
      pattern: policy.pattern,
      area,
      sequence,
      now: new Date(),
    });

    const updated = {
      ...current,
      sopCodePolicy: {
        ...policy,
        nextSequence: sequence + 1,
      },
      updatedAt: new Date().toISOString(),
      updatedBy: actor?.id || current.updatedBy || null,
    };
    await this.documentStore.saveWorkspaceSettings(updated);

    if (this.auditStore) {
      await this.auditStore.append({
        actorId: actor?.id || 'system',
        action: 'settings.sop-code.allocate',
        entityType: 'settings',
        entityId: 'sop-code-policy',
        payload: {
          code,
          sequence,
          area,
          pattern: policy.pattern,
        },
      });
    }

    return code;
  }
}

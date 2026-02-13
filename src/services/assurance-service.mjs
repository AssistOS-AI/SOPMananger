function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeRegulatoryProfile(profile = {}) {
  const regulations = cleanList(profile.regulations);
  const nationalInstitutions = cleanList(profile.nationalInstitutions);
  const internalPolicies = cleanList(profile.internalPolicies);
  const assuranceChecks = cleanList(profile.assuranceChecks);
  return {
    profileName: String(profile.profileName || '').trim() || 'Workspace Regulatory Profile',
    regulations,
    nationalInstitutions,
    internalPolicies,
    assuranceChecks,
    trainingPolicy: profile.trainingPolicy && typeof profile.trainingPolicy === 'object'
      ? profile.trainingPolicy
      : {},
  };
}

function shortText(value, max = 420) {
  const text = String(value || '').trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

function toSopDigest(sop) {
  const document = sop.latestVersion?.document || {};
  const sections = Array.isArray(document.sections) ? document.sections : [];
  const references = Array.isArray(document.references) ? document.references : [];
  return {
    id: sop.meta.id,
    code: sop.meta.code,
    title: sop.meta.title,
    status: sop.meta.status,
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      text: shortText(section.text, 220),
    })),
    references: references.map((ref) => ({
      label: ref.label || '',
      type: ref.type || '',
      target: ref.target || '',
    })),
  };
}

function fallbackCheckResult(id, label, findings = []) {
  if (!findings.length) {
    return { id, label, status: 'pass', findings: [] };
  }
  const hasCritical = findings.some((item) => item.severity === 'critical');
  return {
    id,
    label,
    status: hasCritical ? 'fail' : 'warn',
    findings,
  };
}

function buildFallbackAssuranceResult({
  checks,
  digests,
  selectedSopIds,
  regulatoryProfile,
}) {
  const findingsByCheck = new Map();
  for (const checkId of checks) {
    findingsByCheck.set(checkId, []);
  }

  const requiredSectionIds = ['purpose', 'scope', 'responsibilities', 'procedure', 'records', 'exceptions'];
  const availableCodes = new Set(digests.map((item) => item.code));

  for (const sop of digests) {
    const sectionIds = new Set(sop.sections.map((section) => String(section.id || '').toLowerCase()));
    if (findingsByCheck.has('internal_consistency')) {
      for (const sectionId of requiredSectionIds) {
        if (!sectionIds.has(sectionId)) {
          findingsByCheck.get('internal_consistency').push({
            severity: 'critical',
            sopId: sop.id,
            message: `Missing required section "${sectionId}" in ${sop.code}.`,
          });
        }
      }
    }

    if (findingsByCheck.has('cross_sop_consistency')) {
      for (const reference of sop.references) {
        if (reference.type === 'sop' && reference.target && !availableCodes.has(reference.target) && !digests.some((item) => item.id === reference.target)) {
          findingsByCheck.get('cross_sop_consistency').push({
            severity: 'major',
            sopId: sop.id,
            message: `Reference target "${reference.target}" was not found in visible corpus.`,
          });
        }
      }
    }

    if (findingsByCheck.has('terminology_consistency')) {
      const hasNeeded = sop.sections.some((section) => section.text.toLowerCase().includes('as needed'));
      if (hasNeeded) {
        findingsByCheck.get('terminology_consistency').push({
          severity: 'major',
          sopId: sop.id,
          message: 'Contains ambiguous phrase "as needed".',
        });
      }
    }
  }

  const checksResult = checks.map((checkId) => {
    const label = checkId.replaceAll('_', ' ');
    return fallbackCheckResult(checkId, label, findingsByCheck.get(checkId) || []);
  });

  const totalFindings = checksResult.reduce((acc, item) => acc + item.findings.length, 0);
  const score = Math.max(5, 100 - totalFindings * 8);

  const regulations = regulatoryProfile?.regulations || [];
  const institutions = regulatoryProfile?.nationalInstitutions || [];
  const internalPolicies = regulatoryProfile?.internalPolicies || [];

  return {
    generatedAt: new Date().toISOString(),
    scope: selectedSopIds?.length ? `Selected SOPs (${selectedSopIds.length})` : 'Workspace-wide',
    score,
    summary: totalFindings
      ? `Detected ${totalFindings} findings across ${checksResult.length} assurance dimensions.`
      : 'No issues detected by fallback deterministic checks.',
    checks: checksResult,
    crossSopConflicts: checksResult
      .flatMap((item) => item.findings.map((finding) => ({ checkId: item.id, ...finding })))
      .slice(0, 30),
    regulatoryCoverage: [
      ...regulations.map((name) => ({ name, status: 'reviewed' })),
      ...institutions.map((name) => ({ name: `${name} guidance`, status: 'reviewed' })),
      ...internalPolicies.map((name) => ({ name: `Internal policy: ${name}`, status: 'reviewed' })),
    ],
    recommendations: [
      'Resolve all critical and major findings before release.',
      'Replace ambiguous terms with measurable criteria.',
      'Re-run assurance scan after each major SOP update.',
    ],
  };
}

function fallbackDraftGeneration({ title, highLevelSpec, constraints, narrative }) {
  const draftTitle = title || 'Generated SOP Draft';
  return {
    title: draftTitle,
    sections: [
      { id: 'purpose', title: 'Purpose', text: highLevelSpec || '[CONFIRM] Provide SOP purpose.' },
      { id: 'scope', title: 'Scope', text: '[CONFIRM] Define scope and boundaries.' },
      { id: 'constraints', title: 'Hard Constraints', text: constraints || '[CONFIRM] List hard constraints.' },
      { id: 'procedure', title: 'Procedure', text: narrative || '[CONFIRM] Add execution procedure narrative.' },
      { id: 'compliance', title: 'Compliance Notes', text: 'Align with selected regulatory and internal controls.' },
      { id: 'records', title: 'Records', text: 'Define records, retention, and traceability points.' },
    ],
    processModel: { steps: [] },
    references: [],
    trainingTaskIds: [],
    source: 'fallback',
  };
}

export class AssuranceService {
  constructor({ sopService, llmService }) {
    this.sopService = sopService;
    this.llmService = llmService;
  }

  async _resolveScopeSops(selectedSopIds = []) {
    const cleanIds = cleanList(selectedSopIds);
    if (!cleanIds.length) {
      const list = await this.sopService.listSops();
      const resolved = [];
      for (const item of list) {
        resolved.push(await this.sopService.getSop(item.id));
      }
      return resolved;
    }

    const resolved = [];
    for (const sopId of cleanIds) {
      resolved.push(await this.sopService.getSop(sopId));
    }
    return resolved;
  }

  buildAuditPrompt({
    checks,
    regulations,
    highLevelSpec,
    constraints,
    narrative,
    sopDigests,
    regulatoryProfile,
  }) {
    const checksText = checks.length ? checks.join(', ') : 'none';
    const regulationsText = regulations.length ? regulations.join(', ') : 'none';
    const profileText = JSON.stringify(regulatoryProfile || {}, null, 2);
    const corpusText = JSON.stringify(sopDigests, null, 2);

    return [
      'You are an SOP assurance auditor.',
      'Return strict JSON with keys: summary, score, checks, crossSopConflicts, regulatoryCoverage, recommendations.',
      '',
      '### High-Level Intent',
      highLevelSpec || '[not provided]',
      '',
      '### Hard Constraints (must not be violated)',
      constraints || '[not provided]',
      '',
      '### General Context Narrative',
      narrative || '[not provided]',
      '',
      '### Selected Assurance Checks',
      checksText,
      '',
      '### Regulatory Scopes',
      regulationsText,
      '',
      '### Workspace Regulatory Profile',
      profileText,
      '',
      '### SOP Corpus Digest',
      corpusText,
    ].join('\n');
  }

  buildDraftPrompt({ title, highLevelSpec, constraints, narrative }) {
    return [
      'Generate a structured SOP draft as strict JSON.',
      'Return keys: title, sections, processModel, references, trainingTaskIds.',
      'Each section item must include: id, title, text.',
      '',
      '### High-Level Specification',
      highLevelSpec || '[not provided]',
      '',
      '### Hard Constraints',
      constraints || '[not provided]',
      '',
      '### General Narrative',
      narrative || '[not provided]',
      '',
      '### Requested Title',
      title || '[not provided]',
    ].join('\n');
  }

  async runAssuranceTask({ update, input }) {
    const profile = normalizeRegulatoryProfile(input?.regulatoryProfile || {});
    const checks = cleanList(input?.checks).length
      ? cleanList(input?.checks)
      : profile.assuranceChecks;
    const regulations = cleanList(input?.regulations).length
      ? cleanList(input?.regulations)
      : [
        ...profile.regulations,
        ...profile.nationalInstitutions.map((name) => `${name} guidance`),
        ...profile.internalPolicies.map((name) => `Internal policy: ${name}`),
      ];
    const selectedSopIds = cleanList(input?.selectedSopIds);
    const highLevelSpec = String(input?.highLevelSpec || '').trim();
    const constraints = String(input?.constraints || '').trim();
    const narrative = String(input?.narrative || '').trim();

    update({ progress: 10, message: 'Resolving SOP scope.' });
    const scopedSops = await this._resolveScopeSops(selectedSopIds);

    update({ progress: 25, message: `Preparing digest for ${scopedSops.length} SOP entries.` });
    const digests = scopedSops.map((item) => toSopDigest(item));

    update({ progress: 38, message: 'Building layered assurance prompt (high-level + constraints + narrative).' });
    const prompt = this.buildAuditPrompt({
      checks,
      regulations,
      highLevelSpec,
      constraints,
      narrative,
      sopDigests: digests,
      regulatoryProfile: profile,
    });

    const fallback = buildFallbackAssuranceResult({
      checks,
      digests,
      selectedSopIds,
      regulatoryProfile: profile,
    });

    update({ progress: 50, message: 'Submitting assurance scan to LLM.' });
    await sleep(1200);
    const llmResult = await this.llmService.executeJsonPrompt(prompt, {
      mode: 'deep',
      fallback,
    });

    update({ progress: 75, message: 'Normalizing assurance response.' });
    const result = llmResult && typeof llmResult === 'object' ? llmResult : fallback;
    const normalized = {
      ...fallback,
      ...result,
      checks: Array.isArray(result?.checks) ? result.checks : fallback.checks,
      crossSopConflicts: Array.isArray(result?.crossSopConflicts)
        ? result.crossSopConflicts
        : fallback.crossSopConflicts,
      regulatoryCoverage: Array.isArray(result?.regulatoryCoverage)
        ? result.regulatoryCoverage
        : fallback.regulatoryCoverage,
      recommendations: Array.isArray(result?.recommendations)
        ? result.recommendations
        : fallback.recommendations,
    };

    update({ progress: 90, message: 'Assurance scan completed. Aggregating final report.' });
    await sleep(500);
    update({ progress: 100, summary: normalized.summary });
    return normalized;
  }

  async runDraftGenerationTask({ update, input }) {
    const title = String(input?.title || '').trim();
    const highLevelSpec = String(input?.highLevelSpec || '').trim();
    const constraints = String(input?.constraints || '').trim();
    const narrative = String(input?.narrative || '').trim();

    update({ progress: 12, message: 'Preparing layered generation context.' });
    const prompt = this.buildDraftPrompt({
      title,
      highLevelSpec,
      constraints,
      narrative,
    });
    const fallback = fallbackDraftGeneration({
      title,
      highLevelSpec,
      constraints,
      narrative,
    });

    update({ progress: 45, message: 'Submitting generation request to LLM.' });
    await sleep(900);
    const llmResult = await this.llmService.executeJsonPrompt(prompt, {
      mode: 'deep',
      fallback,
    });

    update({ progress: 78, message: 'Validating generated structure.' });
    const draft = llmResult && typeof llmResult === 'object' ? llmResult : fallback;
    const normalized = {
      ...fallback,
      ...draft,
      sections: Array.isArray(draft?.sections) && draft.sections.length ? draft.sections : fallback.sections,
      processModel: draft?.processModel && typeof draft.processModel === 'object'
        ? draft.processModel
        : fallback.processModel,
      references: Array.isArray(draft?.references) ? draft.references : fallback.references,
      trainingTaskIds: Array.isArray(draft?.trainingTaskIds) ? draft.trainingTaskIds : fallback.trainingTaskIds,
      source: draft?.source || 'achilles-or-fallback',
    };
    await sleep(450);
    update({ progress: 100, summary: `Generated draft "${normalized.title}".` });
    return normalized;
  }
}

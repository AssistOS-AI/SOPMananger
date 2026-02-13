import fs from 'node:fs/promises';

const severityRank = {
  blocking: 0,
  warning: 1,
  suggestion: 2,
};

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function sectionText(section) {
  const parts = [];
  if (section?.text) {
    parts.push(String(section.text));
  }
  if (Array.isArray(section?.steps)) {
    for (const step of section.steps) {
      parts.push(String(step.text || step.name || ''));
    }
  }
  return parts.join('\n');
}

export class ValidationService {
  constructor({ rulesPath = null, rules = null } = {}) {
    this.rulesPath = rulesPath;
    this.rules = rules ?? null;
  }

  async initialize() {
    if (this.rules) {
      return;
    }
    if (!this.rulesPath) {
      this.rules = {};
      return;
    }
    const raw = await fs.readFile(this.rulesPath, 'utf8');
    this.rules = JSON.parse(raw);
  }

  _pushFinding(findings, finding) {
    findings.push({
      severity: 'warning',
      ruleId: 'unknown',
      sectionPath: '',
      message: '',
      ...finding,
    });
  }

  validate(document, context = {}) {
    const rules = this.rules ?? {};
    const findings = [];
    const sop = document ?? {};
    const sections = Array.isArray(sop.sections) ? sop.sections : [];
    const processSteps = Array.isArray(sop?.processModel?.steps) ? sop.processModel.steps : [];
    const references = Array.isArray(sop.references) ? sop.references : [];

    const requiredSections = Array.isArray(rules.requiredSections) ? rules.requiredSections : [];
    const sectionIds = new Set(
      sections.map((section) => normalizeText(section?.id || section?.title)).filter(Boolean),
    );

    for (const required of requiredSections) {
      const requiredId = normalizeText(required.id || required.title || required);
      if (!requiredId || sectionIds.has(requiredId)) {
        continue;
      }
      this._pushFinding(findings, {
        severity: 'blocking',
        ruleId: 'required-section',
        sectionPath: `sections.${requiredId}`,
        message: `Missing required section "${required.title || required.id || required}".`,
        suggestion: `Add section "${required.title || required.id || required}".`,
      });
    }

    processSteps.forEach((step, index) => {
      if (!normalizeText(step.role)) {
        this._pushFinding(findings, {
          severity: 'blocking',
          ruleId: 'step-role-required',
          sectionPath: `processModel.steps.${index}.role`,
          message: `Process step ${index + 1} has no responsible role.`,
          suggestion: 'Assign a role for each process step.',
        });
      }

      if (!normalizeText(step.name || step.text)) {
        this._pushFinding(findings, {
          severity: 'warning',
          ruleId: 'step-name-recommended',
          sectionPath: `processModel.steps.${index}`,
          message: `Process step ${index + 1} has no clear action text.`,
          suggestion: 'Add explicit action wording for the step.',
        });
      }
    });

    const ambiguousTerms = Array.isArray(rules.ambiguousTerms) ? rules.ambiguousTerms : [];
    sections.forEach((section, sectionIndex) => {
      const text = normalizeText(sectionText(section));
      for (const term of ambiguousTerms) {
        const normalizedTerm = normalizeText(term);
        if (normalizedTerm && text.includes(normalizedTerm)) {
          this._pushFinding(findings, {
            severity: 'warning',
            ruleId: 'ambiguous-language',
            sectionPath: `sections.${sectionIndex}`,
            message: `Ambiguous term "${term}" found in section "${section.title || section.id || sectionIndex}".`,
            suggestion: 'Replace ambiguous wording with measurable criteria.',
          });
        }
      }
    });

    references.forEach((reference, index) => {
      if (!normalizeText(reference.target)) {
        this._pushFinding(findings, {
          severity: 'warning',
          ruleId: 'reference-target-required',
          sectionPath: `references.${index}.target`,
          message: `Reference "${reference.label || index}" has no target.`,
          suggestion: 'Provide a valid SOP/system/form target.',
        });
      }
    });

    if (Array.isArray(processSteps)) {
      processSteps.forEach((step, stepIndex) => {
        if (!Array.isArray(step.records)) {
          return;
        }
        step.records.forEach((record, recordIndex) => {
          const storage = normalizeText(record?.storage);
          if (!storage) {
            this._pushFinding(findings, {
              severity: 'warning',
              ruleId: 'record-storage-required',
              sectionPath: `processModel.steps.${stepIndex}.records.${recordIndex}`,
              message: `Record "${record?.name || recordIndex}" does not define storage.`,
              suggestion: 'Specify where the record is stored and for how long.',
            });
          }
        });
      });
    }

    const status = context.status || sop.status || 'Draft';
    if (status === 'Effective') {
      const trainingTaskIds = Array.isArray(context.trainingTaskIds)
        ? context.trainingTaskIds
        : (Array.isArray(sop.trainingTaskIds) ? sop.trainingTaskIds : []);
      if (!trainingTaskIds.length) {
        this._pushFinding(findings, {
          severity: 'blocking',
          ruleId: 'effective-training-link',
          sectionPath: 'trainingTaskIds',
          message: 'Effective SOP must have linked training tasks.',
          suggestion: 'Publish with training task generation enabled.',
        });
      }
    }

    findings.sort((a, b) => {
      const left = severityRank[a.severity] ?? 99;
      const right = severityRank[b.severity] ?? 99;
      if (left !== right) {
        return left - right;
      }
      return a.ruleId.localeCompare(b.ruleId);
    });

    return {
      findings,
      summary: {
        total: findings.length,
        blocking: findings.filter((item) => item.severity === 'blocking').length,
        warning: findings.filter((item) => item.severity === 'warning').length,
        suggestion: findings.filter((item) => item.severity === 'suggestion').length,
      },
    };
  }
}

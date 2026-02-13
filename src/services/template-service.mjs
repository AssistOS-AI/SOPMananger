import { randomUUID } from 'node:crypto';
import { HttpError } from '../lib/http.mjs';

const DEFAULT_TEMPLATES = [
  {
    id: 'tpl-gmp-standard',
    title: 'GMP Controlled Procedure',
    description: 'Balanced structure for standard GMP operational procedures.',
    areas: ['Quality Assurance', 'Manufacturing', 'QC Laboratory'],
    targetRoles: ['author', 'reviewer', 'approver'],
    sections: [
      { id: 'purpose', title: 'Purpose', guidance: 'State objective and intended process control outcome.' },
      { id: 'scope', title: 'Scope', guidance: 'Define products, lines, systems, and boundaries covered.' },
      { id: 'responsibilities', title: 'Responsibilities', guidance: 'Assign accountable roles clearly.' },
      { id: 'procedure', title: 'Procedure', guidance: 'List controlled steps with acceptance criteria.' },
      { id: 'records', title: 'Records', guidance: 'Specify records, storage, retention, and integrity controls.' },
      { id: 'exceptions', title: 'Exceptions', guidance: 'Define deviations, escalation path, and CAPA trigger.' },
    ],
  },
  {
    id: 'tpl-lab-test-method',
    title: 'QC Test Method SOP',
    description: 'Focused template for laboratory methods and data integrity.',
    areas: ['QC Laboratory', 'Quality Control'],
    targetRoles: ['author', 'reviewer'],
    sections: [
      { id: 'purpose', title: 'Purpose', guidance: 'Define test intent and quality decision impact.' },
      { id: 'scope', title: 'Scope', guidance: 'Specify products, sample types, and applicability.' },
      { id: 'responsibilities', title: 'Responsibilities', guidance: 'Assign analyst, reviewer, and approver roles.' },
      { id: 'procedure', title: 'Procedure', guidance: 'Describe sample prep, instrument steps, calculations, criteria.' },
      { id: 'records', title: 'Records', guidance: 'Capture raw data, worksheets, and audit trail requirements.' },
      { id: 'exceptions', title: 'Exceptions', guidance: 'Describe out-of-spec handling and repeat rules.' },
    ],
  },
  {
    id: 'tpl-deviation-capa',
    title: 'Deviation and CAPA Flow',
    description: 'Template for deviation reporting, investigation, and CAPA decision.',
    areas: ['Quality Assurance', 'Operations'],
    targetRoles: ['author', 'reviewer', 'approver'],
    sections: [
      { id: 'purpose', title: 'Purpose', guidance: 'Control deviation intake and CAPA decision quality.' },
      { id: 'scope', title: 'Scope', guidance: 'Include all GMP-impacting deviations and exclusions.' },
      { id: 'responsibilities', title: 'Responsibilities', guidance: 'Define process owner, QA review, QA approval.' },
      { id: 'procedure', title: 'Procedure', guidance: 'Include classification, investigation, root cause, CAPA triggers.' },
      { id: 'records', title: 'Records', guidance: 'Deviation ticket, investigation report, CAPA register.' },
      { id: 'exceptions', title: 'Exceptions', guidance: 'Critical cases and rapid escalation path.' },
    ],
  },
];

function cleanList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizeSection(section = {}, index = 0) {
  const fallbackId = `section-${index + 1}`;
  return {
    id: String(section.id || fallbackId).trim() || fallbackId,
    title: String(section.title || `Section ${index + 1}`).trim() || `Section ${index + 1}`,
    guidance: String(section.guidance || '').trim(),
  };
}

function normalizeTemplate(template = {}) {
  const sections = Array.isArray(template.sections)
    ? template.sections.map((item, index) => normalizeSection(item, index))
    : [];
  return {
    id: String(template.id || `tpl-${randomUUID().slice(0, 8)}`).trim() || `tpl-${randomUUID().slice(0, 8)}`,
    title: String(template.title || '').trim() || 'Untitled Template',
    description: String(template.description || '').trim(),
    areas: cleanList(template.areas),
    targetRoles: cleanList(template.targetRoles),
    sections,
    createdAt: template.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export class TemplateService {
  constructor({ documentStore, auditStore = null }) {
    this.documentStore = documentStore;
    this.auditStore = auditStore;
  }

  async initialize() {
    const existing = await this.documentStore.listTemplates();
    if (existing.length) {
      return;
    }
    const seeded = DEFAULT_TEMPLATES.map((item) => normalizeTemplate(item));
    await this.documentStore.saveTemplates(seeded);
  }

  async listTemplates() {
    const templates = await this.documentStore.listTemplates();
    return templates
      .map((item) => normalizeTemplate(item))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  async getTemplate(templateId) {
    const templates = await this.listTemplates();
    return templates.find((item) => item.id === templateId) || null;
  }

  async createTemplate({ actor, payload = {} }) {
    if (!actor?.id) {
      throw new HttpError(401, 'Authenticated actor is required.');
    }
    const template = normalizeTemplate(payload);
    const all = await this.listTemplates();
    if (all.some((item) => item.id === template.id)) {
      throw new HttpError(409, `Template "${template.id}" already exists.`);
    }
    if (!template.sections.length) {
      throw new HttpError(400, 'Template requires at least one section.');
    }
    const created = {
      ...template,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.documentStore.saveTemplates(all.concat(created));
    if (this.auditStore) {
      await this.auditStore.append({
        actorId: actor.id,
        action: 'template.create',
        entityType: 'template',
        entityId: created.id,
        payload: {
          title: created.title,
          sections: created.sections.length,
        },
      });
    }
    return created;
  }

  async updateTemplate({ actor, templateId, patch = {} }) {
    if (!actor?.id) {
      throw new HttpError(401, 'Authenticated actor is required.');
    }
    const all = await this.listTemplates();
    const index = all.findIndex((item) => item.id === templateId);
    if (index === -1) {
      throw new HttpError(404, `Template "${templateId}" not found.`);
    }
    const existing = all[index];
    const updated = normalizeTemplate({
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
    });
    if (!updated.sections.length) {
      throw new HttpError(400, 'Template requires at least one section.');
    }
    all[index] = updated;
    await this.documentStore.saveTemplates(all);
    if (this.auditStore) {
      await this.auditStore.append({
        actorId: actor.id,
        action: 'template.update',
        entityType: 'template',
        entityId: updated.id,
        payload: {
          title: updated.title,
          sections: updated.sections.length,
        },
      });
    }
    return updated;
  }

  buildDocumentFromTemplate({
    template,
    title,
    guidanceNote = '',
    goal = '',
    instructions = '',
  }) {
    const note = String(guidanceNote || '').trim();
    const goalText = String(goal || '').trim();
    const instructionsText = String(instructions || '').trim();
    const contextLines = [];
    if (goalText) {
      contextLines.push(`Current goal: ${goalText}`);
    }
    if (instructionsText) {
      contextLines.push(`Authoring instructions: ${instructionsText}`);
    }
    const contextBlock = contextLines.length
      ? `[AUTHOR CONTEXT]\n${contextLines.join('\n')}`
      : '';
    const sections = template.sections.map((section) => ({
      id: section.id,
      title: section.title,
      text: [section.guidance, contextBlock, note].filter(Boolean).join('\n\n') || '[CONFIRM] Complete this section.',
    }));
    return {
      title: title || template.title,
      sections,
      processModel: { steps: [] },
      references: [],
      trainingTaskIds: [],
      authorContext: {
        goal: goalText,
        instructions: instructionsText,
        templateGuidanceNote: note,
      },
      template: {
        id: template.id,
        title: template.title,
      },
    };
  }
}

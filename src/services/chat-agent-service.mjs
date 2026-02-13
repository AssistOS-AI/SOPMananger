import { HttpError } from '../lib/http.mjs';

function normalize(text) {
  return String(text || '').trim();
}

function lower(text) {
  return normalize(text).toLowerCase();
}

function extractReason(message) {
  const text = normalize(message);
  const marker = text.toLowerCase().indexOf('because');
  if (marker === -1) {
    return 'Requested via conversational assistant.';
  }
  return text.slice(marker + 'because'.length).trim() || 'Requested via conversational assistant.';
}

function cleanAttachments(attachments = []) {
  if (!Array.isArray(attachments)) {
    return [];
  }
  return attachments
    .map((item, index) => {
      const name = normalize(item?.name || `attachment-${index + 1}`);
      const mimeType = normalize(item?.mimeType || item?.type || '');
      const size = Number(item?.size || 0);
      const content = String(item?.content || '').slice(0, 30000);
      return {
        id: normalize(item?.id || `a-${index + 1}`),
        name: name || `attachment-${index + 1}`,
        mimeType,
        size: Number.isFinite(size) && size >= 0 ? size : 0,
        content,
      };
    })
    .filter((item) => item.name);
}

function shortPreview(value, max = 320) {
  const text = normalize(value);
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

function titleFromAttachment(name = '') {
  const base = String(name || '')
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!base) {
    return 'Imported SOP Draft';
  }
  return base
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .slice(0, 90);
}

function buildDocumentFromAttachment({ title, attachment }) {
  const content = normalize(attachment?.content || '');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = lines[0] || '';
  const procedure = content
    ? content.slice(0, 2500)
    : `[CONFIRM] Review attached file "${attachment?.name || 'source'}" and draft procedure details.`;

  return {
    title,
    sections: [
      {
        id: 'purpose',
        title: 'Purpose',
        text: firstLine
          ? `Define and control the process described in source file "${attachment?.name}".`
          : '[CONFIRM] Define SOP purpose.',
      },
      {
        id: 'scope',
        title: 'Scope',
        text: `Derived from source attachment "${attachment?.name || 'uploaded file'}". Confirm boundaries and applicability.`,
      },
      {
        id: 'responsibilities',
        title: 'Responsibilities',
        text: '[CONFIRM] Assign accountable roles (owner, reviewer, approver, operator).',
      },
      {
        id: 'procedure',
        title: 'Procedure',
        text: procedure,
      },
      {
        id: 'records',
        title: 'Records',
        text: '[CONFIRM] Define records, retention period, and storage location.',
      },
      {
        id: 'exceptions',
        title: 'Exceptions',
        text: '[CONFIRM] Define exceptions, escalation path, and deviation handling.',
      },
    ],
    processModel: { steps: [] },
    references: [
      {
        label: 'Source attachment',
        type: 'file',
        target: attachment?.name || 'uploaded file',
      },
    ],
    trainingTaskIds: [],
  };
}

export class ChatAgentService {
  constructor({
    sopService,
    llmService,
    taskService = null,
    assuranceService = null,
    settingsService = null,
    trainingService = null,
  }) {
    this.sopService = sopService;
    this.llmService = llmService;
    this.taskService = taskService;
    this.assuranceService = assuranceService;
    this.settingsService = settingsService;
    this.trainingService = trainingService;
  }

  async _listSopsPreview(limit = 10) {
    const list = await this.sopService.listSops();
    return list.slice(0, limit).map((item) => ({
      id: item.id,
      code: item.code,
      title: item.title,
      status: item.status,
    }));
  }

  async _resolveSopByToken(token) {
    const query = normalize(token);
    if (!query) {
      return null;
    }
    try {
      const direct = await this.sopService.getSop(query);
      return direct;
    } catch {
      const list = await this.sopService.listSops();
      const found = list.find((item) => item.code === query || item.title.toLowerCase().includes(query.toLowerCase()));
      if (!found) {
        return null;
      }
      return this.sopService.getSop(found.id);
    }
  }

  async handleMessage({
    actor,
    message,
    selectedSopId = null,
    password = '',
    attachments = [],
    canReauthenticate = async () => true,
  }) {
    const normalizedAttachments = cleanAttachments(attachments);
    const text = normalize(message);
    if (!text && !normalizedAttachments.length) {
      throw new HttpError(400, 'message is required.');
    }

    const effectiveText = text || 'summarize attachment';
    const textLower = lower(effectiveText);
    const actions = [];
    let activeSopId = selectedSopId || null;

    const helpText = [
      'Try commands like:',
      '- "list sops"',
      '- "open SOP-QA-001"',
      '- "validate"',
      '- "submit to review because ..."',
      '- "approve because ..."',
      '- "publish"',
      '- "create sop <title>"',
      '- "create sop from attachment"',
      '- "summarize attachment"',
      '- "list tasks"',
      '- "run assurance scan"',
      '- "training status"',
    ].join('\n');

    if (textLower === 'help' || textLower.includes('what can you do')) {
      return {
        reply: helpText,
        selectedSopId: activeSopId,
        actions,
      };
    }

    if (textLower.startsWith('list') || textLower.includes('list sops') || textLower.includes('show sops')) {
      const preview = await this._listSopsPreview(20);
      const body = preview.length
        ? preview.map((item) => `- ${item.code} | ${item.status} | ${item.title} (${item.id})`).join('\n')
        : 'No SOP entries found.';
      return {
        reply: `Available SOPs:\n${body}`,
        selectedSopId: activeSopId,
        actions: [...actions, 'list-sops'],
        data: { sops: preview },
      };
    }

    if (textLower.startsWith('open ') || textLower.startsWith('select ')) {
      const token = effectiveText.split(/\s+/).slice(1).join(' ');
      const sop = await this._resolveSopByToken(token);
      if (!sop) {
        return {
          reply: `Could not find SOP "${token}".`,
          selectedSopId: activeSopId,
          actions,
        };
      }
      activeSopId = sop.meta.id;
      return {
        reply: `Selected ${sop.meta.code} - ${sop.meta.title}.`,
        selectedSopId: activeSopId,
        actions: [...actions, 'select-sop'],
      };
    }

    if (textLower.startsWith('create sop ')) {
      if (!['author', 'admin'].includes(actor.role)) {
        throw new HttpError(403, 'Only author/admin can create SOPs via chat.');
      }
      const title = normalize(effectiveText.slice('create sop '.length)) || 'Untitled SOP';
      const created = await this.sopService.createSop({
        actor,
        payload: {
          title,
          area: 'General',
          targetRoles: ['author', 'reviewer'],
        },
      });
      activeSopId = created.meta.id;
      return {
        reply: `Created SOP ${created.meta.code} - ${created.meta.title}.`,
        selectedSopId: activeSopId,
        actions: [...actions, 'create-sop'],
      };
    }

    if (textLower.includes('create sop from attachment') || textLower.includes('import attachment')) {
      if (!['author', 'admin'].includes(actor.role)) {
        throw new HttpError(403, 'Only author/admin can create SOPs from attachment.');
      }
      if (!normalizedAttachments.length) {
        return {
          reply: 'Attach at least one file, then ask: "create sop from attachment".',
          selectedSopId: activeSopId,
          actions,
        };
      }
      const source = normalizedAttachments.find((item) => item.content) || normalizedAttachments[0];
      const title = titleFromAttachment(source.name);
      const created = await this.sopService.createSop({
        actor,
        payload: {
          title,
          area: 'Imported',
          targetRoles: ['author', 'reviewer'],
          document: buildDocumentFromAttachment({ title, attachment: source }),
        },
      });
      activeSopId = created.meta.id;
      return {
        reply: `Created SOP ${created.meta.code} from attachment "${source.name}".`,
        selectedSopId: activeSopId,
        actions: [...actions, 'create-sop-from-attachment'],
        data: {
          sopId: created.meta.id,
          sourceAttachment: source.name,
        },
      };
    }

    if (textLower.includes('summarize attachment') || textLower.includes('what is in attachment')) {
      if (!normalizedAttachments.length) {
        return {
          reply: 'No attachments available in this message.',
          selectedSopId: activeSopId,
          actions,
        };
      }
      const snippets = normalizedAttachments
        .slice(0, 3)
        .map((item) => `- ${item.name}: ${shortPreview(item.content || '[binary or empty attachment]', 220)}`)
        .join('\n');

      const llmReply = await this.llmService.executeTextPrompt(
        [
          'Summarize attached files for SOP authoring.',
          'Keep response practical and concise.',
          '',
          snippets,
        ].join('\n'),
        {
          mode: 'fast',
          fallback: `Attachment summary:\n${snippets}`,
        },
      );

      return {
        reply: llmReply || `Attachment summary:\n${snippets}`,
        selectedSopId: activeSopId,
        actions: [...actions, 'summarize-attachment'],
      };
    }

    if (textLower.includes('list tasks') || textLower.startsWith('tasks')) {
      if (!this.taskService) {
        return {
          reply: 'Task service is not available in current runtime.',
          selectedSopId: activeSopId,
          actions,
        };
      }
      const tasks = this.taskService.listTasks({ limit: 12 });
      const body = tasks.length
        ? tasks.map((item) => `- ${item.id} | ${item.type} | ${item.status} | ${item.progress}%`).join('\n')
        : 'No tasks in queue.';
      return {
        reply: `Current server tasks:\n${body}`,
        selectedSopId: activeSopId,
        actions: [...actions, 'list-tasks'],
        data: { tasks },
      };
    }

    if (textLower.includes('run assurance') || textLower.includes('start assurance')) {
      if (!this.taskService || !this.assuranceService || !this.settingsService) {
        return {
          reply: 'Assurance orchestration services are not available.',
          selectedSopId: activeSopId,
          actions,
        };
      }
      if (!['author', 'reviewer', 'approver', 'admin'].includes(actor.role)) {
        throw new HttpError(403, 'Current role cannot run assurance scans.');
      }
      const profile = await this.settingsService.getRegulatoryProfile();
      const selectedSopIds = activeSopId ? [activeSopId] : [];
      const task = await this.taskService.createTask({
        type: 'assurance-scan',
        title: activeSopId ? 'Assurance scan for selected SOP' : 'Workspace assurance scan',
        actorId: actor.id,
        input: {
          selectedSopIds,
          regulatoryProfile: profile,
          checks: profile.assuranceChecks || [],
          highLevelSpec: 'Verify operational coherence and compliance posture.',
          constraints: 'Flag contradictions and missing control evidence.',
          narrative: 'Triggered via conversational assistant.',
        },
        runner: async ({ update, input }) => this.assuranceService.runAssuranceTask({ update, input }),
      });
      return {
        reply: `Assurance task started: ${task.id}. Track progress in Task Monitor.`,
        selectedSopId: activeSopId,
        actions: [...actions, 'run-assurance-task'],
        data: { task },
      };
    }

    if (textLower.includes('training status') || textLower.includes('training overview')) {
      if (!this.trainingService) {
        return {
          reply: 'Training service is not available in current runtime.',
          selectedSopId: activeSopId,
          actions,
        };
      }
      const overview = await this.trainingService.getOverview({
        sopId: activeSopId || null,
      });
      return {
        reply: [
          `Training summary: total=${overview.summary.total}, completed=${overview.summary.completed}, overdue=${overview.summary.overdue}, signoffPending=${overview.summary.signoffPending}.`,
          activeSopId ? 'Scope: selected SOP.' : 'Scope: workspace.',
        ].join('\n'),
        selectedSopId: activeSopId,
        actions: [...actions, 'training-overview'],
        data: { overview },
      };
    }

    if (!activeSopId && (textLower.includes('validate') || textLower.includes('review') || textLower.includes('approve') || textLower.includes('publish') || textLower.includes('status'))) {
      return {
        reply: 'Select an SOP first. Example: "open SOP-QA-001".',
        selectedSopId: activeSopId,
        actions,
      };
    }

    if (textLower.includes('status')) {
      const sop = await this.sopService.getSop(activeSopId);
      return {
        reply: `${sop.meta.code} is currently in status ${sop.meta.status}, version ${sop.meta.currentVersionId}.`,
        selectedSopId: activeSopId,
        actions: [...actions, 'status-check'],
      };
    }

    if (textLower.includes('validate')) {
      const validation = await this.sopService.validateSop({ sopId: activeSopId });
      return {
        reply: `Validation complete: blocking=${validation.summary.blocking}, warning=${validation.summary.warning}, suggestion=${validation.summary.suggestion}.`,
        selectedSopId: activeSopId,
        actions: [...actions, 'validate'],
        data: { validation },
      };
    }

    if (textLower.includes('review') || textLower.includes('submit')) {
      if (!['author', 'reviewer', 'approver', 'admin'].includes(actor.role)) {
        throw new HttpError(403, 'Current role cannot transition SOP to review.');
      }
      const reason = extractReason(effectiveText);
      const result = await this.sopService.transitionSop({
        sopId: activeSopId,
        actor,
        toStatus: 'In Review',
        reason,
        eSignature: { reauthenticated: true },
      });
      return {
        reply: `SOP moved to In Review.`,
        selectedSopId: activeSopId,
        actions: [...actions, 'transition-in-review'],
        data: { workflow: result },
      };
    }

    if (textLower.includes('approve')) {
      if (!['approver', 'admin'].includes(actor.role)) {
        throw new HttpError(403, 'Only approver/admin can approve SOPs.');
      }
      const reason = extractReason(effectiveText);
      const reauthenticated = await canReauthenticate(password || '');
      const result = await this.sopService.transitionSop({
        sopId: activeSopId,
        actor,
        toStatus: 'Approved',
        reason,
        eSignature: { reauthenticated },
      });
      return {
        reply: 'SOP approved successfully.',
        selectedSopId: activeSopId,
        actions: [...actions, 'approve'],
        data: { workflow: result },
      };
    }

    if (textLower.includes('publish')) {
      if (!['approver', 'admin'].includes(actor.role)) {
        throw new HttpError(403, 'Only approver/admin can publish SOPs.');
      }
      const published = await this.sopService.publishSop({
        sopId: activeSopId,
        actor,
      });
      return {
        reply: `SOP published. Generated ${published.trainingTasks.length} training tasks.`,
        selectedSopId: activeSopId,
        actions: [...actions, 'publish'],
        data: { publish: published },
      };
    }

    const fallbackReply = await this.llmService.executeTextPrompt(
      [
        'You are a SOP studio assistant.',
        'User message:',
        effectiveText,
        '',
        'Attachment context:',
        normalizedAttachments.length
          ? normalizedAttachments
            .map((item) => `- ${item.name} (${item.mimeType || 'unknown'}, ${item.size} bytes): ${shortPreview(item.content || '[binary/empty]', 180)}`)
            .join('\n')
          : '[none]',
        '',
        'Respond with practical next steps in max 6 lines.',
      ].join('\n'),
      {
        mode: 'fast',
        fallback: helpText,
      },
    );

    return {
      reply: fallbackReply || helpText,
      selectedSopId: activeSopId,
      actions: [...actions, 'assistant-reply'],
    };
  }
}

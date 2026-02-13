function normalize(text) {
  return String(text || '').trim();
}

function shortPreview(value, max = 320) {
  const text = normalize(value);
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

export function lower(text) {
  return normalize(text).toLowerCase();
}

export function extractReason(message) {
  const text = normalize(message);
  const marker = text.toLowerCase().indexOf('because');
  if (marker === -1) {
    return 'Requested via conversational assistant.';
  }
  return text.slice(marker + 'because'.length).trim() || 'Requested via conversational assistant.';
}

export function cleanAttachments(attachments = []) {
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

export function titleFromAttachment(name = '') {
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

export function buildDocumentFromAttachment({ title, attachment }) {
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

export { normalize, shortPreview };

import { escapeHtml } from '../lib/http.mjs';

export function createBaseDocument({ title, interviewSummary = null, processModel = null, references = [] } = {}) {
  const summary = interviewSummary ?? {};
  return {
    title: title || summary.title || 'Untitled SOP',
    sections: [
      { id: 'purpose', title: 'Purpose', text: summary.purpose || '[CONFIRM] Add SOP purpose.' },
      { id: 'scope', title: 'Scope', text: summary.scope || '[CONFIRM] Add SOP scope.' },
      {
        id: 'responsibilities',
        title: 'Responsibilities',
        text: Array.isArray(summary.roles) && summary.roles.length
          ? summary.roles.join(', ')
          : '[CONFIRM] Add roles and responsibilities.',
      },
      {
        id: 'procedure',
        title: 'Procedure',
        text: summary.procedureDraft || '[CONFIRM] Add procedural steps.',
      },
      {
        id: 'records',
        title: 'Records',
        text: '[CONFIRM] Add required records and retention details.',
      },
      {
        id: 'exceptions',
        title: 'Exceptions',
        text: '[CONFIRM] Add exceptions and escalation rules.',
      },
    ],
    processModel: processModel ?? { steps: [] },
    references: Array.isArray(references) ? references : [],
    trainingTaskIds: [],
  };
}

export function buildChangeSummary(previousDocument, nextDocument) {
  const previousSections = Array.isArray(previousDocument?.sections) ? previousDocument.sections : [];
  const nextSections = Array.isArray(nextDocument?.sections) ? nextDocument.sections : [];

  const changed = [];
  const nextById = new Map(nextSections.map((section) => [section.id || section.title, section]));

  for (const section of previousSections) {
    const key = section.id || section.title;
    const counterpart = nextById.get(key);
    if (!counterpart) {
      changed.push(`Removed section: ${key}`);
      continue;
    }
    if (String(counterpart.text || '') !== String(section.text || '')) {
      changed.push(`Updated section: ${key}`);
    }
  }

  for (const section of nextSections) {
    const key = section.id || section.title;
    const existsBefore = previousSections.some((item) => (item.id || item.title) === key);
    if (!existsBefore) {
      changed.push(`Added section: ${key}`);
    }
  }

  return changed.length ? changed : ['No section-level changes detected.'];
}

export function renderTemplate(template, params = {}) {
  let output = String(template || '');
  for (const [key, value] of Object.entries(params)) {
    const token = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    output = output.replace(token, String(value));
  }
  return output;
}

export function normalizeSectionPath(pathValue) {
  return String(pathValue || '').trim();
}

export function renderSopExportHtml({ sopMeta, document, versions = [] }) {
  const sections = Array.isArray(document?.sections) ? document.sections : [];
  const recentChanges = versions.slice(-5).reverse();

  const rows = sections
    .map(
      (section) => `
          <section class="section">
            <h2>${escapeHtml(section.title || section.id || 'Section')}</h2>
            <p>${escapeHtml(section.text || '')}</p>
          </section>`,
    )
    .join('\n');

  const changeRows = recentChanges
    .map((version) => `<li>${escapeHtml(version.versionId)} - ${escapeHtml(version.changeSummary || '')}</li>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(sopMeta.title)} - Export</title>
  <style>
    body { font-family: "Times New Roman", serif; margin: 32px; color: #111; }
    h1, h2 { margin: 0 0 8px; }
    .meta { margin: 0 0 18px; font-size: 14px; color: #444; }
    .section { margin: 0 0 18px; page-break-inside: avoid; }
    .changes { margin-top: 24px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(sopMeta.title)}</h1>
  <div class="meta">
    <div>Code: ${escapeHtml(sopMeta.code || '-')}</div>
    <div>Status: ${escapeHtml(sopMeta.status || '-')}</div>
    <div>Version: ${escapeHtml(sopMeta.currentVersionId || '-')}</div>
    <div>Exported At: ${escapeHtml(new Date().toISOString())}</div>
  </div>
  ${rows}
  <section class="changes">
    <h2>Recent Change Summary</h2>
    <ul>${changeRows}</ul>
  </section>
</body>
</html>`;
}

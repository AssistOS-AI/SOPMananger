export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function deepClone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function fmtDate(value) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

export function fmtBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value < 1024) {
    return `${Math.max(0, Math.round(value))} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function parseHashRoute(hashValue = window.location.hash) {
  const raw = (hashValue || '#/dashboard').slice(1);
  const [rawPath = '/dashboard', rawQuery = ''] = raw.split('?');
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const segments = path.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(rawQuery).entries());

  if (segments.length === 0 || segments[0] === 'dashboard') {
    return { view: 'dashboard', params: {}, query };
  }
  if (segments[0] === 'sops' && segments[1] === 'create') {
    return { view: 'sopCreate', params: {}, query };
  }
  if (segments[0] === 'sops' && segments[1] && segments[2] === 'edit') {
    return { view: 'sopEdit', params: { sopId: segments[1] }, query };
  }
  if (segments[0] === 'sops') {
    return { view: 'sopList', params: {}, query };
  }
  if (segments[0] === 'assistant') {
    return { view: 'assistant', params: {}, query };
  }
  if (segments[0] === 'assurance' || segments[0] === 'automation') {
    return { view: 'automation', params: {}, query };
  }
  if (segments[0] === 'tasks') {
    return { view: 'tasks', params: {}, query };
  }
  if (segments[0] === 'templates' || segments[0] === 'blocks') {
    return { view: 'templates', params: {}, query };
  }
  if (segments[0] === 'training') {
    return { view: 'training', params: {}, query };
  }
  if (segments[0] === 'users') {
    return { view: 'users', params: {}, query };
  }
  if (segments[0] === 'audit') {
    return { view: 'audit', params: {}, query };
  }
  if (segments[0] === 'settings') {
    return { view: 'settings', params: {}, query };
  }
  return { view: 'dashboard', params: {}, query };
}

export function checkedValues(form, name) {
  return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map((item) => item.value);
}

export function collectEditorDocument(state) {
  const root = document.querySelector('[data-editor-form]');
  if (!root || !state.currentSop) {
    throw new Error('Editor context is not available. Reload the SOP editor and try again.');
  }

  const title = root.querySelector('[name="document-title"]')?.value?.trim() || state.currentSop.meta.title;
  const sections = [];
  root.querySelectorAll('[data-section-card]').forEach((card) => {
    const id = card.querySelector('[data-field="section-id"]')?.value?.trim() || '';
    const sectionTitle = card.querySelector('[data-field="section-title"]')?.value?.trim() || '';
    const text = card.querySelector('[data-field="section-text"]')?.value || '';
    if (!id && !sectionTitle && !text.trim()) {
      return;
    }
    sections.push({
      id: id || sectionTitle || `section-${sections.length + 1}`,
      title: sectionTitle || id || `Section ${sections.length + 1}`,
      text,
    });
  });

  const steps = [];
  root.querySelectorAll('[data-step-row]').forEach((row, index) => {
    const name = row.querySelector('[data-field="step-name"]')?.value?.trim() || '';
    const role = row.querySelector('[data-field="step-role"]')?.value?.trim() || '';
    const inputs = row.querySelector('[data-field="step-inputs"]')?.value || '';
    const outputs = row.querySelector('[data-field="step-outputs"]')?.value || '';
    const records = row.querySelector('[data-field="step-records"]')?.value || '';
    const exceptions = row.querySelector('[data-field="step-exceptions"]')?.value || '';
    if (!name && !role && !inputs && !outputs && !records && !exceptions) {
      return;
    }
    steps.push({
      order: index + 1,
      name,
      role,
      inputs: inputs.split(',').map((value) => value.trim()).filter(Boolean),
      outputs: outputs.split(',').map((value) => value.trim()).filter(Boolean),
      records: records.split(',').map((value) => value.trim()).filter(Boolean),
      exceptions: exceptions.split(',').map((value) => value.trim()).filter(Boolean),
    });
  });

  const references = [];
  root.querySelectorAll('[data-ref-row]').forEach((row) => {
    const label = row.querySelector('[data-field="ref-label"]')?.value?.trim() || '';
    const type = row.querySelector('[data-field="ref-type"]')?.value?.trim() || '';
    const target = row.querySelector('[data-field="ref-target"]')?.value?.trim() || '';
    if (!label && !type && !target) {
      return;
    }
    references.push({ label, type, target });
  });

  state.workingDoc = {
    ...state.workingDoc,
    title,
    sections,
    processModel: { steps },
    references,
  };

  return state.workingDoc;
}

export function sopLabelById(state, sopId) {
  const found = state.sops.find((item) => item.id === sopId);
  if (!found) {
    return sopId;
  }
  return `${found.code} - ${found.title}`;
}

export function userLabelById(state, userId) {
  if (!userId) {
    return '-';
  }
  if (state.session?.id === userId) {
    return state.session.displayName || state.session.username || userId;
  }
  const known = state.users.find((user) => user.id === userId);
  if (known) {
    return known.displayName || known.username || userId;
  }
  const defaultMap = {
    'u-admin': 'Quality Systems Admin',
    'u-author': 'Process Author',
    'u-reviewer': 'SME Reviewer',
    'u-approver': 'Final Approver',
  };
  return defaultMap[userId] || userId;
}

export function actionLabel(action) {
  const catalog = {
    'sop.create': 'SOP created',
    'sop.version.create': 'Version created',
    'sop.workflow.transition': 'Workflow transitioned',
    'sop.publish': 'SOP published',
    'review.comment.add': 'Review comment added',
    'review.comment.resolve': 'Review comment resolved',
    'template.create': 'Template created',
    'template.update': 'Template updated',
    'user.create': 'User created',
    'user.update': 'User updated',
    'training.mark-read': 'Training read acknowledged',
    'training.submit-quiz': 'Training quiz submitted',
    'training.signoff': 'Training sign-off completed',
  };
  return catalog[action] || action;
}

export function currentPageTitle(view) {
  const viewLabels = {
    dashboard: 'Dashboard',
    sopList: 'SOP List',
    sopCreate: 'Create SOP',
    sopEdit: 'SOP Editor',
    assistant: 'Agent Chat',
    automation: 'Automation & Scans',
    tasks: 'Task Monitor',
    templates: 'Templates',
    training: 'Training Compliance',
    users: 'User Management',
    audit: 'Audit',
    settings: 'Settings',
  };
  return viewLabels[view] || 'SOP Manager';
}

export function breadcrumbs(state) {
  const items = ['Workspace', currentPageTitle(state.route.view)];
  if (state.route.view === 'sopEdit' && state.currentSop?.meta?.code) {
    items.push(state.currentSop.meta.code);
  }
  return items.join(' / ');
}

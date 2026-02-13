export function renderSopList({ state, esc, fmtDate }) {
  const statusFilter = state.route.query.status || 'all';
  const searchFilter = (state.route.query.search || '').toLowerCase();
  const filtered = state.sops.filter((item) => {
    const statusOk = statusFilter === 'all' ? true : item.status === statusFilter;
    const searchOk = searchFilter
      ? (`${item.code} ${item.title} ${item.area || ''}`.toLowerCase().includes(searchFilter))
      : true;
    return statusOk && searchOk;
  });

  const rows = filtered
    .map((item) => `
      <tr>
        <td>${esc(item.code)}</td>
        <td>${esc(item.title)}</td>
        <td>${esc(item.area || '-')}</td>
        <td><span class="badge">${esc(item.status)}</span></td>
        <td>${fmtDate(item.updatedAt)}</td>
        <td>
          <div class="actions">
            <button class="btn" data-action="open-sop-edit" data-sop-id="${esc(item.id)}">Edit</button>
          </div>
        </td>
      </tr>
    `)
    .join('');

  return `
    <section class="card">
      <div class="card-head">
        <h3>SOP List</h3>
        <a class="btn primary" href="#/sops/create">Create SOP</a>
      </div>
      <form class="card-body compact list-filter-toolbar" data-action="apply-sop-list-filter">
        <label>Status
          <select name="status">
            <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All</option>
            <option value="Draft" ${statusFilter === 'Draft' ? 'selected' : ''}>Draft</option>
            <option value="In Review" ${statusFilter === 'In Review' ? 'selected' : ''}>In Review</option>
            <option value="Approved" ${statusFilter === 'Approved' ? 'selected' : ''}>Approved</option>
            <option value="Effective" ${statusFilter === 'Effective' ? 'selected' : ''}>Effective</option>
            <option value="Superseded" ${statusFilter === 'Superseded' ? 'selected' : ''}>Superseded</option>
          </select>
        </label>
        <label>Search
          <input name="search" value="${esc(state.route.query.search || '')}" placeholder="code, title, area" />
        </label>
        <div class="actions">
          <button class="btn primary" type="submit">Apply</button>
        </div>
      </form>
      <div class="card-body table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Title</th><th>Area</th><th>Status</th><th>Updated</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6">No SOPs found for current filter.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

export function renderSopCreate({ state, esc }) {
  const selectedTemplate = state.templates.find((template) => template.id === state.selectedTemplateId) || null;
  const areaOptions = (state.pharmaAreas.length ? state.pharmaAreas : [
    'Quality Assurance',
    'Quality Control',
    'QC Laboratory',
    'Manufacturing',
    'Production',
    'Warehouse',
    'Supply Chain',
    'Validation',
    'Regulatory Affairs',
    'General',
  ])
    .map((area) => `<option value="${esc(area)}">${esc(area)}</option>`)
    .join('');

  const templateOptions = [
    '<option value="">No template</option>',
    ...state.templates.map((template) => `<option value="${esc(template.id)}" ${state.selectedTemplateId === template.id ? 'selected' : ''}>${esc(template.title)}</option>`),
  ].join('');

  const targetRoleOptions = ['author', 'reviewer', 'approver', 'trainer'];
  const templatePreview = selectedTemplate?.sections?.length
    ? `
      <div class="section-card">
        <strong>Template Sections Preview</strong>
        <ul>
          ${selectedTemplate.sections.map((section) => `<li><strong>${esc(section.title || section.id)}</strong>: ${esc(section.guidance || '')}</li>`).join('')}
        </ul>
      </div>
    `
    : '';

  return `
    <section class="card">
      <div class="card-head"><h3>Create SOP</h3></div>
      <form class="card-body" data-action="create-sop">
        <div class="grid-2">
          <label>Title <input name="title" required /></label>
          <label>Area
            <select name="area">${areaOptions}</select>
          </label>
        </div>
        <label>Template
          <select name="templateId" data-action="set-template">${templateOptions}</select>
        </label>
        ${templatePreview}
        <details ${state.sopCreateShowAiOptions ? 'open' : ''}>
          <summary>AI Authoring Options</summary>
          <div class="grid-2">
            <label>Current Goal
              <input name="goal" placeholder="Outcome target for AI-assisted draft generation" />
              <div class="field-help">Used by server-side AI generation to focus procedure intent.</div>
            </label>
            <label>Authoring Instructions
              <input name="authoringInstructions" placeholder="Constraints or style instructions for this SOP draft" />
              <div class="field-help">Applied as hard/soft constraints when template content is generated.</div>
            </label>
          </div>
          ${selectedTemplate ? `
            <label>Template Guidance Notes
              <textarea name="templateGuidanceNote" placeholder="Extra constraints for selected template"></textarea>
              <div class="field-help">Only used when a template is selected.</div>
            </label>
          ` : ''}
        </details>
        <div>
          <div class="muted">Target Roles Affected</div>
          <div class="grid-3">
            ${targetRoleOptions.map((role) => `<label class="check-inline"><input type="checkbox" name="targetRoles" value="${role}" ${['author', 'reviewer'].includes(role) ? 'checked' : ''} /> ${role}</label>`).join('')}
          </div>
        </div>
        <div class="muted">SOP code is generated automatically from Settings pattern.</div>
        <div class="actions">
          <button class="btn primary" type="submit">Create and Open Editor</button>
          <a class="btn" href="#/sops">Back to SOP List</a>
        </div>
      </form>
    </section>
  `;
}

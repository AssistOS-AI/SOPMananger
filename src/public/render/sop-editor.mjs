function renderEditTabs({ state, esc }) {
  const tabs = [
    ['content', 'Content'],
    ['quality', 'Quality'],
    ['review', 'Review'],
    ['release', 'Release'],
    ['links', 'Links'],
  ];
  return tabs
    .map(([id, label]) => `
      <button class="tab-btn ${state.sopEditTab === id ? 'active' : ''}" data-action="switch-edit-tab" data-tab="${id}">
        ${esc(label)}
      </button>
    `)
    .join('');
}

function renderEditorContentTab({ state, esc }) {
  const doc = state.workingDoc || { title: '', sections: [], processModel: { steps: [] }, references: [] };
  const sections = (doc.sections || [])
    .map((section, index) => `
      <div class="section-card" data-section-card data-index="${index}">
        <div class="row spaced">
          <strong>Section ${index + 1}</strong>
          <button class="btn danger" type="button" data-action="remove-editor-section" data-index="${index}">Remove</button>
        </div>
        <div class="grid-2">
          <label>ID <input data-field="section-id" value="${esc(section.id || '')}" /></label>
          <label>Title <input data-field="section-title" value="${esc(section.title || '')}" /></label>
        </div>
        <label>Text <textarea data-field="section-text">${esc(section.text || '')}</textarea></label>
      </div>
    `)
    .join('');

  const steps = (doc.processModel?.steps || [])
    .map((step, index) => `
      <tr data-step-row data-index="${index}">
        <td>${index + 1}</td>
        <td><input data-field="step-name" value="${esc(step.name || '')}" /></td>
        <td><input data-field="step-role" value="${esc(step.role || '')}" /></td>
        <td><input data-field="step-inputs" value="${esc((step.inputs || []).join(', '))}" /></td>
        <td><input data-field="step-outputs" value="${esc((step.outputs || []).join(', '))}" /></td>
        <td><input data-field="step-records" value="${esc((step.records || []).join(', '))}" /></td>
        <td><input data-field="step-exceptions" value="${esc((step.exceptions || []).join(', '))}" /></td>
        <td><button class="btn danger" type="button" data-action="remove-editor-step" data-index="${index}">X</button></td>
      </tr>
    `)
    .join('');

  const refs = (doc.references || [])
    .map((ref, index) => `
      <tr data-ref-row data-index="${index}">
        <td><input data-field="ref-label" value="${esc(ref.label || '')}" /></td>
        <td><input data-field="ref-type" value="${esc(ref.type || '')}" /></td>
        <td><input data-field="ref-target" value="${esc(ref.target || '')}" /></td>
        <td><button class="btn danger" type="button" data-action="remove-editor-ref" data-index="${index}">X</button></td>
      </tr>
    `)
    .join('');

  return `
    <form class="card" data-action="save-sop-version" data-editor-form>
      <div class="card-head">
        <h3>Editor</h3>
        <div class="actions">
          <button class="btn" type="button" data-action="add-editor-section">Add Section</button>
          <button class="btn" type="button" data-action="add-editor-step">Add Step</button>
          <button class="btn" type="button" data-action="add-editor-ref">Add Reference</button>
        </div>
      </div>
      <div class="card-body">
        <label>Document Title <input name="document-title" value="${esc(doc.title || '')}" /></label>
        <label>Change Summary <input name="changeSummary" placeholder="Summarize this version update" /></label>

        <div class="row"><strong>Sections</strong></div>
        ${sections || '<div class="muted">No sections defined.</div>'}

        <div class="row"><strong>Process Steps</strong></div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>Name</th><th>Role</th><th>Inputs</th><th>Outputs</th><th>Records</th><th>Exceptions</th><th></th></tr>
            </thead>
            <tbody>${steps || '<tr><td colspan="8">No process steps.</td></tr>'}</tbody>
          </table>
        </div>

        <div class="row"><strong>References</strong></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Label</th><th>Type</th><th>Target</th><th></th></tr></thead>
            <tbody>${refs || '<tr><td colspan="4">No references.</td></tr>'}</tbody>
          </table>
        </div>

        <div class="actions">
          <button class="btn primary" type="submit">Save Version</button>
          <button class="btn" type="button" data-action="run-current-validation">Run Validation</button>
        </div>
      </div>
    </form>

    <section class="card">
      <div class="card-head"><h3>AI Helpers</h3></div>
      <div class="card-body">
        <form data-action="generate-interview-summary">
          <div class="grid-3">
            <label>Purpose <input name="q_purpose" /></label>
            <label>Scope <input name="q_scope" /></label>
            <label>Roles <input name="q_roles" /></label>
          </div>
          <label>Procedure Notes <textarea name="q_steps"></textarea></label>
          <div class="actions">
            <button class="btn" type="submit">Generate Interview Summary</button>
            <button class="btn" type="button" data-action="apply-interview-summary">Apply Summary</button>
          </div>
        </form>
        <form data-action="extract-process-model">
          <label>Process Narrative
            <textarea name="rawText"></textarea>
          </label>
          <div class="actions">
            <button class="btn" type="submit">Extract Process Model</button>
            <button class="btn" type="button" data-action="apply-process-extraction">Apply Process Model</button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderEditQualityTab({ state, esc }) {
  const summary = state.validation?.summary
    ? `
      <div class="stat-grid">
        <div class="stat"><span class="muted">Blocking</span><strong>${esc(state.validation.summary.blocking)}</strong></div>
        <div class="stat"><span class="muted">Warning</span><strong>${esc(state.validation.summary.warning)}</strong></div>
        <div class="stat"><span class="muted">Suggestion</span><strong>${esc(state.validation.summary.suggestion)}</strong></div>
      </div>
    `
    : '<div class="muted">No validation run yet.</div>';

  const findings = (state.validation?.findings || [])
    .map((item) => `
      <li class="list-item">
        <div class="row spaced">
          <strong>${esc(item.ruleId)}</strong>
          <span class="badge ${esc(item.severity)}">${esc(item.severity)}</span>
        </div>
        <div>${esc(item.message)}</div>
        <div class="muted">Path: ${esc(item.sectionPath || '-')}</div>
        <div class="muted">Suggestion: ${esc(item.suggestion || '-')}</div>
      </li>
    `)
    .join('');

  return `
    <section class="card">
      <div class="card-head">
        <h3>Quality Validation</h3>
        <button class="btn primary" data-action="run-current-validation">Run Validation</button>
      </div>
      <div class="card-body">
        ${summary}
        <ul class="list-plain">${findings || '<li class="muted">No findings.</li>'}</ul>
      </div>
    </section>
  `;
}

function renderEditReviewTab({ state, esc, fmtDate }) {
  const comments = state.reviewComments
    .map((comment) => `
      <li class="list-item">
        <div class="row spaced">
          <strong>${esc(comment.sectionPath || 'General')}</strong>
          <span class="badge">${esc(comment.status)}</span>
        </div>
        <div>${esc(comment.text)}</div>
        <div class="muted">${esc(comment.authorId)} · ${fmtDate(comment.createdAt)}</div>
        ${comment.status === 'open'
          ? `<button class="btn" data-action="resolve-comment" data-comment-id="${esc(comment.id)}">Resolve</button>`
          : `<div class="muted">Resolved by ${esc(comment.resolvedBy || '-')} at ${fmtDate(comment.resolvedAt)}</div>`}
      </li>
    `)
    .join('');

  return `
    <section class="card">
      <div class="card-head"><h3>Review Collaboration</h3></div>
      <form class="card-body" data-action="add-review-comment">
        <div class="grid-2">
          <label>Section Path <input name="sectionPath" placeholder="sections.2" /></label>
          <label>Comment <input name="text" required /></label>
        </div>
        <div class="actions">
          <button class="btn primary" type="submit">Add Comment</button>
          <button class="btn" type="button" data-action="transition-review">Submit to In Review</button>
        </div>
      </form>
    </section>
    <section class="card">
      <div class="card-head"><h3>Comments</h3></div>
      <div class="card-body">
        <ul class="list-plain">${comments || '<li class="muted">No comments yet.</li>'}</ul>
      </div>
    </section>
  `;
}

function renderEditReleaseTab({ state, esc }) {
  return `
    <section class="card">
      <div class="card-head"><h3>Release Workflow</h3></div>
      <form class="card-body" data-action="transition-workflow">
        <div class="muted">Current Status: <strong>${esc(state.currentSop?.meta?.status || '-')}</strong></div>
        <div class="grid-3">
          <label>Next Status
            <select name="toStatus">
              <option value="Draft">Draft</option>
              <option value="In Review">In Review</option>
              <option value="Approved">Approved</option>
              <option value="Superseded">Superseded</option>
            </select>
          </label>
          <label>Reason <input name="reason" placeholder="Transition reason" /></label>
          <label>Password (for approval when enabled) <input name="password" type="password" /></label>
        </div>
        <div class="actions">
          <button class="btn primary" type="submit">Apply Transition</button>
          <button class="btn" type="button" data-action="publish-sop">Publish Effective</button>
        </div>
      </form>
    </section>
  `;
}

function renderEditLinksTab({ state, esc }) {
  const impact = state.impact || { references: [], linkedBlocks: [], reverseReferences: [] };
  const references = impact.references
    .map((item) => `<li>${esc(item.label || '-')} -> ${esc(item.target || '-')} <span class="muted">(${esc(item.type || '-')})</span></li>`)
    .join('');
  const reusableLinks = impact.linkedBlocks
    .map((item) => `<li>${esc(item.sectionId)} uses reusable source ${esc(item.blockId)}</li>`)
    .join('');
  const reverse = impact.reverseReferences
    .map((item) => `<li>${esc(item.title)} (${esc(item.status)})</li>`)
    .join('');
  const training = state.sopTrainingTasks
    .map((item) => `<li>${esc(item.username || item.userId)} - ${esc(item.status)}</li>`)
    .join('');

  const finalPreview = (state.currentSop?.latestVersion?.document?.sections || [])
    .map((section) => `
      <article class="section-card">
        <strong>${esc(section.title || section.id || 'Section')}</strong>
        <div class="muted">${esc((section.text || '').slice(0, 260))}${(section.text || '').length > 260 ? '...' : ''}</div>
      </article>
    `)
    .join('');

  return `
    <section class="card">
      <div class="card-head"><h3>Impact and Training</h3></div>
      <div class="card-body grid-3">
        <div><strong>Outgoing References</strong><ul>${references || '<li class="muted">None</li>'}</ul></div>
        <div><strong>Reusable Section Links</strong><ul>${reusableLinks || '<li class="muted">None</li>'}</ul></div>
        <div><strong>Reverse References</strong><ul>${reverse || '<li class="muted">None</li>'}</ul></div>
      </div>
      <div class="card-body">
        <strong>Training Tasks</strong>
        <ul>${training || '<li class="muted">No tasks generated.</li>'}</ul>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h3>Final SOP View</h3></div>
      <div class="card-body">
        <div class="message">
          ${esc(state.currentSop?.meta?.code || '-')} · ${esc(state.currentSop?.meta?.title || '-')} ·
          Status: ${esc(state.currentSop?.meta?.status || '-')} · Version: ${esc(state.currentSop?.meta?.currentVersionId || '-')}
        </div>
        <div class="actions">
          <a class="btn primary" target="_blank" href="/api/sops/${encodeURIComponent(state.currentSopId)}/export/html">Open Print-Ready HTML</a>
        </div>
        <div class="grid-2">${finalPreview || '<div class="muted">No section content.</div>'}</div>
      </div>
    </section>
  `;
}

export function renderSopEdit({ state, esc, fmtDate }) {
  if (!state.currentSop) {
    return `
      <section class="card">
        <div class="card-head"><h3>SOP Editor</h3></div>
        <div class="card-body">
          <div class="muted">Select an SOP from the list first.</div>
          <a class="btn" href="#/sops">Go to SOP List</a>
        </div>
      </section>
    `;
  }

  let tabHtml = renderEditorContentTab({ state, esc });
  if (state.sopEditTab === 'quality') {
    tabHtml = renderEditQualityTab({ state, esc });
  } else if (state.sopEditTab === 'review') {
    tabHtml = renderEditReviewTab({ state, esc, fmtDate });
  } else if (state.sopEditTab === 'release') {
    tabHtml = renderEditReleaseTab({ state, esc });
  } else if (state.sopEditTab === 'links') {
    tabHtml = renderEditLinksTab({ state, esc });
  }

  return `
    <section class="card">
      <div class="card-head">
        <h3>${esc(state.currentSop.meta.code)} - ${esc(state.currentSop.meta.title)}</h3>
        <div class="actions">
          <span class="badge">${esc(state.currentSop.meta.status)}</span>
          <a class="btn" href="#/sops">Back to SOP List</a>
        </div>
      </div>
      <div class="card-body">
        <div class="grid-3">
          <div><strong>Area</strong><div class="muted">${esc(state.currentSop.meta.area || '-')}</div></div>
          <div><strong>Version</strong><div class="muted">${esc(state.currentSop.meta.currentVersionId || '-')}</div></div>
          <div><strong>Updated</strong><div class="muted">${fmtDate(state.currentSop.meta.updatedAt)}</div></div>
        </div>
        <div class="studio-tabs">${renderEditTabs({ state, esc })}</div>
      </div>
    </section>
    ${tabHtml}
  `;
}

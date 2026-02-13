export function icon(name, extraClass = '', { esc }) {
  return `<span class="icon ${extraClass ? `${extraClass} ` : ''}icon-${esc(name)}" aria-hidden="true"></span>`;
}

export function navLink(path, label, iconName = 'dot', { esc }) {
  const targetHash = `#${path}`;
  const currentHash = window.location.hash || '#/dashboard';
  const active = path === '/dashboard'
    ? currentHash === '#/dashboard' || currentHash === '#'
    : currentHash === targetHash
      || currentHash.startsWith(`${targetHash}?`)
      || currentHash.startsWith(`${targetHash}/`);

  return `
    <a class="nav-btn ${active ? 'active' : ''}" href="${targetHash}">
      ${icon(iconName, '', { esc })}
      <span>${esc(label)}</span>
    </a>
  `;
}

export function renderMessage({ state, esc }) {
  if (!state.message) {
    return '';
  }
  return `
    <div class="message ${state.message.type === 'error' ? 'error' : ''}">
      <div>${esc(state.message.text)}</div>
      <button class="btn message-close" type="button" data-action="close-message" aria-label="Close message">×</button>
    </div>
  `;
}

export function renderLogin({ esc, state }) {
  return `
    <main class="login-page">
      <div class="login-card">
        <div class="login-head">
          <h1>SOP Manager Studio</h1>
          <p>Governed SOP authoring with quality, review, release, and audit workflows.</p>
        </div>
        <form class="login-body" data-action="login">
          ${renderMessage({ state, esc })}
          <label>Username
            <input name="username" required autocomplete="username" />
          </label>
          <label>Password
            <input name="password" type="password" autocomplete="current-password" />
          </label>
          <button class="btn primary" type="submit">Sign In</button>
          <div class="muted">Default accounts (passwordless): admin (full access), author (create/edit), reviewer (review/sign-off), approver (approve/publish).</div>
          <div class="muted">You can enable password protection later in Settings.</div>
        </form>
      </div>
    </main>
  `;
}

function navGroup(title, links) {
  if (!links.filter(Boolean).length) {
    return '';
  }
  return `
    <div class="nav-group">
      <div class="nav-group-title">${title}</div>
      ${links.filter(Boolean).join('')}
    </div>
  `;
}

export function renderShell(contentHtml, { state, esc, breadcrumbs = '' }) {
  const taskLabel = state.activeTaskCount > 0 ? `Task Monitor (${state.activeTaskCount})` : 'Task Monitor';
  const nav = [
    navGroup('SOPs', [
      navLink('/dashboard', 'Dashboard', 'dashboard', { esc }),
      navLink('/sops', 'SOP List', 'sops', { esc }),
    ]),
    navGroup('Quality & Compliance', [
      navLink('/training', 'Training Compliance', 'training', { esc }),
      navLink('/automation', 'Automation & Scans', 'automation', { esc }),
      navLink('/audit', 'Audit', 'audit', { esc }),
    ]),
    navGroup('Tools', [
      navLink('/assistant', 'Agent Chat', 'chat', { esc }),
      navLink('/templates', 'Templates', 'templates', { esc }),
      navLink('/tasks', taskLabel, 'tasks', { esc }),
    ]),
    navGroup('Administration', [
      state.session.role === 'admin' ? navLink('/users', 'User Management', 'users', { esc }) : '',
      navLink('/settings', 'Settings', 'settings', { esc }),
    ]),
  ].join('');

  return `
    <div class="app-shell ${state.busy ? 'busy' : ''}">
      <aside class="sidebar">
        <div class="brand">
          <h2>SOP Manager</h2>
          <p>Structured Governance Workspace</p>
        </div>
        <nav class="nav-list">${nav}</nav>
        <div class="side-footer">
          <div>Signed in as <strong>${esc(state.session.username)}</strong></div>
          <div>Role: ${esc(state.session.role)}</div>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="top-left">
            <span class="status-line">${esc(breadcrumbs)}</span>
            ${state.currentSop?.meta?.code
    ? `<span class="pill">Editing ${esc(state.currentSop.meta.code)}</span>`
    : ''}
            ${state.busy ? '<span class="busy-chip">Working...</span>' : ''}
          </div>
          <div class="actions">
            <button class="btn danger" data-action="logout">${icon('logout', 'btn-icon', { esc })}<span>Logout</span></button>
          </div>
        </header>
        <section class="content ${state.route.view === 'assistant' ? 'assistant-content' : ''}">
          ${renderMessage({ state, esc })}
          ${contentHtml}
        </section>
      </main>
    </div>
  `;
}

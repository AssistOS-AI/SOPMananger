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
  return `<div class="message ${state.message.type === 'error' ? 'error' : ''}">${esc(state.message.text)}</div>`;
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
          <label>Password (optional)
            <input name="password" type="password" autocomplete="current-password" />
          </label>
          <button class="btn primary" type="submit">Sign In</button>
          <div class="muted">Default accounts: admin, author, reviewer, approver.</div>
        </form>
      </div>
    </main>
  `;
}

export function renderShell(contentHtml, { state, esc }) {
  const navItems = [
    navLink('/dashboard', 'Dashboard', 'dashboard', { esc }),
    navLink('/sops', 'SOP List', 'sops', { esc }),
    navLink('/sops/create', 'Create SOP', 'create', { esc }),
    state.session.role === 'admin' ? navLink('/users', 'User Management', 'users', { esc }) : '',
    navLink('/training', 'Training Compliance', 'training', { esc }),
    navLink('/automation', 'Automation & Scans', 'automation', { esc }),
    navLink('/tasks', 'Task Monitor', 'tasks', { esc }),
    navLink('/assistant', 'Agent Chat', 'chat', { esc }),
    navLink('/templates', 'Templates', 'templates', { esc }),
    navLink('/audit', 'Audit', 'audit', { esc }),
    navLink('/settings', 'Settings', 'settings', { esc }),
  ];
  const nav = navItems.filter(Boolean).join('');

  return `
    <div class="app-shell">
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
            <span class="pill">${esc(state.session.role)}</span>
            <span class="status-line">Signed in as <strong>${esc(state.session.displayName || state.session.username)}</strong></span>
            ${state.busy ? '<span class="busy-chip">Working...</span>' : ''}
          </div>
          <div class="actions">
            <button class="btn" data-action="clear-message">${icon('clear', 'btn-icon', { esc })}<span>Clear Message</span></button>
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

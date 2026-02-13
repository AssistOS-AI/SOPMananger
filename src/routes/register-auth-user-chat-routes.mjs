export function registerAuthUserChatRoutes({
  registerRoute,
  authService,
  chatAgentService,
  documentStore,
  auditStore,
  normalizeChatHistoryItems,
  sendJson,
  sendNoContent,
  HttpError,
}) {
  registerRoute(
    { method: 'GET', pattern: '/health' },
    async ({ res }) => {
      sendJson(res, 200, {
        ok: true,
        service: 'SOP Manager',
        timestamp: new Date().toISOString(),
      });
    },
  );

  registerRoute(
    { method: 'POST', pattern: '/api/auth/login', parseBody: true },
    async ({ req, res, body }) => {
      const username = String(body.username || '');
      const password = typeof body.password === 'string' ? body.password : '';
      if (!username) {
        throw new HttpError(400, 'username is required.');
      }
      const ipAddress = String(req.socket?.remoteAddress || req.headers['x-forwarded-for'] || 'unknown');
      authService.assertLoginAllowed({ username, ipAddress });

      const user = await authService.verifyCredentials(username, password);
      if (!user) {
        authService.registerLoginResult({ username, ipAddress, success: false });
        throw new HttpError(401, 'Invalid credentials.');
      }
      authService.registerLoginResult({ username, ipAddress, success: true });

      const session = authService.createSession(user);
      sendJson(
        res,
        200,
        {
          user,
          csrfToken: session.csrfToken,
        },
        { 'Set-Cookie': authService.buildLoginCookie(session) },
      );
    },
  );

  registerRoute(
    { method: 'POST', pattern: '/api/auth/logout', parseBody: true, auth: true, csrf: true },
    async ({ res, session }) => {
      authService.logout(session.sessionId);
      sendNoContent(res, { 'Set-Cookie': authService.buildLogoutCookie() });
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/auth/session' },
    async ({ res, session }) => {
      sendJson(res, 200, {
        user: session?.user || null,
        csrfToken: session?.csrfToken || '',
      });
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/chat/message',
      parseBody: true,
      auth: true,
      roles: ['author', 'reviewer', 'approver', 'admin'],
      csrf: true,
    },
    async ({ res, body, session }) => {
      const history = await documentStore.getChatHistory(session.user.id);
      const result = await chatAgentService.handleMessage({
        actor: session.user,
        message: body?.message || '',
        selectedSopId: body?.selectedSopId || null,
        password: body?.password || '',
        attachments: Array.isArray(body?.attachments) ? body.attachments : [],
        history: Array.isArray(history) ? history.slice(-20) : [],
        canReauthenticate: async (candidatePassword) => authService.reauthenticate(session, candidatePassword),
      });
      sendJson(res, 200, result);
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/chat/history', auth: true },
    async ({ res, session }) => {
      const items = await documentStore.getChatHistory(session.user.id);
      sendJson(res, 200, {
        items: normalizeChatHistoryItems(items),
      });
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/chat/history',
      parseBody: true,
      auth: true,
      roles: ['author', 'reviewer', 'approver', 'admin'],
      csrf: true,
    },
    async ({ res, session, body }) => {
      const items = normalizeChatHistoryItems(body?.items);
      const stored = await documentStore.saveChatHistory(session.user.id, items);
      sendJson(res, 200, { items: stored });
    },
  );

  registerRoute(
    { method: 'POST', pattern: '/api/auth/password', parseBody: true, auth: true, csrf: true },
    async ({ res, session, body }) => {
      const updatedUser = await authService.updatePasswordForSession(session, {
        currentPassword: typeof body.currentPassword === 'string' ? body.currentPassword : '',
        newPassword: typeof body.newPassword === 'string' ? body.newPassword : '',
      });
      sendJson(res, 200, {
        user: updatedUser,
      });
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/users', auth: true, roles: ['admin'] },
    async ({ res }) => {
      const users = await authService.listUsers();
      sendJson(res, 200, { items: users });
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/users',
      parseBody: true,
      auth: true,
      roles: ['admin'],
      csrf: true,
    },
    async ({ res, session, body }) => {
      const user = await authService.createUser({
        username: body?.username,
        displayName: body?.displayName,
        department: body?.department,
        site: body?.site,
        jobTitle: body?.jobTitle,
        role: body?.role,
        essentialRoles: body?.essentialRoles,
        active: body?.active,
        password: body?.password ?? '',
      });
      await auditStore.append({
        actorId: session.user.id,
        action: 'user.create',
        entityType: 'user',
        entityId: user.id,
        payload: {
          username: user.username,
          role: user.role,
          essentialRoles: user.essentialRoles,
        },
      });
      sendJson(res, 201, user);
    },
  );

  registerRoute(
    {
      method: 'PATCH',
      pattern: '/api/users/:id',
      parseBody: true,
      auth: true,
      roles: ['admin'],
      csrf: true,
    },
    async ({ res, session, params, body }) => {
      const user = await authService.updateUser(params.id, {
        displayName: body?.displayName,
        department: body?.department,
        site: body?.site,
        jobTitle: body?.jobTitle,
        role: body?.role,
        essentialRoles: body?.essentialRoles,
        active: body?.active,
        password: body?.password,
      });
      await auditStore.append({
        actorId: session.user.id,
        action: 'user.update',
        entityType: 'user',
        entityId: user.id,
        payload: {
          role: user.role,
          essentialRoles: user.essentialRoles,
          active: user.active,
        },
      });
      sendJson(res, 200, user);
    },
  );
}

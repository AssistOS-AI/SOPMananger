export function registerTemplateRoutes({
  registerRoute,
  templateService,
  sendJson,
}) {
  registerRoute(
    { method: 'GET', pattern: '/api/templates', auth: true },
    async ({ res }) => {
      const items = await templateService.listTemplates();
      sendJson(res, 200, { items });
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/templates',
      parseBody: true,
      auth: true,
      roles: ['admin', 'author'],
      csrf: true,
    },
    async ({ res, session, body }) => {
      const template = await templateService.createTemplate({
        actor: session.user,
        payload: body || {},
      });
      sendJson(res, 201, template);
    },
  );

  registerRoute(
    {
      method: 'PATCH',
      pattern: '/api/templates/:id',
      parseBody: true,
      auth: true,
      roles: ['admin', 'author'],
      csrf: true,
    },
    async ({ res, session, params, body }) => {
      const template = await templateService.updateTemplate({
        actor: session.user,
        templateId: params.id,
        patch: body || {},
      });
      sendJson(res, 200, template);
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/blocks', auth: true },
    async ({ res }) => {
      const items = await templateService.listTemplates();
      sendJson(res, 200, { items });
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/blocks',
      parseBody: true,
      auth: true,
      roles: ['author', 'admin'],
      csrf: true,
    },
    async ({ res, session, body }) => {
      const block = await templateService.createTemplate({
        actor: session.user,
        payload: body || {},
      });
      sendJson(res, 201, block);
    },
  );
}

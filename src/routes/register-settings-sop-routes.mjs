export function registerSettingsSopRoutes({
  registerRoute,
  authService,
  settingsService,
  sopService,
  templateService,
  trainingService,
  sendJson,
  sendHtml,
  HttpError,
  assuranceCheckCatalog,
  pharmaAreas,
}) {
  registerRoute(
    { method: 'GET', pattern: '/api/settings', auth: true },
    async ({ res }) => {
      const settings = await settingsService.getSettings();
      sendJson(res, 200, {
        ...settings,
        assuranceCheckCatalog,
        pharmaAreas,
      });
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/settings/regulatory-profile',
      parseBody: true,
      auth: true,
      roles: ['admin'],
      csrf: true,
    },
    async ({ res, session, body }) => {
      const updated = await settingsService.updateRegulatoryProfile({
        actor: session.user,
        payload: body || {},
      });
      sendJson(res, 200, {
        ...updated,
        assuranceCheckCatalog,
        pharmaAreas,
      });
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/settings/sop-code-policy',
      parseBody: true,
      auth: true,
      roles: ['admin'],
      csrf: true,
    },
    async ({ res, session, body }) => {
      const updated = await settingsService.updateSopCodePolicy({
        actor: session.user,
        payload: body || {},
      });
      sendJson(res, 200, {
        ...updated,
        assuranceCheckCatalog,
        pharmaAreas,
      });
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/sops', auth: true },
    async ({ res }) => {
      const sops = await sopService.listSops();
      sendJson(res, 200, { items: sops });
    },
  );

  registerRoute(
    { method: 'POST', pattern: '/api/sops', parseBody: true, auth: true, roles: ['author', 'admin'], csrf: true },
    async ({ res, session, body }) => {
      let payload = body || {};
      if (payload.templateId && (!payload.document || typeof payload.document !== 'object')) {
        const template = await templateService.getTemplate(payload.templateId);
        if (!template) {
          throw new HttpError(404, `Template "${payload.templateId}" not found.`);
        }
        payload = {
          ...payload,
          area: payload.area || template.areas[0] || 'General',
          targetRoles: Array.isArray(payload.targetRoles) && payload.targetRoles.length
            ? payload.targetRoles
            : template.targetRoles,
          document: templateService.buildDocumentFromTemplate({
            template,
            title: payload.title || template.title,
            guidanceNote: payload.templateGuidanceNote || '',
            goal: payload.goal || '',
            instructions: payload.authoringInstructions || '',
          }),
        };
      }
      const created = await sopService.createSop({
        actor: session.user,
        payload,
      });
      sendJson(res, 201, created);
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/sops/:id', auth: true },
    async ({ res, params }) => {
      const sop = await sopService.getSop(params.id);
      sendJson(res, 200, sop);
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/sops/:id/versions', auth: true },
    async ({ res, params }) => {
      const items = await sopService.listVersions(params.id);
      sendJson(res, 200, { items });
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/sops/:id/versions',
      parseBody: true,
      auth: true,
      roles: ['author', 'admin'],
      csrf: true,
    },
    async ({ res, session, params, body }) => {
      if (!body?.document || typeof body.document !== 'object') {
        throw new HttpError(400, 'document object is required.');
      }
      const version = await sopService.createVersion({
        sopId: params.id,
        actor: session.user,
        document: body.document,
        changeSummary: body.changeSummary || null,
      });
      sendJson(res, 201, version);
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/sops/:id/validate',
      parseBody: true,
      auth: true,
      roles: ['author', 'reviewer', 'approver', 'admin'],
      csrf: true,
    },
    async ({ res, params, body }) => {
      const result = await sopService.validateSop({
        sopId: params.id,
        document: body?.document ?? null,
      });
      sendJson(res, 200, result);
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/sops/:id/workflow/transition',
      parseBody: true,
      auth: true,
      roles: ['author', 'reviewer', 'approver', 'admin'],
      csrf: true,
    },
    async ({ res, params, body, session }) => {
      const toStatus = String(body.toStatus || '');
      if (!toStatus) {
        throw new HttpError(400, 'toStatus is required.');
      }

      if (toStatus === 'Approved' || toStatus === 'Superseded') {
        authService.requireRole(session, ['approver', 'admin']);
      }

      const reauthenticated = toStatus === 'Approved'
        ? await authService.reauthenticate(session, body.password || '')
        : true;

      const result = await sopService.transitionSop({
        sopId: params.id,
        actor: session.user,
        toStatus,
        reason: body.reason || '',
        eSignature: { reauthenticated },
      });
      sendJson(res, 200, result);
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/sops/:id/publish',
      parseBody: true,
      auth: true,
      roles: ['approver', 'admin'],
      csrf: true,
    },
    async ({ res, params, session }) => {
      const result = await sopService.publishSop({
        sopId: params.id,
        actor: session.user,
      });
      sendJson(res, 200, result);
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/sops/:id/impact', auth: true },
    async ({ res, params }) => {
      const impact = await sopService.analyzeImpact(params.id);
      sendJson(res, 200, impact);
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/sops/:id/training', auth: true },
    async ({ res, params }) => {
      const items = await trainingService.listTasks({ sopId: params.id });
      sendJson(res, 200, { items });
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/sops/:id/review/comments', auth: true },
    async ({ res, params }) => {
      const items = await sopService.listReviewComments(params.id);
      sendJson(res, 200, { items });
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/sops/:id/review/comments',
      parseBody: true,
      auth: true,
      roles: ['author', 'reviewer', 'approver', 'admin'],
      csrf: true,
    },
    async ({ res, params, session, body }) => {
      const comment = await sopService.addReviewComment({
        sopId: params.id,
        actor: session.user,
        sectionPath: body.sectionPath,
        text: body.text,
      });
      sendJson(res, 201, comment);
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/sops/:id/review/comments/:commentId/resolve',
      parseBody: true,
      auth: true,
      roles: ['reviewer', 'approver', 'admin'],
      csrf: true,
    },
    async ({ res, params, session }) => {
      const comment = await sopService.resolveReviewComment({
        sopId: params.id,
        actor: session.user,
        commentId: params.commentId,
      });
      sendJson(res, 200, comment);
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/sops/:id/blocks/instantiate',
      parseBody: true,
      auth: true,
      roles: ['author', 'admin'],
      csrf: true,
    },
    async ({ res, params, session, body }) => {
      const result = await sopService.instantiateBlock({
        sopId: params.id,
        actor: session.user,
        blockId: body.blockId,
        mode: body.mode,
        parameters: body.parameters,
        sectionId: body.sectionId,
      });
      sendJson(res, 201, result);
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/process/extract',
      parseBody: true,
      auth: true,
      roles: ['author', 'admin'],
      csrf: true,
    },
    async ({ res, body }) => {
      const result = await sopService.extractProcessModel(body?.rawText || '');
      sendJson(res, 200, result);
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/interviews/summarize',
      parseBody: true,
      auth: true,
      roles: ['author', 'admin'],
      csrf: true,
    },
    async ({ res, body }) => {
      const summary = await sopService.summarizeInterview(body || {});
      sendJson(res, 200, summary);
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/sops/:id/export/html', auth: true },
    async ({ res, params }) => {
      const html = await sopService.exportSopHtml(params.id);
      sendHtml(res, 200, html);
    },
  );
}

export function registerTrainingTaskAutomationRoutes({
  registerRoute,
  taskService,
  assuranceService,
  settingsService,
  trainingService,
  automationService,
  sopService,
  sendJson,
}) {
  registerRoute(
    { method: 'GET', pattern: '/api/training/tasks', auth: true },
    async ({ res, query }) => {
      const sopId = query.get('sopId');
      const userId = query.get('userId');
      const status = query.get('status');
      const items = await trainingService.listTasks({
        sopId: sopId || null,
        userId: userId || null,
        status: status || null,
      });
      sendJson(res, 200, { items });
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/training/overview', auth: true },
    async ({ res, query }) => {
      const sopId = query.get('sopId');
      const overview = await trainingService.getOverview({
        sopId: sopId || null,
      });
      sendJson(res, 200, overview);
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/training/tasks/:id/read',
      parseBody: true,
      auth: true,
      csrf: true,
    },
    async ({ res, params, session, body }) => {
      const task = await trainingService.markRead({
        taskId: params.id,
        actor: session.user,
        note: body?.note || '',
      });
      sendJson(res, 200, task);
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/training/tasks/:id/quiz',
      parseBody: true,
      auth: true,
      csrf: true,
    },
    async ({ res, params, session, body }) => {
      const task = await trainingService.submitQuiz({
        taskId: params.id,
        actor: session.user,
        score: body?.score,
      });
      sendJson(res, 200, task);
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/training/tasks/:id/signoff',
      parseBody: true,
      auth: true,
      roles: ['reviewer', 'approver', 'admin'],
      csrf: true,
    },
    async ({ res, params, session, body }) => {
      const task = await trainingService.signoff({
        taskId: params.id,
        actor: session.user,
        note: body?.note || '',
      });
      sendJson(res, 200, task);
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/tasks/assurance',
      parseBody: true,
      auth: true,
      roles: ['author', 'reviewer', 'approver', 'admin'],
      csrf: true,
    },
    async ({ res, body, session }) => {
      const regulatoryProfile = await settingsService.getRegulatoryProfile();
      const checks = Array.isArray(body?.checks) && body.checks.length
        ? body.checks
        : regulatoryProfile.assuranceChecks;
      const task = await taskService.createTask({
        type: 'assurance-scan',
        title: body?.title || 'Assurance Scan',
        actorId: session.user.id,
        input: {
          ...(body || {}),
          checks,
          regulatoryProfile,
        },
        runner: async ({ update, input }) => assuranceService.runAssuranceTask({ update, input }),
      });
      sendJson(res, 202, task);
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/tasks/generate-draft',
      parseBody: true,
      auth: true,
      roles: ['author', 'admin'],
      csrf: true,
    },
    async ({ res, body, session }) => {
      const regulatoryProfile = await settingsService.getRegulatoryProfile();
      const task = await taskService.createTask({
        type: 'sop-draft-generation',
        title: body?.title || 'SOP Draft Generation',
        actorId: session.user.id,
        input: {
          ...(body || {}),
          regulatoryProfile,
        },
        runner: async ({ update, input }) => assuranceService.runDraftGenerationTask({ update, input }),
      });
      sendJson(res, 202, task);
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/tasks', auth: true },
    async ({ res, query }) => {
      const type = query.get('type');
      const limit = Number(query.get('limit') || 100);
      const items = taskService.listTasks({
        actorId: null,
        type: type || null,
        limit,
      });
      sendJson(res, 200, { items });
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/tasks/:id', auth: true },
    async ({ res, params }) => {
      const task = taskService.getTask(params.id, {
        actorId: null,
        isAdmin: true,
      });
      sendJson(res, 200, task);
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/automation/jobs', auth: true },
    async ({ res }) => {
      const items = await automationService.listJobs();
      sendJson(res, 200, { items });
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/automation/jobs',
      parseBody: true,
      auth: true,
      roles: ['admin'],
      csrf: true,
    },
    async ({ res, body, session }) => {
      const job = await automationService.createJob({
        actor: session.user,
        payload: body || {},
      });
      sendJson(res, 201, job);
    },
  );

  registerRoute(
    {
      method: 'PATCH',
      pattern: '/api/automation/jobs/:id',
      parseBody: true,
      auth: true,
      roles: ['admin'],
      csrf: true,
    },
    async ({ res, params, body, session }) => {
      const job = await automationService.updateJob({
        actor: session.user,
        jobId: params.id,
        patch: body || {},
      });
      sendJson(res, 200, job);
    },
  );

  registerRoute(
    {
      method: 'POST',
      pattern: '/api/automation/jobs/:id/run',
      parseBody: true,
      auth: true,
      roles: ['admin'],
      csrf: true,
    },
    async ({ res, params, session }) => {
      const result = await automationService.runJobNow({
        actor: session.user,
        jobId: params.id,
        trigger: 'manual',
      });
      sendJson(res, 202, result);
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/audit/events', auth: true },
    async ({ res, query }) => {
      const entityId = query.get('entityId');
      const entityType = query.get('entityType');
      const limit = query.get('limit');
      const items = await sopService.listAuditEvents({
        entityId: entityId || null,
        entityType: entityType || null,
        limit: limit ? Number(limit) : 200,
      });
      sendJson(res, 200, { items });
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/audit/verify', auth: true, roles: ['admin'] },
    async ({ res }) => {
      const verification = await sopService.verifyAudit();
      sendJson(res, 200, verification);
    },
  );
}

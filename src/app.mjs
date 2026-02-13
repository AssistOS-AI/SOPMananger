import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from './lib/router.mjs';
import {
  HttpError,
  jsonErrorResponse,
  readJsonBody,
  sendHtml,
  sendJson,
  sendNoContent,
} from './lib/http.mjs';
import { DocumentStore } from './storage/document-store.mjs';
import { AuditStore } from './storage/audit-store.mjs';
import { AuthService } from './services/auth-service.mjs';
import { ValidationService } from './services/validation-service.mjs';
import { WorkflowService } from './services/workflow-service.mjs';
import { LLMService } from './services/llm-service.mjs';
import { SopService } from './services/sop-service.mjs';
import { TaskService } from './services/task-service.mjs';
import { AssuranceService } from './services/assurance-service.mjs';
import { ChatAgentService } from './services/chat-agent-service.mjs';
import { SettingsService, ASSURANCE_CHECK_CATALOG } from './services/settings-service.mjs';
import { TrainingService } from './services/training-service.mjs';
import { AutomationService } from './services/automation-service.mjs';
import { TemplateService } from './services/template-service.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_CHAT_HISTORY_ITEMS = 200;
const MAX_CHAT_ATTACHMENTS = 6;
const PHARMA_AREAS = [
  'Quality Assurance',
  'Quality Control',
  'QC Laboratory',
  'Manufacturing',
  'Production',
  'Warehouse',
  'Supply Chain',
  'Engineering',
  'Validation',
  'Regulatory Affairs',
  'Pharmacovigilance',
  'Clinical Operations',
  'Microbiology',
  'IT / CSV',
  'EHS',
  'Training',
  'General',
];

function normalizeChatHistoryItems(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .slice(-MAX_CHAT_HISTORY_ITEMS)
    .map((entry, index) => {
      const role = entry?.role === 'assistant' ? 'assistant' : 'user';
      const text = String(entry?.text || '').slice(0, 12000);
      const at = String(entry?.at || '').trim() || new Date().toISOString();
      const actions = Array.isArray(entry?.actions)
        ? entry.actions.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
        : [];
      const attachments = Array.isArray(entry?.attachments)
        ? entry.attachments
          .slice(0, MAX_CHAT_ATTACHMENTS)
          .map((attachment) => ({
            id: String(attachment?.id || `a-${index + 1}`).slice(0, 64),
            name: String(attachment?.name || 'attachment').slice(0, 160),
            mimeType: String(attachment?.mimeType || '').slice(0, 120),
            size: Number(attachment?.size || 0),
          }))
        : [];
      return {
        role,
        text,
        at,
        actions,
        attachments,
      };
    });
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) {
    return 'application/javascript; charset=utf-8';
  }
  if (filePath.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (filePath.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  if (filePath.endsWith('.json')) {
    return 'application/json; charset=utf-8';
  }
  return 'application/octet-stream';
}

async function tryServeStatic(pathname, res) {
  const cleanPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const normalized = path.normalize(cleanPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const resolved = path.join(PUBLIC_DIR, normalized);
  const relative = path.relative(PUBLIC_DIR, resolved);

  if (relative.startsWith('..')) {
    return false;
  }

  try {
    const content = await fs.readFile(resolved);
    res.writeHead(200, { 'Content-Type': contentTypeFor(resolved) });
    res.end(content);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function createApp(options = {}) {
  const dataRoot = options.dataRoot ?? path.join(process.cwd(), 'data');
  const workspaceId = options.workspaceId ?? 'default';
  const quiet = Boolean(options.quiet);

  const documentStore = new DocumentStore({ dataRoot, workspaceId });
  await documentStore.ensureWorkspace();

  const auditStore = new AuditStore({ workspacePath: documentStore.workspacePath });
  const authService = new AuthService({
    usersFilePath: documentStore.usersFilePath,
    secureCookies: Boolean(options.secureCookies),
  });
  await authService.ensureDefaultUsers();

  const validationService = new ValidationService({
    rulesPath: path.join(__dirname, 'config', 'validation-rules.json'),
  });
  const workflowService = new WorkflowService();
  const llmService = new LLMService({
    libraryPath: options.llmLibraryPath,
    enabled: options.llmEnabled !== false,
  });
  const settingsService = new SettingsService({
    documentStore,
    auditStore,
  });
  await settingsService.initialize();
  const templateService = new TemplateService({
    documentStore,
    auditStore,
  });
  await templateService.initialize();
  const sopService = new SopService({
    documentStore,
    auditStore,
    validationService,
    workflowService,
    llmService,
    resolveUsers: async () => authService.listUsers(),
    resolveTrainingPolicy: async () => settingsService.getTrainingPolicy(),
    resolveSopCode: async ({ actor, payload }) => settingsService.allocateSopCode({
      actor,
      area: payload?.area || 'General',
    }),
  });
  await sopService.initialize();
  const taskService = new TaskService();
  const assuranceService = new AssuranceService({
    sopService,
    llmService,
  });
  const trainingService = new TrainingService({
    documentStore,
    auditStore,
    settingsService,
  });
  const automationService = new AutomationService({
    documentStore,
    auditStore,
    taskService,
    assuranceService,
    settingsService,
  });
  await automationService.initialize();
  automationService.start();
  const chatAgentService = new ChatAgentService({
    sopService,
    llmService,
    taskService,
    assuranceService,
    settingsService,
    trainingService,
  });

  const router = new Router();

  const registerRoute = ({
    method,
    pattern,
    auth = false,
    roles = [],
    parseBody = false,
    csrf = false,
  }, handler) => {
    router.add(method, pattern, async (req, res, routeContext) => {
      const session = authService.getSessionFromRequest(req);
      if (auth) {
        authService.requireAuthenticated(session);
      }
      if (roles.length) {
        authService.requireRole(session, roles);
      }

      const body = parseBody ? await readJsonBody(req) : null;

      if (csrf) {
        const csrfToken = req.headers['x-csrf-token'] || body?.csrfToken;
        if (!authService.validateCsrf(session, csrfToken)) {
          throw new HttpError(403, 'Invalid CSRF token.');
        }
      }

      return handler({
        req,
        res,
        params: routeContext.params,
        query: routeContext.query,
        body,
        session,
      });
    });
  };

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
    async ({ res, body }) => {
      const username = String(body.username || '');
      const password = typeof body.password === 'string' ? body.password : '';
      if (!username) {
        throw new HttpError(400, 'username is required.');
      }

      const user = await authService.verifyCredentials(username, password);
      if (!user) {
        throw new HttpError(401, 'Invalid credentials.');
      }

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
    { method: 'GET', pattern: '/api/auth/session', auth: true },
    async ({ res, session }) => {
      sendJson(res, 200, {
        user: session.user,
        csrfToken: session.csrfToken,
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
      const result = await chatAgentService.handleMessage({
        actor: session.user,
        message: body?.message || '',
        selectedSopId: body?.selectedSopId || null,
        password: body?.password || '',
        attachments: Array.isArray(body?.attachments) ? body.attachments : [],
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

  registerRoute(
    { method: 'GET', pattern: '/api/settings', auth: true },
    async ({ res }) => {
      const settings = await settingsService.getSettings();
      sendJson(res, 200, {
        ...settings,
        assuranceCheckCatalog: ASSURANCE_CHECK_CATALOG,
        pharmaAreas: PHARMA_AREAS,
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
        assuranceCheckCatalog: ASSURANCE_CHECK_CATALOG,
        pharmaAreas: PHARMA_AREAS,
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
        assuranceCheckCatalog: ASSURANCE_CHECK_CATALOG,
        pharmaAreas: PHARMA_AREAS,
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

      if (toStatus === 'Approved') {
        authService.requireRole(session, ['approver', 'admin']);
      }
      if (toStatus === 'Superseded') {
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
    { method: 'GET', pattern: '/api/sops/:id/export/html', auth: true },
    async ({ res, params }) => {
      const html = await sopService.exportSopHtml(params.id);
      sendHtml(res, 200, html);
    },
  );

  registerRoute(
    { method: 'GET', pattern: '/api/audit/verify', auth: true, roles: ['admin'] },
    async ({ res }) => {
      const verification = await sopService.verifyAudit();
      sendJson(res, 200, verification);
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

  const handleRequest = async (req, res) => {
    const requestUrl = new URL(req.url, 'http://localhost');
    const pathname = requestUrl.pathname;

    if (pathname.startsWith('/api/') || pathname === '/health') {
      await router.handle(req, res, {
        pathname,
        query: requestUrl.searchParams,
      });
      return;
    }

    if (req.method === 'GET') {
      const served = await tryServeStatic(pathname, res);
      if (served) {
        return;
      }
      if (!pathname.includes('.')) {
        const indexHtml = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
        sendHtml(res, 200, indexHtml);
        return;
      }
    }

    throw new HttpError(404, 'Not found.');
  };

  return {
    handleRequest,
    services: {
      authService,
      sopService,
      taskService,
      assuranceService,
      chatAgentService,
      settingsService,
      templateService,
      trainingService,
      automationService,
      validationService,
      workflowService,
      llmService,
    },
    config: {
      dataRoot,
      workspaceId,
    },
    logger: (...args) => {
      if (!quiet) {
        // eslint-disable-next-line no-console
        console.log(...args);
      }
    },
    errorHandler: jsonErrorResponse,
  };
}

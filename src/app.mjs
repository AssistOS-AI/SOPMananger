import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from './lib/router.mjs';
import {
  HttpError,
  jsonErrorResponse,
  readJsonBody,
  SECURITY_HEADERS,
  sendHtml,
  sendJson,
  sendNoContent,
} from './lib/http.mjs';
import { normalizeChatHistoryItems } from './lib/chat-history.mjs';
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
import { registerAuthUserChatRoutes } from './routes/register-auth-user-chat-routes.mjs';
import { registerSettingsSopRoutes } from './routes/register-settings-sop-routes.mjs';
import { registerTemplateRoutes } from './routes/register-template-routes.mjs';
import { registerTrainingTaskAutomationRoutes } from './routes/register-training-task-automation-routes.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

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

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
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
  if (filePath.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  return 'application/octet-stream';
}

async function tryServeStatic(pathname, res) {
  const requestedPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    return false;
  }

  const normalizedPath = path.normalize(decodedPath);
  const resolved = path.resolve(PUBLIC_DIR, normalizedPath);
  const relative = path.relative(PUBLIC_DIR, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return false;
  }

  try {
    const content = await fs.readFile(resolved);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': contentTypeFor(resolved),
      'Content-Length': Buffer.byteLength(content),
    });
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
        const csrfToken = req.headers['x-csrf-token'];
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

  registerAuthUserChatRoutes({
    registerRoute,
    authService,
    chatAgentService,
    documentStore,
    auditStore,
    normalizeChatHistoryItems,
    sendJson,
    sendNoContent,
    HttpError,
  });

  registerSettingsSopRoutes({
    registerRoute,
    authService,
    settingsService,
    sopService,
    templateService,
    trainingService,
    sendJson,
    sendHtml,
    HttpError,
    assuranceCheckCatalog: ASSURANCE_CHECK_CATALOG,
    pharmaAreas: PHARMA_AREAS,
  });

  registerTemplateRoutes({
    registerRoute,
    templateService,
    sendJson,
  });

  registerTrainingTaskAutomationRoutes({
    registerRoute,
    taskService,
    assuranceService,
    settingsService,
    trainingService,
    automationService,
    sopService,
    sendJson,
  });

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

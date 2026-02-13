# DESIGN Specification DS002 - System Design

## 1. Runtime Architecture
Single Node.js monolith (ESM, async/await):
- HTTP server + REST-like JSON API
- server-hosted SPA (`src/public/`)
- local file persistence (`data/workspaces/default`)
- no external runtime dependencies

## 2. Module Layout
- `src/server.mjs`: HTTP bootstrap
- `src/app.mjs`: route registration and service composition
- `src/lib/`: router and HTTP helpers
- `src/storage/`: document/audit/json stores
- `src/services/`:
  - `auth-service.mjs`
  - `sop-service.mjs`
  - `validation-service.mjs`
  - `workflow-service.mjs`
  - `llm-service.mjs` (AchillesAgentLib adapter)
  - `task-service.mjs`
  - `assurance-service.mjs`
  - `chat-agent-service.mjs`
  - `settings-service.mjs`
  - `template-service.mjs`
  - `training-service.mjs`
  - `automation-service.mjs`

## 3. Persistence Layout
```text
data/workspaces/default/
  users/users.json
  settings/workspace-settings.json
  automation/jobs.json
  templates/templates.json
  sops/{sopId}/meta.json
  sops/{sopId}/versions/{versionId}.json
  sops/{sopId}/review-comments.json
  training/tasks.json
  chat/histories.json
  audit/audit.log.jsonl
  audit/state.json
```

## 4. Core Models
- `User`
  - primary role (`admin|author|reviewer|approver`)
  - essential roles (multi-role domain mapping)
  - profile fields (display name, department, site, job title)
- `RegulatoryProfile`
  - regulations, national institutions, internal policies
  - assurance check defaults
  - training policy (due days, pass score, sign-off requirement)
- `TrainingTask`
  - assignment, due date, read acknowledgement, quiz attempts/scores, trainer sign-off, computed status
- `SOPDocument`
  - structured sections/process/references
  - optional `authorContext` (`goal`, `instructions`, `templateGuidanceNote`) captured at creation time
- `AutomationJob`
  - type, interval, enabled, next run, last run, input payload
- `ServerTask`
  - long-running async operation (`queued/running/completed/failed`) with progress/log/result

## 5. Security and Identity
- password hashing via `crypto.scrypt`
- cookie session + CSRF token
- server-side RBAC on all protected routes
- optional passwordless login per account
- e-signature re-authentication for approval transitions
- admin user management endpoints for account lifecycle and role assignment

## 6. API Surface (Core)
- Auth
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/session`
  - `POST /api/auth/password`
- Users
  - `GET /api/users` (admin)
  - `POST /api/users` (admin)
  - `PATCH /api/users/:id` (admin)
- SOP lifecycle
  - `GET /api/sops`
  - `POST /api/sops`
  - `GET /api/sops/:id`
  - `GET /api/sops/:id/versions`
  - `POST /api/sops/:id/versions`
  - `POST /api/sops/:id/validate`
  - `POST /api/sops/:id/workflow/transition`
  - `POST /api/sops/:id/publish`
  - `GET /api/sops/:id/impact`
  - `GET /api/sops/:id/training`
  - `GET /api/sops/:id/export/html`
- Review + templates + process
  - `GET /api/sops/:id/review/comments`
  - `POST /api/sops/:id/review/comments`
  - `POST /api/sops/:id/review/comments/:commentId/resolve`
  - `GET /api/templates`
  - `POST /api/templates`
  - `PATCH /api/templates/:id`
  - `POST /api/process/extract`
- Training compliance
  - `GET /api/training/tasks`
  - `GET /api/training/overview`
  - `POST /api/training/tasks/:id/read`
  - `POST /api/training/tasks/:id/quiz`
  - `POST /api/training/tasks/:id/signoff`
- Settings + automation
  - `GET /api/settings`
  - `POST /api/settings/regulatory-profile` (admin)
  - `POST /api/settings/sop-code-policy` (admin)
  - `GET /api/automation/jobs`
  - `POST /api/automation/jobs` (admin)
  - `PATCH /api/automation/jobs/:id` (admin)
  - `POST /api/automation/jobs/:id/run` (admin)
- Long-running tasks and assistant
  - `POST /api/tasks/assurance`
  - `POST /api/tasks/generate-draft`
  - `GET /api/tasks`
  - `GET /api/tasks/:id`
  - `POST /api/chat/message`
  - `GET /api/chat/history`
  - `POST /api/chat/history`
- Audit
  - `GET /api/audit/events`
  - `GET /api/audit/verify`

## 7. Long-Running Processing
- Assurance scans and draft generation run as server tasks.
- Scheduled automation jobs trigger task creation periodically.
- Task monitor UI and API provide real-time progress inspection.

## 8. LLM Integration
- All model calls go through `LLMService`.
- `LLMService` uses `AchillesAgentLib` from parent workspace.
- Layered prompt input model:
  - high-level specification
  - hard constraints
  - general narrative
- deterministic fallback is mandatory when LLM output is unavailable/malformed.

## 9. Audit Integrity
- append-only hash chain per event
- explicit audit events for SOP lifecycle, user changes, settings updates, training evidence, and automation job actions
- chain verification endpoint for integrity checks

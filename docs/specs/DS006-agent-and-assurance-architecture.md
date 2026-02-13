# DESIGN Specification DS006 - Agent, Assurance, and Automation

## 1. Purpose
Define how conversational control, assurance scans, and scheduled automation operate together in SOP Manager.

## 2. Conversational Agent Contract
- Endpoint: `POST /api/chat/message`
- Inputs:
  - message
  - selected SOP context (optional, from chat tools drawer)
  - password for approval operations (optional, from chat tools drawer)
  - attachments (optional; text content and/or metadata)
- Outputs:
  - assistant reply
  - selected SOP id
  - action list + optional structured payload

Supported operational intents:
- SOP lifecycle commands:
  - list/open SOP
  - validate
  - submit to review
  - approve (role + re-auth constraints)
  - publish
  - create SOP
- Operational visibility:
  - list current server tasks
  - show training status summary
- Automation trigger:
  - run assurance scan from chat
- File-assisted operations:
  - summarize attached source material
  - create SOP draft from attachment content

Conversation persistence:
- chat history is stored per authenticated user
- history is reloaded on next login/session restore
- persistence is separated from SOP documents and does not alter SOP data unless explicit commands are executed
- chat request UX must avoid indefinite spinner loops; requests time out client-side and direct users to Task Monitor for long operations

## 3. Assurance Execution Model
- Manual assurance trigger: `POST /api/tasks/assurance`
- Long-running execution through `TaskService`
- Task data includes progress, logs, final JSON result

Assurance scope:
- all SOPs or selected SOPs
- checks chosen explicitly or inherited from regulatory profile

## 4. Prompt Layering Standard
Assurance and generation prompts are always split into:
1. High-Level Specification
2. Hard Constraints
3. General Narrative Context

This avoids losing mandatory constraints in free-form context and improves repeatability.

## 5. Regulatory Profile Ownership
- Regulatory profile is configured in `Settings`, not on scan pages.
- Scan pages consume the workspace profile and allow check-level targeting.
- Profile fields:
  - regulations
  - institutions
  - internal policies
  - assurance checks
  - training policy

## 6. Scheduled Automation Jobs
Cron-like configuration endpoints:
- `GET /api/automation/jobs`
- `POST /api/automation/jobs`
- `PATCH /api/automation/jobs/:id`
- `POST /api/automation/jobs/:id/run`

Job types:
- `assurance-scan`
- `sop-draft-generation`

Scheduler behavior:
- periodic due-check loop (server-side)
- due enabled jobs spawn background tasks
- each run updates `lastRunAt`, `nextRunAt`, `lastTaskId`

## 7. Reliability and Fallback
- All long operations are task-based and observable.
- If LLM output is unavailable or malformed, fallback deterministic results are returned.
- Automation and agent operations remain auditable and reproducible.

# DESIGN Specification DS003 - Implementation and Test Plan

## 1. Delivery Sequence
1. Core platform: server bootstrap, persistence primitives, auth/session/CSRF.
2. SOP lifecycle: create/version/validate/review/approve/publish/export.
3. Reuse + analysis: templates, impact analysis, process extraction.
4. Async orchestration: task engine, assurance scans, generation runs, chat operations.
5. Governance layer: settings profile, user management, training evidence tracking, automation scheduler.
6. SPA UX hardening: separated pages for dashboard/create/edit/monitoring.
7. End-to-end seed/verify flow and regression tests.

## 2. Implemented Module Map
- `src/services/auth-service.mjs`
  - passwordless + password-enabled auth
  - admin user creation/update and essential role assignment
- `src/services/settings-service.mjs`
  - regulatory profile persistence
  - assurance check catalog
  - training policy resolution
  - SOP code policy and auto-allocation
- `src/services/template-service.mjs`
  - template library persistence + defaults
  - template to SOP document instantiation
- `src/services/training-service.mjs`
  - read acknowledgement
  - quiz submission
  - trainer sign-off
  - compliance overview aggregation
- `src/services/automation-service.mjs`
  - scheduled job persistence
  - periodic due-run loop
  - manual run trigger
- `src/services/assurance-service.mjs`
  - layered prompt builder
  - profile-aware assurance fallback
- `src/public/app.js`
  - route-based SPA with dedicated pages for users/training/automation/tasks/settings

## 3. Required Test Coverage
- `tests/audit-store.test.mjs`
  - append-only hash chain + tamper detection
- `tests/auth-service.test.mjs`
  - password lifecycle + user management create/update
- `tests/training-service.test.mjs`
  - read/quiz/sign-off workflow and overview metrics
- `tests/sop-service.test.mjs`
  - SOP lifecycle, review comments, impact analysis
- `tests/chat-history-store.test.mjs`
  - per-user chat history persistence
- `tests/task-service.test.mjs`
  - long-running task progress/result lifecycle
- `tests/chat-agent-service.test.mjs`
  - operational commands with role constraints
- `tests/ui-actions.test.mjs`
  - no dead-click UI controls (`data-action` must map to a handler)
- `tests/server-smoke.test.mjs`
  - health endpoint and app bootstrap smoke

## 4. Verification Commands
- `npm test`
- `npm run seed -- --reset`
- `npm run verify`
- `npm run server`

## 5. Done Criteria
- Full lifecycle is usable from UI and API.
- Regulatory profile is configured in `Settings` and consumed by assurance/automation flows.
- Current server tasks are inspectable in a dedicated task monitor.
- Training evidence supports GxP-style read/quiz/sign-off tracking.
- All tests pass and seed/verify scripts confirm coherent workspace state.

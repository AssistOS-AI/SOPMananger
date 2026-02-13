# DESIGN Specification DS004 - SPA Studio Interface

## 1. Interface Goal
Deliver a clear, production-style SOP workspace with separated navigation for:
- monitoring (`Dashboard`, `Task Monitor`)
- SOP lifecycle work (`SOP List`, `Create SOP`, `Edit SOP`)
- governance operations (`User Management`, `Settings`, `Audit`)
- compliance operations (`Training Compliance`, `Automation & Scans`)
- assistance tools (`Agent Chat`, `Templates`)

The interface is server-hosted, dependency-free, and API-driven.

## 2. UX Structure
- `Dashboard`
  - concise SOP status cards with direct navigation to filtered SOP lists
  - compliance snapshot: training completion, overdue tasks, task monitor shortcut
- `SOP List`
  - filter/search table and direct open action
- `Create SOP`
  - dedicated page with title + pharma area select + target role checkboxes
  - optional template selection (predefined structure/guidance)
  - author context fields (`Current Goal`, `Authoring Instructions`, `Template Guidance Notes`)
  - SOP code generated automatically from settings policy
- `SOP Edit`
  - dedicated page with tabs: Content, Quality, Review, Release, Links/Final View
- `Task Monitor`
  - current server tasks, status/progress, details/log/result
- `Automation & Scans`
  - manual assurance run
  - draft generation run
  - scheduled cron-like jobs for long-running operations
- `Training Compliance`
  - overview KPIs + matrix with due/read/quiz/sign-off evidence
- `User Management`
  - account creation and role assignment, including essential role mapping
- `Settings`
  - password settings
  - regulatory profile configuration (regulations, institutions, internal policies, assurance checks, training policy)
- `Agent Chat`
  - chat-style thread (assistant/user bubbles)
  - composer with free text command input
  - attachment upload support (text-first; metadata for binary)
  - tools drawer in composer for SOP selection and approval password input
  - quick command chips and action trace tags
  - per-user chat history restore after login

## 3. Routing Model
- `#/dashboard`
- `#/sops`
- `#/sops/create`
- `#/sops/:id/edit`
- `#/users`
- `#/training`
- `#/automation`
- `#/tasks`
- `#/assistant`
- `#/templates`
- `#/audit`
- `#/settings`

Alias support:
- `#/assurance` routes to `#/automation` for backward compatibility.
- `#/blocks` routes to `#/templates` for backward compatibility.

## 4. Interaction Rules
- Every visible interactive control must execute a meaningful navigation or data action.
- Status cards and KPI controls are actionable, not decorative.
- No mixed create/edit flow on one page: create and edit are separated.
- Task-based operations stay asynchronous and observable.
- Regulatory profile selection belongs to `Settings`; scan pages consume that profile.
- Chat must feel like a modern assistant interface while all mutations are still executed through authenticated backend APIs.
- Chat thread auto-scrolls on new/streaming messages to keep latest output visible.
- UI language and generated content remain in English.

## 5. Error and Feedback Behavior
- All mutating actions show immediate success/error feedback.
- API errors are shown as user-facing messages.
- Busy state prevents duplicate submissions.
- Long-running operations are routed through task APIs and can be tracked later.

## 6. Non-Functional Targets
- Works on desktop and mobile widths.
- No third-party frontend dependencies.
- Single static bundle model (`index.html`, `app.js`, `styles.css`).

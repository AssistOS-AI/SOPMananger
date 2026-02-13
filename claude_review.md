# Claude Review - Remaining Disagreements Only

All review findings that were relevant and compatible with current project constraints were addressed.

The items below are intentionally **not** implemented because they conflict with explicit product or architecture requirements.

## 1) Force mandatory passwords for all users
- Status: Rejected by design.
- Reason: Product requirement is password-optional access for local studio usage, with UI support to enable/disable password later. Enforcing mandatory passwords would violate requested behavior.

## 2) Introduce external dependencies for auth/session/audit hardening
- Status: Rejected by architecture constraint.
- Reason: The project must run with zero external runtime dependencies (Node built-ins only). Recommendations requiring third-party packages were intentionally not applied.

## 3) Replace current SPA with server-rendered multi-page app
- Status: Rejected by product direction.
- Reason: Requested UX is a coherent studio-like SPA, while processing and LLM orchestration remain server-side via API. Moving to MPA would conflict with this requirement.

## 4) Remove passwordless default admin behavior from seeded/demo users
- Status: Rejected by product requirement.
- Reason: Current requirement is easy first access without password and optional password setup from UI settings.

## Additional Recommended Work (Not a disagreement)
1. Add browser-level integration tests for core UI flows:
- SOP create -> edit -> validate -> review -> approve -> publish.
- Chat flow with attachment + tool usage.
- Training acknowledgment and sign-off.

2. Add route-level test coverage for new route modules:
- `src/routes/register-settings-sop-routes.mjs`
- `src/routes/register-template-routes.mjs`
- `src/routes/register-training-task-automation-routes.mjs`

3. Add graceful server shutdown hooks for long-running services:
- Explicit stop/flush for automation scheduler and pending audit queue on process exit.

4. Add deterministic fixture assertions for `scripts/seed-workspace.mjs`:
- Verify exact seeded SOP codes/statuses and expected cross-links after seed, not only aggregate counts.

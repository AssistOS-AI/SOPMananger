# DESIGN Specification DS005 - Product Hardening Roadmap

## 1. Objective
Define next high-value improvements on top of the current governed baseline (user management, regulatory profile, training evidence tracking, automation jobs, and task monitoring).

## 2. Priority Improvements

### P1 - Workflow Robustness
- Add explicit review checklist completion before approval transition.
- Enforce unresolved review-comment policy gates by configuration.
- Add optimistic concurrency check on version save to avoid silent overwrite.

### P1 - Security and Identity
- Add admin-managed password policy (minimum length, complexity toggle, expiration).
- Add optional account lockout after repeated failed logins.
- Add signed, rotating session secret with restart-safe persistence.

### P1 - Data Integrity and Recovery
- Add periodic snapshot export/import for workspace backup.
- Add audit log compaction strategy with signed archive segments.
- Add crash-safe operation journal for multi-step write sequences.

### P2 - Authoring and Content Quality
- Add guided section templates by SOP type.
- Add terminology dictionary editor and auto-normalization suggestions.
- Add richer validation rules for acceptance criteria completeness and numeric thresholds.

### P2 - Collaboration UX
- Add side-by-side version diff view for every save.
- Add reviewer assignment and due dates.
- Add in-app notification center for review/publish actions.
- Add interaction-map tests to ensure all clickable dashboard and studio controls route to meaningful outcomes.

### P3 - Training and Impact Analytics
- Add competency history timeline per user (per SOP revision).
- Add role heatmap for overdue read-and-understand tasks.
- Add dependency graph visualization for SOP-to-SOP and SOP-to-block links.

## 3. Acceptance Direction
- Every improvement must preserve no-dependency runtime constraints.
- New features must include deterministic fallback behavior.
- All new write paths must be audit-recorded and covered by tests.

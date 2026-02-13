# DESIGN Specification DS001 - Product Design

## 1. Product Intent
SOP Manager is a governed authoring studio for creating, validating, reviewing, approving, publishing, and activating operational procedures.

The product must provide:
- End-to-end SOP lifecycle in a single web workspace.
- Human-readable workflow state and quality posture at all times.
- Strong traceability from content origin to approval and training activation.

## 2. Success Criteria
- Users can build complete SOPs from interview and process inputs with structured guidance.
- Validation identifies blocking issues before review submission.
- Reviewers and approvers collaborate on anchored comments and explicit resolutions.
- E-signature approval is bound to user identity, reason, and exact document version.
- Published SOPs immediately generate training tasks and competency signals.
- Audit chain integrity can be verified at any time.

## 3. User Roles
- `author`: create and edit SOPs, use interview/process tooling, submit changes.
- `reviewer`: add review comments, request changes, resolve findings.
- `approver`: perform final approval and publish.
- `admin`: user and policy governance, audit oversight.

Role governance:
- Primary access role controls API permissions.
- Essential operational roles can be assigned per user to control SOP targeting and training assignment coverage.

All write operations are authenticated, role-checked, and CSRF-protected.

Authentication policy:
- Passwordless login is supported for fast onboarding.
- Password protection can be enabled per account at any time from the UI.
- E-signature flows remain controlled through explicit reason + re-authentication against current account policy.

## 4. Core Functional Flows
- SOP creation with metadata and guided section structure.
- Interview capture and server-side LLM synthesis into structured SOP draft fields.
- Process extraction and editing into explicit step-level procedure data.
- Reusable block library with linked or detached instantiation.
- Continuous validation with actionable findings.
- Review comments anchored to SOP sections and resolution workflow.
- Status transitions: `Draft -> In Review -> Approved -> Effective -> Superseded`.
- Publishing with automated training task and quiz generation.
- Export to print-ready HTML with governance metadata.
- Conversational agent workflow that can execute lifecycle operations from natural-language commands.
- Comprehensive assurance scans configured by checklists and regulatory profiles, executed as long-running tasks.
- Structured draft generation from layered inputs: high-level specification, hard constraints, and general narrative.
- Dedicated user management workflow (create/edit users, assign essential roles, activate/deactivate accounts).
- Training compliance workflow with read acknowledgement, quiz evidence, trainer sign-off, overdue tracking, and completion metrics.
- Cron-like automation jobs for recurring assurance or generation runs, visible in task monitor.

## 5. Scope Boundaries
Included now:
- Local account management and secure credential handling.
- Structured SOP version history with immutable snapshots.
- Append-only hash-chained audit log and verification.
- API-first backend with an integrated browser studio.

Deferred:
- External LMS synchronization.
- Formal standards certification workflow packs.
- Advanced graphical process notation editing.
- Native PDF rendering pipeline.

## 6. Quality Principles
- Deterministic baseline behavior with explainable LLM-assisted enrichment.
- No hidden assumptions: unknown values stay explicit.
- Exact finding localization by section path.
- Reproducible state transitions and complete auditability.

# DESIGN Specification DS007 - User, Training, and Compliance Governance

## 1. Objective
Provide explicit governance features for identity, role assignment, and GxP-oriented training traceability.

## 2. User Governance
- Admin can manage accounts from dedicated `User Management` page.
- User profile includes:
  - username
  - display name
  - department
  - site
  - job title
  - primary access role (`admin|author|reviewer|approver`)
  - essential operational roles (`author|reviewer|approver|trainer`)
  - active/disabled state
  - password mode (passwordless or password-enabled)

User API:
- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`

## 3. Training Evidence Model
Training records must capture:
- assignment metadata (SOP/version/user)
- due date
- read acknowledgement (who/when)
- quiz score and pass threshold
- trainer sign-off evidence (who/when)
- computed compliance status (`assigned`, `in_progress`, `overdue`, `completed`)

Training API:
- `GET /api/training/tasks`
- `GET /api/training/overview`
- `POST /api/training/tasks/:id/read`
- `POST /api/training/tasks/:id/quiz`
- `POST /api/training/tasks/:id/signoff`

## 4. Regulatory Profile Ownership
Regulatory profile is configured in `Settings` and reused by scans/training policy:
- regulations
- national institutions
- internal policies
- assurance checks
- training policy:
  - due days
  - quiz pass score
  - trainer sign-off required
  - retraining on major revision

Settings API:
- `GET /api/settings`
- `POST /api/settings/regulatory-profile`

## 5. Automation and Operational Visibility
Long-running operations must be transparent:
- task monitor for active and historical server tasks
- cron-like automation jobs for recurring scans/generation
- manual run support for immediate checks

Automation API:
- `GET /api/automation/jobs`
- `POST /api/automation/jobs`
- `PATCH /api/automation/jobs/:id`
- `POST /api/automation/jobs/:id/run`

## 6. Audit Expectations
The following operations are audit-recorded:
- user create/update
- regulatory profile updates
- training read/quiz/sign-off events
- automation job create/update/run

This produces an inspectable trail for internal quality and compliance reviews.

# SOPMananger

SOP Manager Studio for SOP authoring, validation, workflow governance, and auditable publishing.

Includes:
- Guided SOP studio workflow
- Conversational agent actions (`/api/chat/message`)
- Configurable long-running assurance scans and draft generation tasks (`/api/tasks/*`)
- User management with role assignment (`/api/users`)
- Regulatory profile settings + automation jobs (`/api/settings`, `/api/automation/jobs`)
- GxP-style training tracking (`/api/training/*`)

## Run

```bash
npm run server
```

## Test

```bash
npm test
```

## Seed Realistic Workspace Data

```bash
npm run seed -- --reset
npm run verify
```

## Default Users
- `admin` / empty password
- `author` / empty password
- `reviewer` / empty password
- `approver` / empty password

You can enable or change passwords from the in-app `Settings` screen after login.

## Specs
- `docs/specs/DS001-product-design.md`
- `docs/specs/DS002-system-design.md`
- `docs/specs/DS003-implementation-plan.md`
- `docs/specs/DS004-spa-studio-interface.md`
- `docs/specs/DS005-product-hardening-roadmap.md`
- `docs/specs/DS006-agent-and-assurance-architecture.md`
- `docs/specs/DS007-user-training-governance.md`

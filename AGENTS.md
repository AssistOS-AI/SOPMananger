# SOP Manager Project Guide

## Mission
Build a local-first SOP Manager that can create, validate, review, approve, publish, and activate SOPs with a full audit trail.

## Language Policy
- Conversation with the user may be in Romanian.
- All generated project artifacts must be in English:
  - Documentation (`.md`, specs, notes)
  - Source code (`.mjs`, `.js`, `.css`, `.html`)
  - Test code and test descriptions
  - API messages, logs, and UI labels (unless explicitly requested otherwise)

## Technical Constraints
- Runtime: Node.js (ESM, async/await).
- No external runtime dependencies in this project.
- Use Node built-in modules only (for example: `http`, `fs`, `crypto`, `url`, `path`).
- Server source code lives in `src/`.
- Tests live in `tests/`.
- `npm run server` must start the HTTP server.

## Architecture Expectations
- Keep a monolith with clear modules:
  - `src/server.mjs` entrypoint
  - Domain services in `src/services/`
  - Storage and persistence in `src/storage/`
  - Shared helpers in `src/lib/`
- Keep storage local and deterministic.
- Maintain append-only audit logs with hash chaining.

## LLM Integration
- For LLM access, use `AchillesAgentLib` from the parent workspace (`/home/salboaie/work/AchillesAgentLib`).
- Keep an adapter layer in this project so business logic does not depend on provider internals.

## Delivery Order
1. Write and align design specs in `docs/specs/`.
2. Implement backend modules.
3. Add tests for high-risk modules (audit integrity, validation rules, auth/session).
4. Verify `npm run test` and `npm run server`.

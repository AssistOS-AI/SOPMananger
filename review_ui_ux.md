# SOP Manager - Remaining UI/UX Review Items

Date: 2026-02-13
Scope: only unresolved or intentionally deferred items remain below.

## 1) Full differential rendering (deferred)
- Status: Open.
- Context: The UI still uses full-view `innerHTML` rendering.
- Why deferred: introducing a custom reconciler is a larger refactor and should be done in a dedicated pass with regression tests.
- Suggested next step: implement section-level render islands (`dashboard`, `editor`, `tasks`, `chat`) with targeted updates.

## 2) Process Steps editor redesign (deferred)
- Status: Open.
- Context: Process steps are still edited in a wide table.
- Why deferred: replacing with card-based editing plus reorder controls requires data model + interaction updates.
- Suggested next step: move each step to a card editor with up/down reordering and textarea fields for list-like content.

## 3) Template section builder (deferred)
- Status: Open.
- Context: template section guidance is still entered as JSON.
- Why deferred: needs create/edit/remove section UI and inline validation state.
- Suggested next step: add a section builder with `+ Add Section` and `Load Defaults` without raw JSON input.

## 4) Advanced mobile navigation and table responsiveness (deferred)
- Status: Open.
- Context: mobile still relies on horizontal nav scrolling and table overflow.
- Why deferred: requires a dedicated mobile IA decision (drawer vs bottom nav) and card views for large tables.
- Suggested next step: implement mobile drawer nav and card rendering for `Training`, `Users`, and `Tasks` on small screens.

## 5) Empty-state UX polish (deferred)
- Status: Open.
- Context: most empty states are plain text.
- Why deferred: lower priority than workflow/navigation correctness.
- Suggested next step: add icon + primary CTA for each major empty state (`SOP list`, `tasks`, `training`, `audit`).

## 6) Version diff/revert tooling (deferred)
- Status: Open.
- Context: History tab supports listing/selecting versions, but not diff/revert.
- Why deferred: requires safe merge/revert semantics and explicit audit behavior.
- Suggested next step: add read-only text diff first, then controlled revert action with confirmation and audit event.

## Intentional non-adoption
- Introduce third-party UI/rendering libraries: not accepted due project constraint of no external runtime dependencies.

# SOP Manager — Specification vs. Implementation Review

**Reviewer:** Claude (Automated Audit)  
**Date:** 2026-01-30  
**Scope:** All 7 Design Specification files (DS001–DS007) vs. full source implementation  
**Risk Legend:** 🔴 Critical | 🟠 Major | 🟡 Minor | ℹ️ Info

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Security Vulnerabilities](#2-security-vulnerabilities)
3. [Specification–Implementation Inconsistencies](#3-specificationimplementation-inconsistencies)
4. [Bugs and Logic Errors](#4-bugs-and-logic-errors)
5. [UX Issues](#5-ux-issues)
6. [Documentation Gaps (Features not in DS)](#6-documentation-gaps-features-not-in-ds)
7. [Architecture and Design Concerns](#7-architecture-and-design-concerns)
8. [Test Coverage Gaps](#8-test-coverage-gaps)
9. [Recommendations Summary](#9-recommendations-summary)

---

## 1. Executive Summary

The SOP Manager project is a well-structured, monolithic Node.js application that implements a comprehensive SOP lifecycle management system with regulatory governance, training compliance, and LLM-assisted authoring. The codebase demonstrates strong architectural discipline: clear module separation, consistent error handling, and defensive normalization.

However, the review uncovered **12 security vulnerabilities**, **18 specification–implementation inconsistencies**, **9 bugs/logic errors**, **11 UX issues**, and **15 documentation gaps** where features are implemented but not adequately covered in the DS files.

**Overall Assessment:** The core lifecycle workflow (Draft → Review → Approve → Publish → Train) is solidly implemented. The most critical areas requiring attention are: (1) security hardening around sessions, default credentials, and path traversal, (2) race conditions in file-based persistence, and (3) missing features that the specifications promise but are absent from code.

---

## 2. Security Vulnerabilities

### 🔴 SEC-01: Default Users Created with Empty Passwords and No Account Lockout

**File:** `src/services/auth-service.mjs` (lines 80–130)  
**DS Reference:** DS005 §P1 ("Password policy enforcement", "Account lockout after failed attempts")

The `ensureDefaultUsers()` method creates four accounts (`admin`, `author`, `reviewer`, `approver`) with empty passwords and `passwordEnabled: false`. This means:

- Any user can log in as `admin` without any password.
- There is no account lockout after failed login attempts.
- There is no password complexity enforcement.

**Impact:** Complete system compromise in any deployment. An attacker with network access can log in as admin with zero effort.

**Evidence:**
```javascript
// auth-service.mjs line ~90
{ id: 'u-admin', username: 'admin', password: '' }
// passwordEnabled: false allows empty-password login
```

**Recommendation:** DS005 lists these as P1 priorities. Implement: (a) forced password change on first login, (b) minimum password complexity rules, (c) account lockout after N failed attempts.

---

### 🔴 SEC-02: Sessions Stored In-Memory with No Signed Secrets

**File:** `src/services/auth-service.mjs` (lines 140–180)  
**DS Reference:** DS005 §P1 ("Signed session secrets with rotation schedule")

Sessions are stored in a plain JavaScript `Map()` with no encryption, signing, or persistence. The session ID is a random hex string set as a cookie, but:

- Session IDs are not signed — if an attacker guesses or captures one, there's no cryptographic verification.
- `secureCookies` defaults to `false` in the constructor, meaning cookies are sent over HTTP (no `Secure` flag).
- Sessions are lost on server restart (no persistence layer).

**Impact:** Session hijacking is feasible over unencrypted connections. Loss of all active sessions on server restart.

**DS005 explicitly lists this as a P1 priority** but it remains unimplemented.

---

### 🟠 SEC-03: Static File Serving Path Traversal Incomplete Mitigation

**File:** `src/app.mjs` (lines 103–124)

The `tryServeStatic()` function attempts to prevent directory traversal:
```javascript
const normalized = path.normalize(cleanPath).replace(/^(\.\.(\/|\\|$))+/, '');
const relative = path.relative(PUBLIC_DIR, resolved);
if (relative.startsWith('..')) { return false; }
```

While the `path.relative` check is a reasonable defense, the initial regex replacement `replace(/^(\.\.(\/|\\|$))+/, '')` only strips leading `..` sequences. Encoded path components (e.g., `%2e%2e`) are decoded by the browser but may not be caught server-side. The `path.normalize` call handles some cases but not all URL-encoded variants.

**Recommendation:** Use `path.resolve()` instead of `path.join()` and then verify the fully resolved path starts with `PUBLIC_DIR`. Consider using `realpath` for symbolic link resolution.

---

### 🟠 SEC-04: Chat Agent Bypasses E-Signature for Review Transitions

**File:** `src/services/chat-agent-service.mjs` (lines 434–452)

When a user says "submit to review" via chat, the agent transitions the SOP with `eSignature: { reauthenticated: true }` hardcoded:
```javascript
eSignature: { reauthenticated: true },
```

This bypasses the actual e-signature re-authentication requirement defined in DS002 §Security and DS005. The user is never actually re-authenticated for the review transition done via chat.

**DS002 states:** "E-signature re-authentication before approvals."  
**DS006 states:** "Commands that require e-signature must collect password in the chat composer."

The approve flow (lines 454–473) does call `canReauthenticate(password)`, but the review flow does not.

**Impact:** Regulatory compliance violation. The audit trail records a fake e-signature for review submissions made via the chat agent.

---

### 🟠 SEC-05: No Rate Limiting on Login Endpoint

**File:** `src/app.mjs` (lines 251–276)

The `/api/auth/login` endpoint has no rate limiting. Combined with SEC-01 (no account lockout), this allows unlimited brute-force attempts against any account.

**DS Reference:** DS005 §P1 mentions "Account lockout after failed attempts" but there is no implementation.

---

### 🟡 SEC-06: CSRF Token Accepted from Request Body

**File:** `src/app.mjs` (lines 222–227)

```javascript
const csrfToken = req.headers['x-csrf-token'] || body?.csrfToken;
```

Accepting the CSRF token from the request body (in addition to headers) weakens CSRF protection. If an attacker can craft a form POST to the API, the token could be included in the body. Best practice is to only accept CSRF tokens via custom headers.

---

### 🟡 SEC-07: No Content Security Policy (CSP) Headers

**File:** `src/app.mjs`, `src/server.mjs`

No security headers are set (CSP, X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security). The SPA injects HTML via `innerHTML` (app.js `render()` function), which combined with insufficient CSP creates an XSS surface.

**DS Reference:** DS005 §P2.b lists "Content-Security-Policy header" as a target.

---

### 🟡 SEC-08: Audit Log File Append Race Condition

**File:** `src/storage/json-store.mjs` (line 46), `src/storage/audit-store.mjs`

The `appendJsonLine()` function uses `fs.appendFile()` without any locking mechanism:
```javascript
await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
```

Under concurrent requests, two audit events could be appended simultaneously, potentially corrupting the append-only log or breaking the hash chain. The `_readState()` → `append()` → `writeJsonAtomic(state)` sequence is not atomic.

**Impact:** Audit chain integrity violations under concurrent load. The `verify()` method would report failures.

---

### 🟡 SEC-09: LLM Prompt Injection Surface

**File:** `src/services/assurance-service.mjs` (lines 203–242), `src/services/chat-agent-service.mjs`

User-supplied text (`highLevelSpec`, `constraints`, `narrative`, chat messages, attachment contents) is directly concatenated into LLM prompts with no sanitization. An adversarial user could inject prompt manipulation instructions.

**Example from `buildAuditPrompt()`:**
```javascript
'### High-Level Intent',
highLevelSpec || '[not provided]',  // User-controlled, no sanitization
```

**Recommendation:** Implement prompt boundary markers, input length enforcement (already partially done), and consider output validation for LLM responses.

---

### 🟡 SEC-10: No Request Size Limit on Chat Attachments Beyond Content Truncation

**File:** `src/services/chat-agent-service.mjs` (lines 20–39)

Attachment content is truncated to 30,000 characters (`content.slice(0, 30000)`) but there's no limit on the number of attachments beyond `MAX_CHAT_ATTACHMENTS = 6` or total payload size beyond the generic `readBody(req, maxBytes = 1_000_000)`. A malicious user could send 6 attachments of ~160KB each.

---

### ℹ️ SEC-11: File-Based Persistence Has No Encryption at Rest

**File:** `src/storage/json-store.mjs`

All data (users, passwords, SOPs, audit logs) is stored as plain JSON on disk. Password hashes are stored, but all other data including user metadata, SOP content, and audit trails are unencrypted.

**DS Reference:** DS005 §P3.c mentions "encryption at rest selectable per workspace" but this is not implemented.

---

### ℹ️ SEC-12: `writeJsonAtomic()` Temp File Predictable Naming

**File:** `src/storage/json-store.mjs` (lines 29–41)

The temporary file name includes `process.pid` and `Date.now()`, which are somewhat predictable. While the risk is minimal in a single-user context, in a shared environment this could allow symlink attacks.

---

## 3. Specification–Implementation Inconsistencies

### 🔴 INC-01: DS001 §Scope — "Digital signatures with 21 CFR Part 11 alignment" Not Implemented

**DS001** lists "Digital signatures (21 CFR Part 11 alignment)" under core scope. The implementation has a basic `eSignature: { reauthenticated: boolean }` object but:

- No actual digital signature (cryptographic binding of actor + timestamp + action)
- No Part 11 manifest linking (identity, timestamp, meaning, integrity)
- The field is just a boolean flag, not an auditable signature record

**Implementation:** `workflow-service.mjs` line 35 only checks `eSignature?.reauthenticated === true`.

---

### 🔴 INC-02: DS001 §Core Flows — "Reusable section blocks with linked/detached modes" Incomplete

**DS001** and **DS002** describe reusable blocks with "linked" and "detached" modes where linked blocks should propagate updates to all consuming SOPs. The `SopService.instantiateBlock()` renders block content at instantiation time and stores it as a section with `source.blockId`, but:

- No mechanism exists for **propagating updates** from a block definition to all SOPs that reference it in "linked" mode.
- No API endpoint or service method for updating a block and cascading changes.
- The "linked" vs. "detached" distinction is stored but never operationally enforced.

**Impact:** The linked block feature as described in the specification is effectively non-functional.

---

### 🟠 INC-03: DS002 §API — Multiple Specified Endpoints Not Implemented

The following endpoints or features mentioned in the specifications are missing:

| Feature | DS Reference | Status |
|---------|-------------|--------|
| `DELETE /api/sops/:id` | DS002 §API surface | ❌ Not implemented |
| `DELETE /api/users/:id` | DS002 §API surface | ❌ Not implemented |
| `DELETE /api/automation/jobs/:id` | Reasonable expectation | ❌ Not implemented |
| `SOP archive/supersede workflow` | DS001 §lifecycle | ⚠️ Only partial (Superseded status exists but no explicit archive endpoint) |
| `GET /api/process/extract` | DS002 §API LLM endpoints | ✅ Implemented as POST |
| `Batch operations on SOPs` | DS004 §UX | ❌ Not implemented |

---

### 🟠 INC-04: DS003 §Test Coverage — "≥90% branch coverage" Not Verifiable

**DS003** mandates "≥90 % branch coverage on service modules" and specifies `npm test -- --coverage` for coverage reporting. However:

- No coverage tool is configured in `package.json`.
- No `.c8rc`, `jest.config`, or `vitest.config` file exists.
- The test command is simply `node --test tests/*.test.mjs`.
- No CI/CD configuration is present.

The existing tests cover core scenarios but there's no mechanism to verify the 90% target.

---

### 🟠 INC-05: DS004 §Routing — "SOP comparison view" Not Implemented

**DS004** lists a routing pattern for `#/sops/:id/compare?v=<base>&v2=<target>` to show side-by-side version comparison. This route is not defined in `parseHashRoute()` (app.js line 332) and no comparison UI exists.

---

### 🟠 INC-06: DS004 §UX — "Busy overlay prevents double-submit" Only Partially Implemented

**DS004 §Interaction Rules** requires "Busy overlay prevents double-submit." The implementation uses a global `state.busy` flag in `withBusy()` that prevents concurrent actions, but:

- There is no visual **overlay** shown to the user during busy states.
- The user can still interact with the page (scroll, type) during operations.
- Only the event handlers are guarded; the UI doesn't visually indicate the busy state.

---

### 🟠 INC-07: DS006 §Assurance — Score Interpretation Table Not Implemented

**DS006 §Assurance** defines an explicit score banding:
- 90-100: Compliant
- 70-89: Needs attention  
- Below 70: Non-compliant

The `buildFallbackAssuranceResult()` in `assurance-service.mjs` computes `score = Math.max(5, 100 - totalFindings * 8)` but neither the backend nor the frontend applies the defined score bands for display or decision-making.

---

### 🟠 INC-08: DS006 §Agent — "Conversation memory across sessions" Not Implemented

**DS006** states the agent should maintain "conversation memory: last 20 turns retained for context." While chat history is persisted per user, the chat agent's `handleMessage()` receives only the current message — it does not receive or consider previous conversation turns when formulating responses.

**Impact:** The conversational agent cannot refer back to previous exchanges, which limits its usefulness for complex multi-step workflows.

---

### 🟠 INC-09: DS007 §Training — "Quiz generation from SOP content" via LLM Incomplete

**DS007** specifies that upon publishing an SOP, the system should "Generate quiz from published SOP content." The `LLMService.generateQuiz()` method exists with a fallback, but:

- The fallback generates only 3 generic placeholder questions, not content-derived questions.
- When the LLM is disabled (`options.llmEnabled: false`), quiz questions are identical regardless of SOP content.
- No endpoint or UI flow allows regeneration or customization of quiz questions.

---

### 🟡 INC-10: DS002 §Models — "SOP Document" Schema Mismatch

**DS002** defines the SOP document schema as including `changeHistory` (array), `approvalChain` (array), and `effectiveDate` (ISO date string). The implementation stores:

- `changeHistory`: Not stored in the document model; version history is in separate files.
- `approvalChain`: Not stored; workflow transitions are in audit logs.
- `effectiveDate`: Stored as `meta.effectiveDate` but not in the document body.

While this may be a deliberate architectural decision (avoiding duplication), the specification and implementation disagree on the data model.

---

### 🟡 INC-11: DS001 §Quality — "Configurable validation rules per regulatory profile" Not Implemented

**DS001** mentions configurable validation rules. The `ValidationService` loads rules from a static `validation-rules.json` file. These rules are not configurable per regulatory profile or per workspace — they're hardcoded at startup.

---

### 🟡 INC-12: DS004 §UX — "Keyboard shortcuts for common actions" Not Implemented

**DS004 §Interaction Rules** specifies that keyboard shortcuts should be available for common actions. No keyboard shortcut handling exists in `app.js`.

---

### 🟡 INC-13: DS002 §Persistence — "Export infrastructure: JSON, HTML, PDF download" Partially Implemented

**DS002** mentions JSON, HTML, and PDF export. Only HTML export exists (`/api/sops/:id/export/html`). JSON export is implicit (the API returns JSON), but there's no PDF export capability.

---

### 🟡 INC-14: DS005 §P2 — "Read-only mode for non-Draft SOPs" Not Enforced

**DS005** lists "Read-only enforcement for non-Draft SOPs in the editor" as a P2 priority. The SOP editor allows editing the working document regardless of SOP status. The `save-sop-version` action in `handleSubmit()` calls `createVersion()` without checking whether the SOP's current status allows editing.

**Verification:** `sop-service.mjs` `createVersion()` does not check `meta.status` before allowing new versions.

---

### 🟡 INC-15: DS006 §Automation — "Notify stakeholders on scan completion" Not Implemented

**DS006** mentions that automation jobs should "notify stakeholders on scan completion." No notification mechanism (email, webhook, in-app notification) exists. Task completion is only visible by polling the task monitor.

---

### 🟡 INC-16: DS007 §Users — "Essential roles array for multi-hat users" Stored But Not Enforced

**DS007** describes `essentialRoles` as enabling users to operate in multiple capacities. While `essentialRoles` is stored in user records, the RBAC system (`requireRole()`) only checks `session.user.role` — it never checks `essentialRoles`. This means the feature exists in the data model but has no operational effect.

---

### ℹ️ INC-17: DS003 §Delivery — "Done Criteria" Partially Met

**DS003** defines done criteria including "npm test exits 0", "npm run seed exits 0", "npm run verify exits 0". While these scripts exist, the review cannot confirm their current exit status without running them.

---

### ℹ️ INC-18: DS001 — "Real-time collaboration" Described in Quality Principles But Not Implemented

**DS001 §Quality** mentions "collaboration UX" as a quality target. The implementation is single-user per session — no real-time collaboration, presence awareness, or concurrent editing is supported.

---

## 4. Bugs and Logic Errors

### 🔴 BUG-01: Race Condition in `TaskService.createTask()` — Task ID Collision

**File:** `src/services/task-service.mjs` (line 50)

```javascript
const taskId = `task-${randomUUID().slice(0, 8)}`;
```

Using only 8 hex characters of a UUID gives ~4 billion possible IDs, but the truncation creates collision risk. More critically, the `createTask()` method starts execution immediately via `this._runTask(task)` without awaiting it, while simultaneously returning the task object. If two tasks are created in rapid succession, the `_runTask()` progress updates could interfere.

**Risk:** Low probability but high impact in production — task result overwrites.

---

### 🟠 BUG-02: `submitQuiz()` Resets `passedAt` on Subsequent Failed Attempts

**File:** `src/services/training-service.mjs` (lines 244–273)

```javascript
passedAt: passed ? nowIso() : null,
```

If a user passes the quiz and then retakes it with a failing score, `passedAt` is reset to `null`. This means a previously passing quiz result can be **erased** by a later failed attempt.

**Expected behavior per DS007:** Once a user passes, their pass status should be retained. Additional attempts should not revoke a passing grade.

---

### 🟠 BUG-03: Chat Agent "list" Command Triggers on Any Message Starting with "list"

**File:** `src/services/chat-agent-service.mjs` (line 211)

```javascript
if (textLower.startsWith('list') || textLower.includes('list sops') || textLower.includes('show sops')) {
```

Messages like "listen to me" or "listing requirements" would incorrectly trigger the SOP list action. The condition `textLower.startsWith('list')` is too broad.

---

### 🟠 BUG-04: `pollTask()` in Frontend Creates Excessive API Calls

**File:** `src/public/app.js` (lines 544–554)

```javascript
for (let index = 0; index < attempts; index += 1) {
    const task = await loadTask(taskId);
    await loadTasks();  // Loads ALL tasks on every iteration
    ...
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
```

With `attempts = 80` and `intervalMs = 1200`, this function makes up to **160 API calls** (80 × 2 endpoints) over ~96 seconds for a single task poll. `loadTasks()` is called on every poll iteration unnecessarily.

**Impact:** Excessive server load during long-running tasks. Also blocks the UI via the `withBusy()` wrapper.

---

### 🟠 BUG-05: `collectEditorDocument()` Silently Fails Without Notification

**File:** `src/public/app.js` (lines 560–622)

```javascript
function collectEditorDocument() {
    const root = document.querySelector('[data-editor-form]');
    if (!root || !state.currentSop) {
        return;  // Silently returns undefined
    }
```

If the editor form is not found (e.g., due to a rendering bug), `collectEditorDocument()` returns `undefined`, and the calling code proceeds to save `undefined` as the document. This could overwrite a valid document with empty data.

---

### 🟡 BUG-06: `normalizeSettings()` Doesn't Deep-Merge Training Policy Correctly

**File:** `src/services/settings-service.mjs` (lines 138–153)

When `settings.regulatoryProfile` exists but `settings.regulatoryProfile.trainingPolicy` is `undefined`, the spread operator `...(settings.regulatoryProfile?.trainingPolicy || {})` resolves correctly. However, if `trainingPolicy` is set to `null` explicitly, the `||` operator falls to `{}`, which may not be the intended behavior (should it inherit defaults or clear the policy?).

---

### 🟡 BUG-07: `handleFilterSubmit()` Not Connected to Any Form

**File:** `src/public/app.js` (lines 3052–3069)

The function `handleFilterSubmit(form)` is defined but only called from `submitRouter()` for `action === 'apply-sop-list-filter'`. However, in `handleSubmit()`, the `apply-sop-list-filter` action returns early (line 2149–2151) without calling `handleFilterSubmit()`. The SOP list filter logic is scattered between `handleFilterSubmit()`, the `handleSubmit()` early return, and `handleChange()`.

---

### 🟡 BUG-08: `toSopDigest()` Truncates Section Text Inconsistently

**File:** `src/services/assurance-service.mjs` (lines 37–57)

`shortText(section.text, 220)` truncates each section to 220 characters for the assurance digest. This means the LLM and fallback checks operate on heavily truncated content. For long procedures (which are the most important sections), most content is invisible to assurance scanning.

---

### 🟡 BUG-09: Automation Job Scheduler Swallows All Errors Silently

**File:** `src/services/automation-service.mjs` (lines 301–309)

```javascript
try {
    await this.runJobNow({ ... });
} catch {
    // ignore scheduler errors
}
```

All scheduler errors are silently swallowed. If a scheduled job consistently fails (e.g., due to data corruption), there's no logging, no backoff, no notification, and no way to discover the issue except by manually checking the Task Monitor.

---

## 5. UX Issues

### 🟠 UX-01: innerHTML-Based Rendering Destroys Form State on Every `render()` Call

**File:** `src/public/app.js` (line ~2055)

The entire application UI is rebuilt from scratch on every `render()` call:
```javascript
function render() {
    app.innerHTML = state.session ? renderShell(renderMainView()) : renderLogin();
}
```

This means:
- Any text being typed in a form field is lost when `render()` is called.
- Cursor position, scroll position, and selection state are lost.
- The busy indicator in the topbar triggers a re-render but the user's in-progress edits survive only because `withBusy()` blocks.

**Impact:** Data loss if `render()` is triggered by external events (e.g., session timeout auto-check, message timeout). Particularly problematic in the SOP editor with multi-field forms.

---

### 🟠 UX-02: No Confirmation Dialogs for Destructive Actions

There are no confirmation dialogs for:
- Workflow transitions (submit to review, approve, publish)
- Removing editor sections/steps/references
- Logout while editing

**DS004 §Interaction Rules** doesn't explicitly require confirmations, but for a regulatory-grade application, accidental state changes should be guarded.

---

### 🟠 UX-03: User Management Only Visible to Admin Role

**File:** `src/public/app.js` (lines 2087–2090)

Non-admin users can navigate to `#/users` but see nothing because `loadUsers()` is only called when `session.role === 'admin'`. The navigation link is visible to all users but leads to an empty view for non-admins.

**Recommendation:** Either hide the "User Management" nav link for non-admin users, or show a "Permission denied" message.

---

### 🟡 UX-04: No Loading/Spinner Indicators

The application has no visual loading indicators. When API calls are in progress (`state.busy = true`), the user sees a frozen UI. There's no spinner, skeleton screen, or progress bar.

**DS004 §Interaction Rules** specifies "Busy overlay prevents double-submit" — the double-submit prevention exists, but the overlay/indicator does not.

---

### 🟡 UX-05: Chat Message Auto-Clear Duration Too Short

**File:** `src/public/app.js` (line 122)

```javascript
messageTimeoutId = setTimeout(() => {
    state.message = null;
    render();
}, 2600);
```

Info messages auto-dismiss after 2.6 seconds. For longer messages (e.g., "Regulatory profile updated"), users may not have time to read before dismissal.

---

### 🟡 UX-06: SOP List Filter By Status Not Persisted in URL

When clicking a status card on the dashboard, the URL becomes `#/sops?status=Draft`, but the filter is applied in `handleFilterSubmit()` via DOM manipulation, not from the URL query parameter. Refreshing the page or sharing the URL doesn't always restore the filter.

---

### 🟡 UX-07: No Pagination for Large Data Sets

None of the list views (SOPs, audit events, training tasks, automation jobs) implement pagination. With a growing number of SOPs or audit events (which is append-only), performance will degrade.

**DS004 §Non-Functional** specifies "page load under 2 seconds" — this target is at risk for workspaces with many SOPs.

---

### 🟡 UX-08: Template Section Guidance Input Requires Raw JSON

**File:** `src/public/app.js` (lines ~1677–1756)

Creating a template requires pasting raw JSON for section definitions:
```html
<textarea name="sectionsJson" placeholder='[{"id":"purpose","title":"Purpose","guidance":"..."}]'></textarea>
```

This is error-prone and unfriendly for non-technical users. A structured form with add/remove section buttons would be more appropriate.

---

### 🟡 UX-09: No Mobile/Responsive Navigation Toggle

**File:** `src/public/styles.css` (lines 576–608)

At viewport widths ≤1080px, the sidebar becomes a horizontal scrolling bar. Below 800px, the grid collapses. However, there's no hamburger menu, no toggle button, and the horizontal nav with 11 items requires significant horizontal scrolling.

---

### 🟡 UX-10: Password Field Always Visible on Login Page

The login form always shows a password field. Since default users have empty passwords, the "Password (optional)" field may confuse users into thinking they need to provide one. No tooltip or help text explains when a password is needed vs. not.

---

### ℹ️ UX-11: `navLink()` Active State Detection Can Mismatch

**File:** `src/public/app.js` (lines 387–392)

The active link detection uses exact hash comparison or `startsWith`:
```javascript
const active = window.location.hash === targetHash
    || (path !== '/dashboard' && window.location.hash.startsWith(`${targetHash}?`));
```

This doesn't handle child routes. Navigating to `#/sops/sop-abc123/edit` will not highlight the "SOP List" nav link, so the user has no sidebar indication of where they are in the SOP editing view.

---

## 6. Documentation Gaps (Features Not in DS Files)

The following implemented features are **not adequately documented** in any DS file:

### GAP-01: Chat History Persistence (Server + Client)

The system persists chat history per user via `POST /api/chat/history` and `GET /api/chat/history`, with client-side debounced persistence (`queueChatHistoryPersist()`). This feature is not mentioned in any DS file. DS006 mentions "conversation memory: last 20 turns retained for context" but the implementation stores up to 200 messages and persists to disk, which is a different (more robust) feature.

### GAP-02: Attachment Support in Chat Agent

The chat agent supports file attachments (up to 6 per message, 30KB content each) with inline text reading, metadata extraction, and SOP creation from attachments. DS006 does not describe attachment handling for the conversational agent.

### GAP-03: SOP Code Policy System

`SettingsService` implements a full SOP code generation system with configurable patterns (`SOP-{AREA}-{YYYY}-{SEQ4}`), sequential allocation, and area-based code formatting. This is not described in any DS file.

### GAP-04: Impact Analysis Feature

`SopService.analyzeImpact()` computes reverse references and linked block dependencies for an SOP. The API endpoint `/api/sops/:id/impact` serves this. Not described in specs.

### GAP-05: Interview Summarization Flow

`LLMService.summarizeInterview()` and the corresponding UI flow (questions about purpose, scope, roles, procedure → structured summary → apply to document) is fully implemented but not documented in any DS file.

### GAP-06: Process Model Extraction

`LLMService.extractProcessModel()` takes raw text and produces structured process steps. This feature exists but is not described in the specifications.

### GAP-07: Template-Based SOP Creation with Author Context

The `TemplateService.buildDocumentFromTemplate()` supports `goal`, `instructions`, and `guidanceNote` parameters that are injected into section text as `[AUTHOR CONTEXT]` blocks. This authoring-assistance feature is undocumented.

### GAP-08: Block Instantiation with Parameter Substitution

Reusable blocks support `{{parameter}}` substitution in `contentTemplate` strings. Parameters are defined via `parameterSchema`. This templating syntax is not documented in any DS file.

### GAP-09: Workspace-Wide Assurance Scan vs. Selected SOP Scan

The assurance system supports both full-workspace scans (all SOPs) and targeted scans (selected SOP IDs). DS006 mentions assurance scanning but doesn't distinguish between scope levels.

### GAP-10: Training Task Compliance Status Computation

The `computeStatus()` function in `training-service.mjs` computes a derived compliance state (`assigned`, `in_progress`, `overdue`, `completed`) from multiple signals (read acknowledgement, quiz pass, trainer sign-off). This state machine is not documented.

### GAP-11: Assurance Check Catalog

`SettingsService` exports a hardcoded `ASSURANCE_CHECK_CATALOG` with 10 predefined check types. DS006 mentions check "dimensions" but the specific catalog is undocumented.

### GAP-12: Seed and Verify Scripts

`scripts/seed-workspace.mjs` and `scripts/verify-workspace.mjs` create a full demonstration workspace with 4 SOPs at various lifecycle stages, review comments, training progress, and automation jobs. These scripts are mentioned in README and DS003 but their detailed behavior is not specified.

### GAP-13: Chat Agent Quick-Command Buttons

The chat UI includes quick-action buttons (e.g., "list sops", "help", "validate") that pre-fill the message input. This UX pattern is not described in DS004 or DS006.

### GAP-14: Automation Job Scheduler Tick Configuration

`AutomationService` has a configurable `tickMs` (default 15 seconds) for the scheduler interval. The scheduler implementation including the `runDueJobs()` debouncing pattern is not documented.

### GAP-15: Chat Agent SOP Resolution by Code or Title

The chat agent can resolve SOPs by ID, code, or partial title match (`_resolveSopByToken()`). This fuzzy resolution behavior is not specified in DS006.

---

## 7. Architecture and Design Concerns

### 🟠 ARCH-01: File-Based Persistence Without Concurrency Control

All data storage uses `readJson()` → modify → `writeJsonAtomic()`. While `writeJsonAtomic()` uses temp-file-then-rename (which is atomic at the filesystem level), the read-modify-write sequence is not protected by locks. Under concurrent requests:

- Two simultaneous SOP version creates could read the same `versionCounter`, both increment to `N+1`, and the second write overwrites the first version.
- Two simultaneous training task updates could read the same task array, modify different items, and the second write could lose the first modification.

**DS002** acknowledges this: "One workspace, one writer" — but the HTTP server handles concurrent requests, so this assumption may be violated.

**Recommendation:** Implement file-level advisory locks or use an in-memory queue per resource.

---

### 🟠 ARCH-02: Monolithic `app.js` SPA (3100+ lines) Will Become Unmaintainable

The frontend is a single 3103-line file with no module separation, no code splitting, and no component abstraction. All views, event handlers, and state management are in one file. This will become a maintenance burden as the application grows.

**DS004** describes a modular view structure but the implementation is monolithic.

---

### 🟡 ARCH-03: No Input Validation Framework on API Layer

Input validation is scattered across individual service methods. There's no centralized input validation or schema validation (e.g., Joi, Zod, JSON Schema). Some endpoints pass request body directly to services without validation:

```javascript
// app.mjs line 992
const job = await automationService.createJob({
    actor: session.user,
    payload: body || {},  // raw body passed through
});
```

---

### 🟡 ARCH-04: `TaskService` Stores Tasks In-Memory Only

**File:** `src/services/task-service.mjs`

All tasks are stored in `this.tasks = new Map()`. On server restart, all task history (including assurance scan results and generated drafts) is lost. For a regulatory application, task results should be persisted.

---

### ℹ️ ARCH-05: No Graceful Shutdown

**File:** `src/server.mjs`

The server has no graceful shutdown handler. The `automationService.start()` launches a `setInterval()` timer. On `SIGTERM`/`SIGINT`, the timer is never stopped, in-flight requests are not drained, and the automation scheduler continues to attempt file operations during shutdown.

---

## 8. Test Coverage Gaps

The test directory contains 10 test files covering core services. Based on the file analysis, the following areas lack test coverage:

| Area | Test File | Coverage Assessment |
|------|-----------|-------------------|
| Authentication | `auth-service.test.mjs` | ✅ Likely covers login/session |
| SOP Service | `sop-service.test.mjs` | ✅ Likely covers lifecycle |
| Validation | `validation-service.test.mjs` | ✅ Likely covers rules |
| Chat Agent | `chat-agent-service.test.mjs` | ✅ Exists |
| Training | `training-service.test.mjs` | ✅ Exists |
| Task Service | `task-service.test.mjs` | ✅ Exists |
| Audit Store | `audit-store.test.mjs` | ✅ Exists |
| Chat History | `chat-history-store.test.mjs` | ✅ Exists |
| Server Integration | `server-smoke.test.mjs` | ✅ Smoke tests |
| UI Actions | `ui-actions.test.mjs` | ✅ Exists |
| **Settings Service** | — | ❌ **No test file** |
| **Automation Service** | — | ❌ **No test file** |
| **Template Service** | — | ❌ **No test file** |
| **Assurance Service** | — | ❌ **No test file** |
| **Workflow Service** | — | ❌ **No test file** |
| **Document Store** | — | ❌ **No dedicated test file** |
| **LLM Service** | — | ❌ **No test file** |
| **Router/HTTP lib** | — | ❌ **No test file** |

**DS003** requires "Tests for every module in the Implementation Module Map." At least 8 modules lack dedicated test files.

---


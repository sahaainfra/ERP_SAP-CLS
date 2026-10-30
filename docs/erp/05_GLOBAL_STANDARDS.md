# 05 — Global Standards (applies to every development prompt)

Every development prompt in this pack says "follow `05_GLOBAL_STANDARDS.md`". Give this file to the AI coding model **together with** each prompt (or keep it in the repository at `docs/erp/05_GLOBAL_STANDARDS.md` and tell the model to read it). Where a prompt and this file disagree, the prompt's specific instruction wins for that part only; the golden rules in §2 always win.

---

## 1. Technology stack

1. **Keep the existing stack.** Part 00.01 records the stack actually in the repository. Do not introduce a second framework, ORM, state manager, UI library, real-time server or database.
2. **Reference stack** (used only where a layer does not exist yet):

| Layer | Reference choice |
|---|---|
| Web front end | React + TypeScript, Tailwind CSS with the ERP design tokens, React Router, TanStack Query for server state, React Hook Form + Zod for forms |
| Mobile / field | Installable PWA from the same React code base (offline engine 04.15); React Native only if it already exists |
| Back end | Node.js + TypeScript, Express (or the existing framework), layered as route → controller → service → repository |
| Database | PostgreSQL (one database, schema-per-module optional), read replica / analytics schema for BI |
| ORM / migrations | The existing ORM; otherwise Prisma or Knex migrations |
| Real time | Socket.IO (reuse the existing server) with Redis adapter for scaling |
| Jobs / queues | BullMQ on Redis (or the existing queue) |
| Files | S3-compatible object storage with signed URLs; local disk only in development |
| Search | PostgreSQL full-text search first; OpenSearch only if volumes require |
| Charts | Chart.js (or the existing chart library) wrapped in ERP chart components |
| PDF | Server-side HTML → PDF (Playwright/Chromium) from approved templates |
| Tests | Vitest/Jest (unit), Supertest (API), Playwright (end-to-end and visual), k6 (load) |

3. Any change to the stack needs a written justification in `docs/erp/DECISIONS.md`.

---

## 2. Golden rules (never broken)

1. **Inspect before you build.** Search the code and database for the feature first. Reuse what works, repair what is broken, complete what is partial, build new only when nothing exists. Record the decision in the part's discovery note.
2. **Working software only.** Every button, menu item, link, tab, filter, form, action, report, export and dashboard tile must work end to end against the real database. No dummy buttons, placeholder pages, "coming soon" labels, hard-coded business figures, mock APIs or fake charts in any production build. If something cannot be completed in the current part, hide it behind a feature flag and record it in the defect register — never ship it visible and broken.
3. **Never destroy data or break working behaviour.** No DROP, RENAME, TRUNCATE, column-type change or destructive edit of existing tables, columns, constraints, records, APIs or routes. Changes are additive and reversible (§4.6).
4. **One engine for each shared concern.** One permission engine (02.04), one workflow/approval engine (04.01–04.02), one audit trail (02.06), one notification engine (04.06), one document service (04.10), one numbering service (01.03), one calculation engine (01.06), one posting engine (23.02), one master-data service (M06), one design system (M03). Modules call these engines; they never build their own copy.
5. **Approvals only through the workflow engine.** No module may implement its own approval chain or let a transaction that needs approval skip it — through the UI, API, import, background job, offline sync or AI.
6. **Money reaches the ledger only through the posting engine.** Modules emit financial events; the posting engine creates journal entries.
7. **Enter once, reuse everywhere.** No screen asks the user to type data the ERP already has. Selections auto-fill from masters and source documents.
8. **Permissions are enforced on the server.** Hiding a button is a convenience, not security. Every API checks permission and data scope.
9. **Every change is traceable.** Who, what, when, old value, new value, reason — in the audit trail; every derived record links to its source record.
10. **Business screens never show development status.** Build progress, test results, audit notes and "preview" labels never appear in business navigation, dashboards or notifications.
11. **A part is complete only when its acceptance criteria are demonstrated** in a running build with real database data, its tests pass and the regression suite is green (§12).

---

## 3. Architecture and module boundaries

1. **Layers:** UI → API (route + controller) → service (business logic, validation, permission guard, workflow and protocol calls) → repository (database) → database. Business rules live only in services; controllers stay thin; UI never contains business rules that the server does not also enforce.
2. **Module ownership:** a module owns its tables. Other modules read through that module's service or published read views and react to its events. **Never write directly into another module's tables.**
3. **Repository layout (adapt to existing):**
   ```
   server/src/modules/<module_code>/{routes,controllers,services,repositories,validators,events,jobs,tests}
   server/src/platform/{auth,permissions,workflow,audit,notifications,documents,numbering,calc,events,files,config}
   web/src/modules/<module_code>/{pages,components,api,hooks,forms,tests}
   web/src/platform/{shell,design-system,widgets,search,i18n}
   docs/erp/{DECISIONS.md, DEFECTS.md, DISCOVERY/<part>.md, COMPLETION/<part>.md, PROGRESS.csv}
   ```
4. **Domain events:** every significant state change publishes an event through the transactional outbox (01.04), named `<module>.<entity>.<past_tense_verb>` (e.g. `proc.po.approved`, `inv.grn.posted`). Payload: `eventId, occurredAt, companyId, projectId, siteId, entity, entityId, version, actorId, data`. Consumers are idempotent (de-duplicate on `eventId`).
5. **Feature flags:** every new capability ships behind `ff.<module>.<feature>`, default OFF in production until acceptance passes. Flags are removed once the feature is stable for one release.
6. **Configuration over code:** thresholds, approval limits, tax rates, statutory rates, numbering formats, reason codes and alert rules are configuration records with effective dates — never constants in code.

---

## 4. Database standards

1. **Naming:** follow the existing convention. If none: `snake_case`, plural table names, module prefix (`proc_purchase_orders`, `inv_stock_ledger`), FK columns `<entity>_id`.
2. **Standard columns on every business table:** `id` (existing PK style — UUID or bigint), `company_id`, `project_id` (nullable where not project-scoped), `site_id` (nullable), `doc_no` (where numbered), `doc_date`, `status`, `workflow_instance_id` (nullable), `created_by`, `created_at`, `updated_by`, `updated_at`, `version` (optimistic lock), `is_active`, `deleted_at`, `deleted_by`, `source_type`, `source_id`, `remarks`.
3. **Data types:** money `NUMERIC(18,2)`; rates `NUMERIC(18,4)`; quantities `NUMERIC(18,3)`; percentages `NUMERIC(9,4)`; never floating point for business numbers. Timestamps stored in UTC (`timestamptz`), displayed in the user's time zone (default Asia/Kolkata). Business dates (bill date, DPR date) are `date`.
4. **Header–line pattern:** transactional documents use a header table and a lines table (`proc_purchase_orders` + `proc_po_lines`), lines carrying `line_no`, item, quantity, UOM, rate, amount and cost allocation (`wbs_id`, `cost_code_id`, `activity_id`).
5. **Integrity:** foreign keys to central masters; unique constraints on business keys (`company_id, doc_no`); check constraints for non-negative quantities; database transactions around every multi-table write; no orphan records.
6. **Migrations:** additive, idempotent, reversible (down-migration removes only what it added), timestamp-named, reviewed, registered in `docs/erp/DB_CHANGES.md`. Allowed: new tables, new nullable columns (or NOT NULL with default), 1:1 extension tables `<table>_ext`, new indexes (created concurrently), new views. Forbidden: drop/rename/retype existing objects, destructive data updates.
7. **Soft delete only** for business records, and only while in DRAFT. Approved records are changed by amendment or reversal, never edited in place.
8. **Indexes:** on every FK, every `(company_id, status)`, `(project_id, doc_date)`, and every column used in list filters; verify with `EXPLAIN` for lists over 10,000 rows.
9. **Seed data:** reference/configuration seeds (UOM, roles, document types) are versioned migrations; demo data lives only in the sandbox seed (30.04) and is never loaded into production.

---

## 5. API standards

1. **Paths:** `/api/v1/<module>/<resource>` (plural nouns), e.g. `/api/v1/proc/purchase-orders/:id`. Actions as sub-resources: `POST /api/v1/proc/purchase-orders/:id/submit`.
2. **Standard endpoints per document type:**
   `GET` list (paginated) · `GET /:id` · `POST` create (DRAFT) · `PATCH /:id` update (DRAFT/RETURNED only, requires `version`) · `DELETE /:id` soft delete (DRAFT only) · `POST /:id/submit` · `POST /:id/withdraw` · `POST /:id/cancel` (reason) · `POST /:id/amend` (creates new version) · `GET /:id/history` · `GET /:id/print` (PDF) · `GET /export` (XLSX/CSV/PDF honouring filters) · `POST /import` (via Excel engine) · `GET /lookups/...` for dropdowns.
   Approve/reject/return are **workflow task actions** (`POST /api/v1/workflow/tasks/:taskId/act`), not module endpoints.
3. **Lists:** `?page=1&pageSize=25` (max 200), `?sort=-doc_date,doc_no`, `?q=` free text, `?filter[status]=APPROVED&filter[project_id]=…`, `?from=&to=`. Response: `{ data: [...], meta: { page, pageSize, total, totalPages } }`.
4. **Errors:** `{ error: { code, message, details: [{ field, message }], correlationId } }` with correct HTTP status (400 validation, 401, 403 permission, 404, 409 version/state conflict, 422 business rule, 429, 500). Messages tell the user **what happened, why, and what to do**. No stack traces or SQL in responses.
5. **Concurrency and safety:** optimistic locking with `version`; `Idempotency-Key` header required on submit, post, payment, stock and approval actions; server recomputes every total — never trust client totals.
6. **Validation:** server-side schema validation (Zod/Joi or existing) on every input; the client mirrors it for usability.
7. **Documentation:** OpenAPI 3 for every endpoint, generated or maintained alongside code; contract tests in CI.

---

## 6. Users, roles and permissions

1. **Permission key:** `<module>.<entity>.<action>` — e.g. `proc.po.create`, `fin.payment.release`, `hr.employee.salary.view`.
2. **Standard actions:** `view, create, edit, delete, submit, approve, reject, return, cancel, amend, print, export, import, assign, close, reopen, post, reverse, configure`.
3. **Data scope:** every grant carries a scope — `company`, `branch`, `department`, `project`, `site`, `own`. A user may hold different roles on different projects. Every list and record query applies the user's scope on the server.
4. **Deny by default; explicit deny wins.** Super Admin actions are also permission-checked and audited.
5. **Four-layer enforcement:** UI (hide or disable with a reason tooltip), API middleware (403), service guard (protects jobs, imports, sockets, AI tools), data access (scope filter + field masking in the serializer).
6. **Sensitive fields** (salary, bank account, PAN, Aadhaar reference, comparative-statement rates, margin, cost price) are declared with mask rules and are never sent to unauthorised users — including in exports, search results, notifications, chat previews and AI context.
7. **Segregation of duties:** the same user cannot create and approve the same document; cannot create a vendor and release payment to it; cannot post and reverse the same journal. Rules configurable in 02.05.
8. **Role catalogue:** see `06_ROLE_CATALOGUE.md` (23 owner-defined Head-Office and Site-Office roles plus supporting roles).

---

## 7. Workflow and approval standard

1. **Standard states:** `DRAFT → SUBMITTED → IN_REVIEW → APPROVED | REJECTED`, with `RETURNED` (back to originator or a chosen earlier step), `CANCELLED`, `CLOSED`, `REVERSED`, `SUPERSEDED` where applicable. Module sub-states map to these for reporting.
2. **Engine calls:** `workflow.submit(docType, docId, context)` where context carries amount, project, site, department, category, risk flags; `workflow.act(taskId, action, comment, attachments)`; subscribe to `workflow.instance.completed` / `workflow.instance.returned`.
3. **Routing is configuration** (approval matrix in 04.02): by document type, company, project, department, amount band, category, vendor type, variance %, risk. Sequential and parallel steps; "any one of" and "all of" groups; conditional steps; maker-checker.
4. **Every approval step supports:** approve, reject (reason mandatory), return for correction (to originator or chosen step, reason mandatory), request clarification (keeps the task open), delegate (time-boxed), add comment, add attachment, view decision evidence panel (04.03). Mandatory attachments or checklists can be required per step.
5. **SLA and escalation:** each step has an SLA in working hours; reminders at 50 % and 100 %; escalation to the next level at breach; auto-escalation chain configurable.
6. **Locking:** once APPROVED, business fields are locked. Changes require an **amendment** (new version, own approval, full comparison view) or a documented reversal.
7. **Notifications:** submitter, current approvers and watchers are notified at every transition (in-app, plus email/WhatsApp/push per user preference).
8. **History:** every action is stored with user, role, timestamp, comment, attachments, IP/device and digital signature where configured; visible in the record's Approvals tab and exportable.
9. **No bypass:** imports, APIs, jobs, offline sync and AI drafts create records in DRAFT and go through the same workflow. Emergency paths (e.g. emergency purchase) are explicit workflow variants with mandatory regularisation.
10. Default authority limits are in `07_APPROVAL_WORKFLOW_REFERENCE.md`; all values are configurable.

---

## 8. Notifications, documents, numbering, printing

1. **Notifications** only through 04.06 / 04.07 using templates; respect user preferences, quiet hours and digest settings; every notification deep-links to the record.
2. **Attachments** only through the document service (04.10): virus-scanned, type/size checked, stored with metadata, served via signed URLs, permission-checked.
3. **Document numbers** only from the numbering service (01.03): series per company / project / document type / financial year, e.g. `PO/MUM-METRO/2026-27/000123`; gap-free where legally required (tax invoices); assigned at submit or approval as configured.
4. **Printing** only from approved templates (04.11): company letterhead, document number, QR verification code, approval block with names/dates, page x of y, generated-on stamp.

---

## 9. UI/UX standard and Page Completion Checklist

### 9.1 Design language
Original enterprise design inspired by SAP S/4HANA Fiori principles (role-based, coherent, simple, adaptive) — not a copy of SAP visuals, logos or fonts. Design tokens from `reference/design/design-tokens.css`: IBM Plex Sans (Devanagari for Hindi), brand primary `#1D4F91`, accent `#F2A900`, neutral page `#F3F5F7`, dark shell `#1C2530`, semantic status colours, light / dark / high-contrast themes, comfortable and compact density.

### 9.2 Standard page types (use these, do not invent new layouts)
| Page type | Use for | Must contain |
|---|---|---|
| **Dashboard / Overview** | Module and role dashboards | KPI tiles (value, trend, target, status colour), charts, alerts/exceptions list, "My pending actions", filters (company/project/site/period), every tile and chart drills down to the filtered list |
| **List Report** | Registers of records | Filter bar with saved variants, search, sortable columns, column chooser, pagination, row selection with bulk actions, status chips, export (XLSX/CSV/PDF), import where relevant, "New" action, empty state with call to action |
| **Object Page** | One record | Header (number, status chip, key figures, primary actions), tabs: **Details · Lines · Attachments · Approvals · Activity/Timeline · Discussion · Related records**, context actions allowed by status and permission |
| **Form / Wizard** | Create / edit | Sections with clear labels, required markers, inline validation, auto-fill from context and masters, dependent dropdowns, conditional fields, autosave draft, line-item grid with keyboard entry, totals recomputed live, Save Draft / Submit / Cancel |
| **Worklist** | Queues (approvals, tasks, inspections due) | Priority, age/SLA indicator, quick actions, bulk approve where policy allows |
| **Analytical page** | Reports | Parameter panel, table + chart, totals, drill-down, export, schedule |
| **Mobile field screen** | Site users | Large touch targets, camera/GPS/QR, offline indicator, minimal typing, step-by-step |

### 9.3 Page Completion Checklist — a page is complete only when ALL are true
1. Reachable from the navigation registry and/or a link; breadcrumbs correct; page title and browser title set.
2. Every button, link, tab, menu, filter, sort, pagination control and action works and is permission-aware.
3. All data comes from the real API and database — no hard-coded or sample values.
4. Create, edit, view, delete/cancel (where applicable) persist correctly and survive a page refresh.
5. Validation messages appear inline and match server rules; server errors show a clear message with correlation ID.
6. Loading (skeleton), empty (helpful message + action), error and no-permission states are implemented.
7. Lists support search, filter, sort, pagination and export; exports honour the filters and the user's field masks.
8. Approval-controlled records show the approval panel, status, history and only the actions allowed for the user and status.
9. Responsive at 360 px (phone), 768 px (tablet), 1280 px and 1920 px (desktop) with no horizontal page scroll; tables adapt (card view or horizontal scroll inside the table only).
10. Keyboard accessible, visible focus, labels on all inputs, colour contrast WCAG 2.1 AA, works in dark and high-contrast themes.
11. Uses only design-system components and tokens; consistent spacing, typography and iconography.
12. Numbers formatted for India (₹, lakh/crore grouping option, dates DD-MMM-YYYY), units shown.
13. Covered by at least one end-to-end test exercising its main action.

---

## 10. Security standard (summary of OWASP ASVS Level 2 expectations)

1. Every request passes **Authenticate → Authorise → Validate → Execute → Audit** (02.07).
2. Passwords hashed with Argon2id/bcrypt; MFA for privileged roles; session timeout and device management; account lockout and rate limiting.
3. Parameterised queries only; output encoding; CSRF protection for cookie sessions; strict CORS; security headers (CSP, HSTS, X-Content-Type-Options, frame-ancestors).
4. File uploads: type allow-list, size limit, virus scan, stored outside web root, served via signed URLs.
5. Secrets in a vault or environment, never in code or logs; PII and secrets redacted in logs.
6. Excel/CSV exports neutralise formula injection (`= + - @` prefixes).
7. Sensitive data encrypted at rest where supported; TLS everywhere.
8. Dependency and secret scanning in CI; no Critical/High vulnerabilities at release.
9. Audit trail is append-only and tamper-evident.
10. Personal data handled under the Digital Personal Data Protection Act, 2023 (India): purpose limitation, consent notices where required, retention limits, access on a need-to-know basis.

---

## 11. Performance standard

| Measure | Target (p95, at declared load) |
|---|---|
| List API (25 rows, filtered, 100k-row table) | ≤ 500 ms |
| Record read API | ≤ 300 ms |
| Save / submit API | ≤ 800 ms |
| Dashboard first meaningful paint | ≤ 2.5 s on 4G; ≤ 1.5 s on office broadband |
| Report up to 50k rows | ≤ 10 s, larger reports run as background jobs with notification |
| Real-time event to screen | ≤ 2 s |
| Morning attendance burst | 2,000 punches/minute without error |

Techniques: pagination everywhere, indexed filters, no N+1 queries, caching of masters and permission sets with event-driven invalidation, background jobs for heavy work, virtualised long tables, lazy-loaded routes.

---

## 12. Testing, Definition of Done and completion report

### 12.1 Required tests for every part
1. **Unit tests** for every calculation and business rule (including boundary values and rounding).
2. **API tests** for every endpoint: success, validation failure, permission denied (403), wrong scope (no cross-project leakage), state conflict (409), idempotent replay.
3. **Workflow tests:** submit → approve (all levels) → locked; reject; return → resubmit; delegation; escalation on SLA breach; self-approval blocked.
4. **Integration tests** for every event the part publishes or consumes.
5. **End-to-end tests (Playwright)** for each main user journey of the part, on desktop and mobile viewport.
6. **Data integrity checks:** totals recomputed from lines; ledgers balance; no orphans.
7. **Regression:** the full existing suite stays green; golden outputs of existing calculations and reports unchanged.

### 12.2 Definition of Done
- [ ] Discovery note written (what existed, reused, repaired, added).
- [ ] All functional requirements of the prompt implemented end to end (UI + API + DB).
- [ ] Every page passes the Page Completion Checklist (§9.3).
- [ ] Approval workflows configured and tested; no bypass path.
- [ ] Permissions registered, enforced on the server, tested per role.
- [ ] Events published/consumed and tested; related modules updated without re-keying.
- [ ] Tests in §12.1 written and passing; regression suite green.
- [ ] No placeholder, dummy data, console errors or unhandled promise rejections.
- [ ] Migrations additive and reversible; schema-diff on existing tables empty.
- [ ] OpenAPI updated; user-facing help text added; `PROGRESS.csv` updated.
- [ ] Completion report written (§12.3).

### 12.3 Completion report template (`docs/erp/COMPLETION/<part>.md`)
```
Part: <id> <title>            Date:            Build/commit:
1. Discovery summary — existing items found, decision (reuse / repair / extend / new) for each
2. What was built — pages, APIs, tables, events, jobs, permissions, workflows
3. Acceptance criteria — each criterion: PASS/FAIL + evidence (test name, screenshot, query)
4. Tests — counts and results (unit / API / workflow / integration / E2E), regression result
5. Data changes — migrations (up/down), back-fills, schema-diff result
6. Known limitations / deferred items — with defect IDs and target part
7. How to verify manually — numbered click-path for a reviewer
```

---

## 13. India localisation defaults (all configurable, effective-dated)

- Currency INR (₹) with lakh/crore grouping option; multi-currency fields available for imports and foreign vendors.
- Financial year 1 April – 31 March; time zone Asia/Kolkata; date format DD-MMM-YYYY.
- GST: GSTIN validation, place of supply, CGST/SGST/IGST/cess, HSN/SAC, reverse charge, e-invoice (IRN) and e-way bill through authorised providers (GSP/ASP).
- Income-tax TDS/TCS sections and rates; PAN validation; lower-deduction certificates.
- Labour and payroll: PF, ESI, Professional Tax (state-wise), Labour Welfare Fund, BOCW cess, CLRA registers, minimum wages by state/zone/skill — all as configuration with effective dates and source references, never hard-coded.
- Languages: English (default) and Hindi for field screens and notifications; further Indian languages through the same i18n files.
- Identity numbers (Aadhaar, PAN, bank account) masked by default; Aadhaar stored only as a reference/last four digits unless a legal basis exists.

---

## 14. Glossary (selected)

BOQ — Bill of Quantities · WBS — Work Breakdown Structure · DPR — Daily Progress Report · MB — Measurement Book · RA Bill — Running Account Bill · CS — Comparative Statement · GRN — Goods Receipt Note · MRN — Material Receipt Note · WA — Work Authorisation · ITP — Inspection & Test Plan · IR — Inspection Request · NCR — Non-Conformance Report · CAPA — Corrective and Preventive Action · PTW — Permit to Work · HIRA — Hazard Identification & Risk Assessment · JSA — Job Safety Analysis · EOT — Extension of Time · LD — Liquidated Damages · PVC — Price Variation Clause · CVR — Cost-Value Reconciliation · EAC — Estimate at Completion · ETC — Estimate to Complete · EVM — Earned Value Management · DLP — Defect Liability Period · BG — Bank Guarantee · SD — Security Deposit · TDS — Tax Deducted at Source · ITC — Input Tax Credit · IRN — Invoice Reference Number · BBS — Bar Bending Schedule · MTO — Material Take-Off · SoD — Segregation of Duties · RACI — Responsible, Accountable, Consulted, Informed.

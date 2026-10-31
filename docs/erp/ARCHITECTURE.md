# Architecture and API conventions

This guide is the single reference for how the ERP is built. It is rendered in the application under Administration > Architecture (Technical Console) and is checked by tests against the real folder structure, so it cannot drift. Decisions and their reasons are in `docs/erp/DECISIONS.md`.

## 1. Layers

A request passes through five layers. Each layer has one job.

| Layer | File | Does | Never does |
|---|---|---|---|
| Route | `routes.js` | maps a URL and method to a controller; adds the permission check (`requirePermission`) | business logic |
| Controller | `controller.js` | parses the request with the validators, calls one service method, formats the response | SQL, business rules, permission logic beyond reading `req.actor` |
| Service | `service.js` | all business rules, the permission and data-scope guard (`assertPermission`), transactions, audit entries and events | HTTP objects (`req`, `res`) |
| Repository | `repository.js` | reads and writes the module's own tables with parameterised SQL | decisions; it only does what the service asks |
| Database | `migrations/` | schema, constraints, indexes | |

Business rules live only in services (BR-01). Because the guard is in the service, a background job, an import or another module that calls the service is protected exactly like an HTTP request. Tests enforce that controllers, routes and validators contain no SQL.

## 2. Folder structure

```
src/server/
  index.js                    start-up: config, database, migrations, listen
  app.js                      composition root: pipeline, health, /api/v1 router, modules, error handler
  platform/                   shared libraries every module uses
    config/                   environment validation, fail fast
    db/                       connection, transactions, migrations; repository.js = base helpers
    http/                     errors.js (envelope, error codes), logger.js, pipeline.js
    auth/                     identity, permissions, guards (development adapter until IAM, defect D-001)
    validation/               Zod helper that returns field-level details
    pagination/               the list query and the { data, meta } response
    money/                    exact decimals, money, INR formatting, dates (code lives in src/shared)
    health/                   database, queue and storage checks
    audit/                    audit-trail writer
    events/                   transactional outbox writer
    integrity/                data-integrity checks and the registry modules declare their tables in
    (db/ also holds)          schema.js, scope.js (company scope), backfill.js (resumable back-fills)
    (http/ also holds)        idempotency.js (replay protection for actions)
  modules/
    registry.js               list of modules and how they mount
    core/                     reference implementation of the layers
      index.js                module descriptor and mount()
      feature-flags/          routes, controller, service, repository, validators
      about/                  routes, controller, service
      architecture/           routes, service
      session/                routes
src/shared/                   decimal.js, money.js, dates.js: used by server and browser alike
src/client/
  platform/                   api client, query client, shell and route registry, formatting, markdown
  modules/core/               pages, components, api hooks (same shape as the server module)
docs/erp/                     DECISIONS, DEFECTS, DISCOVERY/<part>, COMPLETION/<part>, PROGRESS.csv
```

The platform libraries by their paths: `platform/config`, `platform/db`, `platform/http`, `platform/auth`, `platform/validation`, `platform/pagination`, `platform/money`, `platform/health`, `platform/audit`, `platform/events`, `platform/integrity`, `platform/parameters`, `platform/approvals`, `platform/jobs`, `platform/runtime`, `platform/files`, `platform/calc`, `platform/observability`, `platform/integrations`, `platform/identity`. The modules are `modules/core` and `modules/iam`. The first module so far is `modules/core`.

A module owns its tables. Other modules read through its service or react to its events; they never write into its tables.

## 3. Module map

Built so far: `prog` (programme tooling, no runtime module) and `core`. The rest are assigned a code when their part is built. Part numbers refer to the prompt pack.

| Module | Name |
|---|---|
| M00 | Programme Discovery and Engineering Baseline (`prog`) |
| M01 | Core Architecture and Platform Services (`core`) |
| M02 | Identity, Organisation, Security and Access Control |
| M03 | Design System, Application Shell and UX Framework |
| M04 | Shared Business Engines |
| M05 | Collaboration and Messaging |
| M06 | Master Data |
| M07 | HR and Workforce Management |
| M08 | CRM, Business Development and Tendering |
| M09 | Estimation and Quantity Take-off |
| M10 | Project Setup, WBS and BOQ |
| M11 | Engineering, Drawings and Technical Documents |
| M12 | Budgeting and Cost Control |
| M13 | Planning and Scheduling |
| M14 | Site Execution and Progress Control |
| M15 | Procurement |
| M16 | Stores, Inventory and Site Logistics |
| M17 | Plant, Machinery and Equipment |
| M18 | Quality Management |
| M19 | HSE and Site Security |
| M20 | Batching Plant and RMC |
| M21 | Contracts, Subcontracts and Commercial |
| M22 | Measurement and Billing |
| M23 | Finance and Accounting |
| M24 | Payroll and Statutory Compliance |
| M25 | External Portals |
| M26 | Commissioning, Handover and Closeout |
| M27 | Reporting, BI and Control Towers |
| M28 | AI and Intelligent Automation |
| M29 | Administration, Integration and Data Operations |
| M30 | System Integration, Quality Assurance and Go-Live |

## 4. Request pipeline

Every request, in order:

1. **Correlation ID**: `X-Correlation-Id` is accepted if it is 8 to 64 letters, digits, `-` or `_`; otherwise a new one is generated. It is returned on every response and appears in every log line and error.
2. **Security headers**: `nosniff`, `frame deny`, `no-referrer`; `X-Powered-By` removed.
3. **Request log**: one JSON line when the response finishes: correlation ID, method, path (no query string), status, duration, user. Bodies and query strings are never logged.
4. **Body parsing**: JSON only, limit 50 KB. Bad JSON is a 400 `BAD_JSON`, an oversized body a 413 `PAYLOAD_TOO_LARGE`.
5. **Authenticate** (`/api/v1` only), then the route's **permission check**.
6. **Validate** in the controller (Zod; failures become field-level details), **execute** in the service, **audit** in the same transaction.
7. **Error handler**: anything thrown becomes the standard envelope. Unexpected errors are 500 `INTERNAL_ERROR` with a generic message; the stack goes to the log under the correlation ID and never to the client.

## 5. API conventions

- Paths: `/api/v1/<module>/<resource>` with plural nouns; actions as sub-resources (`POST .../:id/submit`).
- Legacy paths and response shapes never change (BR-03). A changed shape gets a new version path. `tests/contract.test.js` replays a recorded snapshot of every pre-existing route.
- Errors always use `{ error: { code, message, details: [{ field, message }], correlationId } }`. The codes are listed on the guide page; they come from one registry (`platform/http/errors.js`).
- Writes use optimistic locking: the client sends the `version` it read; a stale version is a 409 `VERSION_CONFLICT` and nothing is overwritten.
- Every state change writes an audit row and queues a domain event `<module>.<entity>.<past_tense_verb>` in the same transaction.

## 6. Lists: pagination, sorting, filtering

`GET` list endpoints take `page`, `pageSize` (default 25, **maximum 200**), `sort` (comma list, `-` prefix for descending), `q`, `filter[column]`, `from`, `to`, and return `{ data: [...], meta: { page, pageSize, total, totalPages } }`.

`sort` and `filter[...]` accept only columns the endpoint lists as allowed; anything else is a 400, so a caller cannot probe columns. `ORDER BY` is built from a column map, never from request text. No list can be unbounded (BR-02).

## 7. Money, quantities, dates

No floating point for business numbers. `src/shared/decimal.js` is an exact decimal on BigInt; `money.js` fixes the scales (money 2, rate 4, quantity 3, percent 4, rounding half-up) and formats rupees with lakh and crore grouping (`₹12,34,567.50`); `dates.js` shows dates as DD-MMM-YYYY in Asia/Kolkata and knows the 1 April financial year. The server (PDFs, services) and the browser use the same files. Rounding happens once, at the end of a calculation.

## 8. Health

- `GET /health/live`: public; the process is up.
- `GET /health/ready`: for ITADM and SYSADM, or a monitoring token in `X-Health-Token`. Checks the database (query and migration ledger), the queue (outbox readable; a large or old unpublished backlog is `degraded`) and storage (a file can be written). Any `fail` returns 503 and names the dependency.
- `GET /api/health`: the original liveness path, kept unchanged.

## 9. Frontend conventions

- One API client (`src/client/platform/api`): sends the auth headers and a correlation ID, turns every failure into an `ApiError` with the server's code, message, field errors and correlation ID, and retries idempotent GETs (network errors, 502, 503, 504) twice with back-off. Writes are never retried.
- Server state uses TanStack Query. Query keys come from one factory (`queryKeys`), so invalidation after a change is one call. A mutation that changes data invalidates the keys it affects.
- A module registers its pages once (`registerModule`): path, label, permission and page component. The shell builds navigation from the registry and hides entries the user has no permission for; the page still shows a no-permission state if reached by URL.

## 10. Database foundation

The rules every table and migration follows. The detail and the commands are in `docs/erp/MIGRATIONS.md`; the schema itself is in `docs/erp/DB_BASELINE.md`.

- **Money and numbers are whole integers** (ADR-14): money in paise, rates x10000, quantities x1000, percentages x10000, stored as `INTEGER`. SQL can then add, compare and index them exactly, and "header total equals the sum of its lines" is an exact test. Convert with `toUnits` and `fromUnits` (`src/shared/money.js`); never use REAL or TEXT for a business number. The schema lint rejects it.
- **Standard columns** on every business table: `id`, `company_id`, `created_by`, `created_at`, `updated_by`, `updated_at`, `version`, `is_active`, `deleted_at`, `deleted_by`, `source_type`, `source_id`, `remarks` (plus `project_id`, `site_id`, `status`, `doc_no`, `doc_date` where they apply). An index on every foreign key; a unique index on `(company_id, doc_no)` for numbered documents; non-negative `CHECK` on amounts and quantities. `npm run migration:new -- <name> --table <module_table>` writes all of it.
- **Migrations** are timestamped pairs of `.up.sql` and `.down.sql`, additive and idempotent. CI applies each one, reverses it and re-applies it on a copy, and fails if the schema or the data changed. Back-fills run in batches through `runBackfill`: each batch and its ledger row commit together, so a crash resumes from the saved cursor.
- **Company scope**: business queries use `companyScope`, `findScoped` and `listScoped` (`platform/db/scope.js`). An actor with no company gets nothing, never everything; a row of another company is "not found".
- **Idempotency**: every submit, post, payment, stock and approval endpoint uses `idempotency(db, { required: true })`. The client sends an `Idempotency-Key`; a retry with the same key and body returns the stored response (`Idempotency-Replayed: true`) and does not run again; the same key with a different body is 422. Only successful responses are stored, for 24 hours.
- **Integrity checks** (`npm run erp:db-check`, the Data Health page): orphan foreign keys, duplicate business keys, header totals against lines, unbalanced journals, negative quantities, rows without a company, invalid statuses. A module registers what the schema cannot say (`integrityRegistry.register`): technical tables, company-optional tables, its status words, header and line pairs, journals. A Critical failure blocks CI. A check with nothing to look at reports "nothing to check yet", never a pass. Samples are identifiers only, never amounts.
- **Backup and restore**: `npm run db:backup` writes a copy plus a manifest of per-table checksums; `npm run db:restore` verifies, restores and proves the checksums are identical. `npm run db:rehearse` times it on 100,000 documents.
- **Test data**: `npm run erp:gen-data` builds a deterministic performance database (separate from demo seeds) and times the list queries.

## 11. Adding a module

1. Create `src/server/modules/<code>/` with `routes.js`, `controller.js`, `service.js`, `repository.js`, `validators.js` and an `index.js` exporting `{ code, name, routePrefix, ownerPart, status, tables, resources, mount }`.
2. Add it to `MODULES` in `modules/registry.js`.
3. Put its tables in migrations (`npm run migration:new -- <name> --table <module_table>`) with up and down scripts, the standard columns and indexes on every foreign key and filter column; register them in `docs/erp/DB_CHANGES.md` and run `npm run erp:db-baseline`. Declare them to the integrity registry in the module's `index.js`.
4. Guard in the service with `assertPermission`; scope every query by the actor's company, project and site.
5. Use `parseListQuery` for lists, `parse` for input, `writeAudit` and `publishEvent` for changes, `updateVersioned` for edits, `companyScope` or `listScoped` for company data, and `idempotency(db, { required: true })` on every submit, post, payment, stock and approval route.
6. Add `src/client/modules/<code>/` and call `registerModule`.
7. Add tests: success, validation, 403, cross-scope, 409, and a contract snapshot entry if it replaces a legacy route.
8. Update `docs/erp/DECISIONS.md` for any structural choice.

## 12. System configuration, numbering and period control (part 01.03)

Platform libraries added: `platform/parameters` (typed parameter registry and resolving, cached store) and `platform/approvals` (a thin role-chain approval engine until the workflow engine of part 04.01). Browser and server share `src/shared/numbering.js` (formats), `src/shared/fiscal.js` (financial years and period statuses) and `src/shared/gst.js` (state codes, PAN, CIN, GSTIN check character).

- **Company settings**: one row per company (`core_company_settings`), saved with a reason, optimistic locking and an audit row that records that a PAN exists, not the number.
- **Financial years and periods**: a year creates twelve monthly periods; each period has a status per module (Open, Soft-closed, Closed). Transactional modules call `assertPeriodOpen(db, { companyId, module, date, actor })` from `modules/core/api.js` before posting; it throws 422 `PERIOD_CLOSED`, `PERIOD_SOFT_CLOSED` or `PERIOD_NOT_FOUND`. A closed period is reopened only through an approved request (Accounts Manager, then CFO).
- **Numbering**: `issueNumber(db, ctx)`, `previewNumber(db, ctx)` and `cancelNumber(db, ctx)` from `modules/core/api.js`. A gap-free series must be issued inside the caller's transaction, so a rolled-back document does not consume a number; HTTP `numbering/next` is refused for gap-free series. Counters are per series and period key (empty, the financial year or `YYYY-MM`) and advance with one `INSERT ... ON CONFLICT ... RETURNING`. Every number is logged in `core_number_issues` (ISSUED or CANCELLED, never deleted); the `sequence_gaps` integrity check proves a gap-free series has none.
- **Parameters**: modules declare definitions with `defineParameter`; values are stored per scope (system, company, project, site) with effective dates. The most specific scope in force on the date wins. A write closes the old row and keeps it as history, the past is never rewritten, and the cache is emptied on every write.
- **Holidays**: calendars per company, state or site; `isHoliday` and `isWorkingDay` (weekly off from the `core.calendar.week_off_days` parameter) are exported for scheduling modules.
- **Pages** (behind `ff.core.p0103`): Company Settings, Financial Years, Numbering, Parameters, Holidays under `/admin/...`.

## 13. Domain events, the outbox and background jobs (part 01.04)

Platform libraries added: `platform/events` (publish, catalogue, bus, masking), `platform/jobs` (job runner and scheduler) and `platform/runtime` (one bus, runner and scheduler per database, and the polling workers). Browser and server share `src/shared/cron.js`.

- **Publishing**: `publishEvent(db, {...})` inserts into `core_outbox` in the caller's transaction, so a rolled-back change leaves no event (BR-01). The envelope holds eventId, type, version, occurredAt, companyId, projectId, siteId, entity, entityId, actorId, correlationId and data. A type in the catalogue (`eventTypes.define`, mirrored to `core_event_types`) has its `data` validated against its schema and takes the catalogue version.
- **Delivery**: `bus.relayOnce()` creates one `core_inbox` row per subscribed consumer and eventId (unique, so the same event is never queued twice) and marks the outbox row published. `bus.deliverOnce()` runs due rows; a handler and the "processed" mark share one transaction. A failing handler is retried after 30 s, 1 min, 2 min and so on up to 1 h and is a dead letter after its `maxAttempts` (default 5). Handlers are synchronous so their database effects stay atomic.
- **Dead letters**: `core_inbox` rows with status DEAD. An administrator re-drives (fresh attempts) or discards (kept, with who and why); both are audited and announced as events.
- **Replay**: `bus.replay({ types, from, to, consumer, reset })` re-runs history through handlers with `ctx.replay === true`, without touching the inbox. A handler must skip notifications and calls to outside systems when `ctx.replay` is set (BR-03). The API runs it as the job `core.event_replay`.
- **Jobs**: `jobs.register(type, handler)`, `jobs.enqueue(type, params)`. A claim is one `UPDATE ... RETURNING`; progress, log lines, cancellation (`ctx.isCancelled()`), retries with back-off, and a stale-job recovery are built in. A job that exhausts its attempts raises `core.job.failed`.
- **Schedules**: `scheduler.define({ code, cron, jobType })` seeds a schedule once (an edited row is never overwritten). `tick()` advances `next_run_at` with a compare-and-swap and the job row is unique per (schedule, slot), so several instances queue a slot once. Cron is five fields in IST. A slot missed during downtime runs once.
- **Workers**: `src/server/index.js` starts the polling loops (`startWorkers`); tests drive the same functions directly.
- **Console** (behind `ff.core.p0104`): Operations monitor, Dead Letters, Jobs and Schedules under `/admin/operations/...`. The monitor refreshes every five seconds.
- **For other modules**: declare event types with `eventTypes.define`, subscribe with `runtimeOf(db).bus.subscribe(pattern, handler, { consumer })`, register job types with `runtimeOf(db).jobs.register`, and add schedules with `runtimeOf(db).scheduler.define`. Consumers must be idempotent; the inbox guards against duplicates, not against a handler writing outside its transaction.

## 14. File storage and attachments (part 01.05)

Platform libraries added: `platform/files` (storage adapter, type rules, scanners, photo metadata, signed links, linked-record registry). Module code is in `modules/core/files`; the browser side is `platform/files/upload.js` (upload logic) and `modules/core/components/Attachments.jsx` (`FileUploader`, `AttachmentList`).

- **A file belongs to a record.** A module registers each record type that takes attachments with `fileEntities.register({ entity, resolve(db, actor, id) })`; `resolve` answers `{ companyId, canView, canEdit, locked }` from that module's own rules. The file service never decides permissions itself: attach needs edit on the record, list, metadata and download need view on the record (BR-02), and a locked record (for example approved) keeps its files: a new version supersedes, nothing is removed (BR-03). `sample_document` is the first registered type.
- **Upload.** One multipart request for small files, or the resumable protocol for large ones: `POST /files/uploads` starts a session, `PUT /files/uploads/:id?offset=N` appends a chunk (a chunk that stops half way counts for nothing; ask `GET /files/uploads/:id` where to resume), `POST .../complete` finishes. Both paths end in the same checks: extension allow-list and magic-number match (executables are refused whatever their name), size limit per category, duplicate content on the same record, optional EXIF stripping, then the file is stored and a scan job is queued.
- **Scan.** The job `core.file_scan` runs every scanner (built-in test-signature scanner always; ClamAV through clamd when `CLAMAV_HOST` is set). `scan_status` is PENDING until it finishes; only CLEAN files can be opened (BR-01). INFECTED files are moved to `quarantine/` and never served. A scan that cannot decide is retried five times, then the file is marked ERROR and an administrator can scan it again.
- **Download.** `GET /files/:id/url` checks access and CLEAN status and returns a link signed with HMAC (`FILE_URL_SECRET`) that names the file, expiry, variant and disposition; its life is a company setting (30 to 3600 seconds). `GET /files/:id/content` (no sign-in, mounted before authentication) verifies the signature, honours byte ranges for video, sets the content type from the validated type (never the client's), `nosniff`, a restrictive CSP and `attachment` for anything a browser should not render.
- **Storage.** `createLocalStorage({ root })` keeps files outside the web root under `<storage>/files/c<company>/<year>/<month>/<uuid>`; keys are validated so nothing can leave the folder. The adapter contract (`put`, `putBuffer`, `createReadStream`, `size`, `move`, `remove`) is what an S3-compatible adapter would implement (D-033).
- **Settings.** Allowed types, size limit and retention class per category and the link life are per company in `core_file_settings`; a change is a maker-checker request (System Administrator asks, IT Administrator approves).
- **Events and jobs.** `core.file.uploaded`, `core.file.available`, `core.file.quarantined`, `core.file.deleted`, `core.file_settings.changed`; jobs `core.file_scan` and `core.file_upload_cleanup` (hourly schedule).
- **For other modules**: register your record type; embed `FileUploader` and `AttachmentList` with your entity name; listen to `core.file.available` if you need to react when a scan finishes.

## 15. Calculation engine and formula registry (part 01.06)

Platform code added: `src/shared/calc.js` (the calculation language and evaluator, used by server and browser), `platform/calc` (engine, built-in formulas, unit conversion). Module code is in `modules/core/calc` (registry, test bench, shadow reports, traces, units) and `modules/core/sample-bills` (the reference record).

- **One place for arithmetic.** A business calculation is a registered formula: a short program over named inputs (`taxable = round(quantity * rate, 2)`), evaluated with exact decimals. There is no `eval`, no floating point, no loop and no access to anything outside the program. Inputs are checked against their declared type and decimal places (money 2, rate 4, quantity 3, percent 4); outputs are rounded once, by the formula's rounding policy (`half_up`, `bankers` for statutory figures, `down`, `up`).
- **Versions.** A formula has numbered versions: DRAFT (editable), SHADOW (being compared; locked), ACTIVE (in force between its effective dates), RETIRED. Once a version leaves DRAFT its calculation can never change, enforced by a database trigger (BR-02). A version becomes ACTIVE only through an approved request: the manager of the owning module, then the CFO for financial formulas (`activationChain`). Its own test cases must pass and its effective date must be today or later.
- **Using the engine.** `calcOf(db).evaluate(code, inputs, { date, version, entity, entityId, companyId, user })` returns `{ result, trace, formula }`. Without `version` the version in force on `date` is used; a document stores the versions it was calculated with and passes them back (`version`), so a newer formula never changes an approved document (BR-01). With `entity` and `entityId` the trace is kept in `core_calc_traces` for "Show calculation"; `GET /calc-traces` returns it to anyone who may view that record. `calcOf(db).convert(qty, from, to, { itemCode })` converts units.
- **Shadow mode.** A SHADOW version is evaluated beside the active one on every real calculation; the outputs are compared and stored in `core_calc_shadow_results`, but the active version always decides. The Shadow Comparison Report also runs two versions on pasted cases and on the inputs of recent real calculations.
- **Units.** `core_uoms` and `core_uom_conversions` (a factor means "1 from = factor to"). An item-specific factor beats a generic one for the same pair; conversions chain (BAG to KG with the item factor, KG to MT with the generic one) and are computed as exact fractions, rounded once.
- **Built-in formulas** (version 1, seeded ACTIVE by the system): `boq.line_amount`, `tax.gst_split`, `stock.weighted_average`, `billing.net_payable`. Their golden outputs (`golden/outputs/calc.*.json`) were captured from the plain Decimal code they replaced and the engine reproduces them exactly (`tests/calc-engine.test.js`, `npm run erp:golden`). Starting the application checks that the stored definition of each equals the code and refuses to start if it does not.
- **Pages** (behind `ff.core.p0106`): Formula Registry (list, versions, test bench, drafting, shadow, activation request, units), Shadow Comparison Report, Sample Bills (a record whose amounts come from the engine, with Show calculation) and Approvals (a stand-in inbox until the workflow engine of 04.01).
- **For other modules**: register your formulas in code like `platform/calc/builtins.js` (version 1) or through the registry; call `evaluate` from your service inside the transaction that saves the document, store the versions in the document, and never repeat the arithmetic.

## 16. Observability, logging, health and performance (part 01.07)

Platform code added: `platform/observability` (redaction, request context, log buffer, tracer, metrics, database instrumentation, objectives and alerts). `platform/http/logger.js` and `pipeline.js` use it; the bus, the job runner and the workers carry the context into background work. The browser side is `src/client/platform/observability/reporter.js`. Module code is in `modules/core/ops`.

- **Logs.** Every line is one JSON object: time, level, message, correlation ID and a pseudonymised user (`u_` and ten hex characters from an HMAC; set `LOG_PSEUDONYM_SECRET` so the mapping cannot be rebuilt from user names). Every entry passes `redact` before it is written: secret keys (password, token, cookie, salary, ...) become `[redacted]`, identifier keys (PAN, Aadhaar, GSTIN, bank account, IFSC, phone, email) keep their last four characters, document content is omitted, and the same patterns are removed from free text. Code far from a request logs through `log` (`platform/http/logger.js`).
- **Correlation.** The middleware takes `x-correlation-id` from the browser (or makes one) and keeps it in an async context, so any line written while the request runs carries it. `publishEvent` stores it in the event envelope, the bus restores it for each consumer, and `jobs.enqueue` keeps it with the job so the runner restores it too. Every error body shows the ID (BR-02); the page "Follow a correlation ID" lists the log lines, traces, events, jobs and browser reports for one ID.
- **Tracing.** A small tracer follows W3C `traceparent`: a server span per request, database spans, consumer and job spans, all under one trace. Recent traces are held in memory and can be exported as OTLP/JSON. The OpenTelemetry SDK is not installed (D-046).
- **Metrics.** Requests per route pattern (never the raw URL), status class and latency histogram in one-minute slices, database queries and slow queries (statement text with values removed), cache hit rates, queue depth, job durations. `GET /metrics` serves them in Prometheus text format to a caller with the `x-health-token` or the `core.ops.view` permission. Hourly roll-ups are saved in `core_metric_samples` so objectives survive a restart.
- **Objectives and alerts.** `core_slo_definitions` holds, per critical journey, the target latency at a percentile, the target availability and the window; the report shows availability, latency, the error budget used and the one-hour burn rate. `core_alert_rules` (error spike, objective breach, outbox backlog, dead letters, job failures, disk, database size, browser errors) are checked every minute: an alert opens once per condition, is not repeated during its cooldown, resolves itself, and is sent to the channels of the rule (email and WhatsApp). No sender is connected yet, so each alert records "not configured" (D-047). Changing an objective or a rule is maker-checker: the IT Administrator asks, the System Administrator approves (`ops_config_change`).
- **Browser reports.** `createApiClient` tells an observer about network failures and 5xx answers; the reporter also catches script errors, rejected promises and the page-load time, de-duplicates and batches them, and posts to `/api/v1/core/ops/client-events` (any signed-in user, 60 a minute). Paths lose their query strings and text is redacted on the server.
- **Page and API.** Operations Health under Administration > Operations (`/admin/operations/health`, flag `ff.core.p0107`): tiles, objectives, alerts, routes, slow queries, rules, traces with a waterfall, follow-by-ID, the stored baseline and a "force a test error" action. Roles: ITADM full, SYSADM view only. API under `/api/v1/core/ops`.
- **Baseline.** `npm run erp:perf-baseline` runs nine journeys over HTTP on a database with 20,000 documents, 20,000 bills and 100,000 events, and writes percentiles and throughput. `-- --save` stores it as `docs/erp/perf/baseline.json`; `-- --compare docs/erp/perf/baseline.json` fails when a journey is more than 25% (and 20 ms) slower. Part 30.06 compares against it.
- **For other modules**: log with `log.info({ msg, ...fields })` and never build log text from user data; add the routes of a new critical journey to `DEFAULT_SLOS` in `platform/observability/ops.js`; raise events and enqueue jobs as usual, the correlation ID follows by itself.

## 17. Integration hub and external connectors (part 01.08)

Platform code added: `platform/integrations` (vault, circuit breaker and rate limiter, provider registry, call wrapper, webhook verification). Module code is in `modules/core/connectors`. A request in `createApp` keeps its raw body for `/webhooks/` paths, because the signature covers the exact bytes.

- **One way out.** A module never calls an outside service itself. It calls `integrationsOf(db).hub.call('mail.main', 'send', { to, subject, text }, { companyId, actor, idempotencyKey })` and gets `{ ok, data, attempts, durationMs, logId }` or an `IntegrationError` with a stable `code` (`CONNECTOR_DISABLED`, `CONNECTOR_NOT_APPROVED`, `RATE_LIMITED`, `CIRCUIT_OPEN`, `TIMEOUT`, `PROVIDER_ERROR`, `SECRET_MISSING`, `INVALID_PAYLOAD`, ...). Which service answers is the connector's business: changing the provider of `mail.main` changes no module.
- **Connectors.** `core_connectors`: a code (unique across the system, the name modules use), a type (email, sms, whatsapp, gsp, bank, biometric, maps, ocr, ai, storage), a provider, an environment, settings, timeout, retries, back-off, calls per minute, breaker threshold and reset time, and log retention. Status: PENDING (created, awaiting approval, unusable), DISABLED, ENABLED.
- **Providers.** `providers.register({ type, provider, configFields, secrets, operations, health, validateConfig })`. Each type has an interface (email needs `send`); later parts register their provider for their type: communication gateway 04.07 (sms, whatsapp, email), GST 23.07 (gsp), banking and biometrics 29.02, AI gateway 28.01. Built in: `email/sandbox` (keeps messages in memory), `email/http_api`, and `http_json` for every other type. Plain `http` is accepted only for localhost outside production; production connectors cannot point at private addresses.
- **Credentials.** `VAULT_KEY` (required in staging and production) derives an AES-256-GCM key; each value has its own nonce and is bound to its connector and name, so a copied ciphertext does not open elsewhere. A new value is staged (PENDING) with the change request and becomes ACTIVE only when the request is approved; the old one is RETIRED, not deleted. Only `secrets.read`, called by the integration service, returns a value, and writes one audit row naming the keys. Everything else returns names, dates and "set". The vault key itself cannot be rotated yet (D-054).
- **Calls.** Checks connector and operation, validates the payload, takes a rate-limit slot (sliding minute, per connector), asks the circuit breaker, opens the credentials, calls the provider with a timeout, retries timeouts, network errors, 5xx, 408 and 429 with doubling back-off, and writes one redacted `core_integration_logs` row per call (attempts counted in it). A 4xx answer is not retried and does not count against the provider. After `breaker_threshold` failed calls in a row the circuit opens and calls fail at once; after the reset time one probe goes through. Opening and closing, and health changes, publish `core.connector.health_changed`. Breaker and rate state are in memory, per process (D-053).
- **Logs.** Request and response are redacted by the platform redactor, message text and body fields are replaced by "[content omitted]", and every secret value of the connector is removed wherever it appears. The user is the pseudonym of 01.07. Rows are deleted after the connector's retention by the daily job `core.integration_log_purge`; `core.connector_health` tests every switched-on connector every 15 minutes.
- **Webhooks.** `POST /api/v1/core/webhooks/:connector` (no sign-in): JSON signed with HMAC-SHA256 over `<x-timestamp>.<body>` using the connector's `webhook_secret` credential, timestamp within five minutes, `x-delivery-id` (or a hash of the signature) recorded in `core_webhook_receipts`; a replay answers 200 with `duplicate: true` and raises nothing. A verified delivery becomes the event `core.webhook.received` for the owning module. Unknown, switched-off or unconfigured connectors answer 404; a bad signature 401.
- **Approval.** Creating a connector, changing settings or limits, rotating a credential or switching on is a `connector_change` request: ITADM asks, SYSADM approves, and the CFO also for bank and GST connectors. Switching off is immediate (a safety control) and audited.
- **Pages** (behind `ff.core.p0108`): Connectors (list, test, switch off), Connector Configuration (create, state, credentials table, change request, sample message, webhook details), Integration Log (filters, redacted payload viewer, CSV). Roles: ITADM configures, SYSADM views.
- **For other modules**: register your provider, call `hub.call`, handle `IntegrationError` by code, and subscribe to `core.webhook.received` for your connector type.

## 18. Authentication, sessions and MFA (part 02.01)

Platform code added: `platform/identity` (password hashing, TOTP, signed tokens, the policy and its checks, and the request resolver). Module `modules/iam` holds the thin user store, sign-in, MFA, sessions and the security administration. Browser side: `src/client/platform/api/auth.js` and `src/client/modules/iam`.

- **Two modes.** `AUTH_MODE=dev-headers` (development and test) is unchanged. `AUTH_MODE=iam` is the real sign-in and is the only mode staging and production accept; it needs `AUTH_SECRET` (signs tokens, at least 32 characters) and, for credentials, `VAULT_KEY`. `authenticate(config, resolver)` in `platform/auth` is the one place that turns a request into `req.actor`; in sign-in mode it reads `Authorization: Bearer <access token>`.
- **Tokens.** A short-lived signed access token (default 10 minutes, claims: session ID and user ID only) and a long-lived opaque refresh token. The refresh token is stored only as a hash. In a browser it travels in an `HttpOnly; SameSite=Strict` cookie scoped to `/api/v1/iam/auth`, honoured only with the header `x-erp-csrf: 1`; native clients send `x-token-delivery: body`. Each refresh replaces the refresh token; presenting a replaced one ends the whole session (reuse detection).
- **The session is the authority.** Every request is checked against its `iam_sessions` row, so a sign-out, a forced sign-out, an idle timeout, a disabled user or a password change takes effect on the next request, not when the token runs out. Roles come from the user record at that moment, never from the token. Idle timeout, absolute timeout and the number of concurrent sessions come from the policy; the oldest session makes room for a new one.
- **Passwords.** Argon2id (19 MiB, 2 passes), a random salt, verified in constant time; an unknown user spends the same time on a decoy hash. Hashes of the old system (`pbkdf2_sha256`, `scrypt`, `sha256` salted) still verify and are replaced by Argon2id at the first successful sign-in. Policy: at least 10 characters, a common-password list (optionally the Pwned Passwords k-anonymity check), not the username, the last 5 are remembered, optional expiry; a change ends the person's other sessions.
- **Lockout and CAPTCHA.** Failures are counted per sign-in name in `iam_login_throttle`, whether or not the name exists. After the CAPTCHA threshold a signed arithmetic question is required; at the lockout threshold the name is locked for a delay that doubles with each further failure up to a limit. Every failure, including a lock, gets the same message (BR-01).
- **MFA.** TOTP (RFC 6238, a step cannot be used twice), a one-time code by text or WhatsApp through the SMS and WhatsApp connectors of the integration hub, and ten single-use backup codes. A role in the policy list (default SYSADM, ITADM, CFO, DIR) cannot finish signing in without one: with no factor it is sent to set one up and signs in when the first code is confirmed. A remembered device (up to 30 days) skips the second step, but not for those roles unless the policy allows it. The TOTP seed is encrypted with the vault of 01.08.
- **Alerts.** A sign-in from a new device, a new country (from the `x-geo-country` header a proxy sets) or too far too soon is recorded as a `suspicious` login event, raises `iam.login.suspicious` and emails the person through the `mail.main` connector (named in the policy).
- **Field mode.** A remembered device can have a PIN (4 to 8 digits, hashed); `POST /iam/auth/pin-unlock` opens a session with the device token and the PIN. Five wrong PINs remove it. Never for roles that need a second step.
- **Policy.** `iam_auth_policy` per company over the defaults in `platform/identity/policy.js`. A change is a maker-checker request (`auth_policy_change`): the IT Administrator asks and the System Administrator approves, or the reverse; it is audited and shown in the change history.
- **Pages** (behind `ff.iam.p0201`, English and Hindi on the sign-in screen): Sign-in (shown by the shell before anything else), Security & MFA, My Sessions & Devices, Authentication Policy, Login History (with active sessions and users). Roles: everyone signed in manages their own account; ITADM and SYSADM view and administer.
- **For other modules**: nothing changes in how a route is written; `req.actor` has the same shape plus `userId`, `sessionId` and `authMethod`. Listen to `iam.login.suspicious`, `iam.account.locked` and `iam.session.revoked` for security alerts and the audit trail of 02.06.

## 19. Organisation hierarchy (part 02.02)

The organisation is the backbone that permissions (02.04), workflow routing (04.02), costing (06.05), geo-attendance (07.05) and the project module (10.01) hang on. It lives in module `iam` (`modules/iam/org/`), behind `ff.iam.p0202`, under `/api/v1/iam/org`.

- **Tables.** `org_companies`, `org_branches` (regions and branches), `org_departments` (divisions and departments, any depth), `org_designations`, `org_projects`, `org_sites` (with the geofence), `org_locations`, `org_cost_centres` (cost and profit, hierarchical, mapped to a department, project or site) and `org_assignments` (who held a role, from when to when). Codes are unique within the parent; a project belongs to one company and a site to one project (BR-01). Company 1 is seeded because earlier parts already store data against it.
- **One description, eight lists.** `org/entities.js` says what each entity is (table, fields, filters, sorts, what blocks its deactivation); the validators, the generic list, create, update and deactivate in `org/service.js` and the routes are driven by it. Every write is one transaction with the audit row and the outbox event.
- **Approval-controlled actions.** A new project or site, and an inactive site, become active only through request type `org_activation` (project director, then project control; the requester cannot decide). A geofence change on a site that is not a draft goes through `org_geofence_change` (system administrator; reason mandatory). A direct edit of those is refused with an explanation, so no route, import or job bypasses the chain. A draft site takes its geofence directly.
- **Geofence.** `src/shared/geo.js` (re-exported by `platform/org`) holds the arithmetic for the server and the browser editor alike: circle radius 25 m to 5 km, polygons closed and not self-crossing, and a point test with an edge tolerance (default 10 m, at most 100 m). `POST /sites/:id/geofence/test` and `POST /geofence/test` (an unsaved shape from the editor) answer it.
- **Effective-dated assignments.** The department head, project manager and site in-charge change with an effective date. A date of today or earlier takes effect at once and closes the previous holder's row; a later date waits and the daily job `iam.org_effective_apply` applies it. The current holder is mirrored on the entity row for fast reads; `GET /:entity/:id/history` returns the assignments and the audit trail.
- **Deactivation blockers (BR-03).** `platform/org` offers `orgBlockers.register(entity, name, fn)`; attendance, stock, billing and the rest will register the open records that stop a site or project from being deactivated. Deactivation is refused with every blocker listed. The built-in blockers are active users, cost centres, holiday calendars and open approval requests.
- **Scope and masking.** Every query carries the company condition (a row of another company is "not found"); the system administrator alone lists every company. The PAN of a company is masked for everyone without `org.company.manage`.
- **Pages** (permission `org.view`): Organisation (companies, branches and regions, departments, designations, locations), Projects & Sites (list, project and site object pages with geofence editor, approvals and timeline), Organisation Chart (search, move with undo, print), Cost & Profit Centres (list and hierarchy), and the shell's project and site switcher.
- **For other modules**: call `GET /iam/org/context` for what the person may pick, and react to `iam.<entity>.created|updated|deactivated|activated`, `iam.project.activated`, `iam.site.activated`, `iam.site.geofence_changed` and the `*.head_changed`, `*.manager_changed` and `*.in_charge_changed` events.

## 20. User management and the onboarding state (part 02.03)

Module `iam` (`modules/iam/usermgmt/`), behind `ff.iam.p0203`, under `/api/v1/iam/users`, `PATCH /api/v1/iam/me` and the public `/api/v1/iam/invitations/:token`.

- **Two statuses, one place.** `iam_users.status` stays "may this person sign in" (02.01 reads it everywhere). The person's state in the process, `lifecycle` (Invited, Onboarding, Active, Suspended, Deactivated), lives in `iam_user_profiles` (one row per user, with language, type, employee link, department, home project, photo and signature file, preferences). `setLifecycle` is the only function that changes it and it moves `status` with it.
- **Invitation flow.** An administrator creates the person (Invited: no password, cannot sign in) and sends an invitation by email, text or WhatsApp through the integration hub. Only the hash of the token is stored; a new send replaces the old link, at most five in 24 hours and one per 30 seconds; a link works once and for seven days; a daily job marks unused ones expired. The person sets a password on `/accept-invite` and becomes Onboarding (no role) or Active (a role was already approved). Development and test show the link to the administrator; production never does.
- **Restricted onboarding state.** A signed-in person with no approved role is flagged `actor.onboarding`; `platform/http/onboarding.js` answers 403 `ONBOARDING_RESTRICTED` for every route except their own profile, sessions and devices, a password change, the session summary, the feature-flag lookup and the document service. The gate runs before any route, so a module added later is closed to them without anyone remembering to close it; a test walks every route in the OpenAPI document to prove it.
- **Roles until 02.04.** Granting is a request type `user_role_assignment` through the interim approval engine (SYSADM; a privileged role, one that policy puts behind MFA, needs SYSADM then ITADM; a system administrator asking cannot approve their own request, so the chain is ITADM, plus DIR for a privileged role). The approved request is applied in the approver's transaction, so the roles work on the person's very next request. Taking a role away only lowers access, so it is direct and audited. `iam_role_grants` keeps who was given or lost what.
- **Deactivation (BR-02).** `GET /users/:id/deactivation-check` lists approval requests the person raised, approval steps only they can decide, organisation roles (department head, project manager, site in-charge) and anything other modules register with `userBlockers` (`platform/identity`). Handing items to a successor moves the requests (`approvals.reassignRequester`) and the organisation roles (`orgService.reassignHoldings`) in the same transaction; a step nobody else can decide blocks until another person holds the role. Sessions end at once (the session row is checked on every request), roles are taken away, history stays. The last active system administrator and one's own account cannot be suspended or deactivated.
- **One account per person (BR-01, FR-07).** Email, mobile (stored as +91XXXXXXXXXX), username and employee code are unique; a duplicate is refused with who has the account and, for a deactivated person, an instruction to reactivate. An account of another company is refused without saying whose.
- **Import.** CSV through `POST /users/import?mode=validate|commit` (up to 2,000 rows); row-level errors; a commit with any wrong row writes nothing unless `skipInvalid=true`. The Excel engine of 04.13 will replace the CSV adapter.
- **Employee link.** `employee_code` is stored and unique; `employee_id` stays empty until the employee master of 07.01 exists.
- **Pages.** Users (`iam.user.view`: filters, saved views, columns, bulk invite and suspend, CSV export, invite and import dialogs, and a page per person with details, assignments, sessions, login history, approvals and timeline), My Profile, the welcome page for a person in onboarding, and the invitation page (`/accept-invite`).
- **Events.** `iam.user.created|updated|invited|activated|suspended|reactivated|deactivated|roles_changed|profile_updated|imported`.

## 21. Role and permission engine (part 02.04)

One engine decides what a person may do: `platform/authz` (the engine, the registries and the role templates) and `modules/iam/access/` (roles, assignments, the explainer and the legacy comparison, behind `ff.iam.p0204`).

- **Computed per request.** The authenticate step gives every actor its grants (`actor.grants`): for each permission, what the roles it holds allow and deny and for which part of the company. Results are cached per person for 30 seconds; an assignment, a role change or a mask change clears the cache of the instance that made it at once, and any other instance catches up within the 30 seconds (the 60 second limit of BR-03).
- **RBAC plus scope.** A role is held company-wide or for a branch, department, project, site or the person's own records, from a date to a date. `hasPermission`, `assertPermission` and `requirePermission` mean "held for the whole company": a role granted for one project never opens a route that does not look at the record. Code that limits its answer to the scope asks `hasPermissionAnywhere`, then `authz.scopeFilter(actor, permission, columns)` for lists and `authz.check(actor, permission, resource)` for one record. A record with no project or site is company-level, so a scoped grant does not reach it. Today the organisation projects, sites and cost centres and the sample documents are scoped; each new module adds its own records the same way.
- **Rules.** Deny by default; an explicit deny in any role held overrides every allow; grants within a scope are a union; a record marked public, internal, confidential or restricted is refused to a role whose clearance is lower (FR-09); a manager sees the records of people in the departments they head when the entity registers for it and the parameter `iam.hierarchy.reportees_<entity>` allows it (FR-08).
- **Roles.** The 44 templates of the role catalogue (the 23 owner roles, 17 supporting roles and 4 external roles) are code in `templates.js` and are seeded into `iam_roles` as locked system roles at start-up (a hash says when a template changed). An administrator clones one into a custom role: it starts as a draft with the template's grants and masks; what it grants, its masks, clearance and activation or retirement change only through request type `iam_role_change` (the IT administrator, and the director if the role holds a sensitive permission). A role is retired only when nobody holds it.
- **Assignments.** Request type `iam_assignment` (`access/chains.js`): an ordinary role needs the system administrator; a privileged role then the IT administrator or the director; a finance approver or the Super Admin role needs the director; a system administrator asking cannot approve their own request. Ending an assignment lowers access, so it is immediate and audited. Roles stored on the user (part 02.03) remain company-wide implicit assignments; the engine reads both.
- **Registry.** `permissionRegistry` (key, module, entity, action, sensitive, description), `fieldRegistry` (sensitive fields and their partial format), `recordResolvers` (what the explainer can test a permission against) and `hierarchyRegistry`. Modules declare theirs when they load; `iam_permissions` is seeded from them.
- **Field masks.** `authz.mask(actor, entity, record)` hides or partly shows each sensitive field by the roles held, the most open rule winning, else the field's own default. The mobile number of a user and the PAN of a company now use it; the salary and bank account of the employee master are declared for part 07.01.
- **Explainer and comparison.** `GET /iam/effective` gives every permission with allowed or refused, the reason and the roles that grant or deny it, for a person and optionally a record. `GET /iam/legacy-comparison` compares each user's access under the frozen nine-role table (`platform/authz/legacy.js`) with what the engine computes from the same roles, classing every difference; both lost and gained must be empty.
- **Pages** (permission `iam.role.view` or `iam.assignment.view`): Roles (list, compare two, clone), Role (permission matrix by module, field masks, people holding it, approvals), Assignments (list, assign form with a scope picker, end), Effective Permissions, Legacy Access Comparison. Browser helpers: `useCan()`, `<Can permission record>` and `menuFor` (`client/platform/access`).
- **Events.** `iam.role.created|changed`, `iam.assignment.created|ended`.

## 22. Segregation of duties, privileged access and access reviews (part 02.05)

`platform/sod` is the rule engine: `rules.js` holds the ten standard rules (SOD-01 to SOD-10, seeded per company into `iam_sod_rules`, then owned by the company); `index.js` answers `assertAssignable` (the preventive check before a role is given), `guardAction` and `record` (the check and the ledger of what a person did to a document), `scanUser` and `scanCompany` (the detective check) and `attempt` (keeps a blocked attempt on record after its transaction rolls back). `modules/iam/privileged` holds the module code: `sod.js` (rules, violations, remediation, dormant accounts), `elevation.js` (time-boxed elevated access and its request log), `reviews.js` (campaigns, reviewer decisions, closing), `routes.js`, `validators.js`. Everything is behind feature flag `ff.iam.p0205`.

- **Rules.** A rule is two lists of patterns and a scope: the person (permissions held), the document, the vendor, the period or the project; severity is block, warn or detect, with an optional amount condition. A change to a rule is request type `iam_sod_rule_change`, step `AUD|DIR`, applied in the approver's transaction.
- **Preventive.** Asking for a role (`iam_assignment`, `user_role_assignment`) or an elevation, and building a role, are checked against the permission rules and refused with a message naming the rule and the roles on each side; a warning comes back as `sodWarnings`. The check is repeated at approval. The approval engine itself is the first guarded action: the person who raised a request cannot approve it (SOD-01), and the refusal is recorded as a blocked violation.
- **Detective.** `iam_sod_violations` holds standing conflicts (one open row per rule and person, closed when the conflict goes), warned, detected and blocked transactions. A daily job and "Scan now" refresh it. The auditor or director accepts a risk with a reason; the system administrator takes a role away; both end in an audited change.
- **Elevation.** `iam_elevations`: a request with a reason and up to `iam.elevation.max_hours` hours, approved by the requester's manager (the head of their department), then the IT administrator, and the chief financial officer for a financial role. The permission engine reads an active elevation like an assignment and never caches past its start or end, so access ends at the end time. `iam_elevation_log` records every request made while elevated, with the correlation ID the audit trail now carries.
- **Reviews.** `iam_access_campaigns` (privileged roles, a department or everything), one `iam_access_reviews` per reviewer (department head; the director for a person's own access) and a line per role held. Closing needs every line decided, then applies the revokes and re-checks the people affected.
- **Dormant accounts.** No sign-in for `iam.dormant.days` days: reported, or suspended where `iam.dormant.action` says so; the last active system administrator is never suspended.
- **Pages.** SoD Rules (list, rule, propose, test against a person), SoD Violations (report, remediate, dormant accounts), Request Elevated Access, Elevation Approvals, Access Reviews (campaigns) and My Access Review (reviewer worklist, bulk certify or revoke).
- **Events.** `iam.sod.violation_detected|rule_changed`, `iam.elevation.requested|started|ended|revoked`, `iam.review.started|closed`, `iam.account.dormant_suspended`. Jobs: `iam.elevation_expiry` (every five minutes), `iam.sod_scan` (daily).

## 23. Audit trail engine and security event log (part 02.06)

`platform/audit` is the audit service: `writeAudit` (and `record`, the call every module uses) writes the row and its chain companion in the caller's transaction; `diff.js` computes the field-level changes and masks sensitive fields; `chain.js` chains rows, backfills the log written before this part, verifies the chain and seals months; `security.js` writes security events and taps the domain events. `modules/core/audit` holds the viewer API, the nightly jobs and the export log. Everything the part adds is behind feature flag `ff.iam.p0206`.

- **Tables.** `core_audit_log` is unchanged. `core_audit_chain` holds, per audit row, the sequence number, company, person, address and device, the field changes and the hash with the previous hash. `core_security_events`, `core_audit_verifications` (every check) and `core_audit_segments` (sealed months). Triggers refuse UPDATE and DELETE on all four (BR-01).
- **Chain.** Each hash is SHA-256 over the row, its chain fields and the previous hash. `verifyChain` finds a changed row, a removed row, a row inserted outside the service and removed triggers. `core.audit_verify` runs it nightly; a break is a critical security event and the domain event `core.audit.tamper_detected`, once for each new break.
- **Where from.** The request pipeline puts the company, person, address and device in the ambient context, so every audit row and security event carries them without each caller passing them.
- **Security events.** Login failures, MFA and PIN failures, refused requests (403), sensitive exports, and, through `publishEvent`, successful and suspicious sign-ins, lockouts, token reuse, password and MFA changes, permission changes, role and assignment changes, SoD rule changes and violations, elevation, access reviews, dormant suspensions and audit tampering, each with a severity.
- **Export and print.** `POST /core/audit/export-log`: who exported or printed what, the format, the rows and the filters, in the audit trail (and a security event when sensitive). The browser reports every CSV export and every print.
- **Retention and legacy.** `core.audit_seal` seals each finished month; sealed months are listed and exportable as NDJSON against their closing hash and are never deleted. Old audit rows are chained in order at start-up; old sign-in failures are copied into the security log once each.
- **API** (under `/api/v1/core`): `GET /audit` (entity, id, user, action, from, to, q), `/audit/history`, `/audit/entities`, `/audit/verification`, `POST /audit/verify`, `/audit/segments`, `/audit/segments/{period}/export`, `GET /security-events`. Permissions: `core.audit.view` and `core.audit.verify` (auditor), `core.security.view` (system administrator, IT administrator, auditor); a person who may view a kind of record may read its history.
- **Pages.** Audit Explorer (filters, record timeline, chain status, verify now, export) and Security Events (severity tiles and filters, alert banner, export); `RecordHistory` (`client/platform/audit`) for every Object Page.

## 24. Secure request pipeline, route registry, secrets and security headers (part 02.07)

`platform/security` is the security baseline every module inherits: `routes.js` (lists the application's routes), `route-policy.js` (the declarations), `policy.js` (matching and the Authorise stage), `registry.js` and `probe.js` (the start-up check, the snapshot and the self-test), `headers.js` (security headers, CORS, CSRF), `limits.js` (rate limits), `settings.js` (the settings and their defaults), `export.js` and `csv.js` (export controls), `rooms.js` (real-time rooms), `actAs.js` (work done for a person), `middleware.js` (authorise, validate, audit), `rotate.js` (vault key rotation) and `handlers.js` (approved changes). Module code is `modules/core/security`. The central permission check, the registry and settings pages and the export controls are behind feature flag `ff.iam.p0207`.

- **The pipeline.** Correlation id and trace, then security headers, request log, the CORS allow-list, the cookie-session CSRF guard and the per-address rate limit; then Authenticate (02.01, 02.04); then the Authorise stage (the route's declared permission) and the per-person rate limit; then validation in the route, the service (permission with scope, transaction, audit, event) and the error envelope. `authorise`, `validate` and `audit` are middleware a route can name directly.
- **Route registry.** `route-policy.js` has a line for each of the routes: method, path, guard (permission, self, record, public, infra), permission, validation schema, scope, rate class, audited. At start-up the application lists its routes and compares them with the policy; undeclared routes stop a staging or production start (BR-01), and `npm run erp:route-check` (in the regression and CI) fails on an undeclared route, a stale line or an unknown permission. The snapshot is `core_route_registry`, with the last self-test result of each route.
- **Self-test.** Every non-public route is called with no sign-in (401) and with a person who holds no permission (403 for a permission route). The result is stored and shown on the Route Registry page.
- **Headers.** A content security policy (scripts from this application only, no framing, no plug-ins), HSTS on secure connections, X-Frame-Options, Referrer-Policy, Permissions-Policy, nosniff, cross-origin policies, and `no-store` for API answers; values come from the security settings.
- **CORS and CSRF.** Only the application's own origin, `APP_URL` and the listed origins; a foreign origin gets no CORS headers and cannot change data (403 CORS_FORBIDDEN); a data-changing request with the session cookie and no token needs `x-erp-csrf` (403 CSRF).
- **Rate limits.** Classes auth, otp, export, write, read and webhook, per address and per person, from the settings; 429 with Retry-After, and the first refusal in a window is a security event.
- **Settings.** `core_security_settings` holds overrides to the built-in values; a change is request type `security_settings_change` (ITADM asks, SYSADM or DIR approves), is validated (a policy that allows inline scripts is refused), is audited with the diff and shown as change history.
- **Secrets.** Only in the environment; the application will not start in staging or production without the required ones; the settings page shows whether each is set and never its value; `docs/erp/SECRETS.md` has the rotation procedures and `npm run erp:rotate-vault-key` re-encrypts the stored credentials under a new key.
- **Export controls.** `iam.user.export`, a row limit (`core.export.max_rows`), formula neutralisation, an approval above the threshold (request type `bulk_personal_export`, HRMGR or DIR, used once), the audit trail and the security log.
- **Rooms and background work.** The room guard checks the permission on join and for every member on every event; `actAs` runs work for a person with that person's grants, and only while they can sign in.
- **CI gates.** Lint and types, tests, route check, schema checks, secret scan, `npm audit`, dependency review on pull requests, CodeQL and a container scan that starts when a Dockerfile exists; the pull request template carries the secure coding checklist; `docs/erp/THREAT_MODEL.md` is the threat model.
- **Pages.** Route Registry (summary, filters, protection, last test, run the self-test) and Security Settings (rate limits, headers, CORS, export threshold, secrets, pending request, change history, JSON export and import).
- **Events.** `core.security.settings_changed`, `core.export.completed`.

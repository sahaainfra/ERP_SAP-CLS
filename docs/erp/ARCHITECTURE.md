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

The platform libraries by their paths: `platform/config`, `platform/db`, `platform/http`, `platform/auth`, `platform/validation`, `platform/pagination`, `platform/money`, `platform/health`, `platform/audit`, `platform/events`, `platform/integrity`, `platform/parameters`, `platform/approvals`, `platform/jobs`, `platform/runtime`, `platform/files`, `platform/calc`, `platform/observability`. The one module so far is `modules/core`.

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

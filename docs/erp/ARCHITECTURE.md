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

The platform libraries by their paths: `platform/config`, `platform/db`, `platform/http`, `platform/auth`, `platform/validation`, `platform/pagination`, `platform/money`, `platform/health`, `platform/audit`, `platform/events`, `platform/integrity`. The one module so far is `modules/core`.

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

# DECISIONS

Entries are append-only. Approved golden-output changes use the line format `GOLDEN-APPROVED: <id> <sha256> <reason>` (BR-03).

## 2026-10-30 - Greenfield codebase (part 00.01)
`ERP_SAP CLS` is a new codebase. The owner chose not to audit `ERP_Construction` or `ERP_SAHAA INFRA`. The discovery baseline is therefore empty.

## 2026-10-30 - Technology stack (part 00.02)
Owner chose Node + SQLite over PostgreSQL because PostgreSQL and Docker are not installed on the development machine.

- Server: Node 24 (ESM), Express 5, `node:sqlite`, Zod for input validation.
- Client: React 19, Vite.
- Tests: `node:test` for unit and API tests; Playwright (installed Chrome, no browser download) for E2E.
- Consequence: the pack's `NUMERIC(18,2/4/3)` and `EXPLAIN` on 100k rows do not map onto SQLite. Money and quantities must be stored as integer minor units or as text decimals, never REAL. A move to PostgreSQL later needs a migration plan; the migration files are plain SQL kept simple for that reason.
- Consequence: `timestamptz` is stored as ISO-8601 UTC text.

## 2026-10-30 - Schema baseline locked at the end of part 00.02
00.01 found no database, so its baseline is empty and could not protect anything. `schema/baseline.json` was locked from migrations `20261030000001` to `20261030000003`. From now on schema-diff fails if any of those objects is altered or dropped. New tables, new indexes and new nullable (or defaulted) columns are allowed. To re-lock after an approved change run `node scripts/schema_diff.mjs --lock` and record the reason here.

## 2026-10-30 - Feature-flag data model
One table, `core_feature_flags`. A row's scope comes from its columns: environment default (`environment` set), company override (`company_id`), project override (`company_id` and `project_id`), flag default (all NULL; `default_enabled`). Overrides apply in every environment. Flags are defined by reference-seed migrations, never created through the API.

## 2026-10-30 - Golden outputs
`golden/registry.mjs` holds deterministic runners; `golden/outputs/*.json` holds the captured results, compared byte-for-byte. The first registered output is the flag-evaluation matrix, because no business calculations exist yet.

## 2026-10-30 - CI/CD and release engineering (part 00.03)
- One quality-gate command, `npm run erp:regression`, is both the local check and the CI `verify` job, so the two cannot drift.
- Staging and production hosting are not chosen. Deploy, rollback, backup and smoke-test tooling is written against a directory-based environment and rehearsed there; moving it to a real host means replacing the start/stop and copy steps in `scripts/lib/deploy.mjs`.
- Database rollback prefers the down-migrations of the build being removed (keeps new data) and falls back to the pre-deploy restore point (loses data written since). Restore points are SQLite `VACUUM INTO` copies.
- Coverage gate: line coverage of changed JavaScript files under `src/server` and `scripts/lib`, minimum 60 %, to be raised to 80 %. The server entry point is excluded because it is exercised as a separate process. Client code is covered by the E2E suite, not by line coverage.
- Build ID is `<timestamp>-<commit>` locally and `<run number>-<commit>` in CI. Versions are bumped by hand with `npm run release -- patch|minor|major`; the changelog comes from the `P<part>:` commit subjects and business-language notes from `Release-note:` lines.
- The About page and `GET /api/v1/core/about` are limited to `core.about.view` (SYSADM, ITADM). The build ID appears nowhere else in the UI.
- Security scans: `npm audit` (high and critical block), a built-in secret scanner (`scripts/lib/secrets.mjs`) and CodeQL in the workflow. No third-party secret scanner is installed.

## 2026-10-30 - Application architecture and API conventions (part 01.01)
Architecture decision records. The reference text is `docs/erp/ARCHITECTURE.md`; each record here gives the reason.

- **ADR-01 Layers.** route -> controller -> service -> repository, one file each per resource. Business rules, the permission guard and the data-scope check live in the service so jobs, imports and other modules that call it are protected like HTTP requests. Tests fail if a controller, route or validator contains SQL.
- **ADR-02 Module ownership and registry.** `src/server/modules/<code>/` owns its tables; `modules/registry.js` lists modules and mounts them under `/api/v1/<code>`. The existing flags, about and session code was moved into module `core`, which is the reference implementation. Nothing outside this repository's own code needed an adapter.
- **ADR-03 Platform libraries.** Cross-cutting code (`config`, `db`, `http`, `auth`, `validation`, `pagination`, `money`, `health`, `audit`, `events`) lives in `src/server/platform/` and never imports from `modules/`. Old file paths were not kept as re-export shims: all imports were updated, so each thing has one location.
- **ADR-04 One error envelope and one error-code registry.** `platform/http/errors.js` holds the codes; the handler, the guide page and the tests read the same list. Malformed JSON used to fall through to a 500; it is now a 400 `BAD_JSON`, and an oversized body a 413. That is a bug fix: the old response was an unhandled-error 500, not a designed shape. Unexpected errors return a generic 500 and the stack stays in the server log under the correlation ID.
- **ADR-05 Request logging.** One JSON line per request with correlation ID, method, path, status, duration and user. Query strings and bodies are never logged, so a search term or an amount cannot leak into logs.
- **ADR-06 Lists.** `parseListQuery` implements `page`, `pageSize` (max 200), `sort`, `q`, `filter[column]`, `from`, `to`. `sort` and `filter` accept only columns the endpoint allow-lists (otherwise 400) and `ORDER BY` is built from a column map. Express 5 does not nest `filter[x]`, so the keys are matched by pattern.
- **ADR-07 Decimals.** No floats for business numbers. `src/shared/decimal.js` is a BigInt-based exact decimal, rounding half-up (ties away from zero) by default, used by the server and the browser. Money 2, rate 4, quantity 3, percent 4 places; rounding happens once at the end; `allocate` splits an amount without losing paise. A number with a fraction must be passed as a string.
- **ADR-08 Health.** `/health/live` is public. `/health/ready` is for ITADM/SYSADM or a monitoring token (`HEALTH_TOKEN`, 16 characters or more, compared in constant time) because it names failing dependencies. Database, queue (outbox) and storage are checked; a failing dependency returns 503, a backed-up outbox is `degraded` (200). `/api/health` stays unchanged.
- **ADR-09 Events.** `publishEvent` writes the standard envelope (`eventId`, `occurredAt`, `companyId`, `projectId`, `siteId`, `entity`, `entityId`, `version`, `actorId`, `data`) to the outbox in the caller's transaction. Rows written by part 00.02 have the older flat payload; the dispatcher in 01.04 must accept both (D-016).
- **ADR-10 Frontend.** One API client (retries idempotent GETs only, one correlation ID per call, errors normalised to `ApiError`), TanStack Query for server state with a key factory, and a module route registry. Navigation hides entries the user has no permission for and entries whose feature flag is OFF; the page itself still shows a no-permission or not-enabled state when reached by URL. The guide is rendered by a small parser that builds React elements, so no HTML is ever injected.
- **ADR-11 Contract snapshot.** `tests/contract.test.js` records 25 requests to the pre-existing routes and replays them against the data that existed then (migrations up to `20261030000004`), so later reference seeds do not look like contract changes. Permission lists may grow, never shrink. Re-record only on purpose and say why here.
- **ADR-12 Gated coverage.** The coverage gate now also covers `src/shared` and the plain-JavaScript client platform files (API client, registry, markdown, formatting, query keys). React components stay covered by the E2E suite.
- **ADR-13 Feature flag.** The guide ships behind `ff.core.p0101`: default OFF, ON in development and test. The API answers 404 "not enabled" and the navigation entry is hidden while it is OFF for the user's company.

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

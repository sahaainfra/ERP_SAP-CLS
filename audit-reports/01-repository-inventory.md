# 01 — Repository inventory (Phase 1, read-only)

Audit date: 2026-11-24. Auditor: Claude Code (automated audit session).

## 1. Commit, runtime and scope

| Item | Value | Evidence |
|---|---|---|
| Repository | `sahaainfra/erp_sap-cls`, working copy `/home/user/ERP_SAP-CLS` | `git remote -v` |
| Commit audited | `ed225efd45f3040962958aac97a491c4ed38575f` (branch `ccr-a3b3ce3d-65llwf`, 2026-11-23 23:17 UTC) | `git rev-parse HEAD` |
| Commit named in the audit prompt | `e0c6c22fb2ddbb55124b433037dcb387f5a21c30` (current `main`) | It is an ancestor of the audited commit, 21 commits earlier. The 21 commits are parts 30.01–30.10 built in this same session; they are inside the scope. |
| Node | v24.22.3 (`engines: node >=24` accepted) | `node --version` |
| npm | 11.19.1 | `npm --version` |
| Audit prompt path `/home/claude/erp_sap-cls` | Does not exist in this environment | The audit used the session's checkout instead. |

**Conflict of interest.** The same assistant session that audits the repository also wrote the last 21 commits (parts 30.01–30.10). Findings on those parts are reported the same way as the rest, but a human reviewer should weigh them with that in mind.

## 2. Detected stack

From `package.json`, `docs/erp/ARCHITECTURE.md` and the source:

- **Server:**
  - Node 24, ES modules, Express 5;
  - SQLite through `node:sqlite` (ADR-1), money in integer minor units (ADR-14);
  - Zod 4 validation;
  - Socket.IO with an optional Redis adapter;
  - busboy multipart uploads, `sharp` images, `pdf-lib` and `@pdf-lib/fontkit` PDFs, `pdfjs-dist` PDF reading;
  - optional OCR (`tesseract.js`, loaded only when installed) and optional vision (`@vladmandic/human` on TensorFlow.js WASM).
- **Client:**
  - React 19 and Vite 8, TanStack Query, Leaflet, lucide-react;
  - self-hosted IBM Plex and Noto Sans Telugu fonts.
- **Tests:** `node:test` (unit, API), Playwright (E2E, desktop 1280×800 and mobile 360×740 projects), axe-core.

## 3. Tree counts (tracked files, `git ls-files`)

| Type | Count at audit | Count in the audit prompt |
|---|---|---|
| `.js` | 1,503 | 1,458 |
| `.jsx` | 736 | 725 |
| `.sql` | 854 (427 migrations, each `.up` and `.down`) | 834 |
| `.mjs` | 104 | 91 |
| `.md` | 517 | 484 |
| `.png` | 8,704 (visual snapshots and screenshots) | 8,594 |
| Test files `tests/*.test.js` | 294 | — |
| E2E specs `e2e/*.spec.js` | 242 (247 non-image files under `e2e/`) | 286 entries for `e2e/` + `tests/` combined |
| Server source `src/server/**/*.js` | 708 | — |
| Client source `src/client/**/*.jsx` / `*.js` | 734 / 141 | — |

The growth since the prompt's counts matches the 21 commits of parts 30.01–30.10.

## 4. Modules

**Server registry.** `src/server/modules/registry.js` lists 31 modules: core, iam, ui, eng, msg, sec, pol, mdm, fin, hr, bd, est, proj, engg, bud, plan, site, proc, inv, plant, qa, hse, rmc, ctr, bill, pay, portal, bi, ai, admin, tst.

**Server folders not in the registry:**

- `src/server/modules/close/` (4 files: `dossier.js`, `financials.js`, `punches.js`, `retention.js`).
  - No server file imports it.
  - Only tests import it: `tests/close-p2601.test.js`, `tests/close-p2602.test.js`, `tests/pl-p2312.test.js`, `tests/bill-ledger.test.js`.
  - It adds no route and no page. Project closeout (M26, rows 26.01–26.04 "In progress") therefore has evidence readers but no API or UI. See AUD-DEF-004.

**Client registry.** All 29 client module folders are imported by `src/client/main.jsx`. The server modules `sec` and `close` have no client folder of their own.

**PROGRESS.csv.** 239 rows; the prompt states 240 (the file has 240 lines including the header). The 239 rows hold **236 distinct parts**. Parts 23.01, 23.02 and 23.03 each appear twice:

- seq 167–169 near the end of the file: "Ready for review", completed 2026-11-17;
- an earlier copy of the same three rows: "Not started".

| Status (all 239 rows) | Count at audit | Count in the audit prompt |
|---|---|---|
| Ready for review | 192 | 192 |
| In progress | 44 | 34 |
| Not started | 3 (the three duplicate rows) | 13 |

The 10 rows that moved from Not started to In progress are 30.01–30.10. Counted once per part (keeping the later row), the 236 parts are 192 Ready for review, 44 In progress, 0 Not started.

Per module (distinct parts):

| Module | Parts | Status |
|---|---|---|
| M00–M24 | — | All Ready for review, except one In progress row each in M01 and M06 |
| M23 | 15 | All Ready for review; three of them also have a stale duplicate "Not started" row |
| M25–M30 | — | All In progress |

**Duplicate rows (AUD-DEF-002).** For 23.01 General Ledger Core, 23.02 Posting Engine and 23.03 Accounts Payable, the repository has:

- a completion report (`docs/erp/COMPLETION/23.01.md`, `23.02.md`, `23.03.md`);
- code (`src/server/modules/fin/posting.js`, `postingroutes.js`, `aproutes.js`);
- a migration (`migrations/20261215000334_fin_gl.*`);
- tests (`tests/gl-p2301.test.js`, `tests/posting-p2302.test.js`, `tests/ap-p2303.test.js`).

The "Not started" copies are stale. Any tool that reads the first match per part (or counts rows) reports these three parts wrongly. The code's tests ran green in this session's full regression (Phase 2).

## 5. Layering (ARCHITECTURE.md §1)

The guide describes five layers: route (`routes.js`) → controller (`controller.js`) → service (`service.js`) → repository (`repository.js`) → database.

| Check | Result | Evidence |
|---|---|---|
| Route, controller and validator files contain no SQL | Holds. No match for `.prepare(`/`.exec(` in any `*routes*.js` or `*controller*.js`. | `tests/architecture.test.js` "BR-01 controllers hold no SQL…" (passed in the full regression) |
| The five layers are followed | **Only partly.** 32 `service.js` files but 11 repository files. Most modules (proc, fin, inv, plan, site, tst, …) put SQL directly in service files (`createXService`) and declare routes inside the module's `index.js` instead of a `routes.js`. | `git ls-files 'src/server/**/repository*.js'` → 11 |
| Mount files (`modules/*/index.js`) hold business logic | Yes in ten modules. Job handlers and event consumers with SQL are written in the mount file: `proc/index.js` 66, `site/index.js` 44, `plant/index.js` 38, `inv/index.js` 35, `bill/index.js` 31 `db.prepare` calls. | `grep -c db.prepare src/server/modules/*/index.js` |
| The architecture test covers the real layout | **No.** It checks files named `controller|routes|validators.js` only; the `index.js` route definitions and the service files with SQL are outside its net. | `tests/architecture.test.js:45-50` |

This is recorded as AUD-DEF-003 (Medium). The data-access rules that matter for security are enforced elsewhere: services guard permissions, and queries are parameterised (Phase 5).

## 6. Dependencies named by the prompt

| Package | Used | Where | When its service is absent |
|---|---|---|---|
| `socket.io`, `socket.io-client` | Yes | `src/server/platform/realtime/socket.js`, `src/client/platform/realtime/socket.js` | Runs in-process |
| `redis`, `@socket.io/redis-adapter` | Yes, optional | `socket.js:72-78` loads them only when `REDIS_URL` is set | Single-instance rooms (THREAT_MODEL known gap) |
| `busboy` | Yes | `src/server/modules/core/files/multipart.js` | — |
| `sharp` | Yes (6 files) | `eng/templates.js`, `eng/documents-ops.js`, `tst/manuals.js`, … | — |
| `pdfjs-dist` | Yes | `ai/docintel.js`, `client/modules/eng/DocumentViewer.jsx` | — |
| `tesseract.js`, `@tesseract.js-data/eng` | Optional, loaded by name at run time | `ai/docintel.js:64-72` | OCR returns null; scanned images are not read (D-786) |
| `@tensorflow/*`, `@vladmandic/human` | Optional, loaded at run time | `ai/vision.js:85-107` | Vision suggestions off; detector returns null |
| `regenerator-runtime` | Yes | `eng/tpl-pdf.js:5` | — |
| `@fontsource/noto-sans-telugu` | Yes | `src/client/main.jsx:10-11` | — |

No declared runtime dependency was found unused. A duplicate-code scan was **Not Executed**: no duplicate detector (jscpd or similar) is installed, and installing one would change the lockfile.

## 7. CI (`.github/workflows/ci.yml`) and its real state

**Jobs:**

- `verify` — 20-minute timeout; runs `npm run erp:regression`.
- `clock` — the unit suite under two fixed dates.
- `security` — `npm audit`, secret scan.
- `dast`.
- `perf-smoke`.
- `dependency-review` — pull requests only.
- `container-scan`.
- `deploy-rehearsal`.
- `codeql` — `continue-on-error: true`, D-012.
- `package` — push to main.
- `staging-rehearsal`.

A second workflow, `perf.yml`, runs the nightly and weekly load.

**Required checks.** `RELEASE.md` §2 names `verify` and `security` as the intended required checks. GitHub reports `protected: false` for every branch, `main` included (`list_branches`, 2026-11-24). D-010 says rulesets are not enforced on this private repository on the free plan.

**Status: Verified (unprotected).** The plan restriction itself was not checked: the repository settings are not readable from here.

**CI has not passed since 2026-10-31 (AUD-DEF-001, High).** From the GitHub Actions run list (evidence `audit-reports/evidence/github-actions-runs.json`):

- **Last successful run:** #12, 2026-10-31.
- **Later 124 completed runs:** failure or cancelled, none succeeded.
- **Runs 13–36:** cancelled after about 20 minutes, which is the `verify` job's `timeout-minutes: 20`. The full regression (≈90 minutes of unit tests here, plus E2E) cannot finish inside it.
- **From 2026-11-16 (82 of the last 84 failures):** every job fails within 3–4 seconds and GitHub has no log for it (`get_job_logs` → HTTP 404). The jobs never started.

The cause of the start failure is **Not Verified**. A plan or billing limit on Actions minutes is the usual reason, but the account settings are not readable from here.

The completion reports' claims that "CI runs the gate" are therefore unproven for every part after 02.07. The gate was run locally (this session's full regression passed 1,736 of 1,736).

## 8. Documentation claims recorded for later phases

| Document | Claim | Tested in |
|---|---|---|
| `THREAT_MODEL.md` | 278 API routes, each declared; "there is no socket server yet (D-109)" | Phase 5. The route count is now 5,186 (`erp:route-check`) and a socket server exists (`platform/realtime/socket.js`), so the threat model is out of date (AUD-DEF-006). |
| `THREAT_MODEL.md` | Append-only audit triggers, hash chain, CSP, CORS, CSRF, rate limits, export approval, SoD | Phase 5 |
| `SECRETS.md` | Secrets only from the environment; staging and production refuse to start without them; rotation procedures | Phase 5 |
| `RELEASE.md` §4 | "The server refuses to start with `NODE_ENV=staging` or `production` until the IAM module exists (D-001)" | Phase 5 (IAM exists now; the sentence is stale) |
| `RELEASE.md` §1 | `erp:regression` is the gate on every pull request | Contradicted in practice: CI has not completed since 2026-10-31 (§7) |
| `DECISIONS.md` ADR-1, ADR-14 | SQLite, integer money | Phase 4 |
| `D-011` / 29.06 | Backups verified, restore tests | Phase 4 (`db:rehearse` on a scratch copy) |

`docs/erp/PHASED_WORKFLOW.md`, named by the audit prompt, does not exist. The gates are G1–G8 in PROGRESS.csv and `docs/erp/GATES/` (G1–G4 only).

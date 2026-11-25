# 05 — Security and access control (Phase 5)

Commit `ed225efd`. Every "Verified" below was executed in this session on scratch data, or comes from a test that passed in this session's full regression (1,736 of 1,736, `node --test tests/*.test.js`, 2026-11-23). No secret value is reproduced. Evidence is in `audit-reports/evidence/p5-*.log`.

## 1. Findings by severity

| ID | Severity | Finding | File:line | Evidence |
|---|---|---|---|---|
| AUD-DEF-007 | **High** | The deploy scripts start the server with `AUTH_MODE: 'dev-headers'` hard-coded and `NODE_ENV` defaulting to `test`, while `ERP_ENVIRONMENT` is set to the environment name. `npm run deploy -- --env production` (the path RELEASE.md §4 documents) would start a server that trusts the `X-Erp-*` identity headers and reports itself as `production`. The configuration guard refuses `dev-headers` only when `NODE_ENV` is `production` or `staging`, not when `ERP_ENVIRONMENT` is. | `scripts/lib/deploy.mjs:59-63`, `scripts/lib/bluegreen.mjs:41`, `scripts/deploy.mjs:31`; guard `src/server/platform/config/index.js:40-75` | `p5-config-refusal.log`: `NODE_ENV=test, ERP_ENVIRONMENT=production + dev-headers` → **ACCEPTED** (`environment=production authMode=dev-headers`). Mitigation: the container path is safe (`Dockerfile:13` sets `NODE_ENV=production`; `infra/environments/production.env` sets `AUTH_MODE=iam`), and no production host exists (D-009). |
| AUD-DEF-012 | **High** | **Cross-company leak of employee data.** `GET /api/v1/hr/performance/team/:id` returns the name, employee code, designation and department of an employee of another company. `canSee` returns true for a role that sees all of its company's people without checking that the employee belongs to the actor's company; `member` then builds the dashboard from the raw id. | `src/server/modules/hr/performance.js:124` (`canSee`), `:521-524` (`member`) | `p5-cross-company-probe.log`: company 193 (new, empty) read employees 1–3 of other companies (company 17 and others) |
| AUD-DEF-013 | Medium | **Cross-company leak of configuration history.** `GET /api/v1/hr/expenses/policies/:id/history` reads `core_audit_log` for any policy id without checking the policy's company. It returns who created and activated another company's expense policy and its values. | `src/server/modules/hr/expenses.js:128-130` | `p5-cross-company-probe.log` |
| AUD-DEF-001 | **High** | CI has not completed a run since 2026-10-31, so none of the documented automated checks (`verify`, `security`, `dast`, `container-scan`, CodeQL) protects `main`. Branches are unprotected. | `.github/workflows/ci.yml` | `evidence/github-actions-runs.json`; see 01-repository-inventory §7 |
| AUD-DEF-008 | Medium | The sensitive-permission review is self-certified. `scripts/permission_audit.mjs --write-baseline` rewrites `PERMISSION_BASELINE.json` from the role templates, and the same commits that add a grant regenerate the baseline (27 commits touch it; 6 in this session alone). No reviewer is recorded, and with CI not running and branches unprotected nothing independent checks the change. `PERMISSION_EXCEPTIONS.json` is empty. | `scripts/permission_audit.mjs:6,16` | `git log -- docs/erp/PERMISSION_BASELINE.json` |
| AUD-DEF-009 | Medium | D-002 is only partly resolved. A feature-flag change is maker-checker only once the Enterprise Control Center is on for the company. With it off (the default), one SYSADM changes a flag directly (audited). D-002 is still "Open" with target 04.01, a part marked Ready for review. | `src/server/modules/core/feature-flags/service.js:88-90` | code reading |
| AUD-DEF-010 | Low | A real PDF carrying a JavaScript `OpenAction` is accepted (status PENDING scan). The type check is by content and passes; the built-in scanner does not look for active content. Files are opened through the in-app viewer (`pdfjs-dist`), which does not run document JavaScript, and through signed download links. | `src/server/platform/files/scan.js` | `p5-upload-probe.log` |
| AUD-DEF-006 | Low | THREAT_MODEL.md is out of date. It describes 278 routes (5,186 now) and "no socket server yet", while `platform/realtime/socket.js` exists. Its planned review ("when 04.06 real-time … is built") did not happen. | `docs/erp/THREAT_MODEL.md` | `12-route-check.log` |
| D-003 (confirmed) | Low | `core_feature_flags.company_id` and `project_id` have no foreign key. | migrations | `PRAGMA foreign_key_list(core_feature_flags)` → `[]` on a fresh migrated database |
| D-012 (confirmed) | Low | CodeQL is `continue-on-error: true`. In practice no CI job has started since 2026-11-16. | `ci.yml:174-178` | — |

## 2. Checks that held

| # | Area | Result | Evidence |
|---|---|---|---|
| 1 | Passwords | Argon2id from `node:crypto` (`$argon2id$v=19$m=…`), password history and breached-password check | `src/server/platform/identity/password.js:1-25`, `iam/auth.js:185-188`; iam tests passed |
| 1a | Sessions | Refresh token in an `HttpOnly; SameSite=Strict` cookie scoped to the sign-in path, `Secure` in staging and production; rotation and reuse detection; lockout counters reset by admin | `iam/routes.js:23-29,65,80`; `iam/admin.js:206`; auth tests passed |
| 2 | dev-headers refused by configuration | Refused for `NODE_ENV=production` or `staging`, with `AUTH_MODE` unset (defaults to dev-headers) and for a mistyped value. `NODE_ENV` itself is required. **Gap:** AUD-DEF-007. | `p5-config-refusal.log` |
| 3 | Permission audit | 117 sensitive permissions, every holder in the baseline; no exceptions. Process gap: AUD-DEF-008. | `13-permission-audit.log` |
| 4 | Company scope | **Two leaks found (AUD-DEF-012, AUD-DEF-013); the rest held in the probe.**<br>• Tests: 139 test files assert cross-company refusal (207 assertions); `tests/*-scope.test.js`, `bi-leakage.test.js` and the 30.05 authorisation matrix passed. They did not catch the two leaks.<br>• Probe (`p5-cross-company-probe.log`, script `p5-cross-company-probe.mjs.txt`): on a copy of the E2E database (192 companies), a new company holding every internal role asked every detail route with one `:id` for ids 1–3, and every parameter-less list route.<br>• Detail routes: 30 answers of 200 on 10 routes. 8 routes are legitimate (installation-wide templates, rules and system jobs, or empty answers); 2 are leaks.<br>• List routes: none returned rows.<br>• Limits: routes with two or more parameters, ids above 3, and lists that need a parameter were not probed. | regression; probe |
| 5 | SoD: approver ≠ submitter through the API | The approval engine refuses the requester (`src/server/platform/approvals/index.js` `act`: "You raised this request, so someone else must approve it"). It also refuses the same person on two steps. Exercised through the API by `sod-api`, `workflow-*`, `ops-devops`, `man-manuals` and `golive` tests (all passed). | regression |
| 6 | CSRF and headers | CSRF guard for cookie-authenticated routes. CSP `default-src 'self'; script-src 'self'`, `frame-ancestors` required by the settings schema, `X-Frame-Options: DENY`, `nosniff`, COOP/CORP, HSTS on HTTPS or production, `Cache-Control: no-store` on the API. Helmet is not used; the headers are written by `platform/security/headers.js`. | `headers.js:12-30`, `settings.js:5,34`; `security-api` tests passed |
| 7 | Rate limiting | Per-address before routing, per-person after authorisation, by class (`read`/`write`/`export`); sign-in routes have their own limiter. Counts are in process memory (D-107). | `app.js:60,152`; `iam/routes.js:21-25` |
| 8 | Injection | No string-built SQL from request values found in the sample (see 04 §11). | 04-database-api.md |
| 9 | XSS | 9 raw-HTML sinks in the client, all reviewed:<br>• 6 render server-generated QR SVGs (`qrcode` output, no user text);<br>• the policy reader renders `bodyHtml` that the server sanitises with an allow-list (`pol/richtext.js:10-34`, tested: scripts, handlers and `javascript:` links removed);<br>• the policy editor sets `innerHTML` from that same stored, sanitised value (`pol/RichText.jsx:8`);<br>• the rate-analysis print writes server HTML that escapes every field (`mdm/rates.js` `e(...)`).<br>React escapes everything else. | `grep` of `src/client` |
| 10 | File uploads | Content (magic number) checks refuse an HTML page as `.pdf`, an SVG with script as `.png`, a ZIP as `.jpg`, a Windows program as `.xlsx`, an ELF program as `.docx`, and a double extension `.pdf.exe`. Valid PDFs go to the scan queue. Access follows the linked record (`files.test.js` T-03: no permission 403, another company 404). Gap: AUD-DEF-010. | `p5-upload-probe.log` |
| 11 | Secrets | `npm run erp:secret-scan`: no credentials in tracked files. No `.env` or database file is tracked; `.gitignore` covers `.env`, `data/`, `reports/`. `.env.example` holds placeholders only. The configuration refuses staging or production without `AUTH_SECRET` (with iam), `VAULT_KEY` and `FILE_URL_SECRET`. | `16-secret-scan.log`, `p5-config-refusal.log` |
| 12 | Logs | Redaction verified on a sign-in body (omitted), a bearer token and JWT, and a payment message (account number, IFSC and PAN masked to the last characters). User IDs in logs are pseudonyms. | `p5-log-redaction.log`; `platform/observability/redact.js`, `context.js:19-22` |
| 13 | WorkChat privacy | `tests/messages-scope.test.js` and `secure-messaging` tests passed (room membership on join and per event). Not probed separately. | regression |
| 14 | Audit completeness | Security events cover sign-in success and failure, lockouts and token reuse (`iam/auth.js:55`). Permission and role changes, flag changes and every approval write audit rows. The audit log is append-only (04 §6). | code reading; `audit-api` tests passed |

## 3. THREAT_MODEL.md claims

| Claim | Status |
|---|---|
| Spoofing a person: password policy, breached check, lockout, captcha, second step for privileged roles, short-lived tokens, rotating refresh with reuse detection, HttpOnly SameSite cookie | **Verified** (code and iam tests). The second step for privileged roles was read in `iam/mfa.js`, not probed. |
| Spoofing a site: CORS allow-list, CSRF header, bearer tokens | **Verified** (headers code; `security-api`) |
| Tampering with requests: Zod everywhere, totals recomputed, company scope, optimistic locking | **Verified by sample** (Zod `.strict()` on the routes read; scope tests passed) |
| Tampering with the audit trail: append-only triggers, hash chain, nightly check | **Verified** (triggers refuse UPDATE/DELETE on a scratch database) |
| Tampering with protections: every route declared, start refused in staging/production for an undeclared route | **Verified** (`route-check`: 5,186 declared) |
| Repudiation: audit entries and security events | **Verified** (code; tests) |
| Information disclosure: deny by default, masks, no stack traces | **Verified by tests** (`authz-api`, `security-api`) |
| Disclosure by export: permission, row limit, approval for bulk personal data | **Verified by tests** (`security-api` FR-08) |
| Disclosure by uploaded file: allow-list, scan, quarantine, signed links | **Verified** (probe) with gap AUD-DEF-010. The real anti-virus (ClamAV) is not connected (D-031). |
| Disclosure of secrets: environment only, AES-256-GCM, CI secret scan | **Partly.** Environment and encryption hold. "CI secret scan" is **Contradicted** in practice: CI does not run (AUD-DEF-001). The scan passes locally. |
| Denial of service: rate limits, body limit, pagination limits | **Verified** (code); counts per process (D-107) |
| Elevation through roles: templates, approved custom roles, SoD, elevation, reviews | **Verified by tests** (`authz-api`, `sod-api`) |
| Elevation through the browser: CSP, no inline script | **Verified** (headers) |
| Elevation through a dependency: npm audit blocks high/critical, dependency review, CodeQL | **Partly.** `npm audit --audit-level=high` passes locally (3 moderate in eslint's `minimatch`). The CI side is **Contradicted**: it does not run. |
| Real-time room checks | **Verified by tests** (`security-api` BR-02) |
| "There is no socket server yet (D-109)" | **Contradicted:** `platform/realtime/socket.js` exists (AUD-DEF-006) |
| Background work runs with the person's grants | **Verified by tests** (`security-api` FR-02) |

## Addendum — dynamic scan

`node scripts/dast_scan.mjs` (the CI `dast` job, run locally with Node 24.22.3): the application in-process on an empty in-memory database, development headers as SYSADM.

- **Requests and surface:** 5,670 requests; 1,091 guarded lists probed with injection payloads in `q`.
- **Checks:** security headers; CORS from a foreign origin; error bodies (stack traces, paths, SQL text); body size limit; path traversal on file routes; sampled 401 when signed out.
- **Result:** **0 findings**, exit 0, 14 s.
- **Evidence:** `evidence/p5-dast.log`, `evidence/p5-dast.json`.

**Limit:** an empty database means the `/:id` reads return 404, so the scan cannot find leaks like AUD-DEF-012. The cross-company probe on a populated copy is what found them.

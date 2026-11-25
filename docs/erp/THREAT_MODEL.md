# Threat model

Part 02.07, FR-07; reviewed 2026-11-25 after the technical audit (AUD-DEF-006) for the platform as built through part 30.10. A model of the platform in STRIDE form, with the control that answers each threat and where it is tested. It is reviewed when a part adds an entry point (a socket server, a mobile sync, a public form) or a trust boundary (a new connector, a payment gateway). OWASP ASVS level 2 is the target; the accepted deviations are in `DECISIONS.md` and `DEFECTS.md`.

## What is protected

People's identities and credentials, the construction, financial and HR records of every company, the approval history and audit trail, connector credentials, and the availability of the system to site teams on weak networks.

## Who and what we trust

- **Not trusted:** the browser and everything it sends (including headers, ids and totals), other websites the user has open, uploaded files, webhook senders until their signature is verified, a person's own claim about their role.
- **Trusted with limits:** signed-in people (only for what their role, scope and elevation allow, checked on every request), administrators (their changes are approved by someone else and audited), connectors (only through the integration hub).
- **Trusted:** the server process and its environment, the database file and the secrets in the environment. Someone with the database file is outside what the application can prevent; the audit chain shows what they change (D-100).

## Entry points

- **The REST API** under `/api/v1`. It has 5,186 routes, each declared in `platform/security/route-policy.js` (`npm run erp:route-check`).
- **The 42 public routes.** They answer without a session:
  - sign-in, second step and password reset;
  - invitations;
  - portal invitation, activation and supplier registration (25.x);
  - token links:
    - approval links (04.03);
    - vendor quotation and purchase-order links (15.x);
    - offer links (07.02);
    - document verification by QR code (04.12);
    - generated files;
  - incoming connector webhooks (signed).
- **The real-time socket server** (`platform/realtime/socket.js`, Socket.IO). An optional Redis adapter is used when `REDIS_URL` is set.
- **The public API for API clients**, with keys, tiers and outgoing webhooks (29.03), and the **business connectors** for banks, Tally, biometrics and telematics (29.02).
- **The offline field sync** of the phone (04.15).
- **The external portals** for suppliers, subcontractors, clients and consultants (25.x).
- **The rest:** signed file links, the health and metrics routes (token or permission), the static client, and the container image (`Dockerfile`).

## Threats and controls

| Threat (STRIDE) | Control | Where tested |
|---|---|---|
| **Spoofing** a person: guessed or stolen password, token theft, a forged token | Password policy and breached-password check, lockout with growing delay, captcha, second step for privileged roles, short-lived signed access tokens, rotating refresh tokens with reuse detection, HttpOnly SameSite cookie for the refresh token, per-address and per-person rate limits on sign-in and second-step routes | `iam-api`, `sod-api`, `security-api` T-02 |
| **Spoofing** a site: a hostile page makes the browser call the API | Strict CORS allow-list (a foreign origin gets no CORS headers and cannot change data), the CSRF header for cookie sessions, bearer tokens in a header (not a cookie) for everything else | `security-api` CORS and CSRF |
| **Tampering** with data in a request: client-supplied totals, ids of another company, mass assignment | Server-side Zod validation on every input (unknown fields rejected), totals recomputed on the server, every query scoped by company (and project or site grants), optimistic locking | each module's API tests |
| **Tampering** with the audit trail | Append-only triggers, a hash chain over every audit row, a nightly check that raises a critical alert, sealed monthly segments | `audit-api` T-02, T-03 |
| **Tampering** with the application's own protections: a route added without a permission | Route policy: an undeclared route stops a staging or production start and fails CI (`erp:route-check`); the Authorise stage refuses a person who holds none of a route's declared permissions before the route runs; the self-test calls every route with no sign-in and no permission | `security-api` T-01, BR-01 |
| **Repudiation**: "I did not do that" | Audit entries with person, address, device, correlation id and old and new values; security events for sign-ins, permission changes, elevations, refused requests and exports; segregation of duties stops one person doing both halves of a control | `audit-api`, `sod-api` |
| **Information disclosure** by an over-broad answer | Deny by default; permission and scope checked in the service; field masks in the API, exports and the audit trail; errors without stack traces or SQL; `Cache-Control: no-store` on API answers; no secret in any answer | `authz-api`, `security-api` |
| **Information disclosure** by an export | `*.export` permission, a row limit, an approval for bulk exports of personal data that can be used once, formula neutralisation, every export in the audit trail and the security log | `security-api` FR-08 |
| **Information disclosure** by an uploaded file | Document service: type allow-list, size limit, virus scan, quarantine, signed short-lived links | `files` |
| **Information disclosure** of secrets | Secrets only in the environment; AES-256-GCM for stored credentials; CI secret scan; rotation procedures | `secret_scan`, `security-api` FR-05, `docs/erp/SECRETS.md` |
| **Denial of service**: floods, expensive requests | Per-address and per-person rate limits by class (stricter for sign-in, second step and exports), a request body limit, pagination limits, large exports refused (they belong in jobs), job retry with back-off | `security-api` T-02 |
| **Elevation of privilege**: a role that grants too much, a person who holds both halves of a control, standing admin rights | Role templates and an approved change process for custom roles, scoped assignments, segregation-of-duties rules at assignment and at action, time-boxed elevated access with an approver chain, quarterly access reviews, dormant account suspension | `authz-api`, `sod-api` |
| **Elevation of privilege** through the browser: script injection | A content security policy that allows only this application's scripts, output encoding by React, no inline script, `frame-ancestors 'none'` | `security-api` headers, `e2e/security.spec.js` T-03 |
| **Elevation of privilege** through a dependency | `npm audit` (high and critical block), dependency review on pull requests, lock file, CodeQL | CI |
| **Real-time**: a socket joins a room it may not see, or keeps receiving after losing access | Permission checked on join and again for each member on every event; a refused join is a security event | `security-api` BR-02 |
| **Information disclosure** across companies: a record read by its id from another company | Every read of a record by id is scoped to the caller's company in the service; `npm run erp:scope-probe` asks every `/:id` and list route as a new company on a copy of the E2E database (a regression stage and a CI step); it found and now guards the three leaks of the audit (D-819, D-820) | `scope_probe`, `performance` and `expenses` BR-SCOPE |
| **Spoofing** through the development identity headers on a real installation | The configuration refuses `AUTH_MODE=dev-headers` when `NODE_ENV` or `ERP_ENVIRONMENT` is staging or production; deploys to staging and production start with sign-in (`AUTH_MODE=iam`) unless they are rehearsals (D-821) | `config` BR-AUD-007, `release-env` |
| **Elevation of privilege** through an uploaded document: a PDF that runs a script or a program when downloaded | A scanner that always runs parses each PDF (compressed object streams included) and quarantines one with JavaScript or a launch action; the in-app viewer (pdf.js) does not run scripts | `files` BR-AUD-010 |
| **Denial of service** and misuse by an API client | A key per client (service account with scopes; write scopes need a director's approval), rate tiers of 60, 300 or 1,200 calls a minute, the secret shown once (a hint is kept), calls, errors and throttles counted per day and endpoint, approvals audited | `admin-api-platform` (29.03) |
| **Background work**: a job acting for a person with more rights than they have | Work for a person runs with that person's grants and only while they can sign in | `security-api` FR-02 |

## Known gaps

Recorded in `DEFECTS.md`:

- **D-100, D-107–D-111.** Triggers, not database privileges, keep the audit trail append-only. Rate-limit counts live in one process. The browser sends the CSP policy, but reports (`report-uri`) are not collected.
- **D-108.** A secret rotation needs a (zero-downtime) restart.
- **Single instance.** In-memory state, socket rooms included, assumes one instance unless the Redis adapter is configured.
- **D-031.** No anti-virus (ClamAV) is connected in this environment.
- **D-815.** The container image is defined but has not been scanned here.
- **D-812.** No independent penetration test has been done.

**To verify at the next review.** These were not checked in the 2026-11-25 review:

- the expiry, single use and storage (hashed or not) of the token links: approval, vendor quotation and purchase order, offer;
- the isolation of external portal identities from internal ones.

## Review

Next review: before the first production go-live (with the penetration test, D-812), and when a new public route, connector or portal is added.

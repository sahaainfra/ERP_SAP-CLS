## Part
Part ID and title:

## Summary

## Definition of Done
- [ ] Discovery note written (`docs/erp/DISCOVERY/<part>.md`)
- [ ] Behind its feature flag `ff.<module>.<part>`
- [ ] Every page passes the Page Completion Checklist (standards 9.3)
- [ ] Permissions registered, enforced on the server, tested per role
- [ ] Tests written and passing; `npm run erp:regression` green
- [ ] Migrations additive and reversible; `npm run erp:schema-diff` clean
- [ ] No placeholder, dummy data or console errors
- [ ] `docs/erp/DB_CHANGES.md`, OpenAPI and `PROGRESS.csv` updated
- [ ] Completion report written (`docs/erp/COMPLETION/<part>.md`)

## Secure coding checklist (OWASP ASVS level 2)
- [ ] Every new route is declared in `src/server/platform/security/route-policy.js` (a permission, own account, record rules or public with its proof); `npm run erp:route-check` passes
- [ ] Authorisation is checked in the service as well as at the route; data is scoped by company, project and site
- [ ] All input is validated on the server (Zod); SQL is parameterised; output is encoded; no `eval` or string-built queries
- [ ] Sensitive fields are masked in the API, exports, logs and the audit trail
- [ ] Changes, approvals, exports and prints are written to the audit trail with old and new values
- [ ] No secret, key or token in code, tests, logs or the browser; configuration comes from the environment (`docs/erp/SECRETS.md`)
- [ ] Exports use `iam.*.export`-style permissions, neutralise formulas and are logged; bulk exports of personal data need approval
- [ ] A new third-party dependency was checked (licence, maintenance, known issues) and is pinned by the lock file
- [ ] New headers, CORS origins or limits were changed through Security Settings, not in code

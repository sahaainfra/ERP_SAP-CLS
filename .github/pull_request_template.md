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

# DEFECTS

Register of known gaps. Severity: Critical, High, Medium, Low. The scan output of the discovery script is in `docs/erp/DISCOVERY/DEFECTS.md`.

| ID | Area | Description | Severity | Cause | Owning part | Status |
|---|---|---|---|---|---|---|
| D-001 | Auth | Authentication and roles are a development adapter: `AUTH_MODE=dev-headers` trusts `X-Erp-*` request headers, and role permissions are a constant in `src/server/auth.js`. `config.js` refuses it in staging and production, so the app cannot run in production until IAM exists. | High | IAM, roles and permissions tables are parts 02.x | 02.05, 02.07 | Open |
| D-002 | Flags | Flag changes are not maker-checker approved; one SYSADM can change a flag. They are audited (`core_audit_log`) and the reason is mandatory. | Medium | Workflow engine is part 04.01 | 04.01 | Open |
| D-003 | Flags | `company_id` and `project_id` have no foreign keys. | Low | Organisation tables are part 02.02 | 02.02 | Open |
| D-004 | UI | Admin page has English labels only, no Hindi, and is not inside the final application shell or navigation registry. The shell here is a minimal bar. | Low | Design-system shell and i18n are parts 03.x | 03.01 | Open |
| D-005 | CI | The workflow `.github/workflows/ci.yml` is written but has never run on GitHub: the repository is not pushed and `gh` is not signed in. Its behaviour is unverified there. | Medium | No remote run yet | 00.03 | Open |
| D-006 | API docs | No OpenAPI document is generated; `docs/erp/openapi.yaml` is maintained by hand for the five endpoints and not contract-tested. | Low | Contract-testing arrives with the API conventions part | 01.01 | Open |
| D-007 | Performance | List-query timing on 100k rows and `EXPLAIN` checks were not run: the flags table is small by nature and SQLite replaces PostgreSQL. | Low | Decision to use SQLite; see DECISIONS.md | 00.03 | Open |
| D-008 | Flags | The page does not hide itself when `ff.prog.p0002` is OFF, because administrators must still reach it to turn flags back on. The flag is evaluated and shown on the page; gating of navigation entries arrives with the shell. | Low | Navigation shell is part 03.x | 03.01 | Open |
| D-009 | Deploy | No staging or production host exists. Deploy, backup, smoke-test and rollback are rehearsed on a directory-based environment on one machine, and production promotion with manual approval is not wired. The server also refuses `NODE_ENV=staging` or `production` until IAM exists (D-001). | High | Hosting target not chosen; depends on D-001 | 00.03, 02.07 | Open |
| D-010 | Pipeline | Branch protection (no direct push to main, one reviewer, required checks) is not configured; `CODEOWNERS` and the exact `gh api` command are in place. "A pull request with a failing test is blocked" is proved only by the regression command exiting 1. | Medium | Needs a pushed repository and an admin sign-in | 00.03 | Open |
| D-011 | Backup | The pre-deploy restore point is a local file next to the database; there is no off-machine copy and no scheduled backup. | Medium | Hosting and backup service not chosen | 00.03 | Open |
| D-012 | Security | CodeQL (static analysis) is configured but has never run. `npm audit` was run once locally on 2026-10-30: 0 vulnerabilities. The secret scanner is a built-in pattern list, not a full scanner. | Low | No remote run yet | 00.03 | Open |
| D-013 | Release | No release has been cut and no commit carries a `Release-note:` line yet, so user-facing release notes are empty. Coverage threshold is 60 % (target 80 %); client code has no line-coverage gate. | Low | First release not yet decided | 00.03 | Open |

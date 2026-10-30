# DEFECTS

Register of known gaps. Severity: Critical, High, Medium, Low. The scan output of the discovery script is in `docs/erp/DISCOVERY/DEFECTS.md`.

| ID | Area | Description | Severity | Cause | Owning part | Status |
|---|---|---|---|---|---|---|
| D-001 | Auth | Authentication and roles are a development adapter: `AUTH_MODE=dev-headers` trusts `X-Erp-*` request headers, and role permissions are a constant in `src/server/auth.js`. `config.js` refuses it in staging and production, so the app cannot run in production until IAM exists. | High | IAM, roles and permissions tables are parts 02.x | 02.05, 02.07 | Open |
| D-002 | Flags | Flag changes are not maker-checker approved; one SYSADM can change a flag. They are audited (`core_audit_log`) and the reason is mandatory. | Medium | Workflow engine is part 04.01 | 04.01 | Open |
| D-003 | Flags | `company_id` and `project_id` have no foreign keys. | Low | Organisation tables are part 02.02 | 02.02 | Open |
| D-004 | UI | Admin page has English labels only, no Hindi, and is not inside the final application shell or navigation registry. The shell here is a minimal bar. | Low | Design-system shell and i18n are parts 03.x | 03.01 | Open |
| D-005 | CI | `npm run erp:regression` runs locally only; there is no CI pipeline, so AC-01 "locally and in CI" is half met. | Medium | CI/CD is part 00.03 | 00.03 | Open |
| D-006 | API docs | No OpenAPI document is generated; `docs/erp/openapi.yaml` is maintained by hand for the five endpoints and not contract-tested. | Low | Contract-testing arrives with the API conventions part | 01.01 | Open |
| D-007 | Performance | List-query timing on 100k rows and `EXPLAIN` checks were not run: the flags table is small by nature and SQLite replaces PostgreSQL. | Low | Decision to use SQLite; see DECISIONS.md | 00.03 | Open |
| D-008 | Flags | The page does not hide itself when `ff.prog.p0002` is OFF, because administrators must still reach it to turn flags back on. The flag is evaluated and shown on the page; gating of navigation entries arrives with the shell. | Low | Navigation shell is part 03.x | 03.01 | Open |

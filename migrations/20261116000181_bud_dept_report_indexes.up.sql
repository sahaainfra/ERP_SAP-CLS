-- Part 12.04: covering indexes of the department budget report, found by the 100 000-row timing (scripts/bud_dept_perf.mjs): the actuals of a year and the lines of the budgets in force are read from the index alone.
CREATE INDEX IF NOT EXISTS ix_bud_dept_actuals_report ON bud_dept_actuals (company_id, fy_id, status, period_id, cost_centre_id, account_id, amount, deleted_at);
CREATE INDEX IF NOT EXISTS ix_bud_dept_lines_report ON bud_dept_lines (budget_id, period_id, account_id, amount, deleted_at);

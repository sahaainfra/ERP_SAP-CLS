# Runbook: support payroll day

**When:** the payroll run and the payment file day (24.x), and the two days after for payslips and queries.

1. No deploy from the day before the run until the payment file is accepted by the bank.
2. A verified backup before the run is approved; another before the payment file is generated.
3. On call: L2 with the payroll owner (HRMGR) and the finance approver (CFO) reachable; the bank connector's contact from the connector register.
4. Watch: the payroll run job, the payslip generation job (asynchronous above the parameter `pay.payslip.async_count`), the notifications queue.
5. A failed bank upload is retried from the payment page with the same file (idempotent); never edit the file by hand.
6. After: confirm the payroll ledger posting (Reconciliation Health, check PAYROLL_GL) and close the support window.

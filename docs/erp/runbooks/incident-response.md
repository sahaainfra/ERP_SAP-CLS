# Runbook: respond to an incident

**Severities:** S1 the service is down or data is wrong for everyone; S2 a module is unusable or slow for many; S3 a defect with a workaround. **Paging:** critical alerts page the on-call L2 at once (app, SMS, e-mail); warnings go to L1; a page not acknowledged in 15 minutes escalates (L1 → L2 → L3). The rota is on **Operations → On call**.

1. **Acknowledge** the page on the Operations page (it stops the escalation and acknowledges the alert).
2. **Assess** in 10 minutes: what is affected, since when (alerts, the request log by correlation ID, the last deployment). Decide the severity.
3. **Mitigate first:** a bad deploy → **rollback.md**; overload → **scale.md**; data damage → read-only mode and **restore.md**; a security event → also tell the security lead (Security Findings).
4. **Communicate:** S1/S2 — an announcement to users within 30 minutes and every hour after; the business owners of the affected module by phone.
5. **Resolve and verify:** the alert resolves; the smoke test and, for data, the reconciliation suite are green.
6. **Review** within five working days (S1/S2): timeline, cause, what changes; defects into DEFECTS.md and the Security register where they belong.

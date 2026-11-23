# Support model and operational SLAs

| Level | Who | Does | Hours |
|---|---|---|---|
| L1 | The help desk (hd, 29.08) and the IT administrators of the company | Takes tickets and warnings, answers how-to questions from the help articles, resets access, gathers the correlation ID | Working days 08:00–20:00 IST |
| L2 | DevOps / IT administration (ITADM) on the rota | Alerts, incidents, deploys and rollbacks, restores, scaling, data corrections through the module owners | On call 24 × 7 |
| L3 | The development team (vendor) | Defects in the code, performance fixes, security fixes | On call for S1; working days otherwise |

| Severity | Response (acknowledge) | Restore service / workaround | Resolution |
|---|---|---|---|
| S1 — down, or wrong data for everyone | 15 minutes, 24 × 7 | 2 hours | Next deploy window |
| S2 — a module unusable or slow for many | 30 minutes in support hours | 8 hours | Within 5 working days |
| S3 — a defect with a workaround | 1 working day | — | Planned release |
| Request (access, report, data correction) | 1 working day | — | 3 working days |

**Availability:** 99.5 % a month in business hours (excluding announced windows). **Recovery:** RPO 15 minutes, RTO 4 hours (29.06). **Escalation:** a page not acknowledged within `ops.oncall.ack_minutes` (15) goes to the next level. **Reporting:** the monthly service review (availability, incidents, SLA met, open defects) goes to the CFO and the director.

# Runbook: scale the service

**Signals:** alerts *ErpSlowLists* (p95 above 800 ms for 10 minutes), *ErpMemoryHigh*, *ErpJobsBacklog*, *ErpDiskLow*; the nightly load run on the Performance page.

1. **Short term (minutes):** add the second API process to the active slot (`docker compose up -d --scale blue=2`); nginx balances them. SQLite in WAL serves several readers; writes queue on the busy timeout.
2. **Background work:** if the backlog is jobs or the attendance register, move the workers to their own process (CAPACITY_PLAN §3) and keep the API processes for requests.
3. **Memory:** an API process holds about 730 MB at peak under the full load; the limit is 1 GB. Above that, restart the slot in turn (deploy the same build to the idle slot and switch), and report the leak with the soak result.
4. **Disk:** keep three times the database size free for backups. Expand the volume or move old backups off the host (retention: 14 daily, 8 weekly, 12 monthly, 7 yearly).
5. **Beyond one host:** at about 300 writes a second sustained, plan the move to a server database; until then a larger host.
Record what was done in the incident or change record.

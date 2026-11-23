# Runbook: restore the database

**Who:** DevOps (ITADM) executes; a production restore needs a documented incident and the approval of ITADM then a director (29.06, BR-01). **Backups:** daily full copy and a snapshot every 15 minutes, verified and copied encrypted off the host (29.06).

1. Declare the incident (**incident-response.md**) and put the company in read-only mode (**Administration → Control Center → Emergency**).
2. **Administration → Backups & Recovery**: choose the recovery point (the latest verified snapshot before the damage), request the restore with the incident number.
3. After the approvals, execute it: the service makes a safety copy of the current database, restores the point, runs the integrity check and the table counts, and restarts the slots.
4. Check: the about page, a few known records, the reconciliation suite (**Reconciliation Health → Run**).
5. Lift read-only mode; tell the users (announcement) what period of entries must be re-done, from the audit trail of the gap.

Rehearsed every quarter by the restore drill (`npm run db:rehearse`): the drill must restore within the RTO with data loss within the RPO.

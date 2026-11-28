# Schedule exchange sample files (PACK-21)

Sample files for the schedule exchange of part 13.03 (`src/server/modules/plan/exchange.js`), used by `tests/plan-exchange.test.js`.
All the data is illustrative: there is no real project, person or company in them.

| Format code | Format | Read (import) | Written (export) | Sample |
|---|---|---|---|---|
| `MSP_XML` | MS Project XML (MSPDI) | yes | yes; with `ff.plan.pack21` the current approved baseline is written as baseline 0 | `tower.msp.xml`, `errors.msp.xml` |
| `P6_XML` | Primavera P6 XML (APIBusinessObjects) | yes | yes, with no baseline (a P6 baseline is a separate project: D-876) | `tower.p6.xml` (written by this application from `tower.msp.xml`) |
| `P6_XER` | Primavera P6 XER (tab-separated tables) | yes | **no**: XER is import only (D-876) | `tower.xer` |

What survives a round trip (import → edit → export → re-import):
- **Ids.** The activity codes: MS Project Text1, or P6 Activity Id / XER `task_code`. File UIDs and ObjectIds are written afresh on every export, and the code is the identity.
- **Calendars.** The work week, the hours of a day, holidays and worked exceptions.
- **Relationships.** FS, SS, FF and SF, with their lags in working days.
- **Constraints.** Start no earlier than and finish no later than. Harder P6 constraints are read as the nearest of these, with a warning.
- **WBS.** WBS nodes, matched by code.
- **Baselines.** In MS Project XML only. A baseline read from a file is a reference shown in the import report. It never becomes an approved baseline here; baselines are prepared and approved in the application.

`errors.msp.xml` has one mapping problem per row: a duplicated code, a task with no code, a task with no name, a task too long, and a link to
a task that is not in the file. Each one is reported against its row.

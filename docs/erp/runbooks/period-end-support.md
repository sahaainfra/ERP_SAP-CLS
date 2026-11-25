# Runbook: support the month-end close

**When:** the last three working days of the month and the first five of the next (the monthly close of 27.07, GST returns, the trial balance).

Before (the 25th):
1. No deploy from two working days before the month end until the close is signed, except an emergency fix approved by the CFO.
2. A verified backup taken the evening before the close starts; the restore drill of the quarter done.
3. L2 on the rota with the finance module owner's phone; L3 from the vendor on call.

During:
- Watch the month-end reports on the Performance page (report p95 under 3 s) and the jobs backlog.
- Period-lock errors are business rules, not incidents: point the user to the close checklist.
- A snapshot before each closing step that cannot be undone (posting the period, freezing the P&L).

After: the close signed, normal deploy windows reopen; any incident reviewed with the CFO.

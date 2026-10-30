# 06 — Role Catalogue

Roles are **seeded templates** (created in 02.04). System originals are locked; administrators create editable copies. A user can hold different roles on different projects. Every role has: purpose, department, reporting line, data scope, permitted modules, approval authority (from `07_APPROVAL_WORKFLOW_REFERENCE.md`) and SoD restrictions. Role codes below are used in every prompt.

## A. Head-Office roles (owner-defined)

| Code | Role | Default data scope | Main responsibilities | Typical approval authority |
|---|---|---|---|---|
| SYSADM | System Administrator | Company (configuration only) | Users, roles, configuration, workflows, integrations | Configuration changes (maker-checker with ITADM) — no business approvals |
| ITADM | IT Administrator | Company (technical) | Devices, backups, integrations health, security events | Technical changes; no business data access by default |
| DIR | Director | All companies / company | Strategic decisions, final approvals above limits | Highest band on all financial documents |
| CFO | Chief Financial Officer | Company | Finance, treasury, payments, tax, close | Payments, budgets, journals above Accounts Manager limit |
| ACCMGR | Accounts Manager | Company / branch | Ledgers, AP/AR, bank, GST/TDS, close tasks | Journals, vendor bills, payment proposals within band |
| PROCMGR | Procurement & Stores Manager | Company | Procurement policy, vendors, POs, central stores | PRs/POs within band, CS approval, vendor approval |
| COMMGR | Commercial Manager | Company / assigned projects | Contracts, variations, claims, billing, CVR | Client bills, subcontract WOs/bills, variations within band |
| HRMGR | HR & Administration Manager | Company | Employees, recruitment, attendance policy, payroll inputs | Leave (escalated), regularisation, offers, F&F, HR letters |
| QCMGR | Quality Control Manager | Company | QMS, ITPs, NCR closure policy, lab | NCR closure (major), ITP approval, material approval |
| PCMGR | Project Controls Manager | Company / assigned projects | Budgets, schedules, EVM, forecasts, MIS | Budget revisions (recommend), baseline approval, forecast publish |

## B. Site-Office roles (owner-defined)

| Code | Role | Default data scope | Main responsibilities | Typical approval authority |
|---|---|---|---|---|
| PD | Project Director | Assigned projects | Overall delivery of a group of projects | High band on project documents |
| PM | Project Manager | Assigned project | Project delivery, approvals at project level | Mid band PR/PO/WO, DPR approval, WA approval, MB verification |
| CM | Construction Manager | Assigned project / sites | Execution, work fronts, resources | WA approval, DPR review, material requests |
| SE | Site Engineer | Assigned sites | DPR, measurements, material requests, RFIs | Raises; approves nothing above own work |
| CSUP | Civil Supervisor | Assigned sites / work fronts | Daily execution, crew instructions | Labour attendance confirmation for own crew |
| WSUP | Workforce Supervisor | Assigned crews | Crew attendance, deployment, labour issues | Crew attendance verification, first-level regularisation |
| PMSUP | Plant & Machinery Supervisor | Assigned sites / equipment | Equipment allocation, log books, fuel, maintenance | Log book verification, fuel issue approval within band |
| SK | Storekeeper | Assigned stores | GRN, issues, returns, transfers, stock counts | Confirms receipts/issues; no financial approval |
| PROCIC | Procurement In-charge (site) | Assigned project | Local purchases, RFQs, follow-ups | Local purchase within small band |
| SACC | Site Accountant | Assigned project | Site cash, imprest, vendor bill intake, payroll inputs | Imprest vouchers within band, bill verification |
| QCE | Quality Control Engineer | Assigned sites | Inspections, tests, NCRs | Inspection acceptance, minor NCR closure |
| HSEE | HSE Engineer | Assigned sites | Permits, inspections, incidents, toolbox talks | Permit-to-work issue, HSE observation closure |
| SUBCO | Subcontractor Coordinator | Assigned project | Subcontractor compliance, labour strength, bills intake | Verifies subcontractor measurements first level |

## C. Supporting internal roles

| Code | Role | Scope | Purpose |
|---|---|---|---|
| SUPADM | Super Admin | Platform | Break-glass administration; every action audited and maker-checked |
| AUD | Internal Auditor | Company (read-only) | Read-only access to records, audit trail, reports |
| BD | Business Development Executive | Company | Leads, opportunities, client relations |
| EST | Estimation & Tender Manager | Company | Tenders, estimates, rate analysis |
| QS | Quantity Surveyor / Billing Engineer | Assigned projects | Measurement, BOQ reconciliation, RA bills, subcontract bills |
| PLAN | Planning Engineer | Assigned projects | Schedules, look-ahead, progress, delay records |
| DOC | Document Controller | Assigned projects | Drawing register, transmittals, correspondence |
| DESIGN | Design Coordinator | Assigned projects | RFIs, submittals, engineering deliverables |
| FINEX | Accounts Executive | Company / branch | Voucher entry, reconciliations, AP/AR processing |
| PAY | Payroll Officer | Company | Payroll processing, statutory returns |
| HSEO | HSE Officer | Assigned sites | HSE inspections, inductions, PPE |
| SECMGR / SECSUP / GUARD | Security Manager / Supervisor / Guard | Company / site / post | Guard deployment, gate, visitors, patrols |
| PLANTMGR | Plant & Equipment Manager (HO) | Company | Fleet, hiring, maintenance policy |
| STOREMGR | Store Manager (central warehouse) | Assigned warehouses | Central stores operations |
| EMP | Employee (self-service) | Own records | Attendance, leave, payslips, claims, tasks, messages |

## D. External roles (portals, M25)

| Code | Role | Scope |
|---|---|---|
| X-SUP | Supplier user | Own company's RFQs, quotations, POs, deliveries, invoices, payments |
| X-SUB | Subcontractor user | Own work orders, measurements, bills, compliance, labour |
| X-CLI | Client representative | Own projects: progress, bills for certification, approvals, documents shared with client |
| X-CON | Consultant / Engineer | Assigned projects: RFIs, submittals, inspections, drawings, bill verification |

## E. Standard segregation-of-duties rules (seeded, configurable)

| Rule | Conflicting duties |
|---|---|
| SOD-01 | Create and approve the same document |
| SOD-02 | Create/edit vendor master (incl. bank details) and release payment to that vendor |
| SOD-03 | Post a journal and approve its reversal |
| SOD-04 | Record GRN and approve the vendor invoice for the same PO |
| SOD-05 | Enter attendance and approve payroll for the same period and site |
| SOD-06 | Prepare a measurement and certify the same measurement |
| SOD-07 | Raise a PR and approve the PO resulting from it (above a configured value) |
| SOD-08 | Maintain approval matrix and approve documents governed by it |
| SOD-09 | Physical stock count and approval of the resulting stock adjustment |
| SOD-10 | Assign roles/permissions and hold approval authority on finance documents |

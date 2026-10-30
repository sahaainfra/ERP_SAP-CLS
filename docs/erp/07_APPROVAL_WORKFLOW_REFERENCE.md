# 07 — Approval Workflow & Authority Reference

All approvals in the ERP run on **one workflow engine** (04.01) configured through **one approval matrix** (04.02). This document gives (A) the common approval behaviour, (B) the default authority bands seeded on day one, and (C) every approval-controlled document type in the ERP with its default chain, as specified in the development prompts. **All amounts, levels and roles are configuration — change them in the approval matrix, never in code.**

## A. Common behaviour for every approval-controlled document

| Feature | Behaviour |
|---|---|
| Submission | Only complete, valid records can be submitted; the engine resolves the chain from the matrix using company, project, department, document type, amount, category and risk flags. |
| Actions per step | Approve · Reject (reason mandatory) · Return for correction (to originator or chosen earlier step, reason mandatory) · Request clarification · Delegate · Comment · Attach. |
| Sequential / parallel | Steps run in sequence; a step may contain parallel approvers with "all must approve" or "any one" rules. |
| Conditional steps | Added when conditions hold (e.g. Finance review if advance > 10 %, Director if budget overrun). |
| Authority limits | Per role, per document type, per company/project, in INR; an approver above their limit is skipped to the next eligible level. |
| Maker-checker / SoD | Originator can never approve their own document; SoD rules in `06_ROLE_CATALOGUE.md` §E are enforced. |
| Delegation | Time-boxed (from/to dates), scope-limited, cannot exceed the delegator's limit, fully audited; delegate's actions show "on behalf of". |
| SLA & escalation | Each step has an SLA in working hours (default 24 h; payments 8 h; site safety 2 h). Reminder at 50 %, escalation to next level at 100 %, second escalation to Director at 200 %. |
| Resubmission | Returned documents keep history; resubmission restarts from the configured step (default: the step that returned it). |
| Locking & amendment | Approved records are locked. Amendment creates a new version with a side-by-side comparison and its own approval; financial deltas route by delta amount or new total (configurable). |
| Evidence panel | Approver sees budget, committed, available, last rates, vendor history, stock, cash impact and attached documents (04.03). |
| Records | Every action stored with user, role, on-behalf-of, timestamp, comment, attachments, IP/device; optional digital signature (04.12). |
| Notifications | In-app always; email / WhatsApp / push by preference; daily digest of pending approvals; dashboard tile "My approvals". |
| Mobile | All approvals can be actioned on phone with the evidence panel summarised. |
| No bypass | API, import, background jobs, offline sync and AI create DRAFT records that follow the same chain. |

## B. Default authority bands (seed values, INR, per transaction)

| Document | Level 1 | Level 2 | Level 3 | Level 4 |
|---|---|---|---|---|
| Purchase Requisition | PM ≤ 5 L | PD ≤ 25 L | PROCMGR > 25 L | — |
| Purchase Order / Service Order | PROCMGR ≤ 5 L | + PM ≤ 25 L | + PD ≤ 1 Cr | + DIR > 1 Cr |
| Comparative Statement (non-L1 selection) | always one level above the PO band | | | |
| Subcontract Work Order | COMMGR ≤ 10 L | + PD ≤ 50 L | + DIR > 50 L | — |
| Client RA Bill (submission) | QS prepares → PM ≤ any | COMMGR | — | — |
| Subcontractor / Vendor Bill | SUBCO/SE verify → QS | PM ≤ 10 L | COMMGR ≤ 50 L | CFO > 50 L |
| Payment release | ACCMGR ≤ 10 L | CFO ≤ 1 Cr | DIR > 1 Cr | — |
| Advance to vendor / subcontractor | PM recommend | COMMGR | CFO | DIR > 25 L |
| Budget (original) | PCMGR | PD | DIR | — |
| Budget revision / transfer | PCMGR ≤ 2 % of budget | PD ≤ 5 % | DIR > 5 % | — |
| Variation order | QS evaluate → COMMGR ≤ 10 L | PD ≤ 50 L | DIR > 50 L | — |
| Journal voucher (manual) | ACCMGR ≤ 5 L | CFO > 5 L | — | — |
| Stock adjustment / write-off | STOREMGR ≤ 50 k | PROCMGR ≤ 5 L | CFO > 5 L | — |
| Leave | Reporting manager | HRMGR if > 10 days | — | — |
| Attendance regularisation / overtime | WSUP / reporting manager | PM if > 4 h OT/day | HRMGR (policy exceptions) | — |
| Expense claim / imprest | Reporting manager ≤ 25 k | ACCMGR ≤ 1 L | CFO > 1 L | — |
| New employee / offer | Hiring manager | HRMGR | DIR for senior grades | — |
| Vendor / client master (new or bank change) | PROCMGR / COMMGR | ACCMGR (bank verification) | — | — |
| Work Authorisation | CM | PM if outside plan | — | — |
| DPR | SE submits → CM/PM | — | — | — |
| Inspection Request | QCE | Consultant (portal) where required | — | — |
| NCR closure | QCE (minor) | QCMGR (major) | PD (critical) | — |
| Permit-to-Work | HSEE | CM (high-risk permits) | — | — |
| Equipment hire / mobilisation | PMSUP | PM | PLANTMGR > 5 L/month | — |
| Fixed asset capitalisation / disposal | ACCMGR | CFO | DIR (disposal > 10 L) | — |
| Payroll run | PAY prepares → HRMGR | CFO | — | — |
| Tender bid/no-bid & bid submission | EST | DIR | — | — |
| Estimate approval | EST | DIR | — | — |
| Contract / claim / EOT submission | COMMGR | PD | DIR | — |
| Role / permission change | SYSADM (maker) | ITADM or DIR (checker) | — | — |

L = lakh (₹1,00,000); Cr = crore (₹1,00,00,000).

## C. Approval-controlled document types by development part

The list below is generated from the prompts. Each prompt contains the full chain, conditions and test cases for its documents.


| Part | Module | Document / action | Default chain and conditions |
|---|---|---|---|
| 01.03 | Core Architecture & Platform Services | Period reopen request | ACCMGR → CFO; mandatory reason |
| 01.03 | Core Architecture & Platform Services | Numbering series change after first use | SYSADM → ACCMGR (statutory series) |
| 01.06 | Core Architecture & Platform Services | New formula version activation | owner-module manager → CFO for financial formulas |
| 01.08 | Core Architecture & Platform Services | Connector creation or credential change | ITADM → SYSADM (banking/GST: → CFO) |
| 02.02 | Identity, Organisation, Security & Access Control | New project / site activation | PD → PCMGR (maker-checker) |
| 02.02 | Identity, Organisation, Security & Access Control | Geofence change | HRMGR or PM → SYSADM; reason mandatory |
| 02.03 | Identity, Organisation, Security & Access Control | Activation of user with privileged role request | SYSADM → ITADM or DIR (via 02.04 assignment approval) |
| 02.04 | Identity, Organisation, Security & Access Control | Role permission change | SYSADM → ITADM (privileged roles also → DIR) |
| 02.04 | Identity, Organisation, Security & Access Control | Privileged assignment (finance approver, SUPADM) | SYSADM → DIR |
| 02.05 | Identity, Organisation, Security & Access Control | SoD rule change | SYSADM → AUD or DIR |
| 02.05 | Identity, Organisation, Security & Access Control | Elevated access | requester's manager → ITADM (financial roles → CFO) |
| 02.07 | Identity, Organisation, Security & Access Control | Bulk personal-data export (> 1,000 people records) | requester → HRMGR or DIR |
| 04.01 | Shared Business Engines | Workflow definition activation | SYSADM → process owner (e.g. PROCMGR for procurement documents) → ITADM for technical validation |
| 04.02 | Shared Business Engines | Approval matrix or authority limit change | SYSADM → CFO (financial documents) / process owner → DIR for limits above ₹1 Cr |
| 04.02 | Shared Business Engines | Delegation over 15 days | delegator's manager approval |
| 04.04 | Shared Business Engines | Exception request | per control escalation level — L1 PM, L2 PD, L3 DIR; value-based |
| 04.04 | Shared Business Engines | Control mode change to ENFORCE | process owner → AUD or DIR |
| 04.05 | Shared Business Engines | RACI change for a live project | PM → PD |
| 04.09 | Shared Business Engines | New or changed alert rule affecting external messages | process owner → SYSADM |
| 04.10 | Shared Business Engines | Document revision issue | author → reviewer (discipline lead) → approver (PM or QCMGR per type) |
| 04.11 | Shared Business Engines | Template activation | SYSADM → process owner (e.g. CFO for invoices, PROCMGR for PO) |
| 05.03 | Collaboration & Messaging | Open-source licence review | ITADM → legal adviser/DIR (mandatory before build) |
| 05.05 | Collaboration & Messaging | Policy version | owner → department head → DIR |
| 06.01 | Master Data | New master record or sensitive field change | steward of that master (financial masters also ACCMGR) |
| 06.01 | Master Data | Merge of duplicates | steward → ACCMGR for vendor/client masters |
| 06.02 | Master Data | Tax rate or TDS section change | ACCMGR → CFO |
| 06.03 | Master Data | New item | requester → category steward (PROCMGR or EST) |
| 06.04 | Master Data | New partner activation | steward (PROCMGR/COMMGR) → ACCMGR (statutory & bank verification) |
| 06.04 | Master Data | Bank account change | requester → ACCMGR → CFO; payment hold until approved |
| 06.04 | Master Data | Blacklisting / removal from blacklist | PROCMGR → DIR |
| 06.05 | Master Data | New account / cost code | ACCMGR or PCMGR → CFO |
| 06.06 | Master Data | Rate analysis release (standard library) | EST → DIR |
| 06.06 | Master Data | Project-specific analysis | EST → PM (or COMMGR for variations) |
| 07.01 | HR & Workforce Management (Workforce-First) | New employee activation | HR executive → HRMGR |
| 07.01 | HR & Workforce Management (Workforce-First) | Change of statutory or bank details | employee/HR → HRMGR (bank change → PAY verification) |
| 07.01 | HR & Workforce Management (Workforce-First) | Designation/grade/manager change | HR → HRMGR (senior grades → DIR) |
| 07.02 | HR & Workforce Management (Workforce-First) | Manpower requisition | hiring manager → department head/PM → HRMGR (beyond plan → DIR) |
| 07.02 | HR & Workforce Management (Workforce-First) | Offer | HRMGR (within range) → DIR (above range or senior grade) |
| 07.03 | HR & Workforce Management (Workforce-First) | Transfer | current PM → receiving PM → HRMGR |
| 07.03 | HR & Workforce Management (Workforce-First) | Deployment outside plan or beyond headcount | PM → PD |
| 07.04 | HR & Workforce Management (Workforce-First) | Attendance policy change | HRMGR → DIR (if pay-impacting) |
| 07.04 | HR & Workforce Management (Workforce-First) | Roster change within period / shift swap | WSUP → PM |
| 07.05 | HR & Workforce Management (Workforce-First) | Visit punch at non-deployed site | reporting manager → site PM |
| 07.05 | HR & Workforce Management (Workforce-First) | Anomaly acceptance (outside fence accepted as present) | WSUP/manager → HRMGR for repeated cases |
| 07.06 | HR & Workforce Management (Workforce-First) | Regularisation | reporting manager/WSUP → HRMGR if more than 3 per month |
| 07.06 | HR & Workforce Management (Workforce-First) | Overtime | WSUP/manager → PM if > 4 h/day or > 50 h/month → HRMGR for policy exceptions |
| 07.06 | HR & Workforce Management (Workforce-First) | Manual attendance entry | HR executive → HRMGR |
| 07.06 | HR & Workforce Management (Workforce-First) | Period reopen | HRMGR → CFO |
| 07.07 | HR & Workforce Management (Workforce-First) | Leave | reporting manager → HRMGR if > 10 consecutive days or special types |
| 07.07 | HR & Workforce Management (Workforce-First) | Balance adjustment | HR executive → HRMGR |
| 07.08 | HR & Workforce Management (Workforce-First) | Worker registration | WSUP/SUBCO → HR executive (KYC check) |
| 07.08 | HR & Workforce Management (Workforce-First) | Wage rate change | HRMGR → COMMGR (contract rates) |
| 07.09 | HR & Workforce Management (Workforce-First) | Profile change | employee → HR executive (bank/statutory → HRMGR) |
| 07.09 | HR & Workforce Management (Workforce-First) | Letter request | employee → HRMGR |
| 07.10 | HR & Workforce Management (Workforce-First) | External training nomination with cost | manager → HRMGR |
| 07.11 | HR & Workforce Management (Workforce-First) | Final appraisal rating | manager → reviewer (skip-level) → HRMGR (senior grades → DIR) |
| 07.12 | HR & Workforce Management (Workforce-First) | Expense claim | reporting manager ≤ ₹25k → ACCMGR ≤ ₹1L → CFO > ₹1L; policy deviations → next level |
| 07.12 | HR & Workforce Management (Workforce-First) | Salary advance | manager → HRMGR → CFO (above one month salary) |
| 07.12 | HR & Workforce Management (Workforce-First) | Travel request | manager → PM/department head |
| 07.13 | HR & Workforce Management (Workforce-First) | Resignation acceptance / LWD | manager → HRMGR |
| 07.13 | HR & Workforce Management (Workforce-First) | Termination | HRMGR → DIR |
| 07.13 | HR & Workforce Management (Workforce-First) | Notice waiver | manager → HRMGR |
| 07.14 | HR & Workforce Management (Workforce-First) | Workforce-First Gate sign-off | technical lead → product owner (owner/DIR) |
| 08.01 | CRM, Business Development & Tendering | Opportunity go-ahead for tendering above ₹10 Cr | BD → DIR |
| 08.02 | CRM, Business Development & Tendering | Bid/No-bid decision | EST → DIR |
| 08.03 | CRM, Business Development & Tendering | Final bid submission | EST → DIR |
| 08.03 | CRM, Business Development & Tendering | EMD/fee payment or BG request | EST → ACCMGR → CFO |
| 09.02 | Estimation & Quantity Take-off | Take-off / BBS release | preparer → checker (QS or design lead) |
| 09.03 | Estimation & Quantity Take-off | Estimate approval | EST → COMMGR (review) → DIR |
| 09.03 | Estimation & Quantity Take-off | Bid discount > 2 % | DIR |
| 10.01 | Project Setup, WBS & BOQ | Project activation | PD → DIR |
| 10.01 | Project Setup, WBS & BOQ | Lifecycle transition (Suspend, Close) | PM → PD → DIR |
| 10.02 | Project Setup, WBS & BOQ | Baseline pack sign-off | EST → COMMGR → PD (→ DIR for projects above ₹50 Cr) |
| 10.03 | Project Setup, WBS & BOQ | WBS change after baseline | PLAN → PM → PCMGR |
| 10.04 | Project Setup, WBS & BOQ | Contract BOQ freeze | QS → COMMGR → PM |
| 10.04 | Project Setup, WBS & BOQ | Mapping changes after freeze | QS → PM |
| 10.05 | Project Setup, WBS & BOQ | Team member addition with role | PM → PD (privileged roles via 02.04) |
| 10.05 | Project Setup, WBS & BOQ | MoM issue | minute-taker → meeting chair |
| 10.06 | Project Setup, WBS & BOQ | High/critical risk closure | owner → PM |
| 10.06 | Project Setup, WBS & BOQ | Monthly risk review | PM → PD |
| 11.01 | Engineering, Drawings & Technical Documents | Drawing IFC issue | DOC → DESIGN (discipline check) → PM |
| 11.01 | Engineering, Drawings & Technical Documents | Outgoing transmittal for approval | DOC → DESIGN |
| 11.02 | Engineering, Drawings & Technical Documents | RFI issue to consultant | SE → DESIGN (or CM) |
| 11.02 | Engineering, Drawings & Technical Documents | RFI closure | DESIGN → raiser's lead |
| 11.03 | Engineering, Drawings & Technical Documents | Submittal internal approval before sending | preparer → QCMGR (materials) / CM (method statements) |
| 11.04 | Engineering, Drawings & Technical Documents | Deliverable IFC release | discipline lead → engineering manager (DESIGN) → PM |
| 11.05 | Engineering, Drawings & Technical Documents | Outward letter | author → PM (contractual notices → COMMGR) |
| 12.01 | Budgeting & Cost Control | Original budget | PCMGR → PM → PD → DIR (per band) |
| 12.02 | Budgeting & Cost Control | Budget revision/transfer | PCMGR → PD (≤ 5 %) → DIR (> 5 %) |
| 12.02 | Budgeting & Cost Control | Contingency drawdown | PM → PD |
| 12.04 | Budgeting & Cost Control | Department budget | department head → CFO → DIR |
| 13.03 | Planning & Scheduling | Baseline approval / programme revision | PLAN → PM → PD |
| 13.04 | Planning & Scheduling | Weekly work plan | CM → PM |
| 13.05 | Planning & Scheduling | Delay classification (responsibility) | PLAN → PM → COMMGR |
| 14.01 | Site Execution & Progress Control | Work Authorisation | SE → CM (outside plan or emergency → PM) |
| 14.01 | Site Execution & Progress Control | Emergency WA regularisation | CM → PM within 24 h |
| 14.02 | Site Execution & Progress Control | DPR | SE → CM (or PM) |
| 14.02 | Site Execution & Progress Control | DPR amendment after approval | SE → PM |
| 14.03 | Site Execution & Progress Control | Hindrance record (for claims evidence) | SE → CM → PM |
| 14.04 | Site Execution & Progress Control | Internal instruction to subcontractor with back-charge | CM → PM |
| 14.05 | Site Execution & Progress Control | Progress period close | PLAN → PM |
| 14.07 | Site Execution & Progress Control | Unallocated cost allocation | QS/PCMGR → PM |
| 15.01 | Procurement | Material Request (to store/purchase) | SE → CM |
| 15.01 | Procurement | Purchase Requisition | PM ≤ ₹5 L → PD ≤ ₹25 L → PROCMGR > ₹25 L; emergency → PM with 24 h regularisation |
| 15.03 | Procurement | Single-source RFQ justification | PROCMGR → PD |
| 15.04 | Procurement | Comparative Statement | PROCMGR → PM → PD/DIR per PO band; non-L1 → one level higher |
| 15.05 | Procurement | Purchase Order | PROCMGR ≤ ₹5 L → + PM ≤ ₹25 L → + PD ≤ ₹1 Cr → + DIR > ₹1 Cr |
| 15.05 | Procurement | PO amendment | by delta amount band (rate increase always + PM) |
| 15.05 | Procurement | Advance payment against PO | PROCMGR → COMMGR → CFO |
| 15.05 | Procurement | Short-close/cancel | PROCMGR → PM |
| 15.06 | Procurement | Rate contract | PROCMGR → COMMGR → DIR (> ₹1 Cr ceiling) |
| 15.06 | Procurement | Service order | as PO bands; service entry sheet: SE → PM |
| 15.06 | Procurement | Price variation revision | PROCMGR → COMMGR |
| 15.07 | Procurement | Inspection Release Note | QCE/inspector → QCMGR |
| 15.08 | Procurement | Vendor prequalification approval | PROCMGR → QCMGR (technical) → DIR for strategic categories |
| 15.08 | Procurement | Suspension from AVL | PROCMGR → DIR |
| 16.02 | Stores, Inventory & Site Logistics | Outbound gate pass | SK → CM (non-returnable/scrap → PM) |
| 16.03 | Stores, Inventory & Site Logistics | GRN | SK → STOREMGR or CM (excess receipt → PROCMGR) |
| 16.03 | Stores, Inventory & Site Logistics | Return to vendor | SK → PROCMGR |
| 16.04 | Stores, Inventory & Site Logistics | Issue beyond WA quantity | SE → CM (exception) |
| 16.04 | Stores, Inventory & Site Logistics | Chargeable issue to subcontractor | SK → SUBCO → QS (rate) |
| 16.05 | Stores, Inventory & Site Logistics | Transfer | from-store SK → from-site CM; inter-project → both PMs |
| 16.05 | Stores, Inventory & Site Logistics | Discrepancy write-off | STOREMGR → PROCMGR |
| 16.06 | Stores, Inventory & Site Logistics | Stock adjustment / write-off | STOREMGR ≤ ₹50k → PROCMGR ≤ ₹5 L → CFO > ₹5 L |
| 16.06 | Stores, Inventory & Site Logistics | Scrap sale | STOREMGR → PROCMGR → CFO |
| 16.08 | Stores, Inventory & Site Logistics | Damage/loss write-off | CM → PM; recovery from subcontractor: QS → PM |
| 16.09 | Stores, Inventory & Site Logistics | Loss write-off/recovery | CM → PM (recovery from salary → HRMGR) |
| 16.10 | Stores, Inventory & Site Logistics | Monthly reconciliation | QS → PM → PD |
| 17.01 | Plant, Machinery & Equipment | New equipment registration | PMSUP/PLANTMGR → PLANTMGR (owned assets → ACCMGR for capitalisation link) |
| 17.02 | Plant, Machinery & Equipment | Equipment requisition | CM → PM |
| 17.02 | Plant, Machinery & Equipment | Transfer between projects | both PMs → PLANTMGR |
| 17.03 | Plant, Machinery & Equipment | Log book verification | PMSUP → SE (hire equipment → vendor signature + PM) |
| 17.04 | Plant, Machinery & Equipment | Fuel anomaly acceptance | PMSUP → PM |
| 17.05 | Plant, Machinery & Equipment | External repair above ₹50k | PMSUP → PLANTMGR |
| 17.06 | Plant, Machinery & Equipment | Hire-in agreement | PMSUP → PM → PLANTMGR (> ₹5 L/month) |
| 17.06 | Plant, Machinery & Equipment | Hire bill certification | PMSUP → PM |
| 17.07 | Plant, Machinery & Equipment | Equipment disposal recommendation | PLANTMGR → CFO → DIR |
| 17.08 | Plant, Machinery & Equipment | Cross-project resource plan | PCMGR → PDs involved → DIR |
| 18.01 | Quality Management (QA/QC) | ITP / quality plan approval | QCE → QCMGR (→ consultant via portal where contract requires) |
| 18.01 | Quality Management (QA/QC) | Checklist template activation | module owner → QCMGR |
| 18.02 | Quality Management (QA/QC) | Inspection Request | QCE → consultant (when consultant_required) |
| 18.03 | Quality Management (QA/QC) | Material release after test | QCE → QCMGR for failed-with-concession |
| 18.04 | Quality Management (QA/QC) | NCR closure | QCE (minor) → QCMGR (major) → PD (critical) |
| 18.04 | Quality Management (QA/QC) | Concession / use-as-is | QCMGR → consultant |
| 18.05 | Quality Management (QA/QC) | Pour card approval | QCE → CM |
| 19.01 | HSE & Site Security | HSE plan / HIRA approval | HSEE → PM (→ HSE head) |
| 19.02 | HSE & Site Security | Permit-to-Work | SE → HSEE (high-risk types → CM) |
| 19.03 | HSE & Site Security | Incident investigation closure | HSEE → PM (serious → DIR) |
| 19.04 | HSE & Site Security | Penalty/back-charge to subcontractor for safety violation | HSEE → PM |
| 19.06 | HSE & Site Security | Visitor entry | host employee |
| 19.06 | HSE & Site Security | Guard roster | SECSUP → SECMGR |
| 19.07 | HSE & Site Security | Recovery charges to contractor | camp in-charge → PM |
| 20.01 | Batching Plant & RMC | Mix design | plant QC → QCMGR (→ consultant via portal) |
| 20.02 | Batching Plant & RMC | Concrete requisition | SE → CM |
| 20.03 | Batching Plant & RMC | Internal transfer rate change | plant in-charge → CFO |
| 21.01 | Contracts, Subcontracts & Commercial | Contract record activation / amendment | COMMGR → PD → DIR |
| 21.02 | Contracts, Subcontracts & Commercial | BG issue/extension request | COMMGR → ACCMGR → CFO |
| 21.02 | Contracts, Subcontracts & Commercial | BG release (received from subcontractor) | COMMGR → PM → CFO |
| 21.03 | Contracts, Subcontracts & Commercial | Work Order | COMMGR ≤ ₹10 L → PD ≤ ₹50 L → DIR > ₹50 L; negative margin → +DIR |
| 21.03 | Contracts, Subcontracts & Commercial | WO amendment | by delta band |
| 21.04 | Contracts, Subcontracts & Commercial | Compliance waiver for payment | COMMGR → PD |
| 21.05 | Contracts, Subcontracts & Commercial | Variation submission to client | QS → COMMGR ≤ ₹10 L → PD ≤ ₹50 L → DIR |
| 21.06 | Contracts, Subcontracts & Commercial | Claim submission | COMMGR → PD → DIR |
| 21.07 | Contracts, Subcontracts & Commercial | Escalation claim | QS → COMMGR → PD |
| 22.01 | Measurement & Billing (Quantity Surveying) | MB entry | SE → QS (check) → consultant/client check (where required) → PM certify |
| 22.02 | Measurement & Billing (Quantity Surveying) | Deviation statement submission | QS → COMMGR → PM |
| 22.03 | Measurement & Billing (Quantity Surveying) | Client RA bill submission | QS → PM → COMMGR |
| 22.04 | Measurement & Billing (Quantity Surveying) | Certification acceptance (differences > 5 %) | QS → COMMGR |
| 22.04 | Measurement & Billing (Quantity Surveying) | Tax invoice issue | billing engineer → ACCMGR |
| 22.05 | Measurement & Billing (Quantity Surveying) | Subcontractor bill | SUBCO/SE verify → QS → PM ≤ ₹10 L → COMMGR ≤ ₹50 L → CFO |
| 22.06 | Measurement & Billing (Quantity Surveying) | Match exception override | ACCMGR → PROCMGR (price) / CFO (above threshold) |
| 22.07 | Measurement & Billing (Quantity Surveying) | Retention/SD release | COMMGR → PM → CFO |
| 22.07 | Measurement & Billing (Quantity Surveying) | Advance to subcontractor | PM → COMMGR → CFO (> ₹25 L → DIR) |
| 22.09 | Measurement & Billing (Quantity Surveying) | Monthly CVR | QS → PM → COMMGR |
| 23.01 | Finance & Accounting | Manual journal | ACCMGR ≤ ₹5 L → CFO > ₹5 L; reversal → same band (SoD-03) |
| 23.02 | Finance & Accounting | Posting rule change | ACCMGR → CFO |
| 23.02 | Finance & Accounting | Historical replay commit | ACCMGR → CFO |
| 23.03 | Finance & Accounting | Direct expense bill (no PO) | department head → ACCMGR (→ CFO > ₹1 L) |
| 23.03 | Finance & Accounting | Debit note | ACCMGR |
| 23.04 | Finance & Accounting | Payment release | ACCMGR ≤ ₹10 L → CFO ≤ ₹1 Cr → DIR > ₹1 Cr |
| 23.05 | Finance & Accounting | Credit note | ACCMGR → CFO (> ₹5 L) |
| 23.05 | Finance & Accounting | Write-off of receivable | ACCMGR → CFO → DIR |
| 23.06 | Finance & Accounting | Imprest replenishment | SACC → PM → ACCMGR |
| 23.06 | Finance & Accounting | Single imprest voucher above ₹10k | SACC → CM |
| 23.08 | Finance & Accounting | Monthly ITC claim | ACCMGR → CFO |
| 23.09 | Finance & Accounting | Capitalisation | ACCMGR → CFO |
| 23.09 | Finance & Accounting | Disposal | ACCMGR → CFO → DIR (> ₹10 L) |
| 23.10 | Finance & Accounting | Revenue recognition posting | ACCMGR → CFO |
| 23.11 | Finance & Accounting | Monthly forecast | PCMGR → PM → PD (→ CFO for loss-making projects) |
| 23.12 | Finance & Accounting | P&L snapshot freeze | ACCMGR → CFO |
| 23.13 | Finance & Accounting | Weekly cash forecast publication | ACCMGR → CFO |
| 23.14 | Finance & Accounting | Period close | ACCMGR → CFO; reopen: ACCMGR → CFO → DIR |
| 23.15 | Finance & Accounting | Inter-company transaction | originating ACCMGR → counterpart ACCMGR |
| 24.01 | Payroll & Statutory Compliance | Salary revision | HRMGR → CFO (senior grades → DIR) |
| 24.01 | Payroll & Statutory Compliance | Statutory parameter change | PAY → CFO |
| 24.02 | Payroll & Statutory Compliance | Payroll run | PAY → HRMGR → CFO |
| 24.03 | Payroll & Statutory Compliance | Labour wage run | SACC → PM → HRMGR |
| 24.04 | Payroll & Statutory Compliance | Statutory payment | PAY → ACCMGR → CFO |
| 24.05 | Payroll & Statutory Compliance | F&F settlement | PAY → HRMGR → CFO |
| 25.01 | External Portals | Vendor self-registration | PROCMGR → ACCMGR (via partner activation 06.04) |
| 26.01 | Commissioning, Handover & Closeout | MC/RFC/RFSU certificate | commissioning lead → QCMGR → PM → client |
| 26.02 | Commissioning, Handover & Closeout | Handover certificate | PM → PD → client |
| 26.03 | Commissioning, Handover & Closeout | DLP completion & release request | PM → COMMGR → CFO |
| 26.04 | Commissioning, Handover & Closeout | Project closure | PM → PD → CFO → DIR |
| 26.04 | Commissioning, Handover & Closeout | Lesson publication | author → PCMGR |
| 27.03 | Reporting, BI & Control Towers | Metric certification/change | metric owner → CFO or PCMGR |
| 27.07 | Reporting, BI & Control Towers | Monthly close | QS → PM → PD (management approval) |
| 27.09 | Reporting, BI & Control Towers | Finding closure as false positive | owner → AUD |
| 28.01 | AI & Intelligent Automation | Enabling an AI feature for production | SYSADM → DIR |
| 28.03 | AI & Intelligent Automation | Model activation for official use | model owner → CFO/PCMGR |
| 29.01 | Administration, Integration & Data Operations | Any configuration change | SYSADM → ITADM (financial/security areas → CFO or DIR) |
| 29.02 | Administration, Integration & Data Operations | Banking connector activation | ITADM → CFO |
| 29.03 | Administration, Integration & Data Operations | New API client with write scopes | ITADM → DIR |
| 29.04 | Administration, Integration & Data Operations | Bulk batch for approval-controlled data | preparer → module approver |
| 29.05 | Administration, Integration & Data Operations | Migration object sign-off | module owner → CFO (financial objects) |
| 29.06 | Administration, Integration & Data Operations | Production restore | ITADM → DIR |
| 29.07 | Administration, Integration & Data Operations | Archival job | SYSADM → AUD; disposal: AUD → DIR |
| 29.08 | Administration, Integration & Data Operations | Data correction request | module owner → AUD (financial data) |
| 30.10 | System Integration, Quality Assurance & Go-Live | Go-live decision | programme manager → CFO → DIR |

**Total approval-controlled document types / actions: 219.**

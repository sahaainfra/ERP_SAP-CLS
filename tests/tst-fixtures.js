import { setupCompany, startApi } from './helpers.js';
import { fill } from './qa-helpers.js';

// Part 30.01 T-01: one company with every mandatory business thread built end to end on realistic records (a building project: tender,
// estimate, BOQ, budget, schedule, work authorisation, procurement to payment, issues and DPRs, payroll, plant, billing to receipt,
// subcontracting, variations, claims, NCR back-charges, month-end close). Each derived record carries its source links and the fields it
// inherits, exactly as the owning modules write them; the verifier must find every thread green. Used by tests/tst-integration.test.js
// and by scripts/integration_matrix.mjs (the matrix document).

export const FLAGS = ['ff.qa.p3001', 'ff.qa.p3002', 'ff.qa.p3003'];
export function enableFlags(d, company = 1, flags = FLAGS) {
  for (const f of flags) d.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'go-live testing fixture', 0, 1)").run(f, company);
}

/** Builds the threads in company `co` (1 by default) of `d` (foreign keys are off while it runs). Returns the ids of the key records. */
export function buildThreads(d, co = 1) {
  d.exec('PRAGMA foreign_keys = OFF');
  const c = { company_id: co };
  const partner = (code, name, role) => Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, ?, ?, 'PRIVATE_LIMITED', 'ACTIVE', ?, 'fixture')").run(co, code, name, name, role).lastInsertRowid);
  const A = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, 'TWR-A', 'Residential Tower A', 'BUILDING', 'ACTIVE')").run(co).lastInsertRowid);
  const S = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (?, ?, 'TWR-A-S1', 'Tower A main site')").run(co, A).lastInsertRowid);
  const P = partner('CLI-01', 'Metro Housing Board', 'COMMGR');
  const V = partner('VEN-01', 'Shree Cement Traders', 'PROCMGR');
  const SC = partner('SUB-01', 'Kaveri Formwork Contractors', 'COMMGR');
  const I = fill(d, 'mdm_items', { ...c, code: 'CEM-OPC53', name: 'Cement OPC 53 grade', base_uom: 'bag' });
  const W = fill(d, 'proj_wbs', { ...c, org_project_id: A, project_id: A, code: 'W-1.1', name: 'Substructure', level: 1 });
  // Real parents for the references below: the threads are also built in the shared E2E database, whose integrity check (data health)
  // must find no dangling reference (audit E2E triage, AUD-DEF-022 on).
  const CAL = fill(d, 'plan_calendars', { ...c, org_project_id: A, code: 'CAL-TWR-A', name: 'Tower A six-day week' });
  const GL = fill(d, 'fin_accounts', { ...c, code: 'TST-BANK', name: 'Bank: current account (fixture)' });
  const BANK = fill(d, 'fin_bank_accounts', { ...c, code: 'BNK-01', name: 'Current account', bank_name: 'State Bank of India', ifsc: 'SBIN0000001', account_no_enc: 'fixture', account_last4: '0001', gl_account_id: GL });
  const STORE = fill(d, 'inv_stores', { ...c, org_project_id: A, org_site_id: S, code: 'ST-TWR-A', name: 'Tower A main store', store_type: 'SITE_STORE', requested_by: 'fixture' });

  // IT-01 tender → estimate → award → project → BOQ → budget → schedule → WA
  const T = fill(d, 'tdr_tenders', { ...c, client_partner_id: P, name_of_work: 'Residential Tower A, G+14', doc_no: 'TDR/26-27/0001' });
  const E = fill(d, 'est_estimates', { ...c, tender_id: T, title: 'Tower A bid estimate', doc_no: 'EST/26-27/0001' });
  const EI = fill(d, 'est_estimate_items', { ...c, estimate_id: E, item_no: '1.1', description: 'Earthwork in excavation', uom: 'cum', qty: 1200 });
  const AW = fill(d, 'tdr_awards', { ...c, tender_id: T, outcome: 'WON', doc_no: 'AWD/26-27/0001' });
  fill(d, 'proj_baseline_packs', { ...c, tender_id: T, award_id: AW, estimate_id: E, project_id: A, doc_no: 'BLP/26-27/0001' });
  fill(d, 'proj_projects', { ...c, project_id: A, tender_id: T, client_partner_id: P, contract_no: 'MHB/TWR-A/2026' });
  const BV = fill(d, 'proj_boq_versions', { ...c, org_project_id: A, project_id: A, version_no: 1, name: 'Contract BOQ', doc_no: 'BOQ/TWR-A/1' });
  const BL = fill(d, 'proj_boq_lines', { ...c, version_id: BV, project_id: A, line_kind: 'ITEM', item_code: '1.1', description: 'Earthwork in excavation', uom: 'cum', qty: 1200 });
  fill(d, 'proj_boq_items', { ...c, project_id: A, estimate_item_id: EI, item_no: '1.1', description: 'Earthwork in excavation', uom: 'cum', qty: 1200 });
  const BUD = fill(d, 'bud_budgets', { ...c, org_project_id: A, project_id: A, boq_version_id: BV, version_no: 1, name: 'Original budget', status: 'APPROVED', doc_no: 'BUD/TWR-A/1' });
  fill(d, 'bud_lines', { ...c, budget_id: BUD, boq_line_id: BL, wbs_id: W, line_kind: 'DIRECT', resource_name: 'Excavation', amount: 36_000_000 });
  const SCH = fill(d, 'plan_schedules', { ...c, org_project_id: A, project_id: A, calendar_id: CAL, status: 'APPROVED', doc_no: 'SCH/TWR-A/1' });
  const ACT = fill(d, 'plan_activities', { ...c, schedule_id: SCH, project_id: A, wbs_id: W, code: 'A-100', name: 'Excavation for raft', duration_days: 12 });
  fill(d, 'plan_activity_boq', { ...c, activity_id: ACT, boq_line_id: BL, qty: 1200 });
  const WA = fill(d, 'site_work_authorisations', { ...c, org_project_id: A, project_id: A, wa_site_id: S, activity_id: ACT, wbs_id: W, wa_no: 'WA/TWR-A/0001', planned_qty: 150_000, uom: 'cum', status: 'APPROVED' });

  // IT-02 MR → PR → RFQ → CS → PO → gate → GRN → vendor invoice → AP bill → payment
  const MR = fill(d, 'proc_material_requests', { ...c, org_project_id: A, project_id: A, wa_id: WA, status: 'APPROVED', doc_no: 'MR/TWR-A/0001' });
  const MRL = fill(d, 'proc_mr_lines', { ...c, mr_id: MR, line_no: 1, item_id: I, qty: 500_000 });
  const PR = fill(d, 'proc_requisitions', { ...c, org_project_id: A, project_id: A, status: 'APPROVED', doc_no: 'PR/TWR-A/0001' });
  const PRL = fill(d, 'proc_pr_lines', { ...c, pr_id: PR, line_no: 1, item_id: I, qty: 500_000 });
  fill(d, 'proc_pr_sources', { ...c, pr_line_id: PRL, mr_line_id: MRL, qty: 500_000 });
  const RFQ = fill(d, 'proc_rfqs', { ...c, org_project_id: A, project_id: A, status: 'CLOSED', doc_no: 'RFQ/TWR-A/0001' });
  fill(d, 'proc_rfq_lines', { ...c, rfq_id: RFQ, line_no: 1, pr_line_id: PRL, item_id: I, qty: 500_000 });
  const CS = fill(d, 'proc_comparative_statements', { ...c, rfq_id: RFQ, org_project_id: A, project_id: A, status: 'APPROVED', doc_no: 'CS/TWR-A/0001' });
  const PO = fill(d, 'proc_purchase_orders', { ...c, cs_id: CS, po_source: 'CS', vendor_id: V, org_project_id: A, project_id: A, status: 'APPROVED', total_amount: 19_470_000, doc_no: 'PO/TWR-A/0001' });
  const POL = fill(d, 'proc_po_lines', { ...c, po_id: PO, line_no: 1, pr_line_id: PRL, item_id: I, qty: 500_000, uom: 'bag', rate: 33_000 });
  const GATE = fill(d, 'inv_gate_inward', { ...c, po_id: PO, vendor_id: V, org_project_id: A, project_id: A, status: 'HANDED_OVER', doc_no: 'GI/TWR-A/0001' });
  const GRN = fill(d, 'inv_grns', { ...c, store_id: STORE, po_id: PO, gate_inward_id: GATE, vendor_id: V, org_project_id: A, project_id: A, org_site_id: S, emergency: 0, status: 'APPROVED', total_value: 16_500_000, doc_no: 'GRN/TWR-A/0001' });
  const VI = fill(d, 'bill_vendor_invoices', { ...c, po_id: PO, vendor_id: V, invoice_kind: 'PO', org_project_id: A, project_id: A, invoice_no: 'SCT/2026/417', status: 'APPROVED', total_paise: 19_470_000, doc_no: 'VI/TWR-A/0001' });
  fill(d, 'bill_vendor_invoice_lines', { ...c, invoice_id: VI, line_no: 1, po_line_id: POL, item_id: I });
  const APV = fill(d, 'ap_bills', { ...c, bill_source: 'VENDOR_INVOICE', source_ref: String(VI), partner_id: V, org_project_id: A, project_id: A, bill_no: 'SCT/2026/417', status: 'APPROVED', doc_no: 'APB/26-27/0001' });
  const PROP = fill(d, 'pmt_proposals', { ...c, bank_account_id: BANK, status: 'APPROVED', doc_no: 'PP/26-27/0001' });
  const PL1 = fill(d, 'pmt_proposal_lines', { ...c, proposal_id: PROP, line_no: 1, line_kind: 'BILL', ap_bill_id: APV, partner_id: V });
  fill(d, 'pmt_payments', { ...c, bank_account_id: BANK, proposal_id: PROP, line_id: PL1, partner_id: V, pay_status: 'PAID', doc_no: 'PAY/26-27/0001' });

  // IT-03 WA → issue → DPR → reconciliation
  fill(d, 'inv_issues', { ...c, store_id: STORE, wa_id: WA, mr_id: MR, activity_id: ACT, org_project_id: A, project_id: A, org_site_id: S, status: 'POSTED', doc_no: 'ISS/TWR-A/0001' });
  const DPR = fill(d, 'site_dprs', { ...c, org_project_id: A, project_id: A, dpr_site_id: S, dpr_date: '2026-10-15', status: 'APPROVED', doc_no: 'DPR/TWR-A/0001' });
  const DW = fill(d, 'site_dpr_work', { ...c, dpr_id: DPR, wa_id: WA, activity_id: ACT, qty: 150_000, uom: 'cum' });
  fill(d, 'site_dpr_materials', { ...c, dpr_id: DPR, wa_id: WA, item_id: I, qty: 400_000, uom: 'bag' });
  fill(d, 'mrc_reconciliations', { ...c, org_project_id: A, project_id: A, org_site_id: S, period: '2026-10', status: 'APPROVED', doc_no: 'MRC/TWR-A/2026-10' });

  // IT-04 attendance → payroll → transfer
  const RUN = fill(d, 'pay_runs', { ...c, period: '2026-10', run_type: 'REGULAR', status: 'APPROVED', net_paise: 6_200_000, doc_no: 'PR/2026-10/01' });
  const EMP = fill(d, 'hr_employees', { ...c, emp_code: 'E-9001', first_name: 'Ramesh', full_name: 'Ramesh Patil', gender: 'MALE', dob: '1990-05-01', mobile: '9000090001', employment_type: 'PERMANENT', doj: '2024-04-01' });
  for (const day of ['2026-10-01', '2026-10-02', '2026-10-03']) fill(d, 'att_daily', { ...c, person_type: 'EMPLOYEE', person_id: EMP, work_date: day, daily_site_id: S, paid_day: 1, locked: 1 });
  const RL = fill(d, 'pay_run_lines', { ...c, run_id: RUN, employee_id: EMP, payable_days: 3, paid_days: 3 });
  const TR = fill(d, 'pay_transfers', { ...c, bank_account_id: BANK, run_id: RUN, source_kind: 'PAY_RUN', doc_no: 'SAL/2026-10/01' });
  fill(d, 'pay_transfer_lines', { ...c, transfer_id: TR, run_line_id: RL, employee_id: EMP });

  // IT-05 plant allocation → log → fuel → cost
  const EQ = fill(d, 'plt_equipment', { ...c, asset_code: 'EXC-07', doc_no: 'EQ/0007' });
  const AL = fill(d, 'plt_allocations', { ...c, equipment_id: EQ, org_project_id: A, project_id: A, org_site_id: S, doc_no: 'ALC/0007' });
  fill(d, 'plt_logs', { ...c, allocation_id: AL, equipment_id: EQ, org_project_id: A, project_id: A, wa_id: WA, activity_id: ACT, log_date: '2026-10-15', doc_no: 'LOG/0007/1' });
  const TK = fill(d, 'plt_fuel_tanks', { ...c, code: 'TK-1', name: 'Site diesel tank', tank_type: 'TANK', capacity: 20000, org_project_id: A });
  fill(d, 'plt_fuel_issues', { ...c, allocation_id: AL, equipment_id: EQ, org_project_id: A, project_id: A, tank_id: TK, doc_no: 'FI/0007/1' });
  fill(d, 'plt_fuel_receipts', { ...c, tank_id: TK, source: 'GRN', grn_id: GRN, vendor_id: V, doc_no: 'FR/0001' });
  fill(d, 'plt_cost_snapshots', { ...c, equipment_id: EQ, period: '2026-10' });

  // IT-06 IR → MB → RA bill → certification → tax invoice → receivable → receipt  (IT-15 DPR → MB)
  const K = fill(d, 'ctr_contracts', { ...c, org_project_id: A, project_id: A, client_partner_id: P, contract_no: 'MHB/TWR-A/2026', doc_no: 'CTR/0001' });
  const IR = fill(d, 'qa_inspection_requests', { ...c, org_project_id: A, project_id: A, org_site_id: S, activity_id: ACT, wa_id: WA, status: 'APPROVED', doc_no: 'IR/TWR-A/0001' });
  const MB = fill(d, 'bill_mb_entries', { ...c, ir_id: IR, wa_id: WA, dpr_work_id: DW, activity_id: ACT, boq_line_id: BL, org_project_id: A, project_id: A, org_site_id: S, qty_th: 150_000, status: 'APPROVED', doc_no: 'MB/TWR-A/0001' });
  const CB = fill(d, 'bill_client_bills', { ...c, contract_id: K, org_project_id: A, project_id: A, status: 'APPROVED', bill_no: 'RA-01', doc_no: 'CB/TWR-A/0001' });
  fill(d, 'bill_client_bill_items', { ...c, bill_id: CB, line_no: 1, boq_line_id: BL, item_code: '1.1', mb_ids_json: JSON.stringify([MB]), cum_qty_th: 150_000, this_qty_th: 150_000 });
  const CERT = fill(d, 'bill_certifications', { ...c, bill_id: CB, contract_id: K, org_project_id: A, project_id: A, status: 'APPROVED', doc_no: 'CRT/TWR-A/0001' });
  const TI = fill(d, 'bill_tax_invoices', { ...c, certification_id: CERT, bill_id: CB, contract_id: K, org_project_id: A, project_id: A, invoice_no: 'TI/26-27/0001', gstin_from: '27AAACM1234A1Z5', gstin_to: '27AAAGM0289C1ZK', total_paise: 531_000_000, status: 'APPROVED', doc_no: 'TIN/TWR-A/0001' });
  const AR = fill(d, 'ar_invoices', { ...c, inv_source: 'TAX_INVOICE', source_ref: String(TI), partner_id: P, org_project_id: A, project_id: A, invoice_no: 'TI/26-27/0001', invoice_date: '2026-10-31', amount_paise: 531_000_000, status: 'APPROVED', doc_no: 'ARI/26-27/0001' });
  const RC = fill(d, 'ar_receipts', { ...c, bank_account_id: BANK, partner_id: P, org_project_id: A, receipt_date: '2026-11-15', amount_paise: 500_000_000, status: 'APPROVED', doc_no: 'RCP/26-27/0001' });
  fill(d, 'ar_allocations', { ...c, receipt_id: RC, invoice_id: AR, amount_paise: 500_000_000 });

  // IT-07 WO → sub-measurement → sub-bill → AP bill → payment;  IT-10 NCR → back-charge
  const WO = fill(d, 'ctr_work_orders', { ...c, subcontractor_id: SC, org_project_id: A, project_id: A, contract_id: K, wo_no: 'WO/TWR-A/0001', doc_no: 'WO/0001' });
  const SB = fill(d, 'bill_sub_bills', { ...c, wo_id: WO, subcontractor_id: SC, org_project_id: A, project_id: A, status: 'APPROVED', bill_no: 'KFC/RA-01', doc_no: 'SB/TWR-A/0001' });
  const WOI = fill(d, 'ctr_wo_items', { ...c, wo_id: WO, line_no: 1, description: 'Formwork to columns' });
  fill(d, 'bill_sub_measurements', { ...c, wo_item_id: WOI, wo_id: WO, subcontractor_id: SC, org_project_id: A, project_id: A, bill_id: SB, doc_no: 'SM/TWR-A/0001' });
  const APS = fill(d, 'ap_bills', { ...c, bill_source: 'SUB_BILL', source_ref: String(SB), partner_id: SC, org_project_id: A, project_id: A, status: 'APPROVED', doc_no: 'APB/26-27/0002' });
  fill(d, 'pmt_proposal_lines', { ...c, proposal_id: PROP, line_no: 2, line_kind: 'BILL', ap_bill_id: APS, partner_id: SC });
  const NCR = fill(d, 'qa_ncrs', { ...c, org_project_id: A, project_id: A, org_site_id: S, responsible_type: 'SUBCONTRACTOR', responsible_id: SC, backcharge: 2_500_000, backcharge_status: 'POSTED', status: 'CLOSED', doc_no: 'NCR/TWR-A/0001' });
  fill(d, 'bill_sub_claims', { ...c, bill_id: SB, source_kind: 'NCR', source_ref: String(NCR), amount_paise: 2_500_000, active: 1 });

  // IT-08 RFI → change request → variation → revised BOQ → budget change
  const RFI = fill(d, 'engg_rfis', { ...c, org_project_id: A, project_id: A, rfi_no: 'RFI/TWR-A/0001', subject: 'Raft depth at grid C' });
  const CR = fill(d, 'ctr_change_requests', { ...c, origin_type: 'RFI', origin_id: RFI, contract_id: K, org_project_id: A, project_id: A, doc_no: 'CR/0001' });
  const BV2 = fill(d, 'proj_boq_versions', { ...c, org_project_id: A, project_id: A, version_no: 2, name: 'Revised BOQ after VO-01', doc_no: 'BOQ/TWR-A/2' });
  const VO = fill(d, 'ctr_variation_orders', { ...c, cr_id: CR, contract_id: K, org_project_id: A, project_id: A, boq_version_id: BV2, vo_no: 'VO-01', doc_no: 'VO/0001' });
  const BUD2 = fill(d, 'bud_budgets', { ...c, org_project_id: A, project_id: A, boq_version_id: BV2, version_no: 2, name: 'Revised budget', status: 'APPROVED', doc_no: 'BUD/TWR-A/2' });
  fill(d, 'bud_changes', { ...c, variation_id: VO, variation_ref: 'VO-01', org_project_id: A, project_id: A, budget_id: BUD, result_budget_id: BUD2, doc_no: 'BCH/0001' });

  // IT-09 delay → claim → EOT → baseline
  const DL = fill(d, 'plan_delays', { ...c, org_project_id: A, project_id: A, title: 'Late drawings for raft', doc_no: 'DLY/0001' });
  const CL = fill(d, 'ctr_claims', { ...c, delay_id: DL, contract_id: K, org_project_id: A, project_id: A, eot_granted_days: 10, claim_no: 'CLM-01', doc_no: 'CLM/0001' });
  const EA = fill(d, 'ctr_eot_awards', { ...c, claim_id: CL, contract_id: K, days: 10 });
  fill(d, 'plan_baselines', { ...c, org_project_id: A, project_id: A, schedule_id: SCH, revision_type: 'EOT', status: 'APPROVED', reference_no: 'CLM-01', source_type: 'ctr_eot_awards', source_id: String(EA), doc_no: 'BLN/0002' });

  // IT-11 month-end close
  const period = d.prepare("SELECT id, start_date FROM core_periods WHERE company_id = ? AND start_date = '2026-10-01'").get(co);
  const CLS = fill(d, 'close_periods', { ...c, period_id: period.id, period: '2026-10', close_state: 'CLOSED', status: 'APPROVED', doc_no: 'CLS/2026-10' });
  for (const [code, i] of [['BANK_RECON', 1], ['SUBLEDGER', 2], ['TB_REVIEW', 3]]) fill(d, 'close_tasks', { ...c, close_id: CLS, task_code: code, name: code, sort_order: i, mandatory: 1, task_status: 'DONE' });
  fill(d, 'mc_monthly_closes', { ...c, period_id: period.id, period: '2026-10', doc_no: 'MC/2026-10' });

  // IT-12 PO → commitment → actual;  IT-13 GRN → material test;  IT-14 hire agreement → hire bill → vendor invoice
  const CC = fill(d, 'fin_cost_codes', { ...c, code: 'CC-MAT', name: 'Materials' });
  const CM = fill(d, 'bud_commitments', { ...c, org_project_id: A, project_id: A, src_type: 'proc_purchase_orders', src_id: String(PO), doc_ref: 'PO/TWR-A/0001', cost_code_id: CC, amount: 19_470_000 });
  fill(d, 'bud_actuals', { ...c, commitment_id: CM, org_project_id: A, project_id: A, cost_code_id: CC, doc_ref: 'GRN/TWR-A/0001', status: 'POSTED' });
  fill(d, 'qa_test_requests', { ...c, grn_id: GRN, org_project_id: A, project_id: A, doc_no: 'MT/TWR-A/0001' });
  const HA = fill(d, 'plt_hire_agreements', { ...c, equipment_id: EQ, partner_id: V, org_project_id: A, doc_no: 'HA/0001' });
  const HB = fill(d, 'plt_hire_bills', { ...c, agreement_id: HA, doc_no: 'HB/0001' });
  fill(d, 'bill_vendor_invoices', { ...c, hire_bill_id: HB, invoice_kind: 'HIRE', vendor_id: V, org_project_id: A, project_id: A, invoice_no: 'SCT/HIRE/12', status: 'APPROVED', doc_no: 'VI/TWR-A/0002' });

  d.exec('PRAGMA foreign_keys = ON');
  return { A, S, P, V, SC, I, PO, GRN, VI, APV, WA, ACT, MB, CB, TI, AR, SB, NCR, RUN, EQ, AL, K, VO, CL, EA, CLS, CM };
}

/** A running API with company 1 set up, the go-live flags on and every thread built. */
export async function threadsApi() {
  const api = await startApi();
  await setupCompany(api);
  enableFlags(api.db, 1);
  const ids = buildThreads(api.db);
  return { api, d: api.db, ids };
}

// Part 30.01, FR-01 / FR-03: the mandatory cross-module business threads and their hand-offs.
//
// A thread is the path a piece of business takes through the modules (a material request becoming a payment, a measurement becoming a
// receipt). Each hand-off is one step of it: a downstream record that must come from an upstream record of another module. The verifier
// (integration.js) reads the link columns the owning modules already store and checks, on the live data of a company:
//   - broken:  downstream rows that must have an upstream record but do not (no link, or a link to a record that does not exist);
//   - rekeyed: fields the downstream record carries over from its source that differ from the source (typed again rather than taken
//              from the source: the re-keying audit of FR-03; BR-01 makes each finding a defect of the owning part);
//   - events:  the domain events the hand-off travels on, checked against the event catalogue and the bus (integration.js);
//   - posting: postings of the thread's documents that failed in the posting engine (23.02).
// Nothing here writes: the registry is SQL over the owners' tables, read-only, scoped to one company.

/**
 * @typedef {{ label: string, to: string, from: string, ref?: string, fk?: string, on?: string, where?: string, required?: string, fieldLabels?: Record<string, string>,
 *   inherit?: [string, string, string][], code: string, events?: string[], consumers?: string[], custom?: { broken?: string, rekeyed?: string } }} HandOff
 */

/** Hand-off shorthand: downstream table `to` (alias t) links to upstream table `from` (alias f) on `fk` (t.<fk> = f.id) or `on`. */
const h = (code, label, to, from, opts = {}) => ({ code, label, to, from, ref: 'doc_no', ...opts });

/** The threads. Codes IT-01 … are the test IDs of `tests/tst-threads.test.js` (T-01), which builds each thread and verifies it green. */
export const THREADS = Object.freeze([
  {
    code: 'IT-01', name: 'Tender → estimate → award → project → BOQ → budget → schedule → work authorisation',
    modules: ['bd', 'est', 'proj', 'bud', 'plan', 'site'],
    handoffs: [
      h('IT-01.1', 'Estimate from its tender', 'est_estimates', 'tdr_tenders', { fk: 'tender_id', required: 't.tender_id IS NOT NULL' }),
      h('IT-01.2', 'Award decision on its tender', 'tdr_awards', 'tdr_tenders', { fk: 'tender_id', events: ['bd.award.decided'] }),
      h('IT-01.3', 'Baseline pack from the award', 'proj_baseline_packs', 'tdr_awards', { fk: 'award_id', required: 't.award_id IS NOT NULL', inherit: [['tender_id', 'tender_id', 'Tender of the award']] }),
      h('IT-01.4', 'Project set up from the tender', 'proj_projects', 'tdr_tenders', { ref: 'contract_no', fk: 'tender_id', required: 't.tender_id IS NOT NULL', inherit: [['client_partner_id', 'client_partner_id', 'Client of the tender']], events: ['proj.project.activated'] }),
      h('IT-01.5', 'BOQ item priced from the estimate', 'proj_boq_items', 'est_estimate_items', { ref: 'item_no', fk: 'estimate_item_id', required: 't.estimate_item_id IS NOT NULL', inherit: [['description', 'description', 'Description of the estimate item'], ['uom', 'uom', 'Unit of the estimate item']] }),
      h('IT-01.6', 'Budget generated from the BOQ version', 'bud_budgets', 'proj_boq_versions', { fk: 'boq_version_id', required: 't.boq_version_id IS NOT NULL', inherit: [['org_project_id', 'org_project_id', 'Project of the BOQ']], events: ['bud.budget.approved'] }),
      h('IT-01.7', 'Budget line from its BOQ line', 'bud_lines', 'proj_boq_lines', { ref: 'resource_name', fk: 'boq_line_id', required: 't.boq_line_id IS NOT NULL' }),
      h('IT-01.8', 'Schedule activity quantities from the BOQ', 'plan_activity_boq', 'proj_boq_lines', { ref: 'activity_id', fk: 'boq_line_id' }),
      h('IT-01.9', 'Work authorisation for a scheduled activity', 'site_work_authorisations', 'plan_activities', { ref: 'wa_no', fk: 'activity_id', required: 't.activity_id IS NOT NULL', inherit: [['wbs_id', 'wbs_id', 'WBS of the activity']], events: ['site.wa.approved'] }),
    ],
  },
  {
    code: 'IT-02', name: 'Material request → requisition → RFQ → comparative statement → purchase order → gate entry → GRN → vendor invoice → AP bill → payment',
    modules: ['proc', 'inv', 'bill', 'fin'],
    handoffs: [
      { code: 'IT-02.1', label: 'Requisition line from its material request line', to: 'proc_pr_sources', from: 'proc_mr_lines', ref: 'id', fk: 'mr_line_id', inherit: [] },
      h('IT-02.2', 'RFQ line from its requisition line', 'proc_rfq_lines', 'proc_pr_lines', { ref: 'line_no', fk: 'pr_line_id', required: 't.pr_line_id IS NOT NULL', inherit: [['item_id', 'item_id', 'Item of the requisition']] }),
      h('IT-02.3', 'Comparative statement of its RFQ', 'proc_comparative_statements', 'proc_rfqs', { fk: 'rfq_id', inherit: [['org_project_id', 'org_project_id', 'Project of the RFQ']], events: ['proc.cs.approved'] }),
      h('IT-02.4', 'Purchase order from its comparative statement', 'proc_purchase_orders', 'proc_comparative_statements', { fk: 'cs_id', required: "t.po_source = 'CS'", inherit: [['org_project_id', 'org_project_id', 'Project of the comparative statement']], events: ['proc.po.approved'], consumers: ['bud.ledger', 'proc.rate_history', 'proc.pr_balance'] }),
      h('IT-02.5', 'Order line from its requisition line', 'proc_po_lines', 'proc_pr_lines', { ref: 'line_no', fk: 'pr_line_id', inherit: [['item_id', 'item_id', 'Item of the requisition']] }),
      h('IT-02.6', 'Gate entry against its order', 'inv_gate_inward', 'proc_purchase_orders', { fk: 'po_id', inherit: [['vendor_id', 'vendor_id', 'Vendor of the order'], ['org_project_id', 'org_project_id', 'Project of the order']] }),
      h('IT-02.7', 'Goods receipt against its order', 'inv_grns', 'proc_purchase_orders', { fk: 'po_id', required: 't.emergency = 0', inherit: [['vendor_id', 'vendor_id', 'Vendor of the order'], ['org_project_id', 'org_project_id', 'Project of the order']], events: ['inv.grn.posted'], consumers: ['fin.posting', 'proc.po_receipts_from_grn'] }),
      h('IT-02.8', 'Goods receipt from its gate entry', 'inv_grns', 'inv_gate_inward', { fk: 'gate_inward_id', inherit: [['po_id', 'po_id', 'Order of the gate entry']] }),
      h('IT-02.9', 'Vendor invoice against its order', 'bill_vendor_invoices', 'proc_purchase_orders', { fk: 'po_id', required: "t.invoice_kind = 'PO'", inherit: [['vendor_id', 'vendor_id', 'Vendor of the order'], ['org_project_id', 'org_project_id', 'Project of the order']], events: ['ap.invoice.matched'], consumers: ['fin.posting', 'fin.ap_invoice'] }),
      h('IT-02.10', 'AP bill from the matched vendor invoice', 'ap_bills', 'bill_vendor_invoices', { on: 'f.id = CAST(t.source_ref AS INTEGER)', where: "t.bill_source = 'VENDOR_INVOICE'", required: '1 = 1', inherit: [['partner_id', 'vendor_id', 'Vendor of the invoice'], ['org_project_id', 'org_project_id', 'Project of the invoice'], ['bill_no', 'invoice_no', 'Vendor\'s invoice number']] }),
      h('IT-02.11', 'Payment proposal line for its AP bill', 'pmt_proposal_lines', 'ap_bills', { ref: 'line_no', fk: 'ap_bill_id', required: "t.line_kind = 'BILL'", inherit: [['partner_id', 'partner_id', 'Payee of the AP bill']] }),
      h('IT-02.12', 'Payment from its proposal line', 'pmt_payments', 'pmt_proposal_lines', { fk: 'line_id', required: '1 = 1', inherit: [['partner_id', 'partner_id', 'Payee of the proposal line'], ['proposal_id', 'proposal_id', 'Proposal of the line']], events: ['fin.payment.released'], consumers: ['fin.ap_payment'] }),
    ],
    posting: ['inv.grn.posted', 'ap.invoice.matched'],
  },
  {
    code: 'IT-03', name: 'Work authorisation → material request and issue → daily progress report → material reconciliation',
    modules: ['site', 'proc', 'inv', 'plan'],
    handoffs: [
      h('IT-03.1', 'Material request raised for a work authorisation', 'proc_material_requests', 'site_work_authorisations', { fk: 'wa_id', inherit: [['org_project_id', 'org_project_id', 'Project of the WA']] }),
      h('IT-03.2', 'Material issued against a work authorisation', 'inv_issues', 'site_work_authorisations', { fk: 'wa_id', inherit: [['org_project_id', 'org_project_id', 'Project of the WA'], ['activity_id', 'activity_id', 'Activity of the WA']], events: ['inv.issue.posted'], consumers: ['fin.posting'] }),
      h('IT-03.3', 'Material issued against a material request', 'inv_issues', 'proc_material_requests', { fk: 'mr_id', inherit: [['org_project_id', 'org_project_id', 'Project of the request']] }),
      h('IT-03.4', 'Progress line of a DPR against its work authorisation', 'site_dpr_work', 'site_work_authorisations', { ref: 'id', fk: 'wa_id', inherit: [['activity_id', 'activity_id', 'Activity of the WA'], ['uom', 'uom', 'Unit of the WA']], events: ['site.dpr.approved'], consumers: ['plan.progress', 'site.progress', 'site.productivity', 'site.control'] }),
      h('IT-03.5', 'Material line of a DPR against its work authorisation', 'site_dpr_materials', 'site_work_authorisations', { ref: 'id', fk: 'wa_id' }),
      h('IT-03.6', 'Material reconciliation of a site of the project', 'mrc_reconciliations', 'org_sites', { fk: 'org_site_id', inherit: [['org_project_id', 'org_project_id', 'Project of the site']], events: ['inv.reconciliation.approved'] }),
    ],
    posting: ['inv.issue.posted'],
  },
  {
    code: 'IT-04', name: 'Attendance → payroll → posting and salary transfer',
    modules: ['hr', 'pay', 'fin'],
    handoffs: [
      h('IT-04.1', 'Payroll line of its run', 'pay_run_lines', 'pay_runs', { ref: 'employee_id', fk: 'run_id', required: '1 = 1' }),
      { code: 'IT-04.2', label: 'Paid days of the payroll equal the locked attendance of the month', to: 'pay_run_lines', from: 'att_daily', ref: 'employee_id', fieldLabels: { payable_days: 'Paid days of the locked attendance' },
        custom: {
          total: "SELECT COUNT(*) AS n FROM pay_run_lines t JOIN pay_runs r ON r.id = t.run_id WHERE t.company_id = :c AND t.deleted_at IS NULL AND r.status = 'APPROVED' AND r.run_type = 'REGULAR'",
          rekeyed: "SELECT t.id, r.doc_no || ' · employee ' || t.employee_id AS ref, 'payable_days' AS field, t.payable_days AS value, (SELECT COALESCE(SUM(d.paid_day), 0) FROM att_daily d WHERE d.company_id = t.company_id AND d.person_type = 'EMPLOYEE' AND d.person_id = t.employee_id AND substr(d.work_date, 1, 7) = r.period) AS source FROM pay_run_lines t JOIN pay_runs r ON r.id = t.run_id WHERE t.company_id = :c AND t.deleted_at IS NULL AND r.status = 'APPROVED' AND r.run_type = 'REGULAR' AND EXISTS (SELECT 1 FROM att_daily d WHERE d.company_id = t.company_id AND d.person_type = 'EMPLOYEE' AND d.person_id = t.employee_id AND substr(d.work_date, 1, 7) = r.period) AND ABS(t.payable_days - (SELECT COALESCE(SUM(d.paid_day), 0) FROM att_daily d WHERE d.company_id = t.company_id AND d.person_type = 'EMPLOYEE' AND d.person_id = t.employee_id AND substr(d.work_date, 1, 7) = r.period)) > 0.001",
        } },
      h('IT-04.3', 'Salary transfer of an approved run', 'pay_transfers', 'pay_runs', { fk: 'run_id', required: "t.source_kind = 'PAY_RUN'" }),
      h('IT-04.4', 'Transfer line of a payroll line', 'pay_transfer_lines', 'pay_run_lines', { ref: 'employee_id', fk: 'run_line_id', inherit: [['employee_id', 'employee_id', 'Employee of the payroll line']] }),
    ],
    posting: ['pay.run.approved', 'pay.wage_run.approved', 'pay.wage_run.paid'],
  },
  {
    code: 'IT-05', name: 'Plant allocation → log book → fuel → cost',
    modules: ['plant', 'site', 'inv'],
    handoffs: [
      h('IT-05.1', 'Allocation of registered equipment', 'plt_allocations', 'plt_equipment', { fk: 'equipment_id', required: '1 = 1' }),
      h('IT-05.2', 'Log book entry under its allocation', 'plt_logs', 'plt_allocations', { fk: 'allocation_id', inherit: [['equipment_id', 'equipment_id', 'Equipment of the allocation'], ['org_project_id', 'org_project_id', 'Project of the allocation']] }),
      h('IT-05.3', 'Log book work against a work authorisation', 'plt_logs', 'site_work_authorisations', { fk: 'wa_id', inherit: [['org_project_id', 'org_project_id', 'Project of the WA'], ['activity_id', 'activity_id', 'Activity of the WA']] }),
      h('IT-05.4', 'Fuel issued under its allocation', 'plt_fuel_issues', 'plt_allocations', { fk: 'allocation_id', inherit: [['equipment_id', 'equipment_id', 'Equipment of the allocation'], ['org_project_id', 'org_project_id', 'Project of the allocation']] }),
      h('IT-05.5', 'Fuel issued from a tank', 'plt_fuel_issues', 'plt_fuel_tanks', { fk: 'tank_id', required: '1 = 1' }),
      h('IT-05.6', 'Fuel received against its goods receipt', 'plt_fuel_receipts', 'inv_grns', { fk: 'grn_id', required: "t.source = 'GRN'", inherit: [['vendor_id', 'vendor_id', 'Vendor of the GRN']] }),
      h('IT-05.7', 'Monthly cost of registered equipment', 'plt_cost_snapshots', 'plt_equipment', { ref: 'period', fk: 'equipment_id', required: '1 = 1' }),
    ],
  },
  {
    code: 'IT-06', name: 'Inspection request → measurement → RA bill → certification → tax invoice → receivable → receipt',
    modules: ['qa', 'bill', 'fin'],
    handoffs: [
      h('IT-06.1', 'Measurement of an inspected work', 'bill_mb_entries', 'qa_inspection_requests', { fk: 'ir_id', inherit: [['org_project_id', 'org_project_id', 'Project of the inspection request'], ['activity_id', 'activity_id', 'Activity of the inspection request']] }),
      { code: 'IT-06.2', label: 'RA bill item from its measurements', to: 'bill_client_bill_items', from: 'bill_mb_entries', ref: 'item_code',
        custom: {
          total: "SELECT COUNT(*) AS n FROM bill_client_bill_items t WHERE t.company_id = :c AND t.deleted_at IS NULL AND t.mb_ids_json IS NOT NULL AND t.mb_ids_json NOT IN ('', '[]')",
          broken: "SELECT DISTINCT t.id, COALESCE(t.item_code, t.description) AS ref, 'mb ' || j.value AS detail FROM bill_client_bill_items t, json_each(CASE WHEN json_valid(t.mb_ids_json) THEN t.mb_ids_json ELSE '[]' END) j LEFT JOIN bill_mb_entries f ON f.id = j.value WHERE t.company_id = :c AND t.deleted_at IS NULL AND f.id IS NULL",
          rekeyed: "SELECT DISTINCT t.id, COALESCE(t.item_code, t.description) AS ref, 'boq_line_id' AS field, t.boq_line_id AS value, f.boq_line_id AS source FROM bill_client_bill_items t, json_each(CASE WHEN json_valid(t.mb_ids_json) THEN t.mb_ids_json ELSE '[]' END) j JOIN bill_mb_entries f ON f.id = j.value WHERE t.company_id = :c AND t.deleted_at IS NULL AND t.boq_line_id IS NOT NULL AND f.boq_line_id IS NOT t.boq_line_id",
        } },
      h('IT-06.3', 'Certification of its RA bill', 'bill_certifications', 'bill_client_bills', { fk: 'bill_id', required: '1 = 1', inherit: [['contract_id', 'contract_id', 'Contract of the bill'], ['org_project_id', 'org_project_id', 'Project of the bill']], events: ['bill.client.certified'], consumers: ['bill.ledger_client'] }),
      h('IT-06.4', 'Tax invoice of its certification', 'bill_tax_invoices', 'bill_certifications', { fk: 'certification_id', inherit: [['bill_id', 'bill_id', 'RA bill of the certification'], ['contract_id', 'contract_id', 'Contract of the certification']], events: ['bill.invoice.issued'], consumers: ['fin.posting', 'fin.ar_invoice', 'fin.gst_einvoice'] }),
      h('IT-06.5', 'Receivable from the issued tax invoice', 'ar_invoices', 'bill_tax_invoices', { on: 'f.id = CAST(t.source_ref AS INTEGER)', where: "t.inv_source = 'TAX_INVOICE'", required: '1 = 1', inherit: [['org_project_id', 'org_project_id', 'Project of the tax invoice'], ['amount_paise', 'total_paise', 'Total of the tax invoice'], ['invoice_no', 'invoice_no', 'Number of the tax invoice']] }),
      h('IT-06.6', 'Receipt allocated to a receivable', 'ar_allocations', 'ar_invoices', { ref: 'id', fk: 'invoice_id', required: '1 = 1' }),
      { code: 'IT-06.7', label: 'Receipt and receivable of the same client', to: 'ar_allocations', from: 'ar_receipts', ref: 'id',
        custom: {
          total: 'SELECT COUNT(*) AS n FROM ar_allocations t WHERE t.company_id = :c AND t.deleted_at IS NULL',
          broken: 'SELECT t.id, t.id AS ref, \'receipt \' || t.receipt_id AS detail FROM ar_allocations t LEFT JOIN ar_receipts f ON f.id = t.receipt_id WHERE t.company_id = :c AND t.deleted_at IS NULL AND f.id IS NULL',
          rekeyed: "SELECT t.id, r.doc_no AS ref, 'partner_id' AS field, r.partner_id AS value, i.partner_id AS source FROM ar_allocations t JOIN ar_receipts r ON r.id = t.receipt_id JOIN ar_invoices i ON i.id = t.invoice_id WHERE t.company_id = :c AND t.deleted_at IS NULL AND r.partner_id IS NOT i.partner_id",
        } },
    ],
    posting: ['bill.invoice.issued', 'bill.invoice.cancelled'],
  },
  {
    code: 'IT-07', name: 'Work order → subcontract measurement → subcontractor bill → AP bill → payment',
    modules: ['ctr', 'bill', 'fin'],
    handoffs: [
      h('IT-07.1', 'Measurement under its work order', 'bill_sub_measurements', 'ctr_work_orders', { fk: 'wo_id', required: '1 = 1', inherit: [['subcontractor_id', 'subcontractor_id', 'Subcontractor of the work order'], ['org_project_id', 'org_project_id', 'Project of the work order']] }),
      h('IT-07.2', 'Measurement taken into a subcontractor bill', 'bill_sub_measurements', 'bill_sub_bills', { fk: 'bill_id', inherit: [['wo_id', 'wo_id', 'Work order of the bill']] }),
      h('IT-07.3', 'Subcontractor bill under its work order', 'bill_sub_bills', 'ctr_work_orders', { fk: 'wo_id', required: '1 = 1', inherit: [['subcontractor_id', 'subcontractor_id', 'Subcontractor of the work order'], ['org_project_id', 'org_project_id', 'Project of the work order']], events: ['bill.sub.approved'], consumers: ['fin.posting', 'fin.ap_sub_bill', 'bill.ledger_sub'] }),
      h('IT-07.4', 'AP bill from the approved subcontractor bill', 'ap_bills', 'bill_sub_bills', { on: 'f.id = CAST(t.source_ref AS INTEGER)', where: "t.bill_source = 'SUB_BILL'", required: '1 = 1', inherit: [['partner_id', 'subcontractor_id', 'Subcontractor of the bill'], ['org_project_id', 'org_project_id', 'Project of the bill']] }),
      h('IT-07.5', 'Payment proposal line for its AP bill', 'pmt_proposal_lines', 'ap_bills', { ref: 'line_no', fk: 'ap_bill_id', where: "f.bill_source = 'SUB_BILL'", inherit: [['partner_id', 'partner_id', 'Payee of the AP bill']] }),
    ],
    posting: ['bill.sub.approved'],
  },
  {
    code: 'IT-08', name: 'RFI → change request → variation order → revised BOQ → budget change',
    modules: ['engg', 'ctr', 'proj', 'bud'],
    handoffs: [
      h('IT-08.1', 'Change request raised from an RFI', 'ctr_change_requests', 'engg_rfis', { fk: 'origin_id', where: "t.origin_type = 'RFI'", required: '1 = 1', inherit: [['org_project_id', 'org_project_id', 'Project of the RFI']] }),
      h('IT-08.2', 'Variation order of its change request', 'ctr_variation_orders', 'ctr_change_requests', { fk: 'cr_id', inherit: [['contract_id', 'contract_id', 'Contract of the change request'], ['org_project_id', 'org_project_id', 'Project of the change request']], events: ['ctr.variation.approved'], consumers: ['bud.variation'] }),
      h('IT-08.3', 'Revised BOQ of the variation', 'ctr_variation_orders', 'proj_boq_versions', { fk: 'boq_version_id', inherit: [['org_project_id', 'org_project_id', 'Project of the BOQ']] }),
      h('IT-08.4', 'Budget change from the variation', 'bud_changes', 'ctr_variation_orders', { fk: 'variation_id', inherit: [['org_project_id', 'org_project_id', 'Project of the variation'], ['variation_ref', 'vo_no', 'Number of the variation']] }),
      h('IT-08.5', 'Revised budget from the approved change', 'bud_changes', 'bud_budgets', { fk: 'result_budget_id', inherit: [['org_project_id', 'org_project_id', 'Project of the budget']] }),
    ],
  },
  {
    code: 'IT-09', name: 'Delay → claim → extension of time → baseline revision',
    modules: ['plan', 'ctr'],
    handoffs: [
      h('IT-09.1', 'Claim for a recorded delay', 'ctr_claims', 'plan_delays', { fk: 'delay_id', inherit: [['org_project_id', 'org_project_id', 'Project of the delay']], events: ['ctr.claim.determined'] }),
      h('IT-09.2', 'Extension of time awarded on its claim', 'ctr_eot_awards', 'ctr_claims', { ref: 'id', fk: 'claim_id', required: '1 = 1', inherit: [['contract_id', 'contract_id', 'Contract of the claim'], ['days', 'eot_granted_days', 'Days granted on the claim']] }),
      h('IT-09.3', 'Baseline revised for an awarded extension of time', 'plan_baselines', 'ctr_eot_awards', { on: "t.source_type = 'ctr_eot_awards' AND f.id = CAST(t.source_id AS INTEGER)", where: "t.revision_type = 'EOT'", required: "t.status IN ('SUBMITTED', 'APPROVED')" }),
    ],
  },
  {
    code: 'IT-10', name: 'NCR → back-charge to the subcontractor bill',
    modules: ['qa', 'bill'],
    handoffs: [
      h('IT-10.1', 'Back-charge deducted in a subcontractor bill from its NCR', 'bill_sub_claims', 'qa_ncrs', { ref: 'source_ref', on: 'f.id = CAST(t.source_ref AS INTEGER)', where: "t.source_kind = 'NCR' AND t.active = 1", required: '1 = 1', inherit: [['amount_paise', 'backcharge', 'Back-charge of the NCR']] }),
      { code: 'IT-10.2', label: 'NCR marked posted has its back-charge in a bill', to: 'qa_ncrs', from: 'bill_sub_claims', ref: 'doc_no',
        custom: {
          total: "SELECT COUNT(*) AS n FROM qa_ncrs t WHERE t.company_id = :c AND t.deleted_at IS NULL AND t.backcharge_status = 'POSTED'",
          broken: "SELECT t.id, t.doc_no AS ref, 'no bill deduction' AS detail FROM qa_ncrs t WHERE t.company_id = :c AND t.deleted_at IS NULL AND t.backcharge_status = 'POSTED' AND NOT EXISTS (SELECT 1 FROM bill_sub_claims s WHERE s.company_id = t.company_id AND s.source_kind = 'NCR' AND s.source_ref = CAST(t.id AS TEXT) AND s.active = 1)",
          rekeyed: "SELECT DISTINCT t.id, t.doc_no AS ref, 'subcontractor' AS field, b.subcontractor_id AS value, t.responsible_id AS source FROM qa_ncrs t JOIN bill_sub_claims s ON s.source_kind = 'NCR' AND s.source_ref = CAST(t.id AS TEXT) AND s.active = 1 JOIN bill_sub_bills b ON b.id = s.bill_id WHERE t.company_id = :c AND t.deleted_at IS NULL AND t.responsible_type = 'SUBCONTRACTOR' AND b.subcontractor_id IS NOT t.responsible_id",
        } },
    ],
  },
  {
    code: 'IT-11', name: 'Month-end close: tasks, module locks and the closed period',
    modules: ['fin', 'bi'],
    handoffs: [
      h('IT-11.1', 'Close task of its month-end close', 'close_tasks', 'close_periods', { ref: 'task_code', fk: 'close_id', required: '1 = 1' }),
      h('IT-11.2', 'Month-end close of a financial period', 'close_periods', 'core_periods', { fk: 'period_id', required: '1 = 1', inherit: [['period', "substr(f.start_date, 1, 7)", 'Month of the period']] }),
      { code: 'IT-11.3', label: 'A closed month has every mandatory task done', to: 'close_periods', from: 'close_tasks', ref: 'doc_no',
        custom: {
          total: "SELECT COUNT(*) AS n FROM close_periods t WHERE t.company_id = :c AND t.deleted_at IS NULL AND t.close_state = 'CLOSED'",
          broken: "SELECT t.id, t.doc_no AS ref, k.task_code AS detail FROM close_periods t JOIN close_tasks k ON k.close_id = t.id AND k.deleted_at IS NULL AND k.mandatory = 1 AND k.task_status NOT IN ('DONE', 'NOT_APPLICABLE') WHERE t.company_id = :c AND t.deleted_at IS NULL AND t.close_state = 'CLOSED'",
        } },
      h('IT-11.4', 'Project monthly close of a financial period', 'mc_monthly_closes', 'core_periods', { fk: 'period_id', inherit: [['period', "substr(f.start_date, 1, 7)", 'Month of the period']] }),
    ],
  },
  {
    code: 'IT-12', name: 'Purchase order → budget commitment → actual cost',
    modules: ['proc', 'bud', 'inv'],
    handoffs: [
      { code: 'IT-12.1', label: 'Budget commitment of a purchase order', to: 'bud_commitments', from: 'proc_purchase_orders', ref: 'doc_ref',
        custom: {
          total: "SELECT COUNT(*) AS n FROM bud_commitments t WHERE t.company_id = :c AND t.deleted_at IS NULL AND t.src_type = 'proc_purchase_orders'",
          broken: "SELECT t.id, t.doc_ref AS ref, 'order ' || t.src_id AS detail FROM bud_commitments t LEFT JOIN proc_purchase_orders f ON f.id = CAST(t.src_id AS INTEGER) WHERE t.company_id = :c AND t.deleted_at IS NULL AND t.src_type = 'proc_purchase_orders' AND f.id IS NULL",
          rekeyed: "SELECT t.id, t.doc_ref AS ref, 'org_project_id' AS field, t.org_project_id AS value, f.org_project_id AS source FROM bud_commitments t JOIN proc_purchase_orders f ON f.id = CAST(t.src_id AS INTEGER) WHERE t.company_id = :c AND t.deleted_at IS NULL AND t.src_type = 'proc_purchase_orders' AND t.org_project_id IS NOT f.org_project_id",
        } },
      h('IT-12.2', 'Actual cost consuming its commitment', 'bud_actuals', 'bud_commitments', { ref: 'doc_ref', fk: 'commitment_id', inherit: [['org_project_id', 'org_project_id', 'Project of the commitment'], ['cost_code_id', 'cost_code_id', 'Cost code of the commitment']], events: ['bud.actual.posted'], consumers: ['site.control'] }),
    ],
  },
  {
    code: 'IT-13', name: 'Goods receipt → material test → acceptance',
    modules: ['inv', 'qa'],
    handoffs: [
      h('IT-13.1', 'Material test of a received consignment', 'qa_test_requests', 'inv_grns', { fk: 'grn_id', inherit: [['org_project_id', 'org_project_id', 'Project of the GRN']] }),
    ],
  },
  {
    code: 'IT-14', name: 'Plant hire agreement → hire bill → vendor invoice',
    modules: ['plant', 'bill'],
    handoffs: [
      h('IT-14.1', 'Hire bill under its agreement', 'plt_hire_bills', 'plt_hire_agreements', { fk: 'agreement_id', required: '1 = 1' }),
      h('IT-14.2', 'Vendor invoice of a hire bill', 'bill_vendor_invoices', 'plt_hire_bills', { fk: 'hire_bill_id', required: "t.invoice_kind = 'HIRE'" }),
    ],
  },
  {
    code: 'IT-15', name: 'Daily progress report → measurement book',
    modules: ['site', 'bill'],
    handoffs: [
      h('IT-15.1', 'Measurement from a DPR progress line', 'bill_mb_entries', 'site_dpr_work', { fk: 'dpr_work_id', inherit: [['wa_id', 'wa_id', 'WA of the DPR line'], ['activity_id', 'activity_id', 'Activity of the DPR line']] }),
      h('IT-15.2', 'Measurement against its work authorisation', 'bill_mb_entries', 'site_work_authorisations', { fk: 'wa_id', inherit: [['org_project_id', 'org_project_id', 'Project of the WA']] }),
    ],
  },
]);

/** Every hand-off with its thread, for the matrix and the document. */
export const HANDOFFS = Object.freeze(THREADS.flatMap((t) => t.handoffs.map((x) => ({ ...x, thread: t.code }))));

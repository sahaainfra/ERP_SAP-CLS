import { LEGACY_ROLE_PERMISSIONS } from './legacy.js';

// The system role templates (part 02.04): the 23 owner roles and the supporting and external roles of docs 06_ROLE_CATALOGUE.md.
// They are seeded as locked system roles (administrators clone them into editable copies). The permissions of the nine roles that
// existed before the engine are exactly their old access plus the new role and assignment permissions below; every other role starts
// with the ability to see the organisation context and grows as modules register permissions and add them to their templates here.

/** What this part adds. Everything else a role holds is from LEGACY_ROLE_PERMISSIONS (see legacy.js). */
export const PERMISSIONS_02_04 = ['iam.role.view', 'iam.role.manage', 'iam.assignment.view', 'iam.assignment.manage'];

/** What part 02.05 adds: segregation of duties, privileged access and access reviews. */
export const PERMISSIONS_02_05 = ['iam.sod.view', 'iam.sod.manage', 'iam.sod.resolve', 'iam.elevation.request', 'iam.elevation.view', 'iam.elevation.revoke', 'iam.review.view', 'iam.review.manage', 'iam.review.decide'];

/** Permissions a role has now that it did not have before the role engine: the legacy comparison counts these as expected, not as gained access. */
export const PERMISSIONS_02_06 = ['core.audit.view', 'core.audit.verify', 'core.security.view'];
export const PERMISSIONS_02_07 = ['core.routes.view', 'core.security.configure', 'iam.user.export'];
export const PERMISSIONS_03_01 = ['ui.styleguide.view'];
export const PERMISSIONS_03_03 = ['ui.view.share'];
export const PERMISSIONS_03_05 = ['ui.nav.manage', 'ui.console.view'];
export const PERMISSIONS_03_07 = ['ui.dashboard.manage'];
export const PERMISSIONS_03_08 = ['ui.search.reindex', 'ui.search.analytics'];
export const PERMISSIONS_03_09 = ['ui.translation.manage'];
export const PERMISSIONS_03_10 = ['ui.migration.view', 'ui.migration.signoff'];
export const PERMISSIONS_04_01 = ['eng.workflow.view', 'eng.workflow.define', 'eng.workflow.cancel', 'eng.workflow.admin', 'eng.sample.use'];
export const PERMISSIONS_04_02 = ['eng.matrix.view', 'eng.matrix.manage', 'eng.delegation.use', 'eng.delegation.admin'];
export const PERMISSIONS_04_04 = ['eng.pcs.view', 'eng.pcs.manage', 'eng.pcs.raise', 'eng.pcs.emergency'];
export const PERMISSIONS_04_05 = ['acc.raci.view', 'acc.raci.maintain', 'acc.ledger.view', 'acc.report.view'];
export const PERMISSIONS_04_06 = ['ntf.template.view', 'ntf.template.edit', 'ntf.delivery.view', 'ntf.delivery.retry'];
export const PERMISSIONS_04_07 = ['comm.channel.view', 'comm.channel.edit', 'comm.log.view', 'comm.consent.view', 'comm.consent.edit'];
export const PERMISSIONS_04_10 = ['doc.document.view', 'doc.document.view_confidential', 'doc.document.view_restricted', 'doc.document.create', 'doc.document.manage', 'doc.config.view', 'doc.config.edit'];
export const PERMISSIONS_04_11 = ['tpl.template.view', 'tpl.template.edit', 'tpl.rule.edit', 'tpl.record.publish', 'tpl.document.view', 'tpl.document.generate', 'tpl.document.generate_sensitive', 'tpl.document.deliver'];
export const PERMISSIONS_04_12 = ['sig.register.view', 'sig.signature.revoke', 'sig.document.view', 'sig.document.sign', 'sig.document.cancel', 'sig.config.view', 'sig.config.edit'];
export const PERMISSIONS_05_05 = ['pol.policy.create', 'pol.policy.view_all', 'pol.requirement.manage', 'pol.draft.view'];
export const PERMISSIONS_11_05 = ['engg.letter.view', 'engg.letter.create', 'engg.letter.edit', 'engg.letter.delete', 'engg.letter.submit', 'engg.letter.approve', 'engg.letter.cancel', 'engg.letter.amend', 'engg.letter.print', 'engg.letter.export', 'engg.letter.issue', 'engg.letter.view_confidential'];
export const PERMISSIONS_18_01 = [...['quality_plan', 'itp', 'template', 'inspection'].flatMap((r) => ['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export'].map((a) => `qa.${r}.${a}`)), 'qa.itp.apply'];
export const PERMISSIONS_18_02 = ['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export'].map((a) => `qa.inspection_request.${a}`);
export const PERMISSIONS_18_03 = [...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export'].map((a) => `qa.test_request.${a}`), ...['view', 'create', 'edit', 'delete', 'export'].map((a) => `qa.test_catalogue.${a}`), ...['view', 'create', 'edit', 'delete', 'calibrate', 'export'].map((a) => `qa.lab_equipment.${a}`)];
export const PERMISSIONS_18_04 = [...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export'].map((a) => `qa.ncr.${a}`), 'qa.ncr.rectify', 'qa.ncr.costs'];
export const PERMISSIONS_18_05 = [...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export'].map((a) => `qa.pour_card.${a}`), 'qa.pour_card.record', 'qa.cube.test'];
export const PERMISSIONS_18_06 = ['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export'].map((a) => `qa.snag.${a}`);
export const PERMISSIONS_22_09 = ['bill.report.view', 'bill.report.create', 'bill.report.edit', 'bill.report.delete', 'bill.report.submit', 'bill.report.approve', 'bill.report.cancel', 'bill.report.amend', 'bill.report.print', 'bill.report.export', 'bill.control_tower.view', 'bill.control_tower.export', 'bill.control_tower.margin'];
// Part 07.14 (built in 166.6): the workforce dashboard and the gates G1–G4 (view, review the criteria and send for sign-off, export the report).
export const PERMISSIONS_07_14 = ['hr.workforce.view', 'hr.gate.view', 'hr.gate.review', 'hr.gate.export'];
export const PERMISSIONS_22_08 = ['bill.qs_dashboard.view', 'bill.qs_dashboard.export', 'bill.qs_dashboard.margin'];
export const PERMISSIONS_22_07 = ['bill.advance.view', 'bill.advance.create', 'bill.advance.edit', 'bill.advance.delete', 'bill.advance.submit', 'bill.advance.approve', 'bill.advance.cancel', 'bill.advance.amend', 'bill.advance.print', 'bill.advance.export', 'bill.release.view', 'bill.release.create', 'bill.release.edit', 'bill.release.delete', 'bill.release.submit', 'bill.release.approve', 'bill.release.cancel', 'bill.release.amend', 'bill.release.print', 'bill.release.export', 'bill.retention.view', 'bill.retention.export'];
export const PERMISSIONS_22_06 = ['bill.vendor_invoice.view', 'bill.vendor_invoice.create', 'bill.vendor_invoice.edit', 'bill.vendor_invoice.delete', 'bill.vendor_invoice.submit', 'bill.vendor_invoice.approve', 'bill.vendor_invoice.cancel', 'bill.vendor_invoice.amend', 'bill.vendor_invoice.print', 'bill.vendor_invoice.export', 'bill.vendor_invoice.resolve', 'bill.invoice_hub.view'];
export const PERMISSIONS_24_04 = ['pay.stat.calendar.view', 'pay.stat.filing.view', 'pay.stat.filing.create', 'pay.stat.filing.edit', 'pay.stat.filing.delete', 'pay.stat.filing.submit', 'pay.stat.filing.approve', 'pay.stat.filing.cancel', 'pay.stat.filing.print', 'pay.stat.filing.export', 'pay.stat.register.view', 'pay.stat.register.generate', 'pay.stat.register.export', 'pay.stat.form16.generate', 'pay.stat.bocw.view', 'pay.stat.bocw.manage', 'pay.stat.rule.view', 'pay.stat.rule.configure'];
export const PERMISSIONS_24_03 = ['pay.wage_run.view', 'pay.wage_run.create', 'pay.wage_run.edit', 'pay.wage_run.delete', 'pay.wage_run.submit', 'pay.wage_run.approve', 'pay.wage_run.cancel', 'pay.wage_run.amend', 'pay.wage_run.print', 'pay.wage_run.export', 'pay.wage_run.disburse', 'pay.wage_run.acknowledge', 'pay.wage_rate.view', 'pay.wage_check.view', 'pay.wage_check.manage', 'pay.wage_check.verify'];
export const PERMISSIONS_24_02 = ['pay.run.view', 'pay.run.create', 'pay.run.edit', 'pay.run.delete', 'pay.run.submit', 'pay.run.approve', 'pay.run.cancel', 'pay.run.amend', 'pay.run.print', 'pay.run.export', 'pay.input.manage', 'pay.declaration.own', 'pay.declaration.view', 'pay.declaration.verify'];
export const PERMISSIONS_24_01 = ['pay.component.view', 'pay.component.configure', 'pay.structure.view', 'pay.structure.configure', 'pay.assignment.view', 'pay.assignment.create', 'pay.assignment.edit', 'pay.assignment.delete', 'pay.assignment.submit', 'pay.assignment.approve', 'pay.assignment.cancel', 'pay.assignment.amend', 'pay.assignment.print', 'pay.assignment.export', 'pay.statutory.view', 'pay.statutory.create', 'pay.statutory.edit', 'pay.statutory.delete', 'pay.statutory.submit', 'pay.statutory.approve', 'pay.statutory.cancel', 'pay.calendar.view', 'pay.calendar.configure', 'pay.salary.view'];
export const PERMISSIONS_23_15 = ['fin.transaction.view', 'fin.transaction.create', 'fin.transaction.edit', 'fin.transaction.delete', 'fin.transaction.submit', 'fin.transaction.approve', 'fin.transaction.cancel', 'fin.transaction.amend', 'fin.transaction.print', 'fin.transaction.export', 'fin.ic.configure', 'fin.consolidation.view', 'fin.consolidation.run', 'fin.consolidation.finalise', 'fin.jv.view', 'fin.jv.manage'];
export const PERMISSIONS_23_14 = ['fin.period.view', 'fin.period.create', 'fin.period.edit', 'fin.period.delete', 'fin.period.submit', 'fin.period.approve', 'fin.period.cancel', 'fin.period.amend', 'fin.period.print', 'fin.period.export', 'fin.period.configure', 'fin.close_task.complete', 'fin.period_reopen.view', 'fin.period_reopen.create', 'fin.period_reopen.edit', 'fin.period_reopen.delete', 'fin.period_reopen.submit', 'fin.period_reopen.approve', 'fin.period_reopen.cancel', 'fin.statements.view', 'fin.statements.export', 'fin.dashboard.view'];
export const PERMISSIONS_23_13 = ['fin.cash_forecast.view', 'fin.cash_forecast.create', 'fin.cash_forecast.edit', 'fin.cash_forecast.delete', 'fin.cash_forecast.submit', 'fin.cash_forecast.approve', 'fin.cash_forecast.cancel', 'fin.cash_forecast.amend', 'fin.cash_forecast.print', 'fin.cash_forecast.export', 'fin.cash_forecast.manage', 'fin.cash_curve.view'];
export const PERMISSIONS_23_12 = ['fin.pl.view', 'fin.pl.view_overheads', 'fin.pl.configure', 'fin.pl_snapshot.view', 'fin.pl_snapshot.create', 'fin.pl_snapshot.edit', 'fin.pl_snapshot.delete', 'fin.pl_snapshot.submit', 'fin.pl_snapshot.approve', 'fin.pl_snapshot.cancel', 'fin.pl_snapshot.amend', 'fin.pl_snapshot.print', 'fin.pl_snapshot.export'];
export const PERMISSIONS_23_11 = ['fin.forecast.view', 'fin.forecast.create', 'fin.forecast.edit', 'fin.forecast.delete', 'fin.forecast.submit', 'fin.forecast.approve', 'fin.forecast.cancel', 'fin.forecast.amend', 'fin.forecast.print', 'fin.forecast.export'];
export const PERMISSIONS_23_10 = ['fin.revenue_recognition.view', 'fin.revenue_recognition.create', 'fin.revenue_recognition.edit', 'fin.revenue_recognition.delete', 'fin.revenue_recognition.submit', 'fin.revenue_recognition.approve', 'fin.revenue_recognition.cancel', 'fin.revenue_recognition.amend', 'fin.revenue_recognition.print', 'fin.revenue_recognition.export', 'fin.project_ledger.view', 'fin.project_ledger.export', 'fin.overhead.post'];
export const PERMISSIONS_23_09 = ['fin.asset.view', 'fin.asset.create', 'fin.asset.edit', 'fin.asset.delete', 'fin.asset.submit', 'fin.asset.approve', 'fin.asset.cancel', 'fin.asset.amend', 'fin.asset.print', 'fin.asset.export', 'fin.asset.transfer', 'fin.asset.verify', 'fin.disposal.view', 'fin.disposal.create', 'fin.disposal.edit', 'fin.disposal.delete', 'fin.disposal.submit', 'fin.disposal.approve', 'fin.disposal.cancel', 'fin.disposal.amend', 'fin.disposal.print', 'fin.disposal.export', 'fin.depreciation.view', 'fin.depreciation.run'];
export const PERMISSIONS_23_08 = ['fin.gst_recon.view', 'fin.gst_recon.import', 'fin.gst_recon.manage', 'fin.gst_recon.export', 'fin.itc_review.view', 'fin.itc_review.create', 'fin.itc_review.edit', 'fin.itc_review.delete', 'fin.itc_review.submit', 'fin.itc_review.approve', 'fin.itc_review.cancel', 'fin.itc_review.amend', 'fin.itc_review.print', 'fin.itc_review.export', 'fin.gst_return.view', 'fin.gst_return.prepare', 'fin.gst_return.file', 'fin.gst_return.export', 'fin.tds_return.view', 'fin.tds_return.prepare', 'fin.tds_return.file', 'fin.tds_return.export', 'fin.tds_return.certificate'];
export const PERMISSIONS_23_07 = ['fin.gst.resolve', 'fin.gstin.check', 'fin.gst_setting.view', 'fin.gst_setting.create', 'fin.gst_setting.edit', 'fin.gst_setting.delete', 'fin.gst_setting.submit', 'fin.gst_setting.approve', 'fin.gst_setting.cancel', 'fin.gst_setting.export', 'fin.einvoice.view', 'fin.einvoice.generate', 'fin.einvoice.retry', 'fin.einvoice.cancel', 'fin.einvoice.print', 'fin.einvoice.export', 'fin.ewaybill.view', 'fin.ewaybill.generate', 'fin.ewaybill.update', 'fin.ewaybill.extend', 'fin.ewaybill.cancel', 'fin.ewaybill.retry', 'fin.ewaybill.print', 'fin.ewaybill.export'];
export const PERMISSIONS_23_06 = ['fin.imprest_voucher.view', 'fin.imprest_voucher.create', 'fin.imprest_voucher.edit', 'fin.imprest_voucher.delete', 'fin.imprest_voucher.submit', 'fin.imprest_voucher.approve', 'fin.imprest_voucher.cancel', 'fin.imprest_voucher.amend', 'fin.imprest_voucher.print', 'fin.imprest_voucher.export', 'fin.imprest_replenishment.view', 'fin.imprest_replenishment.create', 'fin.imprest_replenishment.edit', 'fin.imprest_replenishment.delete', 'fin.imprest_replenishment.submit', 'fin.imprest_replenishment.approve', 'fin.imprest_replenishment.cancel', 'fin.imprest_replenishment.amend', 'fin.imprest_replenishment.print', 'fin.imprest_replenishment.export', 'fin.bank_statement.view', 'fin.bank_statement.import', 'fin.bank_statement.match', 'fin.brs.view', 'fin.brs.sign', 'fin.imprest.view', 'fin.imprest.manage', 'fin.imprest.count', 'fin.contra.view', 'fin.contra.create', 'fin.contra.edit', 'fin.contra.delete', 'fin.contra.submit', 'fin.contra.approve', 'fin.contra.cancel', 'fin.contra.print', 'fin.cash_position.view'];
export const PERMISSIONS_23_05 = ['fin.invoice.view', 'fin.invoice.create', 'fin.invoice.edit', 'fin.invoice.delete', 'fin.invoice.submit', 'fin.invoice.approve', 'fin.invoice.cancel', 'fin.invoice.amend', 'fin.invoice.print', 'fin.invoice.export', 'fin.receipt.view', 'fin.receipt.create', 'fin.receipt.edit', 'fin.receipt.delete', 'fin.receipt.submit', 'fin.receipt.approve', 'fin.receipt.cancel', 'fin.receipt.amend', 'fin.receipt.print', 'fin.receipt.export', 'fin.credit_note.view', 'fin.credit_note.create', 'fin.credit_note.delete', 'fin.credit_note.submit', 'fin.credit_note.approve', 'fin.credit_note.cancel', 'fin.credit_note.print', 'fin.writeoff.view', 'fin.writeoff.create', 'fin.writeoff.submit', 'fin.writeoff.approve', 'fin.writeoff.cancel', 'fin.followup.view', 'fin.followup.create'];
export const PERMISSIONS_23_04 = ['fin.proposal.view', 'fin.proposal.create', 'fin.proposal.edit', 'fin.proposal.delete', 'fin.proposal.submit', 'fin.proposal.approve', 'fin.proposal.cancel', 'fin.proposal.amend', 'fin.proposal.print', 'fin.proposal.export', 'fin.payment.view', 'fin.payment.create', 'fin.payment.edit', 'fin.payment.delete', 'fin.payment.submit', 'fin.payment.approve', 'fin.payment.cancel', 'fin.payment.amend', 'fin.payment.print', 'fin.payment.export', 'fin.payment.release', 'fin.payment.confirm', 'fin.bank.view', 'fin.bank.manage'];
export const PERMISSIONS_23_03 = ['fin.bill.view', 'fin.bill.create', 'fin.bill.edit', 'fin.bill.delete', 'fin.bill.submit', 'fin.bill.approve', 'fin.bill.cancel', 'fin.bill.amend', 'fin.bill.print', 'fin.bill.export', 'fin.bill.hold', 'fin.debit_note.view', 'fin.debit_note.create', 'fin.debit_note.edit', 'fin.debit_note.delete', 'fin.debit_note.submit', 'fin.debit_note.approve', 'fin.debit_note.cancel', 'fin.debit_note.amend', 'fin.debit_note.print', 'fin.debit_note.export'];
export const PERMISSIONS_23_02 = ['fin.posting_rule.view', 'fin.posting_rule.edit', 'fin.posting_rule.delete', 'fin.posting_rule.submit', 'fin.posting_rule.cancel', 'fin.posting_rule.approve', 'fin.posting.view', 'fin.posting.repost', 'fin.posting.resolve', 'fin.replay.view', 'fin.replay.create', 'fin.replay.edit', 'fin.replay.delete', 'fin.replay.submit', 'fin.replay.cancel', 'fin.replay.approve'];
export const PERMISSIONS_23_01 = ['fin.journal.view', 'fin.journal.create', 'fin.journal.edit', 'fin.journal.delete', 'fin.journal.submit', 'fin.journal.approve', 'fin.journal.cancel', 'fin.journal.amend', 'fin.journal.print', 'fin.journal.export', 'fin.ledger.view', 'fin.recurring.manage'];
export const PERMISSIONS_22_05 = ['bill.sub_bill.view', 'bill.sub_bill.create', 'bill.sub_bill.edit', 'bill.sub_bill.delete', 'bill.sub_bill.submit', 'bill.sub_bill.approve', 'bill.sub_bill.cancel', 'bill.sub_bill.amend', 'bill.sub_bill.print', 'bill.sub_bill.export', 'bill.sub_measure.view', 'bill.sub_measure.create', 'bill.sub_measure.sign', 'bill.sub_measure.verify', 'bill.sub_measure.cancel', 'bill.sub_measure.export'];
export const PERMISSIONS_22_04 = ['bill.certification.view', 'bill.certification.create', 'bill.certification.edit', 'bill.certification.delete', 'bill.certification.submit', 'bill.certification.approve', 'bill.certification.cancel', 'bill.certification.amend', 'bill.certification.print', 'bill.certification.export', 'bill.tax_invoice.view', 'bill.tax_invoice.create', 'bill.tax_invoice.edit', 'bill.tax_invoice.delete', 'bill.tax_invoice.submit', 'bill.tax_invoice.approve', 'bill.tax_invoice.cancel', 'bill.tax_invoice.amend', 'bill.tax_invoice.print', 'bill.tax_invoice.export', 'bill.tax_invoice.irn'];
export const PERMISSIONS_22_03 = ['bill.client_bill.view', 'bill.client_bill.create', 'bill.client_bill.edit', 'bill.client_bill.delete', 'bill.client_bill.submit', 'bill.client_bill.approve', 'bill.client_bill.cancel', 'bill.client_bill.amend', 'bill.client_bill.print', 'bill.client_bill.export', 'bill.client_bill.send'];
export const PERMISSIONS_22_02 = ['bill.deviation_statement.view', 'bill.deviation_statement.create', 'bill.deviation_statement.edit', 'bill.deviation_statement.delete', 'bill.deviation_statement.submit', 'bill.deviation_statement.approve', 'bill.deviation_statement.cancel', 'bill.deviation_statement.amend', 'bill.deviation_statement.print', 'bill.deviation_statement.export', 'bill.deviation_statement.client', 'bill.extra_item.view', 'bill.extra_item.create', 'bill.extra_item.edit', 'bill.extra_item.delete', 'bill.extra_item.decide', 'bill.extra_item.export', 'bill.qty_recon.view', 'bill.qty_recon.forecast', 'bill.qty_recon.export'];
export const PERMISSIONS_22_01 = ['bill.mb_entry.view', 'bill.mb_entry.create', 'bill.mb_entry.edit', 'bill.mb_entry.delete', 'bill.mb_entry.submit', 'bill.mb_entry.approve', 'bill.mb_entry.cancel', 'bill.mb_entry.amend', 'bill.mb_entry.print', 'bill.mb_entry.export', 'bill.mb_entry.check'];
export const PERMISSIONS_21_07 = ['ctr.pvc.view', 'ctr.pvc.edit', 'ctr.escalation.view', 'ctr.escalation.create', 'ctr.escalation.edit', 'ctr.escalation.delete', 'ctr.escalation.submit', 'ctr.escalation.approve', 'ctr.escalation.cancel', 'ctr.escalation.amend', 'ctr.escalation.print', 'ctr.escalation.export', 'ctr.ld.view', 'ctr.ld.assess', 'ctr.ld.record'];
export const PERMISSIONS_21_06 = ['ctr.claim.view', 'ctr.claim.create', 'ctr.claim.edit', 'ctr.claim.delete', 'ctr.claim.submit', 'ctr.claim.approve', 'ctr.claim.cancel', 'ctr.claim.amend', 'ctr.claim.print', 'ctr.claim.export', 'ctr.claim.respond', 'ctr.dispute.view', 'ctr.dispute.create', 'ctr.dispute.edit', 'ctr.dispute.delete', 'ctr.dispute.submit', 'ctr.dispute.approve', 'ctr.dispute.cancel', 'ctr.dispute.amend', 'ctr.dispute.print', 'ctr.dispute.export', 'ctr.dispute.log'];
export const PERMISSIONS_21_05 = ['ctr.change.view', 'ctr.change.create', 'ctr.change.edit', 'ctr.change.delete', 'ctr.change.submit', 'ctr.change.approve', 'ctr.change.cancel', 'ctr.change.amend', 'ctr.change.print', 'ctr.change.export', 'ctr.change.review', 'ctr.change.evaluate', 'ctr.change.respond', 'ctr.variation.view', 'ctr.variation.create', 'ctr.variation.edit', 'ctr.variation.delete', 'ctr.variation.submit', 'ctr.variation.approve', 'ctr.variation.cancel', 'ctr.variation.amend', 'ctr.variation.print', 'ctr.variation.export'];
export const PERMISSIONS_21_04 = ['ctr.sub_workspace.view', 'ctr.sub_compliance.view', 'ctr.sub_compliance.compile', 'ctr.sub_compliance.verify', 'ctr.sub_compliance.export', 'ctr.sub_waiver.view', 'ctr.sub_waiver.create', 'ctr.sub_waiver.edit', 'ctr.sub_waiver.delete', 'ctr.sub_waiver.submit', 'ctr.sub_waiver.approve', 'ctr.sub_waiver.cancel', 'ctr.sub_manpower.manage', 'ctr.sub_rating.run'];
export const PERMISSIONS_21_03 = ['ctr.work_order.view', 'ctr.work_order.create', 'ctr.work_order.edit', 'ctr.work_order.delete', 'ctr.work_order.submit', 'ctr.work_order.approve', 'ctr.work_order.cancel', 'ctr.work_order.amend', 'ctr.work_order.print', 'ctr.work_order.export', 'ctr.work_order.accept', 'ctr.work_order.close', 'ctr.work_order.margin'];
export const PERMISSIONS_21_02 = ['ctr.bank_guarantee.view', 'ctr.bank_guarantee.create', 'ctr.bank_guarantee.edit', 'ctr.bank_guarantee.delete', 'ctr.bank_guarantee.submit', 'ctr.bank_guarantee.approve', 'ctr.bank_guarantee.cancel', 'ctr.bank_guarantee.amend', 'ctr.bank_guarantee.print', 'ctr.bank_guarantee.export', 'ctr.bank_guarantee.request', 'ctr.bank_guarantee.confirm', 'ctr.insurance.view', 'ctr.insurance.create', 'ctr.insurance.edit', 'ctr.insurance.delete', 'ctr.insurance.submit', 'ctr.insurance.approve', 'ctr.insurance.cancel', 'ctr.insurance.amend', 'ctr.insurance.print', 'ctr.insurance.export', 'ctr.insurance.claim', 'ctr.bank_limit.manage'];
export const PERMISSIONS_21_01 = ['ctr.contract.view', 'ctr.contract.create', 'ctr.contract.edit', 'ctr.contract.delete', 'ctr.contract.submit', 'ctr.contract.approve', 'ctr.contract.cancel', 'ctr.contract.amend', 'ctr.contract.print', 'ctr.contract.export', 'ctr.contract.value', 'ctr.amendment.view', 'ctr.amendment.create', 'ctr.amendment.edit', 'ctr.amendment.delete', 'ctr.amendment.submit', 'ctr.amendment.approve', 'ctr.amendment.cancel', 'ctr.amendment.amend', 'ctr.amendment.print', 'ctr.amendment.export', 'ctr.clause.manage', 'ctr.obligation.view', 'ctr.obligation.manage', 'ctr.obligation.complete', 'ctr.milestone.manage', 'ctr.milestone.achieve'];
export const PERMISSIONS_20_03 = ['rmc.cost.view', 'rmc.cost.collect', 'rmc.cost.input', 'rmc.cost.close', 'rmc.cost.reopen', 'rmc.cost.export', 'rmc.transfer_rate.view', 'rmc.transfer_rate.create', 'rmc.transfer_rate.edit', 'rmc.transfer_rate.delete', 'rmc.transfer_rate.submit', 'rmc.transfer_rate.approve', 'rmc.transfer_rate.cancel', 'rmc.transfer_rate.amend', 'rmc.transfer_rate.print', 'rmc.transfer_rate.export', 'rmc.budget.view', 'rmc.budget.edit'];
export const PERMISSIONS_20_02 = ['rmc.requisition.view', 'rmc.requisition.create', 'rmc.requisition.edit', 'rmc.requisition.delete', 'rmc.requisition.submit', 'rmc.requisition.approve', 'rmc.requisition.cancel', 'rmc.requisition.amend', 'rmc.requisition.print', 'rmc.requisition.export', 'rmc.requisition.schedule', 'rmc.delivery_ticket.view', 'rmc.delivery_ticket.create', 'rmc.delivery_ticket.edit', 'rmc.delivery_ticket.delete', 'rmc.delivery_ticket.submit', 'rmc.delivery_ticket.approve', 'rmc.delivery_ticket.cancel', 'rmc.delivery_ticket.amend', 'rmc.delivery_ticket.print', 'rmc.delivery_ticket.export', 'rmc.delivery_ticket.receive', 'rmc.batch.view', 'rmc.batch.record', 'rmc.batch.import', 'rmc.batch.cancel', 'rmc.consumption.view', 'rmc.consumption.export'];
export const PERMISSIONS_20_01 = ['rmc.plant.view', 'rmc.plant.create', 'rmc.plant.edit', 'rmc.plant.delete', 'rmc.plant.submit', 'rmc.plant.approve', 'rmc.plant.cancel', 'rmc.plant.amend', 'rmc.plant.print', 'rmc.plant.export', 'rmc.mix_design.view', 'rmc.mix_design.create', 'rmc.mix_design.edit', 'rmc.mix_design.delete', 'rmc.mix_design.submit', 'rmc.mix_design.approve', 'rmc.mix_design.cancel', 'rmc.mix_design.amend', 'rmc.mix_design.print', 'rmc.mix_design.export', 'rmc.silo.edit', 'rmc.scale.edit'];
export const PERMISSIONS_19_08 = ['hse.dashboard.view', 'hse.dashboard.export', 'hse.dashboard.report'];
export const PERMISSIONS_19_07 = ['hse.camp.view', 'hse.camp.create', 'hse.camp.edit', 'hse.camp.muster', ...['view', 'create', 'edit', 'cancel', 'export'].map((a) => `hse.allocation.${a}`), 'hse.camp_meal.view', 'hse.camp_meal.record', 'hse.camp_inspection.view', 'hse.camp_inspection.record', 'hse.camp_asset.edit', ...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export'].map((a) => `hse.recovery.${a}`)];
export const PERMISSIONS_19_06 = [...['view', 'create', 'edit'].map((a) => `hse.security_post.${a}`), ...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export'].flatMap((a) => [`hse.roster.${a}`, `hse.visitor.${a}`, `hse.security_incident.${a}`]), 'hse.visitor.checkin', 'hse.patrol.view', 'hse.patrol.scan', 'hse.handover.view', 'hse.handover.create'];
export const PERMISSIONS_19_05 = ['hse.esg.view', 'hse.esg.record', 'hse.esg.export', 'hse.esg.approve', 'hse.esg.configure_factors'];
export const PERMISSIONS_19_04 = [...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export'].map((a) => `hse.observation.${a}`), 'hse.observation.act', 'hse.observation.close', 'hse.observation.penalty', 'hse.ppe.view', 'hse.ppe.give', 'hse.ppe.return', 'hse.ppe.export', ...['view', 'create', 'edit'].map((a) => `hse.ppe_item.${a}`), ...['view', 'create', 'edit', 'delete'].map((a) => `hse.equipment.${a}`), ...['view', 'create', 'edit', 'delete', 'record'].map((a) => `hse.schedule.${a}`), 'hse.contractor_score.view', 'hse.contractor_score.export'];
export const PERMISSIONS_19_03 = [...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export'].map((a) => `hse.incident.${a}`), 'hse.incident.investigate', 'hse.incident.publish', 'hse.lesson.view'];
export const PERMISSIONS_19_02 = [...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export'].map((a) => `hse.permit.${a}`), 'hse.permit.record', 'hse.permit.extend', 'hse.permit.suspend', 'hse.permit.close', 'hse.permit.activate', 'hse.permit.approve_high', ...['view', 'create', 'edit', 'delete'].map((a) => `hse.permit_type.${a}`)];
export const PERMISSIONS_19_01 = [...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export'].flatMap((a) => [`hse.plan.${a}`, `hse.hira.${a}`]), ...['view', 'create', 'edit', 'delete', 'release', 'sign', 'cancel', 'print', 'export'].map((a) => `hse.jsa.${a}`), ...['view', 'create', 'cancel', 'export'].map((a) => `hse.induction.${a}`), ...['view', 'create', 'edit', 'delete'].flatMap((a) => [`hse.induction_content.${a}`, `hse.toolbox_topic.${a}`]), ...['view', 'create', 'edit', 'delete', 'submit', 'cancel', 'print', 'export'].map((a) => `hse.toolbox_talk.${a}`), 'hse.medical.view', 'hse.medical.record'];
export const PERMISSIONS_18_07 = ['qa.dashboard.view', 'qa.dashboard.export'];
export const PERMISSIONS_17_08 = ['plant.capacity.view', 'plant.capacity.refresh', 'plant.capacity.export', ...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'print', 'export'].map((a) => `plant.resource_plan.${a}`)];
export const PERMISSIONS_17_07 = ['plant.fleet.view', 'plant.fleet.costs', 'plant.fleet.cost_entry', 'plant.fleet.snapshot', 'plant.fleet.export', 'plant.telematics.view', 'plant.telematics.ingest', ...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'print', 'export'].map((a) => `plant.disposal_rec.${a}`)];
export const PERMISSIONS_17_06 = [...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export'].flatMap((a) => [`plant.hire_agreement.${a}`, `plant.hire_bill.${a}`]), 'plant.hire.rates', 'plant.hire.report'];
export const PERMISSIONS_17_05 = [...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export', 'import'].map((a) => `plant.job_card.${a}`), 'plant.job_card.work', 'plant.job_card.spares', 'plant.job_card.draw', 'plant.job_card.warranty', 'plant.pm.view', 'plant.pm.manage', 'plant.maint.report', 'plant.maint.costs'];
export const PERMISSIONS_17_04 = [...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export', 'import'].map((a) => `plant.issue.${a}`), 'plant.fuel.receive', 'plant.fuel.dip', 'plant.fuel.configure', 'plant.fuel.report', 'plant.fuel.costs', 'plant.fuel.anomaly', 'plant.fuel.investigate'];
export const PERMISSIONS_17_03 = [...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export', 'import'].map((a) => `plant.log.${a}`), 'plant.log.report', 'plant.log.costs', 'plant.breakdown.report', 'plant.breakdown.resolve'];
export const PERMISSIONS_17_02 = [...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export', 'import'].map((a) => `plant.requisition.${a}`), 'plant.requisition.hire', ...['view', 'create', 'edit', 'delete', 'submit', 'approve', 'cancel', 'amend', 'print', 'export', 'import'].map((a) => `plant.allocation.${a}`), 'plant.allocation.mobilise', 'plant.allocation.transfer', 'plant.allocation.rates', 'plant.operator.assign'];
export const PERMISSIONS_17_01 = ['plant.equipment.view', 'plant.equipment.create', 'plant.equipment.edit', 'plant.equipment.delete', 'plant.equipment.submit', 'plant.equipment.approve', 'plant.equipment.cancel', 'plant.equipment.amend', 'plant.equipment.print', 'plant.equipment.export', 'plant.equipment.import', 'plant.equipment.status', 'plant.equipment.values', 'plant.document.manage'];
export const PERMISSIONS_16_11 = ['inv.dashboard.view', 'inv.dashboard.export'];
export const PERMISSIONS_16_10 = ['inv.reconciliation.view', 'inv.reconciliation.create', 'inv.reconciliation.edit', 'inv.reconciliation.delete', 'inv.reconciliation.submit', 'inv.reconciliation.approve', 'inv.reconciliation.cancel', 'inv.reconciliation.amend', 'inv.reconciliation.print', 'inv.reconciliation.export', 'inv.reconciliation.import', 'inv.reconciliation.configure', 'inv.reconciliation.contribute'];
export const PERMISSIONS_16_09 = ['inv.small_asset.view', 'inv.small_asset.create', 'inv.small_asset.edit', 'inv.small_asset.delete', 'inv.small_asset.submit', 'inv.small_asset.approve', 'inv.small_asset.cancel', 'inv.small_asset.amend', 'inv.small_asset.print', 'inv.small_asset.export', 'inv.small_asset.import', 'inv.small_asset.custody', 'inv.small_asset.acknowledge', 'inv.small_asset.dispose', 'inv.small_asset.statement', 'inv.loss_report.view', 'inv.loss_report.create', 'inv.loss_report.edit', 'inv.loss_report.delete', 'inv.loss_report.submit', 'inv.loss_report.approve', 'inv.loss_report.cancel', 'inv.loss_report.amend', 'inv.loss_report.print', 'inv.loss_report.export'];
export const PERMISSIONS_16_08 = ['inv.movement.view', 'inv.movement.create', 'inv.movement.edit', 'inv.movement.delete', 'inv.movement.submit', 'inv.movement.approve', 'inv.movement.cancel', 'inv.movement.amend', 'inv.movement.print', 'inv.movement.export', 'inv.movement.import', 'inv.rta_asset.edit', 'inv.rta_hire.view', 'inv.rta_hire.verify', 'inv.rta_hire.export', 'inv.rta_recovery.view', 'inv.rta_recovery.submit', 'inv.rta_recovery.approve'];
export const PERMISSIONS_16_07 = ['inv.reorder.view', 'inv.reorder.edit', 'inv.reorder.submit', 'inv.reorder.approve', 'inv.reorder.cancel', 'inv.reorder.export', 'inv.reorder.import', 'inv.reorder.suggest', 'inv.ageing.view', 'inv.ageing.export', 'inv.label.view', 'inv.label.print'];
export const PERMISSIONS_16_06 = ['inv.count_plan.view', 'inv.count_plan.create', 'inv.count_plan.edit', 'inv.count_plan.delete', 'inv.count_plan.submit', 'inv.count_plan.approve', 'inv.count_plan.cancel', 'inv.count_plan.amend', 'inv.count_plan.print', 'inv.count_plan.export', 'inv.count_plan.import', 'inv.count_plan.start', 'inv.count_plan.count', 'inv.count_plan.review', 'inv.scrap_disposal.view', 'inv.scrap_disposal.create', 'inv.scrap_disposal.edit', 'inv.scrap_disposal.delete', 'inv.scrap_disposal.submit', 'inv.scrap_disposal.approve', 'inv.scrap_disposal.cancel', 'inv.scrap_disposal.amend', 'inv.scrap_disposal.print', 'inv.scrap_disposal.export', 'inv.scrap_disposal.import', 'inv.scrap_disposal.register'];
export const PERMISSIONS_16_05 = ['inv.transfer.view', 'inv.transfer.create', 'inv.transfer.edit', 'inv.transfer.delete', 'inv.transfer.submit', 'inv.transfer.approve', 'inv.transfer.cancel', 'inv.transfer.amend', 'inv.transfer.print', 'inv.transfer.export', 'inv.transfer.import', 'inv.transfer.dispatch', 'inv.transfer.receive', 'inv.transfer.resolve'];
export const PERMISSIONS_16_04 = ['inv.issue.view', 'inv.issue.create', 'inv.issue.edit', 'inv.issue.delete', 'inv.issue.submit', 'inv.issue.approve', 'inv.issue.cancel', 'inv.issue.amend', 'inv.issue.print', 'inv.issue.export', 'inv.issue.import', 'inv.issue.acknowledge', 'inv.site_return.view', 'inv.site_return.create', 'inv.site_return.edit', 'inv.site_return.delete', 'inv.site_return.submit', 'inv.site_return.approve', 'inv.site_return.cancel', 'inv.site_return.amend', 'inv.site_return.print', 'inv.site_return.export', 'inv.site_return.import', 'inv.free_issue.view', 'inv.free_issue.reconcile', 'inv.free_issue.certify', 'inv.free_issue.export'];
export const PERMISSIONS_16_03 = ['inv.grn.view', 'inv.grn.create', 'inv.grn.edit', 'inv.grn.delete', 'inv.grn.submit', 'inv.grn.approve', 'inv.grn.cancel', 'inv.grn.amend', 'inv.grn.print', 'inv.grn.export', 'inv.grn.import', 'inv.grn.inspect', 'inv.grn.emergency', 'inv.rtv.view', 'inv.rtv.create', 'inv.rtv.edit', 'inv.rtv.delete', 'inv.rtv.submit', 'inv.rtv.approve', 'inv.rtv.cancel', 'inv.rtv.amend', 'inv.rtv.print', 'inv.rtv.export', 'inv.rtv.import'];
export const PERMISSIONS_16_02 = ['inv.inward.view', 'inv.inward.create', 'inv.inward.edit', 'inv.inward.delete', 'inv.inward.submit', 'inv.inward.approve', 'inv.inward.cancel', 'inv.inward.amend', 'inv.inward.print', 'inv.inward.export', 'inv.inward.import', 'inv.inward.weigh', 'inv.inward.handover', 'inv.inward.exit', 'inv.pass.view', 'inv.pass.create', 'inv.pass.edit', 'inv.pass.delete', 'inv.pass.submit', 'inv.pass.approve', 'inv.pass.cancel', 'inv.pass.amend', 'inv.pass.print', 'inv.pass.export', 'inv.pass.import', 'inv.pass.verify', 'inv.pass.return', 'inv.appointment.view', 'inv.appointment.create', 'inv.appointment.cancel'];
export const PERMISSIONS_16_01 = ['inv.store.view', 'inv.store.create', 'inv.store.edit', 'inv.store.approve', 'inv.store.export', 'inv.store.all', 'inv.bin.view', 'inv.bin.manage', 'inv.stock.view', 'inv.stock.values', 'inv.stock.post', 'inv.stock.import', 'inv.stock.reverse', 'inv.stock.export', 'inv.stock.reconcile', 'inv.reservation.view', 'inv.reservation.reserve', 'inv.adjustment.view', 'inv.adjustment.create', 'inv.adjustment.submit', 'inv.adjustment.approve', 'inv.adjustment.cancel'];
export const PERMISSIONS_15_10 = ['proc.analytics.view', 'proc.analytics.export'];
export const PERMISSIONS_15_09 = ['proc.rate_intel.view', 'proc.rate_intel.survey', 'proc.rate_intel.index', 'proc.rate_intel.export'];
export const PERMISSIONS_15_08 = ['proc.prequalification.view', 'proc.prequalification.create', 'proc.prequalification.edit', 'proc.prequalification.delete', 'proc.prequalification.submit', 'proc.prequalification.approve', 'proc.prequalification.cancel', 'proc.prequalification.amend', 'proc.prequalification.print', 'proc.prequalification.export', 'proc.avl.view', 'proc.avl.suspend', 'proc.avl.approve', 'proc.avl.export', 'proc.vendor_score.view', 'proc.vendor_score.compute', 'proc.vendor_score.input', 'proc.vendor_score.export', 'proc.vendor_action.view', 'proc.vendor_action.create', 'proc.vendor_action.edit', 'proc.vendor_action.close'];
export const PERMISSIONS_15_07 = ['proc.expediting_plan.view', 'proc.expediting_plan.create', 'proc.expediting_plan.edit', 'proc.expediting_plan.delete', 'proc.expediting_plan.submit', 'proc.expediting_plan.approve', 'proc.expediting_plan.cancel', 'proc.expediting_plan.amend', 'proc.expediting_plan.print', 'proc.expediting_plan.export', 'proc.expediting_plan.progress', 'proc.inspection.view', 'proc.inspection.create', 'proc.inspection.edit', 'proc.inspection.delete', 'proc.inspection.submit', 'proc.inspection.approve', 'proc.inspection.cancel', 'proc.inspection.amend', 'proc.inspection.print', 'proc.inspection.export', 'proc.inspection.result', 'proc.shipment.view', 'proc.shipment.create', 'proc.shipment.edit', 'proc.shipment.delete', 'proc.shipment.cancel', 'proc.shipment.dispatch', 'proc.shipment.deliver', 'proc.shipment.track', 'proc.shipment.print', 'proc.shipment.export'];
export const PERMISSIONS_15_06 = ['proc.rate_contract.view', 'proc.rate_contract.create', 'proc.rate_contract.edit', 'proc.rate_contract.delete', 'proc.rate_contract.submit', 'proc.rate_contract.approve', 'proc.rate_contract.cancel', 'proc.rate_contract.amend', 'proc.rate_contract.print', 'proc.rate_contract.export', 'proc.rate_contract.rates', 'proc.rate_contract.index', 'proc.rate_contract.pv', 'proc.service_order.view', 'proc.service_order.create', 'proc.service_order.edit', 'proc.service_order.delete', 'proc.service_order.submit', 'proc.service_order.approve', 'proc.service_order.cancel', 'proc.service_order.amend', 'proc.service_order.print', 'proc.service_order.export', 'proc.service_order.rates', 'proc.service_entry.view', 'proc.service_entry.create', 'proc.service_entry.edit', 'proc.service_entry.delete', 'proc.service_entry.submit', 'proc.service_entry.approve', 'proc.service_entry.cancel', 'proc.service_entry.amend', 'proc.service_entry.print', 'proc.service_entry.export'];
export const PERMISSIONS_15_05 = ['proc.purchase_order.view', 'proc.purchase_order.create', 'proc.purchase_order.edit', 'proc.purchase_order.delete', 'proc.purchase_order.submit', 'proc.purchase_order.approve', 'proc.purchase_order.cancel', 'proc.purchase_order.amend', 'proc.purchase_order.print', 'proc.purchase_order.export', 'proc.purchase_order.rates', 'proc.purchase_order.release', 'proc.purchase_order.dispatch', 'proc.purchase_order.advance', 'proc.purchase_order.advance_approve', 'proc.purchase_order.receipts'];
export const PERMISSIONS_15_04 = ['proc.comparative_statement.view', 'proc.comparative_statement.create', 'proc.comparative_statement.edit', 'proc.comparative_statement.delete', 'proc.comparative_statement.submit', 'proc.comparative_statement.approve', 'proc.comparative_statement.cancel', 'proc.comparative_statement.amend', 'proc.comparative_statement.print', 'proc.comparative_statement.export'];
export const PERMISSIONS_15_03 = ['proc.rfq.view', 'proc.rfq.create', 'proc.rfq.edit', 'proc.rfq.delete', 'proc.rfq.submit', 'proc.rfq.approve', 'proc.rfq.cancel', 'proc.rfq.amend', 'proc.rfq.print', 'proc.rfq.export', 'proc.rfq.issue', 'proc.quotation.view', 'proc.quotation.create', 'proc.quotation.edit', 'proc.quotation.delete', 'proc.quotation.submit', 'proc.quotation.approve', 'proc.quotation.cancel', 'proc.quotation.amend', 'proc.quotation.print', 'proc.quotation.export', 'proc.quotation.rates'];
export const PERMISSIONS_15_02 = ['proc.run.view', 'proc.run.create', 'proc.run.edit', 'proc.run.delete', 'proc.run.submit', 'proc.run.approve', 'proc.run.cancel', 'proc.run.amend', 'proc.run.print', 'proc.run.export', 'proc.proposal.decide', 'proc.item_param.view', 'proc.item_param.edit', 'proc.item_param.submit', 'proc.item_param.approve', 'proc.item_param.cancel', 'proc.supply.ingest'];
export const PERMISSIONS_15_01 = ['proc.material_request.view', 'proc.material_request.create', 'proc.material_request.edit', 'proc.material_request.delete', 'proc.material_request.submit', 'proc.material_request.approve', 'proc.material_request.cancel', 'proc.material_request.amend', 'proc.material_request.print', 'proc.material_request.export', 'proc.material_request.process', 'proc.requisition.view', 'proc.requisition.create', 'proc.requisition.edit', 'proc.requisition.delete', 'proc.requisition.submit', 'proc.requisition.approve', 'proc.requisition.cancel', 'proc.requisition.amend', 'proc.requisition.print', 'proc.requisition.export', 'proc.requisition.emergency', 'proc.requisition.cost', 'proc.stock.ingest'];
export const PERMISSIONS_14_07 = ['site.control.view', 'site.control.submit', 'site.control.approve', 'site.control.export', 'site.control.reconcile'];
export const PERMISSIONS_14_06 = ['site.productivity.view', 'site.productivity.configure', 'site.productivity.submit', 'site.productivity.approve', 'site.productivity.cancel', 'site.productivity.record', 'site.productivity.export'];
export const PERMISSIONS_14_05 = ['site.period.view', 'site.period.create', 'site.period.edit', 'site.period.delete', 'site.period.submit', 'site.period.approve', 'site.period.cancel', 'site.period.amend', 'site.period.print', 'site.period.export', 'site.period.cost'];
export const PERMISSIONS_14_04 = ['site.instruction.view', 'site.instruction.create', 'site.instruction.edit', 'site.instruction.delete', 'site.instruction.submit', 'site.instruction.approve', 'site.instruction.cancel', 'site.instruction.amend', 'site.instruction.print', 'site.instruction.export', 'site.instruction.acknowledge', 'site.instruction.comply', 'site.instruction.close', 'site.instruction.variation', 'site.instruction.cost'];
export const PERMISSIONS_14_03 = ['site.weather.view', 'site.weather.create', 'site.weather.edit', 'site.weather.delete', 'site.weather.export', 'site.hindrance.view', 'site.hindrance.create', 'site.hindrance.edit', 'site.hindrance.delete', 'site.hindrance.submit', 'site.hindrance.approve', 'site.hindrance.cancel', 'site.hindrance.amend', 'site.hindrance.print', 'site.hindrance.export', 'site.hindrance.close', 'site.diary.view', 'site.diary.create', 'site.diary.edit', 'site.diary.delete', 'site.diary.sign', 'site.diary.export', 'site.visitor.view', 'site.visitor.create', 'site.visitor.edit', 'site.visitor.delete', 'site.visitor.export'];
export const PERMISSIONS_14_02 = ['site.dpr.view', 'site.dpr.create', 'site.dpr.edit', 'site.dpr.delete', 'site.dpr.submit', 'site.dpr.approve', 'site.dpr.cancel', 'site.dpr.amend', 'site.dpr.print', 'site.dpr.export', 'site.dpr.report'];
export const PERMISSIONS_14_01 = ['site.work_authorisation.view', 'site.work_authorisation.create', 'site.work_authorisation.edit', 'site.work_authorisation.delete', 'site.work_authorisation.submit', 'site.work_authorisation.approve', 'site.work_authorisation.cancel', 'site.work_authorisation.amend', 'site.work_authorisation.print', 'site.work_authorisation.export', 'site.work_authorisation.close', 'site.work_front.view', 'site.work_front.manage', 'site.daily_plan.view', 'site.daily_plan.manage', 'site.wa.use'];
export const PERMISSIONS_13_05 = ['plan.delay.view', 'plan.delay.create', 'plan.delay.edit', 'plan.delay.delete', 'plan.delay.submit', 'plan.delay.approve', 'plan.delay.cancel', 'plan.delay.amend', 'plan.delay.print', 'plan.delay.export', 'plan.delay.analyse'];
export const PERMISSIONS_13_04 = ['plan.lookahead.view', 'plan.constraint.view', 'plan.constraint.manage', 'plan.weekly_plan.view', 'plan.weekly_plan.create', 'plan.weekly_plan.edit', 'plan.weekly_plan.delete', 'plan.weekly_plan.submit', 'plan.weekly_plan.approve', 'plan.weekly_plan.cancel', 'plan.weekly_plan.amend', 'plan.weekly_plan.print', 'plan.weekly_plan.export', 'plan.weekly_plan.record'];
export const PERMISSIONS_13_03 = ['plan.baseline.view', 'plan.baseline.create', 'plan.baseline.edit', 'plan.baseline.delete', 'plan.baseline.submit', 'plan.baseline.approve', 'plan.baseline.cancel', 'plan.baseline.amend', 'plan.baseline.print', 'plan.baseline.export', 'plan.schedule.import'];
export const PERMISSIONS_13_02 = ['plan.resource.view', 'plan.resource.edit', 'plan.capacity.manage', 'plan.capacity.approve'];
export const PERMISSIONS_13_01 = ['plan.schedule.view', 'plan.schedule.create', 'plan.schedule.edit', 'plan.schedule.delete', 'plan.schedule.submit', 'plan.schedule.approve', 'plan.schedule.cancel', 'plan.schedule.amend', 'plan.schedule.print', 'plan.schedule.export', 'plan.schedule.progress', 'plan.calendar.view', 'plan.calendar.manage', 'plan.calendar.approve', 'plan.template.manage', 'plan.template.approve'];
export const PERMISSIONS_12_04 = ['bud.dept_budget.view', 'bud.dept_budget.create', 'bud.dept_budget.edit', 'bud.dept_budget.delete', 'bud.dept_budget.submit', 'bud.dept_budget.approve', 'bud.dept_budget.cancel', 'bud.dept_budget.amend', 'bud.dept_budget.print', 'bud.dept_budget.export', 'bud.dept_report.view', 'bud.dept_report.export', 'bud.dept_actual.post', 'bud.alloc.view', 'bud.alloc.configure', 'bud.alloc.approve', 'bud.alloc.run'];
export const PERMISSIONS_12_03 = ['bud.ledger.view', 'bud.ledger.export', 'bud.ledger.post', 'bud.check.use', 'bud.check.view', 'bud.check.configure', 'bud.check.approve'];
export const PERMISSIONS_12_02 = ['bud.change.view', 'bud.change.create', 'bud.change.edit', 'bud.change.delete', 'bud.change.submit', 'bud.change.approve', 'bud.change.cancel', 'bud.change.amend', 'bud.change.print', 'bud.change.export'];
export const PERMISSIONS_12_01 = ['bud.budget.view', 'bud.budget.create', 'bud.budget.edit', 'bud.budget.delete', 'bud.budget.submit', 'bud.budget.approve', 'bud.budget.cancel', 'bud.budget.amend', 'bud.budget.print', 'bud.budget.export'];
export const PERMISSIONS_11_04 = ['engg.deliverable.view', 'engg.deliverable.create', 'engg.deliverable.edit', 'engg.deliverable.delete', 'engg.deliverable.submit', 'engg.deliverable.approve', 'engg.deliverable.cancel', 'engg.deliverable.amend', 'engg.deliverable.print', 'engg.deliverable.export', 'engg.vdr_item.view', 'engg.vdr_item.create', 'engg.vdr_item.edit', 'engg.vdr_item.delete', 'engg.vdr_item.submit', 'engg.vdr_item.approve', 'engg.vdr_item.cancel', 'engg.vdr_item.amend', 'engg.vdr_item.print', 'engg.vdr_item.export'];
export const PERMISSIONS_11_03 = ['engg.submittal.view', 'engg.submittal.create', 'engg.submittal.edit', 'engg.submittal.delete', 'engg.submittal.submit', 'engg.submittal.approve', 'engg.submittal.cancel', 'engg.submittal.amend', 'engg.submittal.print', 'engg.submittal.export', 'engg.submittal.respond'];
export const PERMISSIONS_11_02 = ['engg.rfi.view', 'engg.rfi.create', 'engg.rfi.edit', 'engg.rfi.delete', 'engg.rfi.submit', 'engg.rfi.approve', 'engg.rfi.cancel', 'engg.rfi.amend', 'engg.rfi.print', 'engg.rfi.export', 'engg.rfi.respond'];
export const PERMISSIONS_11_01 = ['engg.drawing.view', 'engg.drawing.create', 'engg.drawing.edit', 'engg.drawing.delete', 'engg.drawing.submit', 'engg.drawing.approve', 'engg.drawing.cancel', 'engg.drawing.amend', 'engg.drawing.print', 'engg.drawing.export', 'engg.drawing.distribute', 'engg.transmittal.view', 'engg.transmittal.create', 'engg.transmittal.edit', 'engg.transmittal.delete', 'engg.transmittal.submit', 'engg.transmittal.approve', 'engg.transmittal.cancel', 'engg.transmittal.amend', 'engg.transmittal.print', 'engg.transmittal.export', 'engg.transmittal.respond'];
export const PERMISSIONS_10_08 = ['proj.p360.view', 'proj.p360.export'];
export const PERMISSIONS_10_07 = ['proj.gis.view', 'proj.gis.create', 'proj.gis.edit', 'proj.gis.delete', 'proj.gis.submit', 'proj.gis.approve', 'proj.gis.cancel', 'proj.gis.print', 'proj.gis.export', 'proj.gis.import', 'proj.gis.progress'];
export const PERMISSIONS_10_06 = ['proj.risk.view', 'proj.risk.create', 'proj.risk.edit', 'proj.risk.delete', 'proj.risk.submit', 'proj.risk.approve', 'proj.risk.cancel', 'proj.risk.amend', 'proj.risk.print', 'proj.risk.export', 'proj.issue.view', 'proj.issue.create', 'proj.issue.edit', 'proj.issue.delete', 'proj.issue.submit', 'proj.issue.approve', 'proj.issue.cancel', 'proj.issue.amend', 'proj.issue.print', 'proj.issue.export'];
export const PERMISSIONS_10_05 = ['proj.meeting.view', 'proj.meeting.create', 'proj.meeting.edit', 'proj.meeting.delete', 'proj.meeting.submit', 'proj.meeting.approve', 'proj.meeting.cancel', 'proj.meeting.amend', 'proj.meeting.print', 'proj.meeting.export', 'proj.team.view', 'proj.team.manage', 'proj.stakeholder.view', 'proj.stakeholder.manage', 'proj.stakeholder.contact', 'proj.stakeholder.export', 'proj.action.update'];
export const PERMISSIONS_10_04 = ['proj.version.view', 'proj.version.create', 'proj.version.edit', 'proj.version.delete', 'proj.version.submit', 'proj.version.approve', 'proj.version.cancel', 'proj.version.amend', 'proj.version.print', 'proj.version.export', 'proj.boq.map', 'proj.boq.import', 'proj.boq.rates'];
export const PERMISSIONS_10_03 = ['proj.wbs.view', 'proj.wbs.manage', 'proj.wbs.baseline', 'proj.wbs.change', 'proj.wbs.approve', 'proj.wbs.export', 'proj.wbs.import'];
export const PERMISSIONS_10_02 = ['proj.baseline_pack.view', 'proj.baseline_pack.create', 'proj.baseline_pack.edit', 'proj.baseline_pack.delete', 'proj.baseline_pack.submit', 'proj.baseline_pack.approve', 'proj.baseline_pack.cancel', 'proj.baseline_pack.amend', 'proj.baseline_pack.print', 'proj.baseline_pack.export', 'proj.baseline_pack.cost', 'proj.handover.manage'];
export const PERMISSIONS_10_01 = ['proj.project.view', 'proj.project.create', 'proj.project.edit', 'proj.project.delete', 'proj.project.submit', 'proj.project.approve', 'proj.project.cancel', 'proj.project.amend', 'proj.project.print', 'proj.project.export', 'proj.project.view_all', 'proj.project.transition', 'proj.project.import', 'proj.milestone.manage'];
export const PERMISSIONS_09_03 = ['est.review.view', 'est.review.perform', 'est.bid.edit', 'est.bid.approve', 'est.boq.export'];
export const PERMISSIONS_09_02 = ['est.takeoff.view', 'est.takeoff.create', 'est.takeoff.edit', 'est.takeoff.delete', 'est.takeoff.submit', 'est.takeoff.approve', 'est.takeoff.cancel', 'est.takeoff.amend', 'est.takeoff.print', 'est.takeoff.export', 'est.takeoff.import', 'est.bb.view', 'est.bb.create', 'est.bb.edit', 'est.bb.delete', 'est.bb.submit', 'est.bb.approve', 'est.bb.cancel', 'est.bb.amend', 'est.bb.print', 'est.bb.export', 'est.bb.import'];
export const PERMISSIONS_09_01 = ['est.estimate.view', 'est.estimate.create', 'est.estimate.edit', 'est.estimate.delete', 'est.estimate.submit', 'est.estimate.approve', 'est.estimate.cancel', 'est.estimate.amend', 'est.estimate.print', 'est.estimate.export', 'est.estimate.view_all', 'est.estimate.cost', 'est.estimate.import'];
export const PERMISSIONS_08_03 = ['bd.emd.view', 'bd.emd.create', 'bd.emd.edit', 'bd.emd.delete', 'bd.emd.submit', 'bd.emd.approve', 'bd.emd.cancel', 'bd.emd.amend', 'bd.emd.print', 'bd.emd.export', 'bd.emd.view_all', 'bd.emd.instrument', 'bd.emd.refund', 'bd.emd.import', 'bd.award.view', 'bd.award.create', 'bd.award.edit', 'bd.award.delete', 'bd.award.submit', 'bd.award.approve', 'bd.award.cancel', 'bd.award.amend', 'bd.award.print', 'bd.award.export', 'bd.credential.view', 'bd.credential.manage', 'bd.submission.view', 'bd.submission.manage', 'bd.result.manage', 'bd.competitor.view'];
export const PERMISSIONS_08_02 = ['bd.tender.view', 'bd.tender.create', 'bd.tender.edit', 'bd.tender.delete', 'bd.tender.submit', 'bd.tender.approve', 'bd.tender.cancel', 'bd.tender.amend', 'bd.tender.print', 'bd.tender.export', 'bd.tender.view_all', 'bd.tender.manage', 'bd.tender.ready', 'bd.tender.import', 'bd.bid_decision.view', 'bd.bid_decision.create', 'bd.bid_decision.edit', 'bd.bid_decision.delete', 'bd.bid_decision.submit', 'bd.bid_decision.approve', 'bd.bid_decision.cancel', 'bd.bid_decision.amend', 'bd.bid_decision.print', 'bd.bid_decision.export', 'bd.bid_decision.import'];
export const PERMISSIONS_08_01 = ['bd.lead.view', 'bd.lead.create', 'bd.lead.edit', 'bd.lead.delete', 'bd.lead.submit', 'bd.lead.approve', 'bd.lead.cancel', 'bd.lead.amend', 'bd.lead.print', 'bd.lead.export', 'bd.lead.convert', 'bd.lead.import', 'bd.opportunity.view', 'bd.opportunity.create', 'bd.opportunity.edit', 'bd.opportunity.delete', 'bd.opportunity.submit', 'bd.opportunity.approve', 'bd.opportunity.cancel', 'bd.opportunity.amend', 'bd.opportunity.print', 'bd.opportunity.export', 'bd.opportunity.track', 'bd.opportunity.convert', 'bd.opportunity.win', 'bd.opportunity.import', 'bd.view_all', 'bd.interaction.log', 'bd.contact.manage', 'bd.client.view', 'bd.forecast.view'];
export const PERMISSIONS_07_13 = ['hr.separation.view', 'hr.separation.create', 'hr.separation.edit', 'hr.separation.delete', 'hr.separation.submit', 'hr.separation.approve', 'hr.separation.cancel', 'hr.separation.amend', 'hr.separation.print', 'hr.separation.export', 'hr.grievance.view', 'hr.grievance.create', 'hr.grievance.edit', 'hr.grievance.delete', 'hr.grievance.submit', 'hr.grievance.approve', 'hr.grievance.cancel', 'hr.grievance.amend', 'hr.grievance.print', 'hr.grievance.export', 'hr.separation.view_all', 'hr.separation.terminate', 'hr.separation.interview', 'hr.separation.fnf', 'hr.separation.letter', 'hr.clearance.view', 'hr.clearance.clear', 'hr.clearance.waive', 'hr.grievance.manage', 'hr.disciplinary.view', 'hr.disciplinary.manage'];
export const PERMISSIONS_07_12 = ['hr.travel_request.view', 'hr.travel_request.create', 'hr.travel_request.edit', 'hr.travel_request.delete', 'hr.travel_request.submit', 'hr.travel_request.approve', 'hr.travel_request.cancel', 'hr.travel_request.amend', 'hr.travel_request.print', 'hr.travel_request.export', 'hr.advance.view', 'hr.advance.create', 'hr.advance.edit', 'hr.advance.delete', 'hr.advance.submit', 'hr.advance.approve', 'hr.advance.cancel', 'hr.advance.amend', 'hr.advance.print', 'hr.advance.export', 'hr.claim.view', 'hr.claim.create', 'hr.claim.edit', 'hr.claim.delete', 'hr.claim.submit', 'hr.claim.approve', 'hr.claim.cancel', 'hr.claim.amend', 'hr.claim.print', 'hr.claim.export', 'hr.travel_request.view_all', 'hr.advance.view_all', 'hr.claim.view_all', 'hr.claim.pass', 'hr.advance.disburse', 'hr.advance.recover', 'hr.expense.configure', 'hr.expense.config_approve', 'hr.expense.report'];
export const PERMISSIONS_07_11 = ['hr.review.view', 'hr.review.create', 'hr.review.edit', 'hr.review.delete', 'hr.review.submit', 'hr.review.approve', 'hr.review.cancel', 'hr.review.amend', 'hr.review.print', 'hr.review.export', 'hr.review.view_all', 'hr.review.calibrate', 'hr.review.letter', 'hr.perf.own', 'hr.perf.team', 'hr.perf.feedback', 'hr.perf.configure', 'hr.perf.config_approve', 'hr.perf.compute', 'hr.perf.dispute_resolve'];
export const PERMISSIONS_07_10 = ['hr.session.view', 'hr.session.create', 'hr.session.edit', 'hr.session.delete', 'hr.session.submit', 'hr.session.approve', 'hr.session.cancel', 'hr.session.amend', 'hr.session.print', 'hr.session.export', 'hr.training.nominate', 'hr.training.attendance', 'hr.training.own', 'hr.training.configure', 'hr.training.report', 'hr.cert.view', 'hr.cert.create', 'hr.cert.edit', 'hr.cert.verify', 'hr.cert.export', 'hr.cert.view_all', 'hr.cert.check', 'hr.skill.view', 'hr.skill.assess'];
export const PERMISSIONS_07_09 = ['hr.ess.view', 'hr.ess.team', 'hr.ess.letter.view', 'hr.ess.letter.create', 'hr.ess.letter.edit', 'hr.ess.letter.delete', 'hr.ess.letter.submit', 'hr.ess.letter.cancel', 'hr.ess.letter.print', 'hr.ess.letter.approve', 'hr.ess.letter.view_all', 'hr.ess.issue'];
export const PERMISSIONS_07_08 = ['hr.worker.view', 'hr.worker.create', 'hr.worker.edit', 'hr.worker.delete', 'hr.worker.submit', 'hr.worker.approve', 'hr.worker.cancel', 'hr.worker.amend', 'hr.worker.print', 'hr.worker.export', 'hr.worker.view_all', 'hr.worker.view_sensitive', 'hr.worker.clear', 'hr.worker.blacklist', 'hr.worker.configure', 'hr.worker.compliance'];
export const PERMISSIONS_07_07 = ['hr.application.view', 'hr.application.create', 'hr.application.edit', 'hr.application.delete', 'hr.application.submit', 'hr.application.approve', 'hr.application.cancel', 'hr.application.amend', 'hr.application.print', 'hr.application.export', 'lv.type.view', 'lv.type.edit', 'lv.adjust.view', 'lv.adjust.create', 'lv.team.view', 'lv.yearend.run', 'lv.accrual.run'];
export const PERMISSIONS_07_06 = ['hr.regularisation.view', 'hr.regularisation.create', 'hr.regularisation.edit', 'hr.regularisation.delete', 'hr.regularisation.submit', 'hr.regularisation.approve', 'hr.regularisation.cancel', 'hr.regularisation.amend', 'hr.regularisation.print', 'hr.regularisation.export', 'hr.overtime_request.view', 'hr.overtime_request.create', 'hr.overtime_request.edit', 'hr.overtime_request.delete', 'hr.overtime_request.submit', 'hr.overtime_request.approve', 'hr.overtime_request.cancel', 'hr.overtime_request.amend', 'hr.overtime_request.print', 'hr.overtime_request.export', 'att.manual.view', 'att.manual.create', 'att.manual.edit', 'att.manual.delete', 'att.manual.submit', 'att.manual.approve', 'att.manual.cancel', 'att.manual.amend', 'att.manual.print', 'att.manual.export', 'att.register.view', 'att.register.export', 'att.daily.recompute', 'att.period.lock', 'att.period.reopen', 'att.arrears.view', 'att.device.import'];
export const PERMISSIONS_07_05 = ['att.punch.own', 'att.punch.view', 'att.punch.crew', 'att.punch.kiosk', 'att.punch.device', 'att.punch.settings', 'att.anomaly.view', 'att.anomaly.review'];
export const PERMISSIONS_07_04 = ['att.shift.view', 'att.shift.edit', 'att.policy.view', 'att.policy.create', 'att.policy.edit', 'att.policy.delete', 'att.policy.submit', 'att.policy.approve', 'att.policy.cancel', 'att.policy.amend', 'att.policy.print', 'att.policy.export', 'att.assignment.view', 'att.assignment.edit', 'att.roster.view', 'att.roster.edit', 'att.roster.change', 'att.roster.approve', 'att.period.view', 'att.period.manage'];
export const PERMISSIONS_07_03 = ['hr.deployment.view', 'hr.deployment.create', 'hr.deployment.edit', 'hr.deployment.delete', 'hr.deployment.submit', 'hr.deployment.approve', 'hr.deployment.cancel', 'hr.deployment.amend', 'hr.deployment.print', 'hr.deployment.export', 'hr.deployment.import', 'hr.transfer.view', 'hr.transfer.create', 'hr.transfer.edit', 'hr.transfer.delete', 'hr.transfer.submit', 'hr.transfer.approve', 'hr.transfer.cancel', 'hr.transfer.amend', 'hr.transfer.print', 'hr.transfer.export', 'hr.crew.view', 'hr.crew.edit', 'hr.crew.members', 'hr.siteplan.edit'];
export const PERMISSIONS_07_02 = ['hr.requisition.view', 'hr.requisition.view_all', 'hr.requisition.create', 'hr.requisition.edit', 'hr.requisition.delete', 'hr.requisition.submit', 'hr.requisition.approve', 'hr.requisition.cancel', 'hr.requisition.amend', 'hr.requisition.print', 'hr.requisition.export', 'hr.offer.view', 'hr.offer.create', 'hr.offer.edit', 'hr.offer.delete', 'hr.offer.submit', 'hr.offer.approve', 'hr.offer.cancel', 'hr.offer.amend', 'hr.offer.print', 'hr.offer.export', 'hr.candidate.view', 'hr.candidate.edit', 'hr.interview.give', 'hr.onboarding.view', 'hr.onboarding.complete', 'hr.plan.edit'];
export const PERMISSIONS_07_01 = ['hr.employee.view', 'hr.employee.team.view', 'hr.employee.create', 'hr.employee.edit', 'hr.employee.delete', 'hr.employee.submit', 'hr.employee.approve', 'hr.employee.cancel', 'hr.employee.amend', 'hr.employee.print', 'hr.employee.export', 'hr.employee.import', 'hr.employee.sensitive.view', 'hr.employee.bank.verify', 'hr.employee.separate', 'hr.employee.link_user', 'hr.employee.queue'];
export const PERMISSIONS_06_06 = ['mdm.analyse.view', 'mdm.analyse.create', 'mdm.analyse.edit', 'mdm.analyse.delete', 'mdm.analyse.submit', 'mdm.analyse.approve', 'mdm.analyse.cancel', 'mdm.analyse.amend', 'mdm.analyse.print', 'mdm.analyse.export', 'mdm.rate.edit'];
export const PERMISSIONS_06_05 = ['fin.coa.view', 'fin.coa.edit', 'fin.costcode.edit', 'fin.import'];
export const PERMISSIONS_06_04 = ['mdm.partner.edit', 'mdm.partner.sensitive.view', 'mdm.partner.bank.view', 'mdm.partner.bank.request', 'mdm.partner.verify', 'mdm.partner.blacklist', 'mdm.partner.hold', 'mdm.partner.queue'];
export const PERMISSIONS_06_03 = ['mdm.item.edit', 'mdm.item.rate.view', 'mdm.item.category.edit', 'mdm.item.migrate', 'mdm.item.import'];
export const PERMISSIONS_06_02 = ['mdm.uom.edit', 'mdm.tax.edit', 'mdm.finance.edit', 'mdm.lookup.edit'];
export const PERMISSIONS_06_01 = ['mdm.record.view', 'mdm.record.edit', 'mdm.record.import', 'mdm.sensitive.view', 'mdm.governance.view', 'mdm.config.edit'];
export const PERMISSIONS_05_04 = ['msg.instruction.send', 'msg.announcement.send', 'msg.comm.view_all', 'msg.autogroup.view', 'msg.autogroup.edit'];
export const PERMISSIONS_05_03 = ['sec.policy.view', 'sec.policy.edit', 'sec.device.manage', 'sec.licence.view', 'sec.licence.edit'];
export const PERMISSIONS_05_01 = ['msg.channel.manage', 'msg.admin.view', 'msg.compliance.export', 'msg.settings.view', 'msg.settings.edit', 'msg.legal_hold.manage'];
export const PERMISSIONS_04_15 = ['off.device.manage', 'off.sync.confirm', 'off.sync.view_all'];
export const PERMISSIONS_04_14 = ['col.comment.moderate', 'col.trace.link', 'col.activity.view'];
export const PERMISSIONS_04_13 = ['xl.import.use', 'xl.template.view', 'xl.template.edit', 'xl.job.view_all', 'org.designation.import', 'eng.sample.import'];
export const PERMISSIONS_04_09 = ['alr.rule.view', 'alr.rule.edit', 'alr.alert.view', 'alr.alert.manage'];
export const PERMISSIONS_04_08 = ['tsk.team.view', 'tsk.task.assign', 'tsk.instruction.create', 'tsk.routing.view', 'tsk.routing.edit'];
export const PERMISSIONS_SINCE_LEGACY = Object.freeze([...PERMISSIONS_24_04, ...PERMISSIONS_24_03, ...PERMISSIONS_24_02, ...PERMISSIONS_24_01, ...PERMISSIONS_23_15, ...PERMISSIONS_23_14, ...PERMISSIONS_23_13, ...PERMISSIONS_23_12, ...PERMISSIONS_23_11, ...PERMISSIONS_23_10, ...PERMISSIONS_23_09, ...PERMISSIONS_23_08, ...PERMISSIONS_23_07, ...PERMISSIONS_23_06, ...PERMISSIONS_23_05, ...PERMISSIONS_23_04, ...PERMISSIONS_23_03, ...PERMISSIONS_23_02, ...PERMISSIONS_23_01, ...PERMISSIONS_07_14, ...PERMISSIONS_22_09, ...PERMISSIONS_22_08, ...PERMISSIONS_22_07, ...PERMISSIONS_22_06, ...PERMISSIONS_22_05, ...PERMISSIONS_22_04, ...PERMISSIONS_22_03, ...PERMISSIONS_22_02, ...PERMISSIONS_22_01, ...PERMISSIONS_21_07, ...PERMISSIONS_21_06, ...PERMISSIONS_21_05, ...PERMISSIONS_21_04, ...PERMISSIONS_21_03, ...PERMISSIONS_21_02, ...PERMISSIONS_21_01, ...PERMISSIONS_20_03, ...PERMISSIONS_20_02, ...PERMISSIONS_20_01, ...PERMISSIONS_19_08, ...PERMISSIONS_19_07, ...PERMISSIONS_19_06, ...PERMISSIONS_19_05, ...PERMISSIONS_19_04, ...PERMISSIONS_19_03, ...PERMISSIONS_19_02, ...PERMISSIONS_19_01, ...PERMISSIONS_18_07, ...PERMISSIONS_18_06, ...PERMISSIONS_18_05, ...PERMISSIONS_18_04, ...PERMISSIONS_18_03, ...PERMISSIONS_18_02, ...PERMISSIONS_18_01, ...PERMISSIONS_17_08, ...PERMISSIONS_17_07, ...PERMISSIONS_17_06, ...PERMISSIONS_17_05, ...PERMISSIONS_17_04, ...PERMISSIONS_17_03, ...PERMISSIONS_17_02, ...PERMISSIONS_17_01, ...PERMISSIONS_16_11, ...PERMISSIONS_16_10, ...PERMISSIONS_16_09, ...PERMISSIONS_16_08, ...PERMISSIONS_16_07, ...PERMISSIONS_16_06, ...PERMISSIONS_16_05, ...PERMISSIONS_16_04, ...PERMISSIONS_16_03, ...PERMISSIONS_16_02, ...PERMISSIONS_16_01, ...PERMISSIONS_15_10, ...PERMISSIONS_15_09, ...PERMISSIONS_15_08, ...PERMISSIONS_15_07, ...PERMISSIONS_15_06, ...PERMISSIONS_15_05, ...PERMISSIONS_15_04, ...PERMISSIONS_15_03, ...PERMISSIONS_15_02, ...PERMISSIONS_15_01, ...PERMISSIONS_14_07, ...PERMISSIONS_14_06, ...PERMISSIONS_14_05, ...PERMISSIONS_14_04, ...PERMISSIONS_14_03, ...PERMISSIONS_14_02, ...PERMISSIONS_14_01, ...PERMISSIONS_13_05, ...PERMISSIONS_13_04, ...PERMISSIONS_13_03, ...PERMISSIONS_13_02, ...PERMISSIONS_02_04, ...PERMISSIONS_02_05, ...PERMISSIONS_02_06, ...PERMISSIONS_02_07, ...PERMISSIONS_03_01, ...PERMISSIONS_03_03, ...PERMISSIONS_03_05, ...PERMISSIONS_03_07, ...PERMISSIONS_03_08, ...PERMISSIONS_03_09, ...PERMISSIONS_03_10, ...PERMISSIONS_04_01, ...PERMISSIONS_04_02, ...PERMISSIONS_04_04, ...PERMISSIONS_04_05, ...PERMISSIONS_04_06, ...PERMISSIONS_04_07, ...PERMISSIONS_04_08, ...PERMISSIONS_04_09, ...PERMISSIONS_04_10, ...PERMISSIONS_04_11, ...PERMISSIONS_04_12, ...PERMISSIONS_04_13, ...PERMISSIONS_04_14, ...PERMISSIONS_04_15, ...PERMISSIONS_05_01, ...PERMISSIONS_05_03, ...PERMISSIONS_05_04, ...PERMISSIONS_05_05, ...PERMISSIONS_06_01, ...PERMISSIONS_06_02, ...PERMISSIONS_06_03, ...PERMISSIONS_06_04, ...PERMISSIONS_06_05, ...PERMISSIONS_06_06, ...PERMISSIONS_07_01, ...PERMISSIONS_07_13, ...PERMISSIONS_08_01, ...PERMISSIONS_08_02, ...PERMISSIONS_08_03, ...PERMISSIONS_09_01, ...PERMISSIONS_09_02, ...PERMISSIONS_09_03, ...PERMISSIONS_11_05, ...PERMISSIONS_12_01, ...PERMISSIONS_12_02, ...PERMISSIONS_12_04, ...PERMISSIONS_13_01, ...PERMISSIONS_12_03, ...PERMISSIONS_11_04, ...PERMISSIONS_11_03, ...PERMISSIONS_11_02, ...PERMISSIONS_11_01, ...PERMISSIONS_10_08, ...PERMISSIONS_10_07, ...PERMISSIONS_10_06, ...PERMISSIONS_10_05, ...PERMISSIONS_10_04, ...PERMISSIONS_10_03, ...PERMISSIONS_10_02, ...PERMISSIONS_10_01, ...PERMISSIONS_07_12, ...PERMISSIONS_07_11, ...PERMISSIONS_07_10, ...PERMISSIONS_07_09, ...PERMISSIONS_07_08, ...PERMISSIONS_07_07, ...PERMISSIONS_07_06, ...PERMISSIONS_07_05, ...PERMISSIONS_07_04, ...PERMISSIONS_07_03, ...PERMISSIONS_07_02]);

/** Permission keys that are privileged: a role holding any of them is a privileged role (its changes need the extra approver). */
export const SENSITIVE_ACTIONS = ['manage', 'configure', 'configure_system', 'redrive', 'replay', 'issue', 'post_soft_closed'];

/** Roles whose assignment needs the director as the last approver (finance approvers and the platform's break-glass role). */
export const DIRECTOR_APPROVED_ROLES = ['CFO', 'ACCMGR', 'FINEX', 'SUPADM'];

export const CONFIDENTIALITY_LEVELS = ['public', 'internal', 'confidential', 'restricted'];

const HO = 'HEAD_OFFICE';
const SITE = 'SITE_OFFICE';
const SUP = 'SUPPORTING';
const EXT = 'EXTERNAL';

/** code, name, category, department, default data scope, main responsibilities, approval authority */
const ROWS = [
  ['SYSADM', 'System Administrator', HO, 'IT and administration', 'Company (configuration only)', 'Users, roles, configuration, workflows, integrations', 'Configuration changes (maker-checker with ITADM); no business approvals'],
  ['ITADM', 'IT Administrator', HO, 'IT and administration', 'Company (technical)', 'Devices, backups, integrations health, security events', 'Technical changes; no business data access by default'],
  ['DIR', 'Director', HO, 'Management', 'All companies / company', 'Strategic decisions, final approvals above limits', 'Highest band on all financial documents'],
  ['CFO', 'Chief Financial Officer', HO, 'Finance', 'Company', 'Finance, treasury, payments, tax, close', 'Payments, budgets, journals above Accounts Manager limit'],
  ['ACCMGR', 'Accounts Manager', HO, 'Finance', 'Company / branch', 'Ledgers, AP/AR, bank, GST/TDS, close tasks', 'Journals, vendor bills, payment proposals within band'],
  ['PROCMGR', 'Procurement & Stores Manager', HO, 'Procurement', 'Company', 'Procurement policy, vendors, POs, central stores', 'PRs/POs within band, comparative statement approval, vendor approval'],
  ['COMMGR', 'Commercial Manager', HO, 'Commercial', 'Company / assigned projects', 'Contracts, variations, claims, billing, CVR', 'Client bills, subcontract work orders and bills, variations within band'],
  ['HRMGR', 'HR & Administration Manager', HO, 'Human resources', 'Company', 'Employees, recruitment, attendance policy, payroll inputs', 'Leave (escalated), regularisation, offers, full and final, HR letters'],
  ['QCMGR', 'Quality Control Manager', HO, 'Quality', 'Company', 'QMS, ITPs, NCR closure policy, lab', 'NCR closure (major), ITP approval, material approval'],
  ['PCMGR', 'Project Controls Manager', HO, 'Project controls', 'Company / assigned projects', 'Budgets, schedules, EVM, forecasts, MIS', 'Budget revisions (recommend), baseline approval, forecast publish'],
  ['PD', 'Project Director', SITE, 'Projects', 'Assigned projects', 'Overall delivery of a group of projects', 'High band on project documents'],
  ['PM', 'Project Manager', SITE, 'Projects', 'Assigned project', 'Project delivery, approvals at project level', 'Mid band PR/PO/WO, DPR approval, work-area approval, measurement book verification'],
  ['CM', 'Construction Manager', SITE, 'Projects', 'Assigned project / sites', 'Execution, work fronts, resources', 'Work-area approval, DPR review, material requests'],
  ['SE', 'Site Engineer', SITE, 'Projects', 'Assigned sites', 'DPR, measurements, material requests, RFIs', 'Raises; approves nothing above own work'],
  ['CSUP', 'Civil Supervisor', SITE, 'Projects', 'Assigned sites / work fronts', 'Daily execution, crew instructions', 'Labour attendance confirmation for own crew'],
  ['WSUP', 'Workforce Supervisor', SITE, 'Projects', 'Assigned crews', 'Crew attendance, deployment, labour issues', 'Crew attendance verification, first-level regularisation'],
  ['PMSUP', 'Plant & Machinery Supervisor', SITE, 'Plant and machinery', 'Assigned sites / equipment', 'Equipment allocation, log books, fuel, maintenance', 'Log book verification, fuel issue approval within band'],
  ['SK', 'Storekeeper', SITE, 'Stores', 'Assigned stores', 'GRN, issues, returns, transfers, stock counts', 'Confirms receipts and issues; no financial approval'],
  ['PROCIC', 'Procurement In-charge (site)', SITE, 'Procurement', 'Assigned project', 'Local purchases, RFQs, follow-ups', 'Local purchase within small band'],
  ['SACC', 'Site Accountant', SITE, 'Finance', 'Assigned project', 'Site cash, imprest, vendor bill intake, payroll inputs', 'Imprest vouchers within band, bill verification'],
  ['QCE', 'Quality Control Engineer', SITE, 'Quality', 'Assigned sites', 'Inspections, tests, NCRs', 'Inspection acceptance, minor NCR closure'],
  ['HSEE', 'HSE Engineer', SITE, 'Health, safety and environment', 'Assigned sites', 'Permits, inspections, incidents, toolbox talks', 'Permit-to-work issue, HSE observation closure'],
  ['SUBCO', 'Subcontractor Coordinator', SITE, 'Projects', 'Assigned project', 'Subcontractor compliance, labour strength, bills intake', 'Verifies subcontractor measurements at first level'],
  ['SUPADM', 'Super Admin', SUP, 'Platform', 'Platform', 'Break-glass administration; every action audited and maker-checked', 'None; assignment needs the system administrator and the director'],
  ['AUD', 'Internal Auditor', SUP, 'Audit', 'Company (read-only)', 'Read-only access to records, audit trail, reports', 'None'],
  ['BD', 'Business Development Executive', SUP, 'Business development', 'Company', 'Leads, opportunities, client relations', 'None'],
  ['EST', 'Estimation & Tender Manager', SUP, 'Estimation', 'Company', 'Tenders, estimates, rate analysis', 'None'],
  ['QS', 'Quantity Surveyor / Billing Engineer', SUP, 'Commercial', 'Assigned projects', 'Measurement, BOQ reconciliation, RA bills, subcontract bills', 'None'],
  ['PLAN', 'Planning Engineer', SUP, 'Project controls', 'Assigned projects', 'Schedules, look-ahead, progress, delay records', 'None'],
  ['DOC', 'Document Controller', SUP, 'Projects', 'Assigned projects', 'Drawing register, transmittals, correspondence', 'None'],
  ['DESIGN', 'Design Coordinator', SUP, 'Projects', 'Assigned projects', 'RFIs, submittals, engineering deliverables', 'None'],
  ['FINEX', 'Accounts Executive', SUP, 'Finance', 'Company / branch', 'Voucher entry, reconciliations, AP/AR processing', 'None'],
  ['PAY', 'Payroll Officer', SUP, 'Human resources', 'Company', 'Payroll processing, statutory returns', 'None'],
  ['HSEO', 'HSE Officer', SUP, 'Health, safety and environment', 'Assigned sites', 'HSE inspections, inductions, PPE', 'None'],
  ['SECMGR', 'Security Manager', SUP, 'Security', 'Company', 'Guard deployment, gate, visitors, patrols', 'None'],
  ['SECSUP', 'Security Supervisor', SUP, 'Security', 'Site', 'Guard deployment, gate, visitors, patrols', 'None'],
  ['GUARD', 'Security Guard', SUP, 'Security', 'Post', 'Gate, visitors, patrols', 'None'],
  ['PLANTMGR', 'Plant & Equipment Manager (HO)', SUP, 'Plant and machinery', 'Company', 'Fleet, hiring, maintenance policy', 'None'],
  ['STOREMGR', 'Store Manager (central warehouse)', SUP, 'Stores', 'Assigned warehouses', 'Central stores operations', 'None'],
  ['EMP', 'Employee (self-service)', SUP, 'All', 'Own records', 'Attendance, leave, payslips, claims, tasks, messages', 'None'],
  ['X-SUP', 'Supplier user', EXT, 'Portal', "Own company's RFQs, quotations, POs, deliveries, invoices, payments", 'Supplier portal', 'None'],
  ['X-SUB', 'Subcontractor user', EXT, 'Portal', 'Own work orders, measurements, bills, compliance, labour', 'Subcontractor portal', 'None'],
  ['X-CLI', 'Client representative', EXT, 'Portal', 'Own projects: progress, bills for certification, approvals, shared documents', 'Client portal', 'None'],
  ['X-CON', 'Consultant / Engineer', EXT, 'Portal', 'Assigned projects: RFIs, submittals, inspections, drawings, bill verification', 'Consultant portal', 'None'],
];

/** What each role may read at most: a record marked above this is refused to the role (FR-09). */
const CLEARANCE = {
  DIR: 'restricted', SUPADM: 'restricted', AUD: 'restricted',
  CFO: 'confidential', ACCMGR: 'confidential', PROCMGR: 'confidential', COMMGR: 'confidential', HRMGR: 'confidential', PCMGR: 'confidential', PD: 'confidential', PM: 'confidential', QCMGR: 'confidential', PAY: 'confidential', FINEX: 'confidential',
  'X-SUP': 'public', 'X-SUB': 'public', 'X-CLI': 'public', 'X-CON': 'public',
};

const ADDED = {
  SYSADM: ['iam.role.view', 'iam.role.manage', 'iam.assignment.view', 'iam.assignment.manage'],
  ITADM: ['iam.role.view', 'iam.assignment.view'],
  DIR: ['iam.role.view', 'iam.assignment.view'],
  AUD: ['iam.role.view', 'iam.assignment.view'],
};
// The auditor reads what administrators and approvers can read, and changes nothing.
const AUDITOR_READS = ['org.view', 'iam.user.view', 'iam.security.view', 'core.requests.view', 'core.about.view', 'core.integrity.view', 'core.events.view', 'core.jobs.view', 'core.schedule.view', 'core.ops.view', 'core.connectors.view', 'core.calc.view', 'core.param.view', 'core.settings.view', 'core.fy.view', 'core.numbering.view', 'core.flag.view'];

const unique = (list) => [...new Set(list)].sort();

// Part 02.05. Rules are maintained by the system administrator and checked by the auditor or the director; anyone inside the company may ask
// for elevated access for themselves; department heads and other managers certify the access of their people in a review.
const ADDED_02_05 = {
  SYSADM: ['iam.sod.view', 'iam.sod.manage', 'iam.elevation.view', 'iam.elevation.revoke', 'iam.review.view', 'iam.review.manage', 'core.security.view', 'core.routes.view', 'iam.user.export', 'ui.styleguide.view', 'ui.nav.manage', 'ui.console.view', 'ui.dashboard.manage', 'ui.search.analytics', 'ui.translation.manage', 'ui.migration.view', 'ui.migration.signoff'],
  ITADM: ['iam.sod.view', 'iam.elevation.view', 'iam.elevation.revoke', 'core.security.view', 'core.routes.view', 'core.security.configure', 'iam.user.export', 'ui.console.view', 'ui.search.reindex', 'ui.search.analytics', 'ui.migration.view', 'ui.migration.signoff'], // part 03.08: the IT administrator rebuilds the search index and reads its analytics
  DIR: ['iam.sod.view', 'iam.sod.resolve', 'iam.elevation.view', 'iam.review.view', 'iam.review.manage'],
  AUD: ['iam.sod.view', 'iam.sod.resolve', 'iam.elevation.view', 'iam.review.view', 'iam.review.manage', 'core.audit.view', 'core.audit.verify', 'core.security.view', 'core.routes.view'],
  HRMGR: ['iam.user.export'],
  PCMGR: ['ui.dashboard.manage', 'ui.migration.view', 'ui.migration.signoff'], // part 03.07: the project controls manager sets the default dashboards of roles
};
// Part 04.02. The system administrator maintains the matrix, limits, escalation and SLA settings (the maker; the chain of the change is CFO or the process owner,
// then the director for large limits); the roles that approve or audit read them and run the simulator; everyone inside the company delegates their own approvals.
const ADDED_04_02 = {
  SYSADM: ['eng.matrix.view', 'eng.matrix.manage', 'eng.delegation.admin'],
  ITADM: ['eng.matrix.view', 'eng.delegation.admin'],
  DIR: ['eng.matrix.view'], CFO: ['eng.matrix.view'], AUD: ['eng.matrix.view'], ACCMGR: ['eng.matrix.view'], PROCMGR: ['eng.matrix.view'], PCMGR: ['eng.matrix.view'], HRMGR: ['eng.matrix.view', 'eng.delegation.admin'],
};
// Part 04.07. The IT administrator sets up the channels (a change is approved by the system administrator or a director); the system administrator, the auditor and the IT administrator read
// the communication log; those who deal with vendors, clients and staff keep the consent of the contacts they write to.
// Part 04.08. Everyone has their own tasks and may give themselves tasks; seniors give tasks to others and raise instructions; managers see the tasks of their team within their projects; the
// department heads (HR manager) and the system administrator keep the responsibility matrix, and a change of it is approved by the system administrator or a director.
const SENIORS_04_08 = ['tsk.team.view', 'tsk.task.assign', 'tsk.instruction.create'];
const ADDED_04_08 = {
  DIR: [...SENIORS_04_08, 'tsk.routing.view'], PD: SENIORS_04_08, PM: SENIORS_04_08, CFO: SENIORS_04_08, PROCMGR: SENIORS_04_08, COMMGR: SENIORS_04_08, HRMGR: [...SENIORS_04_08, 'tsk.routing.view', 'tsk.routing.edit'],
  SYSADM: ['tsk.team.view', 'tsk.routing.view', 'tsk.routing.edit'], ITADM: ['tsk.routing.view'], AUD: ['tsk.team.view', 'tsk.routing.view'],
};
// Part 04.09. The system administrator and the process owners keep the rules (one that sends messages outside is approved by the process owner and the system administrator); everybody has their own
// alerts; those who manage a project see and settle the alerts of it.
const OWNERS_04_09 = ['alr.rule.view', 'alr.rule.edit', 'alr.alert.view', 'alr.alert.manage'];
// Part 04.10. Everyone inside the company sees the documents of their projects, up to the level of confidentiality their role is trusted with; the authors add and revise; the document controller (DOC)
// keeps the register, the folders and the types; the system administrator keeps the configuration (a change is approved by the system administrator or a director).
const VIEW_04_10 = ['doc.document.view'];
const AUTHOR_04_10 = ['doc.document.view', 'doc.document.create'];
const SENIOR_04_10 = ['doc.document.view', 'doc.document.create', 'doc.document.view_confidential'];
const ADDED_04_10 = {
  DOC: ['doc.document.view', 'doc.document.view_confidential', 'doc.document.view_restricted', 'doc.document.create', 'doc.document.manage', 'doc.config.view', 'doc.config.edit'],
  DIR: ['doc.document.view', 'doc.document.view_confidential', 'doc.document.view_restricted', 'doc.config.view'], PD: [...SENIOR_04_10, 'doc.document.view_restricted'], PM: [...SENIOR_04_10, 'doc.config.view'], QCMGR: [...SENIOR_04_10, 'doc.config.view'],
  CFO: SENIOR_04_10, COMMGR: SENIOR_04_10, HRMGR: SENIOR_04_10, PCMGR: SENIOR_04_10, CM: SENIOR_04_10, PROCMGR: AUTHOR_04_10, ACCMGR: VIEW_04_10, FINEX: VIEW_04_10,
  SE: AUTHOR_04_10, QCE: AUTHOR_04_10, DESIGN: AUTHOR_04_10, PLAN: AUTHOR_04_10, QS: AUTHOR_04_10, EST: AUTHOR_04_10, BD: VIEW_04_10, HSEE: AUTHOR_04_10, HSEO: AUTHOR_04_10, CSUP: VIEW_04_10, WSUP: VIEW_04_10, PMSUP: VIEW_04_10,
  PROCIC: VIEW_04_10, SACC: VIEW_04_10, PLANTMGR: VIEW_04_10, STOREMGR: VIEW_04_10, AUD: ['doc.document.view', 'doc.document.view_confidential', 'doc.config.view'], SYSADM: ['doc.config.view', 'doc.config.edit'], ITADM: ['doc.config.view'],
};
// Part 04.11. The system administrator keeps the templates (the maker; a change is approved by the process owner of the document type) and the records published to the generator; the process owners see the
// templates they approve; whoever may print a document type generates and delivers it (a payslip or an offer letter needs the extra right of the HR manager and the director).
const PRINT_04_11 = ['tpl.document.view', 'tpl.document.generate', 'tpl.document.deliver'];
const OWNER_04_11 = ['tpl.template.view', 'tpl.document.view'];
const ADDED_04_11 = {
  SYSADM: ['tpl.template.view', 'tpl.template.edit', 'tpl.rule.edit', 'tpl.record.publish', 'tpl.document.view'], ITADM: ['tpl.template.view', 'tpl.document.view'], AUD: ['tpl.template.view', 'tpl.document.view'],
  DIR: [...OWNER_04_11, 'tpl.document.generate_sensitive'], CFO: [...OWNER_04_11, ...PRINT_04_11], PROCMGR: [...OWNER_04_11, ...PRINT_04_11], COMMGR: [...OWNER_04_11, ...PRINT_04_11], HRMGR: [...OWNER_04_11, ...PRINT_04_11, 'tpl.document.generate_sensitive'],
  PM: [...OWNER_04_11, ...PRINT_04_11], PD: PRINT_04_11, QCMGR: [...OWNER_04_11, ...PRINT_04_11], STOREMGR: [...OWNER_04_11, ...PRINT_04_11], HSEO: [...OWNER_04_11, ...PRINT_04_11], DOC: [...OWNER_04_11, ...PRINT_04_11],
  PCMGR: PRINT_04_11, ACCMGR: PRINT_04_11, FINEX: PRINT_04_11, SACC: PRINT_04_11, PROCIC: PRINT_04_11, CM: PRINT_04_11, QS: PRINT_04_11, SE: PRINT_04_11, QCE: PRINT_04_11, HSEE: PRINT_04_11, PLAN: PRINT_04_11,
};
// Part 04.12. The auditor and the system administrator keep the register (the administrator also revokes and changes the settings); whoever may see a generated document sees its signatures; whoever may print one
// signs it; the process owners and the document controller cancel a document.
const SEE_04_12 = ['sig.document.view'];
const SIGN_04_12 = ['sig.document.view', 'sig.document.sign'];
const OWN_04_12 = [...SIGN_04_12, 'sig.document.cancel'];
const ADDED_04_12 = {
  SYSADM: ['sig.register.view', 'sig.signature.revoke', 'sig.document.view', 'sig.document.cancel', 'sig.config.view', 'sig.config.edit'], ITADM: ['sig.register.view', 'sig.config.view'], AUD: ['sig.register.view', 'sig.document.view', 'sig.config.view'],
  DIR: [...SEE_04_12, 'sig.document.cancel'], CFO: OWN_04_12, PROCMGR: OWN_04_12, COMMGR: OWN_04_12, HRMGR: OWN_04_12, PM: OWN_04_12, DOC: OWN_04_12, PD: SIGN_04_12, QCMGR: OWN_04_12, STOREMGR: SIGN_04_12, HSEO: SIGN_04_12,
  PCMGR: SIGN_04_12, ACCMGR: SIGN_04_12, FINEX: SIGN_04_12, SACC: SIGN_04_12, PROCIC: SIGN_04_12, CM: SIGN_04_12, QS: SIGN_04_12, SE: SIGN_04_12, QCE: SIGN_04_12, HSEE: SIGN_04_12, PLAN: SIGN_04_12,
};
// Part 04.13. Anybody who may import something may open the Import Center; each import has its own right (<module>.<entity>.import) and the module's service still checks the right to create the record. The
// system administrator keeps the templates (a change is approved by a second person) and, with the auditor, sees every job.
const SAMPLE_04_13 = ['xl.import.use', 'eng.sample.import'];
const ADDED_04_13 = {
  SYSADM: ['xl.import.use', 'xl.template.view', 'xl.template.edit', 'xl.job.view_all', 'org.designation.import'], ITADM: ['xl.import.use', 'xl.template.view', 'xl.job.view_all'], AUD: ['xl.import.use', 'xl.template.view', 'xl.job.view_all'], DIR: ['xl.template.view'],
  HRMGR: ['xl.import.use', 'org.designation.import'], PD: SAMPLE_04_13, PM: SAMPLE_04_13, ACCMGR: SAMPLE_04_13, CFO: SAMPLE_04_13, PROCMGR: SAMPLE_04_13,
};
// Part 04.14. Whoever may open a record may comment on it, read its timeline and trace; a moderator (the system administrator, directors and project managers, in their scope) may delete another person's comment with a reason;
// the people who run a project or watch the business read the project activity feed; a trace link is added by hand only by those who run projects and finance, with a reason.
const ADDED_04_14 = {
  SYSADM: ['col.comment.moderate', 'col.trace.link', 'col.activity.view'], DIR: ['col.comment.moderate', 'col.trace.link', 'col.activity.view'], PD: ['col.comment.moderate', 'col.trace.link', 'col.activity.view'], PM: ['col.comment.moderate', 'col.trace.link', 'col.activity.view'],
  CFO: ['col.trace.link', 'col.activity.view'], AUD: ['col.activity.view'], PROCMGR: ['col.activity.view'], COMMGR: ['col.activity.view'], ACCMGR: ['col.activity.view'],
};
// Part 04.15. Field users use their own device without a permission (each command is checked against the right of its form); the IT administrator manages every device; the people who run a project confirm
// offline work that is older than the configured age; the auditor reads the whole sync log.
const ADDED_04_15 = {
  SYSADM: ['off.device.manage', 'off.sync.view_all'], ITADM: ['off.device.manage', 'off.sync.view_all'], AUD: ['off.sync.view_all'], DIR: ['off.sync.confirm'], PD: ['off.sync.confirm'], PM: ['off.sync.confirm'],
};
// Part 05.01. Every internal person writes direct and group messages with no permission (membership decides what they see); the people who run a project, a site or a department make its channel; the system
// administrator and the IT administrator see the migration check; the auditor exports a conversation for compliance.
const ADDED_05_01 = {
  SYSADM: ['msg.channel.manage', 'msg.admin.view', 'msg.settings.view', 'msg.settings.edit'], ITADM: ['msg.admin.view', 'msg.settings.view'], AUD: ['msg.admin.view', 'msg.compliance.export', 'msg.settings.view', 'msg.legal_hold.manage'], DIR: ['msg.channel.manage', 'msg.legal_hold.manage'], PD: ['msg.channel.manage'], PM: ['msg.channel.manage'], HRMGR: ['msg.channel.manage'],
};
// Part 05.03. Secure conversations themselves need no permission key (the policy names the roles that may start one); the system administrator keeps the policy and the licence register and sends the review,
// the IT administrator revokes lost devices and approves the licence review first, the director approves it last, the auditor reads both.
const ADDED_05_03 = {
  SYSADM: ['sec.policy.view', 'sec.policy.edit', 'sec.device.manage', 'sec.licence.view', 'sec.licence.edit'], ITADM: ['sec.policy.view', 'sec.device.manage', 'sec.licence.view'], AUD: ['sec.policy.view', 'sec.licence.view'], DIR: ['sec.policy.view', 'sec.licence.view'],
};
// Part 05.04. Project and department heads (PM, PD, DIR, HODs) send instructions and announcements within their scope; everybody acknowledges what is sent to them (no permission needed); the auditor, system administrator and
// director see every register; the system administrator keeps the auto group rules and the IT administrator or director approve them.
const SENDERS_05_04 = ['msg.instruction.send', 'msg.announcement.send'];
const ADDED_05_04 = {
  SYSADM: ['msg.comm.view_all', 'msg.autogroup.view', 'msg.autogroup.edit'], ITADM: ['msg.autogroup.view'], AUD: ['msg.comm.view_all', 'msg.autogroup.view'], DIR: [...SENDERS_05_04, 'msg.comm.view_all', 'msg.autogroup.view'], PD: [...SENDERS_05_04, 'msg.comm.view_all'], PM: SENDERS_05_04,
  HRMGR: SENDERS_05_04, CFO: SENDERS_05_04, PROCMGR: SENDERS_05_04, COMMGR: SENDERS_05_04, ACCMGR: SENDERS_05_04, PCMGR: SENDERS_05_04,
};
// Part 05.05. The owners of policies (HR, finance, quality, procurement, HSE, accounts, commercial, project controls) write them and tag their requirements; the director, the auditor and the system administrator see the whole
// register; the administrators (system, IT) and the director see the drafts made from policies, which they activate on the screen of the engine that owns them. Everyone reads and acknowledges what applies to them (no permission).
const AUTHORS_05_05 = ['pol.policy.create', 'pol.policy.view_all', 'pol.requirement.manage'];
const ADDED_05_05 = {
  HRMGR: AUTHORS_05_05, CFO: AUTHORS_05_05, QCMGR: AUTHORS_05_05, PROCMGR: AUTHORS_05_05, HSEE: AUTHORS_05_05, ACCMGR: AUTHORS_05_05, COMMGR: AUTHORS_05_05, PCMGR: AUTHORS_05_05,
  DIR: ['pol.policy.view_all', 'pol.draft.view'], AUD: ['pol.policy.view_all'], SYSADM: ['pol.policy.view_all', 'pol.draft.view'], ITADM: ['pol.draft.view'],
};
// Part 06.01. Everyone in the company (internal roles) sees the governed masters and may ask for a new record or a change (it goes to the stewards). The masters' owners (procurement, commercial, accounts, finance) may edit
// them directly where a field is not sensitive, merge duplicates and import; the accounts and finance heads, the auditor and the director see the sensitive fields (PAN, GSTIN, bank). The administrators and the heads see
// the governance pages; the system administrator proposes the quality rules and the stewards (approved by the IT administrator or the director). A steward is named per master, not by a role.
const EDITORS_06_01 = ['mdm.record.edit', 'mdm.record.import', 'mdm.governance.view'];
const ADDED_06_01 = {
  PROCMGR: EDITORS_06_01, COMMGR: EDITORS_06_01, ACCMGR: [...EDITORS_06_01, 'mdm.sensitive.view'], CFO: [...EDITORS_06_01, 'mdm.sensitive.view'],
  DIR: ['mdm.governance.view', 'mdm.sensitive.view'], AUD: ['mdm.governance.view', 'mdm.sensitive.view'], SYSADM: ['mdm.governance.view', 'mdm.config.edit'], ITADM: ['mdm.governance.view'],
};
// Part 06.02. Everyone reads the common masters (mdm.record.view of 06.01). Their stewards keep them: the accounts manager the taxes (a change approved by another accounts manager and the CFO), banks, payment terms,
// states, currencies and rates; the procurement manager the units of measure; the system administrator the lookup lists.
const ADDED_06_02 = { ACCMGR: ['mdm.tax.edit', 'mdm.finance.edit'], PROCMGR: ['mdm.uom.edit'], SYSADM: ['mdm.lookup.edit'] };
// Part 06.03. Everyone finds items through the selector (mdm.record.view) and may ask for a new one; the stewards keep the items of their categories (the category names the steward role: PROCMGR
// materials and services, STOREMGR consumables, spares and tools, EST labour and work items, PLANTMGR equipment classes) and import them; the people who estimate, buy, store, run projects or watch the
// money see the rates; the procurement manager, the estimator and the system administrator keep the categories; the procurement manager and the system administrator migrate the old materials.
const STEWARD_06_03 = ['mdm.item.edit', 'mdm.item.rate.view', 'mdm.item.import'];
const ADDED_06_03 = {
  PROCMGR: [...STEWARD_06_03, 'mdm.item.category.edit', 'mdm.item.migrate'], STOREMGR: STEWARD_06_03, EST: [...STEWARD_06_03, 'mdm.item.category.edit'], PLANTMGR: STEWARD_06_03,
  SYSADM: ['mdm.item.category.edit', 'mdm.item.migrate'], QS: ['mdm.item.rate.view'], ACCMGR: ['mdm.item.rate.view'], CFO: ['mdm.item.rate.view'], PM: ['mdm.item.rate.view'], PD: ['mdm.item.rate.view'], DIR: ['mdm.item.rate.view'], AUD: ['mdm.item.rate.view'], COMMGR: ['mdm.item.rate.view'],
};
// Part 06.04. Everyone sees the partners (mdm.record.view); the procurement manager keeps vendors, service providers and transporters, the commercial manager subcontractors, labour contractors, clients and
// consultants, business development registers client prospects; they ask for bank changes and blacklisting. The accounts manager verifies statutory and bank details, keeps TDS settings, sees identity
// numbers and full account numbers (each view logged), and approves bank changes with the CFO; the director approves blacklisting. Holds: the stewards and the accounts manager.
const STEWARD_06_04 = ['mdm.partner.edit', 'mdm.partner.bank.request', 'mdm.partner.blacklist', 'mdm.partner.hold', 'mdm.partner.queue'];
const ADDED_06_04 = {
  PROCMGR: STEWARD_06_04, COMMGR: STEWARD_06_04, BD: ['mdm.partner.edit'],
  ACCMGR: ['mdm.partner.sensitive.view', 'mdm.partner.bank.view', 'mdm.partner.bank.request', 'mdm.partner.verify', 'mdm.partner.hold', 'mdm.partner.queue'],
  CFO: ['mdm.partner.sensitive.view', 'mdm.partner.bank.view', 'mdm.partner.queue'], DIR: ['mdm.partner.sensitive.view', 'mdm.partner.queue'], AUD: ['mdm.partner.sensitive.view'],
};
// part 06.05: the chart of accounts and cost codes. The accounts manager proposes accounts, groups and mappings and imports (maker), the project controls manager proposes cost heads and codes, the CFO approves;
// finance, project, estimation and procurement people see the chart and the cost codes they code costs to.
const ADDED_06_05 = {
  ACCMGR: ['fin.coa.view', 'fin.coa.edit', 'fin.costcode.edit', 'fin.import'], PCMGR: ['fin.coa.view', 'fin.costcode.edit'],
  CFO: ['fin.coa.view'], DIR: ['fin.coa.view'], AUD: ['fin.coa.view'], FINEX: ['fin.coa.view'], SACC: ['fin.coa.view'], PD: ['fin.coa.view'], PM: ['fin.coa.view'], PROCMGR: ['fin.coa.view'], COMMGR: ['fin.coa.view'], EST: ['fin.coa.view'], QS: ['fin.coa.view'], PLAN: ['fin.coa.view'], PLANTMGR: ['fin.coa.view'],
};
// part 06.06: rate analyses. The estimator prepares analyses and keeps the rate library and the schedules of rates; the director releases standard analyses, the project manager project ones and the
// commercial manager variations (approve); QS and project controls read them.
const READ_06_06 = ['mdm.analyse.view', 'mdm.analyse.print', 'mdm.analyse.export'];
const ADDED_06_06 = {
  EST: [...READ_06_06, 'mdm.analyse.create', 'mdm.analyse.edit', 'mdm.analyse.delete', 'mdm.analyse.submit', 'mdm.analyse.cancel', 'mdm.analyse.amend', 'mdm.rate.edit'],
  QS: READ_06_06, PCMGR: READ_06_06, DIR: [...READ_06_06, 'mdm.analyse.approve', 'mdm.analyse.cancel'], PM: [...READ_06_06, 'mdm.analyse.approve'], COMMGR: [...READ_06_06, 'mdm.analyse.approve'], PD: READ_06_06,
};
// Part 07.01. The HR manager keeps the employee master (the maker; a second HR manager approves) and sees statutory and bank details with the payroll officer, who also verifies bank accounts; the director approves
// designation changes of senior grades; the auditor reads the directory. Every internal role may look at people they manage or who are deployed to their projects and sites (basic data only: team.view);
// the employee sees and requests changes to their own record without a permission.
const ADDED_07_01 = {
  HRMGR: ['hr.employee.view', 'hr.employee.team.view', 'hr.employee.create', 'hr.employee.edit', 'hr.employee.delete', 'hr.employee.submit', 'hr.employee.approve', 'hr.employee.cancel', 'hr.employee.amend', 'hr.employee.print', 'hr.employee.export', 'hr.employee.import', 'hr.employee.sensitive.view', 'hr.employee.separate', 'hr.employee.link_user', 'hr.employee.queue'],
  PAY: ['hr.employee.view', 'hr.employee.print', 'hr.employee.export', 'hr.employee.sensitive.view', 'hr.employee.bank.verify', 'hr.employee.queue'],
  DIR: ['hr.employee.view', 'hr.employee.approve', 'hr.employee.queue'], AUD: ['hr.employee.view'], PM: ['hr.employee.export'], PD: ['hr.employee.export'],
};
// Part 07.02. Hiring managers raise requisitions for their own people and give interview feedback; the HR manager runs the pipeline, offers and onboarding; the director and the project heads approve; the auditor reads;
// the departments that own a joining task (IT, safety, payroll, stores) see and complete their own tasks.
const HIRING_07_02 = ['hr.requisition.view', 'hr.requisition.create', 'hr.requisition.edit', 'hr.requisition.delete', 'hr.requisition.submit', 'hr.requisition.cancel', 'hr.requisition.print', 'hr.interview.give'];
const TASK_OWNER_07_02 = ['hr.onboarding.view', 'hr.onboarding.complete'];
const ADDED_07_02 = {
  HRMGR: ['hr.requisition.view', 'hr.requisition.view_all', 'hr.requisition.create', 'hr.requisition.edit', 'hr.requisition.delete', 'hr.requisition.submit', 'hr.requisition.approve', 'hr.requisition.cancel', 'hr.requisition.amend', 'hr.requisition.print', 'hr.requisition.export', 'hr.offer.view', 'hr.offer.create', 'hr.offer.edit', 'hr.offer.delete', 'hr.offer.submit', 'hr.offer.approve', 'hr.offer.cancel', 'hr.offer.amend', 'hr.offer.print', 'hr.offer.export', 'hr.candidate.view', 'hr.candidate.edit', 'hr.interview.give', 'hr.onboarding.view', 'hr.onboarding.complete', 'hr.plan.edit'],
  DIR: ['hr.requisition.view', 'hr.requisition.view_all', 'hr.requisition.approve', 'hr.requisition.print', 'hr.offer.view', 'hr.offer.approve', 'hr.offer.print', 'hr.candidate.view', 'hr.interview.give', ...HIRING_07_02.filter((k) => k !== 'hr.requisition.view')],
  AUD: ['hr.requisition.view', 'hr.requisition.view_all', 'hr.offer.view', 'hr.candidate.view'],
  PM: [...HIRING_07_02, 'hr.requisition.approve'], PD: [...HIRING_07_02, 'hr.requisition.approve'], CM: HIRING_07_02, COMMGR: HIRING_07_02, PROCMGR: HIRING_07_02, ACCMGR: HIRING_07_02, PCMGR: HIRING_07_02, QCMGR: HIRING_07_02, PLANTMGR: HIRING_07_02, STOREMGR: [...HIRING_07_02, ...TASK_OWNER_07_02], CFO: HIRING_07_02, HSEE: HIRING_07_02, SECMGR: HIRING_07_02,
  SYSADM: TASK_OWNER_07_02, ITADM: TASK_OWNER_07_02, HSEO: TASK_OWNER_07_02, PAY: TASK_OWNER_07_02,
};
// Part 07.03. The HR manager runs everything; project and construction managers deploy within their projects (the project managers and directors approve); the site supervisor keeps the members of their
// own crews; the site engineer, the auditor and the director read.
const DEPLOY_07_03 = ['hr.deployment.amend', 'hr.transfer.amend', 'hr.deployment.view', 'hr.deployment.create', 'hr.deployment.edit', 'hr.deployment.delete', 'hr.deployment.submit', 'hr.deployment.cancel', 'hr.deployment.print', 'hr.deployment.export', 'hr.crew.view', 'hr.crew.edit', 'hr.crew.members', 'hr.transfer.view', 'hr.transfer.create', 'hr.transfer.edit', 'hr.transfer.delete', 'hr.transfer.submit', 'hr.transfer.cancel', 'hr.transfer.print'];
const ADDED_07_03 = {
  HRMGR: ['hr.deployment.view', 'hr.deployment.create', 'hr.deployment.edit', 'hr.deployment.delete', 'hr.deployment.submit', 'hr.deployment.approve', 'hr.deployment.cancel', 'hr.deployment.amend', 'hr.deployment.print', 'hr.deployment.export', 'hr.deployment.import', 'hr.transfer.view', 'hr.transfer.create', 'hr.transfer.edit', 'hr.transfer.delete', 'hr.transfer.submit', 'hr.transfer.approve', 'hr.transfer.cancel', 'hr.transfer.amend', 'hr.transfer.print', 'hr.transfer.export', 'hr.crew.view', 'hr.crew.edit', 'hr.crew.members', 'hr.siteplan.edit'],
  PM: [...DEPLOY_07_03, 'hr.deployment.approve', 'hr.transfer.approve', 'hr.deployment.import'], PD: [...DEPLOY_07_03, 'hr.deployment.approve', 'hr.transfer.approve'],
  CM: DEPLOY_07_03, DIR: ['hr.deployment.view', 'hr.deployment.print', 'hr.deployment.export', 'hr.transfer.view', 'hr.transfer.print', 'hr.crew.view'],
  AUD: ['hr.deployment.view', 'hr.transfer.view', 'hr.crew.view'], SE: ['hr.deployment.view', 'hr.crew.view'], WSUP: ['hr.deployment.view', 'hr.crew.view', 'hr.crew.members'],
  PLAN: ['hr.deployment.view', 'hr.crew.view', 'hr.siteplan.edit'],
};
// Part 07.04. The HR manager keeps shifts, policies, assignments and periods; the director approves policies that touch pay; project and construction managers plan rosters of their projects (project managers approve changes); the
// site supervisor asks for changes of their crews; payroll and the auditor read.
const ROSTER_07_04 = ['att.shift.view', 'att.assignment.view', 'att.roster.view', 'att.roster.edit', 'att.roster.change', 'att.roster.approve', 'att.policy.view'];
const ADDED_07_04 = {
  HRMGR: ['att.shift.view', 'att.shift.edit', 'att.policy.view', 'att.policy.create', 'att.policy.edit', 'att.policy.delete', 'att.policy.submit', 'att.policy.approve', 'att.policy.cancel', 'att.policy.amend', 'att.policy.print', 'att.policy.export', 'att.assignment.view', 'att.assignment.edit', 'att.roster.view', 'att.roster.edit', 'att.roster.change', 'att.roster.approve', 'att.period.view', 'att.period.manage'],
  DIR: ['att.shift.view', 'att.policy.view', 'att.policy.approve', 'att.policy.print', 'att.assignment.view', 'att.period.view'],
  PM: ROSTER_07_04, PD: ROSTER_07_04, CM: ROSTER_07_04.filter((k) => k !== 'att.roster.approve'),
  WSUP: ['att.shift.view', 'att.assignment.view', 'att.roster.view', 'att.roster.change', 'att.roster.approve'], SE: ['att.shift.view'],
  AUD: ['att.shift.view', 'att.policy.view', 'att.assignment.view', 'att.roster.view', 'att.period.view'], PAY: ['att.shift.view', 'att.policy.view', 'att.assignment.view', 'att.period.view'],
};
// Part 07.05. Everyone with an employee record punches for themselves; the HR manager sees all, sets the sites and reviews anomalies; project managers and site engineers see the site; the supervisor punches the crew and
// reviews what happened at the site; the kiosk is run by the people at the site gate.
const ADDED_07_05 = {
  HRMGR: ['att.punch.own', 'att.punch.view', 'att.punch.crew', 'att.punch.kiosk', 'att.punch.device', 'att.punch.settings', 'att.anomaly.view', 'att.anomaly.review'],
  DIR: ['att.punch.view', 'att.anomaly.view'], PM: ['att.punch.view', 'att.anomaly.view', 'att.anomaly.review', 'att.punch.kiosk'], PD: ['att.punch.view', 'att.anomaly.view', 'att.anomaly.review'], CM: ['att.punch.view', 'att.anomaly.view', 'att.punch.kiosk'],
  SE: ['att.punch.view', 'att.punch.kiosk'], WSUP: ['att.punch.view', 'att.punch.crew', 'att.punch.kiosk', 'att.anomaly.view', 'att.anomaly.review'], SECMGR: ['att.punch.kiosk', 'att.punch.view'], AUD: ['att.punch.view', 'att.anomaly.view'], ITADM: ['att.punch.device'], PAY: ['att.punch.view'],
};
// Part 07.06. Everyone requests a regularisation or overtime for themselves; the supervisor and the project manager raise them for the crew and approve them first-level; the HR manager approves the rest, enters attendance by hand, locks the
// periods and asks for them to be reopened (the finance head approves that); payroll sees the register and the arrears.
const ADDED_07_06 = {
  HRMGR: ['hr.regularisation.view', 'hr.regularisation.create', 'hr.regularisation.edit', 'hr.regularisation.delete', 'hr.regularisation.submit', 'hr.regularisation.approve', 'hr.regularisation.cancel', 'hr.regularisation.amend', 'hr.regularisation.print', 'hr.regularisation.export', 'hr.overtime_request.view', 'hr.overtime_request.create', 'hr.overtime_request.edit', 'hr.overtime_request.delete', 'hr.overtime_request.submit', 'hr.overtime_request.approve', 'hr.overtime_request.cancel', 'hr.overtime_request.amend', 'hr.overtime_request.print', 'hr.overtime_request.export', 'att.manual.view', 'att.manual.create', 'att.manual.edit', 'att.manual.delete', 'att.manual.submit', 'att.manual.approve', 'att.manual.cancel', 'att.manual.amend', 'att.manual.print', 'att.manual.export', 'att.register.view', 'att.register.export', 'att.daily.recompute', 'att.period.lock', 'att.period.reopen', 'att.arrears.view', 'att.device.import'],
  EMP: ['hr.regularisation.view', 'hr.regularisation.create', 'hr.regularisation.edit', 'hr.regularisation.delete', 'hr.regularisation.submit', 'hr.regularisation.cancel', 'hr.regularisation.print', 'hr.overtime_request.view', 'hr.overtime_request.create', 'hr.overtime_request.edit', 'hr.overtime_request.delete', 'hr.overtime_request.submit', 'hr.overtime_request.cancel', 'hr.overtime_request.print'],
  WSUP: ['hr.regularisation.view', 'hr.regularisation.create', 'hr.regularisation.edit', 'hr.regularisation.delete', 'hr.regularisation.submit', 'hr.regularisation.cancel', 'hr.regularisation.print', 'hr.regularisation.approve', 'hr.overtime_request.view', 'hr.overtime_request.create', 'hr.overtime_request.edit', 'hr.overtime_request.delete', 'hr.overtime_request.submit', 'hr.overtime_request.cancel', 'hr.overtime_request.print', 'hr.overtime_request.approve', 'att.register.view'],
  PM: ['hr.regularisation.view', 'hr.regularisation.create', 'hr.regularisation.edit', 'hr.regularisation.delete', 'hr.regularisation.submit', 'hr.regularisation.approve', 'hr.regularisation.cancel', 'hr.regularisation.amend', 'hr.regularisation.print', 'hr.regularisation.export', 'hr.overtime_request.view', 'hr.overtime_request.create', 'hr.overtime_request.edit', 'hr.overtime_request.delete', 'hr.overtime_request.submit', 'hr.overtime_request.approve', 'hr.overtime_request.cancel', 'hr.overtime_request.amend', 'hr.overtime_request.print', 'hr.overtime_request.export', 'att.register.view', 'att.register.export', 'att.arrears.view'],
  CM: ['hr.regularisation.view', 'hr.regularisation.create', 'hr.regularisation.edit', 'hr.regularisation.delete', 'hr.regularisation.submit', 'hr.regularisation.cancel', 'hr.regularisation.print', 'hr.regularisation.approve', 'hr.overtime_request.view', 'hr.overtime_request.create', 'hr.overtime_request.edit', 'hr.overtime_request.delete', 'hr.overtime_request.submit', 'hr.overtime_request.cancel', 'hr.overtime_request.print', 'hr.overtime_request.approve', 'att.register.view', 'att.register.export'],
  PD: ['hr.regularisation.view', 'hr.regularisation.print', 'hr.overtime_request.view', 'hr.overtime_request.print', 'att.register.view'],
  SE: ['hr.regularisation.view', 'hr.regularisation.create', 'hr.regularisation.edit', 'hr.regularisation.delete', 'hr.regularisation.submit', 'hr.regularisation.cancel', 'hr.regularisation.print', 'hr.overtime_request.view', 'hr.overtime_request.create', 'hr.overtime_request.edit', 'hr.overtime_request.delete', 'hr.overtime_request.submit', 'hr.overtime_request.cancel', 'hr.overtime_request.print', 'att.register.view'],
  DIR: ['hr.regularisation.view', 'hr.regularisation.print', 'hr.regularisation.export', 'hr.overtime_request.view', 'hr.overtime_request.print', 'hr.overtime_request.export', 'att.register.view', 'att.register.export', 'att.arrears.view'],
  AUD: ['hr.regularisation.view', 'hr.overtime_request.view', 'att.register.view', 'att.arrears.view'],
  PAY: ['hr.regularisation.view', 'hr.overtime_request.view', 'att.register.view', 'att.register.export', 'att.arrears.view'],
  CFO: ['att.period.reopen', 'att.register.view', 'att.arrears.view'],
  ITADM: ['att.device.import'],
};
// Part 07.07. Everyone with an employee record applies for leave and amends or cancels their own; the reporting manager (any role) decides on the worklist; supervisors and managers see the team and raise leave for them; the HR manager keeps
// the types, adjusts balances, runs the accrual and the year-end.
const ADDED_07_07 = {
  HRMGR: ['hr.application.view', 'hr.application.create', 'hr.application.edit', 'hr.application.delete', 'hr.application.submit', 'hr.application.approve', 'hr.application.cancel', 'hr.application.amend', 'hr.application.print', 'hr.application.export', 'lv.type.view', 'lv.type.edit', 'lv.adjust.view', 'lv.adjust.create', 'lv.team.view', 'lv.yearend.run', 'lv.accrual.run'],
  EMP: ['hr.application.view', 'hr.application.create', 'hr.application.edit', 'hr.application.delete', 'hr.application.submit', 'hr.application.approve', 'hr.application.cancel', 'hr.application.amend', 'hr.application.print'],
  WSUP: ['hr.application.view', 'hr.application.create', 'hr.application.edit', 'hr.application.delete', 'hr.application.submit', 'hr.application.approve', 'hr.application.cancel', 'hr.application.print', 'lv.team.view'],
  PM: ['hr.application.view', 'hr.application.create', 'hr.application.edit', 'hr.application.delete', 'hr.application.submit', 'hr.application.approve', 'hr.application.cancel', 'hr.application.amend', 'hr.application.print', 'hr.application.export', 'lv.team.view'],
  CM: ['hr.application.view', 'hr.application.create', 'hr.application.edit', 'hr.application.delete', 'hr.application.submit', 'hr.application.approve', 'hr.application.cancel', 'hr.application.amend', 'hr.application.print', 'hr.application.export', 'lv.team.view'],
  PD: ['hr.application.view', 'hr.application.print', 'hr.application.export', 'lv.team.view'],
  SE: ['hr.application.view', 'hr.application.create', 'hr.application.edit', 'hr.application.delete', 'hr.application.submit', 'hr.application.approve', 'hr.application.cancel', 'hr.application.print', 'lv.team.view'],
  DIR: ['hr.application.view', 'hr.application.print', 'hr.application.export', 'lv.team.view'],
  AUD: ['hr.application.view', 'lv.team.view', 'lv.type.view', 'lv.adjust.view'],
  PAY: ['hr.application.view', 'hr.application.export', 'lv.team.view', 'lv.type.view'],
};
// Part 07.08. Supervisors and subcontractor coordinators register workers (first level of approval); the HR manager approves the KYC, keeps clearance, blacklisting and the wage rates; the commercial manager approves contract rates;
// safety people record clearance; payroll sees the register, with the bank and ID details it needs.
const ADDED_07_08 = {
  HRMGR: ['hr.worker.view', 'hr.worker.create', 'hr.worker.edit', 'hr.worker.delete', 'hr.worker.submit', 'hr.worker.approve', 'hr.worker.cancel', 'hr.worker.amend', 'hr.worker.print', 'hr.worker.export', 'hr.worker.view_all', 'hr.worker.view_sensitive', 'hr.worker.clear', 'hr.worker.blacklist', 'hr.worker.configure', 'hr.worker.compliance'],
  SUBCO: ['hr.worker.view', 'hr.worker.create', 'hr.worker.edit', 'hr.worker.delete', 'hr.worker.submit', 'hr.worker.approve', 'hr.worker.cancel', 'hr.worker.print', 'hr.worker.export', 'hr.worker.compliance'],
  WSUP: ['hr.worker.view', 'hr.worker.create', 'hr.worker.edit', 'hr.worker.delete', 'hr.worker.submit', 'hr.worker.cancel', 'hr.worker.print', 'hr.worker.approve'],
  PM: ['hr.worker.view', 'hr.worker.create', 'hr.worker.edit', 'hr.worker.delete', 'hr.worker.submit', 'hr.worker.approve', 'hr.worker.cancel', 'hr.worker.print', 'hr.worker.export'],
  CM: ['hr.worker.view', 'hr.worker.create', 'hr.worker.edit', 'hr.worker.delete', 'hr.worker.submit', 'hr.worker.approve', 'hr.worker.cancel', 'hr.worker.print'],
  COMMGR: ['hr.worker.view', 'hr.worker.approve', 'hr.worker.export', 'hr.worker.configure', 'hr.worker.compliance'],
  SE: ['hr.worker.view'],
  HSEE: ['hr.worker.view', 'hr.worker.view_all', 'hr.worker.clear', 'hr.worker.blacklist'],
  HSEO: ['hr.worker.view', 'hr.worker.clear'],
  DIR: ['hr.worker.view', 'hr.worker.print', 'hr.worker.export', 'hr.worker.view_all'],
  AUD: ['hr.worker.view', 'hr.worker.view_all'],
  PAY: ['hr.worker.view', 'hr.worker.export', 'hr.worker.view_all', 'hr.worker.view_sensitive'],
};
// Part 07.09. Every person with an employee record has the self-service (their own data) and asks for letters; the reporting-line views of a manager follow the people who report to them, so the right is given to everyone and the data decides;
// the HR manager approves and issues the letters.
const SELF_07_09 = ['hr.ess.view', 'hr.ess.team', 'hr.ess.letter.view', 'hr.ess.letter.create', 'hr.ess.letter.edit', 'hr.ess.letter.delete', 'hr.ess.letter.submit', 'hr.ess.letter.cancel', 'hr.ess.letter.print'];
const ADDED_07_09 = { HRMGR: ['hr.ess.view', 'hr.ess.team', 'hr.ess.letter.view', 'hr.ess.letter.create', 'hr.ess.letter.edit', 'hr.ess.letter.delete', 'hr.ess.letter.submit', 'hr.ess.letter.cancel', 'hr.ess.letter.print', 'hr.ess.letter.approve', 'hr.ess.letter.view_all', 'hr.ess.issue'] };
// Part 07.10. The HR manager keeps the courses, sessions, certificates and the matrix; the safety engineer plans and runs the safety trainings and verifies the certificates; managers nominate the people who report to them and assess their skills;
// everyone with an employee record has their own training (sign-in by QR, their certificates, feedback) without a right to anyone else's.
const SELF_07_10 = ['hr.training.own'];
const ADDED_07_10 = {
  HRMGR: ['hr.session.view', 'hr.session.create', 'hr.session.edit', 'hr.session.delete', 'hr.session.submit', 'hr.session.approve', 'hr.session.cancel', 'hr.session.amend', 'hr.session.print', 'hr.session.export', 'hr.training.nominate', 'hr.training.attendance', 'hr.training.own', 'hr.training.configure', 'hr.training.report', 'hr.cert.view', 'hr.cert.create', 'hr.cert.edit', 'hr.cert.verify', 'hr.cert.export', 'hr.cert.view_all', 'hr.cert.check', 'hr.skill.view', 'hr.skill.assess'],
  HSEE: ['hr.session.view', 'hr.session.create', 'hr.session.edit', 'hr.session.delete', 'hr.session.submit', 'hr.session.cancel', 'hr.session.print', 'hr.session.export', 'hr.training.nominate', 'hr.training.attendance', 'hr.training.report', 'hr.cert.view', 'hr.cert.create', 'hr.cert.edit', 'hr.cert.verify', 'hr.cert.export', 'hr.cert.view_all', 'hr.cert.check', 'hr.skill.view', 'hr.skill.assess'],
  HSEO: ['hr.session.view', 'hr.training.attendance', 'hr.training.nominate', 'hr.cert.view', 'hr.cert.check', 'hr.skill.view'],
  PM: ['hr.session.view', 'hr.training.nominate', 'hr.cert.view', 'hr.cert.check', 'hr.skill.view', 'hr.skill.assess', 'hr.session.approve', 'hr.training.report'], PD: ['hr.session.view', 'hr.training.nominate', 'hr.cert.view', 'hr.cert.check', 'hr.skill.view', 'hr.skill.assess', 'hr.training.report'], SE: ['hr.session.view', 'hr.training.nominate', 'hr.cert.view', 'hr.cert.check', 'hr.skill.view', 'hr.skill.assess'], CM: ['hr.session.view', 'hr.training.nominate', 'hr.cert.view', 'hr.cert.check', 'hr.skill.view', 'hr.skill.assess'], WSUP: ['hr.session.view', 'hr.training.nominate', 'hr.cert.view', 'hr.cert.check', 'hr.skill.view', 'hr.skill.assess'],
  DIR: ['hr.session.view', 'hr.session.export', 'hr.training.report', 'hr.cert.view', 'hr.cert.view_all', 'hr.cert.export', 'hr.skill.view'],
  AUD: ['hr.session.view', 'hr.training.report', 'hr.cert.view', 'hr.cert.view_all', 'hr.skill.view'],
};
// Part 07.11. Everybody with an employee record has their own performance (KPIs, goals, feedback, self-review); a manager sees and reviews the people who report to them (the data follows the reporting line, so the right is given to everyone);
// the HR manager keeps the library and the cycles, calibrates and issues letters; the director reads all and approves the senior grades.
const SELF_07_11 = ['hr.perf.own', 'hr.perf.team', 'hr.perf.feedback', 'hr.review.view', 'hr.review.edit', 'hr.review.approve', 'hr.review.print'];
const ADDED_07_11 = {
  HRMGR: ['hr.review.view', 'hr.review.create', 'hr.review.edit', 'hr.review.delete', 'hr.review.submit', 'hr.review.approve', 'hr.review.cancel', 'hr.review.amend', 'hr.review.print', 'hr.review.export', 'hr.review.view_all', 'hr.review.calibrate', 'hr.review.letter', 'hr.perf.own', 'hr.perf.team', 'hr.perf.feedback', 'hr.perf.configure', 'hr.perf.config_approve', 'hr.perf.compute', 'hr.perf.dispute_resolve'],
  DIR: ['hr.review.view_all', 'hr.review.export', 'hr.review.print', 'hr.review.approve'],
  AUD: ['hr.review.view_all'],
};
// Part 07.12. Everybody with an employee record raises their own travel requests, advances and claims, and approves those of the people who report to them (the reporting line decides, so the right is given to everyone);
// the accounts manager passes claims for payment, records the payment of advances and keeps the policies; payroll records the recoveries of salary advances; HR sees all advances and travel; the CFO activates policies.
const SELF_07_12 = ['hr.travel_request.view', 'hr.travel_request.create', 'hr.travel_request.edit', 'hr.travel_request.delete', 'hr.travel_request.submit', 'hr.travel_request.approve', 'hr.travel_request.cancel', 'hr.travel_request.print', 'hr.advance.view', 'hr.advance.create', 'hr.advance.edit', 'hr.advance.delete', 'hr.advance.submit', 'hr.advance.approve', 'hr.advance.cancel', 'hr.advance.print', 'hr.claim.view', 'hr.claim.create', 'hr.claim.edit', 'hr.claim.delete', 'hr.claim.submit', 'hr.claim.approve', 'hr.claim.cancel', 'hr.claim.print'];
const ADDED_07_12 = {
  ACCMGR: ['hr.claim.view_all', 'hr.claim.pass', 'hr.claim.export', 'hr.advance.view_all', 'hr.advance.disburse', 'hr.advance.export', 'hr.travel_request.view_all', 'hr.expense.configure', 'hr.expense.config_approve', 'hr.expense.report'],
  HRMGR: ['hr.claim.view_all', 'hr.advance.view_all', 'hr.advance.export', 'hr.advance.recover', 'hr.travel_request.view_all', 'hr.travel_request.export', 'hr.claim.export', 'hr.expense.report'],
  CFO: ['hr.claim.view_all', 'hr.claim.export', 'hr.advance.view_all', 'hr.advance.export', 'hr.travel_request.view_all', 'hr.expense.configure', 'hr.expense.config_approve', 'hr.expense.report'],
  DIR: ['hr.claim.view_all', 'hr.advance.view_all', 'hr.travel_request.view_all', 'hr.expense.report'],
  AUD: ['hr.claim.view_all', 'hr.advance.view_all', 'hr.travel_request.view_all', 'hr.expense.report'],
  PAY: ['hr.advance.view_all', 'hr.advance.recover'],
  PM: ['hr.expense.report'],
};
// Part 07.13. Everybody with an employee record resigns, raises grievances, approves the resignations of the people who report to them and clears what their department holds (the clearance says who owns it);
// HR handles separations, terminations, clearances' waivers, the full-and-final, letters, grievances and the restricted disciplinary cases; the director approves terminations and reads the cases; payroll sees the full-and-final inputs.
const SELF_07_13 = ['hr.separation.view', 'hr.separation.create', 'hr.separation.edit', 'hr.separation.delete', 'hr.separation.submit', 'hr.separation.approve', 'hr.separation.cancel', 'hr.separation.print', 'hr.grievance.view', 'hr.grievance.create', 'hr.grievance.edit', 'hr.grievance.delete', 'hr.grievance.submit', 'hr.grievance.cancel', 'hr.clearance.view', 'hr.clearance.clear'];
const ADDED_07_13 = {
  HRMGR: ['hr.separation.view', 'hr.separation.create', 'hr.separation.edit', 'hr.separation.delete', 'hr.separation.submit', 'hr.separation.approve', 'hr.separation.cancel', 'hr.separation.amend', 'hr.separation.print', 'hr.separation.export', 'hr.grievance.view', 'hr.grievance.create', 'hr.grievance.edit', 'hr.grievance.delete', 'hr.grievance.submit', 'hr.grievance.approve', 'hr.grievance.cancel', 'hr.grievance.amend', 'hr.grievance.print', 'hr.grievance.export', 'hr.separation.view_all', 'hr.separation.terminate', 'hr.separation.interview', 'hr.separation.fnf', 'hr.separation.letter', 'hr.clearance.view', 'hr.clearance.clear', 'hr.clearance.waive', 'hr.grievance.manage', 'hr.disciplinary.view', 'hr.disciplinary.manage'],
  DIR: ['hr.separation.view_all', 'hr.separation.approve', 'hr.separation.export', 'hr.separation.interview', 'hr.disciplinary.view', 'hr.grievance.export'],
  PAY: ['hr.separation.view_all', 'hr.separation.fnf'],
  AUD: ['hr.separation.view_all', 'hr.disciplinary.view'],
};
// Part 08.01. Business development executives work their own leads and opportunities (the data scope is the owner; the record is theirs to create, submit, track and convert; they review the work of a colleague, never their own);
// the director has the whole module; the estimation and commercial managers read everything and the forecast.
const ADDED_08_01 = {
  BD: ['bd.lead.view', 'bd.lead.create', 'bd.lead.edit', 'bd.lead.delete', 'bd.lead.submit', 'bd.lead.approve', 'bd.lead.cancel', 'bd.lead.amend', 'bd.lead.print', 'bd.lead.export', 'bd.lead.convert', 'bd.lead.import', 'bd.opportunity.view', 'bd.opportunity.create', 'bd.opportunity.edit', 'bd.opportunity.delete', 'bd.opportunity.submit', 'bd.opportunity.approve', 'bd.opportunity.cancel', 'bd.opportunity.amend', 'bd.opportunity.print', 'bd.opportunity.export', 'bd.opportunity.track', 'bd.opportunity.convert', 'bd.opportunity.win', 'bd.opportunity.import', 'bd.interaction.log', 'bd.contact.manage', 'bd.client.view', 'bd.forecast.view'],
  DIR: ['bd.lead.view', 'bd.lead.create', 'bd.lead.edit', 'bd.lead.delete', 'bd.lead.submit', 'bd.lead.approve', 'bd.lead.cancel', 'bd.lead.amend', 'bd.lead.print', 'bd.lead.export', 'bd.lead.convert', 'bd.lead.import', 'bd.opportunity.view', 'bd.opportunity.create', 'bd.opportunity.edit', 'bd.opportunity.delete', 'bd.opportunity.submit', 'bd.opportunity.approve', 'bd.opportunity.cancel', 'bd.opportunity.amend', 'bd.opportunity.print', 'bd.opportunity.export', 'bd.opportunity.track', 'bd.opportunity.convert', 'bd.opportunity.win', 'bd.opportunity.import', 'bd.view_all', 'bd.interaction.log', 'bd.contact.manage', 'bd.client.view', 'bd.forecast.view'],
  EST: ['bd.lead.view', 'bd.opportunity.view', 'bd.view_all', 'bd.client.view', 'bd.forecast.view'],
  COMMGR: ['bd.lead.view', 'bd.opportunity.view', 'bd.view_all', 'bd.client.view', 'bd.forecast.view'],
};
// Part 08.02. The estimation and tender manager manages the tender register, the eligibility, the addenda, the queries and the team, evaluates bid or no-bid and reviews the work of a colleague (never their own); the director decides; business development
// registers a tender from its opportunity and reads the decision; the commercial manager reads.
const ADDED_08_02 = {
  EST: ['bd.tender.view', 'bd.tender.create', 'bd.tender.edit', 'bd.tender.delete', 'bd.tender.submit', 'bd.tender.approve', 'bd.tender.cancel', 'bd.tender.amend', 'bd.tender.print', 'bd.tender.export', 'bd.tender.view_all', 'bd.tender.manage', 'bd.tender.ready', 'bd.tender.import', 'bd.bid_decision.view', 'bd.bid_decision.create', 'bd.bid_decision.edit', 'bd.bid_decision.delete', 'bd.bid_decision.submit', 'bd.bid_decision.approve', 'bd.bid_decision.cancel', 'bd.bid_decision.amend', 'bd.bid_decision.print', 'bd.bid_decision.export', 'bd.bid_decision.import'],
  DIR: ['bd.tender.view', 'bd.tender.create', 'bd.tender.edit', 'bd.tender.delete', 'bd.tender.submit', 'bd.tender.approve', 'bd.tender.cancel', 'bd.tender.amend', 'bd.tender.print', 'bd.tender.export', 'bd.tender.view_all', 'bd.tender.manage', 'bd.tender.ready', 'bd.tender.import', 'bd.bid_decision.view', 'bd.bid_decision.create', 'bd.bid_decision.edit', 'bd.bid_decision.delete', 'bd.bid_decision.submit', 'bd.bid_decision.approve', 'bd.bid_decision.cancel', 'bd.bid_decision.amend', 'bd.bid_decision.print', 'bd.bid_decision.export', 'bd.bid_decision.import'],
  BD: ['bd.tender.view', 'bd.tender.create', 'bd.tender.edit', 'bd.tender.delete', 'bd.tender.submit', 'bd.tender.cancel', 'bd.tender.amend', 'bd.tender.print', 'bd.bid_decision.view'],
  COMMGR: ['bd.tender.view', 'bd.tender.view_all', 'bd.tender.print', 'bd.bid_decision.view'],
};
// Part 08.03. The estimation and tender manager keeps the credentials, asks for EMD and fees, prepares and records the bid, enters the opening and records the award or the loss (and reviews a colleague's); accounts approves EMD requests, records the instruments and follows
// the refunds; the CFO approves EMD requests; the director approves the final bid and accepts an award; business development and the commercial manager read the results and the competitor analysis.
const ADDED_08_03 = {
  EST: ['bd.emd.view', 'bd.emd.create', 'bd.emd.edit', 'bd.emd.delete', 'bd.emd.submit', 'bd.emd.approve', 'bd.emd.cancel', 'bd.emd.amend', 'bd.emd.print', 'bd.emd.export', 'bd.emd.view_all', 'bd.emd.import', 'bd.award.view', 'bd.award.create', 'bd.award.edit', 'bd.award.delete', 'bd.award.submit', 'bd.award.approve', 'bd.award.cancel', 'bd.award.amend', 'bd.award.print', 'bd.award.export', 'bd.credential.view', 'bd.credential.manage', 'bd.submission.view', 'bd.submission.manage', 'bd.result.manage', 'bd.competitor.view'],
  DIR: ['bd.emd.view', 'bd.emd.create', 'bd.emd.edit', 'bd.emd.delete', 'bd.emd.submit', 'bd.emd.approve', 'bd.emd.cancel', 'bd.emd.amend', 'bd.emd.print', 'bd.emd.export', 'bd.emd.view_all', 'bd.emd.instrument', 'bd.emd.refund', 'bd.emd.import', 'bd.award.view', 'bd.award.create', 'bd.award.edit', 'bd.award.delete', 'bd.award.submit', 'bd.award.approve', 'bd.award.cancel', 'bd.award.amend', 'bd.award.print', 'bd.award.export', 'bd.credential.view', 'bd.credential.manage', 'bd.submission.view', 'bd.submission.manage', 'bd.result.manage', 'bd.competitor.view'],
  ACCMGR: ['bd.emd.view', 'bd.emd.view_all', 'bd.emd.approve', 'bd.emd.instrument', 'bd.emd.refund', 'bd.emd.print', 'bd.emd.export'],
  CFO: ['bd.emd.view', 'bd.emd.view_all', 'bd.emd.approve', 'bd.emd.print', 'bd.emd.export'],
  BD: ['bd.award.view', 'bd.competitor.view', 'bd.credential.view', 'bd.submission.view', 'bd.emd.view'],
  COMMGR: ['bd.award.view', 'bd.competitor.view', 'bd.credential.view'],
};
const ADDED_11_05 = {
  DOC: ['engg.letter.view', 'engg.letter.create', 'engg.letter.edit', 'engg.letter.delete', 'engg.letter.submit', 'engg.letter.cancel', 'engg.letter.amend', 'engg.letter.print', 'engg.letter.export', 'engg.letter.issue', 'engg.letter.view_confidential'],
  PM: ['engg.letter.view', 'engg.letter.create', 'engg.letter.edit', 'engg.letter.submit', 'engg.letter.approve', 'engg.letter.cancel', 'engg.letter.amend', 'engg.letter.print', 'engg.letter.export', 'engg.letter.issue', 'engg.letter.view_confidential'],
  COMMGR: ['engg.letter.view', 'engg.letter.create', 'engg.letter.edit', 'engg.letter.submit', 'engg.letter.approve', 'engg.letter.cancel', 'engg.letter.amend', 'engg.letter.print', 'engg.letter.export', 'engg.letter.issue', 'engg.letter.view_confidential'],
  PD: ['engg.letter.view', 'engg.letter.print', 'engg.letter.export', 'engg.letter.view_confidential'],
  DIR: ['engg.letter.view', 'engg.letter.print', 'engg.letter.export', 'engg.letter.view_confidential'],
  PCMGR: ['engg.letter.view', 'engg.letter.print', 'engg.letter.export'],
  CM: ['engg.letter.view', 'engg.letter.create', 'engg.letter.edit', 'engg.letter.delete', 'engg.letter.submit', 'engg.letter.cancel', 'engg.letter.print'],
  SE: ['engg.letter.view'],
  QS: ['engg.letter.view'],
  PLAN: ['engg.letter.view'],
  DESIGN: ['engg.letter.view', 'engg.letter.print'],
};
// Part 13.05: the delay register and the time-impact analysis. The planner records and analyses delays and sends their classification; the project manager and then the commercial manager approve it
// (the planner holds no approval); controls, construction, the director and audit read; the commercial roles read and export for the claims.
const DELAY_READ = ['plan.delay.view', 'plan.delay.print', 'plan.delay.export'];
// Part 14.01: work fronts, daily work plans and work authorisations ("no plan, no work"). The site engineer and the construction manager plan the day and raise WAs; the construction manager approves
// and the project manager approves what is outside the plan or an emergency (whoever raised a WA never decides it); the work supervisor sees the crews; quality and safety see the checks; the stores and
// plant record what they issue against a WA.
const WA_READ = ['site.work_authorisation.view', 'site.work_front.view', 'site.daily_plan.view'];
const WA_SITE = [...WA_READ, 'site.work_authorisation.create', 'site.work_authorisation.edit', 'site.work_authorisation.delete', 'site.work_authorisation.submit', 'site.work_authorisation.cancel', 'site.work_authorisation.amend', 'site.work_authorisation.print', 'site.work_authorisation.export', 'site.work_authorisation.close', 'site.work_front.manage', 'site.daily_plan.manage', 'site.wa.use'];
// Part 14.02: the daily progress report. The site engineer and the civil supervisor prepare and send it; the construction manager or the project manager approves it (an amendment goes to the project manager);
// planning, quantity surveying and project controls read it and the reports; direction and audit read.
const DPR_PREPARE = ['site.dpr.view', 'site.dpr.create', 'site.dpr.edit', 'site.dpr.delete', 'site.dpr.submit', 'site.dpr.cancel', 'site.dpr.amend', 'site.dpr.print', 'site.dpr.export'];
const DPR_APPROVE = ['site.dpr.view', 'site.dpr.approve', 'site.dpr.print', 'site.dpr.export', 'site.dpr.report'];
const DPR_READ = ['site.dpr.view', 'site.dpr.report'];
// Part 14.03: site conditions. The site engineer and the civil supervisor record the weather, hindrances, diary notes and visits; the construction manager approves hindrances (first step), signs the diary off and closes
// hindrances; the project manager approves them (second step); planning and the commercial manager read (hindrances are the evidence for delays and claims); direction and audit read.
const COND_READ = ['site.weather.view', 'site.hindrance.view', 'site.diary.view', 'site.visitor.view'];
const COND_RECORD = ['site.weather.view', 'site.weather.create', 'site.weather.edit', 'site.weather.delete', 'site.weather.export', 'site.hindrance.view', 'site.hindrance.create', 'site.hindrance.edit', 'site.hindrance.delete', 'site.hindrance.submit', 'site.hindrance.cancel', 'site.hindrance.amend', 'site.hindrance.print', 'site.hindrance.export', 'site.hindrance.close',
  'site.diary.view', 'site.diary.create', 'site.diary.edit', 'site.diary.delete', 'site.diary.export', 'site.visitor.view', 'site.visitor.create', 'site.visitor.edit', 'site.visitor.delete', 'site.visitor.export'];
// Part 14.04: site instructions and memos. The construction manager and the project manager issue and record (the CM approves the first step, the PM the second, of an instruction with a back-charge); the subcontractor
// coordinator and the site engineer record acknowledgements and compliance; the commercial manager decides the variation; amounts (the back-charge) are seen by those who deal with the money.
const INS_RECORD = ['site.instruction.view', 'site.instruction.create', 'site.instruction.edit', 'site.instruction.delete', 'site.instruction.submit', 'site.instruction.cancel', 'site.instruction.amend', 'site.instruction.print', 'site.instruction.export', 'site.instruction.acknowledge', 'site.instruction.comply', 'site.instruction.close', 'site.instruction.cost'];
// Part 14.05: progress measurement. Planning and project controls prepare and send the periods; the project manager closes them; direction, the project director, quantity surveying and audit read; the money
// (budget, planned and earned value, actual cost) is seen with `site.period.cost`.
const PRG_MANAGE = ['site.period.view', 'site.period.create', 'site.period.edit', 'site.period.delete', 'site.period.submit', 'site.period.cancel', 'site.period.amend', 'site.period.print', 'site.period.export', 'site.period.cost'];
// Part 14.06: productivity. The construction manager, project manager and project controls manager read; the site engineer reads and records the losses of the site; planning and project controls enter the norms
// (maker) and the project manager approves them (checker); direction, project direction, quantity surveying and audit read.
const PRD_READ = ['site.productivity.view'];
// Part 15.06: rate contracts, service orders and service entry sheets. The procurement officer and manager prepare contracts, orders and price-variation revisions; the procurement manager and commercial manager approve contracts and revisions (the direction above ₹ 1 crore);
// service orders are approved by value as purchase orders are; a service entry sheet is prepared on site by the site engineer, construction manager or procurement, certified by a site engineer and approved by the project manager. Rates are seen only by those who buy, approve or control cost.
const RC_PREPARE = ['proc.rate_contract.view', 'proc.rate_contract.create', 'proc.rate_contract.edit', 'proc.rate_contract.delete', 'proc.rate_contract.submit', 'proc.rate_contract.cancel', 'proc.rate_contract.amend', 'proc.rate_contract.print', 'proc.rate_contract.export', 'proc.rate_contract.rates', 'proc.rate_contract.index', 'proc.rate_contract.pv'];
const RC_READ = ['proc.rate_contract.view', 'proc.rate_contract.print', 'proc.rate_contract.export', 'proc.rate_contract.rates'];
const SO_PREPARE = ['proc.service_order.view', 'proc.service_order.create', 'proc.service_order.edit', 'proc.service_order.delete', 'proc.service_order.submit', 'proc.service_order.cancel', 'proc.service_order.amend', 'proc.service_order.print', 'proc.service_order.export', 'proc.service_order.rates'];
const SO_DECIDE = ['proc.service_order.view', 'proc.service_order.approve', 'proc.service_order.print', 'proc.service_order.export', 'proc.service_order.rates'];
const SE_PREPARE = ['proc.service_entry.view', 'proc.service_entry.create', 'proc.service_entry.edit', 'proc.service_entry.delete', 'proc.service_entry.submit', 'proc.service_entry.cancel', 'proc.service_entry.amend', 'proc.service_entry.print', 'proc.service_entry.export'];
const SE_DECIDE = ['proc.service_entry.view', 'proc.service_entry.approve', 'proc.service_entry.print', 'proc.service_entry.export'];
// Part 16.01: stores, stock ledger and valuation. A storekeeper works the stores they keep; the store manager runs the warehouses, approves stores and adjustments and checks the books; procurement, accounts and the project manager read (values included); the auditor reads.
const SK_STOCK = ['inv.store.view', 'inv.bin.view', 'inv.stock.view', 'inv.stock.post', 'inv.reservation.view', 'inv.reservation.reserve', 'inv.adjustment.view', 'inv.adjustment.create', 'inv.adjustment.submit'];
const INV_READ = ['inv.store.view', 'inv.store.all', 'inv.bin.view', 'inv.stock.view', 'inv.stock.values', 'inv.stock.export', 'inv.reservation.view', 'inv.adjustment.view'];
const GATE_ENTRY = ['inv.inward.view', 'inv.inward.create', 'inv.inward.edit', 'inv.inward.delete', 'inv.inward.submit', 'inv.inward.cancel', 'inv.inward.print', 'inv.inward.weigh', 'inv.inward.exit', 'inv.appointment.view', 'inv.appointment.create', 'inv.appointment.cancel'];
const GATE_PASS_DO = ['inv.pass.view', 'inv.pass.create', 'inv.pass.edit', 'inv.pass.delete', 'inv.pass.submit', 'inv.pass.cancel', 'inv.pass.amend', 'inv.pass.print', 'inv.pass.return'];
const GATE_READ = ['inv.inward.view', 'inv.inward.print', 'inv.inward.export', 'inv.pass.view', 'inv.pass.print', 'inv.pass.export', 'inv.appointment.view'];
const GRN_DO = ['inv.grn.view', 'inv.grn.create', 'inv.grn.edit', 'inv.grn.delete', 'inv.grn.submit', 'inv.grn.cancel', 'inv.grn.print', 'inv.rtv.view', 'inv.rtv.create', 'inv.rtv.edit', 'inv.rtv.delete', 'inv.rtv.submit', 'inv.rtv.cancel', 'inv.rtv.print'];
const GRN_READ = ['inv.grn.view', 'inv.grn.print', 'inv.grn.export', 'inv.rtv.view', 'inv.rtv.print', 'inv.rtv.export'];
const ISSUE_DO = ['inv.issue.view', 'inv.issue.create', 'inv.issue.edit', 'inv.issue.delete', 'inv.issue.submit', 'inv.issue.cancel', 'inv.issue.print', 'inv.issue.acknowledge', 'inv.site_return.view', 'inv.site_return.create', 'inv.site_return.edit', 'inv.site_return.delete', 'inv.site_return.submit', 'inv.site_return.cancel', 'inv.site_return.print'];
const ISSUE_READ = ['inv.issue.view', 'inv.issue.print', 'inv.issue.export', 'inv.site_return.view', 'inv.site_return.print', 'inv.site_return.export'];
const TRF_DO = ['inv.transfer.view', 'inv.transfer.create', 'inv.transfer.edit', 'inv.transfer.delete', 'inv.transfer.submit', 'inv.transfer.cancel', 'inv.transfer.print', 'inv.transfer.dispatch', 'inv.transfer.receive'];
const TRF_READ = ['inv.transfer.view', 'inv.transfer.print', 'inv.transfer.export'];
const CNT_DO = ['inv.count_plan.view', 'inv.count_plan.create', 'inv.count_plan.edit', 'inv.count_plan.delete', 'inv.count_plan.submit', 'inv.count_plan.cancel', 'inv.count_plan.print', 'inv.count_plan.count', 'inv.scrap_disposal.view', 'inv.scrap_disposal.register'];
const CNT_READ = ['inv.count_plan.view', 'inv.count_plan.print', 'inv.count_plan.export', 'inv.scrap_disposal.view', 'inv.scrap_disposal.print', 'inv.scrap_disposal.export'];
const MRC_READ = ['inv.reconciliation.view', 'inv.reconciliation.print', 'inv.reconciliation.export'];
// Part 16.11: materials management dashboard. Store and procurement managers, the direction and accounts read the company view (and export); a project manager reads the projects they hold.
// Part 17.01: the equipment register. The plant manager manages the fleet and approves; the plant supervisor registers and maintains the equipment of the sites assigned; the accounts manager reads, sees the financial fields and approves the capitalisation step.
const PLT_READ = ['plant.equipment.view', 'plant.equipment.print'];
// Part 17.02: requisition, allocation, mobilisation, transfer and operators. Site engineers and construction managers raise requisitions (the construction manager and project manager approve); the plant manager allocates, decides hire and approves transfers between projects;
// the plant supervisor mobilises, receives and moves machines and assigns operators; the project manager approves allocations to the project; accounts reads.
const REQ_RAISE = ['plant.requisition.view', 'plant.requisition.create', 'plant.requisition.edit', 'plant.requisition.delete', 'plant.requisition.submit', 'plant.requisition.cancel', 'plant.requisition.amend', 'plant.requisition.print'];
const REQ_APPROVE = ['plant.requisition.view', 'plant.requisition.approve', 'plant.requisition.print']; const ALLOC_READ = ['plant.allocation.view', 'plant.allocation.print'];
// Part 17.03: the log books. The plant supervisor enters and verifies (another supervisor verifies), the site engineer verifies, the project manager verifies hired equipment and reads the reports, the plant manager reads, amends, exports and reports,
// accounts reads the figures with their costs. Operators have no sign-in: the supervisor enters the log for them.
const RP_READ = ['plant.capacity.view', 'plant.resource_plan.view', 'plant.resource_plan.print'];
const RP_MAKE = ['plant.resource_plan.create', 'plant.resource_plan.edit', 'plant.resource_plan.delete', 'plant.resource_plan.submit', 'plant.resource_plan.cancel'];
// Part 17.08: capacity planning. The project controls, HR and plant managers read the capacity and draft plans; the project controls manager, the project directors and the director approve a plan; the project manager and audit read.
const qaAct = (r, a) => a.map((x) => `qa.${r}.${x}`);
const QA_VIEW = ['quality_plan', 'itp', 'template', 'inspection'].flatMap((r) => qaAct(r, ['view', 'print']));
const QA_MAKE = ['view', 'create', 'edit', 'delete', 'submit', 'cancel', 'print'];
// Part 18.01: quality plans, ITPs, checklist templates and inspections. The quality control manager owns the library and approves; the quality engineer, HSE engineer and plant supervisor make and perform in their own module; stores, the site engineer and the project manager perform or read.
// Part 18.07: the quality dashboard, control charts and ratings: the quality control manager, project manager, project director and director.
const ADDED_18_07 = { QCMGR: ['qa.dashboard.view', 'qa.dashboard.export'], PM: ['qa.dashboard.view', 'qa.dashboard.export'], PD: ['qa.dashboard.view'], DIR: ['qa.dashboard.view', 'qa.dashboard.export'] };
// Part 19.07: the labour camp. The camp in-charge (the HR manager) runs the camp and reviews recoveries, the workforce supervisor allocates beds and enters meals, the HSE engineer inspects, the project manager approves recoveries, the subcontractor coordinator sees occupancy.
const CP_VIEW = ['hse.camp.view', 'hse.allocation.view', 'hse.camp_meal.view', 'hse.camp_inspection.view'];
const CP_RUN = [...CP_VIEW, 'hse.camp.muster', 'hse.allocation.create', 'hse.allocation.edit', 'hse.allocation.cancel', 'hse.camp_meal.record', 'hse.camp_asset.edit', 'hse.recovery.view', 'hse.recovery.create', 'hse.recovery.edit', 'hse.recovery.delete', 'hse.recovery.submit', 'hse.recovery.cancel', 'hse.recovery.print', 'hse.allocation.export'];
// Part 22.01: the measurement book. The site engineer and the quantity surveyor measure; the QS checks (the first step), the client's consultant records a check measurement, and the project manager certifies (the second step).
const LG_RD = ['bill.advance.view', 'bill.advance.print', 'bill.release.view', 'bill.release.print', 'bill.retention.view'];
const LG_MAKE = ['bill.advance.create', 'bill.advance.edit', 'bill.advance.delete', 'bill.advance.submit', 'bill.advance.cancel', 'bill.advance.export', 'bill.release.create', 'bill.release.edit', 'bill.release.delete', 'bill.release.submit', 'bill.release.cancel', 'bill.release.export', 'bill.retention.export'];
const CV_RD = ['bill.report.view', 'bill.report.print', 'bill.control_tower.view'];
const CV_MAKE = ['bill.report.create', 'bill.report.edit', 'bill.report.delete', 'bill.report.submit', 'bill.report.cancel', 'bill.report.export'];
// Part 07.14 (built in 166.6): the workforce dashboard for HR, the payroll officer, the site management and the directors; the gates: the IT
// administrator (the technical lead of 07_APPROVAL_WORKFLOW_REFERENCE.md) reviews and sends for sign-off, the director signs, the auditor reads.
const ADDED_07_14 = {
  HRMGR: ['hr.workforce.view', 'hr.gate.view'], PAY: ['hr.workforce.view'], WSUP: ['hr.workforce.view'], PM: ['hr.workforce.view'], CM: ['hr.workforce.view'], PD: ['hr.workforce.view'],
  DIR: ['hr.workforce.view', 'hr.gate.view', 'hr.gate.export'], ITADM: ['hr.gate.view', 'hr.gate.review', 'hr.gate.export'], SYSADM: ['hr.gate.view'], AUD: ['hr.workforce.view', 'hr.gate.view', 'hr.gate.export'],
};
const ADDED_22_09 = {
  QS: [...CV_RD, ...CV_MAKE, 'bill.report.amend'], PM: [...CV_RD, 'bill.report.approve'], COMMGR: [...CV_RD, 'bill.report.approve', 'bill.report.export', 'bill.control_tower.export', 'bill.control_tower.margin'],
  PD: [...CV_RD, 'bill.report.approve', 'bill.report.export', 'bill.control_tower.export', 'bill.control_tower.margin'], DIR: [...CV_RD, 'bill.control_tower.margin', 'bill.control_tower.export'], CFO: [...CV_RD, 'bill.control_tower.margin'], AUD: [...CV_RD, 'bill.report.export'],
};
const ADDED_22_08 = {
  QS: ['bill.qs_dashboard.view', 'bill.qs_dashboard.export'], COMMGR: ['bill.qs_dashboard.view', 'bill.qs_dashboard.export', 'bill.qs_dashboard.margin'], PM: ['bill.qs_dashboard.view'],
  PD: ['bill.qs_dashboard.view', 'bill.qs_dashboard.export', 'bill.qs_dashboard.margin'], DIR: ['bill.qs_dashboard.view', 'bill.qs_dashboard.margin'],
};
const ADDED_22_07 = {
  QS: [...LG_RD, ...LG_MAKE, 'bill.advance.amend', 'bill.release.amend'], COMMGR: [...LG_RD, ...LG_MAKE, 'bill.advance.approve', 'bill.release.approve'],
  PM: [...LG_RD, 'bill.advance.approve', 'bill.release.approve', 'bill.retention.export'], CFO: [...LG_RD, 'bill.advance.approve', 'bill.release.approve', 'bill.retention.export'], DIR: [...LG_RD, 'bill.advance.approve'],
  PD: [...LG_RD, 'bill.retention.export', 'bill.advance.export', 'bill.release.export'], AUD: [...LG_RD, 'bill.retention.export', 'bill.advance.export', 'bill.release.export'], ACCMGR: [...LG_RD, 'bill.retention.export', 'bill.advance.export', 'bill.release.export'],
};
const VI_RD = ['bill.vendor_invoice.view', 'bill.vendor_invoice.print', 'bill.invoice_hub.view'];
const VI_MAKE = ['bill.vendor_invoice.create', 'bill.vendor_invoice.edit', 'bill.vendor_invoice.delete', 'bill.vendor_invoice.submit', 'bill.vendor_invoice.cancel', 'bill.vendor_invoice.export'];
const ADDED_22_06 = {
  FINEX: [...VI_RD, ...VI_MAKE], SACC: [...VI_RD, ...VI_MAKE],
  ACCMGR: [...VI_RD, 'bill.vendor_invoice.approve', 'bill.vendor_invoice.resolve', 'bill.vendor_invoice.export', 'bill.vendor_invoice.amend'],
  PROCMGR: [...VI_RD, 'bill.vendor_invoice.approve', 'bill.vendor_invoice.resolve', 'bill.vendor_invoice.export'], CFO: [...VI_RD, 'bill.vendor_invoice.approve', 'bill.vendor_invoice.export'],
  PD: [...VI_RD, 'bill.vendor_invoice.export'], AUD: [...VI_RD, 'bill.vendor_invoice.export'], DIR: VI_RD, COMMGR: ['bill.invoice_hub.view'], QS: ['bill.invoice_hub.view'], PM: ['bill.invoice_hub.view', 'bill.vendor_invoice.view'],
};
// part 23.03: finance processes the payables, the accounts manager approves (direct bills after the head of the department; debit notes), the CFO sees and approves above the limit, the auditor reads
const AP_RD = ['fin.bill.view', 'fin.bill.print', 'fin.debit_note.view', 'fin.debit_note.print'];
// part 24.03: the site accountant and the payroll team process labour wages (the site engineer prepares the muster and records the workers' acknowledgement on
// the phone); the project manager approves site wage runs, the HR manager approves them for compliance and verifies the contractors' wage sheets that the
// subcontractor coordinator, the site accountant or payroll compile; rates are seen by those who process or approve; the auditor and the director read
const WR_RD = ['pay.wage_run.view', 'pay.wage_run.print', 'pay.wage_run.export'];
const WR_PROC = [...WR_RD, 'pay.wage_run.create', 'pay.wage_run.edit', 'pay.wage_run.delete', 'pay.wage_run.submit', 'pay.wage_run.cancel', 'pay.wage_run.amend', 'pay.wage_run.disburse', 'pay.wage_rate.view', 'pay.wage_check.view', 'pay.wage_check.manage'];
// part 24.04: payroll prepares the statutory filings, challans and files and generates the registers; the accounts manager and the CFO approve the payment
// (PAY -> ACCMGR -> CFO); the HR manager generates the registers and the Form 16 batch; the CFO configures the statutory rules (confirmed against the notifications);
// the director and the auditor read
const ST_RD = ['pay.stat.calendar.view', 'pay.stat.filing.view', 'pay.stat.register.view', 'pay.stat.rule.view'];
const ADDED_24_04 = {
  PAY: [...ST_RD, 'pay.stat.filing.create', 'pay.stat.filing.edit', 'pay.stat.filing.delete', 'pay.stat.filing.submit', 'pay.stat.filing.cancel', 'pay.stat.filing.print', 'pay.stat.filing.export', 'pay.stat.register.generate', 'pay.stat.register.export', 'pay.stat.form16.generate', 'pay.stat.bocw.view', 'pay.stat.bocw.manage'],
  ACCMGR: [...ST_RD, 'pay.stat.filing.approve', 'pay.stat.filing.print', 'pay.stat.filing.export', 'pay.stat.bocw.view'],
  CFO: [...ST_RD, 'pay.stat.filing.approve', 'pay.stat.filing.print', 'pay.stat.filing.export', 'pay.stat.register.export', 'pay.stat.bocw.view', 'pay.stat.rule.configure'],
  HRMGR: [...ST_RD, 'pay.stat.register.generate', 'pay.stat.register.export', 'pay.stat.form16.generate'],
  DIR: [...ST_RD, 'pay.stat.bocw.view'], AUD: [...ST_RD, 'pay.stat.bocw.view'],
};
const ADDED_24_03 = {
  PAY: WR_PROC, SACC: [...WR_PROC, 'pay.wage_run.approve', 'pay.wage_run.acknowledge'], SE: ['pay.wage_run.view', 'pay.wage_run.create', 'pay.wage_run.edit', 'pay.wage_run.submit', 'pay.wage_run.acknowledge', 'pay.wage_run.print'],
  PM: [...WR_RD, 'pay.wage_run.approve', 'pay.wage_rate.view', 'pay.wage_check.view'], HRMGR: [...WR_RD, 'pay.wage_run.approve', 'pay.wage_rate.view', 'pay.wage_check.view', 'pay.wage_check.verify'],
  SUBCO: ['pay.wage_check.view', 'pay.wage_check.manage'], DIR: ['pay.wage_run.view', 'pay.wage_check.view'], AUD: ['pay.wage_run.view', 'pay.wage_check.view'],
};
// part 24.02: the payroll team runs payroll and enters inputs, verifies tax declarations; the HR manager and the CFO approve the run; every employee declares
// his own taxes; the auditor reads (salaries masked)
const ADDED_24_02 = {
  PAY: ['pay.run.view', 'pay.run.create', 'pay.run.edit', 'pay.run.delete', 'pay.run.submit', 'pay.run.cancel', 'pay.run.amend', 'pay.run.print', 'pay.run.export', 'pay.input.manage', 'pay.declaration.view', 'pay.declaration.verify', 'pay.declaration.own'],
  HRMGR: ['pay.run.view', 'pay.run.approve', 'pay.run.print', 'pay.run.export', 'pay.declaration.view', 'pay.declaration.own'], CFO: ['pay.run.view', 'pay.run.approve', 'pay.run.print', 'pay.run.export', 'pay.declaration.own'], DIR: ['pay.run.view'], AUD: ['pay.run.view'], EMP: ['pay.declaration.own'],
};
const PS_RD = ['pay.component.view', 'pay.structure.view', 'pay.assignment.view', 'pay.statutory.view', 'pay.calendar.view'];
// part 24.01: the payroll team configures components, structures, the calendar and statutory parameters and prepares pay assignments; the HR manager and the
// CFO approve revisions (the director for senior grades); the CFO approves statutory parameter changes; the auditor reads (salaries masked)
const ADDED_24_01 = {
  PAY: [...PS_RD, 'pay.component.configure', 'pay.structure.configure', 'pay.calendar.configure', 'pay.assignment.create', 'pay.assignment.edit', 'pay.assignment.delete', 'pay.assignment.submit', 'pay.assignment.cancel', 'pay.assignment.amend', 'pay.assignment.print', 'pay.assignment.export', 'pay.statutory.create', 'pay.statutory.edit', 'pay.statutory.delete', 'pay.statutory.submit', 'pay.statutory.cancel', 'pay.salary.view'],
  HRMGR: [...PS_RD, 'pay.assignment.approve', 'pay.assignment.print', 'pay.assignment.export', 'pay.salary.view'], CFO: [...PS_RD, 'pay.assignment.approve', 'pay.assignment.print', 'pay.assignment.export', 'pay.statutory.approve', 'pay.salary.view'],
  DIR: [...PS_RD, 'pay.assignment.approve', 'pay.salary.view'], AUD: [...PS_RD],
};
const IC_RD = ['fin.transaction.view', 'fin.transaction.print', 'fin.consolidation.view', 'fin.jv.view'];
// part 23.15: group finance — the accounts manager raises, approves (not his own) and accepts inter-company transactions, reverses them, runs the consolidation
// and keeps the JV shares; the CFO keeps the relationships and finalises the consolidation; the director and the auditor read
const ADDED_23_15 = {
  ACCMGR: [...IC_RD, 'fin.transaction.create', 'fin.transaction.edit', 'fin.transaction.delete', 'fin.transaction.submit', 'fin.transaction.approve', 'fin.transaction.cancel', 'fin.transaction.amend', 'fin.transaction.export', 'fin.consolidation.run', 'fin.jv.manage'],
  CFO: [...IC_RD, 'fin.transaction.approve', 'fin.transaction.export', 'fin.ic.configure', 'fin.consolidation.run', 'fin.consolidation.finalise', 'fin.jv.manage'], DIR: [...IC_RD], AUD: [...IC_RD, 'fin.transaction.export'],
};
const PC_RD = ['fin.period.view', 'fin.period.print', 'fin.period_reopen.view', 'fin.statements.view', 'fin.dashboard.view'];
// part 23.14: the accounts manager runs the close (the checklist, the locks, the reopen request); the CFO approves the close, the reopen and the year end and
// configures the checklist; the director reads and approves the reopen last; the task owners (accounts executive, payroll, stores) complete their own tasks;
// the auditor reads and exports
const ADDED_23_14 = {
  ACCMGR: [...PC_RD, 'fin.period.create', 'fin.period.edit', 'fin.period.delete', 'fin.period.submit', 'fin.period.approve', 'fin.period.cancel', 'fin.period.export', 'fin.close_task.complete', 'fin.period_reopen.create', 'fin.period_reopen.edit', 'fin.period_reopen.delete', 'fin.period_reopen.submit', 'fin.period_reopen.approve', 'fin.period_reopen.cancel', 'fin.statements.export'],
  CFO: [...PC_RD, 'fin.period.approve', 'fin.period.export', 'fin.period.configure', 'fin.period_reopen.approve', 'fin.statements.export'], DIR: [...PC_RD, 'fin.period_reopen.approve'],
  FINEX: ['fin.period.view', 'fin.close_task.complete'], PAY: ['fin.period.view', 'fin.close_task.complete'], SK: ['fin.period.view', 'fin.close_task.complete'], AUD: [...PC_RD, 'fin.period.export', 'fin.statements.export'],
};
const CF_RD = ['fin.cash_forecast.view', 'fin.cash_forecast.print', 'fin.cash_curve.view'];
// part 23.13: the accounts manager prepares the weekly cash forecast and keeps the facilities and the critical suppliers; the CFO publishes it and manages
// too; the project director and the PM see the cash curve of their projects; the director reads; the auditor reads
const ADDED_23_13 = {
  ACCMGR: [...CF_RD, 'fin.cash_forecast.create', 'fin.cash_forecast.edit', 'fin.cash_forecast.delete', 'fin.cash_forecast.submit', 'fin.cash_forecast.approve', 'fin.cash_forecast.cancel', 'fin.cash_forecast.export', 'fin.cash_forecast.manage'],
  CFO: [...CF_RD, 'fin.cash_forecast.approve', 'fin.cash_forecast.export', 'fin.cash_forecast.manage'], DIR: [...CF_RD], PD: ['fin.cash_curve.view'], PM: ['fin.cash_curve.view'], AUD: [...CF_RD, 'fin.cash_forecast.export'],
};
const PL_RD = ['fin.pl.view', 'fin.pl.view_overheads', 'fin.pl_snapshot.view', 'fin.pl_snapshot.print'];
// part 23.12: the accounts manager makes the monthly P&L snapshots and keeps the P&L structure; the CFO freezes them and configures; the project director and the
// director read with the corporate overhead; the PM reads the P&L of his projects without the corporate overhead (masked); the auditor reads
const ADDED_23_12 = {
  ACCMGR: [...PL_RD, 'fin.pl.configure', 'fin.pl_snapshot.create', 'fin.pl_snapshot.edit', 'fin.pl_snapshot.delete', 'fin.pl_snapshot.submit', 'fin.pl_snapshot.approve', 'fin.pl_snapshot.cancel', 'fin.pl_snapshot.amend', 'fin.pl_snapshot.export'],
  CFO: [...PL_RD, 'fin.pl.configure', 'fin.pl_snapshot.approve', 'fin.pl_snapshot.export'], PD: [...PL_RD, 'fin.pl_snapshot.export'], DIR: [...PL_RD], PM: ['fin.pl.view', 'fin.pl_snapshot.view'], AUD: [...PL_RD, 'fin.pl_snapshot.export'],
};
const FC_RD = ['fin.forecast.view', 'fin.forecast.print'];
const FC_PREP = ['fin.forecast.create', 'fin.forecast.edit', 'fin.forecast.delete', 'fin.forecast.submit', 'fin.forecast.cancel', 'fin.forecast.amend', 'fin.forecast.export'];
// part 23.11: the project controls manager, the QS and the PM prepare the monthly cost forecast; the project controls manager, the PM and the project director
// approve it in turn, the CFO too when the project is loss-making; the director and the accounts manager read; the auditor reads
const ADDED_23_11 = {
  PCMGR: [...FC_RD, ...FC_PREP, 'fin.forecast.approve'], QS: [...FC_RD, ...FC_PREP], PM: [...FC_RD, ...FC_PREP, 'fin.forecast.approve'], PD: [...FC_RD, 'fin.forecast.approve', 'fin.forecast.export'],
  CFO: [...FC_RD, 'fin.forecast.approve', 'fin.forecast.export'], DIR: [...FC_RD], ACCMGR: [...FC_RD], AUD: [...FC_RD, 'fin.forecast.export'],
};
const RR_RD = ['fin.revenue_recognition.view', 'fin.revenue_recognition.print', 'fin.project_ledger.view'];
// part 23.10: the accounts manager and the project controls manager prepare the monthly revenue recognition; the accounts manager approves one prepared by the
// project controls manager, the CFO approves it; the accounts manager posts the overhead pools; the project director and the PM read their projects; the auditor reads
const ADDED_23_10 = {
  ACCMGR: [...RR_RD, 'fin.revenue_recognition.create', 'fin.revenue_recognition.edit', 'fin.revenue_recognition.delete', 'fin.revenue_recognition.submit', 'fin.revenue_recognition.approve', 'fin.revenue_recognition.cancel', 'fin.revenue_recognition.amend', 'fin.revenue_recognition.export', 'fin.project_ledger.export', 'fin.overhead.post'],
  PCMGR: [...RR_RD, 'fin.revenue_recognition.create', 'fin.revenue_recognition.edit', 'fin.revenue_recognition.delete', 'fin.revenue_recognition.submit', 'fin.revenue_recognition.cancel', 'fin.revenue_recognition.amend', 'fin.revenue_recognition.export', 'fin.project_ledger.export'],
  CFO: [...RR_RD, 'fin.revenue_recognition.approve', 'fin.revenue_recognition.export', 'fin.project_ledger.export'],
  DIR: [...RR_RD], PD: [...RR_RD], PM: ['fin.revenue_recognition.view', 'fin.project_ledger.view'],
  AUD: [...RR_RD, 'fin.revenue_recognition.export', 'fin.project_ledger.export'],
};
const FA_RD = ['fin.asset.view', 'fin.asset.print', 'fin.disposal.view', 'fin.disposal.print', 'fin.depreciation.view'];
// part 23.09: the accounts manager keeps the register (capitalises, runs depreciation, transfers, proposes disposals); the finance executive prepares capitalisations; the CFO approves capitalisations and disposals, a director disposals above ₹10 lakh; the project and construction managers and the store manager verify the assets of their projects; the auditor reads
const ADDED_23_09 = {
  ACCMGR: [...FA_RD, 'fin.asset.create', 'fin.asset.edit', 'fin.asset.delete', 'fin.asset.submit', 'fin.asset.approve', 'fin.asset.cancel', 'fin.asset.amend', 'fin.asset.export', 'fin.asset.transfer', 'fin.asset.verify', 'fin.disposal.create', 'fin.disposal.edit', 'fin.disposal.delete', 'fin.disposal.submit', 'fin.disposal.approve', 'fin.disposal.cancel', 'fin.disposal.export', 'fin.depreciation.run'],
  FINEX: [...FA_RD, 'fin.asset.create', 'fin.asset.edit', 'fin.asset.delete', 'fin.asset.submit', 'fin.asset.cancel'],
  CFO: [...FA_RD, 'fin.asset.approve', 'fin.asset.export', 'fin.disposal.approve', 'fin.disposal.export'],
  DIR: [...FA_RD, 'fin.disposal.approve'],
  PM: ['fin.asset.view', 'fin.asset.verify'], CM: ['fin.asset.view', 'fin.asset.verify'], STOREMGR: ['fin.asset.view', 'fin.asset.verify'], PLANTMGR: ['fin.asset.view', 'fin.depreciation.view'],
  AUD: [...FA_RD, 'fin.asset.export', 'fin.disposal.export'],
};
const RECON_RD = ['fin.gst_recon.view', 'fin.itc_review.view', 'fin.itc_review.print', 'fin.gst_return.view', 'fin.tds_return.view'];
// part 23.08: the accounts manager reconciles GSTR-2B, follows vendors up, prepares the ITC review, the returns and the TDS statements; the CFO approves the monthly ITC claim; the auditor reads
const ADDED_23_08 = {
  ACCMGR: [...RECON_RD, 'fin.gst_recon.import', 'fin.gst_recon.manage', 'fin.gst_recon.export', 'fin.itc_review.create', 'fin.itc_review.edit', 'fin.itc_review.delete', 'fin.itc_review.submit', 'fin.itc_review.approve', 'fin.itc_review.cancel', 'fin.itc_review.amend', 'fin.itc_review.export', 'fin.gst_return.prepare', 'fin.gst_return.file', 'fin.gst_return.export', 'fin.tds_return.prepare', 'fin.tds_return.file', 'fin.tds_return.export', 'fin.tds_return.certificate'],
  CFO: [...RECON_RD, 'fin.gst_recon.export', 'fin.itc_review.approve', 'fin.itc_review.export', 'fin.gst_return.export', 'fin.tds_return.export'],
  FINEX: ['fin.gst_recon.view', 'fin.gst_return.view', 'fin.tds_return.view'],
  AUD: [...RECON_RD, 'fin.gst_recon.export', 'fin.itc_review.export', 'fin.gst_return.export'],
};
const GST_RD = ['fin.gst_setting.view', 'fin.einvoice.view', 'fin.einvoice.print', 'fin.ewaybill.view', 'fin.ewaybill.print'];
// part 23.07: the accounts manager manages the GST service (settings proposed, e-invoices and e-way bills generated and cancelled); the system generates IRNs by itself; the finance executive retries what failed; the CFO approves the settings; the store manager makes the e-way bill of a transfer; the auditor reads
const ADDED_23_07 = {
  ACCMGR: [...GST_RD, 'fin.gst.resolve', 'fin.gstin.check', 'fin.gst_setting.create', 'fin.gst_setting.edit', 'fin.gst_setting.delete', 'fin.gst_setting.submit', 'fin.gst_setting.cancel', 'fin.gst_setting.export', 'fin.einvoice.generate', 'fin.einvoice.retry', 'fin.einvoice.cancel', 'fin.einvoice.export', 'fin.ewaybill.generate', 'fin.ewaybill.update', 'fin.ewaybill.extend', 'fin.ewaybill.cancel', 'fin.ewaybill.retry', 'fin.ewaybill.export'],
  FINEX: [...GST_RD, 'fin.gst.resolve', 'fin.gstin.check', 'fin.einvoice.retry', 'fin.ewaybill.retry'],
  CFO: [...GST_RD, 'fin.gst.resolve', 'fin.gst_setting.approve', 'fin.gst_setting.export', 'fin.einvoice.export', 'fin.ewaybill.export'],
  STOREMGR: ['fin.ewaybill.view', 'fin.ewaybill.print', 'fin.ewaybill.generate', 'fin.ewaybill.update', 'fin.ewaybill.extend'],
  AUD: [...GST_RD, 'fin.einvoice.export', 'fin.ewaybill.export', 'fin.gst_setting.export'],
};
const IV_OWN = ['fin.imprest_voucher.view', 'fin.imprest_voucher.create', 'fin.imprest_voucher.edit', 'fin.imprest_voucher.delete', 'fin.imprest_voucher.submit', 'fin.imprest_voucher.cancel', 'fin.imprest_voucher.print', 'fin.imprest_replenishment.view', 'fin.imprest_replenishment.create', 'fin.imprest_replenishment.submit', 'fin.imprest_replenishment.cancel', 'fin.imprest_replenishment.print', 'fin.imprest.view', 'fin.imprest.count'];
const CASH_RD = ['fin.imprest_voucher.view', 'fin.imprest_replenishment.view', 'fin.imprest.view', 'fin.bank_statement.view', 'fin.brs.view', 'fin.contra.view', 'fin.cash_position.view'];
// part 23.06: the site accountant and the finance executive keep imprests and enter statements and contras; the construction manager approves vouchers above ₹10,000; the project manager then the accounts manager approve replenishments; the accounts manager matches, signs the reconciliation, approves contras and keeps imprests; the CFO and the auditor read
const ADDED_23_06 = {
  SACC: [...IV_OWN],
  FINEX: [...IV_OWN, ...CASH_RD, 'fin.bank_statement.import', 'fin.bank_statement.match', 'fin.contra.create', 'fin.contra.edit', 'fin.contra.delete', 'fin.contra.submit', 'fin.contra.cancel', 'fin.contra.print', 'fin.imprest_voucher.export'],
  CM: ['fin.imprest_voucher.view', 'fin.imprest_voucher.approve', 'fin.imprest.view'],
  PM: ['fin.imprest_voucher.view', 'fin.imprest_replenishment.view', 'fin.imprest_replenishment.approve', 'fin.imprest.view'],
  ACCMGR: [...CASH_RD, 'fin.imprest_voucher.approve', 'fin.imprest_voucher.export', 'fin.imprest_replenishment.approve', 'fin.imprest_replenishment.export', 'fin.bank_statement.import', 'fin.bank_statement.match', 'fin.brs.sign', 'fin.imprest.manage', 'fin.imprest.count', 'fin.contra.approve', 'fin.contra.cancel', 'fin.contra.print'],
  CFO: [...CASH_RD, 'fin.imprest_voucher.export'],
  AUD: [...CASH_RD, 'fin.imprest_voucher.export', 'fin.imprest_replenishment.export'],
};
const AR_RD = ['fin.invoice.view', 'fin.invoice.print', 'fin.receipt.view', 'fin.receipt.print', 'fin.credit_note.view', 'fin.credit_note.print', 'fin.writeoff.view', 'fin.followup.view'];
// part 23.05: the finance executive enters receipts and other income and proposes credit notes and write-offs; the accounts manager approves other income, credit notes (the CFO above ₹5 lakh) and write-offs (with the CFO and a director); the commercial manager and the project manager follow collections up on their projects
const ADDED_23_05 = {
  FINEX: [...AR_RD, 'fin.invoice.create', 'fin.invoice.edit', 'fin.invoice.delete', 'fin.invoice.submit', 'fin.invoice.cancel', 'fin.invoice.export', 'fin.receipt.create', 'fin.receipt.edit', 'fin.receipt.delete', 'fin.receipt.submit', 'fin.receipt.export', 'fin.credit_note.create', 'fin.credit_note.delete', 'fin.credit_note.submit', 'fin.credit_note.cancel', 'fin.writeoff.create', 'fin.writeoff.submit', 'fin.writeoff.cancel', 'fin.followup.create'],
  ACCMGR: [...AR_RD, 'fin.invoice.approve', 'fin.invoice.cancel', 'fin.invoice.export', 'fin.receipt.approve', 'fin.receipt.cancel', 'fin.receipt.export', 'fin.credit_note.approve', 'fin.credit_note.cancel', 'fin.writeoff.approve', 'fin.followup.create'],
  CFO: [...AR_RD, 'fin.invoice.export', 'fin.receipt.export', 'fin.credit_note.approve', 'fin.writeoff.approve'],
  DIR: [...AR_RD, 'fin.writeoff.approve'],
  COMMGR: ['fin.invoice.view', 'fin.invoice.print', 'fin.receipt.view', 'fin.followup.view', 'fin.followup.create'],
  PM: ['fin.invoice.view', 'fin.invoice.print', 'fin.followup.view', 'fin.followup.create'],
  AUD: [...AR_RD, 'fin.invoice.export', 'fin.receipt.export'],
};
const PM_RD = ['fin.proposal.view', 'fin.proposal.print', 'fin.payment.view', 'fin.payment.print', 'fin.bank.view'];
// part 23.04: the finance executive prepares and enters the bank's confirmation; the accounts manager, the CFO and a director approve by band; the accounts manager or the CFO releases (never the preparer or an approver of the same proposal); the CFO keeps the bank accounts
const ADDED_23_04 = {
  FINEX: [...PM_RD, 'fin.proposal.create', 'fin.proposal.edit', 'fin.proposal.delete', 'fin.proposal.submit', 'fin.proposal.cancel', 'fin.proposal.export', 'fin.payment.confirm', 'fin.payment.export'],
  ACCMGR: [...PM_RD, 'fin.proposal.approve', 'fin.proposal.cancel', 'fin.proposal.export', 'fin.payment.release', 'fin.payment.confirm', 'fin.payment.export'],
  CFO: [...PM_RD, 'fin.proposal.approve', 'fin.proposal.export', 'fin.payment.release', 'fin.payment.export', 'fin.bank.manage'],
  DIR: [...PM_RD, 'fin.proposal.approve'],
  AUD: [...PM_RD, 'fin.proposal.export', 'fin.payment.export'],
};
const ADDED_23_03 = {
  FINEX: [...AP_RD, 'fin.bill.create', 'fin.bill.edit', 'fin.bill.delete', 'fin.bill.submit', 'fin.bill.cancel', 'fin.bill.export', 'fin.bill.hold', 'fin.debit_note.create', 'fin.debit_note.edit', 'fin.debit_note.delete', 'fin.debit_note.submit', 'fin.debit_note.cancel', 'fin.debit_note.export'],
  ACCMGR: [...AP_RD, 'fin.bill.approve', 'fin.bill.cancel', 'fin.bill.export', 'fin.bill.hold', 'fin.debit_note.approve', 'fin.debit_note.cancel', 'fin.debit_note.export'],
  CFO: [...AP_RD, 'fin.bill.approve', 'fin.bill.export', 'fin.debit_note.export'],
  AUD: [...AP_RD, 'fin.bill.export', 'fin.debit_note.export'],
  DIR: AP_RD,
};
// part 23.02: the accounts manager keeps the posting rules (the CFO approves), works the failed postings and replays history with IT administration (accounts manager, then CFO approve the commit)
const PE_RULE = ['fin.posting_rule.view', 'fin.posting_rule.edit', 'fin.posting_rule.delete', 'fin.posting_rule.submit', 'fin.posting_rule.cancel'];
const PE_REPLAY = ['fin.replay.view', 'fin.replay.create', 'fin.replay.edit', 'fin.replay.delete', 'fin.replay.submit', 'fin.replay.cancel'];
const ADDED_23_02 = {
  ACCMGR: [...PE_RULE, 'fin.posting.view', 'fin.posting.repost', 'fin.posting.resolve', ...PE_REPLAY, 'fin.replay.approve'],
  CFO: ['fin.posting_rule.view', 'fin.posting_rule.approve', 'fin.posting.view', 'fin.replay.view', 'fin.replay.approve'],
  ITADM: ['fin.posting_rule.view', 'fin.posting.view', 'fin.posting.repost', ...PE_REPLAY],
  FINEX: ['fin.posting_rule.view', 'fin.posting.view'],
  AUD: ['fin.posting_rule.view', 'fin.posting.view', 'fin.replay.view'],
};
// part 23.01: finance prepares journals; the accounts manager and the CFO approve and post them (SoD-03: never their own); the auditor reads
const JN_RD = ['fin.journal.view', 'fin.journal.print', 'fin.ledger.view'];
const ADDED_23_01 = {
  FINEX: [...JN_RD, 'fin.journal.create', 'fin.journal.edit', 'fin.journal.delete', 'fin.journal.submit', 'fin.journal.cancel', 'fin.journal.amend', 'fin.journal.export', 'fin.recurring.manage'],
  ACCMGR: [...JN_RD, 'fin.journal.approve', 'fin.journal.cancel', 'fin.journal.export', 'fin.recurring.manage'],
  CFO: [...JN_RD, 'fin.journal.approve', 'fin.journal.export'],
  AUD: [...JN_RD, 'fin.journal.export'],
  DIR: JN_RD,
};
const SB_RD = ['bill.sub_bill.view', 'bill.sub_bill.print', 'bill.sub_measure.view'];
const ADDED_22_05 = {
  SE: [...SB_RD, 'bill.sub_measure.create', 'bill.sub_measure.sign', 'bill.sub_measure.cancel', 'bill.sub_bill.approve'],
  SUBCO: [...SB_RD, 'bill.sub_measure.create', 'bill.sub_measure.sign', 'bill.sub_measure.cancel'],
  QS: [...SB_RD, 'bill.sub_measure.create', 'bill.sub_measure.verify', 'bill.sub_measure.cancel', 'bill.sub_measure.export', 'bill.sub_bill.create', 'bill.sub_bill.edit', 'bill.sub_bill.delete', 'bill.sub_bill.submit', 'bill.sub_bill.cancel', 'bill.sub_bill.amend', 'bill.sub_bill.approve', 'bill.sub_bill.export'],
  PM: [...SB_RD, 'bill.sub_bill.approve', 'bill.sub_bill.export', 'bill.sub_measure.export'], COMMGR: [...SB_RD, 'bill.sub_bill.approve', 'bill.sub_bill.export'], CFO: [...SB_RD, 'bill.sub_bill.approve', 'bill.sub_bill.export'],
  PD: [...SB_RD, 'bill.sub_bill.export'], AUD: [...SB_RD, 'bill.sub_bill.export', 'bill.sub_measure.export'], ACCMGR: [...SB_RD, 'bill.sub_bill.export'], DIR: SB_RD,
};
const CE_RD = ['bill.certification.view', 'bill.certification.print', 'bill.tax_invoice.view', 'bill.tax_invoice.print'];
const ADDED_22_04 = {
  QS: [...CE_RD, 'bill.certification.create', 'bill.certification.edit', 'bill.certification.delete', 'bill.certification.submit', 'bill.certification.cancel', 'bill.certification.amend', 'bill.certification.approve', 'bill.certification.export', 'bill.tax_invoice.create', 'bill.tax_invoice.edit', 'bill.tax_invoice.delete', 'bill.tax_invoice.submit', 'bill.tax_invoice.cancel', 'bill.tax_invoice.amend', 'bill.tax_invoice.export'],
  ACCMGR: [...CE_RD, 'bill.tax_invoice.approve', 'bill.tax_invoice.cancel', 'bill.tax_invoice.irn', 'bill.tax_invoice.export', 'bill.certification.export'],
  COMMGR: [...CE_RD, 'bill.certification.approve', 'bill.certification.export', 'bill.tax_invoice.export'], PM: [...CE_RD, 'bill.certification.export'],
  PD: [...CE_RD, 'bill.certification.export', 'bill.tax_invoice.export'], AUD: [...CE_RD, 'bill.certification.export', 'bill.tax_invoice.export'], DIR: CE_RD, CFO: [...CE_RD, 'bill.tax_invoice.export'],
};
const CB_RD = ['bill.client_bill.view', 'bill.client_bill.print'];
const ADDED_22_03 = {
  QS: [...CB_RD, 'bill.client_bill.create', 'bill.client_bill.edit', 'bill.client_bill.delete', 'bill.client_bill.submit', 'bill.client_bill.cancel', 'bill.client_bill.amend', 'bill.client_bill.approve', 'bill.client_bill.export', 'bill.client_bill.send'],
  PM: [...CB_RD, 'bill.client_bill.approve', 'bill.client_bill.export'], COMMGR: [...CB_RD, 'bill.client_bill.approve', 'bill.client_bill.export', 'bill.client_bill.send'],
  PD: [...CB_RD, 'bill.client_bill.export'], AUD: [...CB_RD, 'bill.client_bill.export'], ACCMGR: [...CB_RD, 'bill.client_bill.export'], DIR: CB_RD, CFO: CB_RD,
};
const DS_RD = ['bill.deviation_statement.view', 'bill.deviation_statement.print', 'bill.extra_item.view', 'bill.qty_recon.view'];
const ADDED_22_02 = {
  SE: ['bill.qty_recon.view'],
  QS: [...DS_RD, 'bill.deviation_statement.create', 'bill.deviation_statement.edit', 'bill.deviation_statement.delete', 'bill.deviation_statement.submit', 'bill.deviation_statement.cancel', 'bill.deviation_statement.amend', 'bill.deviation_statement.export', 'bill.deviation_statement.client', 'bill.extra_item.create', 'bill.extra_item.edit', 'bill.extra_item.delete', 'bill.extra_item.export', 'bill.qty_recon.forecast', 'bill.qty_recon.export'],
  COMMGR: [...DS_RD, 'bill.deviation_statement.approve', 'bill.deviation_statement.export', 'bill.deviation_statement.client', 'bill.extra_item.decide', 'bill.extra_item.export', 'bill.qty_recon.export'],
  PM: [...DS_RD, 'bill.deviation_statement.approve', 'bill.deviation_statement.export', 'bill.extra_item.decide', 'bill.extra_item.export', 'bill.qty_recon.forecast', 'bill.qty_recon.export'],
  PD: [...DS_RD, 'bill.deviation_statement.export', 'bill.extra_item.export', 'bill.qty_recon.export'], AUD: [...DS_RD, 'bill.deviation_statement.export', 'bill.extra_item.export', 'bill.qty_recon.export'], ACCMGR: DS_RD, DIR: DS_RD,
};
const MB_RD = ['bill.mb_entry.view', 'bill.mb_entry.print'];
const MB_MAKE = ['bill.mb_entry.create', 'bill.mb_entry.edit', 'bill.mb_entry.delete', 'bill.mb_entry.submit', 'bill.mb_entry.cancel'];
const ADDED_22_01 = {
  SE: [...MB_RD, ...MB_MAKE], QS: [...MB_RD, ...MB_MAKE, 'bill.mb_entry.approve', 'bill.mb_entry.check', 'bill.mb_entry.amend', 'bill.mb_entry.export'], 'X-CON': [...MB_RD, 'bill.mb_entry.check'],
  PM: [...MB_RD, 'bill.mb_entry.approve', 'bill.mb_entry.export'], PD: [...MB_RD, 'bill.mb_entry.export'], COMMGR: [...MB_RD, 'bill.mb_entry.export'], ACCMGR: MB_RD, AUD: [...MB_RD, 'bill.mb_entry.export'], DIR: MB_RD,
};

// Part 21.07: price variation and liquidated damages. The quantity surveyor and the commercial manager keep the formulas and the indices and compute the escalation; they and the project director approve it; the commercial manager assesses the liquidated damages and records what the client deducts. The two index rights belong to the shared index master (15.06).
const PV_RD = ['ctr.pvc.view', 'ctr.escalation.view', 'ctr.escalation.print', 'ctr.ld.view'];
const ADDED_21_07 = {
  QS: [...PV_RD, 'ctr.pvc.edit', 'ctr.escalation.create', 'ctr.escalation.edit', 'ctr.escalation.delete', 'ctr.escalation.submit', 'ctr.escalation.approve', 'ctr.escalation.cancel', 'proc.rate_contract.index'],
  COMMGR: [...PV_RD, 'ctr.pvc.edit', 'ctr.escalation.create', 'ctr.escalation.edit', 'ctr.escalation.delete', 'ctr.escalation.submit', 'ctr.escalation.approve', 'ctr.escalation.cancel', 'ctr.escalation.export', 'ctr.ld.assess', 'ctr.ld.record', 'proc.rate_contract.index'],
  PD: [...PV_RD, 'ctr.escalation.approve', 'ctr.escalation.export'], DIR: PV_RD, PM: PV_RD, ACCMGR: [...PV_RD, 'ctr.escalation.export'], CFO: [...PV_RD, 'ctr.escalation.export'], AUD: [...PV_RD, 'ctr.escalation.export'],
};

// Part 21.06: claims and disputes. The commercial manager, the planning engineer and the quantity surveyor prepare claims (events, notice, quantum, evidence); the commercial manager records the submissions and the determination; the project director and the director approve a submission and the referral of a dispute.
const CL_RD = ['ctr.claim.view', 'ctr.claim.print', 'ctr.dispute.view', 'ctr.dispute.print'];
const ADDED_21_06 = {
  COMMGR: [...CL_RD, 'ctr.claim.create', 'ctr.claim.edit', 'ctr.claim.delete', 'ctr.claim.submit', 'ctr.claim.approve', 'ctr.claim.cancel', 'ctr.claim.export', 'ctr.claim.respond', 'ctr.dispute.create', 'ctr.dispute.edit', 'ctr.dispute.delete', 'ctr.dispute.submit', 'ctr.dispute.approve', 'ctr.dispute.cancel', 'ctr.dispute.export', 'ctr.dispute.log'],
  PLAN: [...CL_RD, 'ctr.claim.create', 'ctr.claim.edit', 'ctr.claim.delete', 'ctr.claim.submit', 'ctr.claim.cancel'], QS: [...CL_RD, 'ctr.claim.create', 'ctr.claim.edit', 'ctr.claim.delete', 'ctr.claim.submit', 'ctr.claim.cancel'],
  PD: [...CL_RD, 'ctr.claim.approve', 'ctr.claim.export', 'ctr.dispute.approve', 'ctr.dispute.export'], DIR: [...CL_RD, 'ctr.claim.approve', 'ctr.claim.export', 'ctr.dispute.approve', 'ctr.dispute.export'], PM: CL_RD,
  ACCMGR: CL_RD, CFO: [...CL_RD, 'ctr.claim.export', 'ctr.dispute.export'], AUD: [...CL_RD, 'ctr.claim.export', 'ctr.dispute.export'],
};

// Part 21.05: change and variation management. The project manager raises a change request and gives the technical review; the quantity surveyor evaluates it and approves first; the commercial manager records the client's answer and approves next; the project director and the director approve by value.
const VR_RD = ['ctr.change.view', 'ctr.change.print', 'ctr.variation.view', 'ctr.variation.print'];
const ADDED_21_05 = {
  PM: [...VR_RD, 'ctr.change.create', 'ctr.change.edit', 'ctr.change.delete', 'ctr.change.submit', 'ctr.change.cancel', 'ctr.change.review'],
  QS: [...VR_RD, 'ctr.change.create', 'ctr.change.edit', 'ctr.change.delete', 'ctr.change.submit', 'ctr.change.approve', 'ctr.change.cancel', 'ctr.change.evaluate', 'ctr.change.export'],
  COMMGR: [...VR_RD, 'ctr.change.create', 'ctr.change.edit', 'ctr.change.delete', 'ctr.change.submit', 'ctr.change.approve', 'ctr.change.cancel', 'ctr.change.evaluate', 'ctr.change.respond', 'ctr.change.export', 'ctr.variation.edit', 'ctr.variation.submit', 'ctr.variation.approve', 'ctr.variation.cancel', 'ctr.variation.export'],
  PD: [...VR_RD, 'ctr.change.approve', 'ctr.change.review', 'ctr.change.export', 'ctr.variation.approve', 'ctr.variation.export'], DIR: [...VR_RD, 'ctr.change.approve', 'ctr.change.export', 'ctr.variation.approve', 'ctr.variation.export'],
  ACCMGR: VR_RD, CFO: [...VR_RD, 'ctr.change.export', 'ctr.variation.export'], AUD: [...VR_RD, 'ctr.change.export', 'ctr.variation.export'],
};

// Part 21.04: the subcontractor workspace. The subcontractor coordinator compiles the monthly compliance and keeps the committed manpower; the commercial manager and the HR manager verify it; a waiver of the payment hold is approved by the commercial manager and the project director.
const SW_RD = ['ctr.sub_workspace.view', 'ctr.sub_compliance.view', 'ctr.sub_waiver.view'];
const ADDED_21_04 = {
  SUBCO: [...SW_RD, 'ctr.sub_compliance.compile', 'ctr.sub_waiver.create', 'ctr.sub_waiver.edit', 'ctr.sub_waiver.delete', 'ctr.sub_waiver.submit', 'ctr.sub_waiver.cancel', 'ctr.sub_manpower.manage'],
  COMMGR: [...SW_RD, 'ctr.sub_compliance.compile', 'ctr.sub_compliance.verify', 'ctr.sub_compliance.export', 'ctr.sub_waiver.create', 'ctr.sub_waiver.edit', 'ctr.sub_waiver.delete', 'ctr.sub_waiver.submit', 'ctr.sub_waiver.approve', 'ctr.sub_waiver.cancel', 'ctr.sub_manpower.manage', 'ctr.sub_rating.run'],
  HRMGR: [...SW_RD, 'ctr.sub_compliance.verify', 'ctr.sub_compliance.export'], PM: SW_RD, PD: [...SW_RD, 'ctr.sub_waiver.approve', 'ctr.sub_compliance.export'], DIR: SW_RD, ACCMGR: SW_RD, CFO: SW_RD, AUD: [...SW_RD, 'ctr.sub_compliance.export'], QS: ['ctr.sub_workspace.view'],
};

// Part 21.03: subcontract work orders. The commercial manager and the quantity surveyor prepare them; the commercial manager approves first, the project director above Rs 10 lakh and the director above Rs 50 lakh or for a negative margin; the subcontractor coordinator records the acceptance.
const WO_RD = ['ctr.work_order.view', 'ctr.work_order.print'];
const ADDED_21_03 = {
  COMMGR: ['ctr.work_order.view', 'ctr.work_order.create', 'ctr.work_order.edit', 'ctr.work_order.delete', 'ctr.work_order.submit', 'ctr.work_order.approve', 'ctr.work_order.cancel', 'ctr.work_order.amend', 'ctr.work_order.print', 'ctr.work_order.export', 'ctr.work_order.accept', 'ctr.work_order.close', 'ctr.work_order.margin'],
  QS: ['ctr.work_order.view', 'ctr.work_order.create', 'ctr.work_order.edit', 'ctr.work_order.delete', 'ctr.work_order.submit', 'ctr.work_order.cancel', 'ctr.work_order.amend', 'ctr.work_order.print', 'ctr.work_order.margin'],
  PD: [...WO_RD, 'ctr.work_order.approve', 'ctr.work_order.export', 'ctr.work_order.margin'], DIR: [...WO_RD, 'ctr.work_order.approve', 'ctr.work_order.export', 'ctr.work_order.margin'], PM: [...WO_RD, 'ctr.work_order.margin'],
  SUBCO: [...WO_RD, 'ctr.work_order.accept'], ACCMGR: [...WO_RD, 'ctr.work_order.margin'], CFO: [...WO_RD, 'ctr.work_order.export', 'ctr.work_order.margin'], AUD: [...WO_RD, 'ctr.work_order.export', 'ctr.work_order.margin'],
};

// Part 21.02: securities. The commercial manager records guarantees and policies and asks the bank; accounts approve them, confirm the requests and keep the bank limits; the CFO approves a guarantee given and confirms requests; project people and the auditor read.
const SC_RD = ['ctr.bank_guarantee.view', 'ctr.bank_guarantee.print', 'ctr.insurance.view', 'ctr.insurance.print'];
const ADDED_21_02 = {
  COMMGR: ['ctr.bank_guarantee.view', 'ctr.bank_guarantee.create', 'ctr.bank_guarantee.edit', 'ctr.bank_guarantee.delete', 'ctr.bank_guarantee.submit', 'ctr.bank_guarantee.cancel', 'ctr.bank_guarantee.print', 'ctr.bank_guarantee.export', 'ctr.bank_guarantee.request', 'ctr.insurance.view', 'ctr.insurance.create', 'ctr.insurance.edit', 'ctr.insurance.delete', 'ctr.insurance.submit', 'ctr.insurance.cancel', 'ctr.insurance.print', 'ctr.insurance.export', 'ctr.insurance.claim'],
  ACCMGR: [...SC_RD, 'ctr.bank_guarantee.create', 'ctr.bank_guarantee.edit', 'ctr.bank_guarantee.delete', 'ctr.bank_guarantee.submit', 'ctr.bank_guarantee.approve', 'ctr.bank_guarantee.cancel', 'ctr.bank_guarantee.amend', 'ctr.bank_guarantee.export', 'ctr.bank_guarantee.request', 'ctr.bank_guarantee.confirm', 'ctr.insurance.create', 'ctr.insurance.edit', 'ctr.insurance.delete', 'ctr.insurance.submit', 'ctr.insurance.approve', 'ctr.insurance.cancel', 'ctr.insurance.amend', 'ctr.insurance.export', 'ctr.insurance.claim', 'ctr.bank_limit.manage'],
  CFO: [...SC_RD, 'ctr.bank_guarantee.approve', 'ctr.bank_guarantee.confirm', 'ctr.bank_guarantee.export', 'ctr.insurance.export', 'ctr.bank_limit.manage'],
  PM: SC_RD, PD: [...SC_RD, 'ctr.bank_guarantee.export'], DIR: [...SC_RD, 'ctr.bank_guarantee.export'], AUD: [...SC_RD, 'ctr.bank_guarantee.export', 'ctr.insurance.export'], QS: ['ctr.bank_guarantee.view', 'ctr.insurance.view'],
};

// Part 21.01: client contracts. The commercial manager keeps the register (contracts, clauses, obligations, milestones, amendments) and approves first; the project director and the director approve after; the project manager and the project director see the contract and keep its obligations; the QS, accounts and the CFO read it for billing; values are shown only with ctr.contract.value.
const CT_RD = ['ctr.contract.view', 'ctr.contract.print', 'ctr.obligation.view', 'ctr.amendment.view'];
const ADDED_21_01 = {
  COMMGR: ['ctr.contract.view', 'ctr.contract.create', 'ctr.contract.edit', 'ctr.contract.delete', 'ctr.contract.submit', 'ctr.contract.approve', 'ctr.contract.cancel', 'ctr.contract.amend', 'ctr.contract.print', 'ctr.contract.export', 'ctr.contract.value', 'ctr.amendment.view', 'ctr.amendment.create', 'ctr.amendment.edit', 'ctr.amendment.delete', 'ctr.amendment.submit', 'ctr.amendment.approve', 'ctr.amendment.cancel', 'ctr.amendment.amend', 'ctr.amendment.print', 'ctr.amendment.export', 'ctr.clause.manage', 'ctr.obligation.view', 'ctr.obligation.manage', 'ctr.obligation.complete', 'ctr.milestone.manage', 'ctr.milestone.achieve'],
  PD: [...CT_RD, 'ctr.contract.approve', 'ctr.contract.export', 'ctr.contract.value', 'ctr.amendment.approve', 'ctr.amendment.print', 'ctr.obligation.manage', 'ctr.obligation.complete'],
  DIR: [...CT_RD, 'ctr.contract.approve', 'ctr.contract.export', 'ctr.contract.value', 'ctr.amendment.approve', 'ctr.amendment.print', 'ctr.amendment.export'],
  PM: [...CT_RD, 'ctr.contract.value', 'ctr.obligation.manage', 'ctr.obligation.complete', 'ctr.milestone.achieve'],
  QS: [...CT_RD, 'ctr.contract.value', 'ctr.obligation.complete'], CM: ['ctr.contract.view', 'ctr.obligation.view', 'ctr.obligation.complete'],
  CFO: [...CT_RD, 'ctr.contract.value', 'ctr.contract.export'], ACCMGR: [...CT_RD, 'ctr.contract.value'], AUD: [...CT_RD, 'ctr.contract.value', 'ctr.contract.export', 'ctr.amendment.print', 'ctr.amendment.export'],
};

// Part 20.03: plant costing. Costs and rates are seen only by the plant in-charge, accounts, the CFO and the director (and the auditor); accounts propose transfer rates, the plant in-charge and the CFO approve them, accounts close the month and the CFO reopens it.
const ADDED_20_03 = {
  PLANTMGR: ['rmc.cost.view', 'rmc.cost.collect', 'rmc.cost.input', 'rmc.cost.export', 'rmc.transfer_rate.view', 'rmc.transfer_rate.approve', 'rmc.transfer_rate.print', 'rmc.transfer_rate.export', 'rmc.budget.view', 'rmc.budget.edit'],
  ACCMGR: ['rmc.cost.view', 'rmc.cost.collect', 'rmc.cost.input', 'rmc.cost.close', 'rmc.cost.export', 'rmc.transfer_rate.view', 'rmc.transfer_rate.create', 'rmc.transfer_rate.edit', 'rmc.transfer_rate.delete', 'rmc.transfer_rate.submit', 'rmc.transfer_rate.cancel', 'rmc.transfer_rate.amend', 'rmc.transfer_rate.print', 'rmc.transfer_rate.export', 'rmc.budget.view', 'rmc.budget.edit'],
  CFO: ['rmc.cost.view', 'rmc.cost.close', 'rmc.cost.reopen', 'rmc.cost.export', 'rmc.transfer_rate.view', 'rmc.transfer_rate.approve', 'rmc.transfer_rate.print', 'rmc.transfer_rate.export', 'rmc.budget.view'],
  DIR: ['rmc.cost.view', 'rmc.transfer_rate.view', 'rmc.budget.view'], AUD: ['rmc.cost.view', 'rmc.cost.export', 'rmc.transfer_rate.view', 'rmc.transfer_rate.print', 'rmc.budget.view'],
};

// Part 20.02: production and dispatch. The site engineer asks for concrete and receives the trucks; the construction manager approves the requisition; the plant in-charge schedules it and approves the delivery tickets; the plant supervisor records batches and makes the tickets; others read.
const PR_RD = ['rmc.requisition.view', 'rmc.requisition.print', 'rmc.delivery_ticket.view', 'rmc.delivery_ticket.print', 'rmc.batch.view', 'rmc.consumption.view'];
const ADDED_20_02 = {
  SE: ['rmc.requisition.view', 'rmc.requisition.create', 'rmc.requisition.edit', 'rmc.requisition.delete', 'rmc.requisition.submit', 'rmc.requisition.cancel', 'rmc.requisition.print', 'rmc.delivery_ticket.view', 'rmc.delivery_ticket.create', 'rmc.delivery_ticket.receive', 'rmc.delivery_ticket.print', 'rmc.batch.view'],
  CM: ['rmc.requisition.view', 'rmc.requisition.approve', 'rmc.requisition.print', 'rmc.requisition.export', 'rmc.delivery_ticket.view', 'rmc.delivery_ticket.print', 'rmc.batch.view', 'rmc.consumption.view'],
  PLANTMGR: [...PR_RD, 'rmc.requisition.schedule', 'rmc.requisition.cancel', 'rmc.requisition.amend', 'rmc.requisition.export', 'rmc.delivery_ticket.approve', 'rmc.delivery_ticket.cancel', 'rmc.delivery_ticket.amend', 'rmc.delivery_ticket.export', 'rmc.batch.cancel', 'rmc.consumption.export'],
  PMSUP: [...PR_RD, 'rmc.delivery_ticket.create', 'rmc.delivery_ticket.edit', 'rmc.delivery_ticket.delete', 'rmc.delivery_ticket.submit', 'rmc.delivery_ticket.cancel', 'rmc.batch.record', 'rmc.batch.import'],
  QCE: PR_RD, QCMGR: [...PR_RD, 'rmc.consumption.export'], PM: [...PR_RD, 'rmc.requisition.export', 'rmc.delivery_ticket.export', 'rmc.consumption.export'], PD: [...PR_RD, 'rmc.requisition.export', 'rmc.delivery_ticket.export', 'rmc.consumption.export'], DIR: PR_RD, AUD: [...PR_RD, 'rmc.requisition.export', 'rmc.delivery_ticket.export', 'rmc.consumption.export'], ACCMGR: ['rmc.consumption.view', 'rmc.delivery_ticket.view'],
};

// Part 20.01: batching plants and mix designs. The plant in-charge (PLANTMGR) manages plants and prepares mix designs; the plant quality engineer and the quality control manager approve mix designs; the project manager approves a plant (and a move to another project, site or cost centre); the plant supervisor keeps silos and scales; others read.
const RM_PL = ['rmc.plant.view', 'rmc.plant.print'], RM_MX = ['rmc.mix_design.view', 'rmc.mix_design.print'];
const ADDED_20_01 = {
  PLANTMGR: ['rmc.plant.view', 'rmc.plant.create', 'rmc.plant.edit', 'rmc.plant.delete', 'rmc.plant.submit', 'rmc.plant.cancel', 'rmc.plant.amend', 'rmc.plant.print', 'rmc.plant.export', 'rmc.mix_design.view', 'rmc.mix_design.create', 'rmc.mix_design.edit', 'rmc.mix_design.delete', 'rmc.mix_design.submit', 'rmc.mix_design.cancel', 'rmc.mix_design.amend', 'rmc.mix_design.print', 'rmc.mix_design.export', 'rmc.silo.edit', 'rmc.scale.edit'],
  PMSUP: [...RM_PL, ...RM_MX, 'rmc.silo.edit', 'rmc.scale.edit'], PM: [...RM_PL, ...RM_MX, 'rmc.plant.approve', 'rmc.plant.export', 'rmc.mix_design.export'], QCE: [...RM_PL, ...RM_MX, 'rmc.mix_design.approve'], QCMGR: [...RM_PL, ...RM_MX, 'rmc.mix_design.approve', 'rmc.mix_design.export'],
  CM: [...RM_PL, ...RM_MX], SE: [...RM_PL, ...RM_MX], PD: [...RM_PL, ...RM_MX, 'rmc.plant.export', 'rmc.mix_design.export'], DIR: [...RM_PL, ...RM_MX], AUD: [...RM_PL, ...RM_MX, 'rmc.plant.export', 'rmc.mix_design.export'], ACCMGR: RM_PL, CFO: RM_PL,
};

// Part 19.08: the HSE dashboard. The HSE head, the project manager, the project director and the director see it (and export it); the HSE head and the project manager make the monthly report; the HSE engineer sees the sites assigned; the auditor reads.
const ADDED_19_08 = {
  HSEO: ['hse.dashboard.view', 'hse.dashboard.export', 'hse.dashboard.report'], PM: ['hse.dashboard.view', 'hse.dashboard.export', 'hse.dashboard.report'], PD: ['hse.dashboard.view', 'hse.dashboard.export'], DIR: ['hse.dashboard.view', 'hse.dashboard.export'], HSEE: ['hse.dashboard.view'], AUD: ['hse.dashboard.view'],
};

const ADDED_19_07 = {
  HRMGR: [...CP_RUN, 'hse.camp.create', 'hse.camp.edit', 'hse.recovery.approve', 'hse.recovery.amend', 'hse.recovery.export'], WSUP: CP_RUN, SUBCO: [...CP_VIEW, 'hse.recovery.view'],
  HSEE: [...CP_VIEW, 'hse.camp.muster', 'hse.camp_inspection.record', 'hse.recovery.view'], HSEO: [...CP_VIEW, 'hse.camp.muster', 'hse.camp_inspection.record', 'hse.recovery.view'],
  PM: [...CP_VIEW, 'hse.camp.muster', 'hse.recovery.view', 'hse.recovery.approve', 'hse.recovery.print', 'hse.recovery.export', 'hse.allocation.export'], PD: CP_VIEW, DIR: [...CP_VIEW, 'hse.recovery.view', 'hse.recovery.export'], AUD: [...CP_VIEW, 'hse.recovery.view', 'hse.recovery.export', 'hse.allocation.export'], CM: CP_VIEW, SECSUP: ['hse.camp.view', 'hse.camp.muster'], SECMGR: ['hse.camp.view', 'hse.camp.muster'],
};

// Part 19.06: security. The security manager owns posts, approves rosters and closes incidents; the supervisor makes rosters, runs the gate and patrols; the guard registers visitors, scans patrols and logs handovers; every staff member can pre-register a visitor they host.
const SC_GUARD = ['hse.security_post.view', 'hse.visitor.view', 'hse.visitor.create', 'hse.visitor.checkin', 'hse.patrol.view', 'hse.patrol.scan', 'hse.handover.view', 'hse.handover.create', 'hse.security_incident.view', 'hse.security_incident.create', 'hse.roster.view'];
const SC_HOST = ['hse.visitor.view', 'hse.visitor.create', 'hse.visitor.cancel'];
const ADDED_19_06 = {
  GUARD: SC_GUARD,
  SECSUP: [...SC_GUARD, 'hse.security_post.edit', 'hse.roster.create', 'hse.roster.edit', 'hse.roster.delete', 'hse.roster.submit', 'hse.roster.cancel', 'hse.roster.print', 'hse.security_incident.edit', 'hse.security_incident.delete', 'hse.security_incident.submit', 'hse.security_incident.cancel', 'hse.security_incident.print', 'hse.visitor.cancel', 'hse.visitor.export', 'hse.visitor.print'],
  SECMGR: [...SC_GUARD, 'hse.security_post.create', 'hse.security_post.edit', 'hse.roster.create', 'hse.roster.edit', 'hse.roster.delete', 'hse.roster.submit', 'hse.roster.approve', 'hse.roster.cancel', 'hse.roster.amend', 'hse.roster.print', 'hse.roster.export', 'hse.security_incident.edit', 'hse.security_incident.delete', 'hse.security_incident.submit', 'hse.security_incident.approve', 'hse.security_incident.cancel', 'hse.security_incident.amend', 'hse.security_incident.print', 'hse.security_incident.export', 'hse.visitor.approve', 'hse.visitor.cancel', 'hse.visitor.export', 'hse.visitor.print'],
  SE: SC_HOST, CSUP: SC_HOST, WSUP: SC_HOST, PMSUP: SC_HOST, QCE: SC_HOST, QCMGR: SC_HOST, STOREMGR: SC_HOST, PLANTMGR: SC_HOST, SK: ['hse.visitor.view'], HSEE: [...SC_HOST, 'hse.security_incident.view', 'hse.patrol.view'], HSEO: [...SC_HOST, 'hse.security_incident.view', 'hse.patrol.view', 'hse.security_post.view', 'hse.roster.view', 'hse.handover.view'],
  CM: [...SC_HOST, 'hse.security_incident.view', 'hse.patrol.view'], PM: [...SC_HOST, 'hse.security_post.view', 'hse.security_incident.view', 'hse.security_incident.print', 'hse.security_incident.export', 'hse.patrol.view', 'hse.roster.view', 'hse.visitor.export', 'hse.handover.view'], PD: ['hse.security_incident.view', 'hse.patrol.view'], DIR: ['hse.security_incident.view', 'hse.security_incident.export', 'hse.patrol.view', 'hse.visitor.view'], AUD: ['hse.security_incident.view', 'hse.security_incident.export', 'hse.patrol.view', 'hse.visitor.view', 'hse.visitor.export', 'hse.roster.view', 'hse.security_post.view'],
};

// Part 19.05: environment and ESG. The HSE engineer enters the data and keeps the emission factors; the HSE officer activates them (maker-checker); the project manager, director and auditor read the reports.
const ADDED_19_05 = {
  HSEE: ['hse.esg.view', 'hse.esg.record', 'hse.esg.export', 'hse.esg.configure_factors'], HSEO: ['hse.esg.view', 'hse.esg.record', 'hse.esg.export', 'hse.esg.approve', 'hse.esg.configure_factors'],
  PM: ['hse.esg.view', 'hse.esg.export'], PD: ['hse.esg.view'], DIR: ['hse.esg.view', 'hse.esg.export'], AUD: ['hse.esg.view', 'hse.esg.export'], CM: ['hse.esg.view'], SE: ['hse.esg.view'],
};

// Part 19.04: observations, PPE, safety equipment, inspection schedules and contractor safety. All staff raise observations; the HSE team manages; the store keeper issues PPE; the HSE engineer and the project manager approve a penalty.
const OB_STAFF = ['hse.observation.view', 'hse.observation.create', 'hse.observation.print', 'hse.observation.act', 'hse.ppe.view', 'hse.equipment.view'];
const OB_HSE = [...OB_STAFF, 'hse.observation.edit', 'hse.observation.delete', 'hse.observation.cancel', 'hse.observation.close', 'hse.observation.export', 'hse.ppe.give', 'hse.ppe.return', 'hse.ppe.export', 'hse.ppe_item.view', 'hse.equipment.create', 'hse.equipment.edit', 'hse.equipment.delete', 'hse.schedule.view', 'hse.schedule.create', 'hse.schedule.edit', 'hse.schedule.record', 'hse.contractor_score.view', 'hse.contractor_score.export'];
const ADDED_19_04 = {
  SE: [...OB_STAFF, 'hse.schedule.view'], CSUP: OB_STAFF, WSUP: OB_STAFF, PMSUP: OB_STAFF, SECSUP: OB_STAFF, SECMGR: OB_STAFF, QCE: OB_STAFF, QCMGR: OB_STAFF, STOREMGR: OB_STAFF, PLANTMGR: OB_STAFF,
  SK: [...OB_STAFF, 'hse.ppe.give', 'hse.ppe.return', 'hse.ppe_item.view'],
  HSEE: [...OB_HSE, 'hse.observation.approve'], HSEO: [...OB_HSE, 'hse.observation.approve', 'hse.observation.submit', 'hse.observation.penalty', 'hse.observation.amend', 'hse.ppe_item.create', 'hse.ppe_item.edit', 'hse.schedule.delete'],
  CM: [...OB_STAFF, 'hse.observation.close', 'hse.schedule.view', 'hse.contractor_score.view'], PM: [...OB_STAFF, 'hse.observation.approve', 'hse.observation.export', 'hse.schedule.view', 'hse.contractor_score.view', 'hse.contractor_score.export'],
  PD: ['hse.observation.view', 'hse.observation.print', 'hse.contractor_score.view'], DIR: ['hse.observation.view', 'hse.observation.print', 'hse.observation.export', 'hse.contractor_score.view', 'hse.contractor_score.export'], AUD: ['hse.observation.view', 'hse.observation.print', 'hse.observation.export', 'hse.ppe.view', 'hse.equipment.view', 'hse.schedule.view', 'hse.contractor_score.view', 'hse.contractor_score.export'],
};

// Part 19.03: incidents. Anyone on site reports (create and view); the HSE engineer classifies and investigates; the project manager and the director approve the closure; the HSE officer publishes the lessons.
const IN_REPORT = ['hse.incident.view', 'hse.incident.create', 'hse.incident.print', 'hse.lesson.view'];
const ADDED_19_03 = {
  SE: IN_REPORT, CSUP: IN_REPORT, WSUP: IN_REPORT, PMSUP: IN_REPORT, SECSUP: IN_REPORT, SECMGR: IN_REPORT, QCE: IN_REPORT, SK: IN_REPORT, QCMGR: IN_REPORT, STOREMGR: ['hse.lesson.view'], PLANTMGR: ['hse.lesson.view'],
  HSEE: [...IN_REPORT, 'hse.incident.edit', 'hse.incident.delete', 'hse.incident.submit', 'hse.incident.approve', 'hse.incident.cancel', 'hse.incident.amend', 'hse.incident.export', 'hse.incident.investigate', 'hse.incident.publish'],
  HSEO: [...IN_REPORT, 'hse.incident.edit', 'hse.incident.delete', 'hse.incident.submit', 'hse.incident.approve', 'hse.incident.cancel', 'hse.incident.amend', 'hse.incident.export', 'hse.incident.investigate', 'hse.incident.publish'],
  CM: [...IN_REPORT, 'hse.incident.export'], PM: [...IN_REPORT, 'hse.incident.approve', 'hse.incident.export'], PD: IN_REPORT, DIR: [...IN_REPORT, 'hse.incident.approve', 'hse.incident.export'], AUD: [...IN_REPORT, 'hse.incident.export'],
};

// Part 19.02: permits to work. The site engineer and the supervisors request; the HSE engineer issues (the 'approve' right) and records the gas tests and isolations; the construction manager also authorises a high-risk permit; the HSE officer keeps the permit types.
const PT_VIEW = ['hse.permit.view', 'hse.permit.print'];
const ADDED_19_02 = {
  SE: [...PT_VIEW, 'hse.permit.create', 'hse.permit.edit', 'hse.permit.delete', 'hse.permit.submit', 'hse.permit.cancel', 'hse.permit.record', 'hse.permit.close'],
  CSUP: [...PT_VIEW, 'hse.permit.create', 'hse.permit.edit', 'hse.permit.submit', 'hse.permit.record', 'hse.permit.close'], PMSUP: [...PT_VIEW, 'hse.permit.create', 'hse.permit.edit', 'hse.permit.submit', 'hse.permit.record', 'hse.permit.close'], WSUP: [...PT_VIEW, 'hse.permit.create', 'hse.permit.edit', 'hse.permit.submit', 'hse.permit.record'],
  HSEE: [...PT_VIEW, 'hse.permit.approve', 'hse.permit.cancel', 'hse.permit.record', 'hse.permit.extend', 'hse.permit.suspend', 'hse.permit.close', 'hse.permit.activate', 'hse.permit.amend', 'hse.permit.export', 'hse.permit.create', 'hse.permit.edit', 'hse.permit.submit', 'hse.permit_type.view'],
  HSEO: [...PT_VIEW, 'hse.permit.approve', 'hse.permit.cancel', 'hse.permit.record', 'hse.permit.extend', 'hse.permit.suspend', 'hse.permit.close', 'hse.permit.activate', 'hse.permit.amend', 'hse.permit.export', 'hse.permit.approve_high', 'hse.permit_type.view', 'hse.permit_type.create', 'hse.permit_type.edit', 'hse.permit_type.delete'],
  CM: [...PT_VIEW, 'hse.permit.approve', 'hse.permit.approve_high', 'hse.permit.extend', 'hse.permit.suspend', 'hse.permit.close', 'hse.permit.amend', 'hse.permit.export', 'hse.permit.cancel'],
  PM: [...PT_VIEW, 'hse.permit.export'], PD: PT_VIEW, DIR: [...PT_VIEW, 'hse.permit.export'], AUD: [...PT_VIEW, 'hse.permit.export'], SECSUP: ['hse.permit.view'], SECMGR: ['hse.permit.view'],
};

// Part 19.01: HSE plans, HIRA, JSA, inductions and toolbox talks. The HSE engineer makes and runs them; the HSE officer (the HSE head) owns the library and approves with the project manager; the supervisors run toolbox talks and acknowledge the JSA.
const HSE_ENG = ['hse.plan.view', 'hse.plan.create', 'hse.plan.edit', 'hse.plan.delete', 'hse.plan.submit', 'hse.plan.cancel', 'hse.plan.amend', 'hse.plan.print', 'hse.hira.view', 'hse.hira.create', 'hse.hira.edit', 'hse.hira.delete', 'hse.hira.submit', 'hse.hira.cancel', 'hse.hira.amend', 'hse.hira.print', 'hse.jsa.view', 'hse.jsa.create', 'hse.jsa.edit', 'hse.jsa.delete', 'hse.jsa.release', 'hse.jsa.sign', 'hse.jsa.cancel', 'hse.jsa.print', 'hse.induction.view', 'hse.induction.create', 'hse.induction.cancel', 'hse.induction_content.view', 'hse.toolbox_talk.view', 'hse.toolbox_talk.create', 'hse.toolbox_talk.edit', 'hse.toolbox_talk.delete', 'hse.toolbox_talk.submit', 'hse.toolbox_talk.cancel', 'hse.toolbox_talk.print', 'hse.toolbox_topic.view', 'hse.medical.view', 'hse.medical.record'];
const HSE_READ = ['hse.plan.view', 'hse.plan.print', 'hse.hira.view', 'hse.hira.print', 'hse.jsa.view', 'hse.jsa.print', 'hse.induction.view', 'hse.toolbox_talk.view', 'hse.toolbox_talk.print'];
const ADDED_19_01 = {
  HSEE: HSE_ENG,
  HSEO: [...HSE_ENG, 'hse.plan.approve', 'hse.plan.export', 'hse.hira.approve', 'hse.hira.export', 'hse.jsa.export', 'hse.induction.export', 'hse.induction_content.create', 'hse.induction_content.edit', 'hse.induction_content.delete', 'hse.toolbox_talk.export', 'hse.toolbox_topic.create', 'hse.toolbox_topic.edit', 'hse.toolbox_topic.delete'],
  PM: [...HSE_READ, 'hse.plan.approve', 'hse.plan.export', 'hse.hira.approve', 'hse.hira.export', 'hse.jsa.export', 'hse.induction.export', 'hse.toolbox_talk.export'],
  PD: HSE_READ, DIR: [...HSE_READ, 'hse.plan.export', 'hse.hira.export', 'hse.jsa.export', 'hse.induction.export', 'hse.toolbox_talk.export'], AUD: [...HSE_READ, 'hse.plan.export', 'hse.hira.export', 'hse.jsa.export', 'hse.induction.export', 'hse.toolbox_talk.export'],
  CM: [...HSE_READ, 'hse.jsa.create', 'hse.jsa.edit', 'hse.jsa.sign', 'hse.toolbox_talk.create', 'hse.toolbox_talk.edit', 'hse.toolbox_talk.submit'],
  SE: [...HSE_READ, 'hse.jsa.create', 'hse.jsa.edit', 'hse.jsa.delete', 'hse.jsa.sign', 'hse.toolbox_talk.create', 'hse.toolbox_talk.edit', 'hse.toolbox_talk.submit'], PMSUP: [...HSE_READ, 'hse.jsa.sign', 'hse.toolbox_talk.create', 'hse.toolbox_talk.edit', 'hse.toolbox_talk.submit'],
  CSUP: [...HSE_READ, 'hse.jsa.sign', 'hse.toolbox_talk.create', 'hse.toolbox_talk.edit', 'hse.toolbox_talk.submit'], WSUP: [...HSE_READ, 'hse.jsa.sign', 'hse.toolbox_talk.create', 'hse.toolbox_talk.edit', 'hse.toolbox_talk.submit'],
  SECMGR: ['hse.induction.view', 'hse.induction.create'], SECSUP: ['hse.induction.view', 'hse.induction.create'],
};
const SN_VIEW = ['qa.snag.view', 'qa.snag.print'];
// Part 18.06: snags. The quality engineer, the site engineer and the client or consultant raise; the responsible crews and subcontractors rectify (the 'submit' right); the quality engineer and the quality control manager verify, close and reopen (the 'approve' right).
const ADDED_18_06 = {
  QCE: [...SN_VIEW, 'qa.snag.create', 'qa.snag.edit', 'qa.snag.delete', 'qa.snag.cancel', 'qa.snag.approve', 'qa.snag.export'], QCMGR: [...SN_VIEW, 'qa.snag.create', 'qa.snag.edit', 'qa.snag.delete', 'qa.snag.cancel', 'qa.snag.approve', 'qa.snag.export'],
  SE: [...SN_VIEW, 'qa.snag.create', 'qa.snag.edit', 'qa.snag.submit'], CM: [...SN_VIEW, 'qa.snag.create', 'qa.snag.edit', 'qa.snag.submit', 'qa.snag.export'], PMSUP: [...SN_VIEW, 'qa.snag.submit'],
  PM: [...SN_VIEW, 'qa.snag.export'], PD: SN_VIEW, DIR: [...SN_VIEW, 'qa.snag.export'], AUD: [...SN_VIEW, 'qa.snag.export'],
};
const PC_VIEW = ['qa.pour_card.view', 'qa.pour_card.print'];
// Part 18.05: concrete pour cards and cubes. The site engineer makes the card and records the pour and the cubes; the quality engineer approves first, records and tests; the construction manager approves second; the quality control manager approves and tests; project roles read.
const ADDED_18_05 = {
  SE: [...PC_VIEW, 'qa.pour_card.create', 'qa.pour_card.edit', 'qa.pour_card.delete', 'qa.pour_card.submit', 'qa.pour_card.cancel', 'qa.pour_card.record'],
  QCE: [...PC_VIEW, 'qa.pour_card.create', 'qa.pour_card.edit', 'qa.pour_card.delete', 'qa.pour_card.submit', 'qa.pour_card.cancel', 'qa.pour_card.approve', 'qa.pour_card.amend', 'qa.pour_card.export', 'qa.pour_card.record', 'qa.cube.test'],
  QCMGR: [...PC_VIEW, 'qa.pour_card.approve', 'qa.pour_card.amend', 'qa.pour_card.export', 'qa.cube.test'], CM: [...PC_VIEW, 'qa.pour_card.approve', 'qa.pour_card.export'],
  PM: [...PC_VIEW, 'qa.pour_card.export'], PD: PC_VIEW, DIR: [...PC_VIEW, 'qa.pour_card.export'], AUD: [...PC_VIEW, 'qa.pour_card.export'],
};
const NCR_VIEW = ['qa.ncr.view', 'qa.ncr.print'];
// Part 18.04: NCRs and CAPA. The quality engineer raises, edits, asks for closure and for a concession and verifies by re-inspection; the responsible crews and managers record the rectification and complete their actions; the quality control manager, project director and consultant approve closures and concessions by severity; costs are seen by those who decide on them.
const ADDED_18_04 = {
  QCE: [...NCR_VIEW, 'qa.ncr.create', 'qa.ncr.edit', 'qa.ncr.delete', 'qa.ncr.submit', 'qa.ncr.cancel', 'qa.ncr.approve', 'qa.ncr.export', 'qa.ncr.costs'],
  QCMGR: [...NCR_VIEW, 'qa.ncr.create', 'qa.ncr.edit', 'qa.ncr.delete', 'qa.ncr.submit', 'qa.ncr.cancel', 'qa.ncr.approve', 'qa.ncr.export', 'qa.ncr.costs'],
  PD: [...NCR_VIEW, 'qa.ncr.approve', 'qa.ncr.costs'], 'X-CON': [...NCR_VIEW, 'qa.ncr.approve'],
  SE: [...NCR_VIEW, 'qa.ncr.rectify'], CM: [...NCR_VIEW, 'qa.ncr.rectify', 'qa.ncr.export'], PM: [...NCR_VIEW, 'qa.ncr.export', 'qa.ncr.costs'], DIR: [...NCR_VIEW, 'qa.ncr.export', 'qa.ncr.costs'], AUD: [...NCR_VIEW, 'qa.ncr.export', 'qa.ncr.costs'], ACCMGR: [...NCR_VIEW, 'qa.ncr.costs'], PROCMGR: NCR_VIEW, STOREMGR: NCR_VIEW, HSEE: NCR_VIEW,
};
const TR_VIEW = ['qa.test_request.view', 'qa.test_request.print', 'qa.test_catalogue.view', 'qa.lab_equipment.view'];
const TR_MAKE = ['qa.test_request.create', 'qa.test_request.edit', 'qa.test_request.delete', 'qa.test_request.submit', 'qa.test_request.cancel'];
// Part 18.03: material tests, the test catalogue and laboratory equipment. The quality engineer (lab technician) requests, enters results and verifies another engineer's tests and keeps the equipment calibrated; the quality control manager owns the catalogue and approves failed results accepted by concession; the quality control manager and quality engineer release stock through the receipt inspection of 16.03; stores read the release status.
const ADDED_18_03 = {
  QCE: [...TR_VIEW, ...TR_MAKE, 'qa.test_request.approve', 'qa.test_request.export', 'qa.lab_equipment.create', 'qa.lab_equipment.edit', 'qa.lab_equipment.calibrate', 'qa.lab_equipment.export'],
  QCMGR: [...TR_VIEW, ...TR_MAKE, 'qa.test_request.approve', 'qa.test_request.export', 'qa.test_catalogue.create', 'qa.test_catalogue.edit', 'qa.test_catalogue.delete', 'qa.test_catalogue.export', 'qa.lab_equipment.create', 'qa.lab_equipment.edit', 'qa.lab_equipment.delete', 'qa.lab_equipment.calibrate', 'qa.lab_equipment.export', 'inv.grn.view', 'inv.grn.inspect'],
  SK: ['qa.test_request.view'], STOREMGR: ['qa.test_request.view', 'qa.test_request.print'], PROCMGR: ['qa.test_request.view', 'qa.test_request.print'],
  CM: TR_VIEW, PM: [...TR_VIEW, 'qa.test_request.export'], PD: TR_VIEW, DIR: [...TR_VIEW, 'qa.test_request.export'], AUD: [...TR_VIEW, 'qa.test_request.export', 'qa.lab_equipment.export'],
};
const IR_VIEW = ['view', 'print'].map((a) => `qa.inspection_request.${a}`);
const IR_MAKE = ['view', 'create', 'edit', 'delete', 'submit', 'cancel', 'print'].map((a) => `qa.inspection_request.${a}`);
// Part 18.02: inspection requests. The site engineer raises; the quality engineer inspects and decides; the consultant also decides when the request needs one; the quality control manager decides and exports; project roles read.
const ADDED_18_02 = {
  SE: IR_MAKE, QCE: [...IR_MAKE, 'qa.inspection_request.approve', 'qa.inspection_request.export'], QCMGR: [...IR_MAKE, 'qa.inspection_request.approve', 'qa.inspection_request.export'],
  'X-CON': [...IR_VIEW, 'qa.inspection_request.approve'], CM: [...IR_MAKE, 'qa.inspection_request.export'], PM: [...IR_VIEW, 'qa.inspection_request.export'], PD: IR_VIEW, DIR: [...IR_VIEW, 'qa.inspection_request.export'], AUD: [...IR_VIEW, 'qa.inspection_request.export'],
};
const ADDED_18_01 = {
  QCMGR: [...QA_VIEW, ...['quality_plan', 'itp', 'template'].flatMap((r) => qaAct(r, [...QA_MAKE, 'approve', 'amend', 'export'])), ...qaAct('inspection', ['approve', 'amend', 'export', 'create', 'edit', 'delete', 'submit', 'cancel']), 'qa.itp.apply'],
  QCE: [...QA_VIEW, ...qaAct('quality_plan', [...QA_MAKE, 'amend']), ...qaAct('itp', [...QA_MAKE, 'amend']), ...qaAct('template', [...QA_MAKE, 'amend']), ...qaAct('inspection', QA_MAKE), ...qaAct('inspection', ['amend', 'export']), 'qa.itp.apply'],
  HSEE: [...QA_VIEW, ...qaAct('template', QA_MAKE), ...qaAct('inspection', QA_MAKE)], HSEO: [...QA_VIEW, ...qaAct('template', ['approve']), ...qaAct('inspection', ['approve', 'export'])],
  PMSUP: [...QA_VIEW, ...qaAct('template', QA_MAKE), ...qaAct('inspection', QA_MAKE)], PLANTMGR: [...QA_VIEW, ...qaAct('template', ['approve']), ...qaAct('inspection', ['approve', 'export'])],
  SK: [...QA_VIEW, ...qaAct('inspection', QA_MAKE)], STOREMGR: [...QA_VIEW, ...qaAct('template', ['approve']), ...qaAct('inspection', ['approve', 'export'])],
  SE: [...QA_VIEW, ...qaAct('inspection', ['create', 'edit', 'submit', 'cancel', 'delete'])], CM: [...QA_VIEW, ...qaAct('inspection', ['export'])],
  PM: [...QA_VIEW, ...qaAct('inspection', ['export'])], PD: QA_VIEW, DIR: [...QA_VIEW, ...qaAct('inspection', ['export'])], AUD: [...QA_VIEW, ...qaAct('inspection', ['export']), ...qaAct('itp', ['export'])],
};
const ADDED_17_08 = {
  PCMGR: [...RP_READ, ...RP_MAKE, 'plant.capacity.refresh', 'plant.capacity.export', 'plant.resource_plan.approve', 'plant.resource_plan.export'], HRMGR: [...RP_READ, ...RP_MAKE, 'plant.capacity.export'], PLANTMGR: [...RP_READ, ...RP_MAKE, 'plant.capacity.refresh', 'plant.capacity.export', 'plant.resource_plan.export'],
  PD: [...RP_READ, 'plant.resource_plan.approve'], DIR: [...RP_READ, 'plant.resource_plan.approve', 'plant.resource_plan.export', 'plant.capacity.export'], PM: ['plant.capacity.view', 'plant.resource_plan.view'], AUD: [...RP_READ, 'plant.capacity.export'],
};
const FL_READ = ['plant.fleet.view', 'plant.fleet.costs', 'plant.disposal_rec.view', 'plant.disposal_rec.print'];
// Part 17.07: the control tower. The plant manager enters cost items, takes the monthly snapshots, loads telematics and approves a disposal recommendation first; the project manager raises it; the CFO and the director approve it after the plant manager.
const ADDED_17_07 = {
  PLANTMGR: [...FL_READ, 'plant.fleet.cost_entry', 'plant.fleet.snapshot', 'plant.fleet.export', 'plant.telematics.view', 'plant.telematics.ingest', 'plant.disposal_rec.approve', 'plant.disposal_rec.export'],
  PM: [...FL_READ, 'plant.fleet.export', 'plant.telematics.view', 'plant.disposal_rec.create', 'plant.disposal_rec.edit', 'plant.disposal_rec.delete', 'plant.disposal_rec.submit', 'plant.disposal_rec.cancel'],
  CFO: [...FL_READ, 'plant.fleet.export', 'plant.disposal_rec.approve', 'plant.disposal_rec.export', 'plant.log.report', 'plant.maint.report'], DIR: [...FL_READ, 'plant.fleet.export', 'plant.disposal_rec.approve', 'plant.disposal_rec.export', 'plant.log.report', 'plant.maint.report'],
  ACCMGR: [...FL_READ, 'plant.fleet.cost_entry', 'plant.fleet.snapshot', 'plant.fleet.export'], AUD: [...FL_READ, 'plant.fleet.export', 'plant.telematics.view'], PMSUP: ['plant.fleet.view', 'plant.telematics.view'],
};
const HA_READ = ['plant.hire_agreement.view', 'plant.hire_agreement.print', 'plant.hire_bill.view', 'plant.hire_bill.print'];
// Part 17.06: hire. The plant manager and the procurement manager make hire agreements; the plant manager (another one) approves a costly hire-in and makes the hire bills; the plant supervisor and the project manager certify the bills; accounts and audit read the bills with their rates.
const ADDED_17_06 = {
  PLANTMGR: [...HA_READ, 'plant.hire_agreement.create', 'plant.hire_agreement.edit', 'plant.hire_agreement.delete', 'plant.hire_agreement.submit', 'plant.hire_agreement.approve', 'plant.hire_agreement.cancel', 'plant.hire_agreement.amend', 'plant.hire_agreement.export', 'plant.hire_bill.create', 'plant.hire_bill.edit', 'plant.hire_bill.delete', 'plant.hire_bill.submit', 'plant.hire_bill.cancel', 'plant.hire_bill.amend', 'plant.hire_bill.export', 'plant.hire.rates', 'plant.hire.report'],
  PROCMGR: [...HA_READ, 'plant.hire_agreement.create', 'plant.hire_agreement.edit', 'plant.hire_agreement.delete', 'plant.hire_agreement.submit', 'plant.hire_agreement.cancel', 'plant.hire_agreement.export', 'plant.hire.rates', 'plant.hire.report'],
  PMSUP: [...HA_READ, 'plant.hire_agreement.approve', 'plant.hire_bill.approve'], PM: [...HA_READ, 'plant.hire_agreement.approve', 'plant.hire_bill.approve', 'plant.hire.rates', 'plant.hire.report'],
  ACCMGR: [...HA_READ, 'plant.hire_agreement.export', 'plant.hire_bill.export', 'plant.hire.rates', 'plant.hire.report'], AUD: [...HA_READ, 'plant.hire_agreement.export', 'plant.hire_bill.export', 'plant.hire.rates', 'plant.hire.report'],
};
const JC_READ = ['plant.job_card.view', 'plant.job_card.print', 'plant.pm.view'];
// Part 17.05: maintenance. The plant supervisor raises and approves job cards (another supervisor approves), runs the work and asks for spares; the store keeper reserves and issues the spares; the plant manager sets up the plans, approves a costly external
// repair, amends, claims warranty and reads the costs; the project manager, accounts and audit read the figures.
const ADDED_17_05 = {
  PMSUP: [...JC_READ, 'plant.job_card.create', 'plant.job_card.edit', 'plant.job_card.delete', 'plant.job_card.submit', 'plant.job_card.approve', 'plant.job_card.cancel', 'plant.job_card.work', 'plant.job_card.spares', 'plant.job_card.warranty', 'plant.job_card.import', 'plant.maint.report'],
  SK: ['plant.job_card.view', 'plant.job_card.spares', 'plant.job_card.draw'],
  PLANTMGR: [...JC_READ, 'plant.job_card.approve', 'plant.job_card.amend', 'plant.job_card.cancel', 'plant.job_card.export', 'plant.job_card.spares', 'plant.job_card.warranty', 'plant.pm.manage', 'plant.maint.report', 'plant.maint.costs'],
  PM: [...JC_READ, 'plant.job_card.export', 'plant.maint.report', 'plant.maint.costs'], ACCMGR: [...JC_READ, 'plant.job_card.export', 'plant.maint.report', 'plant.maint.costs'], AUD: [...JC_READ, 'plant.job_card.export', 'plant.maint.report', 'plant.maint.costs'],
};
const FUEL_READ = ['plant.issue.view', 'plant.issue.print'];
// Part 17.04: fuel. The storekeeper (fuel attendant) enters issues, receipts and dips; the plant supervisor verifies issues (another person than the one who entered) and explains anomalies; the plant manager sets up tanks, cancels receipts,
// exports and confirms losses; the project manager accepts an explained anomaly and reads; accounts and audit read the figures with their costs.
const ADDED_17_04 = {
  SK: [...FUEL_READ, 'plant.issue.create', 'plant.issue.edit', 'plant.issue.delete', 'plant.issue.submit', 'plant.issue.import', 'plant.fuel.receive', 'plant.fuel.dip'],
  PMSUP: [...FUEL_READ, 'plant.issue.create', 'plant.issue.edit', 'plant.issue.submit', 'plant.issue.approve', 'plant.issue.cancel', 'plant.fuel.receive', 'plant.fuel.dip', 'plant.fuel.report', 'plant.fuel.anomaly'],
  PM: [...FUEL_READ, 'plant.fuel.report', 'plant.fuel.costs', 'plant.issue.export', 'plant.fuel.investigate'],
  PLANTMGR: [...FUEL_READ, 'plant.issue.amend', 'plant.issue.cancel', 'plant.issue.export', 'plant.fuel.configure', 'plant.fuel.receive', 'plant.fuel.report', 'plant.fuel.costs', 'plant.fuel.anomaly', 'plant.fuel.investigate'],
  ACCMGR: [...FUEL_READ, 'plant.fuel.report', 'plant.fuel.costs', 'plant.issue.export'], AUD: [...FUEL_READ, 'plant.fuel.report', 'plant.fuel.costs', 'plant.issue.export'],
};
const LOG_READ = ['plant.log.view', 'plant.log.print'];
const ADDED_17_03 = {
  PMSUP: [...LOG_READ, 'plant.log.create', 'plant.log.edit', 'plant.log.delete', 'plant.log.submit', 'plant.log.approve', 'plant.log.cancel', 'plant.breakdown.report', 'plant.breakdown.resolve'],
  SE: [...LOG_READ, 'plant.log.approve', 'plant.breakdown.report'], PM: [...LOG_READ, 'plant.log.approve', 'plant.log.report', 'plant.log.export', 'plant.log.costs'],
  PLANTMGR: [...LOG_READ, 'plant.log.amend', 'plant.log.cancel', 'plant.log.export', 'plant.log.import', 'plant.log.report', 'plant.log.costs', 'plant.breakdown.report', 'plant.breakdown.resolve'], ACCMGR: [...LOG_READ, 'plant.log.report', 'plant.log.export', 'plant.log.costs'],
};
const ADDED_17_02 = {
  SE: REQ_RAISE, CM: [...REQ_RAISE, 'plant.requisition.approve', 'plant.allocation.view'], PM: [...REQ_APPROVE, ...ALLOC_READ, 'plant.allocation.approve', 'plant.allocation.rates', 'plant.requisition.export', 'plant.allocation.export'],
  PLANTMGR: [...REQ_APPROVE.filter((k) => !k.endsWith('approve')), 'plant.requisition.export', 'plant.requisition.import', 'plant.requisition.hire', ...ALLOC_READ, 'plant.allocation.create', 'plant.allocation.edit', 'plant.allocation.delete', 'plant.allocation.submit', 'plant.allocation.approve', 'plant.allocation.cancel', 'plant.allocation.amend', 'plant.allocation.export', 'plant.allocation.import', 'plant.allocation.transfer', 'plant.allocation.rates', 'plant.operator.assign'],
  PMSUP: [...ALLOC_READ, 'plant.allocation.mobilise', 'plant.allocation.transfer', 'plant.allocation.edit', 'plant.allocation.submit', 'plant.allocation.cancel', 'plant.allocation.delete', 'plant.operator.assign'], ACCMGR: [...ALLOC_READ, 'plant.requisition.view', 'plant.allocation.rates', 'plant.allocation.export'],
};
const ADDED_17_01 = {
  PLANTMGR: [...PLT_READ, 'plant.equipment.create', 'plant.equipment.edit', 'plant.equipment.delete', 'plant.equipment.submit', 'plant.equipment.approve', 'plant.equipment.cancel', 'plant.equipment.amend', 'plant.equipment.export', 'plant.equipment.import', 'plant.equipment.status', 'plant.equipment.values', 'plant.document.manage'],
  PMSUP: [...PLT_READ, 'plant.equipment.create', 'plant.equipment.edit', 'plant.equipment.delete', 'plant.equipment.submit', 'plant.equipment.cancel', 'plant.equipment.status', 'plant.document.manage'],
  ACCMGR: [...PLT_READ, 'plant.equipment.approve', 'plant.equipment.export', 'plant.equipment.values'],
};
const ADDED_16_11 = { STOREMGR: ['inv.dashboard.view', 'inv.dashboard.export'], PROCMGR: ['inv.dashboard.view', 'inv.dashboard.export'], ACCMGR: ['inv.dashboard.view', 'inv.dashboard.export'], DIR: ['inv.dashboard.view', 'inv.dashboard.export'], PM: ['inv.dashboard.view', 'inv.dashboard.export'] };
const ADDED_16_10 = {
  QS: [...MRC_READ, 'inv.reconciliation.create', 'inv.reconciliation.edit', 'inv.reconciliation.delete', 'inv.reconciliation.submit', 'inv.reconciliation.cancel', 'inv.reconciliation.amend', 'inv.reconciliation.import', 'inv.reconciliation.configure', 'inv.reconciliation.contribute'],
  SK: ['inv.reconciliation.view', 'inv.reconciliation.contribute'], PROCIC: ['inv.reconciliation.view', 'inv.reconciliation.contribute'], SACC: ['inv.reconciliation.view', 'inv.reconciliation.contribute'],
  PM: [...MRC_READ, 'inv.reconciliation.approve'], PD: [...MRC_READ, 'inv.reconciliation.approve'], DIR: [...MRC_READ, 'inv.reconciliation.approve'],
  STOREMGR: MRC_READ, PROCMGR: MRC_READ, ACCMGR: MRC_READ, AUD: MRC_READ, CM: MRC_READ,
};
const AST_DO = ['inv.small_asset.view', 'inv.small_asset.create', 'inv.small_asset.edit', 'inv.small_asset.delete', 'inv.small_asset.submit', 'inv.small_asset.cancel', 'inv.small_asset.print', 'inv.small_asset.custody', 'inv.loss_report.view', 'inv.loss_report.create', 'inv.loss_report.edit', 'inv.loss_report.delete', 'inv.loss_report.submit', 'inv.loss_report.cancel', 'inv.loss_report.print'];
const AST_READ = ['inv.small_asset.view', 'inv.small_asset.print', 'inv.small_asset.export', 'inv.loss_report.view', 'inv.loss_report.print', 'inv.loss_report.export'];
const ADDED_16_09 = {
  SK: [...AST_DO, 'inv.small_asset.acknowledge'], STOREMGR: [...AST_DO, 'inv.small_asset.acknowledge', 'inv.small_asset.approve', 'inv.small_asset.amend', 'inv.small_asset.export', 'inv.small_asset.import', 'inv.small_asset.dispose', 'inv.small_asset.statement', 'inv.loss_report.amend', 'inv.loss_report.export'],
  CM: [...AST_READ, 'inv.loss_report.approve'], PM: [...AST_READ, 'inv.loss_report.approve', 'inv.small_asset.approve'], HRMGR: [...AST_READ, 'inv.loss_report.approve', 'inv.small_asset.statement'], EMP: ['inv.small_asset.acknowledge'],
  PROCMGR: AST_READ, ACCMGR: AST_READ, AUD: AST_READ,
};
const RTA_DO = ['inv.movement.view', 'inv.movement.create', 'inv.movement.edit', 'inv.movement.delete', 'inv.movement.submit', 'inv.movement.cancel', 'inv.movement.print'];
const RTA_READ = ['inv.movement.view', 'inv.movement.print', 'inv.movement.export', 'inv.rta_hire.view', 'inv.rta_hire.export', 'inv.rta_recovery.view'];
const ADDED_16_08 = {
  SK: RTA_DO, STOREMGR: [...RTA_DO, 'inv.movement.approve', 'inv.movement.amend', 'inv.movement.export', 'inv.movement.import', 'inv.rta_asset.edit', 'inv.rta_hire.view', 'inv.rta_hire.export', 'inv.rta_recovery.view', 'inv.rta_recovery.submit'],
  CM: ['inv.movement.view', 'inv.movement.approve', 'inv.movement.print', 'inv.rta_hire.view', 'inv.rta_recovery.view', 'inv.rta_recovery.approve'], SUBCO: ['inv.movement.view'],
  QS: ['inv.movement.view', 'inv.rta_hire.view', 'inv.rta_recovery.view', 'inv.rta_recovery.approve'], PROCMGR: [...RTA_READ, 'inv.rta_hire.verify', 'inv.rta_asset.edit'],
  PM: [...RTA_READ, 'inv.rta_recovery.approve'], ACCMGR: RTA_READ, AUD: RTA_READ,
};
const RO_READ = ['inv.reorder.view', 'inv.reorder.export', 'inv.ageing.view', 'inv.ageing.export'];
const RO_DO = ['inv.reorder.view', 'inv.reorder.edit', 'inv.reorder.submit', 'inv.ageing.view', 'inv.label.view', 'inv.label.print'];
const ADDED_16_07 = {
  SK: RO_DO, STOREMGR: [...RO_DO, 'inv.reorder.approve', 'inv.reorder.cancel', 'inv.reorder.export', 'inv.reorder.import', 'inv.reorder.suggest', 'inv.ageing.export', 'proc.material_request.view', 'proc.material_request.create', 'proc.material_request.edit', 'proc.material_request.submit', 'proc.material_request.cancel', 'proc.material_request.print'],
  PROCMGR: RO_READ, ACCMGR: RO_READ, PM: RO_READ, AUD: RO_READ,
};
const ADDED_16_06 = {
  SK: CNT_DO, STOREMGR: [...CNT_DO, 'inv.count_plan.approve', 'inv.count_plan.start', 'inv.count_plan.review', 'inv.count_plan.amend', 'inv.count_plan.export', 'inv.count_plan.import', 'inv.scrap_disposal.create', 'inv.scrap_disposal.edit', 'inv.scrap_disposal.delete', 'inv.scrap_disposal.submit', 'inv.scrap_disposal.cancel', 'inv.scrap_disposal.approve', 'inv.scrap_disposal.amend', 'inv.scrap_disposal.print', 'inv.scrap_disposal.export', 'inv.scrap_disposal.import'],
  PROCMGR: [...CNT_READ, 'inv.scrap_disposal.approve', 'inv.adjustment.approve'], CFO: [...CNT_READ, 'inv.scrap_disposal.approve', 'inv.adjustment.approve', 'inv.stock.values'], ACCMGR: CNT_READ, PM: CNT_READ, AUD: CNT_READ,
};
const ADDED_16_05 = {
  SK: TRF_DO, STOREMGR: [...TRF_DO, 'inv.transfer.approve', 'inv.transfer.amend', 'inv.transfer.export', 'inv.transfer.import', 'inv.transfer.resolve'], CM: [...TRF_READ, 'inv.transfer.approve'], PM: [...TRF_READ, 'inv.transfer.approve'],
  PROCMGR: [...TRF_READ, 'inv.transfer.approve'], ACCMGR: TRF_READ, AUD: TRF_READ,
};
const ADDED_16_04 = {
  SK: ISSUE_DO, STOREMGR: [...ISSUE_DO, 'inv.issue.approve', 'inv.issue.amend', 'inv.issue.export', 'inv.issue.import', 'inv.site_return.approve', 'inv.site_return.amend', 'inv.site_return.export', 'inv.site_return.import', 'inv.free_issue.view'],
  CM: [...ISSUE_READ, 'inv.issue.acknowledge'], SE: [...ISSUE_READ, 'inv.issue.acknowledge'], SUBCO: ['inv.issue.view', 'inv.issue.approve', 'inv.issue.acknowledge'], QS: [...ISSUE_READ, 'inv.issue.approve', 'inv.free_issue.view', 'inv.free_issue.reconcile', 'inv.free_issue.certify', 'inv.free_issue.export'],
  PM: [...ISSUE_READ, 'inv.free_issue.view'], PROCMGR: ISSUE_READ, ACCMGR: [...ISSUE_READ, 'inv.free_issue.view'], AUD: [...ISSUE_READ, 'inv.free_issue.view'],
};
const ADDED_16_03 = {
  SK: GRN_DO, STOREMGR: [...GRN_DO, 'inv.grn.emergency', 'inv.grn.approve', 'inv.grn.amend', 'inv.grn.export', 'inv.grn.import', 'inv.grn.inspect', 'inv.rtv.export', 'inv.rtv.import', 'inv.rtv.amend'], CM: [...GRN_READ, 'inv.grn.approve'],
  PROCMGR: [...GRN_READ, 'inv.grn.approve', 'inv.rtv.approve', 'inv.grn.emergency'], QCE: ['inv.grn.view', 'inv.grn.print', 'inv.grn.inspect', 'inv.rtv.view'], ACCMGR: GRN_READ, PM: GRN_READ, AUD: GRN_READ,
};
const ADDED_16_02 = {
  GUARD: [...GATE_ENTRY, 'inv.pass.view', 'inv.pass.verify', 'inv.pass.return'], SECSUP: [...GATE_ENTRY, 'inv.inward.export', 'inv.pass.view', 'inv.pass.verify', 'inv.pass.return', 'inv.pass.export'],
  SK: [...GATE_ENTRY, 'inv.inward.handover', 'inv.inward.amend', ...GATE_PASS_DO],
  STOREMGR: [...GATE_ENTRY, 'inv.inward.handover', 'inv.inward.amend', 'inv.inward.approve', 'inv.inward.export', 'inv.inward.import', ...GATE_PASS_DO, 'inv.pass.approve', 'inv.pass.export', 'inv.pass.import', 'inv.pass.verify'],
  CM: [...GATE_READ, 'inv.pass.approve'], PM: [...GATE_READ, 'inv.pass.approve'], PROCMGR: GATE_READ, AUD: GATE_READ,
};
const ADDED_16_01 = { SK: SK_STOCK, STOREMGR: [...SK_STOCK, 'inv.store.create', 'inv.store.edit', 'inv.store.approve', 'inv.store.export', 'inv.store.all', 'inv.bin.manage', 'inv.stock.values', 'inv.stock.import', 'inv.stock.reverse', 'inv.stock.export', 'inv.stock.reconcile', 'inv.adjustment.approve', 'inv.adjustment.cancel'],
  PROCMGR: INV_READ, ACCMGR: [...INV_READ, 'inv.stock.reconcile', 'inv.adjustment.approve'], PM: [...INV_READ, 'inv.store.create'], AUD: [...INV_READ, 'inv.store.export', 'inv.stock.reconcile'] };
// Part 15.10: procurement dashboard and analytics. Procurement and commercial managers, the direction and finance read the company view; a project manager reads the projects they hold; the auditor reads.
const ADDED_15_10 = { PROCMGR: ['proc.analytics.view', 'proc.analytics.export'], COMMGR: ['proc.analytics.view', 'proc.analytics.export'], PM: ['proc.analytics.view'], DIR: ['proc.analytics.view', 'proc.analytics.export'], CFO: ['proc.analytics.view', 'proc.analytics.export'], AUD: ['proc.analytics.view', 'proc.analytics.export'] };
// Part 15.09: material rate intelligence. Procurement managers, estimators, commercial managers and the direction read it; the procurement manager enters market surveys, corrections and price indices.
const ADDED_15_09 = { PROCMGR: ['proc.rate_intel.view', 'proc.rate_intel.survey', 'proc.rate_intel.index', 'proc.rate_intel.export'], EST: ['proc.rate_intel.view', 'proc.rate_intel.export'], COMMGR: ['proc.rate_intel.view', 'proc.rate_intel.export'], DIR: ['proc.rate_intel.view'], AUD: ['proc.rate_intel.view', 'proc.rate_intel.export'] };
// Part 15.08: vendor prequalification, the approved vendor list and scorecards. Procurement and commercial prepare prequalifications; procurement, quality (technical) and the direction (strategic categories) approve them; procurement proposes suspensions and
// procurement and the direction approve them; quality and safety people enter the inputs of a score; the project manager and the auditor read.
const PQ_PREP = ['proc.prequalification.view', 'proc.prequalification.create', 'proc.prequalification.edit', 'proc.prequalification.delete', 'proc.prequalification.submit', 'proc.prequalification.cancel', 'proc.prequalification.amend', 'proc.prequalification.print', 'proc.prequalification.export'];
const PQ_READ = ['proc.prequalification.view', 'proc.prequalification.print'];
const VND_ACT = ['proc.vendor_action.view', 'proc.vendor_action.create', 'proc.vendor_action.edit', 'proc.vendor_action.close'];
const ADDED_15_08 = { PROCMGR: [...PQ_PREP, 'proc.prequalification.approve', 'proc.avl.view', 'proc.avl.suspend', 'proc.avl.approve', 'proc.avl.export', 'proc.vendor_score.view', 'proc.vendor_score.compute', 'proc.vendor_score.export', ...VND_ACT], PROCIC: [...PQ_PREP, 'proc.avl.view', 'proc.avl.suspend', 'proc.avl.export', 'proc.vendor_score.view', 'proc.vendor_score.compute', 'proc.vendor_action.view', 'proc.vendor_action.create', 'proc.vendor_action.edit'],
  COMMGR: [...PQ_PREP, 'proc.avl.view', 'proc.vendor_score.view'], QCMGR: [...PQ_READ, 'proc.prequalification.approve', 'proc.avl.view', 'proc.vendor_score.view', 'proc.vendor_score.input', 'proc.vendor_action.view', 'proc.vendor_action.create'], HSEO: ['proc.vendor_score.view', 'proc.vendor_score.input', 'proc.avl.view'], HSEE: ['proc.vendor_score.view', 'proc.vendor_score.input', 'proc.avl.view'],
  DIR: [...PQ_READ, 'proc.prequalification.approve', 'proc.avl.view', 'proc.avl.approve', 'proc.vendor_score.view'], PM: ['proc.avl.view', 'proc.vendor_score.view'], AUD: [...PQ_READ, 'proc.prequalification.export', 'proc.avl.view', 'proc.avl.export', 'proc.vendor_score.view', 'proc.vendor_score.export', 'proc.vendor_action.view'] };
// Part 15.07: expediting, vendor inspection and shipments. The procurement manager and officer (the expediter) plan, follow and ship; the procurement manager approves the plan; the quality engineer calls and records inspections and reviews the release note,
// the quality manager releases it; the project manager, planner and auditor read; the storekeeper sees the shipments coming.
const XP_WORK = ['proc.expediting_plan.view', 'proc.expediting_plan.create', 'proc.expediting_plan.edit', 'proc.expediting_plan.delete', 'proc.expediting_plan.submit', 'proc.expediting_plan.cancel', 'proc.expediting_plan.amend', 'proc.expediting_plan.print', 'proc.expediting_plan.export', 'proc.expediting_plan.progress'];
const XP_READ = ['proc.expediting_plan.view', 'proc.expediting_plan.print', 'proc.expediting_plan.export'];
const SH_WORK = ['proc.shipment.view', 'proc.shipment.create', 'proc.shipment.edit', 'proc.shipment.delete', 'proc.shipment.cancel', 'proc.shipment.dispatch', 'proc.shipment.deliver', 'proc.shipment.track', 'proc.shipment.print', 'proc.shipment.export'];
const SH_READ = ['proc.shipment.view', 'proc.shipment.print', 'proc.shipment.export'];
const IN_QC = ['proc.inspection.view', 'proc.inspection.create', 'proc.inspection.edit', 'proc.inspection.delete', 'proc.inspection.submit', 'proc.inspection.cancel', 'proc.inspection.amend', 'proc.inspection.print', 'proc.inspection.export', 'proc.inspection.result'];
const IN_READ = ['proc.inspection.view', 'proc.inspection.print', 'proc.inspection.export'];
const ADDED_15_07 = { PROCMGR: [...XP_WORK, 'proc.expediting_plan.approve', ...SH_WORK, ...IN_READ], PROCIC: [...XP_WORK, ...SH_WORK, ...IN_READ], QCE: [...IN_QC, 'proc.inspection.approve', ...XP_READ, 'proc.shipment.view'], QCMGR: [...IN_QC, 'proc.inspection.approve', ...XP_READ, ...SH_READ], PM: [...XP_READ, ...IN_READ, ...SH_READ, 'proc.expediting_plan.progress'], PLAN: [...XP_READ, ...SH_READ], PD: [...XP_READ, ...SH_READ], AUD: [...XP_READ, ...IN_READ, ...SH_READ], SK: ['proc.shipment.view'] };
const ADDED_15_06 = { PROCIC: [...RC_PREPARE, ...SO_PREPARE, ...SE_PREPARE], PROCMGR: [...RC_PREPARE, 'proc.rate_contract.approve', ...SO_PREPARE, 'proc.service_order.approve', ...SE_PREPARE, 'proc.service_entry.approve'], COMMGR: [...RC_READ, 'proc.rate_contract.approve', 'proc.service_order.view', 'proc.service_order.rates'], CFO: RC_READ, DIR: [...RC_READ, 'proc.rate_contract.approve', ...SO_DECIDE],
  PM: [...SO_DECIDE, ...SE_DECIDE, 'proc.service_entry.create', 'proc.service_entry.edit', 'proc.service_entry.submit'], PD: SO_DECIDE, SE: [...SE_PREPARE, ...SE_DECIDE.filter((x) => x !== 'proc.service_entry.view'), 'proc.service_order.view'], CM: [...SE_PREPARE, 'proc.service_order.view'], QS: [...RC_READ, 'proc.service_order.view', 'proc.service_order.rates', 'proc.service_entry.view'], AUD: [...RC_READ, 'proc.service_order.view', 'proc.service_order.rates', 'proc.service_order.export', 'proc.service_entry.view', 'proc.service_entry.export'] };
// Part 15.05: purchase orders. The procurement officer and manager make, amend, send and track orders and ask for advances; the procurement manager, project manager, project director and direction approve by value; commercial and finance read
// the rates and decide the advance; the storekeeper reads the order to receive goods but sees no rate; the stock integration posts receipts.
const PO_WORK = ['proc.purchase_order.view', 'proc.purchase_order.create', 'proc.purchase_order.edit', 'proc.purchase_order.delete', 'proc.purchase_order.submit', 'proc.purchase_order.cancel', 'proc.purchase_order.amend', 'proc.purchase_order.print', 'proc.purchase_order.export', 'proc.purchase_order.rates', 'proc.purchase_order.release', 'proc.purchase_order.dispatch', 'proc.purchase_order.advance'];
const PO_DECIDE = ['proc.purchase_order.view', 'proc.purchase_order.approve', 'proc.purchase_order.print', 'proc.purchase_order.export', 'proc.purchase_order.rates'];
const ADDED_15_05 = { PROCIC: PO_WORK, PROCMGR: [...PO_WORK, 'proc.purchase_order.approve', 'proc.purchase_order.advance_approve'], PM: PO_DECIDE, PD: PO_DECIDE, DIR: PO_DECIDE, COMMGR: ['proc.purchase_order.view', 'proc.purchase_order.print', 'proc.purchase_order.export', 'proc.purchase_order.rates', 'proc.purchase_order.advance_approve'], CFO: ['proc.purchase_order.view', 'proc.purchase_order.rates', 'proc.purchase_order.advance_approve'], QS: ['proc.purchase_order.view', 'proc.purchase_order.rates'], AUD: ['proc.purchase_order.view', 'proc.purchase_order.print', 'proc.purchase_order.export', 'proc.purchase_order.rates'], SK: ['proc.purchase_order.view'], SYSADM: ['proc.purchase_order.receipts'] };
// Part 15.04: comparative statements. The procurement officer and manager prepare the statement and send it; the project manager, the project director and the direction approve it by value (one level higher when the vendor is not the L1);
// commercial reads it. The statement shows rates, so only the roles that decide or buy hold the right; site roles hold none.
const CS_PREPARE = ['proc.comparative_statement.view', 'proc.comparative_statement.create', 'proc.comparative_statement.edit', 'proc.comparative_statement.delete', 'proc.comparative_statement.submit', 'proc.comparative_statement.cancel', 'proc.comparative_statement.amend', 'proc.comparative_statement.print', 'proc.comparative_statement.export'];
const CS_DECIDE = ['proc.comparative_statement.view', 'proc.comparative_statement.approve', 'proc.comparative_statement.print', 'proc.comparative_statement.export'];
const ADDED_15_04 = { PROCIC: CS_PREPARE, PROCMGR: [...CS_PREPARE, 'proc.comparative_statement.approve'], PM: CS_DECIDE, PD: CS_DECIDE, DIR: CS_DECIDE, COMMGR: CS_DECIDE, CFO: ['proc.comparative_statement.view', 'proc.comparative_statement.print'], AUD: ['proc.comparative_statement.view', 'proc.comparative_statement.print', 'proc.comparative_statement.export'] };
// Part 15.03: RFQs and vendor quotations. The procurement officer and manager make RFQs, issue them, key in quotations and read the comparison; the procurement manager and then the project director approve a single-source justification (the project
// director also reads the rates); the project manager reads RFQs but not the rates; commercial and direction read the rates (BR-02); site roles see no rate at all (they have no right to the quotations).
const RFQ_WORK = ['proc.rfq.view', 'proc.rfq.create', 'proc.rfq.edit', 'proc.rfq.delete', 'proc.rfq.submit', 'proc.rfq.cancel', 'proc.rfq.amend', 'proc.rfq.print', 'proc.rfq.export', 'proc.rfq.issue', 'proc.quotation.view', 'proc.quotation.create', 'proc.quotation.edit', 'proc.quotation.delete', 'proc.quotation.submit', 'proc.quotation.cancel', 'proc.quotation.amend', 'proc.quotation.print', 'proc.quotation.export', 'proc.quotation.rates'];
const RFQ_RATES = ['proc.rfq.view', 'proc.rfq.print', 'proc.rfq.export', 'proc.quotation.view', 'proc.quotation.print', 'proc.quotation.export', 'proc.quotation.rates'];
const ADDED_15_03 = { PROCIC: RFQ_WORK, PROCMGR: [...RFQ_WORK, 'proc.rfq.approve'], PD: [...RFQ_RATES, 'proc.rfq.approve'], PM: ['proc.rfq.view', 'proc.rfq.print'], COMMGR: RFQ_RATES, DIR: RFQ_RATES, CFO: ['proc.rfq.view', 'proc.quotation.view', 'proc.quotation.rates'], QS: ['proc.rfq.view', 'proc.quotation.view', 'proc.quotation.rates'], AUD: RFQ_RATES };
// Part 15.02: MRP. Planning and the procurement officer run MRP and decide its proposals (accept into a draft requisition, change, reject) and propose item planning parameters; the procurement manager approves the parameters and reads the runs;
// the project manager reads them. A run has no approval of its own: the decision is the planner's, on each proposal (BR-01).
const RUN_WORK = ['proc.run.view', 'proc.run.create', 'proc.run.edit', 'proc.run.delete', 'proc.run.submit', 'proc.run.cancel', 'proc.run.amend', 'proc.run.print', 'proc.run.export', 'proc.proposal.decide', 'proc.item_param.view', 'proc.item_param.edit', 'proc.item_param.submit', 'proc.item_param.cancel'];
const ADDED_15_02 = { PLAN: RUN_WORK, PROCIC: RUN_WORK, PROCMGR: ['proc.run.view', 'proc.run.print', 'proc.run.export', 'proc.item_param.view', 'proc.item_param.approve'], PM: ['proc.run.view', 'proc.run.print'], SYSADM: ['proc.supply.ingest'] };
// Part 15.01: material requests and purchase requisitions. The site engineer, storekeeper and planner raise requests and requisitions (the requisition shows them no rates); the construction manager approves a request; the procurement officer
// and manager meet the requests (issue, transfer, purchase), consolidate them into requisitions and send them; the project manager approves a requisition, the project director and procurement manager above the bands; cost (rates and values) is seen
// by the roles that approve, buy, control cost or audit.
const MR_RAISE = ['proc.material_request.view', 'proc.material_request.create', 'proc.material_request.edit', 'proc.material_request.delete', 'proc.material_request.submit', 'proc.material_request.cancel', 'proc.material_request.print'];
const PR_RAISE = ['proc.requisition.view', 'proc.requisition.create', 'proc.requisition.edit', 'proc.requisition.delete', 'proc.requisition.submit', 'proc.requisition.cancel', 'proc.requisition.print'];
const PR_BUY = [...PR_RAISE, 'proc.requisition.amend', 'proc.requisition.export', 'proc.requisition.emergency', 'proc.requisition.cost'];
const MR_PROCESS = ['proc.material_request.view', 'proc.material_request.process', 'proc.material_request.print', 'proc.material_request.export', 'proc.material_request.create', 'proc.material_request.edit', 'proc.material_request.submit', 'proc.material_request.cancel', 'proc.material_request.amend'];
const ADDED_15_01 = {
  SYSADM: ['proc.stock.ingest'], SE: [...MR_RAISE, ...PR_RAISE, 'proc.material_request.amend'], SK: [...MR_RAISE, ...PR_RAISE, 'bud.check.use'], PLAN: [...MR_RAISE, ...PR_RAISE, 'bud.check.use'],
  CM: ['proc.material_request.view', 'proc.material_request.approve', 'proc.material_request.print', 'proc.material_request.export', 'proc.requisition.view'],
  PM: ['proc.material_request.view', 'proc.material_request.print', 'proc.material_request.export', 'proc.requisition.view', 'proc.requisition.approve', 'proc.requisition.print', 'proc.requisition.export', 'proc.requisition.emergency', 'proc.requisition.cost'],
  PD: ['proc.material_request.view', 'proc.requisition.view', 'proc.requisition.approve', 'proc.requisition.print', 'proc.requisition.export', 'proc.requisition.cost'],
  PROCIC: [...MR_PROCESS, ...PR_BUY, 'bud.check.use'], PROCMGR: [...MR_PROCESS, ...PR_BUY, 'proc.requisition.approve', 'bud.check.use'],
  QS: ['proc.material_request.view', 'proc.requisition.view', 'proc.requisition.cost', 'proc.requisition.export'], PCMGR: ['proc.material_request.view', 'proc.material_request.export', 'proc.requisition.view', 'proc.requisition.cost', 'proc.requisition.export'],
  AUD: ['proc.material_request.view', 'proc.material_request.export', 'proc.requisition.view', 'proc.requisition.export', 'proc.requisition.cost'],
};
// Part 14.07: the project control engine. Project controls, project manager, project director, direction and finance read the figures; the quantity surveyor and project controls prepare the allocation of an unallocated cost (maker) and the
// project manager approves it (checker); the nightly reconciliation may be run on request by project controls and the project manager.
const CTL_READ = ['site.control.view'];
const ADDED_14_07 = {
  PCMGR: ['site.control.view', 'site.control.submit', 'site.control.export', 'site.control.reconcile'], PM: ['site.control.view', 'site.control.approve', 'site.control.export', 'site.control.reconcile'], PD: ['site.control.view', 'site.control.export'], DIR: CTL_READ,
  QS: ['site.control.view', 'site.control.submit'], CFO: CTL_READ, ACCMGR: CTL_READ, FINEX: CTL_READ, AUD: ['site.control.view', 'site.control.export'],
};
const ADDED_14_06 = {
  CM: ['site.productivity.view', 'site.productivity.record', 'site.productivity.export'], PM: ['site.productivity.view', 'site.productivity.approve', 'site.productivity.record', 'site.productivity.export'], PCMGR: ['site.productivity.view', 'site.productivity.configure', 'site.productivity.submit', 'site.productivity.cancel', 'site.productivity.export'],
  PLAN: ['site.productivity.view', 'site.productivity.configure', 'site.productivity.submit', 'site.productivity.cancel'], SE: ['site.productivity.view', 'site.productivity.record'], PD: PRD_READ, DIR: PRD_READ, QS: PRD_READ, AUD: ['site.productivity.view', 'site.productivity.export'],
};
const ADDED_14_05 = {
  PLAN: PRG_MANAGE, PCMGR: PRG_MANAGE, PM: ['site.period.view', 'site.period.approve', 'site.period.print', 'site.period.export', 'site.period.cost'], PD: ['site.period.view', 'site.period.print', 'site.period.export', 'site.period.cost'], DIR: ['site.period.view', 'site.period.print', 'site.period.cost'],
  CM: ['site.period.view', 'site.period.print'], QS: ['site.period.view', 'site.period.cost'], COMMGR: ['site.period.view', 'site.period.cost'], AUD: ['site.period.view', 'site.period.export', 'site.period.cost'],
};
const ADDED_14_04 = {
  CM: [...INS_RECORD, 'site.instruction.approve'], PM: [...INS_RECORD, 'site.instruction.approve'], SUBCO: ['site.instruction.view', 'site.instruction.acknowledge', 'site.instruction.comply', 'site.instruction.print'],
  SE: ['site.instruction.view', 'site.instruction.acknowledge', 'site.instruction.comply', 'site.instruction.print'], COMMGR: ['site.instruction.view', 'site.instruction.variation', 'site.instruction.print', 'site.instruction.export', 'site.instruction.cost'],
  PLAN: ['site.instruction.view'], QS: ['site.instruction.view', 'site.instruction.cost'], PCMGR: ['site.instruction.view', 'site.instruction.export', 'site.instruction.cost'], PD: ['site.instruction.view', 'site.instruction.print', 'site.instruction.cost'], DIR: ['site.instruction.view', 'site.instruction.cost'], AUD: ['site.instruction.view', 'site.instruction.export', 'site.instruction.cost'],
};
const ADDED_14_03 = {
  SE: COND_RECORD, CSUP: COND_RECORD, CM: [...COND_RECORD, 'site.hindrance.approve', 'site.diary.sign'],
  PM: [...COND_READ, 'site.hindrance.approve', 'site.hindrance.cancel', 'site.hindrance.print', 'site.hindrance.export', 'site.hindrance.close', 'site.weather.export', 'site.diary.export', 'site.visitor.export'],
  PLAN: [...COND_READ, 'site.hindrance.print', 'site.hindrance.export', 'site.weather.export'], COMMGR: [...COND_READ, 'site.hindrance.print', 'site.hindrance.export', 'site.weather.export'],
  QS: ['site.hindrance.view', 'site.weather.view'], PCMGR: [...COND_READ, 'site.hindrance.export', 'site.weather.export'], PD: [...COND_READ, 'site.hindrance.print'], DIR: COND_READ, AUD: [...COND_READ, 'site.hindrance.export', 'site.weather.export', 'site.diary.export', 'site.visitor.export'],
};
const ADDED_14_02 = {
  SE: [...DPR_PREPARE, 'site.dpr.report'], CSUP: DPR_PREPARE, CM: DPR_APPROVE, PM: DPR_APPROVE,
  PLAN: DPR_READ, QS: DPR_READ, PCMGR: [...DPR_READ, 'site.dpr.export'], PD: [...DPR_READ, 'site.dpr.print'], DIR: DPR_READ, AUD: [...DPR_READ, 'site.dpr.export'],
};
const ADDED_14_01 = {
  SE: WA_SITE, CM: [...WA_SITE, 'site.work_authorisation.approve'], PM: [...WA_READ, 'site.work_authorisation.approve', 'site.work_authorisation.cancel', 'site.work_authorisation.print', 'site.work_authorisation.export'],
  PLAN: [...WA_READ, 'site.work_front.manage'], PD: [...WA_READ, 'site.work_authorisation.print', 'site.work_authorisation.export'], PCMGR: [...WA_READ, 'site.work_authorisation.export'], DIR: WA_READ, AUD: [...WA_READ, 'site.work_authorisation.export'],
  WSUP: WA_READ, CSUP: WA_READ, QCE: WA_READ, HSEE: WA_READ, QCMGR: WA_READ, SK: ['site.work_authorisation.view', 'site.wa.use'], PMSUP: ['site.work_authorisation.view', 'site.wa.use'], QS: WA_READ,
};
const ADDED_13_05 = {
  PLAN: ['plan.delay.view', 'plan.delay.create', 'plan.delay.edit', 'plan.delay.delete', 'plan.delay.submit', 'plan.delay.cancel', 'plan.delay.amend', 'plan.delay.print', 'plan.delay.export', 'plan.delay.analyse'],
  PM: [...DELAY_READ, 'plan.delay.approve'], COMMGR: [...DELAY_READ, 'plan.delay.approve'], PD: [...DELAY_READ, 'plan.delay.cancel'], PCMGR: [...DELAY_READ, 'plan.delay.analyse'], CM: DELAY_READ, QS: DELAY_READ, DIR: ['plan.delay.view', 'plan.delay.print'], AUD: ['plan.delay.view', 'plan.delay.export'],
  SE: ['plan.delay.view'], DOC: ['plan.delay.view'], DESIGN: ['plan.delay.view'],
};
// Part 13.04: look-ahead, constraints and weekly work plans. The planner and the construction manager prepare the plan; the site engineer and the work supervisor commit quantities in a draft and record
// what was done; the chain is the construction manager, then the project manager (whoever prepared a plan never decides it); the rest of the project reads.
const WEEKLY_ALL = ['plan.lookahead.view', 'plan.constraint.view', 'plan.constraint.manage', 'plan.weekly_plan.view', 'plan.weekly_plan.create', 'plan.weekly_plan.edit', 'plan.weekly_plan.delete', 'plan.weekly_plan.submit', 'plan.weekly_plan.cancel', 'plan.weekly_plan.amend', 'plan.weekly_plan.print', 'plan.weekly_plan.export'];
const SITE_13_04 = ['plan.lookahead.view', 'plan.constraint.view', 'plan.constraint.manage', 'plan.weekly_plan.view', 'plan.weekly_plan.edit', 'plan.weekly_plan.record'];
const READ_13_04 = ['plan.lookahead.view', 'plan.constraint.view', 'plan.weekly_plan.view'];
const ADDED_13_04 = {
  PLAN: WEEKLY_ALL, CM: [...WEEKLY_ALL, 'plan.weekly_plan.approve'], PM: [...READ_13_04, 'plan.constraint.manage', 'plan.weekly_plan.approve', 'plan.weekly_plan.print', 'plan.weekly_plan.export'],
  PD: [...READ_13_04, 'plan.weekly_plan.print', 'plan.weekly_plan.export'], PCMGR: [...READ_13_04, 'plan.weekly_plan.print', 'plan.weekly_plan.export'], DIR: READ_13_04, AUD: [...READ_13_04, 'plan.weekly_plan.export'],
  SE: SITE_13_04, WSUP: SITE_13_04, CSUP: READ_13_04, PMSUP: READ_13_04, SK: ['plan.lookahead.view', 'plan.constraint.view'], PROCIC: READ_13_04, QCE: READ_13_04, HSEE: READ_13_04, QS: READ_13_04, DOC: READ_13_04, DESIGN: READ_13_04, PROCMGR: READ_13_04, QCMGR: READ_13_04, COMMGR: READ_13_04,
};
// Part 13.03: baselines and the exchange of schedules. The planner prepares a baseline and imports files into the working schedule; the project manager reviews and the project director approves
// (the planner holds no approval, so the one who prepares never decides); controls, construction and audit read, print and export; the site and the other project roles read.
const ADDED_13_03 = {
  PLAN: ['plan.baseline.view', 'plan.baseline.create', 'plan.baseline.edit', 'plan.baseline.delete', 'plan.baseline.submit', 'plan.baseline.cancel', 'plan.baseline.amend', 'plan.baseline.print', 'plan.baseline.export', 'plan.schedule.import'],
  PM: ['plan.baseline.view', 'plan.baseline.approve', 'plan.baseline.print', 'plan.baseline.export'],
  PD: ['plan.baseline.view', 'plan.baseline.approve', 'plan.baseline.cancel', 'plan.baseline.print', 'plan.baseline.export'],
  PCMGR: ['plan.baseline.view', 'plan.baseline.print', 'plan.baseline.export'],
  CM: ['plan.baseline.view', 'plan.baseline.print', 'plan.baseline.export'],
  DIR: ['plan.baseline.view', 'plan.baseline.print'],
  AUD: ['plan.baseline.view', 'plan.baseline.export'],
  SE: ['plan.baseline.view'], QS: ['plan.baseline.view'], COMMGR: ['plan.baseline.view'], DOC: ['plan.baseline.view'], DESIGN: ['plan.baseline.view'], PROCMGR: ['plan.baseline.view'], QCMGR: ['plan.baseline.view'],
};
// Part 13.02: the planner assigns resources and drafts availability; the project controls manager or project director puts availability in force; every role that reads the schedule reads its resource loading.
const ADDED_13_02 = {
  PLAN: ['plan.resource.view', 'plan.resource.edit', 'plan.capacity.manage'],
  PCMGR: ['plan.resource.view', 'plan.capacity.approve'],
  PD: ['plan.resource.view', 'plan.capacity.approve'],
  PM: ['plan.resource.view'],
  CM: ['plan.resource.view'],
  DIR: ['plan.resource.view'],
  AUD: ['plan.resource.view'],
  SE: ['plan.resource.view'],
  CSUP: ['plan.resource.view'],
  WSUP: ['plan.resource.view'],
  PMSUP: ['plan.resource.view'],
  SK: ['plan.resource.view'],
  PROCIC: ['plan.resource.view'],
  SACC: ['plan.resource.view'],
  QCE: ['plan.resource.view'],
  HSEE: ['plan.resource.view'],
  SUBCO: ['plan.resource.view'],
  QS: ['plan.resource.view'],
  DOC: ['plan.resource.view'],
  DESIGN: ['plan.resource.view'],
  PROCMGR: ['plan.resource.view'],
  QCMGR: ['plan.resource.view'],
  COMMGR: ['plan.resource.view'],
};
const ADDED_13_01 = {
  PLAN: ['plan.schedule.view', 'plan.schedule.create', 'plan.schedule.edit', 'plan.schedule.delete', 'plan.schedule.submit', 'plan.schedule.approve', 'plan.schedule.cancel', 'plan.schedule.amend', 'plan.schedule.print', 'plan.schedule.export', 'plan.schedule.progress', 'plan.calendar.view', 'plan.calendar.manage', 'plan.template.manage'],
  PCMGR: ['plan.schedule.view', 'plan.schedule.approve', 'plan.schedule.print', 'plan.schedule.export', 'plan.schedule.progress', 'plan.calendar.view', 'plan.calendar.approve', 'plan.template.approve'],
  PD: ['plan.schedule.view', 'plan.schedule.approve', 'plan.schedule.print', 'plan.schedule.export', 'plan.calendar.view'],
  PM: ['plan.schedule.view', 'plan.schedule.print', 'plan.schedule.export', 'plan.calendar.view'],
  CM: ['plan.schedule.view', 'plan.schedule.print', 'plan.schedule.export', 'plan.calendar.view'],
  DIR: ['plan.schedule.view', 'plan.schedule.print', 'plan.calendar.view'],
  AUD: ['plan.schedule.view', 'plan.calendar.view'],
  SE: ['plan.schedule.view', 'plan.calendar.view'],
  CSUP: ['plan.schedule.view', 'plan.calendar.view'],
  WSUP: ['plan.schedule.view', 'plan.calendar.view'],
  PMSUP: ['plan.schedule.view', 'plan.calendar.view'],
  SK: ['plan.schedule.view', 'plan.calendar.view'],
  PROCIC: ['plan.schedule.view', 'plan.calendar.view'],
  SACC: ['plan.schedule.view', 'plan.calendar.view'],
  QCE: ['plan.schedule.view', 'plan.calendar.view'],
  HSEE: ['plan.schedule.view', 'plan.calendar.view'],
  SUBCO: ['plan.schedule.view', 'plan.calendar.view'],
  QS: ['plan.schedule.view', 'plan.calendar.view'],
  DOC: ['plan.schedule.view', 'plan.calendar.view'],
  DESIGN: ['plan.schedule.view', 'plan.calendar.view'],
  PROCMGR: ['plan.schedule.view', 'plan.calendar.view'],
  QCMGR: ['plan.schedule.view', 'plan.calendar.view'],
  COMMGR: ['plan.schedule.view', 'plan.calendar.view'],
};
const ADDED_12_04 = {
  SYSADM: ['bud.dept_actual.post'],
  CFO: ['bud.dept_budget.view', 'bud.dept_budget.approve', 'bud.dept_budget.print', 'bud.dept_budget.export', 'bud.dept_report.view', 'bud.dept_report.export', 'bud.alloc.view', 'bud.alloc.approve', 'bud.alloc.run'],
  DIR: ['bud.dept_budget.view', 'bud.dept_budget.approve', 'bud.dept_budget.print', 'bud.dept_budget.export', 'bud.dept_report.view', 'bud.dept_report.export', 'bud.alloc.view', 'bud.alloc.approve'],
  ACCMGR: ['bud.dept_budget.view', 'bud.dept_budget.create', 'bud.dept_budget.edit', 'bud.dept_budget.delete', 'bud.dept_budget.submit', 'bud.dept_budget.cancel', 'bud.dept_budget.amend', 'bud.dept_budget.print', 'bud.dept_budget.export', 'bud.dept_report.view', 'bud.dept_report.export', 'bud.alloc.view', 'bud.alloc.configure', 'bud.alloc.run'],
  HRMGR: ['bud.dept_budget.view', 'bud.dept_budget.create', 'bud.dept_budget.edit', 'bud.dept_budget.delete', 'bud.dept_budget.submit', 'bud.dept_budget.cancel', 'bud.dept_budget.amend', 'bud.dept_budget.print', 'bud.dept_budget.export', 'bud.dept_report.view', 'bud.dept_report.export'],
  PROCMGR: ['bud.dept_budget.view', 'bud.dept_budget.create', 'bud.dept_budget.edit', 'bud.dept_budget.delete', 'bud.dept_budget.submit', 'bud.dept_budget.cancel', 'bud.dept_budget.amend', 'bud.dept_budget.print', 'bud.dept_budget.export', 'bud.dept_report.view', 'bud.dept_report.export'],
  COMMGR: ['bud.dept_budget.view', 'bud.dept_budget.create', 'bud.dept_budget.edit', 'bud.dept_budget.delete', 'bud.dept_budget.submit', 'bud.dept_budget.cancel', 'bud.dept_budget.amend', 'bud.dept_budget.print', 'bud.dept_budget.export', 'bud.dept_report.view', 'bud.dept_report.export'],
  QCMGR: ['bud.dept_budget.view', 'bud.dept_budget.create', 'bud.dept_budget.edit', 'bud.dept_budget.delete', 'bud.dept_budget.submit', 'bud.dept_budget.cancel', 'bud.dept_budget.amend', 'bud.dept_budget.print', 'bud.dept_budget.export', 'bud.dept_report.view', 'bud.dept_report.export'],
  PCMGR: ['bud.dept_budget.view', 'bud.dept_budget.create', 'bud.dept_budget.edit', 'bud.dept_budget.delete', 'bud.dept_budget.submit', 'bud.dept_budget.cancel', 'bud.dept_budget.amend', 'bud.dept_budget.print', 'bud.dept_budget.export', 'bud.dept_report.view', 'bud.dept_report.export'],
  PLANTMGR: ['bud.dept_budget.view', 'bud.dept_budget.create', 'bud.dept_budget.edit', 'bud.dept_budget.delete', 'bud.dept_budget.submit', 'bud.dept_budget.cancel', 'bud.dept_budget.amend', 'bud.dept_budget.print', 'bud.dept_budget.export', 'bud.dept_report.view', 'bud.dept_report.export'],
  EST: ['bud.dept_budget.view', 'bud.dept_budget.create', 'bud.dept_budget.edit', 'bud.dept_budget.delete', 'bud.dept_budget.submit', 'bud.dept_budget.cancel', 'bud.dept_budget.amend', 'bud.dept_budget.print', 'bud.dept_budget.export', 'bud.dept_report.view', 'bud.dept_report.export'],
  BD: ['bud.dept_budget.view', 'bud.dept_budget.create', 'bud.dept_budget.edit', 'bud.dept_budget.delete', 'bud.dept_budget.submit', 'bud.dept_budget.cancel', 'bud.dept_budget.amend', 'bud.dept_budget.print', 'bud.dept_budget.export', 'bud.dept_report.view', 'bud.dept_report.export'],
  SECMGR: ['bud.dept_budget.view', 'bud.dept_budget.create', 'bud.dept_budget.edit', 'bud.dept_budget.delete', 'bud.dept_budget.submit', 'bud.dept_budget.cancel', 'bud.dept_budget.amend', 'bud.dept_budget.print', 'bud.dept_budget.export', 'bud.dept_report.view', 'bud.dept_report.export'],
  AUD: ['bud.dept_budget.view', 'bud.dept_report.view', 'bud.alloc.view'],
};
const ADDED_12_03 = {
  SYSADM: ['bud.ledger.post', 'bud.ledger.view', 'bud.check.use'],
  PCMGR: ['bud.ledger.view', 'bud.ledger.export', 'bud.check.use', 'bud.check.view', 'bud.check.configure'],
  PM: ['bud.ledger.view', 'bud.ledger.export', 'bud.check.use', 'bud.check.view', 'bud.check.configure'],
  PD: ['bud.ledger.view', 'bud.ledger.export', 'bud.check.use', 'bud.check.view', 'bud.check.approve'],
  DIR: ['bud.ledger.view', 'bud.ledger.export', 'bud.check.use', 'bud.check.view', 'bud.check.approve'],
  COMMGR: ['bud.ledger.view', 'bud.check.use', 'bud.check.view'],
  QS: ['bud.ledger.view', 'bud.check.use'],
  CM: ['bud.ledger.view', 'bud.check.use'],
  SE: ['bud.check.use'],
  PLAN: ['bud.ledger.view', 'bud.check.use'],
  PROCMGR: ['bud.check.use'],
  STOREMGR: ['bud.check.use'],
};
const ADDED_12_02 = {
  PCMGR: ['bud.change.view', 'bud.change.create', 'bud.change.edit', 'bud.change.delete', 'bud.change.submit', 'bud.change.approve', 'bud.change.cancel', 'bud.change.amend', 'bud.change.print', 'bud.change.export'],
  PM: ['bud.change.view', 'bud.change.create', 'bud.change.edit', 'bud.change.delete', 'bud.change.submit', 'bud.change.approve', 'bud.change.cancel', 'bud.change.amend', 'bud.change.print', 'bud.change.export'],
  PD: ['bud.change.view', 'bud.change.approve', 'bud.change.print', 'bud.change.export'],
  DIR: ['bud.change.view', 'bud.change.approve', 'bud.change.print', 'bud.change.export'],
  QS: ['bud.change.view'],
  COMMGR: ['bud.change.view', 'bud.change.print', 'bud.change.export'],
};
const ADDED_12_01 = {
  PCMGR: ['bud.budget.view', 'bud.budget.create', 'bud.budget.edit', 'bud.budget.delete', 'bud.budget.submit', 'bud.budget.approve', 'bud.budget.cancel', 'bud.budget.amend', 'bud.budget.print', 'bud.budget.export'],
  QS: ['bud.budget.view', 'bud.budget.create', 'bud.budget.edit', 'bud.budget.delete', 'bud.budget.submit', 'bud.budget.cancel', 'bud.budget.amend', 'bud.budget.print', 'bud.budget.export'],
  PM: ['bud.budget.view', 'bud.budget.approve', 'bud.budget.print', 'bud.budget.export'],
  PD: ['bud.budget.view', 'bud.budget.approve', 'bud.budget.print', 'bud.budget.export'],
  DIR: ['bud.budget.view', 'bud.budget.approve', 'bud.budget.print', 'bud.budget.export'],
  CM: ['bud.budget.view'],
  COMMGR: ['bud.budget.view', 'bud.budget.print', 'bud.budget.export'],
  PLAN: ['bud.budget.view'],
};
const ADDED_11_04 = {
  DESIGN: ['engg.deliverable.view', 'engg.deliverable.create', 'engg.deliverable.edit', 'engg.deliverable.delete', 'engg.deliverable.submit', 'engg.deliverable.cancel', 'engg.deliverable.amend', 'engg.deliverable.print', 'engg.deliverable.export', 'engg.deliverable.approve', 'engg.vdr_item.view', 'engg.vdr_item.create', 'engg.vdr_item.edit', 'engg.vdr_item.delete', 'engg.vdr_item.submit', 'engg.vdr_item.cancel', 'engg.vdr_item.amend', 'engg.vdr_item.print', 'engg.vdr_item.export', 'engg.vdr_item.approve'],
  PLAN: ['engg.deliverable.view', 'engg.deliverable.create', 'engg.deliverable.edit', 'engg.deliverable.delete', 'engg.deliverable.submit', 'engg.deliverable.cancel', 'engg.deliverable.amend', 'engg.deliverable.print', 'engg.deliverable.export', 'engg.vdr_item.view', 'engg.vdr_item.create', 'engg.vdr_item.edit', 'engg.vdr_item.delete', 'engg.vdr_item.submit', 'engg.vdr_item.cancel', 'engg.vdr_item.amend', 'engg.vdr_item.print', 'engg.vdr_item.export'],
  PM: ['engg.deliverable.view', 'engg.deliverable.print', 'engg.deliverable.export', 'engg.vdr_item.view', 'engg.vdr_item.print', 'engg.vdr_item.export'],
  PD: ['engg.deliverable.view', 'engg.deliverable.print', 'engg.vdr_item.view'],
  CM: ['engg.deliverable.view', 'engg.deliverable.print', 'engg.vdr_item.view'],
  DOC: ['engg.deliverable.view', 'engg.deliverable.print'],
  QS: ['engg.deliverable.view'],
  PCMGR: ['engg.deliverable.view', 'engg.deliverable.export'],
  DIR: ['engg.deliverable.view', 'engg.deliverable.print', 'engg.deliverable.export', 'engg.vdr_item.view'],
};
const ADDED_11_03 = {
  QCE: ['engg.submittal.view', 'engg.submittal.create', 'engg.submittal.edit', 'engg.submittal.delete', 'engg.submittal.submit', 'engg.submittal.cancel', 'engg.submittal.print'],
  DESIGN: ['engg.submittal.view', 'engg.submittal.create', 'engg.submittal.edit', 'engg.submittal.delete', 'engg.submittal.submit', 'engg.submittal.cancel', 'engg.submittal.amend', 'engg.submittal.print', 'engg.submittal.export', 'engg.submittal.respond'],
  SE: ['engg.submittal.view', 'engg.submittal.create', 'engg.submittal.edit', 'engg.submittal.delete', 'engg.submittal.submit', 'engg.submittal.cancel', 'engg.submittal.print'],
  QCMGR: ['engg.submittal.view', 'engg.submittal.create', 'engg.submittal.edit', 'engg.submittal.submit', 'engg.submittal.approve', 'engg.submittal.cancel', 'engg.submittal.amend', 'engg.submittal.print', 'engg.submittal.export', 'engg.submittal.respond'],
  CM: ['engg.submittal.view', 'engg.submittal.create', 'engg.submittal.edit', 'engg.submittal.submit', 'engg.submittal.approve', 'engg.submittal.cancel', 'engg.submittal.amend', 'engg.submittal.print'],
  PM: ['engg.submittal.view', 'engg.submittal.approve', 'engg.submittal.print', 'engg.submittal.export'],
  PD: ['engg.submittal.view', 'engg.submittal.print'],
  PLAN: ['engg.submittal.view'],
  QS: ['engg.submittal.view'],
  DOC: ['engg.submittal.view', 'engg.submittal.print'],
  PCMGR: ['engg.submittal.view', 'engg.submittal.export'],
  DIR: ['engg.submittal.view', 'engg.submittal.print', 'engg.submittal.export'],
};
const ADDED_11_02 = {
  SE: ['engg.rfi.view', 'engg.rfi.create', 'engg.rfi.edit', 'engg.rfi.delete', 'engg.rfi.submit', 'engg.rfi.cancel', 'engg.rfi.print'],
  CM: ['engg.rfi.view', 'engg.rfi.create', 'engg.rfi.edit', 'engg.rfi.delete', 'engg.rfi.submit', 'engg.rfi.approve', 'engg.rfi.cancel', 'engg.rfi.amend', 'engg.rfi.print'],
  DESIGN: ['engg.rfi.view', 'engg.rfi.create', 'engg.rfi.edit', 'engg.rfi.submit', 'engg.rfi.approve', 'engg.rfi.cancel', 'engg.rfi.amend', 'engg.rfi.print', 'engg.rfi.export', 'engg.rfi.respond'],
  DOC: ['engg.rfi.view', 'engg.rfi.print'],
  PM: ['engg.rfi.view', 'engg.rfi.print', 'engg.rfi.export'],
  PD: ['engg.rfi.view', 'engg.rfi.print'],
  PLAN: ['engg.rfi.view'],
  QS: ['engg.rfi.view'],
  PCMGR: ['engg.rfi.view', 'engg.rfi.export'],
  DIR: ['engg.rfi.view', 'engg.rfi.print', 'engg.rfi.export'],
};
const ADDED_11_01 = {
  QCE: ['engg.drawing.view'],
  QCMGR: ['engg.drawing.view', 'engg.drawing.print'],
  DOC: ['engg.drawing.view', 'engg.drawing.create', 'engg.drawing.edit', 'engg.drawing.delete', 'engg.drawing.submit', 'engg.drawing.cancel', 'engg.drawing.amend', 'engg.drawing.print', 'engg.drawing.export', 'engg.drawing.distribute', 'engg.transmittal.view', 'engg.transmittal.create', 'engg.transmittal.edit', 'engg.transmittal.delete', 'engg.transmittal.submit', 'engg.transmittal.cancel', 'engg.transmittal.amend', 'engg.transmittal.print', 'engg.transmittal.export', 'engg.transmittal.respond'],
  DESIGN: ['engg.drawing.view', 'engg.drawing.create', 'engg.drawing.edit', 'engg.drawing.approve', 'engg.drawing.cancel', 'engg.drawing.amend', 'engg.drawing.print', 'engg.drawing.export', 'engg.drawing.distribute', 'engg.transmittal.view', 'engg.transmittal.create', 'engg.transmittal.edit', 'engg.transmittal.submit', 'engg.transmittal.approve', 'engg.transmittal.cancel', 'engg.transmittal.amend', 'engg.transmittal.print', 'engg.transmittal.export', 'engg.transmittal.respond'],
  PM: ['engg.drawing.view', 'engg.drawing.approve', 'engg.drawing.print', 'engg.drawing.export', 'engg.drawing.distribute', 'engg.transmittal.view', 'engg.transmittal.print', 'engg.transmittal.export'],
  PD: ['engg.drawing.view', 'engg.drawing.print', 'engg.transmittal.view', 'engg.transmittal.print'],
  CM: ['engg.drawing.view', 'engg.drawing.print', 'engg.drawing.distribute', 'engg.transmittal.view'],
  SE: ['engg.drawing.view'],
  PLAN: ['engg.drawing.view'],
  QS: ['engg.drawing.view'],
  PCMGR: ['engg.drawing.view', 'engg.drawing.print', 'engg.drawing.export', 'engg.transmittal.view', 'engg.transmittal.export'],
  DIR: ['engg.drawing.view', 'engg.drawing.print', 'engg.drawing.export', 'engg.transmittal.view', 'engg.transmittal.print', 'engg.transmittal.export'],
};
const ADDED_10_08 = {
  PM: ['proj.p360.view', 'proj.p360.export'],
  PD: ['proj.p360.view', 'proj.p360.export'],
  PCMGR: ['proj.p360.view', 'proj.p360.export'],
  DIR: ['proj.p360.view', 'proj.p360.export'],
  PLAN: ['proj.p360.view'],
  SE: ['proj.p360.view'],
  COMMGR: ['proj.p360.view'],
  QS: ['proj.p360.view'],
};
const ADDED_10_07 = {
  PM: ['proj.gis.view', 'proj.gis.create', 'proj.gis.edit', 'proj.gis.delete', 'proj.gis.submit', 'proj.gis.approve', 'proj.gis.cancel', 'proj.gis.print', 'proj.gis.export', 'proj.gis.import', 'proj.gis.progress'],
  PD: ['proj.gis.view', 'proj.gis.approve', 'proj.gis.print', 'proj.gis.export'],
  PCMGR: ['proj.gis.view', 'proj.gis.print', 'proj.gis.export'],
  PLAN: ['proj.gis.view', 'proj.gis.create', 'proj.gis.edit', 'proj.gis.delete', 'proj.gis.submit', 'proj.gis.cancel', 'proj.gis.print', 'proj.gis.export', 'proj.gis.import', 'proj.gis.progress'],
  SE: ['proj.gis.view', 'proj.gis.create', 'proj.gis.edit', 'proj.gis.delete', 'proj.gis.submit', 'proj.gis.cancel', 'proj.gis.print', 'proj.gis.import', 'proj.gis.progress'],
  COMMGR: ['proj.gis.view', 'proj.gis.print'],
  DIR: ['proj.gis.view', 'proj.gis.print'],
  QS: ['proj.gis.view', 'proj.gis.print'],
};
const ADDED_10_06 = {
  PM: ['proj.risk.view', 'proj.risk.create', 'proj.risk.edit', 'proj.risk.delete', 'proj.risk.submit', 'proj.risk.approve', 'proj.risk.cancel', 'proj.risk.amend', 'proj.risk.print', 'proj.risk.export', 'proj.issue.view', 'proj.issue.create', 'proj.issue.edit', 'proj.issue.delete', 'proj.issue.submit', 'proj.issue.approve', 'proj.issue.cancel', 'proj.issue.amend', 'proj.issue.print', 'proj.issue.export'],
  PD: ['proj.risk.view', 'proj.risk.create', 'proj.risk.edit', 'proj.risk.submit', 'proj.risk.approve', 'proj.risk.print', 'proj.risk.export', 'proj.issue.view', 'proj.issue.create', 'proj.issue.edit', 'proj.issue.submit', 'proj.issue.approve', 'proj.issue.print', 'proj.issue.export'],
  PCMGR: ['proj.risk.view', 'proj.risk.create', 'proj.risk.edit', 'proj.risk.delete', 'proj.risk.submit', 'proj.risk.cancel', 'proj.risk.print', 'proj.risk.export', 'proj.issue.view', 'proj.issue.create', 'proj.issue.edit', 'proj.issue.delete', 'proj.issue.submit', 'proj.issue.cancel', 'proj.issue.print', 'proj.issue.export'],
  PLAN: ['proj.risk.view', 'proj.risk.create', 'proj.risk.edit', 'proj.risk.submit', 'proj.risk.print', 'proj.issue.view', 'proj.issue.create', 'proj.issue.edit', 'proj.issue.submit', 'proj.issue.print'],
  SE: ['proj.risk.view', 'proj.risk.create', 'proj.risk.edit', 'proj.risk.submit', 'proj.risk.print', 'proj.issue.view', 'proj.issue.create', 'proj.issue.edit', 'proj.issue.submit', 'proj.issue.print'],
  COMMGR: ['proj.risk.view', 'proj.risk.create', 'proj.risk.edit', 'proj.risk.submit', 'proj.risk.print', 'proj.issue.view', 'proj.issue.create', 'proj.issue.edit', 'proj.issue.submit', 'proj.issue.print'],
  DIR: ['proj.risk.view', 'proj.risk.print', 'proj.risk.export', 'proj.issue.view', 'proj.issue.print', 'proj.issue.export'],
};
const ADDED_10_05 = {
  PM: ['proj.meeting.view', 'proj.team.view', 'proj.stakeholder.view', 'proj.action.update', 'proj.meeting.print', 'proj.meeting.create', 'proj.meeting.edit', 'proj.meeting.delete', 'proj.meeting.submit', 'proj.meeting.cancel', 'proj.meeting.amend', 'proj.meeting.export', 'proj.meeting.approve', 'proj.team.manage', 'proj.stakeholder.manage', 'proj.stakeholder.contact', 'proj.stakeholder.export'],
  PD: ['proj.meeting.view', 'proj.team.view', 'proj.stakeholder.view', 'proj.action.update', 'proj.meeting.print', 'proj.meeting.approve', 'proj.meeting.export', 'proj.stakeholder.contact', 'proj.stakeholder.export'],
  PCMGR: ['proj.meeting.view', 'proj.team.view', 'proj.stakeholder.view', 'proj.action.update', 'proj.meeting.print', 'proj.meeting.create', 'proj.meeting.edit', 'proj.meeting.delete', 'proj.meeting.submit', 'proj.meeting.cancel', 'proj.meeting.amend', 'proj.meeting.export', 'proj.team.manage', 'proj.stakeholder.manage', 'proj.stakeholder.contact', 'proj.stakeholder.export'],
  PLAN: ['proj.meeting.view', 'proj.team.view', 'proj.stakeholder.view', 'proj.action.update', 'proj.meeting.print', 'proj.meeting.create', 'proj.meeting.edit', 'proj.meeting.delete', 'proj.meeting.submit', 'proj.meeting.cancel', 'proj.meeting.amend', 'proj.meeting.export'], SE: ['proj.meeting.view', 'proj.team.view', 'proj.stakeholder.view', 'proj.action.update', 'proj.meeting.print', 'proj.meeting.create', 'proj.meeting.edit', 'proj.meeting.submit'], QS: ['proj.meeting.view', 'proj.team.view', 'proj.stakeholder.view', 'proj.action.update', 'proj.meeting.print', 'proj.meeting.create', 'proj.meeting.edit', 'proj.meeting.submit'],
  COMMGR: ['proj.meeting.view', 'proj.team.view', 'proj.stakeholder.view', 'proj.action.update', 'proj.meeting.print', 'proj.stakeholder.contact'], DIR: ['proj.meeting.view', 'proj.team.view', 'proj.stakeholder.view', 'proj.action.update', 'proj.meeting.print', 'proj.meeting.approve', 'proj.stakeholder.contact', 'proj.stakeholder.export', 'proj.meeting.export'],
};
const ADDED_10_04 = {
  QS: ['proj.version.view', 'proj.version.create', 'proj.version.edit', 'proj.version.delete', 'proj.version.submit', 'proj.version.cancel', 'proj.version.print', 'proj.version.export', 'proj.boq.map', 'proj.boq.import', 'proj.boq.rates', 'proj.version.approve', 'proj.version.amend'],
  EST: ['proj.version.view', 'proj.version.create', 'proj.version.edit', 'proj.version.delete', 'proj.version.submit', 'proj.version.cancel', 'proj.version.print', 'proj.version.export', 'proj.boq.map', 'proj.boq.import', 'proj.boq.rates'],
  COMMGR: ['proj.version.view', 'proj.version.approve', 'proj.version.print', 'proj.version.export', 'proj.boq.rates'],
  PM: ['proj.version.view', 'proj.version.approve', 'proj.version.amend', 'proj.version.print', 'proj.version.export', 'proj.boq.map', 'proj.boq.rates'],
  PCMGR: ['proj.version.view', 'proj.version.print', 'proj.version.export', 'proj.boq.rates'],
  PD: ['proj.version.view', 'proj.version.print', 'proj.version.export', 'proj.boq.rates'], DIR: ['proj.version.view', 'proj.version.print', 'proj.version.export', 'proj.boq.rates'],
  PLAN: ['proj.version.view', 'proj.version.print'], SE: ['proj.version.view'],
};
const ADDED_10_03 = {
  PLAN: ['proj.wbs.view', 'proj.wbs.manage', 'proj.wbs.change', 'proj.wbs.approve', 'proj.wbs.export', 'proj.wbs.import'],
  PCMGR: ['proj.wbs.view', 'proj.wbs.manage', 'proj.wbs.baseline', 'proj.wbs.change', 'proj.wbs.approve', 'proj.wbs.export', 'proj.wbs.import'],
  PM: ['proj.wbs.view', 'proj.wbs.baseline', 'proj.wbs.change', 'proj.wbs.approve', 'proj.wbs.export'],
  PD: ['proj.wbs.view', 'proj.wbs.export'],
  SE: ['proj.wbs.view'], QS: ['proj.wbs.view', 'proj.wbs.export'], EST: ['proj.wbs.view'], COMMGR: ['proj.wbs.view'], DIR: ['proj.wbs.view', 'proj.wbs.export'],
};
const ADDED_10_02 = {
  EST: ['proj.baseline_pack.view', 'proj.baseline_pack.create', 'proj.baseline_pack.edit', 'proj.baseline_pack.submit', 'proj.baseline_pack.approve', 'proj.baseline_pack.print', 'proj.baseline_pack.export', 'proj.baseline_pack.cost', 'proj.handover.manage'],
  COMMGR: ['proj.baseline_pack.view', 'proj.baseline_pack.create', 'proj.baseline_pack.edit', 'proj.baseline_pack.submit', 'proj.baseline_pack.approve', 'proj.baseline_pack.amend', 'proj.baseline_pack.print', 'proj.baseline_pack.export', 'proj.baseline_pack.cost', 'proj.handover.manage'],
  PD: ['proj.baseline_pack.view', 'proj.baseline_pack.create', 'proj.baseline_pack.edit', 'proj.baseline_pack.submit', 'proj.baseline_pack.approve', 'proj.baseline_pack.cancel', 'proj.baseline_pack.amend', 'proj.baseline_pack.print', 'proj.baseline_pack.export', 'proj.baseline_pack.cost', 'proj.handover.manage'],
  PCMGR: ['proj.baseline_pack.view', 'proj.baseline_pack.create', 'proj.baseline_pack.edit', 'proj.baseline_pack.delete', 'proj.baseline_pack.submit', 'proj.baseline_pack.cancel', 'proj.baseline_pack.print', 'proj.handover.manage'],
  PM: ['proj.baseline_pack.view', 'proj.baseline_pack.print', 'proj.handover.manage'],
  DIR: ['proj.baseline_pack.view', 'proj.baseline_pack.approve', 'proj.baseline_pack.cancel', 'proj.baseline_pack.print', 'proj.baseline_pack.export', 'proj.baseline_pack.cost'],
};
const ADDED_10_01 = {
  PCMGR: ['proj.project.view', 'proj.project.create', 'proj.project.edit', 'proj.project.delete', 'proj.project.submit', 'proj.project.cancel', 'proj.project.amend', 'proj.project.print', 'proj.project.export', 'proj.project.view_all', 'proj.project.transition', 'proj.project.import', 'proj.milestone.manage'],
  PD: ['proj.project.view', 'proj.project.create', 'proj.project.edit', 'proj.project.delete', 'proj.project.submit', 'proj.project.cancel', 'proj.project.amend', 'proj.project.print', 'proj.project.export', 'proj.project.view_all', 'proj.project.transition', 'proj.project.import', 'proj.milestone.manage', 'proj.project.approve'],
  PM: ['proj.project.view', 'proj.project.edit', 'proj.project.amend', 'proj.project.print', 'proj.project.transition', 'proj.milestone.manage'],
  DIR: ['proj.project.view', 'proj.project.view_all', 'proj.project.approve', 'proj.project.transition', 'proj.project.print', 'proj.project.export'],
};
const ADDED_09_03 = {
  EST: ['est.review.view', 'est.bid.edit', 'est.boq.export'],
  COMMGR: ['est.review.view', 'est.review.perform', 'est.boq.export', 'est.estimate.approve'],
  DIR: ['est.review.view', 'est.review.perform', 'est.bid.approve', 'est.boq.export'],
  QS: ['est.review.view'],
};
const ADDED_09_02 = {
  EST: ['est.takeoff.view', 'est.takeoff.create', 'est.takeoff.edit', 'est.takeoff.delete', 'est.takeoff.submit', 'est.takeoff.cancel', 'est.takeoff.amend', 'est.takeoff.print', 'est.takeoff.export', 'est.takeoff.import', 'est.bb.view', 'est.bb.create', 'est.bb.edit', 'est.bb.delete', 'est.bb.submit', 'est.bb.cancel', 'est.bb.amend', 'est.bb.print', 'est.bb.export', 'est.bb.import'],
  QS: ['est.takeoff.view', 'est.takeoff.create', 'est.takeoff.edit', 'est.takeoff.delete', 'est.takeoff.submit', 'est.takeoff.cancel', 'est.takeoff.amend', 'est.takeoff.print', 'est.takeoff.export', 'est.takeoff.import', 'est.bb.view', 'est.bb.create', 'est.bb.edit', 'est.bb.delete', 'est.bb.submit', 'est.bb.cancel', 'est.bb.amend', 'est.bb.print', 'est.bb.export', 'est.bb.import', 'est.takeoff.approve', 'est.bb.approve'],
  SE: ['est.takeoff.view', 'est.takeoff.create', 'est.takeoff.edit', 'est.takeoff.delete', 'est.takeoff.submit', 'est.takeoff.cancel', 'est.takeoff.amend', 'est.takeoff.print', 'est.takeoff.export', 'est.takeoff.import', 'est.bb.view', 'est.bb.create', 'est.bb.edit', 'est.bb.delete', 'est.bb.submit', 'est.bb.cancel', 'est.bb.amend', 'est.bb.print', 'est.bb.export', 'est.bb.import'],
  PM: ['est.takeoff.view', 'est.takeoff.approve', 'est.takeoff.print', 'est.takeoff.export', 'est.bb.view', 'est.bb.approve', 'est.bb.print', 'est.bb.export'],
  DESIGN: ['est.takeoff.view', 'est.takeoff.approve', 'est.takeoff.print', 'est.takeoff.export', 'est.bb.view', 'est.bb.approve', 'est.bb.print', 'est.bb.export'],
  DIR: ['est.takeoff.view', 'est.takeoff.print', 'est.takeoff.export', 'est.bb.view', 'est.bb.print', 'est.bb.export'],
  COMMGR: ['est.takeoff.view', 'est.bb.view'],
};
const ADDED_09_01 = {
  EST: ['est.estimate.view', 'est.estimate.create', 'est.estimate.edit', 'est.estimate.delete', 'est.estimate.submit', 'est.estimate.approve', 'est.estimate.cancel', 'est.estimate.amend', 'est.estimate.print', 'est.estimate.export', 'est.estimate.view_all', 'est.estimate.cost', 'est.estimate.import'],
  DIR: ['est.estimate.view', 'est.estimate.view_all', 'est.estimate.cost', 'est.estimate.approve', 'est.estimate.print', 'est.estimate.export'],
  COMMGR: ['est.estimate.view', 'est.estimate.view_all', 'est.estimate.cost', 'est.estimate.print', 'est.estimate.export'],
  QS: ['est.estimate.view', 'est.estimate.print', 'est.estimate.export'],
  PM: ['est.estimate.view', 'est.estimate.print'],
};
const ADDED_04_09 = {
  SYSADM: OWNERS_04_09, ITADM: ['alr.rule.view', 'alr.alert.view'], AUD: ['alr.rule.view', 'alr.alert.view'], DIR: OWNERS_04_09, PD: OWNERS_04_09, PM: OWNERS_04_09, CFO: OWNERS_04_09, PROCMGR: OWNERS_04_09, COMMGR: OWNERS_04_09, HRMGR: OWNERS_04_09,
};
const ADDED_04_07 = {
  ITADM: ['comm.channel.view', 'comm.channel.edit', 'comm.log.view', 'comm.consent.view', 'comm.consent.edit'],
  SYSADM: ['comm.channel.view', 'comm.log.view', 'comm.consent.view', 'comm.consent.edit'],
  AUD: ['comm.channel.view', 'comm.log.view', 'comm.consent.view'], DIR: ['comm.consent.view'],
  PROCMGR: ['comm.consent.view', 'comm.consent.edit'], COMMGR: ['comm.consent.view', 'comm.consent.edit'], HRMGR: ['comm.consent.view', 'comm.consent.edit'],
};
// Part 04.06. The system administrator writes the templates of notifications (a new version is approved by the IT administrator); the IT administrator reads the templates and the
// delivery log and may retry a failed delivery; everyone has their own notifications and preferences without a permission.
const ADDED_04_06 = { SYSADM: ['ntf.template.view', 'ntf.template.edit'], ITADM: ['ntf.template.view', 'ntf.delivery.view', 'ntf.delivery.retry'], AUD: ['ntf.delivery.view'] };
// Part 04.05. Project managers and directors, the HR manager and the system administrator keep the RACI of the scopes they hold (a change of a live project is approved by the
// project manager and then the project director); the people who watch the business read the ledger and the report; everyone has their own view without a permission.
const ADDED_04_05 = {
  SYSADM: ['acc.raci.view', 'acc.raci.maintain', 'acc.ledger.view', 'acc.report.view'],
  PD: ['acc.raci.view', 'acc.raci.maintain', 'acc.ledger.view', 'acc.report.view'], PM: ['acc.raci.view', 'acc.raci.maintain', 'acc.ledger.view', 'acc.report.view'],
  HRMGR: ['acc.raci.view', 'acc.raci.maintain', 'acc.ledger.view', 'acc.report.view'],
  DIR: ['acc.raci.view', 'acc.ledger.view', 'acc.report.view'], AUD: ['acc.raci.view', 'acc.ledger.view', 'acc.report.view'],
  PCMGR: ['acc.raci.view', 'acc.report.view'], CFO: ['acc.raci.view', 'acc.report.view'],
};
// Part 04.04. The system administrator and the process owners configure controls and reason codes (changes of a control in ENFORCE mode go through an approval chain);
// the roles that watch the business read the register and the dashboard; every internal role may raise an exception where a control blocks it, and the roles that
// run the site and the company may raise an emergency exception that is regularised afterwards.
const ADDED_04_04 = {
  SYSADM: ['eng.pcs.view', 'eng.pcs.manage', 'eng.pcs.emergency'],
  ITADM: ['eng.pcs.view'],
  DIR: ['eng.pcs.view', 'eng.pcs.emergency'], CFO: ['eng.pcs.view'], AUD: ['eng.pcs.view'], PCMGR: ['eng.pcs.view'], PD: ['eng.pcs.view', 'eng.pcs.emergency'], PM: ['eng.pcs.view', 'eng.pcs.emergency'],
  ACCMGR: ['eng.pcs.view'], PROCMGR: ['eng.pcs.view'], HRMGR: ['eng.pcs.view'], QCMGR: ['eng.pcs.view'], STOREMGR: ['eng.pcs.view'], COMMGR: ['eng.pcs.view'], HSEMGR: ['eng.pcs.view'],
};
// Part 04.01. The system administrator defines workflows (the maker; activation needs the process owner and the IT administrator), cancels instances
// and resolves tasks nobody could be found for; the IT administrator validates and resolves tasks; the auditor and the director read every instance.
const ADDED_04_01 = {
  SYSADM: ['eng.workflow.view', 'eng.workflow.define', 'eng.workflow.cancel', 'eng.workflow.admin'],
  ITADM: ['eng.workflow.view', 'eng.workflow.admin'],
  DIR: ['eng.workflow.view', 'eng.workflow.cancel'],
  AUD: ['eng.workflow.view'],
  PROCMGR: ['eng.workflow.view'],
  PCMGR: ['eng.workflow.view'],
};
const USES_SAMPLE_DOCS = new Set(['SYSADM', 'ITADM', 'DIR', 'CFO', 'ACCMGR', 'PROCMGR', 'PCMGR', 'PD', 'PM', 'CM', 'SE', 'SK', 'QS', 'EST', 'PLAN', 'DOC']);
// Part 03.03. Managers may share saved list views with a role or a project; everyone keeps personal views.
const SHARES_VIEWS = new Set(['SYSADM', 'PM', 'PD', 'PCMGR', 'ACCMGR', 'CFO', 'HRMGR', 'DIR']);
const internalRole = (code, category) => category !== EXT && code !== 'EMP' && code !== 'GUARD';

function permissionsOfTemplate(code, category) {
  const extra = [...(ADDED_24_04[code] ?? []), ...(ADDED_24_03[code] ?? []), ...(ADDED_24_02[code] ?? []), ...(ADDED_24_01[code] ?? []), ...(ADDED_23_15[code] ?? []), ...(ADDED_23_14[code] ?? []), ...(ADDED_23_13[code] ?? []), ...(ADDED_23_12[code] ?? []), ...(ADDED_23_11[code] ?? []), ...(ADDED_23_10[code] ?? []), ...(ADDED_23_09[code] ?? []), ...(ADDED_23_08[code] ?? []), ...(ADDED_23_07[code] ?? []), ...(ADDED_23_06[code] ?? []), ...(ADDED_23_05[code] ?? []), ...(ADDED_23_04[code] ?? []), ...(ADDED_23_03[code] ?? []), ...(ADDED_23_02[code] ?? []), ...(ADDED_23_01[code] ?? []), ...(ADDED_07_14[code] ?? []), ...(ADDED_22_09[code] ?? []), ...(ADDED_22_08[code] ?? []), ...(ADDED_22_07[code] ?? []), ...(ADDED_22_06[code] ?? []), ...(ADDED_22_05[code] ?? []), ...(ADDED_22_04[code] ?? []), ...(ADDED_22_03[code] ?? []), ...(ADDED_22_02[code] ?? []), ...(ADDED_22_01[code] ?? []), ...(ADDED_21_07[code] ?? []), ...(ADDED_21_06[code] ?? []), ...(ADDED_21_05[code] ?? []), ...(ADDED_21_04[code] ?? []), ...(ADDED_21_03[code] ?? []), ...(ADDED_21_02[code] ?? []), ...(ADDED_21_01[code] ?? []), ...(ADDED_20_03[code] ?? []), ...(ADDED_20_02[code] ?? []), ...(ADDED_20_01[code] ?? []), ...(ADDED_19_08[code] ?? []), ...(ADDED_19_07[code] ?? []), ...(ADDED_19_06[code] ?? []), ...(ADDED_19_05[code] ?? []), ...(ADDED_19_04[code] ?? []), ...(ADDED_19_03[code] ?? []), ...(ADDED_19_02[code] ?? []), ...(ADDED_19_01[code] ?? []), ...(ADDED_18_07[code] ?? []), ...(ADDED_18_06[code] ?? []), ...(ADDED_18_05[code] ?? []), ...(ADDED_18_04[code] ?? []), ...(ADDED_18_03[code] ?? []), ...(ADDED_18_02[code] ?? []), ...(ADDED_18_01[code] ?? []), ...(ADDED_17_08[code] ?? []), ...(ADDED_17_07[code] ?? []), ...(ADDED_17_06[code] ?? []), ...(ADDED_17_05[code] ?? []), ...(ADDED_17_04[code] ?? []), ...(ADDED_17_03[code] ?? []), ...(ADDED_17_02[code] ?? []), ...(ADDED_17_01[code] ?? []), ...(ADDED_16_11[code] ?? []), ...(ADDED_16_10[code] ?? []), ...(ADDED_16_09[code] ?? []), ...(ADDED_16_08[code] ?? []), ...(ADDED_16_07[code] ?? []), ...(ADDED_02_05[code] ?? []), ...(ADDED_04_01[code] ?? []), ...(ADDED_04_02[code] ?? []), ...(ADDED_04_04[code] ?? []), ...(ADDED_04_05[code] ?? []), ...(ADDED_04_06[code] ?? []), ...(ADDED_04_07[code] ?? []), ...(ADDED_04_08[code] ?? []), ...(ADDED_04_09[code] ?? []), ...(ADDED_04_10[code] ?? []), ...(ADDED_04_11[code] ?? []), ...(ADDED_04_12[code] ?? []), ...(ADDED_04_13[code] ?? []), ...(ADDED_04_14[code] ?? []), ...(ADDED_04_15[code] ?? []), ...(ADDED_05_01[code] ?? []), ...(ADDED_05_03[code] ?? []), ...(ADDED_05_04[code] ?? []), ...(ADDED_05_05[code] ?? []), ...(ADDED_06_01[code] ?? []), ...(ADDED_06_02[code] ?? []), ...(ADDED_06_03[code] ?? []), ...(ADDED_06_04[code] ?? []), ...(ADDED_06_05[code] ?? []), ...(ADDED_06_06[code] ?? []), ...(ADDED_07_01[code] ?? []), ...(ADDED_07_02[code] ?? []), ...(ADDED_07_03[code] ?? []), ...(ADDED_07_04[code] ?? []), ...(ADDED_07_05[code] ?? []), ...(ADDED_07_06[code] ?? []), ...(ADDED_07_07[code] ?? []), ...(ADDED_07_08[code] ?? []), ...(ADDED_07_09[code] ?? []), ...(ADDED_07_10[code] ?? []), ...(ADDED_07_11[code] ?? []), ...(ADDED_07_12[code] ?? []), ...(ADDED_07_13[code] ?? []), ...(ADDED_08_01[code] ?? []), ...(ADDED_08_02[code] ?? []), ...(ADDED_08_03[code] ?? []), ...(ADDED_09_01[code] ?? []), ...(ADDED_09_02[code] ?? []), ...(ADDED_09_03[code] ?? []), ...(ADDED_11_05[code] ?? []), ...(ADDED_12_01[code] ?? []), ...(ADDED_12_02[code] ?? []), ...(ADDED_12_03[code] ?? []), ...(ADDED_12_04[code] ?? []), ...(ADDED_13_01[code] ?? []), ...(ADDED_13_02[code] ?? []), ...(ADDED_13_03[code] ?? []), ...(ADDED_13_04[code] ?? []), ...(ADDED_13_05[code] ?? []), ...(ADDED_14_01[code] ?? []), ...(ADDED_14_02[code] ?? []), ...(ADDED_14_03[code] ?? []), ...(ADDED_14_04[code] ?? []), ...(ADDED_14_05[code] ?? []), ...(ADDED_14_06[code] ?? []), ...(ADDED_14_07[code] ?? []), ...(ADDED_15_01[code] ?? []), ...(ADDED_16_01[code] ?? []), ...(ADDED_16_02[code] ?? []), ...(ADDED_16_03[code] ?? []), ...(ADDED_16_04[code] ?? []), ...(ADDED_16_05[code] ?? []), ...(ADDED_16_06[code] ?? []), ...(ADDED_15_10[code] ?? []), ...(ADDED_15_09[code] ?? []), ...(ADDED_15_08[code] ?? []), ...(ADDED_15_07[code] ?? []), ...(ADDED_15_06[code] ?? []), ...(ADDED_15_05[code] ?? []), ...(ADDED_15_04[code] ?? []), ...(ADDED_15_03[code] ?? []), ...(ADDED_15_02[code] ?? []), ...(ADDED_11_04[code] ?? []), ...(ADDED_11_03[code] ?? []), ...(ADDED_11_02[code] ?? []), ...(ADDED_11_01[code] ?? []), ...(ADDED_10_08[code] ?? []), ...(ADDED_10_07[code] ?? []), ...(ADDED_10_06[code] ?? []), ...(ADDED_10_05[code] ?? []), ...(ADDED_10_04[code] ?? []), ...(ADDED_10_03[code] ?? []), ...(ADDED_10_02[code] ?? []), ...(ADDED_10_01[code] ?? []), ...(code === 'EMP' || internalRole(code, category) ? SELF_07_13 : []), ...(code === 'EMP' || internalRole(code, category) ? SELF_07_12 : []), ...(code === 'EMP' || internalRole(code, category) ? SELF_07_11 : []), ...(code === 'EMP' || internalRole(code, category) ? SELF_07_10 : []), ...(code === 'EMP' || internalRole(code, category) ? SELF_07_09 : []), 'att.punch.own', ...(internalRole(code, category) ? ['hr.employee.team.view'] : []), ...(internalRole(code, category) ? ['mdm.record.view'] : []), ...(internalRole(code, category) ? ['eng.pcs.raise'] : []), ...(internalRole(code, category) ? ['eng.delegation.use'] : []), ...(USES_SAMPLE_DOCS.has(code) ? ['eng.sample.use'] : []), ...(SHARES_VIEWS.has(code) ? PERMISSIONS_03_03 : []), ...(internalRole(code, category) ? ['iam.elevation.request'] : []), ...((category === HO || category === SITE || code === 'SUPADM') ? ['iam.review.decide'] : [])];
  if (code === 'SUPADM') return unique([...LEGACY_ROLE_PERMISSIONS.SYSADM, ...LEGACY_ROLE_PERMISSIONS.ITADM, ...PERMISSIONS_02_04, ...PERMISSIONS_02_05, ...PERMISSIONS_02_06, ...PERMISSIONS_02_07, ...PERMISSIONS_03_01, ...PERMISSIONS_03_03, ...PERMISSIONS_03_05, ...PERMISSIONS_03_07, ...PERMISSIONS_03_08, ...PERMISSIONS_03_09, ...PERMISSIONS_03_10, ...PERMISSIONS_04_01, ...PERMISSIONS_04_02, ...PERMISSIONS_04_04, ...PERMISSIONS_04_05, ...PERMISSIONS_04_06, ...PERMISSIONS_04_07, ...PERMISSIONS_04_08, ...PERMISSIONS_04_09, ...PERMISSIONS_04_10, ...PERMISSIONS_04_11, ...PERMISSIONS_04_12, ...PERMISSIONS_04_13]);
  if (code === 'AUD') return unique([...AUDITOR_READS, ...ADDED.AUD, ...extra]);
  if (LEGACY_ROLE_PERMISSIONS[code]) return unique([...LEGACY_ROLE_PERMISSIONS[code], ...(ADDED[code] ?? []), ...extra]);
  if (category === EXT) return [];
  if (code === 'EMP') return unique(extra);
  return unique(['org.view', ...extra]);
}

export const ROLE_TEMPLATES = Object.freeze(
  ROWS.map(([code, name, category, department, scope, responsibilities, authority]) =>
    Object.freeze({ code, name, category, department, scope, responsibilities, authority, clearance: CLEARANCE[code] ?? 'internal', owner: category === HO || category === SITE, permissions: Object.freeze(permissionsOfTemplate(code, category)) }),
  ),
);

/** code -> permissions, for an actor that carries no computed grants. */
export const TEMPLATE_PERMISSIONS = Object.freeze(Object.fromEntries(ROLE_TEMPLATES.map((t) => [t.code, t.permissions])));

/** Field masks the system roles carry by default: who sees a sensitive field in full (everyone else sees the field's own default rule). */
export const TEMPLATE_FIELD_MASKS = Object.freeze([
  { entity: 'iam_user', field: 'mobile', roles: ['SYSADM', 'HRMGR', 'SUPADM'], rule: 'show' },
  { entity: 'org_company', field: 'pan', roles: ['SYSADM', 'SUPADM'], rule: 'show' },
  // part 03.03: commercial values of the reference register are for the commercial roles; a system administrator sees them masked
  { entity: 'ui_sample_request', field: 'total', roles: ['PM', 'PD', 'PCMGR', 'ACCMGR', 'CFO', 'DIR', 'SUPADM'], rule: 'show' },
]);

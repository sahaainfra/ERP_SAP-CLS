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
export const PERMISSIONS_SINCE_LEGACY = Object.freeze([...PERMISSIONS_15_01, ...PERMISSIONS_14_07, ...PERMISSIONS_14_06, ...PERMISSIONS_14_05, ...PERMISSIONS_14_04, ...PERMISSIONS_14_03, ...PERMISSIONS_14_02, ...PERMISSIONS_14_01, ...PERMISSIONS_13_05, ...PERMISSIONS_13_04, ...PERMISSIONS_13_03, ...PERMISSIONS_13_02, ...PERMISSIONS_02_04, ...PERMISSIONS_02_05, ...PERMISSIONS_02_06, ...PERMISSIONS_02_07, ...PERMISSIONS_03_01, ...PERMISSIONS_03_03, ...PERMISSIONS_03_05, ...PERMISSIONS_03_07, ...PERMISSIONS_03_08, ...PERMISSIONS_03_09, ...PERMISSIONS_03_10, ...PERMISSIONS_04_01, ...PERMISSIONS_04_02, ...PERMISSIONS_04_04, ...PERMISSIONS_04_05, ...PERMISSIONS_04_06, ...PERMISSIONS_04_07, ...PERMISSIONS_04_08, ...PERMISSIONS_04_09, ...PERMISSIONS_04_10, ...PERMISSIONS_04_11, ...PERMISSIONS_04_12, ...PERMISSIONS_04_13, ...PERMISSIONS_04_14, ...PERMISSIONS_04_15, ...PERMISSIONS_05_01, ...PERMISSIONS_05_03, ...PERMISSIONS_05_04, ...PERMISSIONS_05_05, ...PERMISSIONS_06_01, ...PERMISSIONS_06_02, ...PERMISSIONS_06_03, ...PERMISSIONS_06_04, ...PERMISSIONS_06_05, ...PERMISSIONS_06_06, ...PERMISSIONS_07_01, ...PERMISSIONS_07_13, ...PERMISSIONS_08_01, ...PERMISSIONS_08_02, ...PERMISSIONS_08_03, ...PERMISSIONS_09_01, ...PERMISSIONS_09_02, ...PERMISSIONS_09_03, ...PERMISSIONS_11_05, ...PERMISSIONS_12_01, ...PERMISSIONS_12_02, ...PERMISSIONS_12_04, ...PERMISSIONS_13_01, ...PERMISSIONS_12_03, ...PERMISSIONS_11_04, ...PERMISSIONS_11_03, ...PERMISSIONS_11_02, ...PERMISSIONS_11_01, ...PERMISSIONS_10_08, ...PERMISSIONS_10_07, ...PERMISSIONS_10_06, ...PERMISSIONS_10_05, ...PERMISSIONS_10_04, ...PERMISSIONS_10_03, ...PERMISSIONS_10_02, ...PERMISSIONS_10_01, ...PERMISSIONS_07_12, ...PERMISSIONS_07_11, ...PERMISSIONS_07_10, ...PERMISSIONS_07_09, ...PERMISSIONS_07_08, ...PERMISSIONS_07_07, ...PERMISSIONS_07_06, ...PERMISSIONS_07_05, ...PERMISSIONS_07_04, ...PERMISSIONS_07_03, ...PERMISSIONS_07_02]);

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
  const extra = [...(ADDED_02_05[code] ?? []), ...(ADDED_04_01[code] ?? []), ...(ADDED_04_02[code] ?? []), ...(ADDED_04_04[code] ?? []), ...(ADDED_04_05[code] ?? []), ...(ADDED_04_06[code] ?? []), ...(ADDED_04_07[code] ?? []), ...(ADDED_04_08[code] ?? []), ...(ADDED_04_09[code] ?? []), ...(ADDED_04_10[code] ?? []), ...(ADDED_04_11[code] ?? []), ...(ADDED_04_12[code] ?? []), ...(ADDED_04_13[code] ?? []), ...(ADDED_04_14[code] ?? []), ...(ADDED_04_15[code] ?? []), ...(ADDED_05_01[code] ?? []), ...(ADDED_05_03[code] ?? []), ...(ADDED_05_04[code] ?? []), ...(ADDED_05_05[code] ?? []), ...(ADDED_06_01[code] ?? []), ...(ADDED_06_02[code] ?? []), ...(ADDED_06_03[code] ?? []), ...(ADDED_06_04[code] ?? []), ...(ADDED_06_05[code] ?? []), ...(ADDED_06_06[code] ?? []), ...(ADDED_07_01[code] ?? []), ...(ADDED_07_02[code] ?? []), ...(ADDED_07_03[code] ?? []), ...(ADDED_07_04[code] ?? []), ...(ADDED_07_05[code] ?? []), ...(ADDED_07_06[code] ?? []), ...(ADDED_07_07[code] ?? []), ...(ADDED_07_08[code] ?? []), ...(ADDED_07_09[code] ?? []), ...(ADDED_07_10[code] ?? []), ...(ADDED_07_11[code] ?? []), ...(ADDED_07_12[code] ?? []), ...(ADDED_07_13[code] ?? []), ...(ADDED_08_01[code] ?? []), ...(ADDED_08_02[code] ?? []), ...(ADDED_08_03[code] ?? []), ...(ADDED_09_01[code] ?? []), ...(ADDED_09_02[code] ?? []), ...(ADDED_09_03[code] ?? []), ...(ADDED_11_05[code] ?? []), ...(ADDED_12_01[code] ?? []), ...(ADDED_12_02[code] ?? []), ...(ADDED_12_03[code] ?? []), ...(ADDED_12_04[code] ?? []), ...(ADDED_13_01[code] ?? []), ...(ADDED_13_02[code] ?? []), ...(ADDED_13_03[code] ?? []), ...(ADDED_13_04[code] ?? []), ...(ADDED_13_05[code] ?? []), ...(ADDED_14_01[code] ?? []), ...(ADDED_14_02[code] ?? []), ...(ADDED_14_03[code] ?? []), ...(ADDED_14_04[code] ?? []), ...(ADDED_14_05[code] ?? []), ...(ADDED_14_06[code] ?? []), ...(ADDED_14_07[code] ?? []), ...(ADDED_15_01[code] ?? []), ...(ADDED_11_04[code] ?? []), ...(ADDED_11_03[code] ?? []), ...(ADDED_11_02[code] ?? []), ...(ADDED_11_01[code] ?? []), ...(ADDED_10_08[code] ?? []), ...(ADDED_10_07[code] ?? []), ...(ADDED_10_06[code] ?? []), ...(ADDED_10_05[code] ?? []), ...(ADDED_10_04[code] ?? []), ...(ADDED_10_03[code] ?? []), ...(ADDED_10_02[code] ?? []), ...(ADDED_10_01[code] ?? []), ...(code === 'EMP' || internalRole(code, category) ? SELF_07_13 : []), ...(code === 'EMP' || internalRole(code, category) ? SELF_07_12 : []), ...(code === 'EMP' || internalRole(code, category) ? SELF_07_11 : []), ...(code === 'EMP' || internalRole(code, category) ? SELF_07_10 : []), ...(code === 'EMP' || internalRole(code, category) ? SELF_07_09 : []), 'att.punch.own', ...(internalRole(code, category) ? ['hr.employee.team.view'] : []), ...(internalRole(code, category) ? ['mdm.record.view'] : []), ...(internalRole(code, category) ? ['eng.pcs.raise'] : []), ...(internalRole(code, category) ? ['eng.delegation.use'] : []), ...(USES_SAMPLE_DOCS.has(code) ? ['eng.sample.use'] : []), ...(SHARES_VIEWS.has(code) ? PERMISSIONS_03_03 : []), ...(internalRole(code, category) ? ['iam.elevation.request'] : []), ...((category === HO || category === SITE || code === 'SUPADM') ? ['iam.review.decide'] : [])];
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

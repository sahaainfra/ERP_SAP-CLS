import { workflowOf } from '../../platform/workflow/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { qaHelpers } from '../qa/common.js';
import { amountOf } from './clientbill.js';

// The QS management dashboard (part 22.08): one workspace for the quantity surveyor and the commercial manager. The chain executed -> measured -> certified -> billed -> collected in money per contract, the variations and claims in progress, what the subcontractors billed against what the client certified, the work not yet billed (WIP), the queues of work to do and the indicators of value leaking away. Every figure is read from the module that owns it (BR-01); nothing is stored here.
export const KPI = {
  workNotMeasured: 'Work done, not measured', measuredNotCertified: 'Measured, not certified', certifiedNotBilled: 'Certified, not billed', billedNotCollected: 'Billed, not collected',
  variationPipeline: 'Variations in the pipeline', claimsPending: 'Claims pending', overdueSubmission: 'Bills overdue for submission', unbilledWip: 'Unbilled work (WIP)',
};
export const QUEUE = { mbPending: 'Measurements waiting to be checked', billsToPrepare: 'Bills to prepare', certAwaited: 'Certifications awaited', deviationDue: 'Deviation statements due' };
export const LEAK = { certShortfall: 'Certified below the bill', disputed: 'Amount in dispute', mbCut: 'Measured quantity cut at approval', overdueSubmission: 'Bills not sent in time' };
export const DRILL = ['workNotMeasured', 'measuredNotCertified', 'certifiedNotBilled', 'unbilledWip', 'variationPipeline', 'claimsPending', 'overdueSubmission', 'billedNotCollected', 'mbPending', 'billsToPrepare', 'certAwaited', 'deviationDue'];
/** A bill approved but not sent to the client within this many days of the end of its period is overdue for submission; a bill sent and not certified within CERT_DAYS is a certification awaited. */
export const SUBMIT_DAYS = 7; export const CERT_DAYS = 30;
const rs = (p) => (p == null ? null : Math.round(p) / 100); const day = 86_400_000;

export function createQsDashService({ db, base, recon }) {
  const { may, param, audit } = base; const { gate, pcode } = qaHelpers({ db, base }); const today = () => todayIST(); const diff = (d) => Math.max(0, Math.round((Date.parse(`${today()}T00:00:00Z`) - Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`)) / day));
  /** The collections of the client (23.05 supplies them when it is live): the money received against the bills of a project; zero until then. */
  /** @type {(companyId: number, projectId: number) => number} */
  let collections = () => 0;
  const itemValue = (qty, rate) => Number(amountOf(Math.round(qty * 1000), rate ?? 0));
  const projectsOf = (actor, q) => db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => (q.projectId ? p.id === q.projectId : true) && may(actor, 'bill.qs_dashboard.view', p.id));

  /** The chain in money for one project, item by item. FR-01, BR-01: the quantities are those of the quantity reconciliation (22.02), the rates those of the BOQ. */
  function chainOf(companyId, pid) {
    const items = recon.chainRows(companyId, pid).map((r) => {
      const e = r.executed ?? 0; const m = r.measured ?? 0; const c = r.certified ?? 0; const b = r.billed ?? 0;
      return { code: r.code, description: r.description, uom: r.uom, executed: e, measured: m, certified: c, billed: b, rate: r.rate ?? 0,
        workNotMeasured: itemValue(Math.max(0, e - m), r.rate), measuredNotCertified: itemValue(Math.max(0, m - c), r.rate), certifiedNotBilled: itemValue(Math.max(0, c - b), r.rate),
        executedValue: itemValue(e, r.rate), billedValue: itemValue(b, r.rate), unbilledWip: itemValue(Math.max(0, e - b), r.rate) };
    });
    const sum = (k) => items.reduce((n, x) => n + x[k], 0);
    return { items, workNotMeasured: sum('workNotMeasured'), measuredNotCertified: sum('measuredNotCertified'), certifiedNotBilled: sum('certifiedNotBilled'), executedValue: sum('executedValue'), billedValue: sum('billedValue'), unbilledWip: sum('unbilledWip') };
  }
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const figuresOf = (actor, p) => {
    const c = actor.companyId; const ch = chainOf(c, p.id);
    const billed = one("SELECT COALESCE(SUM(net_paise), 0) AS n FROM bill_client_bills WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND status = 'APPROVED'", c, p.id).n;
    const cert = one("SELECT COALESCE(SUM(certified_gross_paise), 0) AS g, COALESCE(SUM(MAX(0, submitted_gross_paise - certified_gross_paise)), 0) AS cut, COALESCE(SUM(disputed_paise), 0) AS dis FROM bill_certifications WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND status = 'APPROVED'", c, p.id);
    const sub = one("SELECT COALESCE(SUM(gross_paise), 0) AS g FROM bill_sub_bills WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND status = 'APPROVED'", c, p.id).g;
    const vo = one("SELECT COUNT(*) AS n, COALESCE(SUM(value_claimed_paise), 0) AS v FROM ctr_change_requests WHERE company_id = ? AND org_project_id = ? AND kind = 'CLIENT' AND deleted_at IS NULL AND status <> 'CANCELLED' AND cr_state IN ('PREPARING', 'READY', 'WITH_CLIENT', 'DISPUTED')", c, p.id);
    const cl = one("SELECT COUNT(*) AS n, COALESCE(SUM(amount_claimed_paise), 0) AS v FROM ctr_claims WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND status <> 'CANCELLED' AND claim_state IN ('SUBMITTED', 'NEGOTIATION')", c, p.id);
    const od = one("SELECT COUNT(*) AS n, COALESCE(SUM(net_paise), 0) AS v FROM bill_client_bills WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND status = 'APPROVED' AND client_state = 'NOT_SENT' AND date(period_to, ?) < date(?)", c, p.id, `+${SUBMIT_DAYS} days`, today());
    const mbCut = db.prepare("SELECT e.qty_th, e.certified_qty_th, l.rate FROM bill_mb_entries e JOIN proj_boq_lines l ON l.id = e.boq_line_id WHERE e.company_id = ? AND e.org_project_id = ? AND e.deleted_at IS NULL AND e.status = 'APPROVED' AND e.certified_qty_th IS NOT NULL AND e.certified_qty_th < e.qty_th").all(c, p.id).reduce((n, x) => n + Number(amountOf(x.qty_th - x.certified_qty_th, x.rate ?? 0)), 0);
    const collected = collections(c, p.id) ?? 0;
    return { project: p, ch, billed, collected, billedNotCollected: Math.max(0, billed - collected), certifiedGross: cert.g, subBilled: sub, certCut: cert.cut, disputed: cert.dis, variations: { count: vo.n, value: vo.v }, claims: { count: cl.n, value: cl.v }, overdue: { count: od.n, value: od.v }, mbCut };
  };
  const toneOf = (v, red = false) => (v > 0 ? (red ? 'red' : 'amber') : 'green');

  const qs = {
    options(actor) { gate(actor, 'bill.qs_dashboard.view', 'see the QS dashboard'); return { projects: projectsOf(actor, {}).map((p) => ({ id: p.id, code: p.code, name: p.name })), kinds: DRILL.map((id) => ({ id, label: KPI[id] ?? QUEUE[id] })) }; },
    /** FR-01, FR-02: the tiles, the queues, the back-to-back margin and the indicators of value leakage for one project or for all the projects the person may see. */
    dashboard(actor, q = {}) {
      gate(actor, 'bill.qs_dashboard.view', 'see the QS dashboard'); const c = actor.companyId; const projects = projectsOf(actor, q); const marginOk = may(actor, 'bill.qs_dashboard.margin', q.projectId ?? undefined) || (!q.projectId && projects.some((p) => may(actor, 'bill.qs_dashboard.margin', p.id)));
      const fs = projects.map((p) => figuresOf(actor, p)); const sum = (f) => fs.reduce((n, x) => n + f(x), 0);
      const v = {
        workNotMeasured: sum((x) => x.ch.workNotMeasured), measuredNotCertified: sum((x) => x.ch.measuredNotCertified), certifiedNotBilled: sum((x) => x.ch.certifiedNotBilled), billedNotCollected: sum((x) => x.billedNotCollected),
        variationPipeline: sum((x) => x.variations.value), claimsPending: sum((x) => x.claims.value), overdueSubmission: sum((x) => x.overdue.count), unbilledWip: sum((x) => x.ch.unbilledWip),
      };
      const kpi = (key, value, unit, status, note, drill) => ({ key, label: KPI[key], value: unit === 'Rs' ? rs(value) : value, unit, status, note, drill });
      const kpis = [
        kpi('workNotMeasured', v.workNotMeasured, 'Rs', toneOf(v.workNotMeasured), null, '/bill/qty-recon'), kpi('measuredNotCertified', v.measuredNotCertified, 'Rs', toneOf(v.measuredNotCertified), null, '/bill/mb-entries?filter[status]=APPROVED'),
        kpi('certifiedNotBilled', v.certifiedNotBilled, 'Rs', toneOf(v.certifiedNotBilled), null, '/bill/client-bill-new'), kpi('billedNotCollected', v.billedNotCollected, 'Rs', toneOf(v.billedNotCollected), 'Receipts come from the receivables', '/bill/client-bills?filter[status]=APPROVED'),
        kpi('variationPipeline', v.variationPipeline, 'Rs', toneOf(v.variationPipeline), `${sum((x) => x.variations.count)} in progress`, '/ctr/variations'), kpi('claimsPending', v.claimsPending, 'Rs', toneOf(v.claimsPending), `${sum((x) => x.claims.count)} pending`, '/ctr/claims'),
        kpi('overdueSubmission', v.overdueSubmission, '', toneOf(v.overdueSubmission, true), `Rs ${rs(sum((x) => x.overdue.value))}`, '/bill/client-bills?filter[clientState]=NOT_SENT'), kpi('unbilledWip', v.unbilledWip, 'Rs', toneOf(v.unbilledWip), 'Executed value less billed value', '/bill/qty-recon'),
      ];
      const cert = sum((x) => x.certifiedGross); const subB = sum((x) => x.subBilled);
      const backToBack = { certified: rs(cert), subBilled: rs(subB), margin: marginOk ? rs(cert - subB) : null, marginPct: marginOk && cert > 0 ? Math.round(((cert - subB) * 1000) / cert) / 10 : null, masked: !marginOk, rows: fs.filter((x) => x.certifiedGross || x.subBilled).map((x) => ({ projectId: x.project.id, project: x.project.code, certified: rs(x.certifiedGross), subBilled: rs(x.subBilled), margin: marginOk ? rs(x.certifiedGross - x.subBilled) : null })) };
      const pids = projects.map((p) => p.id); const inP = pids.length ? `(${pids.map(() => '?').join(',')})` : '(NULL)';
      const mb = db.prepare(`SELECT id, doc_no, org_project_id, measured_on, qty_th FROM bill_mb_entries WHERE company_id = ? AND deleted_at IS NULL AND (status = 'SUBMITTED' OR (status = 'APPROVED' AND client_check_required = 1 AND check_status = 'NOT_CHECKED')) AND org_project_id IN ${inP} ORDER BY id LIMIT 200`).all(c, ...pids).map((x) => ({ id: x.id, ref: x.doc_no, project: pcode(x.org_project_id), ageDays: diff(x.measured_on), link: `/bill/mb-entries?id=${x.id}` }));
      const awaited = db.prepare(`SELECT b.id, b.bill_no, b.org_project_id, b.sent_on, b.net_paise FROM bill_client_bills b WHERE b.company_id = ? AND b.deleted_at IS NULL AND b.status = 'APPROVED' AND b.client_state = 'SENT' AND b.org_project_id IN ${inP} AND NOT EXISTS (SELECT 1 FROM bill_certifications k WHERE k.bill_id = b.id AND k.deleted_at IS NULL AND k.status NOT IN ('CANCELLED', 'REJECTED')) ORDER BY b.sent_on LIMIT 200`).all(c, ...pids).map((x) => ({ id: x.id, ref: x.bill_no, project: pcode(x.org_project_id), amount: rs(x.net_paise), ageDays: diff(x.sent_on), late: diff(x.sent_on) > CERT_DAYS, link: `/bill/client-bills?id=${x.id}` }));
      const open = new Set(db.prepare(`SELECT DISTINCT org_project_id AS p FROM bill_client_bills WHERE company_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND org_project_id IN ${inP}`).all(c, ...pids).map((x) => x.p));
      const toPrepare = fs.filter((x) => x.ch.certifiedNotBilled > 0 && !open.has(x.project.id)).map((x) => ({ projectId: x.project.id, ref: x.project.code, project: x.project.code, amount: rs(x.ch.certifiedNotBilled), link: `/bill/client-bill-new?projectId=${x.project.id}` }));
      const thr = Number(param(c, 'bill.deviation.threshold_pct') ?? 25); const stated = new Set(db.prepare(`SELECT DISTINCT org_project_id AS p FROM bill_deviation_statements WHERE company_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED') AND org_project_id IN ${inP}`).all(c, ...pids).map((x) => x.p));
      const devDue = fs.map((x) => ({ x, n: recon.chainRows(c, x.project.id).filter((r) => r.contract > 0 && Math.abs(((Math.max(r.contract, r.measured ?? 0, r.executed ?? 0) - r.contract) * 100) / r.contract) > thr).length })).filter((d) => d.n > 0 && !stated.has(d.x.project.id)).map((d) => ({ projectId: d.x.project.id, ref: d.x.project.code, project: d.x.project.code, items: d.n, link: `/bill/deviations?new=1&projectId=${d.x.project.id}` }));
      const queues = { mbPending: { label: QUEUE.mbPending, count: mb.length, rows: mb.slice(0, 20) }, billsToPrepare: { label: QUEUE.billsToPrepare, count: toPrepare.length, rows: toPrepare.slice(0, 20) }, certAwaited: { label: QUEUE.certAwaited, count: awaited.length, late: awaited.filter((a) => a.late).length, rows: awaited.slice(0, 20) }, deviationDue: { label: QUEUE.deviationDue, count: devDue.length, rows: devDue.slice(0, 20) } };
      const leakage = [{ key: 'certShortfall', label: LEAK.certShortfall, value: rs(sum((x) => x.certCut)), drill: '/bill/cert-analysis' }, { key: 'disputed', label: LEAK.disputed, value: rs(sum((x) => x.disputed)), drill: '/bill/cert-analysis' }, { key: 'mbCut', label: LEAK.mbCut, value: rs(sum((x) => x.mbCut)), drill: '/bill/mb-entries?filter[status]=APPROVED' }, { key: 'overdueSubmission', label: LEAK.overdueSubmission, value: rs(sum((x) => x.overdue.value)), drill: '/bill/client-bills?filter[clientState]=NOT_SENT' }].map((l) => ({ ...l, status: toneOf(l.value, l.key === 'overdueSubmission') }));
      const mine = (() => { try { return workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.filter((t) => String(t.instance?.docType ?? t.instance?.doc_type ?? '').startsWith('BILL_')).length; } catch { return 0; } })();
      const portfolio = fs.map((x) => ({ projectId: x.project.id, project: x.project.code, name: x.project.name, workNotMeasured: rs(x.ch.workNotMeasured), measuredNotCertified: rs(x.ch.measuredNotCertified), certifiedNotBilled: rs(x.ch.certifiedNotBilled), billedNotCollected: rs(x.billedNotCollected), unbilledWip: rs(x.ch.unbilledWip), variations: rs(x.variations.value), claims: rs(x.claims.value), overdue: x.overdue.count })).sort((a, b) => b.unbilledWip - a.unbilledWip).slice(0, 100);
      return { asOf: today(), projectId: q.projectId ?? null, projectCount: projects.length, kpis, backToBack, queues, leakage, pending: mine, portfolio, empty: projects.length === 0 };
    },
    /** FR-03: the items or documents behind a tile or a queue. */
    drill(actor, q) {
      gate(actor, 'bill.qs_dashboard.view', 'see the QS dashboard'); const c = actor.companyId; const projects = projectsOf(actor, q); const out = [];
      const money = (p) => rs(p); const kind = q.kind;
      if (['workNotMeasured', 'measuredNotCertified', 'certifiedNotBilled', 'unbilledWip'].includes(kind)) {
        for (const p of projects) for (const it of chainOf(c, p.id).items) { if (it[kind] > 0) out.push({ project: p.code, ref: it.code, description: it.description, uom: it.uom, executed: it.executed, measured: it.measured, certified: it.certified, billed: it.billed, value: money(it[kind]), link: `/bill/qty-recon?projectId=${p.id}&code=${encodeURIComponent(it.code)}` }); }
      } else if (kind === 'variationPipeline') {
        for (const p of projects) for (const x of db.prepare("SELECT id, cr_no, title, cr_state, value_claimed_paise FROM ctr_change_requests WHERE company_id = ? AND org_project_id = ? AND kind = 'CLIENT' AND deleted_at IS NULL AND status <> 'CANCELLED' AND cr_state IN ('PREPARING', 'READY', 'WITH_CLIENT', 'DISPUTED') ORDER BY id").all(c, p.id)) out.push({ project: p.code, ref: x.cr_no, description: x.title, state: x.cr_state, value: money(x.value_claimed_paise), link: `/ctr/variations?id=${x.id}` });
      } else if (kind === 'claimsPending') {
        for (const p of projects) for (const x of db.prepare("SELECT id, claim_no, title, claim_state, amount_claimed_paise FROM ctr_claims WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND status <> 'CANCELLED' AND claim_state IN ('SUBMITTED', 'NEGOTIATION') ORDER BY id").all(c, p.id)) out.push({ project: p.code, ref: x.claim_no, description: x.title, state: x.claim_state, value: money(x.amount_claimed_paise), link: `/ctr/claims?id=${x.id}` });
      } else if (kind === 'overdueSubmission' || kind === 'billedNotCollected') {
        for (const p of projects) for (const x of db.prepare(`SELECT id, bill_no, period_to, net_paise, client_state FROM bill_client_bills WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND status = 'APPROVED'${kind === 'overdueSubmission' ? " AND client_state = 'NOT_SENT' AND date(period_to, ?) < date(?)" : ''} ORDER BY id`).all(c, p.id, ...(kind === 'overdueSubmission' ? [`+${SUBMIT_DAYS} days`, today()] : []))) out.push({ project: p.code, ref: x.bill_no, description: `Period to ${x.period_to}`, state: x.client_state, value: money(x.net_paise), ageDays: diff(x.period_to), link: `/bill/client-bills?id=${x.id}` });
      } else if (['mbPending', 'billsToPrepare', 'certAwaited', 'deviationDue'].includes(kind)) {
        const d = qs.dashboard(actor, q); for (const r of d.queues[kind].rows) out.push({ project: r.project, ref: r.ref, description: null, value: r.amount ?? null, ageDays: r.ageDays ?? null, link: r.link });
      }
      return { kind, label: KPI[kind] ?? QUEUE[kind] ?? kind, rows: out.slice(0, 500), total: out.length };
    },
    exportCsv(actor, q = {}) {
      gate(actor, 'bill.qs_dashboard.export', 'export the QS dashboard'); const d = qs.dashboard(actor, q);
      const headers = ['Project', 'Name', 'Work done not measured', 'Measured not certified', 'Certified not billed', 'Billed not collected', 'Unbilled work', 'Variations in pipeline', 'Claims pending', 'Bills overdue for submission'];
      const rows = d.portfolio.map((x) => [x.project, x.name, x.workNotMeasured, x.measuredNotCertified, x.certifiedNotBilled, x.billedNotCollected, x.unbilledWip, x.variations, x.claims, x.overdue]);
      audit(actor, 'bill_mb_entries', 0, 'export', actor.companyId, { reason: `QS dashboard, ${rows.length} row(s)` });
      return { contentType: 'text/csv; charset=utf-8', fileName: `qs-dashboard-${today()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(headers, rows)}`, 'utf8') };
    },
    /** The Project 360 slot (10.08): a few figures of one project, only for a person who may see the dashboard. */
    projectWidget(actor, projectId) {
      const d = qs.dashboard(actor, { projectId }); const by = Object.fromEntries(d.kpis.map((k) => [k.key, k])); const f = (k) => ({ key: k, label: by[k].label, value: by[k].unit === 'Rs' ? `Rs ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(by[k].value)}` : String(by[k].value), tone: by[k].status === 'green' ? undefined : by[k].status, drill: `${by[k].drill}` });
      return { figures: ['unbilledWip', 'certifiedNotBilled', 'billedNotCollected', 'overdueSubmission'].map(f), rows: Object.entries(d.queues).filter(([, v]) => v.count > 0).slice(0, 3).map(([k, v]) => ({ label: `${v.label}: ${v.count}`, value: v.count, drill: '/bill/qs-dashboard?projectId=' + projectId + '#' + k })) };
    },
    /** The dashboard framework widget (03.07). */
    widget(actor, code) {
      try { const d = qs.dashboard(actor, {}); const k = d.kpis.find((x) => x.key === (code === 'bill.unbilled_wip' ? 'unbilledWip' : 'certifiedNotBilled')); return { value: k.value ?? 0, unit: ' Rs', previous: null, trendPct: null, target: null, status: k.status, note: k.note ?? '' }; } catch { return { value: 0, unit: '', previous: null, trendPct: null, target: null, status: 'neutral', note: 'You have no right to see the QS figures.' }; }
    },
    /** For the CVR (22.09): the chain in money of a project and the value of a quantity at a rate. */
    chain: (companyId, pid) => chainOf(companyId, pid), valueOf: (qty, rate) => itemValue(qty, rate),
    /** 23.05 plugs the receipts in here. */
    setCollectionsProvider(fn) { collections = fn; },
  };
  return { qs };
}

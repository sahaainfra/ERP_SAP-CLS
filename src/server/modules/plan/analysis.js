import { makeCalendar, ordOf } from './cpm.js';

// The two readings of a schedule picture (part 13.03): the variance of a picture against a baseline (FR-03), and the quality check in the manner of the DCMA 14-point assessment (FR-06). Both work on
// the plain picture that a baseline keeps and that snapshotOf() takes of a working schedule, so a baseline can be checked and compared exactly like the schedule itself. Nothing here reads the database.
const lower = (s) => String(s ?? '').toLowerCase();
const days = (a, b) => (a && b ? ordOf(b) - ordOf(a) : null);
const startOf = (a) => a.actualStart ?? a.start ?? null;
const finishOf = (a) => a.actualFinish ?? a.finish ?? null;
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

export const VARIANCE_STATUS = { SAME: 'As the baseline', CHANGED: 'Changed', ADDED: 'Not in the baseline', REMOVED: 'Removed since the baseline' };
export const VARIANCE_BUCKETS = [['AHEAD', 'Ahead'], ['ON_TIME', 'On time'], ['D1_7', '1 to 7 days late'], ['D8_30', '8 to 30 days late'], ['D31', 'More than 30 days late']];
const bucketOf = (v) => (v < 0 ? 'AHEAD' : v === 0 ? 'ON_TIME' : v <= 7 ? 'D1_7' : v <= 30 ? 'D8_30' : 'D31');

/**
 * FR-03: every activity of the baseline and of the current picture, matched by its code: the variance of its start, finish (calendar days, later is positive) and duration (working days), whether it is
 * critical now and slipped, and the totals. An activity counts with its actual dates where it has them.
 */
export function varianceOf(base, cur) {
  const b = new Map(base.activities.map((a) => [lower(a.code), a])); const wbsB = new Map(base.wbs.map((w) => [w.key, w])); const wbsC = new Map(cur.wbs.map((w) => [w.key, w])); const seen = new Set(); const rows = [];
  const wbsLabel = (m, k) => { const w = m.get(k); return w ? `${w.code} ${w.name}` : null; };
  for (const c of cur.activities) {
    const k = lower(c.code); seen.add(k); const o = b.get(k);
    if (!o) { rows.push({ code: c.code, name: c.name, type: c.type, wbs: wbsLabel(wbsC, c.wbsKey), wbsCode: wbsC.get(c.wbsKey)?.code ?? null, activityId: c.id ?? null, status: 'ADDED', critical: Boolean(c.critical), done: Boolean(c.actualFinish), bStart: null, bFinish: null, bDuration: null, cStart: startOf(c), cFinish: finishOf(c), cDuration: c.duration, startVar: null, finishVar: null, durationVar: null, totalFloat: c.totalFloat ?? null }); continue; }
    const sv = days(startOf(o), startOf(c)); const fv = days(finishOf(o), finishOf(c)); const dv = c.duration - o.duration;
    rows.push({ code: c.code, name: c.name, type: c.type, wbs: wbsLabel(wbsC, c.wbsKey), wbsCode: wbsC.get(c.wbsKey)?.code ?? null, activityId: c.id ?? null, status: (sv ?? 0) === 0 && (fv ?? 0) === 0 && dv === 0 && c.name === o.name ? 'SAME' : 'CHANGED', critical: Boolean(c.critical), done: Boolean(c.actualFinish), bStart: startOf(o), bFinish: finishOf(o), bDuration: o.duration, cStart: startOf(c), cFinish: finishOf(c), cDuration: c.duration, startVar: sv, finishVar: fv, durationVar: dv, totalFloat: c.totalFloat ?? null });
  }
  for (const o of base.activities) if (!seen.has(lower(o.code))) rows.push({ code: o.code, name: o.name, type: o.type, wbs: wbsLabel(wbsB, o.wbsKey), wbsCode: wbsB.get(o.wbsKey)?.code ?? null, activityId: null, status: 'REMOVED', critical: false, done: false, bStart: startOf(o), bFinish: finishOf(o), bDuration: o.duration, cStart: null, cFinish: null, cDuration: null, startVar: null, finishVar: null, durationVar: null, totalFloat: null });
  for (const r of rows) { r.milestone = r.type === 'MILESTONE'; r.slipped = (r.finishVar ?? 0) > 0; r.criticalSlip = r.slipped && r.critical; }
  const matched = rows.filter((r) => r.finishVar != null); const buckets = Object.fromEntries(VARIANCE_BUCKETS.map(([k]) => [k, 0])); for (const r of matched) buckets[bucketOf(r.finishVar)] += 1;
  const slips = matched.filter((r) => r.slipped);
  const summary = {
    baselineStart: base.schedule.start, baselineFinish: base.schedule.finish, currentStart: cur.schedule.start, currentFinish: cur.schedule.finish, finishVar: days(base.schedule.finish, cur.schedule.finish), dataDate: cur.schedule.dataDate ?? null,
    activities: rows.length, matched: matched.length, same: rows.filter((r) => r.status === 'SAME').length, changed: rows.filter((r) => r.status === 'CHANGED').length, added: rows.filter((r) => r.status === 'ADDED').length, removed: rows.filter((r) => r.status === 'REMOVED').length,
    slipped: slips.length, ahead: matched.filter((r) => r.finishVar < 0).length, criticalSlipped: slips.filter((r) => r.critical).length, milestones: rows.filter((r) => r.milestone).length, milestonesSlipped: slips.filter((r) => r.milestone).length,
    maxSlip: slips.reduce((m, r) => Math.max(m, r.finishVar), 0), avgFinishVar: matched.length ? round1(matched.reduce((t, r) => t + r.finishVar, 0) / matched.length) : 0, longer: matched.filter((r) => r.durationVar > 0).length, shorter: matched.filter((r) => r.durationVar < 0).length,
    buckets: VARIANCE_BUCKETS.map(([key, label]) => ({ key, label, n: buckets[key] })),
  };
  return { rows, summary };
}

/** What changed between two pictures in a few numbers and lines: kept with a baseline as its change summary (FR-02). */
export function changeOf(base, cur) {
  const v = varianceOf(base, cur); const linkKey = (m) => { const code = new Map(m.activities.map((a) => [a.key, lower(a.code)])); return new Set(m.links.map((l) => `${code.get(l.pred)}>${code.get(l.succ)}|${l.type}|${l.lag}`)); }; const lb = linkKey(base); const lc = linkKey(cur);
  let linksAdded = 0; let linksRemoved = 0; for (const k of lc) if (!lb.has(k)) linksAdded += 1; for (const k of lb) if (!lc.has(k)) linksRemoved += 1;
  const top = v.rows.filter((r) => r.slipped).sort((x, y) => y.finishVar - x.finishVar).slice(0, 10).map((r) => ({ code: r.code, name: r.name, finishVar: r.finishVar, critical: r.critical }));
  return { finishVar: v.summary.finishVar, baselineFinish: v.summary.baselineFinish, finish: v.summary.currentFinish, added: v.summary.added, removed: v.summary.removed, changed: v.summary.changed, slipped: v.summary.slipped, criticalSlipped: v.summary.criticalSlipped, longer: v.summary.longer, shorter: v.summary.shorter, linksAdded, linksRemoved, top };
}

export const QUALITY = {
  LOGIC: ['Logic', 'Activities without a predecessor or without a successor (the start and the finish of the programme excepted)'],
  LEADS: ['Leads', 'Links with a negative lag'],
  LAGS: ['Lags', 'Links with a lag'],
  RELATIONSHIPS: ['Relationship types', 'Links that are not finish-to-start'],
  HARD_CONSTRAINTS: ['Hard constraints', 'Activities held by "finish no later than"'],
  HIGH_FLOAT: ['High float', 'Activities with more total float than the limit'],
  NEGATIVE_FLOAT: ['Negative float', 'Activities with negative total float'],
  HIGH_DURATION: ['Long durations', 'Activities longer than the limit'],
  INVALID_DATES: ['Invalid dates', 'Actual dates after the data date, or work not done that is still planned before it'],
  RESOURCES: ['Resources', 'Activities with a duration and no resource'],
  MISSED: ['Missed activities', 'Activities the baseline had finished by the data date that are not finished, or finished late'],
  CRITICAL_PATH: ['Critical path test', 'A continuous critical path from the work in hand to the finish'],
  CPLI: ['Critical path length index', '(Critical path length + total float) / critical path length'],
  BEI: ['Baseline execution index', 'Activities finished / activities the baseline had finished by the data date'],
};

/**
 * FR-06: the fourteen checks. `highFloat` and `longDuration` are in working days (44 by default, two months), `tolerance` is the share of activities a check allows (5 %). A check that cannot be made
 * (no data date, no baseline, no resources at all, no calculated dates) is "NA", not a pass. Each check lists what it found, so the page can drill into it.
 */
export function qualityOf(model, { highFloat = 44, longDuration = 44, tolerance = 5, baseline = null } = {}) {
  const tasks = model.activities.filter((a) => a.type === 'TASK' || a.type === 'MILESTONE'); const open = tasks.filter((a) => !a.actualFinish); const byKey = new Map(model.activities.map((a) => [a.key, a])); const taskKeys = new Set(tasks.map((a) => a.key));
  const links = model.links.filter((l) => taskKeys.has(l.pred) && taskKeys.has(l.succ)); const preds = new Map(); const succs = new Map();
  for (const l of links) { if (!preds.has(l.succ)) preds.set(l.succ, []); preds.get(l.succ).push(l); if (!succs.has(l.pred)) succs.set(l.pred, []); succs.get(l.pred).push(l); }
  const dd = model.schedule.dataDate ?? null; const calculated = tasks.length > 0 && tasks.every((a) => a.start && a.finish); const item = (a, detail) => ({ code: a.code, name: a.name, activityId: a.id ?? null, detail });
  const linkItem = (l, detail) => ({ code: `${byKey.get(l.pred).code} → ${byKey.get(l.succ).code}`, name: `${l.type}${l.lag ? (l.lag > 0 ? `+${l.lag}` : l.lag) : ''}`, activityId: byKey.get(l.succ).id ?? null, detail });
  const pctOf = (n, d) => (d ? round2((n * 100) / d) : 0); const out = [];
  const add = (code, { items = [], total = 0, status, value = null, valueLabel = null, threshold }) => { const [name, description] = QUALITY[code]; out.push({ code, name, description, count: items.length, total, pct: pctOf(items.length, total), value, valueLabel: valueLabel ?? (total ? `${items.length} of ${total} (${pctOf(items.length, total)} %)` : '—'), threshold, status, items }); };
  const share = (code, items, total, limit = tolerance) => add(code, { items, total, threshold: `at most ${limit} %`, status: !total ? 'NA' : pctOf(items.length, total) <= limit ? 'PASS' : 'FAIL' });
  const none = (code, items, total) => add(code, { items, total, threshold: 'none', status: !total ? 'NA' : items.length ? 'FAIL' : 'PASS' });

  // 1 logic: the earliest open end at the start and the latest at the finish are the two ends every programme has
  const noPred = open.filter((a) => !(preds.get(a.key)?.length)); const noSucc = open.filter((a) => !(succs.get(a.key)?.length));
  const first = [...noPred].sort((x, y) => String(x.start ?? '9').localeCompare(String(y.start ?? '9')))[0]; const last = [...noSucc].sort((x, y) => String(y.finish ?? '').localeCompare(String(x.finish ?? '')))[0];
  const loose = new Map(); for (const a of noPred) if (a !== first) loose.set(a.key, ['no predecessor']); for (const a of noSucc) if (a !== last) loose.set(a.key, [...(loose.get(a.key) ?? []), 'no successor']);
  share('LOGIC', [...loose].map(([k, why]) => item(byKey.get(k), why.join(', '))), open.length);
  // 2 to 4: the links
  none('LEADS', links.filter((l) => l.lag < 0).map((l) => linkItem(l, `lead of ${-l.lag} day(s)`)), links.length);
  share('LAGS', links.filter((l) => l.lag > 0).map((l) => linkItem(l, `lag of ${l.lag} day(s)`)), links.length);
  const notFs = links.filter((l) => l.type !== 'FS'); add('RELATIONSHIPS', { items: notFs.map((l) => linkItem(l, `${l.type} link`)), total: links.length, threshold: 'at most 10 %', status: !links.length ? 'NA' : pctOf(notFs.length, links.length) <= 10 ? 'PASS' : 'FAIL' });
  // 5 to 8: the activities not finished
  share('HARD_CONSTRAINTS', open.filter((a) => a.constraintType === 'FNLT').map((a) => item(a, `finish no later than ${a.constraintDate}`)), open.length);
  if (calculated) { share('HIGH_FLOAT', open.filter((a) => (a.totalFloat ?? 0) > highFloat).map((a) => item(a, `total float ${a.totalFloat} day(s)`)), open.length); none('NEGATIVE_FLOAT', open.filter((a) => (a.totalFloat ?? 0) < 0).map((a) => item(a, `total float ${a.totalFloat} day(s)`)), open.length); } else { add('HIGH_FLOAT', { threshold: `at most ${tolerance} %`, status: 'NA' }); add('NEGATIVE_FLOAT', { threshold: 'none', status: 'NA' }); }
  share('HIGH_DURATION', open.filter((a) => a.duration > longDuration).map((a) => item(a, `${a.duration} working day(s)`)), open.length);
  // 9 invalid dates
  if (dd) { const wrong = []; for (const a of tasks) { const why = []; if (a.actualStart && a.actualStart > dd) why.push(`actual start ${a.actualStart} after the data date`); if (a.actualFinish && a.actualFinish > dd) why.push(`actual finish ${a.actualFinish} after the data date`); if (!a.actualStart && a.start && a.start < dd) why.push(`not started, planned start ${a.start} before the data date`); if (!a.actualFinish && a.finish && a.finish < dd) why.push(`not finished, planned finish ${a.finish} before the data date`); if (why.length) wrong.push(item(a, why.join('; '))); } none('INVALID_DATES', wrong, tasks.length); } else add('INVALID_DATES', { threshold: 'none', status: 'NA' });
  // 10 resources
  const loaded = new Set(model.resources.map((r) => r.activity)); const work = open.filter((a) => a.type === 'TASK' && a.duration > 0);
  if (loaded.size) none('RESOURCES', work.filter((a) => !loaded.has(a.key)).map((a) => item(a, 'no labour, plant or material')), work.length); else add('RESOURCES', { total: work.length, threshold: 'none', status: 'NA', valueLabel: 'the programme carries no resources' });
  // 11 and 14: against the baseline
  if (baseline && dd) {
    const cur = new Map(tasks.map((a) => [lower(a.code), a])); const due = baseline.activities.filter((a) => (a.type === 'TASK' || a.type === 'MILESTONE') && a.finish && a.finish <= dd); const missed = [];
    for (const o of due) { const c = cur.get(lower(o.code)); if (!c) continue; if (!c.actualFinish) missed.push(item(c, `baseline finish ${o.finish}, not finished`)); else if (c.actualFinish > o.finish) missed.push(item(c, `baseline finish ${o.finish}, finished ${c.actualFinish}`)); }
    share('MISSED', missed, due.length); const finished = tasks.filter((a) => a.actualFinish).length; const bei = due.length ? round2(finished / due.length) : null;
    add('BEI', { total: due.length, value: bei, valueLabel: bei == null ? 'nothing was due yet' : `${finished} finished / ${due.length} due = ${bei.toFixed(2)}`, threshold: 'at least 0.95', status: bei == null ? 'NA' : bei >= 0.95 ? 'PASS' : 'FAIL', items: bei != null && bei < 0.95 ? missed.filter((m) => m.detail.endsWith('not finished')) : [] });
  } else { add('MISSED', { threshold: `at most ${tolerance} %`, status: 'NA', valueLabel: baseline ? 'no data date' : 'no current baseline' }); }
  // 12 and 13: the critical path
  if (calculated && open.length) {
    const end = [...open].sort((x, y) => String(y.finish).localeCompare(String(x.finish)) || (x.totalFloat ?? 0) - (y.totalFloat ?? 0))[0]; const least = Math.min(...open.map((a) => a.totalFloat ?? 0)); const isCrit = (a) => a.critical || (a.totalFloat ?? 1) <= least;
    const seen = new Set(); let cur = end; let whole = isCrit(end); let breakAt = whole ? null : end;
    while (whole) { seen.add(cur.key); const ps = (preds.get(cur.key) ?? []).map((l) => byKey.get(l.pred)).filter((a) => !a.actualFinish); if (!ps.length) break; const next = ps.find((a) => isCrit(a) && !seen.has(a.key)); if (!next) { whole = false; breakAt = cur; break; } cur = next; }
    add('CRITICAL_PATH', { items: whole ? [] : [item(breakAt, breakAt === end && !isCrit(end) ? 'the last activity is not critical' : 'none of its open predecessors is critical: the path breaks here')], total: 1, valueLabel: whole ? `continuous: ${seen.size} activities back from ${end.code}` : 'broken', threshold: 'continuous', status: whole ? 'PASS' : 'FAIL' });
    const cal = model.calendars.find((c) => c.key === model.schedule.calendarKey); const c = makeCalendar({ workWeek: cal?.workWeek ?? '1111110', holidays: cal?.holidays ?? [], exceptions: [...(cal?.exceptions ?? []).map((d) => ({ date: d, working: true }))] });
    const from = ordOf(dd && dd > model.schedule.start ? dd : model.schedule.start); const to = ordOf(end.finish); let cpl = 0; for (let o = from; o <= to; o += 1) if (c.isWork(o)) cpl += 1;
    const tf = end.totalFloat ?? 0; const cpli = cpl > 0 ? round2((cpl + tf) / cpl) : null; add('CPLI', { total: cpl, value: cpli, valueLabel: cpli == null ? '—' : `(${cpl} + ${tf}) / ${cpl} = ${cpli.toFixed(2)}`, threshold: 'at least 0.95', status: cpli == null ? 'NA' : cpli >= 0.95 ? 'PASS' : 'FAIL', items: cpli != null && cpli < 0.95 ? [item(end, `total float ${tf} day(s) at the finish`)] : [] });
  } else { add('CRITICAL_PATH', { threshold: 'continuous', status: 'NA', valueLabel: 'not calculated' }); add('CPLI', { threshold: 'at least 0.95', status: 'NA', valueLabel: 'not calculated' }); }
  if (!(baseline && dd)) add('BEI', { threshold: 'at least 0.95', status: 'NA', valueLabel: baseline ? 'no data date' : 'no current baseline' });
  const order = Object.keys(QUALITY); out.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
  const passed = out.filter((c) => c.status === 'PASS').length; const failed = out.filter((c) => c.status === 'FAIL').length;
  return { checks: out, summary: { passed, failed, notApplicable: out.length - passed - failed, score: passed + failed ? Math.round((passed * 100) / (passed + failed)) : null, activities: tasks.length, open: open.length, links: links.length, dataDate: dd, calculated }, params: { highFloat, longDuration, tolerance } };
}

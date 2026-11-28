import { isoOf, ordOf } from './cpm.js';

// The exchange of schedules with MS Project and Primavera P6 (part 13.03, FR-04, FR-05). Nothing here touches the database: the readers turn a file (MS Project XML, Primavera P6 XML, Primavera XER) into one
// plain model of calendars, WBS nodes, activities, links, resources and assignments, with a note for everything that could not be carried exactly; the writers turn the picture of a schedule (the same
// picture a baseline keeps) into MS Project XML or P6 XML. Durations and lags are whole working days here: a file gives hours, which are divided by the hours of a day of the file (MS Project: of the
// project; P6: of the calendar of the activity). A file with a document type declaration or an entity declaration is refused, so no entity is ever expanded.
export const FORMATS = { MSP_XML: 'MS Project XML', P6_XML: 'Primavera P6 XML', P6_XER: 'Primavera P6 XER' };
export const MAX_ACTIVITIES = 20000;
const MSP_TEXT1 = '188743731'; const CODE_ALIAS = 'Activity code';
const P6_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MSP_LINK = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' }; const MSP_LINK_OUT = { FF: 0, FS: 1, SF: 2, SS: 3 };
const P6_LINK = { 'finish to start': 'FS', 'start to start': 'SS', 'finish to finish': 'FF', 'start to finish': 'SF' }; const P6_LINK_OUT = { FS: 'Finish to Start', SS: 'Start to Start', FF: 'Finish to Finish', SF: 'Start to Finish' };
const XER_LINK = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' };
// what a constraint of the file becomes: this schedule knows "start no earlier than" and "finish no later than"; a harder one is carried as the nearest of the two and noted, the others are left out and noted
const MSP_CONSTRAINT = { 0: null, 1: ['DROP', 'as late as possible'], 2: ['SNET', 'must start on'], 3: ['FNLT', 'must finish on'], 4: ['SNET', null], 5: ['DROP', 'start no later than'], 6: ['DROP', 'finish no earlier than'], 7: ['FNLT', null] };
const P6_CONSTRAINT = { 'start on or after': ['SNET', null], 'finish on or before': ['FNLT', null], 'start on': ['SNET', 'start on'], 'mandatory start': ['SNET', 'mandatory start'], 'finish on': ['FNLT', 'finish on'], 'mandatory finish': ['FNLT', 'mandatory finish'], 'start on or before': ['DROP', 'start on or before'], 'finish on or after': ['DROP', 'finish on or after'], 'as late as possible': ['DROP', 'as late as possible'] };
const XER_CONSTRAINT = { CS_MSOA: ['SNET', null], CS_MEOB: ['FNLT', null], CS_MSO: ['SNET', 'start on'], CS_MANDSTART: ['SNET', 'mandatory start'], CS_MEO: ['FNLT', 'finish on'], CS_MANDFIN: ['FNLT', 'mandatory finish'], CS_MSOB: ['DROP', 'start on or before'], CS_MEOA: ['DROP', 'finish on or after'], CS_ALAP: ['DROP', 'as late as possible'] };

export class ExchangeError extends Error { constructor(message) { super(message); this.name = 'ExchangeError'; this.code = 'EXCHANGE_FILE'; } }
const bad = (m) => { throw new ExchangeError(m); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]).replace(/[^\t\n\r -\uFFFF]/g, '');
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => (s.includes('&') ? s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/g, (_m, e) => (e[0] === '#' ? String.fromCodePoint(Math.min(0x10ffff, e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) || 0xfffd) : ENT[e])) : s);
const dateOf = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? '').trim()); if (!m) return null; const iso = `${m[1]}-${m[2]}-${m[3]}`; return Number.isFinite(Date.parse(`${iso}T00:00:00Z`)) && m[1] >= '1900' && m[1] <= '2200' ? iso : null; };
const num = (s) => { const n = Number(String(s ?? '').trim()); return Number.isFinite(n) ? n : null; };
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The text of a file: UTF-8 (with or without a mark), UTF-16 with a mark, or (an XER written by an old client) Windows Latin-1. */
export function textOf(buffer) {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? '');
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) { const c = Buffer.from(b.subarray(2)); c.swap16(); return c.toString('utf16le'); }
  const t = b.toString('utf8'); if (t.includes('\ufffd')) return b.toString('latin1'); return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

/** What kind of file this is, from its first characters. */
export function detectFormat(text) {
  const head = text.slice(0, 4000);
  if (/^\s*ERMHDR\t/.test(head)) return 'P6_XER';
  if (/<APIBusinessObjects[\s>]/.test(head)) return 'P6_XML';
  if (/<Project[\s>]/.test(head) && /schemas\.microsoft\.com\/project/.test(head)) return 'MSP_XML';
  if (/<Project[\s>]/.test(head)) return 'MSP_XML';
  return null;
}

/** A small reader of XML: elements and their text, names without their prefix; attributes, comments and processing instructions are passed over. */
export function parseXml(text) {
  if (/<!DOCTYPE/i.test(text.slice(0, 8192)) || text.includes('<!ENTITY')) bad('A file with a document type or entity declaration is refused.');
  const root = { name: '#root', children: [], text: '' }; const stack = [root]; let nodes = 0;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<\/([^\s>]+)\s*>|<([^\s>/!?][^\s>/]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m; let at = 0;
  while ((m = re.exec(text))) {
    if (m.index !== at) bad(`The file is not well-formed XML (near character ${at}).`); at = re.lastIndex;
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) { const name = m[2].slice(m[2].indexOf(':') + 1); if (stack.length < 2 || top.name !== name) bad(`The file is not well-formed XML (</${m[2]}> does not close <${top.name}>).`); stack.pop(); }
    else if (m[3] !== undefined) {
      const n = { name: m[3].slice(m[3].indexOf(':') + 1), children: [], text: '' }; top.children.push(n); nodes += 1; if (nodes > 4_000_000) bad('The file is too large.');
      if (!m[5]) { stack.push(n); if (stack.length > 60) bad('The file is nested too deeply.'); }
    } else if (m[6] !== undefined && stack.length > 1) top.text += decode(m[6]);
  }
  if (at !== text.length || stack.length !== 1) bad('The file is not well-formed XML (it ends inside an element).');
  return root;
}
const first = (n, name) => n?.children.find((c) => c.name === name) ?? null;
const all = (n, name) => (n ? n.children.filter((c) => c.name === name) : []);
const val = (n, name) => { const c = first(n, name); const t = c ? c.text.trim() : ''; return t === '' ? null : t; };

const isoHours = (s) => { const m = /^-?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(s ?? '').trim()); if (!m) return null; const h = Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0) + Number(m[3] ?? 0) / 60 + Number(m[4] ?? 0) / 3600; return String(s).trim().startsWith('-') ? -h : h; };
const spanDates = (from, to, limit = 1500) => { const a = dateOf(from); const b = dateOf(to) ?? a; if (!a) return []; const out = []; for (let o = ordOf(a); o <= ordOf(b) && out.length < limit; o += 1) out.push(isoOf(o)); return out; };
const blank = (format) => ({ format, name: null, start: null, finish: null, dataDate: null, hoursPerDay: 8, defaultCalendarKey: null, calendars: [], wbs: [], activities: [], links: [], resources: [], assignments: [], notes: [] });
const note = (fm, level, code, message, ref = null) => { fm.notes.push({ level, code, message, ref }); };
const uniqSorted = (a) => [...new Set(a)].sort();

// ---- MS Project XML ----------------------------------------------------------------------------------------------------------------------------------------------------
export function parseMsp(text) {
  const p = first(parseXml(text), 'Project'); if (!p) bad('This is not an MS Project XML file: it has no Project element.');
  const fm = blank('MSP_XML'); const mpd = num(val(p, 'MinutesPerDay')) || 480; fm.hoursPerDay = mpd / 60;
  fm.name = clip(val(p, 'Title') ?? val(p, 'Name') ?? '', 200) || null; fm.start = dateOf(val(p, 'StartDate')); fm.finish = dateOf(val(p, 'FinishDate')); fm.dataDate = dateOf(val(p, 'StatusDate'));
  const aliased = all(first(p, 'ExtendedAttributes'), 'ExtendedAttribute').some((e) => val(e, 'FieldID') === MSP_TEXT1 && (val(e, 'Alias') ?? '').toLowerCase() === CODE_ALIAS.toLowerCase()); fm.codeField = aliased ? 'TEXT1' : null;
  for (const c of all(first(p, 'Calendars'), 'Calendar')) {
    if (val(c, 'IsBaseCalendar') === '0') continue; // the calendar of one resource
    const week = ['0', '0', '0', '0', '0', '0', '0']; let given = false; const holidays = []; const exceptions = [];
    const put = (dates, working) => { for (const d of dates) (working ? exceptions : holidays).push(d); };
    for (const d of all(first(c, 'WeekDays'), 'WeekDay')) {
      const t = num(val(d, 'DayType')); const w = val(d, 'DayWorking') === '1';
      if (t >= 1 && t <= 7) { week[(t + 5) % 7] = w ? '1' : '0'; given = true; } else if (t === 0) { const tp = first(d, 'TimePeriod'); put(spanDates(val(tp, 'FromDate'), val(tp, 'ToDate')), w); }
    }
    for (const e of all(first(c, 'Exceptions'), 'Exception')) { const tp = first(e, 'TimePeriod'); put(spanDates(val(tp, 'FromDate'), val(tp, 'ToDate')), val(e, 'DayWorking') === '1'); }
    const ww = given && week.includes('1') ? week.join('') : '1111100';
    fm.calendars.push({ key: val(c, 'UID') ?? String(fm.calendars.length + 1), name: clip(val(c, 'Name') ?? 'Calendar', 120), workWeek: ww, hoursPerDay: fm.hoursPerDay, holidays: uniqSorted(holidays), exceptions: uniqSorted(exceptions) });
  }
  const cu = val(p, 'CalendarUID'); fm.defaultCalendarKey = fm.calendars.some((c) => c.key === cu) ? cu : fm.calendars[0]?.key ?? null;
  const outline = []; const summaryUids = new Set();
  for (const t of all(first(p, 'Tasks'), 'Task')) {
    const uid = val(t, 'UID'); if (uid === null || uid === '0' || val(t, 'IsNull') === '1') continue;
    const name = clip(val(t, 'Name') ?? '', 300); const level = Math.max(1, num(val(t, 'OutlineLevel')) ?? 1); const wbsCode = clip(val(t, 'WBS') ?? val(t, 'OutlineNumber') ?? '', 60) || null;
    outline.length = level; const parent = level > 1 ? outline[level - 1] ?? null : null;
    if (val(t, 'Summary') === '1') { const key = `w${uid}`; fm.wbs.push({ key, parentKey: parent, code: wbsCode ?? uid, name: name || (wbsCode ?? uid) }); outline[level] = key; summaryUids.add(uid); continue; }
    if (val(t, 'Active') === '0') { note(fm, 'warning', 'INACTIVE', `Task ${val(t, 'ID') ?? uid} "${name}" is inactive and is left out`, uid); continue; }
    const hours = isoHours(val(t, 'Duration')) ?? 0; const fmt = num(val(t, 'DurationFormat')); const elapsed = [4, 6, 8, 10, 12, 36, 38, 40, 42, 44].includes(fmt ?? -1);
    const ms = val(t, 'Milestone') === '1'; const ext = all(t, 'ExtendedAttribute').find((e) => val(e, 'FieldID') === MSP_TEXT1); const cal = val(t, 'CalendarUID');
    const con = MSP_CONSTRAINT[num(val(t, 'ConstraintType')) ?? 0] ?? null; const rem = isoHours(val(t, 'RemainingDuration'));
    const a = {
      key: uid, uid, id: val(t, 'ID') ?? uid, wbsCode, text1: ext ? clip(val(ext, 'Value') ?? '', 60) || null : null, code: null, name, wbsKey: parent, type: ms && hours === 0 ? 'MILESTONE' : 'TASK', durationDays: (elapsed ? hours / 24 : hours / fm.hoursPerDay),
      calendarKey: cal && cal !== '-1' && fm.calendars.some((c) => c.key === cal) ? cal : null, constraintType: con && con[0] !== 'DROP' ? con[0] : 'NONE', constraintDate: con && con[0] !== 'DROP' ? dateOf(val(t, 'ConstraintDate')) : null,
      start: dateOf(val(t, 'Start')), finish: dateOf(val(t, 'Finish')), actualStart: dateOf(val(t, 'ActualStart')), actualFinish: dateOf(val(t, 'ActualFinish')), pct: Math.max(0, Math.min(100, num(val(t, 'PercentComplete')) ?? 0)), remainingDays: rem == null ? null : rem / fm.hoursPerDay,
      // PACK-21: the baseline the file carries (MS Project baseline 0), kept as a reference; it never becomes an approved baseline here
      ...((b) => (b ? { baselineStart: dateOf(val(b, 'Start')), baselineFinish: dateOf(val(b, 'Finish')) } : {}))(all(t, 'Baseline').find((b) => (val(b, 'Number') ?? '0') === '0')),
    };
    if (ms && hours > 0) note(fm, 'warning', 'MILESTONE_DURATION', `Task ${a.id} "${name}" is marked as a milestone but has a duration: it is read as a task`, uid);
    if (elapsed) note(fm, 'warning', 'ELAPSED_DURATION', `Task ${a.id} "${name}" has an elapsed duration: it is read as ${Math.round(a.durationDays)} working day(s)`, uid);
    if (val(t, 'Manual') === '1') note(fm, 'info', 'MANUAL', `Task ${a.id} "${name}" was scheduled by hand in the file: here its dates follow the logic`, uid);
    if (con && con[1]) note(fm, 'warning', con[0] === 'DROP' ? 'CONSTRAINT_DROPPED' : 'CONSTRAINT_CHANGED', con[0] === 'DROP' ? `Task ${a.id} "${name}": the constraint "${con[1]}" is not carried` : `Task ${a.id} "${name}": the constraint "${con[1]}" is read as "${a.constraintType === 'SNET' ? 'start no earlier than' : 'finish no later than'}"`, uid);
    if (a.constraintType !== 'NONE' && !a.constraintDate) { a.constraintType = 'NONE'; note(fm, 'warning', 'CONSTRAINT_DROPPED', `Task ${a.id} "${name}": a constraint without a date is not carried`, uid); }
    fm.activities.push(a);
    for (const l of all(t, 'PredecessorLink')) {
      const pu = val(l, 'PredecessorUID'); if (pu === null) continue;
      if (val(l, 'CrossProject') === '1') { note(fm, 'warning', 'LINK_EXTERNAL', `Task ${a.id}: a link to another project is left out`, uid); continue; }
      const lf = num(val(l, 'LagFormat')); const pctLag = [19, 20, 35, 51, 52].includes(lf ?? -1); const elLag = [4, 6, 8, 10, 12].includes(lf ?? -1); const raw = num(val(l, 'LinkLag')) ?? 0;
      if (pctLag && raw) note(fm, 'warning', 'LAG_PERCENT', `Task ${a.id}: a lag given as a percentage is read as no lag`, uid);
      fm.links.push({ predKey: pu, succKey: uid, type: MSP_LINK[num(val(l, 'Type')) ?? 1] ?? 'FS', lagDays: pctLag ? 0 : elLag ? raw / 10 / 1440 : raw / 10 / mpd });
    }
  }
  fm.summaryKeys = [...summaryUids];
  for (const r of all(first(p, 'Resources'), 'Resource')) {
    const uid = val(r, 'UID'); const name = clip(val(r, 'Name') ?? '', 120); if (uid === null || uid === '0' || !name) continue; const t = val(r, 'Type'); const group = (val(r, 'Group') ?? '').toUpperCase();
    if (t === '2') { note(fm, 'info', 'RESOURCE_COST', `The cost resource "${name}" is left out`, uid); continue; }
    fm.resources.push({ key: uid, code: clip(val(r, 'Code') ?? val(r, 'Initials') ?? '', 60) || null, name, type: ['LABOUR', 'PLANT', 'MATERIAL'].includes(group) ? group : t === '0' ? 'MATERIAL' : 'LABOUR', uom: clip(val(r, 'MaterialLabel') ?? '', 20) || null });
  }
  const work = new Set(fm.resources.filter((r) => r.type !== 'MATERIAL').map((r) => r.key));
  for (const a of all(first(p, 'Assignments'), 'Assignment')) {
    const tu = val(a, 'TaskUID'); const ru = val(a, 'ResourceUID'); if (!tu || !ru || !fm.resources.some((r) => r.key === ru)) continue;
    const h = isoHours(val(a, 'Work')); const qty = h ?? num(val(a, 'Units')) ?? 0; if (!(qty > 0)) continue;
    fm.assignments.push({ activityKey: tu, resourceKey: ru, qty, unit: work.has(ru) ? 'hour' : 'unit' });
  }
  return fm;
}

// ---- Primavera P6 XML ---------------------------------------------------------------------------------------------------------------------------------------------------
export function parseP6Xml(text) {
  const root = first(parseXml(text), 'APIBusinessObjects'); if (!root) bad('This is not a Primavera P6 XML file: it has no APIBusinessObjects element.');
  const projects = all(root, 'Project'); const p = projects.find((x) => all(x, 'Activity').length) ?? projects[0]; if (!p) bad('The Primavera file has no project.');
  const fm = blank('P6_XML'); if (projects.length > 1) note(fm, 'warning', 'MANY_PROJECTS', `The file holds ${projects.length} projects: only "${val(p, 'Name') ?? val(p, 'Id')}" is read`);
  fm.name = clip(val(p, 'Name') ?? val(p, 'Id') ?? '', 200) || null; fm.start = dateOf(val(p, 'PlannedStartDate') ?? val(p, 'StartDate')); fm.finish = dateOf(val(p, 'ScheduledFinishDate') ?? val(p, 'FinishDate')); fm.dataDate = dateOf(val(p, 'DataDate'));
  for (const c of [...all(root, 'Calendar'), ...all(p, 'Calendar')]) {
    const week = ['0', '0', '0', '0', '0', '0', '0']; let given = false; const holidays = []; const exceptions = [];
    for (const d of all(first(c, 'StandardWorkWeek'), 'StandardWorkHours')) { const i = P6_DAYS.indexOf(val(d, 'DayOfWeek') ?? ''); if (i < 0) continue; given = true; week[i] = all(d, 'WorkTime').some((w) => val(w, 'Start')) ? '1' : '0'; }
    for (const e of all(first(c, 'HolidayOrExceptions'), 'HolidayOrException')) { const d = dateOf(val(e, 'Date')); if (d) (all(e, 'WorkTime').some((w) => val(w, 'Start')) ? exceptions : holidays).push(d); }
    fm.calendars.push({ key: val(c, 'ObjectId') ?? String(fm.calendars.length + 1), name: clip(val(c, 'Name') ?? 'Calendar', 120), workWeek: given && week.includes('1') ? week.join('') : '1111100', hoursPerDay: num(val(c, 'HoursPerDay')) || 8, holidays: uniqSorted(holidays), exceptions: uniqSorted(exceptions) });
  }
  const hoursOf = new Map(fm.calendars.map((c) => [c.key, c.hoursPerDay])); const dc = val(p, 'ActivityDefaultCalendarObjectId'); fm.defaultCalendarKey = hoursOf.has(dc) ? dc : fm.calendars[0]?.key ?? null; fm.hoursPerDay = hoursOf.get(fm.defaultCalendarKey) ?? 8;
  const wbsNodes = all(p, 'WBS'); const wbsIds = new Set(wbsNodes.map((w) => val(w, 'ObjectId')));
  for (const w of wbsNodes) { const par = val(w, 'ParentObjectId'); fm.wbs.push({ key: val(w, 'ObjectId'), parentKey: wbsIds.has(par) ? par : null, code: clip(val(w, 'Code') ?? '', 60) || val(w, 'ObjectId'), name: clip(val(w, 'Name') ?? val(w, 'Code') ?? '', 200) }); }
  for (const t of all(p, 'Activity')) {
    const key = val(t, 'ObjectId'); if (!key) continue; const code = clip(val(t, 'Id') ?? '', 60); const name = clip(val(t, 'Name') ?? '', 300); const ty = (val(t, 'Type') ?? '').toLowerCase();
    if (ty === 'wbs summary') { note(fm, 'warning', 'SUMMARY_ACTIVITY', `Activity ${code} "${name}" is a WBS summary: it is left out (a summary is worked out here)`, key); continue; }
    const cal = val(t, 'CalendarObjectId'); const hpd = hoursOf.get(cal) ?? fm.hoursPerDay; const con = P6_CONSTRAINT[(val(t, 'PrimaryConstraintType') ?? '').toLowerCase()] ?? null; const rem = num(val(t, 'RemainingDuration'));
    const af = dateOf(val(t, 'ActualFinishDate')); const frac = num(val(t, 'PercentComplete')); const pct = af ? 100 : frac != null ? (frac <= 1 ? frac * 100 : frac) : num(val(t, 'PhysicalPercentComplete')) ?? 0; // PercentComplete is a fraction in a P6 file; the physical percentage is 0 to 100
    const a = {
      key, uid: key, id: code, wbsCode: null, text1: null, code: code || null, name, wbsKey: wbsIds.has(val(t, 'WBSObjectId')) ? val(t, 'WBSObjectId') : null, type: ty.includes('milestone') ? 'MILESTONE' : ty === 'level of effort' ? 'LOE' : 'TASK',
      durationDays: (num(val(t, 'PlannedDuration')) ?? 0) / hpd, calendarKey: cal && cal !== fm.defaultCalendarKey && hoursOf.has(cal) ? cal : null, constraintType: con && con[0] !== 'DROP' ? con[0] : 'NONE', constraintDate: con && con[0] !== 'DROP' ? dateOf(val(t, 'PrimaryConstraintDate')) : null,
      start: dateOf(val(t, 'PlannedStartDate') ?? val(t, 'StartDate')), finish: dateOf(val(t, 'PlannedFinishDate') ?? val(t, 'FinishDate')), actualStart: dateOf(val(t, 'ActualStartDate')), actualFinish: af, pct: Math.max(0, Math.min(100, pct)), remainingDays: rem == null ? null : rem / hpd,
    };
    if (con && con[1]) note(fm, 'warning', con[0] === 'DROP' ? 'CONSTRAINT_DROPPED' : 'CONSTRAINT_CHANGED', con[0] === 'DROP' ? `Activity ${code}: the constraint "${con[1]}" is not carried` : `Activity ${code}: the constraint "${con[1]}" is read as "${a.constraintType === 'SNET' ? 'start no earlier than' : 'finish no later than'}"`, key);
    if (a.constraintType !== 'NONE' && !a.constraintDate) { a.constraintType = 'NONE'; note(fm, 'warning', 'CONSTRAINT_DROPPED', `Activity ${code}: a constraint without a date is not carried`, key); }
    if (val(t, 'SecondaryConstraintType') && val(t, 'SecondaryConstraintType') !== 'None') note(fm, 'warning', 'CONSTRAINT_DROPPED', `Activity ${code}: the secondary constraint is not carried`, key);
    fm.activities.push(a);
  }
  const hpdOfAct = new Map(fm.activities.map((a) => [a.key, hoursOf.get(a.calendarKey) ?? fm.hoursPerDay]));
  for (const l of all(p, 'Relationship')) { const pr = val(l, 'PredecessorActivityObjectId'); const su = val(l, 'SuccessorActivityObjectId'); if (!pr || !su) continue; fm.links.push({ predKey: pr, succKey: su, type: P6_LINK[(val(l, 'Type') ?? '').toLowerCase()] ?? 'FS', lagDays: (num(val(l, 'Lag')) ?? 0) / (hpdOfAct.get(pr) ?? fm.hoursPerDay) }); }
  for (const r of [...all(root, 'Resource'), ...all(p, 'Resource')]) { const key = val(r, 'ObjectId'); const name = clip(val(r, 'Name') ?? val(r, 'Id') ?? '', 120); if (!key || !name) continue; const t = (val(r, 'ResourceType') ?? '').toLowerCase(); fm.resources.push({ key, code: clip(val(r, 'Id') ?? '', 60) || null, name, type: t === 'material' ? 'MATERIAL' : t === 'nonlabor' ? 'PLANT' : 'LABOUR', uom: clip(val(r, 'UnitOfMeasureAbbreviation') ?? '', 20) || null }); }
  const rs = new Map(fm.resources.map((r) => [r.key, r]));
  for (const a of all(p, 'ResourceAssignment')) { const ak = val(a, 'ActivityObjectId'); const rk = val(a, 'ResourceObjectId'); const q = num(val(a, 'PlannedUnits')) ?? 0; if (!ak || !rs.has(rk) || !(q > 0)) continue; fm.assignments.push({ activityKey: ak, resourceKey: rk, qty: q, unit: rs.get(rk).type === 'MATERIAL' ? 'unit' : 'hour' }); }
  return fm;
}

// ---- Primavera XER -------------------------------------------------------------------------------------------------------------------------------------------------------
/** The tables of an XER file: each a list of rows keyed by field name. */
export function xerTables(text) {
  if (!/^\s*ERMHDR\t/.test(text.slice(0, 200))) bad('This is not a Primavera XER file: it does not start with ERMHDR.');
  const tables = new Map(); let cur = null; let fields = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('%T')) { cur = []; fields = []; tables.set(line.slice(2).trim(), cur); } else if (line.startsWith('%F')) fields = line.split('\t').slice(1).map((f) => f.trim());
    else if (line.startsWith('%R') && cur) { const c = line.split('\t').slice(1); const r = {}; for (let i = 0; i < fields.length; i += 1) r[fields[i]] = (c[i] ?? '').trim(); cur.push(r); } else if (line.startsWith('%E')) break;
  }
  return tables;
}
/** The week and the exceptions of a P6 calendar from its `clndr_data` text: nested lists "(0||name(attributes)(children))". */
export function xerCalendarData(data) {
  const s = String(data ?? ''); let i = 0; const week = ['0', '0', '0', '0', '0', '0', '0']; let given = false; const holidays = []; const exceptions = [];
  const skip = () => { while (i < s.length && s[i] !== '(' && s[i] !== ')') i += 1; };
  const node = (depth) => {
    i += 1; let j = s.indexOf('(', i); if (j < 0) { i = s.length; return null; } const name = s.slice(i, j).replace(/^0\|\|/, '').trim(); i = j + 1; j = s.indexOf(')', i); if (j < 0) { i = s.length; return null; } const attrs = s.slice(i, j); i = j + 1; const kids = [];
    skip(); if (s[i] === '(') { i += 1; skip(); while (i < s.length && s[i] === '(' && depth < 12) { const k = node(depth + 1); if (k) kids.push(k); skip(); } if (s[i] === ')') i += 1; }
    skip(); if (s[i] === ')') i += 1; return { name, attrs, kids };
  };
  skip(); const root = s[i] === '(' ? node(0) : null;
  const walk = (n) => {
    if (!n) return;
    if (n.name === 'DaysOfWeek') { for (const d of n.kids) { const k = Number(d.name); if (k >= 1 && k <= 7) { given = true; week[(k + 5) % 7] = d.kids.some((x) => /(^|\|)s\|/.test(x.attrs)) ? '1' : '0'; } } return; }
    if (n.name === 'Exceptions') { for (const e of n.kids) { const m = /(^|\|)d\|(\d+)/.exec(e.attrs); if (!m) continue; const d = isoOf(Number(m[2]) - 25569); (e.kids.some((x) => /(^|\|)s\|/.test(x.attrs)) ? exceptions : holidays).push(d); } return; }
    for (const k of n.kids) walk(k);
  };
  walk(root);
  return { workWeek: given && week.includes('1') ? week.join('') : '1111100', holidays: uniqSorted(holidays), exceptions: uniqSorted(exceptions) };
}
export function parseXer(text) {
  const t = xerTables(text); const fm = blank('P6_XER'); const tasksAll = t.get('TASK') ?? []; const projects = t.get('PROJECT') ?? [];
  const pid = (projects.find((x) => tasksAll.some((k) => k.proj_id === x.proj_id)) ?? projects[0])?.proj_id ?? tasksAll[0]?.proj_id ?? null; const p = projects.find((x) => x.proj_id === pid) ?? {};
  if (projects.length > 1) note(fm, 'warning', 'MANY_PROJECTS', `The file holds ${projects.length} projects: only "${p.proj_short_name ?? pid}" is read`);
  fm.name = clip(p.proj_short_name ?? '', 200) || null; fm.start = dateOf(p.plan_start_date); fm.finish = dateOf(p.scd_end_date ?? p.plan_end_date); fm.dataDate = dateOf(p.last_recalc_date);
  for (const c of t.get('CALENDAR') ?? []) { if (c.proj_id && pid && c.proj_id !== pid) continue; fm.calendars.push({ key: c.clndr_id, name: clip(c.clndr_name ?? 'Calendar', 120), hoursPerDay: num(c.day_hr_cnt) || 8, ...xerCalendarData(c.clndr_data) }); }
  const hoursOf = new Map(fm.calendars.map((c) => [c.key, c.hoursPerDay])); fm.defaultCalendarKey = hoursOf.has(p.clndr_id) ? p.clndr_id : (t.get('CALENDAR') ?? []).find((c) => c.default_flag === 'Y' && hoursOf.has(c.clndr_id))?.clndr_id ?? fm.calendars[0]?.key ?? null; fm.hoursPerDay = hoursOf.get(fm.defaultCalendarKey) ?? 8;
  const wbsRows = (t.get('PROJWBS') ?? []).filter((w) => !pid || w.proj_id === pid); const rootIds = new Set(wbsRows.filter((w) => w.proj_node_flag === 'Y').map((w) => w.wbs_id)); const wbsIds = new Set(wbsRows.filter((w) => !rootIds.has(w.wbs_id)).map((w) => w.wbs_id));
  for (const w of wbsRows) if (!rootIds.has(w.wbs_id)) fm.wbs.push({ key: w.wbs_id, parentKey: wbsIds.has(w.parent_wbs_id) ? w.parent_wbs_id : null, code: clip(w.wbs_short_name ?? '', 60) || w.wbs_id, name: clip(w.wbs_name ?? w.wbs_short_name ?? '', 200) });
  for (const k of tasksAll) {
    if (pid && k.proj_id !== pid) continue; const code = clip(k.task_code ?? '', 60); const name = clip(k.task_name ?? '', 300); const key = k.task_id; if (!key) continue;
    if (k.task_type === 'TT_WBS') { note(fm, 'warning', 'SUMMARY_ACTIVITY', `Activity ${code} "${name}" is a WBS summary: it is left out (a summary is worked out here)`, key); continue; }
    const hpd = hoursOf.get(k.clndr_id) ?? fm.hoursPerDay; const con = XER_CONSTRAINT[k.cstr_type] ?? null; const af = dateOf(k.act_end_date); const rem = num(k.remain_drtn_hr_cnt);
    const a = {
      key, uid: key, id: code, wbsCode: null, text1: null, code: code || null, name, wbsKey: wbsIds.has(k.wbs_id) ? k.wbs_id : null, type: ['TT_Mile', 'TT_FinMile'].includes(k.task_type) ? 'MILESTONE' : k.task_type === 'TT_LOE' ? 'LOE' : 'TASK',
      durationDays: (num(k.target_drtn_hr_cnt) ?? 0) / hpd, calendarKey: k.clndr_id && k.clndr_id !== fm.defaultCalendarKey && hoursOf.has(k.clndr_id) ? k.clndr_id : null, constraintType: con && con[0] !== 'DROP' ? con[0] : 'NONE', constraintDate: con && con[0] !== 'DROP' ? dateOf(k.cstr_date) : null,
      start: dateOf(k.target_start_date || k.early_start_date), finish: dateOf(k.target_end_date || k.early_end_date), actualStart: dateOf(k.act_start_date), actualFinish: af, pct: af ? 100 : Math.max(0, Math.min(100, num(k.phys_complete_pct) ?? 0)), remainingDays: rem == null ? null : rem / hpd,
    };
    if (con && con[1]) note(fm, 'warning', con[0] === 'DROP' ? 'CONSTRAINT_DROPPED' : 'CONSTRAINT_CHANGED', con[0] === 'DROP' ? `Activity ${code}: the constraint "${con[1]}" is not carried` : `Activity ${code}: the constraint "${con[1]}" is read as "${a.constraintType === 'SNET' ? 'start no earlier than' : 'finish no later than'}"`, key);
    if (a.constraintType !== 'NONE' && !a.constraintDate) { a.constraintType = 'NONE'; note(fm, 'warning', 'CONSTRAINT_DROPPED', `Activity ${code}: a constraint without a date is not carried`, key); }
    if (k.cstr_type2) note(fm, 'warning', 'CONSTRAINT_DROPPED', `Activity ${code}: the secondary constraint is not carried`, key);
    fm.activities.push(a);
  }
  const hpdOfAct = new Map(fm.activities.map((a) => [a.key, hoursOf.get(a.calendarKey) ?? fm.hoursPerDay]));
  for (const l of t.get('TASKPRED') ?? []) { if (pid && l.proj_id && l.proj_id !== pid) continue; if (!l.task_id || !l.pred_task_id) continue; fm.links.push({ predKey: l.pred_task_id, succKey: l.task_id, type: XER_LINK[l.pred_type] ?? 'FS', lagDays: (num(l.lag_hr_cnt) ?? 0) / (hpdOfAct.get(l.pred_task_id) ?? fm.hoursPerDay) }); }
  for (const r of t.get('RSRC') ?? []) { const name = clip(r.rsrc_name ?? r.rsrc_short_name ?? '', 120); if (!r.rsrc_id || !name) continue; fm.resources.push({ key: r.rsrc_id, code: clip(r.rsrc_short_name ?? '', 60) || null, name, type: r.rsrc_type === 'RT_Mat' ? 'MATERIAL' : r.rsrc_type === 'RT_Equip' ? 'PLANT' : 'LABOUR', uom: null }); }
  const rs = new Map(fm.resources.map((r) => [r.key, r]));
  for (const a of t.get('TASKRSRC') ?? []) { if (pid && a.proj_id && a.proj_id !== pid) continue; const q = num(a.target_qty) ?? 0; if (!a.task_id || !rs.has(a.rsrc_id) || !(q > 0)) continue; fm.assignments.push({ activityKey: a.task_id, resourceKey: a.rsrc_id, qty: q, unit: rs.get(a.rsrc_id).type === 'MATERIAL' ? 'unit' : 'hour' }); }
  return fm;
}

/** Read a file of any of the three kinds. */
export function parseFile(buffer, format = null) {
  if (!buffer?.length) bad('The file is empty.');
  const text = textOf(buffer); const f = format ?? detectFormat(text); if (!f) bad('The file is not MS Project XML, Primavera P6 XML or Primavera XER.');
  const found = detectFormat(text); if (found && found !== f) bad(`The file is ${FORMATS[found]}, not ${FORMATS[f]}.`);
  const fm = f === 'MSP_XML' ? parseMsp(text) : f === 'P6_XML' ? parseP6Xml(text) : parseXer(text);
  if (fm.activities.length > MAX_ACTIVITIES) bad(`The file has ${fm.activities.length} activities: at most ${MAX_ACTIVITIES} are read in one file.`);
  return fm;
}

// ---- writing: the picture of a schedule (see snapshotOf in baselines.js) as MS Project XML or P6 XML ------------------------------------------------------------------------
const tag = (name, v) => (v === null || v === undefined || v === '' ? '' : `<${name}>${esc(v)}</${name}>`);
const hhmm = (h) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}:00`;
const dayStart = (hpd) => (hpd <= 16 ? 8 : 0);
const pt = (hours) => { const mins = Math.round(Math.abs(hours) * 60); return `PT${Math.floor(mins / 60)}H${mins % 60}M0S`; };
/** The WBS nodes in tree order with their depth, and the activities under each (those without a node first). */
function tree(model) {
  const known = new Set(model.wbs.map((w) => w.key)); const kids = new Map(); for (const w of model.wbs) { const k = w.parentKey && known.has(w.parentKey) ? w.parentKey : null; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(w); }
  const acts = new Map(); for (const a of model.activities) { const k = a.wbsKey && known.has(a.wbsKey) ? a.wbsKey : null; if (!acts.has(k)) acts.set(k, []); acts.get(k).push(a); }
  const out = []; const walk = (parent, depth) => { for (const a of acts.get(parent) ?? []) out.push({ kind: 'activity', a, depth }); for (const w of (kids.get(parent) ?? []).sort((x, y) => String(x.code).localeCompare(String(y.code), 'en', { numeric: true }))) { const at = out.length; out.push({ kind: 'wbs', w, depth }); walk(w.key, depth + 1); if (out.length === at + 1) out.pop(); } };
  walk(null, 1); return out;
}

export function toMspXml(model) {
  const s = model.schedule; const cals = model.calendars; const defKey = s.calendarKey; const hpd = cals.find((c) => c.key === defKey)?.hoursPerDay ?? 8; const mpd = hpd * 60; const calUid = new Map(cals.map((c, i) => [c.key, i + 1]));
  const times = (h) => { const from = dayStart(h); return `<WorkingTimes><WorkingTime><FromTime>${hhmm(from)}</FromTime><ToTime>${hhmm(from + h)}</ToTime></WorkingTime></WorkingTimes>`; };
  const x = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<Project xmlns="http://schemas.microsoft.com/project">', '<SaveVersion>14</SaveVersion>', tag('Name', s.docNo), tag('Title', s.name), '<ScheduleFromStart>1</ScheduleFromStart>',
    tag('StartDate', s.start ? `${s.start}T${hhmm(dayStart(hpd))}` : null), tag('FinishDate', s.finish ? `${s.finish}T${hhmm(dayStart(hpd) + hpd)}` : null), tag('StatusDate', s.dataDate ? `${s.dataDate}T${hhmm(dayStart(hpd) + hpd)}` : null), `<CalendarUID>${calUid.get(defKey) ?? 1}</CalendarUID>`,
    `<MinutesPerDay>${mpd}</MinutesPerDay>`, `<MinutesPerWeek>${mpd * ((cals.find((c) => c.key === defKey)?.workWeek ?? '1111100').split('1').length - 1)}</MinutesPerWeek>`, '<DaysPerMonth>26</DaysPerMonth>',
    `<ExtendedAttributes><ExtendedAttribute><FieldID>${MSP_TEXT1}</FieldID><FieldName>Text1</FieldName><Alias>${CODE_ALIAS}</Alias></ExtendedAttribute></ExtendedAttributes>`, '<Calendars>'];
  for (const c of cals) {
    x.push(`<Calendar><UID>${calUid.get(c.key)}</UID>${tag('Name', `${c.code} ${c.name}`.trim())}<IsBaseCalendar>1</IsBaseCalendar><BaseCalendarUID>-1</BaseCalendarUID><WeekDays>`);
    for (let t = 1; t <= 7; t += 1) { const w = c.workWeek[(t + 5) % 7] === '1'; x.push(`<WeekDay><DayType>${t}</DayType><DayWorking>${w ? 1 : 0}</DayWorking>${w ? times(c.hoursPerDay) : ''}</WeekDay>`); }
    x.push('</WeekDays>'); const ex = [...c.holidays.map((d) => [d, false]), ...c.exceptions.map((d) => [d, true])].sort((a, b) => a[0].localeCompare(b[0]));
    if (ex.length) { x.push('<Exceptions>'); for (const [d, w] of ex) x.push(`<Exception><EnteredByOccurrences>0</EnteredByOccurrences><TimePeriod><FromDate>${d}T00:00:00</FromDate><ToDate>${d}T23:59:00</ToDate></TimePeriod><Occurrences>1</Occurrences><Name>${w ? 'Working day' : 'Holiday'}</Name><Type>1</Type><DayWorking>${w ? 1 : 0}</DayWorking>${w ? times(c.hoursPerDay) : ''}</Exception>`); x.push('</Exceptions>'); }
    x.push('</Calendar>');
  }
  x.push('</Calendars>', '<Tasks>', `<Task><UID>0</UID><ID>0</ID>${tag('Name', s.name)}<OutlineNumber>0</OutlineNumber><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>`);
  const rows = tree(model); const uidOf = new Map(); let n = 0; for (const r of rows) { n += 1; r.uid = n; if (r.kind === 'activity') uidOf.set(r.a.key, n); }
  const preds = new Map(); for (const l of model.links) { if (!preds.has(l.succ)) preds.set(l.succ, []); preds.get(l.succ).push(l); }
  const counters = []; const from = `T${hhmm(dayStart(hpd))}`; const to = `T${hhmm(dayStart(hpd) + hpd)}`;
  for (const r of rows) {
    counters.length = r.depth; counters[r.depth - 1] = (counters[r.depth - 1] ?? 0) + 1; const on = counters.join('.');
    if (r.kind === 'wbs') { x.push(`<Task><UID>${r.uid}</UID><ID>${r.uid}</ID>${tag('Name', r.w.name)}<Active>1</Active><Manual>0</Manual>${tag('WBS', r.w.code)}<OutlineNumber>${on}</OutlineNumber><OutlineLevel>${r.depth}</OutlineLevel><Summary>1</Summary></Task>`); continue; }
    const a = r.a; const ms = a.type === 'MILESTONE'; const cu = a.calendarKey && a.calendarKey !== defKey && calUid.has(a.calendarKey) ? calUid.get(a.calendarKey) : -1;
    x.push(`<Task><UID>${r.uid}</UID><ID>${r.uid}</ID>${tag('Name', a.name)}<Active>1</Active><Manual>0</Manual><Type>1</Type>${tag('WBS', a.code)}<OutlineNumber>${on}</OutlineNumber><OutlineLevel>${r.depth}</OutlineLevel>`
      + `${tag('Start', a.start ? a.start + from : null)}${tag('Finish', a.finish ? a.finish + (ms ? from : to) : null)}<Duration>${pt(a.duration * hpd)}</Duration><DurationFormat>7</DurationFormat><Milestone>${ms ? 1 : 0}</Milestone><Summary>0</Summary><Critical>${a.critical ? 1 : 0}</Critical>`
      + `<CalendarUID>${cu}</CalendarUID><ConstraintType>${a.constraintType === 'SNET' ? 4 : a.constraintType === 'FNLT' ? 7 : 0}</ConstraintType>${tag('ConstraintDate', a.constraintType !== 'NONE' && a.constraintDate ? a.constraintDate + (a.constraintType === 'SNET' ? from : to) : null)}`
      + `<PercentComplete>${Math.round(a.pct ?? 0)}</PercentComplete>${tag('ActualStart', a.actualStart ? a.actualStart + from : null)}${tag('ActualFinish', a.actualFinish ? a.actualFinish + to : null)}${a.remaining == null ? '' : `<RemainingDuration>${pt(a.remaining * hpd)}</RemainingDuration>`}`
      + `${a.totalFloat == null ? '' : `<TotalSlack>${a.totalFloat * mpd * 10}</TotalSlack>`}<ExtendedAttribute><FieldID>${MSP_TEXT1}</FieldID>${tag('Value', a.code)}</ExtendedAttribute>`
      + (preds.get(a.key) ?? []).filter((l) => uidOf.has(l.pred)).map((l) => `<PredecessorLink><PredecessorUID>${uidOf.get(l.pred)}</PredecessorUID><Type>${MSP_LINK_OUT[l.type]}</Type><CrossProject>0</CrossProject><LinkLag>${l.lag * mpd * 10}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`).join('')
      // PACK-21: the current approved baseline as MS Project baseline 0 (given only when the export attaches it)
      + (a.baselineStart && a.baselineFinish ? `<Baseline><Number>0</Number>${tag('Start', a.baselineStart + from)}${tag('Finish', a.baselineFinish + (ms ? from : to))}${a.baselineDuration == null ? '' : `<Duration>${pt(a.baselineDuration * hpd)}</Duration>`}</Baseline>` : '') + '</Task>');
  }
  x.push('</Tasks>', '<Resources>'); const resUid = new Map(); const resList = []; for (const r of model.resources) { const k = `${r.type}|${r.key}`; if (!resUid.has(k)) { resUid.set(k, resUid.size + 1); resList.push(r); } }
  for (const r of resList) x.push(`<Resource><UID>${resUid.get(`${r.type}|${r.key}`)}</UID><ID>${resUid.get(`${r.type}|${r.key}`)}</ID>${tag('Name', r.itemCode && r.label.startsWith(`${r.itemCode} `) ? r.label.slice(r.itemCode.length + 1) : r.label)}<Type>${r.type === 'MATERIAL' ? 0 : 1}</Type>${r.type === 'MATERIAL' ? tag('MaterialLabel', r.uom) : ''}${tag('Code', r.itemCode)}<Group>${r.type}</Group></Resource>`);
  x.push('</Resources>', '<Assignments>'); let an = 0;
  for (const r of model.resources) { if (!uidOf.has(r.activity)) continue; an += 1; const hours = r.type === 'MATERIAL' || /^h(ou)?rs?$/i.test(r.uom ?? '') ? r.qtyTotal : r.qtyTotal * hpd; x.push(`<Assignment><UID>${an}</UID><TaskUID>${uidOf.get(r.activity)}</TaskUID><ResourceUID>${resUid.get(`${r.type}|${r.key}`)}</ResourceUID><Units>${r.type === 'MATERIAL' ? r.qtyTotal : 1}</Units><Work>${pt(hours)}</Work></Assignment>`); }
  x.push('</Assignments>', '</Project>');
  return Buffer.from(x.filter(Boolean).join('\n'), 'utf8');
}

export function toP6Xml(model) {
  const s = model.schedule; const cals = model.calendars; const calId = new Map(cals.map((c, i) => [c.key, 100 + i])); const hoursOf = new Map(cals.map((c) => [c.key, c.hoursPerDay])); const defKey = s.calendarKey; const hpd = hoursOf.get(defKey) ?? 8; const at = (d, end = false, h = hpd) => (d ? `${d}T${hhmm(dayStart(h) + (end ? h : 0))}` : null);
  const x = ['<?xml version="1.0" encoding="UTF-8"?>', '<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6/V8.3/API/BusinessObjects" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'];
  for (const c of cals) {
    const wt = `<WorkTime><Start>${hhmm(dayStart(c.hoursPerDay))}</Start><Finish>${hhmm(dayStart(c.hoursPerDay) + c.hoursPerDay)}</Finish></WorkTime>`;
    x.push(`<Calendar><ObjectId>${calId.get(c.key)}</ObjectId>${tag('Name', `${c.code} ${c.name}`.trim())}<Type>Global</Type><HoursPerDay>${c.hoursPerDay}</HoursPerDay><HoursPerWeek>${c.hoursPerDay * (c.workWeek.split('1').length - 1)}</HoursPerWeek><IsDefault>${c.key === defKey ? 1 : 0}</IsDefault><StandardWorkWeek>`
      + [6, 0, 1, 2, 3, 4, 5].map((i) => `<StandardWorkHours><DayOfWeek>${P6_DAYS[i]}</DayOfWeek>${c.workWeek[i] === '1' ? wt : '<WorkTime xsi:nil="true"/>'}</StandardWorkHours>`).join('') + '</StandardWorkWeek>'
      + `<HolidayOrExceptions>${[...c.holidays.map((d) => [d, false]), ...c.exceptions.map((d) => [d, true])].sort((a, b) => a[0].localeCompare(b[0])).map(([d, w]) => `<HolidayOrException><Date>${d}T00:00:00</Date>${w ? wt : '<WorkTime xsi:nil="true"/>'}</HolidayOrException>`).join('')}</HolidayOrExceptions></Calendar>`);
  }
  const resId = new Map(); for (const r of model.resources) { const k = `${r.type}|${r.key}`; if (resId.has(k)) continue; resId.set(k, 500 + resId.size); x.push(`<Resource><ObjectId>${resId.get(k)}</ObjectId>${tag('Id', (r.itemCode ?? r.label).slice(0, 40))}${tag('Name', r.label)}<ResourceType>${r.type === 'MATERIAL' ? 'Material' : r.type === 'PLANT' ? 'Nonlabor' : 'Labor'}</ResourceType>${tag('UnitOfMeasureAbbreviation', r.uom)}</Resource>`); }
  x.push(`<Project><ObjectId>1</ObjectId>${tag('Id', s.docNo)}${tag('Name', s.name)}${tag('PlannedStartDate', at(s.start))}${tag('DataDate', at(s.dataDate ?? s.start))}${tag('ScheduledFinishDate', at(s.finish, true))}<ActivityDefaultCalendarObjectId>${calId.get(defKey) ?? 100}</ActivityDefaultCalendarObjectId>`);
  const wbsId = new Map(model.wbs.map((w, i) => [w.key, 1000 + i])); const used = new Set(tree(model).filter((r) => r.kind === 'wbs').map((r) => r.w.key));
  for (const w of model.wbs) if (used.has(w.key)) x.push(`<WBS><ObjectId>${wbsId.get(w.key)}</ObjectId>${w.parentKey && used.has(w.parentKey) ? `<ParentObjectId>${wbsId.get(w.parentKey)}</ParentObjectId>` : '<ParentObjectId xsi:nil="true"/>'}${tag('Code', w.code)}${tag('Name', w.name)}</WBS>`);
  const actId = new Map(model.activities.map((a, i) => [a.key, 10000 + i]));
  for (const a of model.activities) {
    const h = hoursOf.get(a.calendarKey) ?? hpd; const ms = a.type === 'MILESTONE';
    x.push(`<Activity><ObjectId>${actId.get(a.key)}</ObjectId>${tag('Id', a.code)}${tag('Name', a.name)}${a.wbsKey && used.has(a.wbsKey) ? `<WBSObjectId>${wbsId.get(a.wbsKey)}</WBSObjectId>` : ''}<CalendarObjectId>${calId.get(a.calendarKey) ?? calId.get(defKey) ?? 100}</CalendarObjectId>`
      + `<Type>${ms ? 'Finish Milestone' : a.type === 'LOE' ? 'Level of Effort' : 'Task Dependent'}</Type><Status>${a.actualFinish ? 'Completed' : a.actualStart ? 'In Progress' : 'Not Started'}</Status><PlannedDuration>${a.duration * h}</PlannedDuration>${a.remaining == null ? '' : `<RemainingDuration>${a.remaining * h}</RemainingDuration>`}`
      + `${tag('PlannedStartDate', at(a.start, false, h))}${tag('PlannedFinishDate', at(a.finish, !ms, h))}${tag('ActualStartDate', at(a.actualStart, false, h))}${tag('ActualFinishDate', at(a.actualFinish, true, h))}<PercentCompleteType>Physical</PercentCompleteType><PercentComplete>${(a.pct ?? 0) / 100}</PercentComplete><PhysicalPercentComplete>${a.pct ?? 0}</PhysicalPercentComplete>`
      + `${a.constraintType === 'NONE' ? '' : `<PrimaryConstraintType>${a.constraintType === 'SNET' ? 'Start On or After' : 'Finish On or Before'}</PrimaryConstraintType>${tag('PrimaryConstraintDate', at(a.constraintDate, a.constraintType === 'FNLT', h))}`}</Activity>`);
  }
  const calOfAct = new Map(model.activities.map((a) => [a.key, a.calendarKey])); let n = 0; for (const l of model.links) if (actId.has(l.pred) && actId.has(l.succ)) { n += 1; const h = hoursOf.get(calOfAct.get(l.pred)) ?? hpd; x.push(`<Relationship><ObjectId>${20000 + n}</ObjectId><PredecessorActivityObjectId>${actId.get(l.pred)}</PredecessorActivityObjectId><SuccessorActivityObjectId>${actId.get(l.succ)}</SuccessorActivityObjectId><Type>${P6_LINK_OUT[l.type]}</Type><Lag>${l.lag * h}</Lag></Relationship>`); }
  n = 0; for (const r of model.resources) if (actId.has(r.activity)) { n += 1; const units = r.type === 'MATERIAL' || /^h(ou)?rs?$/i.test(r.uom ?? '') ? r.qtyTotal : r.qtyTotal * hpd; x.push(`<ResourceAssignment><ObjectId>${30000 + n}</ObjectId><ActivityObjectId>${actId.get(r.activity)}</ActivityObjectId><ResourceObjectId>${resId.get(`${r.type}|${r.key}`)}</ResourceObjectId><PlannedUnits>${units}</PlannedUnits></ResourceAssignment>`); }
  x.push('</Project>', '</APIBusinessObjects>');
  return Buffer.from(x.filter(Boolean).join('\n'), 'utf8');
}

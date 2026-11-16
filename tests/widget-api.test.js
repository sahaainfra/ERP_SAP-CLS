import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { createLogger } from '../src/server/platform/http/logger.js';
import { identityOf } from '../src/server/platform/identity/index.js';
import { authzOf } from '../src/server/platform/authz/index.js';
import { createUserStore } from '../src/server/modules/iam/users.js';
import { widgetRegistry } from '../src/server/platform/widgets/index.js';
import { previousPeriod, requestsDrill, trendPct } from '../src/server/modules/ui/widget-providers.js';
import { admin, setupCompany, startApi } from './helpers.js';

// Part 03.07: the widget catalogue and data inside each person's permission and scope (T-01), the drill-down addresses against the list they open
// (T-02), a person's own dashboard that follows them (T-03), and the default of a role changed by request and approval (AC-02, AC-05).
const U = '/api/v1/ui';
const I = '/api/v1/iam';
const PW = 'Tr0ub4dor&3-Excavator';
const json = { 'content-type': 'application/json' };
const key = (k) => ({ ...json, 'idempotency-key': `wid-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const pm = as('PM', 'pm1');
const acc = as('ACCMGR', 'acc1');
const sys = as('SYSADM', 'sys1');
const sys2 = as('SYSADM', 'sys2');
const pcm = as('PCMGR', 'pcm1');
const emp = as('EMP', 'emp1');
const today = '2026-10-31';
const wide = { from: '2026-04-01', to: '2027-03-31' };
const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined)).toString();

async function world(api, { extraProject = false } = {}) {
  await setupCompany(api, { company: '1' });
  const mr = await api.call('POST', '/api/v1/core/number-series', { ...admin('1'), headers: key('n'), body: { docType: 'SAMPLE_MR', name: 'Sample material requests', prefix: 'MR', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' } });
  assert.equal(mr.status, 201, JSON.stringify(mr.json));
  const mkProject = async (code, name, lat) => {
    const project = (await api.call('POST', `${I}/org/projects`, { ...pm, headers: key(`p${code}`), body: { code, name, type: 'ROAD' } })).json.data;
    const site = (await api.call('POST', `${I}/org/sites`, { ...pm, headers: key(`s${code}`), body: { code: `${code}-S1`, name: `${name} camp`, projectId: project.id, ...(lat ? { latitude: lat, longitude: 73.8 } : {}) } })).json.data;
    return { project, site };
  };
  const a = await mkProject('NH1', 'NH-48 Widening', 18.5);
  const b = extraProject ? await mkProject('RR2', 'Ring Road Phase 2', 19.1) : null;
  return { a, b };
}
const raise = async (api, w, { title = 'Footing F3', project, submit = false, priority = 'NORMAL', who = pm, requiredBy = '2026-11-20', docDate = today } = {}) => {
  const p = project ?? w.a;
  const r = (await api.call('POST', `${U}/sample-requests`, { ...who, headers: key('mk'), body: { title, docDate, requiredBy, projectId: p.project.id, siteId: p.site.id, priority, returnable: false, ...(priority === 'URGENT' ? { urgencyReason: 'The pour is tomorrow' } : {}), lines: [{ description: 'TMT bar', uom: 'MT', quantity: '2', unitRate: '58000' }] } })).json.data;
  assert.ok(r?.id, JSON.stringify(r));
  return submit ? (await api.call('POST', `${U}/sample-requests/${r.id}/submit`, { ...who, headers: key('sub'), body: { version: r.version } })).json.data : r;
};
const data = (api, who, code, extra = {}) => api.call('GET', `${U}/widgets/${code}/data?${q({ ...wide, ...extra })}`, who);
const act = (api, who, id, action = 'approve', comment = 'checked and fine') => api.call('POST', `/api/v1/core/change-requests/${id}/act`, { ...who, headers: key('act'), body: { action, comment } });

test('FR-02 every widget of the registry has a provider and every provider a widget; the catalogue follows the permission', async () => {
  const api = await startApi();
  await world(api);
  const rows = api.db.prepare('SELECT code, permission_key, type FROM ui_widgets WHERE is_active = 1').all();
  assert.deepEqual(rows.map((r) => r.code).sort(), widgetRegistry.codes(), 'the registry and the providers match');
  assert.ok(rows.length >= 23);
  const types = new Set(rows.map((r) => r.type));
  for (const t of ['kpi', 'line', 'bar', 'stacked', 'area', 'donut', 'gauge', 'heatmap', 'gantt', 'table', 'alerts', 'list', 'calendar', 'map', 'notice', 'actions']) assert.ok(types.has(t), `a widget of type ${t}`);
  const cat = async (who) => (await api.call('GET', `${U}/widgets`, who)).json.data.map((w) => w.code);
  const empCodes = await cat(emp);
  assert.deepEqual(empCodes.sort(), rows.filter((r) => r.permission_key === 'self').map((r) => r.code).sort(), 'a person with no role rights has the widgets open to everyone');
  const pmCodes = await cat(pm);
  assert.ok(pmCodes.includes('requests.submitted') && pmCodes.includes('sites.map') && !pmCodes.includes('approvals.timeliness'));
  assert.ok((await cat(acc)).includes('approvals.timeliness'));
  const w = (await api.call('GET', `${U}/widgets`, pm)).json.data.find((x) => x.code === 'notice.text');
  assert.deepEqual([w.type, w.defaultW, w.refreshSec], ['notice', 6, 0]);
  await api.close();
});

test('BR-01 BR-02 widget data comes from the register inside the person\'s permission; a widget the role may not use is refused; nothing is invented', async () => {
  const api = await startApi();
  const w = await world(api, { extraProject: true });
  assert.equal((await data(api, pm, 'requests.submitted')).json.data.data.value, 0, 'nothing submitted yet: zero, not a placeholder');
  await raise(api, w, { title: 'Draft one' });
  await raise(api, w, { title: 'Sent one', submit: true });
  await raise(api, w, { title: 'Sent two', submit: true, project: w.b, priority: 'URGENT' });
  const get = async (code, who = pm, extra) => (await data(api, who, code, extra)).json.data;
  const k = await get('requests.submitted');
  assert.deepEqual([k.type, k.data.value, k.data.unit, k.data.previous, k.data.trendPct], ['kpi', 2, 'requests', 0, null]);
  assert.equal((await get('requests.mine_open')).data.value, 3, 'the draft and the two submitted');
  assert.equal((await get('requests.mine_open', acc)).data.value, 0, 'nobody else\'s');
  const st = (await get('requests.by_status')).data;
  assert.deepEqual(st.slices.map((s) => [s.label, s.value]), [['Submitted', 2], ['Draft', 1]]);
  assert.equal(st.total, 3);
  const bp = (await get('requests.by_project')).data;
  assert.deepEqual([bp.categories, bp.series[0].values], [['NH1', 'RR2'], [2, 1]]);
  const pr = (await get('requests.by_priority')).data;
  assert.deepEqual(pr.series.map((s) => [s.name, s.values]), [['Normal', [2, 0]], ['Urgent', [0, 1]]]);
  const hm = (await get('requests.heatmap')).data;
  assert.deepEqual([hm.rows, hm.cols, hm.cells.length], [['NH1', 'RR2'], ['Draft', 'Submitted', 'Cancelled'], 6]);
  assert.equal(hm.cells.find((c) => c.row === 0 && c.col === 1).value, 1);
  const trend = (await get('requests.trend')).data;
  assert.deepEqual([trend.categories, trend.series[0].values, trend.series[1].values], [['2026-10'], [3], [2]]);
  assert.deepEqual((await get('requests.scurve')).data.series[0].values, [3]);
  assert.equal((await get('requests.gantt')).data.rows.length, 3);
  assert.equal((await get('requests.gantt')).data.rows[0].end, '2026-11-20');
  // the value is a commercial value: shown to the project manager, masked for the system administrator
  assert.equal((await get('requests.value')).data.display ?? (await get('requests.value')).data.value, '232000.00');
  assert.equal((await get('requests.value', sys)).data.masked, true);
  const top = (await get('requests.top')).data;
  assert.deepEqual([top.masked, top.rows[0].value], [false, '116000.00']);
  const topMasked = (await get('requests.top', sys)).data;
  assert.deepEqual([topMasked.masked, topMasked.rows.map((r) => r.value)], [true, ['•••', '•••', '•••']], 'values are masked, and the order does not give them away');
  // a past needed-by date is an exception
  await raise(api, w, { title: 'Late one', requiredBy: '2026-10-01', docDate: '2026-09-20' });
  const od = (await get('requests.overdue')).data;
  assert.deepEqual([od.total, od.rows[0].title.includes('Late one')], [1, true]);
  // refusals
  assert.equal((await data(api, emp, 'requests.submitted')).status, 403, 'no right to use the register');
  assert.match((await data(api, emp, 'requests.submitted')).json.error.message, /core\.sample\.use/);
  assert.equal((await data(api, pm, 'requests.nothing')).status, 404);
  assert.equal((await data(api, pm, 'requests.submitted', { from: '2027-04-01', to: '2026-04-01' })).status, 400);
  assert.equal((await data(api, pm, 'requests.submitted', { projectId: 99999 })).status, 403, 'not a project the person can work in');
  assert.equal((await data(api, pm, 'requests.submitted', { projectId: w.a.project.id, siteId: w.b.site.id })).status, 400, 'a site of another project');
  assert.equal((await api.call('GET', `${U}/widgets/requests.top/data?${q({ ...wide, params: 'not json' })}`, pm)).status, 400);
  assert.equal((await get('requests.submitted', pm, { projectId: w.b.project.id })).data.value, 1, 'the project filter narrows every widget');
  // an unknown filter is refused, not ignored
  assert.equal((await api.call('GET', `${U}/widgets/requests.submitted/data?bogus=1`, pm)).status, 400);
  await api.close();
});

test('T-02 FR-05 the address a KPI, a slice or a bar opens lists the same requests: its count equals the widget\'s value', async () => {
  const api = await startApi();
  const w = await world(api, { extraProject: true });
  await raise(api, w, { title: 'Draft one' });
  await raise(api, w, { title: 'Sent one', submit: true });
  await raise(api, w, { title: 'Sent two', submit: true, project: w.b, priority: 'URGENT' });
  await raise(api, w, { title: 'Sent three', submit: true, project: w.b });
  const total = async (drill) => {
    const url = new URL(drill, 'http://x');
    assert.equal(url.pathname, '/admin/sample-requests');
    const res = await api.call('GET', `${U}/sample-requests?${url.searchParams.toString()}&pageSize=200`, pm);
    assert.equal(res.status, 200, `${drill}: ${JSON.stringify(res.json)}`);
    return res.json.meta.total;
  };
  const get = async (code, extra) => (await data(api, pm, code, extra)).json.data.data;
  const submitted = await get('requests.submitted');
  assert.equal(await total(submitted.drill), submitted.value, 'KPI: submitted');
  assert.equal(await total((await get('requests.mine_open')).drill), (await get('requests.mine_open')).value, 'KPI: mine');
  for (const s of (await get('requests.by_status')).slices) assert.equal(await total(s.drill), s.value, `slice ${s.label}`);
  const bars = (await get('requests.by_project')).series[0];
  bars.drill.forEach(async () => {});
  for (let i = 0; i < bars.values.length; i += 1) assert.equal(await total(bars.drill[i]), bars.values[i], `bar ${i}`);
  for (const s of (await get('requests.by_priority')).series) for (let i = 0; i < s.values.length; i += 1) assert.equal(await total(s.drill[i]), s.values[i], `${s.name} ${i}`);
  for (const c of (await get('requests.heatmap')).cells) assert.equal(await total(c.drill), c.value, `cell ${c.row},${c.col}`);
  // the project filter of the dashboard travels with the drill address
  const narrowed = await get('requests.submitted', { projectId: w.b.project.id });
  assert.equal(narrowed.value, 2);
  assert.equal(await total(narrowed.drill), 2);
  assert.match(narrowed.drill, /filter%5BprojectCode%5D=RR2/);
  await api.close();
});

test('FR-01 the KPI says how it changed from the period before, and the timeliness gauge compares decided approvals with the target', async () => {
  const api = await startApi();
  const w = await world(api);
  await raise(api, w, { title: 'Sent in October', submit: true });
  await raise(api, w, { title: 'Sent in September', submit: true, docDate: '2026-09-15' });
  await raise(api, w, { title: 'Sent in September too', submit: true, docDate: '2026-09-16' });
  const kpi = (await data(api, pm, 'requests.submitted', { from: '2026-10-01', to: '2026-10-31' })).json.data.data;
  assert.deepEqual([kpi.value, kpi.previous], [1, 2], 'the period before is September');
  assert.equal(kpi.trendPct, -50);
  assert.equal((await data(api, pm, 'requests.submitted', { from: '2026-10-01', to: '2026-10-31' })).json.data.filters.from, '2026-10-01');
  // approvals: none decided yet, then one decided in time
  const empty = (await data(api, acc, 'approvals.timeliness')).json.data.data;
  assert.deepEqual([empty.value, empty.target, empty.unit], [null, 90, '%']);
  const waiting = (await data(api, acc, 'approvals.waiting')).json.data.data;
  assert.deepEqual([waiting.value, waiting.status], [3, 'amber']);
  const list = (await data(api, acc, 'approvals.list')).json.data.data;
  assert.equal(list.rows.length, 3);
  assert.match(list.rows[0].drill, /\/admin\/sample-requests\?open=/);
  assert.equal((await data(api, pm, 'approvals.waiting')).json.data.data.value, 0, 'the requester has nothing to decide');
  const approval = api.db.prepare("SELECT id, target_id FROM core_change_requests WHERE type = 'sample_request_approval' ORDER BY id LIMIT 1").get();
  const decided = await api.call('POST', `/api/v1/ui/sample-requests/${approval.target_id}/decision`, { ...acc, headers: key('dec'), body: { action: 'return', comment: 'Please check the quantities', reasonCode: 'CORRECT_QUANTITY', version: 1 } });
  assert.equal(decided.status, 200, JSON.stringify(decided.json));
  const gauge = (await data(api, acc, 'approvals.timeliness')).json.data.data;
  assert.deepEqual([gauge.value, gauge.status, gauge.decided], [100, 'green', 1]);
  await api.close();
});

test('FR-07 the calendar, the notice, the quick actions, the task and mention lists and the map are real data or an empty state', async () => {
  const api = await startApi();
  const w = await world(api);
  api.db.prepare("INSERT INTO core_holiday_calendars (id, company_id, code, name) VALUES (1, 1, 'DEFAULT', 'Default')").run();
  api.db.prepare("INSERT INTO core_holidays (company_id, calendar_id, holiday_date, name, type) VALUES (1, 1, '2026-11-14', 'Guru Nanak Jayanti', 'national')").run();
  const r = await raise(api, w, { title: 'Needed on the fifth', requiredBy: '2026-11-05' });
  const cal = (await data(api, pm, 'calendar.month', { params: JSON.stringify({ month: '2026-11' }) })).json.data.data;
  assert.equal(cal.month, '2026-11');
  assert.deepEqual(cal.events.map((e) => [e.date, e.kind]), [['2026-11-05', 'needed'], ['2026-11-14', 'holiday']]);
  assert.match(cal.events[0].drill, new RegExp(`open=${r.id}`));
  assert.deepEqual((await data(api, pm, 'calendar.month', { params: JSON.stringify({ month: '2026-12' }) })).json.data.data.events, []);
  assert.equal((await data(api, pm, 'calendar.month', { params: JSON.stringify({ month: '2026-13' }) })).json.data.data.month.length, 7, 'a bad month falls back to this month');
  // quick actions follow what the role may create
  assert.ok((await data(api, pm, 'actions.quick')).json.data.data.actions.some((a) => a.label === 'New sample material request'));
  assert.equal((await data(api, emp, 'actions.quick')).json.data.data.actions.some((a) => a.label === 'New sample material request'), false);
  // a notice is what an administrator wrote, cut to its length
  assert.equal((await data(api, pm, 'notice.text', { params: JSON.stringify({ text: 'Safety stand-down on Friday' }) })).json.data.data.text, 'Safety stand-down on Friday');
  // no task engine yet: an empty list, not an invented one
  assert.deepEqual((await data(api, pm, 'tasks.mine')).json.data.data, { rows: [], total: 0, drill: null });
  // a mention shows up for the person mentioned, on a record they may open
  api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, email, status, created_by, source_type) VALUES (1, 'acc1', 'Acc One', 'acc1@example.com', 'ACTIVE', 't', 'test')").run();
  const comment = await api.call('POST', `${U}/objects/sample_request/${r.id}/comments`, { ...pm, headers: key('c'), body: { body: 'Please look at this @acc1' } });
  assert.equal(comment.status, 201, JSON.stringify(comment.json));
  const m = (await data(api, acc, 'mentions.mine')).json.data.data;
  assert.deepEqual([m.total, m.rows[0]?.title], [1, 'Please look at this @acc1']);
  assert.equal((await data(api, pm, 'mentions.mine')).json.data.data.total, 0, 'the author is not told of their own comment');
  // the map draws the sites that have a position
  const map = (await data(api, pm, 'sites.map')).json.data.data;
  assert.deepEqual(map.points.map((p) => p.label), ['NH1-S1']);
  assert.deepEqual([map.points[0].lat, map.points[0].lng], [18.5, 73.8]);
  assert.deepEqual((await data(api, pm, 'projects.mine')).json.data.data.rows.map((x) => x.title), ['NH1 NH-48 Widening']);
  await api.close();
});

test('FR-03 T-03 a person\'s own copy of a dashboard is kept on the server, follows them to another device, and can be reset; mistakes are refused', async () => {
  const api = await startApi();
  await world(api);
  const get = async (who, code = 'my-work') => (await api.call('GET', `${U}/dashboards/${code}`, who)).json.data;
  const system = await get(pm);
  assert.deepEqual([system.source, system.hasPersonal, system.version], ['system', false, null]);
  assert.ok(system.layout.length >= 10 && system.layout.every((i) => i.id && i.widget && i.w >= 1 && i.h >= 1));
  assert.ok(!system.layout.some((i) => i.widget === 'approvals.timeliness'), 'a widget the role may not use is left out');
  assert.ok(system.omitted >= 1);
  // the list of dashboards: the register's overview needs the register's right
  // the overview pages of part 166.5 (ov-*) and Home insights are listed too, each for those who may open its page
  const own = (rows) => rows.map((d) => d.code).filter((c) => !c.startsWith('ov-') && c !== 'home-insights');
  const pmList = (await api.call('GET', `${U}/dashboards`, pm)).json.data.map((d) => d.code);
  assert.deepEqual(own((await api.call('GET', `${U}/dashboards`, pm)).json.data), ['my-work', 'requests-overview']);
  assert.ok(pmList.includes('home-insights') && pmList.includes('ov-qs') && !pmList.includes('ov-hr'), pmList.join(','));
  assert.deepEqual(own((await api.call('GET', `${U}/dashboards`, emp)).json.data), ['my-work']);
  assert.equal((await api.call('GET', `${U}/dashboards/requests-overview`, emp)).status, 403);
  assert.equal((await api.call('GET', `${U}/dashboards/nothing-here`, pm)).status, 404);
  // the person changes their layout on one device
  const mine = system.layout.slice(0, 4).reverse().concat([{ id: 'n1', widget: 'notice.text', w: 12, h: 1, params: { title: 'Site', text: 'Safety stand-down on Friday' } }]);
  const save = await api.call('PUT', `${U}/dashboards/my-work/personal`, { ...pm, headers: json, body: { layout: mine, filters: { preset: 'this_quarter' } } });
  assert.equal(save.status, 200, JSON.stringify(save.json));
  assert.deepEqual([save.json.data.source, save.json.data.version, save.json.data.layout.map((i) => i.id)], ['personal', 1, mine.map((i) => i.id)]);
  // another device (a new request, nothing in common but the person) sees the same
  const other = await get(pm);
  assert.deepEqual([other.source, other.layout.map((i) => i.widget), other.filters.preset], ['personal', mine.map((i) => i.widget), 'this_quarter']);
  assert.deepEqual(other.layout.at(-1).params, { title: 'Site', text: 'Safety stand-down on Friday' });
  assert.equal((await get(as('PM', 'pm2'))).source, 'system', 'another person is not affected');
  // a stale copy is a conflict, not an overwrite
  const stale = await api.call('PUT', `${U}/dashboards/my-work/personal`, { ...pm, headers: json, body: { layout: mine.slice(0, 2), filters: {}, version: 7 } });
  assert.equal(stale.status, 409);
  const again = await api.call('PUT', `${U}/dashboards/my-work/personal`, { ...pm, headers: json, body: { layout: mine.slice(0, 2), filters: {}, version: 1 } });
  assert.deepEqual([again.status, again.json.data.version], [200, 2]);
  // refusals
  const bad = async (layout, status, re) => {
    const r = await api.call('PUT', `${U}/dashboards/my-work/personal`, { ...pm, headers: json, body: { layout, filters: {} } });
    assert.equal(r.status, status, JSON.stringify(r.json));
    assert.match(JSON.stringify(r.json.error), re);
  };
  await bad([{ id: 'a', widget: 'no.such', w: 3, h: 1 }], 400, /not a widget of this application/);
  await bad([{ id: 'a', widget: 'drafts.mine', w: 13, h: 1 }], 400, /w|13|too big/i);
  await bad([{ id: 'a', widget: 'drafts.mine', w: 3, h: 1 }, { id: 'a', widget: 'tasks.mine', w: 3, h: 1 }], 400, /own id/);
  await bad([{ id: 'a', widget: 'notice.text', w: 6, h: 1, params: { text: '' } }], 400, /Write the notice/);
  await bad([{ id: 'a', widget: 'drafts.mine', w: 3, h: 1, params: { x: 1 } }], 400, /takes no settings/);
  await bad([{ id: 'a', widget: 'approvals.timeliness', w: 4, h: 2 }], 403, /may not use the widget/);
  await bad(Array.from({ length: 41 }, (_, i) => ({ id: `i${i}`, widget: 'drafts.mine', w: 3, h: 1 })), 400, /40|too many|at most/i);
  // reset: the default of the role again
  const reset = await api.call('DELETE', `${U}/dashboards/my-work/personal`, pm);
  assert.deepEqual([reset.status, reset.json.data.source], [200, 'system']);
  assert.equal((await api.call('DELETE', `${U}/dashboards/my-work/personal`, pm)).status, 404);
  assert.ok(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'ui_dashboards' AND action IN ('create', 'update', 'reset')").get().n >= 3, 'copies are audited');
  await api.close();
});

test('AC-02 AC-05 the default of a role is a request another administrator approves, and then new people of that role get it; the request, the change and its history are audited', async () => {
  const api = await startApi();
  await world(api);
  const D = `${U}/dashboards/my-work`;
  const layout = [{ id: 'a', widget: 'approvals.waiting', w: 6, h: 1 }, { id: 'b', widget: 'drafts.mine', w: 6, h: 1 }, { id: 'c', widget: 'notice.text', w: 12, h: 1, params: { text: 'Welcome to the site team' } }];
  const propose = (who, body) => api.call('POST', `${D}/role-defaults`, { ...who, headers: key('rd'), body: { role: 'PM', layout, filters: {}, reason: 'Project managers start with their approvals', ...body } });
  assert.equal((await propose(pm, {})).status, 403, 'a project manager does not set defaults');
  assert.equal((await api.call('GET', `${D}/role-defaults`, pm)).status, 403);
  assert.equal((await api.call('GET', `${D}/history?role=PM`, pm)).status, 403);
  assert.equal((await propose(pcm, { role: 'NOPE' })).status, 400, 'a role that does not exist');
  assert.equal((await propose(pcm, { reason: 'no' })).status, 400, 'a reason is needed');
  assert.equal((await propose(pcm, { layout: [{ id: 'a', widget: 'no.such', w: 3, h: 1 }] })).status, 400);
  const asked = await propose(pcm, {});
  assert.equal(asked.status, 201, JSON.stringify(asked.json));
  assert.equal(asked.json.data.status, 'SUBMITTED');
  assert.equal((await propose(sys, {})).status, 409, 'one open request per role and dashboard');
  const overview = (await api.call('GET', `${D}/role-defaults`, pcm)).json.data;
  assert.deepEqual([overview.pending.length, overview.roles.length, overview.system.layout.length >= 10], [1, 0, true]);
  assert.ok(overview.roleCodes.some((r) => r.code === 'PM') && overview.catalogue.length >= 10);
  // nothing changes before it is approved
  assert.equal((await api.call('GET', D, pm)).json.data.source, 'system');
  assert.equal((await act(api, pcm, asked.json.data.id)).status, 403, 'the maker cannot be the checker');
  assert.equal((await act(api, pm, asked.json.data.id)).status, 403);
  const approved = await act(api, sys, asked.json.data.id);
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  // a person of the role who has never saved a copy gets it; people of other roles do not
  const fresh = (await api.call('GET', D, as('PM', 'brand-new'))).json.data;
  assert.deepEqual([fresh.source, fresh.roleCode, fresh.layout.map((i) => i.widget)], ['role', 'PM', ['approvals.waiting', 'drafts.mine', 'notice.text']]);
  assert.equal((await api.call('GET', D, acc)).json.data.source, 'system');
  // a copy of their own wins over the default
  await api.call('PUT', `${D}/personal`, { ...pm, headers: json, body: { layout: layout.slice(0, 1), filters: {} } });
  assert.equal((await api.call('GET', D, pm)).json.data.source, 'personal');
  // change it, and see the old and new in the history
  const second = await propose(sys, { layout: layout.slice(0, 2), reason: 'Leave the notice off' });
  assert.equal(second.status, 201, JSON.stringify(second.json));
  assert.equal((await act(api, sys2, second.json.data.id)).status, 200);
  const hist = (await api.call('GET', `${D}/history?role=PM`, sys)).json.data;
  assert.deepEqual([hist[0].action, hist[0].oldValues.widgets, hist[0].newValues.widgets, hist[0].reason], ['update', ['approvals.waiting', 'drafts.mine', 'notice.text'], ['approvals.waiting', 'drafts.mine'], 'Leave the notice off']);
  assert.equal(hist[1].action, 'create');
  assert.equal((await propose(sys, { layout: layout.slice(0, 2), reason: 'The same again' })).status, 422, 'nothing different');
  // a request raised on an old version is refused when it is approved
  const third = await propose(sys, { layout: layout.slice(0, 1), reason: 'Only approvals' });
  api.db.prepare("UPDATE ui_dashboards SET version = version + 1 WHERE owner_type = 'role' AND owner_ref = 'PM'").run();
  const refused = await act(api, sys2, third.json.data.id);
  assert.equal(refused.status, 422);
  assert.match(JSON.stringify(refused.json.error), /changed after this request/);
  // remove it: people of the role see the system layout again
  assert.equal((await api.call('POST', `/api/v1/core/change-requests/${third.json.data.id}/withdraw`, { ...sys, headers: key('wd'), body: {} })).status, 200, 'the maker takes the refused request back');
  const gone = await propose(sys, { remove: true, layout: undefined, reason: 'Back to the standard layout' });
  assert.equal(gone.status, 201, JSON.stringify(gone.json));
  assert.equal((await act(api, sys2, gone.json.data.id)).status, 200);
  assert.equal((await api.call('GET', D, as('PM', 'brand-new'))).json.data.source, 'system');
  assert.equal((await propose(sys, { remove: true, reason: 'There is none to remove' })).status, 422);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'ui.dashboard.changed'").get().n, 3);
  await api.close();
});

test('T-01 a widget shows only the data inside the person\'s project scope, and a project outside it is refused', async () => {
  const clock = { t: Date.parse('2026-10-30T10:00:00.000Z') };
  const api = await startApi({ AUTH_MODE: 'iam' }, { logger: createLogger({ write: () => {} }), identityOptions: { passwordCost: { memory: 8, passes: 1 }, now: () => clock.t } });
  const identity = identityOf(api.db);
  const store = createUserStore({ db: api.db, identity });
  api.db.prepare("INSERT INTO iam_auth_policy (company_id, settings_json, created_by, source_type) VALUES (1, ?, 'test', 'seed')").run(JSON.stringify({ mfa: { enforced: false } }));
  const http = async (method, path, { token, body, headers = {} } = {}) => {
    const res = await fetch(api.base + path, { method, headers: { 'content-type': 'application/json', 'x-token-delivery': 'body', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let j;
    try { j = text ? JSON.parse(text) : null; } catch { j = null; }
    return { status: res.status, json: j, text };
  };
  const person = async (username, roles) => {
    await store.create({ companyId: 1, username, email: `${username}@example.com`, displayName: `${username} Kumar`, roles, password: PW });
    const token = (await http('POST', `${I}/auth/login`, { body: { username, password: PW, deviceId: 'device-aaaaaaaa', deviceName: 'Laptop' } })).json?.data?.accessToken;
    assert.ok(token, `${username} signs in`);
    return { token, get: (p) => http('GET', p, { token }) };
  };
  const pamIn = await person('pam', ['EMP']);
  const boss = await person('boss', ['SYSADM']);
  // the world: two projects, requests in each, made straight in the register by the owners of the data
  const org = api.db;
  org.prepare("INSERT INTO org_companies (id, code, legal_name, short_name, created_by, source_type) SELECT 1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test' WHERE NOT EXISTS (SELECT 1 FROM org_companies WHERE id = 1)").run();
  const mkProject = (code) => Number(org.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 't', 'test')").run(code, `Project ${code}`).lastInsertRowid);
  const a = mkProject('ALP');
  const b = mkProject('BRV');
  const mkSite = (project, code) => Number(org.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, created_by, source_type) VALUES (1, ?, ?, ?, 'ACTIVE', 18.5, 73.8, 't', 'test')").run(project, code, `Site ${code}`).lastInsertRowid);
  const sa = mkSite(a, 'ALP-1');
  const sb = mkSite(b, 'BRV-1');
  const req = (project, site, n, status = 'SUBMITTED') => org.prepare("INSERT INTO ui_sample_requests (company_id, title, doc_date, required_by, project_id, site_id, status, priority, requested_by, total_amount, line_count, created_by, source_type) VALUES (1, ?, '2026-10-31', '2026-11-20', ?, ?, ?, 'NORMAL', 'someone', 100000, 1, 't', 'test')").run(`Request ${n}`, project, site, status);
  req(a, sa, 1); req(a, sa, 2); req(b, sb, 3); req(b, sb, 4); req(b, sb, 5, 'DRAFT');
  // pam manages the project ALP only; the system administrator is company-wide
  const pamId = Number(org.prepare('SELECT id FROM iam_users WHERE username = ?').get('pam').id);
  const pmRole = Number(org.prepare('SELECT id FROM iam_roles WHERE code = ? AND company_id IS NULL').get('PM').id);
  org.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, effective_from, status, reason, created_by, source_type) VALUES (1, ?, ?, 'PROJECT', ?, '2026-01-01', 'ACTIVE', 'Runs the Alpha road project', 't', 'test')").run(pamId, pmRole, JSON.stringify([a]));
  authzOf(org).invalidate();
  const pamData = async (code, extra = {}) => (await pamIn.get(`${U}/widgets/${code}/data?${q({ ...wide, ...extra })}`));
  const bossData = async (code, extra = {}) => (await boss.get(`${U}/widgets/${code}/data?${q({ ...wide, ...extra })}`));
  assert.equal((await pamData('requests.submitted')).json.data.data.value, 2, 'only the requests of her project');
  assert.equal((await bossData('requests.submitted')).json.data.data.value, 4, 'the company-wide role sees every project');
  assert.equal((await bossData('requests.value')).json.data.data.masked, true, 'and still not the values');
  assert.deepEqual((await pamData('requests.value')).json.data.data.value, '2000.00', 'the project manager sees the values of her project only');
  const byProject = (await pamData('requests.by_project')).json.data.data;
  assert.deepEqual([byProject.categories, byProject.series[0].values], [['ALP'], [2]]);
  assert.deepEqual((await pamData('requests.by_status')).json.data.data.slices.map((s) => [s.label, s.value]), [['Submitted', 2]]);
  assert.deepEqual((await pamData('requests.heatmap')).json.data.data.rows, ['ALP']);
  assert.deepEqual((await pamData('projects.mine')).json.data.data.rows.map((r) => r.title), ['ALP Project ALP']);
  assert.deepEqual((await pamData('sites.map')).json.data.data.points.map((p) => p.label), ['ALP-1']);
  assert.equal((await pamData('requests.submitted', { projectId: b })).status, 403, 'asking for the other project is refused, not answered with zero');
  assert.equal((await pamData('requests.submitted', { projectId: a, siteId: sa })).json.data.data.value, 2);
  assert.equal((await pamData('requests.submitted', { projectId: a, siteId: sb })).status, 400);
  // the whole company sees all of it
  const bossAll = await boss.get(`${U}/widgets/projects.mine/data?${q(wide)}`);
  assert.deepEqual(bossAll.json.data.data.rows.map((r) => r.title), ['ALP Project ALP', 'BRV Project BRV']);
  await api.close();
});

test('the pure rules: the period before, the change in percent, and the address of a list with filters', () => {
  assert.deepEqual(previousPeriod({ from: '2026-10-01', to: '2026-10-31' }), { from: '2026-08-31', to: '2026-09-30' });
  assert.deepEqual(previousPeriod({ from: '2026-04-01', to: '2027-03-31' }), { from: '2025-04-01', to: '2026-03-31' });
  assert.deepEqual(previousPeriod({ from: '2026-11-02', to: '2026-11-02' }), { from: '2026-11-01', to: '2026-11-01' });
  assert.equal(trendPct(3, 2), 50);
  assert.equal(trendPct(1, 2), -50);
  assert.equal(trendPct(2, 2), 0);
  assert.equal(trendPct(5, 0), null, 'nothing to compare with');
  assert.equal(requestsDrill({}), '/admin/sample-requests');
  const u = new URL(requestsDrill({ status: ['DRAFT', 'SUBMITTED'], projectCode: 'NH1', from: '2026-04-01', to: '2027-03-31', mine: true, user: 'pm1' }), 'http://x');
  assert.deepEqual([...u.searchParams.entries()], [['filter[status][in]', 'DRAFT,SUBMITTED'], ['filter[projectCode]', 'NH1'], ['filter[docDate][between]', '2026-04-01,2027-03-31'], ['filter[requestedBy]', 'pm1']]);
  assert.equal(new URL(requestsDrill({ status: 'SUBMITTED' }), 'http://x').searchParams.get('filter[status]'), 'SUBMITTED');
});

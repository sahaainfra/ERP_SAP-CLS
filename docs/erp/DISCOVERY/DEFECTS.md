# DEFECTS (scan output)

Placeholder/dummy markers found by scan (FR-06): 90

The curated defect register is `docs/erp/DEFECTS.md`.

| ID | File | Line | Text |
|---|---|---|---|
| S-001 | e2e/overviews-p16605.spec.js | 97 | await expect(insights.getByTestId('widget-ov.todo.mine')).toBeVisible(); |
| S-002 | e2e/overviews-p16605.spec.js | 98 | await expect(insights.getByTestId('widget-ov.todo.mine')).toContainText('Nothing |
| S-003 | e2e/pages.spec.js | 12 | const PLACEHOLDER = /lorem ipsum/\bTODO\b/\bFIXME\b/coming soon/under constructi |
| S-004 | migrations/20261211000330_ui_p16605.down.sql | 3 | DELETE FROM ui_widgets WHERE code IN ('ov.qs.unbilled_wip', 'ov.qs.certified_not |
| S-005 | migrations/20261211000330_ui_p16605.up.sql | 15 | type               TEXT    NOT NULL CHECK (type IN ('kpi', 'line', 'bar', 'stack |
| S-006 | migrations/20261211000330_ui_p16605.up.sql | 97 | INSERT OR IGNORE INTO ui_widgets (code, module, title, description, type, data_e |
| S-007 | migrations/20261211000330_ui_p16605.up.sql | 108 | INSERT OR IGNORE INTO ui_dashboards (company_id, code, name, owner_type, owner_r |
| S-008 | migrations/20261212000331_hr_p0714.up.sql | 70 | INSERT OR IGNORE INTO ui_widgets (code, module, title, description, type, data_e |
| S-009 | migrations/20261227000403_role_dashboards.up.sql | 26 | VALUES (NULL, 'role-dashboard', 'My role dashboard', 'system', 'system', 'self', |
| S-010 | src/client/modules/admin/Control.jsx | 198 | <span className="adm-step-no" aria-hidden="true">{i + 1}</span><div><strong>{t(` |
| S-011 | src/client/modules/ai/AiFeatures.jsx | 83 | {!ev ? <p className="muted">{t('e.none')}</p> : <ul className="wd-todo" data-tes |
| S-012 | src/client/modules/ai/AiFeatures.jsx | 118 | <ul className="wd-todo">{f.versions.map((v) => <li key={v.id}><Link to={`/ai/fea |
| S-013 | src/client/modules/ai/Assistant.jsx | 104 | {(list.data ?? []).filter((d) => d.status !== 'PROPOSED').length > 0 && <details |
| S-014 | src/client/modules/bi/ControlTower.jsx | 137 | : <ul className="wd-todo"> |
| S-015 | src/client/modules/bi/Execution.jsx | 67 | {d.exceptions.length === 0 ? <EmptyState compact title={t('c.noExceptions')} />  |
| S-016 | src/client/modules/bi/Leakage.jsx | 59 | <ul className="wd-todo"> |
| S-017 | src/client/modules/bi/MonthlyClose.jsx | 72 | <ul className="wd-todo">{d.cards.filter((c) => c.column === key).map(cardView)}< |
| S-018 | src/client/modules/bi/MorningReport.jsx | 105 | : <ul className="wd-todo">{s.exceptions.slice(0, 10).map((e) => <li key={e.text} |
| S-019 | src/client/modules/bi/RoleDashboards.jsx | 109 | {!d.scan.findings.length ? <EmptyState compact title={t('inv.clean')} message={t |
| S-020 | src/client/modules/bi/Scenarios.jsx | 97 | <ul className="wd-todo" data-testid="scn-effects">{preview.data.effects.map((e,  |
| S-021 | src/client/modules/bi/Scenarios.jsx | 145 | {one.data.actions.length > 0 && <ul className="wd-todo" data-testid="scn-actions |
| S-022 | src/client/modules/pol/MyPoliciesPage.jsx | 51 | const [tab, setTab] = useState('todo'); |
| S-023 | src/client/modules/pol/MyPoliciesPage.jsx | 57 | const rows = tab === 'todo' ? d.rows.filter((r) => r.status !== 'ACKNOWLEDGED')  |
| S-024 | src/client/modules/pol/MyPoliciesPage.jsx | 63 | {[['todo', `To acknowledge (${d.counts.toAcknowledge})`], ['done', `Acknowledged |
| S-025 | src/client/modules/pol/MyPoliciesPage.jsx | 65 | {rows.length === 0 ? <EmptyState title={tab === 'todo' ? 'Nothing to acknowledge |
| S-026 | src/client/platform/dashboard/WidgetBody.jsx | 186 | function Todo({ data, onDrill }) { |
| S-027 | src/client/platform/dashboard/WidgetBody.jsx | 197 | <ul className="wd-todo" data-testid="todo"> |
| S-028 | src/client/platform/dashboard/WidgetBody.jsx | 201 | {r.facts?.length > 0 && <span className="wd-todo-facts muted small">{r.facts.joi |
| S-029 | src/client/platform/dashboard/WidgetBody.jsx | 203 | <form className="wd-todo-return" onSubmit={(e) => { e.preventDefault(); if (reas |
| S-030 | src/client/platform/dashboard/WidgetBody.jsx | 209 | <span className="wd-todo-actions"> |
| S-031 | src/client/platform/dashboard/WidgetBody.jsx | 244 | if (type === 'todo') return <Todo data={d} onDrill={onDrill} />; |
| S-032 | src/client/ui-v3.css | 197 | .wd-todo { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--er |
| S-033 | src/client/ui-v3.css | 198 | .wd-todo > li { display: grid; gap: var(--erp-space-1); padding-bottom: var(--er |
| S-034 | src/client/ui-v3.css | 199 | .wd-todo-actions, .wd-todo-return { display: flex; flex-wrap: wrap; gap: var(--e |
| S-035 | src/client/ui-v3.css | 200 | .wd-todo-return label { display: grid; gap: 2px; flex: 1 1 12rem; } |
| S-036 | src/server/modules/bi/role-dashboards.js | 43 | const T = 'ov.todo.mine'; const N = 'ov.feed.notifications'; const C = 'calendar |
| S-037 | src/server/modules/bi/role-dashboards.js | 159 | { code: 'LOREM', re: /lorem ipsum/gi, why: 'Placeholder text' }, |
| S-038 | src/server/modules/eng/excel.js | 472 | const todo = res.rows.filter((r) => r.action === 'CREATE' // r.action === 'UPDAT |
| S-039 | src/server/modules/eng/excel.js | 474 | const chunk = j.mode === 'CHUNKED' ? Math.max(1, Math.min(eff.settings.chunkSize |
| S-040 | src/server/modules/eng/excel.js | 483 | while (at < todo.length) { |
| S-041 | src/server/modules/eng/excel.js | 485 | const part = todo.slice(at, at + chunk); |
| S-042 | src/server/modules/eng/excel.js | 494 | if (j.mode === 'CHUNKED') db.prepare('UPDATE xl_jobs SET result_json = ?, progre |
| S-043 | src/server/modules/eng/excel.js | 497 | ctx0.setProgress?.(Math.round((at / todo.length) * 100), `${at} of ${todo.length |
| S-044 | src/server/modules/tst/catalogue.js | 41 | const re = /\btest(?:\.(?:skip/only/todo))?\(\s*(['"`])((?:\\./(?!\1)[^\\])*)\1/ |
| S-045 | src/server/modules/tst/docwriter.js | 81 | export function toDocx(doc) { |
| S-046 | src/server/modules/tst/manuals.js | 19 | import { toDocx, toPdf } from './docwriter.js'; |
| S-047 | src/server/modules/tst/manuals.js | 524 | const pdf = await toPdf({ ...m.doc, footer, created: iso() }); const docx = toDo |
| S-048 | src/server/modules/ui/overviews.js | 76 | function todo(ctx, keep = TRUE) { |
| S-049 | src/server/modules/ui/overviews.js | 231 | { code: 'ov.wf.pending', title: 'HR approvals waiting', type: 'todo', w: 6, h: 2 |
| S-050 | src/server/modules/ui/overviews.js | 241 | PM: ['ov.todo.mine', 'ov.qs.unbilled_wip', 'ov.budget.available', 'ov.qa.open_ir |
| S-051 | src/server/modules/ui/overviews.js | 242 | CM: ['ov.todo.mine', 'ov.qa.open_ir', 'ov.hse.safe_hours', 'ov.hse.ltifr', 'ov.b |
| S-052 | src/server/modules/ui/overviews.js | 243 | QS: ['ov.todo.mine', 'ov.qs.certified_not_billed', 'ov.qs.unbilled_wip', 'ov.qs. |
| S-053 | src/server/modules/ui/overviews.js | 244 | COMMGR: ['ov.todo.mine', 'ov.qs.certified_not_billed', 'ov.qs.margin', 'ov.tower |
| S-054 | src/server/modules/ui/overviews.js | 245 | SK: ['ov.todo.mine', 'ov.stores.below_reorder', 'ov.stores.pending', 'ov.stores. |
| S-055 | src/server/modules/ui/overviews.js | 246 | STOREMGR: ['ov.todo.mine', 'ov.stores.below_reorder', 'ov.stores.value', 'ov.sto |
| S-056 | src/server/modules/ui/overviews.js | 247 | HRMGR: ['ov.todo.mine', 'ov.hr.headcount', 'ov.hr.joiners', 'ov.hr.pending', 'ov |
| S-057 | src/server/modules/ui/overviews.js | 248 | HSEE: ['ov.todo.mine', 'ov.hse.safe_hours', 'ov.hse.ltifr', 'ov.hse.observations |
| S-058 | src/server/modules/ui/overviews.js | 249 | QCMGR: ['ov.todo.mine', 'ov.qa.open_ir', 'ov.qa.exceptions', 'ov.feed.notificati |
| S-059 | src/server/modules/ui/overviews.js | 250 | PROCMGR: ['ov.todo.mine', 'ov.proc.open_prs', 'ov.proc.overdue', 'ov.proc.queues |
| S-060 | src/server/modules/ui/overviews.js | 251 | PLANTMGR: ['ov.todo.mine', 'ov.plant.utilisation', 'ov.plant.breakdown', 'ov.pla |
| S-061 | src/server/modules/ui/overviews.js | 252 | DIR: ['ov.todo.mine', 'ov.tower.outstanding', 'ov.tower.margin', 'ov.qs.unbilled |
| S-062 | src/server/modules/ui/overviews.js | 255 | export const TODO_CARD = { code: 'ov.todo.mine', title: 'Waiting for my decision |
| S-063 | src/server/modules/ui/overviews.js | 258 | export const STANDALONE = [TODO_CARD, FEED_CARD]; |
| S-064 | src/server/modules/ui/overviews.js | 275 | pendingHr: () => todo(ctx, (r) => HR_DOCS.test(r.docType ?? '')), |
| S-065 | src/server/modules/ui/overviews.js | 384 | widgetRegistry.register({ code: TODO_CARD.code, provider: (ctx) => todo(ctx) }); |
| S-066 | src/server/platform/calc/uom.js | 63 | const todo = [from]; |
| S-067 | src/server/platform/calc/uom.js | 64 | while (todo.length) { |
| S-068 | src/server/platform/calc/uom.js | 65 | todo.sort((a, b) => best.get(a).cost - best.get(b).cost); |
| S-069 | src/server/platform/calc/uom.js | 66 | const here = todo.shift(); |
| S-070 | src/server/platform/calc/uom.js | 73 | if (!todo.includes(e.to)) todo.push(e.to); |
| S-071 | src/server/platform/protocol/index.js | 78 | const todo = queue; |
| S-072 | src/server/platform/protocol/index.js | 80 | if (db.isTransaction) { queue = todo; return; } |
| S-073 | src/server/platform/protocol/index.js | 81 | for (const r of todo) { try { insertResult(r); } catch { /* the database is clos |
| S-074 | src/shared/i18n/locales/en/adm.js | 137 | "todo": "To do", |
| S-075 | src/shared/i18n/locales/hi/adm.js | 137 | todo: "शेष", |
| S-076 | src/shared/i18n/locales/te.js | 1616 | "todo": "చేయవలసింది", |
| S-077 | tests/overviews-p16605.test.js | 130 | const todo2 = (await api.call('GET', '/api/v1/ui/widgets/ov.todo.mine/data', hr2 |
| S-078 | tests/overviews-p16605.test.js | 131 | assert.ok(todo2.rows.length >= 2, JSON.stringify(todo2)); |
| S-079 | tests/overviews-p16605.test.js | 132 | assert.equal(todo2.source, 'My open approvals and tasks'); |
| S-080 | tests/overviews-p16605.test.js | 133 | const todo1 = (await api.call('GET', '/api/v1/ui/widgets/ov.todo.mine/data', hr1 |
| S-081 | tests/overviews-p16605.test.js | 134 | const mine = new Set(todo2.rows.map((r) => r.taskId)); |
| S-082 | tests/overviews-p16605.test.js | 135 | assert.ok(todo1.rows.every((r) => !mine.has(r.taskId)), 'the maker does not see  |
| S-083 | tests/overviews-p16605.test.js | 138 | assert.equal(inbox.total, todo2.total); |
| S-084 | tests/overviews-p16605.test.js | 140 | const refused = await api.call('POST', `/api/v1/workflow/tasks/${todo2.rows[0].t |
| S-085 | tests/overviews-p16605.test.js | 143 | const ok = await api.call('POST', `/api/v1/workflow/tasks/${todo2.rows[0].taskId |
| S-086 | tests/overviews-p16605.test.js | 165 | assert.equal(d.layout[0].widget, 'ov.todo.mine'); |
| S-087 | tests/overviews-p16605.test.js | 169 | assert.deepEqual(se.layout.map((i) => i.widget), ['ov.todo.mine', 'ov.feed.notif |
| S-088 | tests/overviews-p16605.test.js | 177 | const mineLayout = [{ id: 'h1', widget: 'ov.todo.mine', w: 12, h: 2 }, { id: 'h2 |
| S-089 | tests/overviews-p16605.test.js | 183 | assert.deepEqual(own.layout.map((i) => [i.widget, i.w]), [['ov.todo.mine', 12],  |
| S-090 | tests/tst-page-audit.test.js | 73 | '  return <section><button type="button" className="btn" disabled={q.data > 1}>A |

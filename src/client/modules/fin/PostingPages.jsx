import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import Chart from '../../platform/charts/Chart.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { JN_TONE, gl, money, pe } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';

// Part 23.02: the pages of the posting engine — the rule matrix (versions, a change proposed and approved, the test against a sample event), the failed postings
// (worklist: post again, put right by a journal, close), the replay of history (dry run, approval, result) and the sub-ledgers against the ledger.
const big = { minHeight: 48, fontSize: '1rem' };
const PS_TONE = { POSTED: 'APPROVED', FAILED: 'REJECTED', SKIPPED: 'DRAFT', RESOLVED: 'APPROVED', IGNORED: 'CANCELLED' };
const OPS = ['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'empty', 'notempty'];
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const can = (session, p) => Boolean(session?.permissions?.includes(p));
const useRecordQuery = (key, fn, id) => useQuery({ queryKey: ['gl', key, id], queryFn: () => fn(id), retry: false, enabled: Boolean(id) });
const guardOf = (q, what, permission) => (q.error?.status === 403 || q.error?.status === 404 ? <NoPermission what={what} permission={permission} /> : q.isPending ? <Skeleton label={what} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : null);

/** The decision of the approver on a workflow task (approve, return, reject). */
function Decide({ x, run, busy, setError }) {
  const t = useT('fin'); const [comment, setComment] = useState('');
  if (!x.approve || !x.taskId) return null;
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('act.sayWhy') }); return; } run(() => gl.decide(x.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  return (
    <div className="mdm-panel no-print" data-testid="pe-decide"><h2>{t('act.decision')}</h2>
      <label>{t('act.comment')}<textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} style={{ width: '100%', fontSize: '1rem' }} /></label>
      <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => decide('approve')} data-testid="pe-approve">{t('act.approve')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide('return')}>{t('act.return')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide('reject')}>{t('act.reject')}</button></div>
    </div>
  );
}

// ---- the rule matrix ----
const dimsText = (d) => Object.entries(d ?? {}).map(([k, v]) => `${k}=${v}`).join(', ');
const dimsOf = (text) => Object.fromEntries(String(text ?? '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.split('=').map((y) => y.trim())).filter(([k, v]) => k && v));
function RuleEditor({ base, onDone }) {
  const t = useT('fin'); const { error, busy, run } = useGlRunner();
  const [h, setH] = useState({ name: base.name, priority: base.priority, effectiveFrom: base.status === 'DRAFT' || base.status === 'RETURNED' ? base.effectiveFrom : today(), voucherType: base.voucherType, narration: base.narration, reason: base.status === 'DRAFT' || base.status === 'RETURNED' ? (base.reason ?? '') : '' });
  const [conds, setConds] = useState(base.conditions.map((c) => ({ ...c, value: Array.isArray(c.value) ? c.value.join(',') : (c.value ?? '') })));
  const [lines, setLines] = useState(base.lines.map((l) => ({ ...l, dims: dimsText(l.dims) })));
  const f = error?.fields ?? {}; const draft = base.status === 'DRAFT' || base.status === 'RETURNED';
  const body = () => ({ name: h.name, priority: Number(h.priority), effectiveFrom: h.effectiveFrom, voucherType: h.voucherType, narration: h.narration, reason: h.reason, conditions: conds.map((c) => ({ field: c.field, op: c.op, ...(['empty', 'notempty'].includes(c.op) ? {} : { value: c.op === 'in' ? String(c.value).split(',').map((x) => x.trim()) : c.value }) })), lines: lines.map((l) => ({ side: l.side, account: l.account, amount: l.amount, ...(l.dims ? { dims: dimsOf(l.dims) } : {}), ...(l.narration ? { narration: l.narration } : {}) })) });
  const save = async () => { const r = await run(() => (draft ? pe.updateRule(base.id, { ...body(), version: base.rowVersion }) : pe.propose({ ...body(), ruleCode: base.ruleCode, eventType: base.eventType, action: base.action, reversesEvent: base.reversesEvent ?? null })), t('pr.saved')); if (r) onDone(r.id); };
  const set = (k) => (e) => setH({ ...h, [k]: e.target.value });
  return (
    <form className="mdm-panel" data-testid="pe-rule-editor" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <GlError error={error} />
      <div className="form-grid">
        <Field label={t('rc.name')} name="name" error={f.name}><input value={h.name} onChange={set('name')} style={big} maxLength={160} /></Field>
        <Field label={t('pr.priority')} name="priority" error={f.priority}><input inputMode="numeric" value={h.priority} onChange={set('priority')} style={big} /></Field>
        <Field label={t('pr.from')} name="effectiveFrom" error={f.effectiveFrom}><input type="date" value={h.effectiveFrom} onChange={set('effectiveFrom')} style={big} data-testid="pe-from" /></Field>
        <Field label={t('pr.narration')} name="narration" error={f.narration}><input value={h.narration} onChange={set('narration')} style={big} maxLength={200} /></Field>
        <Field label={t('pr.reason')} name="reason" error={f.reason}><input value={h.reason} onChange={set('reason')} style={big} maxLength={500} data-testid="pe-reason" /></Field>
      </div>
      <h2>{t('pr.conditions')}</h2>
      {conds.map((c, i) => (
        <div key={i} className="form-grid" data-testid={`pe-cond-${i + 1}`}>
          <Field label={t('pr.field')} name={`conditions.${i}.field`} error={f[`conditions.${i}.field`]}><input value={c.field} onChange={(e) => setConds(conds.map((x, k) => (k === i ? { ...x, field: e.target.value } : x)))} style={big} /></Field>
          <Field label={t('pr.op')} name={`conditions.${i}.op`} error={f[`conditions.${i}.op`]}><select value={c.op} onChange={(e) => setConds(conds.map((x, k) => (k === i ? { ...x, op: e.target.value } : x)))} style={big}>{OPS.map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>
          <Field label={t('pr.value')} name={`conditions.${i}.value`} error={null}><input value={c.value} onChange={(e) => setConds(conds.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))} style={big} /></Field>
          <div className="actions-row"><button type="button" className="btn" onClick={() => setConds(conds.filter((_, k) => k !== i))}>{t('pr.remove')}</button></div>
        </div>))}
      <div className="actions-row"><button type="button" className="btn" onClick={() => setConds([...conds, { field: '', op: 'eq', value: '' }])}>{t('pr.addCond')}</button></div>
      {base.action !== 'REVERSE' && <>
        <h2>{t('pr.lines')}</h2>{f.lines && <p className="field-error" role="alert">{f.lines}</p>}
        {lines.map((l, i) => (
          <fieldset key={i} className="mdm-panel" data-testid={`pe-line-${i + 1}`}><legend>{t('jn.line', { n: i + 1 })}</legend><div className="form-grid">
            <Field label={t('pr.side')} name={`lines.${i}.side`} error={f[`lines.${i}.side`]}><select value={l.side} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, side: e.target.value } : x)))} style={big}><option value="DR">{t('jn.debit')}</option><option value="CR">{t('jn.credit')}</option></select></Field>
            <Field label={t('pr.accountCode')} name={`lines.${i}.account`} error={f[`lines.${i}.account`]}><input value={l.account} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, account: e.target.value } : x)))} style={big} maxLength={20} data-testid={`pe-account-${i + 1}`} /></Field>
            <Field label={t('pr.amount')} name={`lines.${i}.amount`} error={f[`lines.${i}.amount`]}><input value={l.amount} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} style={big} maxLength={300} /></Field>
            <Field label={t('pr.dimsMap')} name={`lines.${i}.dims`} error={f[`lines.${i}.dims`]}><input value={l.dims} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, dims: e.target.value } : x)))} style={big} /></Field>
          </div><div className="actions-row"><button type="button" className="btn" onClick={() => setLines(lines.filter((_, k) => k !== i))}>{t('pr.remove')}</button></div></fieldset>))}
        <div className="actions-row"><button type="button" className="btn" onClick={() => setLines([...lines, { side: 'DR', account: '', amount: '', dims: '' }])}>{t('pr.addLine')}</button></div>
      </>}
      <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy} data-testid="pe-save">{t('pr.save')}</button></div>
    </form>
  );
}

function RuleTest({ rule }) {
  const t = useT('fin'); const samples = useQuery({ queryKey: ['gl', 'samples', rule.eventType], queryFn: () => pe.samples(rule.eventType), retry: false });
  const [text, setText] = useState(''); const { error, busy, run } = useGlRunner(); const [out, setOut] = useState(null);
  const pick = (id) => { const s = samples.data?.find((x) => String(x.outboxId) === id); if (s) setText(JSON.stringify(s.data, null, 1)); };
  const go = async () => { let data; try { data = JSON.parse(text || '{}'); } catch { setOut({ ok: false, message: t('pr.figures') }); return; } const r = await run(() => pe.test({ ruleId: rule.id, eventType: rule.eventType, data })); if (r) setOut(r); };
  return (
    <div className="mdm-panel" data-testid="pe-test"><h2>{t('pr.test')}</h2><p className="muted">{t('pr.testIntro')}</p>
      <div className="form-grid"><Field label={t('pr.sample')} name="sample" error={null}><select onChange={(e) => pick(e.target.value)} style={big} data-testid="pe-sample"><option value="">—</option>{(samples.data ?? []).map((s) => <option key={s.outboxId} value={s.outboxId}>{s.ref} · {String(s.occurredAt ?? '').slice(0, 10)}</option>)}</select></Field></div>
      <label>{t('pr.figures')}<textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.9rem' }} data-testid="pe-test-data" /></label>
      <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={go} data-testid="pe-test-run">{t('pr.run')}</button></div>
      <GlError error={error} />
      {out && <div data-testid="pe-test-result" data-ok={out.ok ? 'yes' : 'no'}><p className={out.ok ? 'mdm-banner' : 'field-error'} role="status">{out.ok ? `${t('pr.wouldPost')} · ${out.date ?? ''} · ${out.narration ?? ''}` : `${t('pr.wouldFail')}: ${out.message}`}</p>
        {out.lines?.length > 0 && <div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">{t('jn.account')}</th><th scope="col" className="num">{t('jn.debit')}</th><th scope="col" className="num">{t('jn.credit')}</th></tr></thead><tbody>{out.lines.map((l, i) => <tr key={i}><td>{l.account}</td><td className="num">{l.debit ? money(l.debit) : ''}</td><td className="num">{l.credit ? money(l.credit) : ''}</td></tr>)}</tbody></table></div>}</div>}
    </div>
  );
}

function Rule({ id }) {
  const t = useT('fin'); const q = useRecordQuery('rule', pe.rule, id); const { error, setError, note, busy, run } = useGlRunner(); const [editing, setEditing] = useState(false); usePageTitle(t('pr.title'));
  const g = guardOf(q, t('pr.title'), 'fin.posting_rule.view'); if (g) return g; const x = q.data; const c = x.can ?? {};
  const why = (action) => { const r = globalThis.prompt(t('act.why')); if (r) run(() => pe.ruleAct(x.id, action, { reason: r })); };
  return (
    <div data-testid="pe-rule" data-status={x.status}>
      <PageHeader id="pr-h" title={<>{x.ruleCode} · {x.name} <StatusBadge status={JN_TONE[x.status]} label={x.status === 'APPROVED' ? t('pr.from') + ' ' + x.effectiveFrom : t(`st.${x.status}`)} /></>} subtitle={x.eventLabel} meta={<><Link to="/finance/posting-rules">{t('pr.title')}</Link> · {x.standard ? t('pr.standard') : t('pr.company')} · {t('pr.version')} {x.version}</>} />
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="actions-row no-print">
        {c.change && <button type="button" className="btn" style={big} onClick={() => setEditing(!editing)} data-testid="pe-change">{t('pr.change')}</button>}
        {c.edit && <button type="button" className="btn" onClick={() => setEditing(!editing)} data-testid="pe-edit">{t('jn.edit')}</button>}
        {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => pe.ruleAct(x.id, 'submit'), t('jn.submitted'))} data-testid="pe-submit">{t('act.submit')}</button>}
        {c.withdraw && <button type="button" className="btn" disabled={busy} onClick={() => why('withdraw')}>{t('act.withdraw')}</button>}
        {c.cancel && <button type="button" className="btn" disabled={busy} onClick={() => why('cancel')}>{t('act.cancel')}</button>}
      </div>
      <Decide x={x} run={run} busy={busy} setError={setError} />
      {editing && <RuleEditor base={x} onDone={(nid) => { setEditing(false); navigateTo(`/finance/posting-rules?id=${nid}`); }} />}
      <div className="table-scroll"><table className="data-table"><caption>{t('pr.conditions')}</caption><tbody>{x.conditions.length ? x.conditions.map((cd, i) => <tr key={i}><td>{cd.field}</td><td>{cd.op}</td><td>{Array.isArray(cd.value) ? cd.value.join(', ') : String(cd.value ?? '')}</td></tr>) : <tr><td>{t('pr.noConditions')}</td></tr>}</tbody></table></div>
      {x.action === 'REVERSE' ? <p className="mdm-banner">{t('pr.reverses')} {x.reversesEvent}</p> : (
        <div className="table-scroll" data-testid="pe-rule-lines"><table className="data-table"><caption>{t('pr.lines')}</caption><thead><tr><th scope="col">{t('pr.side')}</th><th scope="col">{t('pr.accountCode')}</th><th scope="col">{t('pr.amount')}</th><th scope="col">{t('pr.dimsMap')}</th></tr></thead>
          <tbody>{x.lines.map((l, i) => <tr key={i}><td>{l.side === 'DR' ? t('jn.debit') : t('jn.credit')}</td><td>{l.account}</td><td><code>{l.amount}</code></td><td>{dimsText(l.dims)}</td></tr>)}</tbody></table></div>)}
      <RuleTest rule={x} />
      <div className="table-scroll"><table className="data-table"><caption>{t('pr.versions')}</caption><thead><tr><th scope="col">{t('pr.version')}</th><th scope="col">{t('pr.from')}</th><th scope="col">{t('st.APPROVED')}</th><th scope="col">{t('pr.reason')}</th></tr></thead>
        <tbody>{x.versions.map((v) => <tr key={v.id}><td><Link to={`/finance/posting-rules?id=${v.id}`}>{v.standard ? t('pr.standard') : t('pr.company')} {v.version}</Link></td><td>{v.effectiveFrom}</td><td><StatusBadge status={JN_TONE[v.status]} label={t(`st.${v.status}`)} /></td><td>{v.reason ?? ''}</td></tr>)}</tbody></table></div>
    </div>
  );
}

export function PostingRulesPage() {
  const t = useT('fin'); usePageTitle(t('pr.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="pr-h"><Rule id={id} /></section>;
  return (
    <section aria-labelledby="prs-h" data-testid="pe-rules"><PageHeader id="prs-h" title={t('pr.title')} subtitle={t('pr.intro')} meta={<><Link to="/finance/failed-postings">{t('fp.title')}</Link> · <Link to="/finance/reconciliation">{t('rc2.title')}</Link></>} />
      <ListReport listCode="fin.posting_rules" endpoint="/fin/posting-rules" title={t('pr.title')} session={session.data} rowHref={(r) => `/finance/posting-rules?id=${r.id}`} onOpen={(r) => navigateTo(`/finance/posting-rules?id=${r.id}`)} cardFields={['ruleCode', 'name', 'eventType', 'effectiveFrom', 'status']} statusKey="status" empty={{ title: t('pr.emptyTitle'), text: t('pr.emptyBody') }} />
    </section>
  );
}

// ---- the failed postings ----
function Posting({ id }) {
  const t = useT('fin'); const q = useRecordQuery('posting', pe.posting, id); const { error, note, setNote, busy, run } = useGlRunner(); const [f, setF] = useState({ journalId: '', note: '' }); const session = useSession(); usePageTitle(t('fp.title'));
  const g = guardOf(q, t('fp.title'), 'fin.posting.view'); if (g) return g; const x = q.data;
  const repost = async () => { const r = await run(() => pe.repost(x.id)); if (r) setNote(r.status === 'POSTED' ? t('fp.reposted') : t('fp.stillFailed', { why: r.error })); };
  return (
    <div data-testid="pe-posting" data-status={x.status}>
      <PageHeader id="fp-h" title={<>{x.docRef} <StatusBadge status={PS_TONE[x.status]} label={t(`ps.${x.status}`)} /></>} subtitle={x.eventLabel} meta={<><Link to="/finance/failed-postings">{t('fp.title')}</Link> · {x.eventDate ?? ''}</>} />
      <KpiRow label={t('fp.title')}><KpiTile label={t('rp.total')} value={money(x.amount)} amount={x.amount} kind="money" /><KpiTile label={t('fp.attempts')} value={String(x.attempts)} /><KpiTile label={t('fp.age')} value={String(x.age)} /></KpiRow>
      {x.error && <p className="field-error" role="alert" data-testid="pe-error"><strong>{x.errorCode}</strong> · {x.error}</p>}
      {x.journal && <p className="mdm-banner"><Link to={`/finance/journals?id=${x.journal.id}`}>{x.journal.voucher_no}</Link></p>}
      <GlError error={error} />{note && <p className="mdm-banner" role="status" data-testid="pe-note">{note}</p>}
      {x.status === 'FAILED' && <div className="actions-row no-print">
        {can(session.data, 'fin.posting.repost') && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={repost} data-testid="pe-repost">{t('fp.repost')}</button>}
      </div>}
      {x.status === 'FAILED' && can(session.data, 'fin.posting.resolve') && <form className="mdm-panel form-grid no-print" onSubmit={(e) => e.preventDefault()}>
        <Field label={t('fp.journalId')} name="journalId" error={error?.fields?.journalId}><input inputMode="numeric" value={f.journalId} onChange={(e) => setF({ ...f, journalId: e.target.value })} style={big} /></Field>
        <Field label={t('fp.note')} name="note" error={error?.fields?.note}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={big} maxLength={500} data-testid="pe-note-input" /></Field>
        <div className="actions-row"><button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => pe.resolve(x.id, { outcome: 'RESOLVED', journalId: Number(f.journalId) || undefined, note: f.note }))}>{t('fp.resolve')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => pe.resolve(x.id, { outcome: 'IGNORED', note: f.note }))} data-testid="pe-ignore">{t('fp.ignore')}</button></div>
      </form>}
      {x.preview && <div className="mdm-panel" data-testid="pe-preview"><h2>{t('fp.preview')}</h2>{x.preview.ok ? <div className="table-scroll"><table className="data-table"><tbody>{x.preview.lines.map((l, i) => <tr key={i}><td>{l.accountId}</td><td className="num">{l.debit ? money(l.debit) : ''}</td><td className="num">{l.credit ? money(l.credit) : ''}</td></tr>)}</tbody></table></div> : <p className="field-error">{x.preview.code} · {x.preview.message}</p>}</div>}
      <details className="mdm-panel"><summary>{t('fp.payload')}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(x.payload, null, 1)}</pre></details>
    </div>
  );
}

export function FailedPostingsPage() {
  const t = useT('fin'); usePageTitle(t('fp.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  const s = useQuery({ queryKey: ['gl', 'posting-summary'], queryFn: pe.summary, retry: false, enabled: !id }); const { error, note, busy, run } = useGlRunner();
  if (id) return <section aria-labelledby="fp-h"><Posting id={id} /></section>;
  if (s.error?.status === 403) return <NoPermission what={t('fp.title')} permission="fin.posting.view" />;
  const counts = s.data?.counts ?? {};
  return (
    <section aria-labelledby="fps-h" data-testid="pe-failed"><PageHeader id="fps-h" title={t('fp.title')} subtitle={t('fp.intro')} meta={<><Link to="/finance/posting-rules">{t('pr.title')}</Link> · <Link to="/finance/posting-replay">{t('rp.title')}</Link></>} />
      {s.data && <KpiRow label={t('fp.counts')}><KpiTile label={t('ps.FAILED')} value={String(counts.FAILED ?? 0)} tone={counts.FAILED ? 'danger' : 'neutral'} valueTestid="pe-failed-count" /><KpiTile label={t('ps.POSTED')} value={String(counts.POSTED ?? 0)} /><KpiTile label={t('ps.IGNORED')} value={String((counts.IGNORED ?? 0) + (counts.RESOLVED ?? 0))} /></KpiRow>}
      {s.data?.oldestFailed && <p className="muted">{t('fp.oldest', { d: String(s.data.oldestFailed).slice(0, 10) })}</p>}
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      {counts.FAILED > 0 && can(session.data, 'fin.posting.repost') && <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(async () => { const r = await pe.repostAll(); return r; }, t('fp.reposted'))} data-testid="pe-repost-all">{t('fp.repostAll')}</button></div>}
      <ListReport listCode="fin.postings" endpoint="/fin/postings" title={t('fp.title')} session={session.data} rowHref={(r) => `/finance/failed-postings?id=${r.id}`} onOpen={(r) => navigateTo(`/finance/failed-postings?id=${r.id}`)} cardFields={['docRef', 'eventType', 'errorCode', 'age', 'status']} statusKey="status" dateKey="eventDate" empty={{ title: t('fp.emptyTitle'), text: t('fp.emptyBody') }} />
    </section>
  );
}

// ---- the replay ----
function Run({ id }) {
  const t = useT('fin'); const q = useRecordQuery('replay', pe.replay, id); const { error, setError, note, busy, run } = useGlRunner(); usePageTitle(t('rp.title'));
  const g = guardOf(q, t('rp.title'), 'fin.replay.view'); if (g) return g; const x = q.data; const d = x.dryRun ?? {};
  const why = (action) => { const r = globalThis.prompt(t('act.why')); if (r) run(() => pe.replayAct(x.id, action, { reason: r })); };
  return (
    <div data-testid="pe-run" data-status={x.status}>
      <PageHeader id="rp-h" title={<>{x.docNo} <StatusBadge status={JN_TONE[x.status]} label={t(`st.${x.status}`)} /></>} subtitle={`${x.from} – ${x.to}`} meta={<Link to="/finance/posting-replay">{t('rp.title')}</Link>} />
      <KpiRow label={t('rp.dryRun')}><KpiTile label={t('rp.events')} value={String(d.events ?? 0)} valueTestid="pe-run-events" /><KpiTile label={t('rp.wouldPost')} value={String(d.wouldPost ?? 0)} valueTestid="pe-run-post" /><KpiTile label={t('rp.total')} value={money(d.total)} amount={d.total} kind="money" /><KpiTile label={t('rp.failures')} value={String(Object.values(d.failures ?? {}).reduce((a, b) => a + b, 0))} /></KpiRow>
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="actions-row no-print">
        {x.can?.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => pe.replayAct(x.id, 'submit'), t('jn.submitted'))} data-testid="pe-run-submit">{t('act.submit')}</button>}
        {x.can?.withdraw && <button type="button" className="btn" disabled={busy} onClick={() => why('withdraw')}>{t('act.withdraw')}</button>}
        {x.can?.cancel && <button type="button" className="btn" disabled={busy} onClick={() => why('cancel')}>{t('act.cancel')}</button>}
      </div>
      <Decide x={x} run={run} busy={busy} setError={setError} />
      {x.result && <p className="mdm-banner" data-testid="pe-run-result">{t('rp.result')}: {t('rp.posted')} {x.result.posted} · {t('rp.failed')} {x.result.failed} · {money(x.result.total)}</p>}
      <div className="table-scroll"><table className="data-table"><caption>{t('rp.failures')}</caption><tbody>{Object.keys(d.failures ?? {}).length ? Object.entries(d.failures).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v}</td></tr>) : <tr><td>{t('rp.none')}</td></tr>}</tbody></table></div>
      {d.items?.length > 0 && <div className="table-scroll"><table className="data-table"><caption>{t('rp.items')}</caption><thead><tr><th scope="col">{t('pr.event')}</th><th scope="col">{t('jn.date')}</th><th scope="col" className="num">{t('rp.total')}</th><th scope="col">{t('fp.reason')}</th></tr></thead><tbody>{d.items.map((i) => <tr key={i.eventId}><td>{i.ref ?? i.type}</td><td>{i.date ?? ''}</td><td className="num">{money(i.amount)}</td><td>{i.ok ? t('ps.POSTED') : `${i.code}: ${i.message}`}</td></tr>)}</tbody></table></div>}
    </div>
  );
}

export function ReplayPage() {
  const t = useT('fin'); usePageTitle(t('rp.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  const cat = useQuery({ queryKey: ['gl', 'catalogue'], queryFn: pe.catalogue, retry: false, enabled: !id }); const runs = useQuery({ queryKey: ['gl', 'replays'], queryFn: pe.replays, retry: false, enabled: !id });
  const [f, setF] = useState({ eventTypes: [], from: '2026-04-01', to: today() }); const { error, busy, run } = useGlRunner();
  if (id) return <section aria-labelledby="rp-h"><Run id={id} /></section>;
  if (runs.error?.status === 403) return <NoPermission what={t('rp.title')} permission="fin.replay.view" />;
  if (cat.isPending || runs.isPending) return <Skeleton label={t('rp.title')} rows={4} />;
  const toggle = (k) => setF({ ...f, eventTypes: f.eventTypes.includes(k) ? f.eventTypes.filter((x) => x !== k) : [...f.eventTypes, k] });
  return (
    <section aria-labelledby="rps-h" data-testid="pe-replay"><PageHeader id="rps-h" title={t('rp.title')} subtitle={t('rp.intro')} meta={<Link to="/finance/failed-postings">{t('fp.title')}</Link>} />
      {can(session.data, 'fin.replay.create') && <form className="mdm-panel" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => pe.dryRun(f)); if (r) navigateTo(`/finance/posting-replay?id=${r.id}`); }}>
        <GlError error={error} />
        <fieldset><legend>{t('rp.types')}</legend>{(cat.data ?? []).map((c) => <label key={c.type} style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}><input type="checkbox" checked={f.eventTypes.includes(c.type)} onChange={() => toggle(c.type)} data-testid={`pe-type-${c.type}`} />{c.label}</label>)}</fieldset>
        <div className="form-grid"><Field label={t('rp.from')} name="from" error={error?.fields?.from}><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} style={big} data-testid="pe-from-date" /></Field><Field label={t('rp.to')} name="to" error={error?.fields?.to}><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} style={big} data-testid="pe-to-date" /></Field></div>
        <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy || !f.eventTypes.length} data-testid="pe-dry-run">{t('rp.dryRun')}</button></div>
      </form>}
      {!runs.data.rows.length ? <EmptyState title={t('rp.emptyTitle')} message={t('rp.emptyBody')} /> : (
        <div className="table-scroll" data-testid="pe-runs"><table className="data-table"><caption>{t('rp.runs')}</caption><thead><tr><th scope="col">{t('jn.voucher')}</th><th scope="col">{t('rp.from')}</th><th scope="col" className="num">{t('rp.events')}</th><th scope="col" className="num">{t('rp.wouldPost')}</th><th scope="col">{t('st.APPROVED')}</th></tr></thead>
          <tbody>{runs.data.rows.map((r) => <tr key={r.id}><td><Link to={`/finance/posting-replay?id=${r.id}`}>{r.docNo}</Link></td><td>{r.from} – {r.to}</td><td className="num">{r.dryRun.events}</td><td className="num">{r.dryRun.wouldPost}</td><td><StatusBadge status={JN_TONE[r.status]} label={t(`st.${r.status}`)} /></td></tr>)}</tbody></table></div>)}
    </section>
  );
}

// ---- the reconciliation ----
export function ReconciliationPage() {
  const t = useT('fin'); usePageTitle(t('rc2.title')); const [asOf, setAsOf] = useState(today()); const [shown, setShown] = useState(today());
  const q = useQuery({ queryKey: ['gl', 'recon', shown], queryFn: () => pe.recon(shown), retry: false, placeholderData: (p) => p });
  if (q.error?.status === 403) return <NoPermission what={t('rc2.title')} permission="fin.posting.view" />;
  if (q.isPending) return <Skeleton label={t('rc2.title')} rows={6} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const diffs = x.rows.filter((r) => r.difference !== 0).length;
  const chart = { categories: x.rows.map((r) => r.code), series: [{ name: t('rc2.sub'), values: x.rows.map((r) => Math.round(r.subledger)) }, { name: t('rc2.gl'), values: x.rows.map((r) => Math.round(r.gl)) }], unit: '' };
  return (
    <section aria-labelledby="rc2-h" data-testid="pe-recon"><PageHeader id="rc2-h" title={t('rc2.title')} subtitle={t('rc2.intro')} meta={<><Link to="/finance/failed-postings">{t('fp.title')}</Link> · <Link to="/finance/trial-balance">{t('tb.title')}</Link></>} />
      <p className={x.clean ? 'mdm-banner' : 'field-error'} role="status" data-testid="pe-recon-state" data-clean={x.clean ? 'yes' : 'no'}>{x.clean ? t('rc2.clean') : t('rc2.notClean', { n: diffs })}</p>
      {x.rows.length > 0 && <div className="mdm-panel"><Chart type="bar" data={chart} title={t('rc2.title')} exportName={`reconciliation-${x.asOf}`} tableSwitch /></div>}
      <details className="mdm-panel" open><summary style={big}>{t('common.filters')} · {t('rc2.asOf')} {x.asOf}</summary><form className="form-grid" onSubmit={(e) => { e.preventDefault(); setShown(asOf); }}><Field label={t('rc2.asOf')} name="asOf" error={null}><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={big} data-testid="pe-recon-asof" /></Field><div className="actions-row"><button type="submit" className="btn btn-primary" style={big} data-testid="pe-recon-show">{t('common.apply')}</button></div></form></details>
      <h2>{t('rc2.title')} · {x.asOf}</h2>
      <div className="table-scroll" data-testid="pe-recon-rows"><table className="data-table" aria-label={`${t('rc2.title')} ${x.asOf}`}><thead><tr><th scope="col">{t('rc2.sub')}</th><th scope="col" className="num">{t('rc2.sub')}</th><th scope="col" className="num">{t('rc2.gl')}</th><th scope="col" className="num">{t('rc2.diff')}</th><th scope="col">{t('rc2.accounts')}</th></tr></thead>
        <tbody>{x.rows.map((r) => <tr key={r.code} data-testid={`pe-recon-${r.code}`} data-diff={r.difference}><td>{r.drill ? <Link to={r.drill}>{r.label}</Link> : r.label}</td><td className="num">{money(r.subledger)}</td><td className="num">{money(r.gl)}</td><td className="num"><strong>{money(r.difference)}</strong></td><td>{r.accounts}</td></tr>)}</tbody></table></div>
      {Object.keys(x.failed).length > 0 && <div className="table-scroll"><table className="data-table"><caption>{t('rc2.failed')}</caption><tbody>{Object.entries(x.failed).map(([k, v]) => <tr key={k}><td><Link to="/finance/failed-postings">{k}</Link></td><td className="num">{v}</td></tr>)}</tbody></table></div>}
    </section>
  );
}

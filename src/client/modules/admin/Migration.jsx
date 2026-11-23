import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { Card } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from '../bi/api.js';

// Part 29.05: the Migration Cockpit (board, UI v3 §3.6). Objects move from planned through trial loads (run and rolled back, with their
// reconciliation) and the owner's sign-off to the final load in the cut-over freeze. Migration is desk work: on a phone the board stacks.

const read = async (path) => (await api.get(path)).data;
const send = (method, path, body) => api[method](path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/admin/data-migration${p.toString() ? `?${p}` : ''}`);
};
const TONE = { PLANNED: 'DRAFT', TRIAL: 'IN_REVIEW', READY: 'IN_REVIEW', SIGNOFF: 'SUBMITTED', SIGNED_OFF: 'APPROVED', LOADED: 'COMPLETED' };
const RUN = { PASSED: 'APPROVED', FAILED: 'REJECTED', LOADED: 'COMPLETED', ROLLED_BACK: 'RETURNED' };
const toMap = (text) => Object.fromEntries(String(text).split('\n').map((l) => l.split(/[,\t]/).map((x) => x.trim())).filter((p) => p.length >= 2 && p[0]).map((p) => [p[0], p[1]]));
const fromMap = (m) => Object.entries(m ?? {}).map(([a, b]) => `${a},${b}`).join('\n');

function ObjectPanel({ code, board }) {
  const t = useT('mig');
  const { dateTime, number } = useFormat();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['mig', 'obj', code], queryFn: () => read(`/admin/migration/objects/${code}`), retry: false });
  const [map, setMap] = useState(null);
  const [run, setRun] = useState({ type: 'TRIAL', csv: '', delta: false, count: '', totalDebit: '', totalCredit: '', stockValue: '' });
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const done = () => cache.invalidateQueries({ queryKey: ['mig'] });
  const saveMap = useMutation({ mutationFn: (m) => send('put', `/admin/migration/objects/${code}/mapping`, m), onSuccess: () => { setMap(null); done(); } });
  const doRun = useMutation({ mutationFn: () => send('post', `/admin/migration/objects/${code}/runs`, { type: run.type, csv: run.csv, delta: run.delta, controls: Object.fromEntries(Object.entries({ count: run.count === '' ? undefined : Number(run.count), totalDebit: run.totalDebit || undefined, totalCredit: run.totalCredit || undefined, stockValue: run.stockValue || undefined }).filter(([, v]) => v !== undefined)) }), onSuccess: done });
  const ask = useMutation({ mutationFn: () => send('post', `/admin/migration/objects/${code}/sign-off`, { reason }), onSuccess: done });
  const act = useMutation({ mutationFn: (action) => send('post', `/admin/migration/objects/${code}/sign-off/act`, { action, comment: comment || undefined }), onSuccess: done });
  const xls = useMutation({ mutationFn: () => downloadReport(`/api/v1/admin/migration/objects/${code}/mapping/export`, `mapping-${code}.xlsx`) });
  if (q.isPending) return <Skeleton label={code} rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const o = q.data;
  const m = map ?? { rename: fromMap(Object.fromEntries(Object.entries(o.mapping.rename))), values: Object.fromEntries(o.columns.map((c) => [c.key, fromMap(o.mapping.values[c.key])])), upper: o.mapping.upper, dropBlank: o.mapping.dropBlank, defaults: Object.fromEntries(o.columns.map((c) => [c.key, o.mapping.defaults[c.key] ?? ''])) };
  const edit = (patch) => setMap({ ...m, ...patch });
  const file = (e) => { const f = e.target.files?.[0]; if (f) f.text().then((text) => setRun({ ...run, csv: text })); };
  const err = saveMap.error ?? doRun.error ?? ask.error ?? act.error ?? xls.error;
  return <Card title={`${o.name} · ${o.code}`} subtitle={t('objSub', { kind: o.kindLabel, phase: t(`ph.${o.phase}`), seq: o.sequence, owner: o.ownerRole })} testid="mig-object">
    <p className="small"><StatusBadge status={TONE[o.status]} label={t(`st.${o.status}`)} size="sm" /> · {t('trials', { n: o.trialsPassed, of: o.trialsNeeded, v: o.mappingVersion })}{o.signedOffBy ? ` · ${t('signedBy', { who: o.signedOffBy })}` : ''}</p>
    {err && <ErrorState error={err} />}
    {o.canSignOff && <div className="mig-decide" data-testid="mig-signoff">
      <Field name="mig-comment" label={t('comment')}><input value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      <div className="actions-row"><button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate('approve')} data-testid="mig-approve">{t('signOff')}</button>
        <button type="button" className="btn" disabled={act.isPending || comment.trim().length < 5} onClick={() => act.mutate('return')}>{t('return')}</button></div>
    </div>}
    {board.canManage && ['TRIAL', 'READY'].includes(o.status) && <div className="mig-form">
      <Field name="mig-reason" label={t('signReason')}><input value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={500} /></Field>
      <button type="button" className="btn" disabled={ask.isPending || o.trialsPassed < o.trialsNeeded || reason.trim().length < 5} onClick={() => ask.mutate()} data-testid="mig-ask">{t('askSignOff')}</button>
    </div>}
    <details className="mig-section" open={!o.runs.length}><summary>{t('mapping', { v: o.mappingVersion })}</summary>
      <p className="muted small">{t('mappingHelp')}</p>
      <Field name="mig-rename" label={t('rename')}><textarea rows={3} value={m.rename} onChange={(e) => edit({ rename: e.target.value })} disabled={!board.canManage} placeholder="GL Code,accountCode" /></Field>
      {o.columns.map((c) => <fieldset key={c.key} className="mig-col"><legend>{c.label}{c.required ? ' *' : ''} <code>{c.key}</code></legend>
        <Field name={`mig-v-${c.key}`} label={t('codeMap')}><textarea rows={2} value={m.values[c.key]} onChange={(e) => edit({ values: { ...m.values, [c.key]: e.target.value } })} disabled={!board.canManage} placeholder={t('codeMapPh')} /></Field>
        <div className="mig-row">
          <label className="mig-check"><input type="checkbox" checked={m.upper.includes(c.key)} disabled={!board.canManage} onChange={(e) => edit({ upper: e.target.checked ? [...m.upper, c.key] : m.upper.filter((x) => x !== c.key) })} /> {t('upper')}</label>
          <label className="mig-check"><input type="checkbox" checked={m.dropBlank.includes(c.key)} disabled={!board.canManage} onChange={(e) => edit({ dropBlank: e.target.checked ? [...m.dropBlank, c.key] : m.dropBlank.filter((x) => x !== c.key) })} /> {t('dropBlank')}</label>
          <Field name={`mig-d-${c.key}`} label={t('default')}><input value={m.defaults[c.key]} onChange={(e) => edit({ defaults: { ...m.defaults, [c.key]: e.target.value } })} disabled={!board.canManage} /></Field>
        </div>
      </fieldset>)}
      <div className="actions-row">
        {board.canManage && <button type="button" className="btn btn-primary" disabled={saveMap.isPending || !map} onClick={() => saveMap.mutate({ rename: Object.fromEntries(Object.entries(toMap(m.rename))), upper: m.upper, dropBlank: m.dropBlank, defaults: Object.fromEntries(Object.entries(m.defaults).filter(([, v]) => v !== '')), values: Object.fromEntries(Object.entries(m.values).map(([k, v]) => [k, toMap(v)]).filter(([, v]) => Object.keys(v).length)) })} data-testid="mig-save-map">{t('saveMapping')}</button>}
        <button type="button" className="btn" onClick={() => xls.mutate()}>{t('mappingXlsx')}</button>
      </div>
    </details>
    {o.canRun ? <div className="mig-section" data-testid="mig-run">
      <h3 className="mig-h">{t('load')}</h3>
      <div className="mig-form">
        <Field name="mig-type" label={t('loadType')}><select value={run.type} onChange={(e) => setRun({ ...run, type: e.target.value })}>{o.status !== 'LOADED' && <option value="TRIAL">{t('trial')}</option>}<option value="FINAL">{t('final')}</option></select></Field>
        <Field name="mig-file" label={t('extract')}><input type="file" accept=".csv,text/csv" onChange={file} /></Field>
        {run.type === 'FINAL' && <label className="mig-check"><input type="checkbox" checked={run.delta} onChange={(e) => setRun({ ...run, delta: e.target.checked })} /> {t('delta')}</label>}
      </div>
      <Field name="mig-csv" label={t('csv')}><textarea rows={4} value={run.csv} onChange={(e) => setRun({ ...run, csv: e.target.value })} spellCheck={false} /></Field>
      <p className="muted small">{t('controlsHelp')}</p>
      <div className="mig-form">
        <Field name="mig-count" label={t('cCount')}><input inputMode="numeric" value={run.count} onChange={(e) => setRun({ ...run, count: e.target.value.replace(/\D/g, '') })} /></Field>
        {o.kind === 'OPENING_TB' && <><Field name="mig-dr" label={t('cDebit')}><input inputMode="decimal" value={run.totalDebit} onChange={(e) => setRun({ ...run, totalDebit: e.target.value })} /></Field>
          <Field name="mig-cr" label={t('cCredit')}><input inputMode="decimal" value={run.totalCredit} onChange={(e) => setRun({ ...run, totalCredit: e.target.value })} /></Field></>}
        {o.kind === 'OPENING_STOCK' && <Field name="mig-sv" label={t('cStock')}><input inputMode="decimal" value={run.stockValue} onChange={(e) => setRun({ ...run, stockValue: e.target.value })} /></Field>}
      </div>
      <button type="button" className="btn btn-primary" disabled={doRun.isPending || run.csv.trim().length < 3} onClick={() => doRun.mutate()} data-testid="mig-go">{run.type === 'TRIAL' ? t('runTrial') : t('runFinal')}</button>
    </div> : null}
    <h3 className="mig-h">{t('runs')}</h3>
    {!o.runs.length ? <p className="muted">{t('noRuns')}</p> : <ul className="mig-runs">{o.runs.map((r) => <li key={r.id} className="mig-card" data-testid="mig-runrow">
      <div className="actions-row"><strong>{t(`rt.${r.type}`)}{r.mode === 'DELTA' ? ` · ${t('deltaShort')}` : ''}</strong><StatusBadge status={RUN[r.status]} label={t(`rs.${r.status}`)} size="sm" /></div>
      <p className="muted small">{dateTime(r.startedAt)} · {r.by} · {t('runCounts', { legacy: number(r.legacyRows, { decimals: 0 }), rec: number(r.records, { decimals: 0 }), err: number(r.errors, { decimals: 0 }), drop: number(r.dropped, { decimals: 0 }), v: r.mappingVersion })}</p>
      {r.reconciliation.length > 0 && <table className="mig-recon"><thead><tr><th scope="col">{t('check')}</th><th scope="col">{t('legacy')}</th><th scope="col">{t('migrated')}</th><th scope="col"><span className="sr-only">{t('result')}</span></th></tr></thead>
        <tbody>{r.reconciliation.map((x) => <tr key={x.check} className={x.ok ? '' : 'mig-off'}><td>{x.check}</td><td>{x.legacy}</td><td>{x.migrated}</td><td>{x.ok ? '✓' : '✗'}</td></tr>)}</tbody></table>}
      {r.problems.slice(0, 5).map((p, i) => <p key={i} className="small mig-problem">{p.line ? t('rowN', { n: p.line }) : ''}{p.errors.map((e) => e.message).join(' ')}</p>)}
    </li>)}</ul>}
  </Card>;
}

function Cutover({ board }) {
  const t = useT('mig');
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const c = board.cutover;
  const [f, setF] = useState({ name: '', freezeFrom: '', freezeTo: '', rollbackPoint: '' });
  const done = () => cache.invalidateQueries({ queryKey: ['mig'] });
  const plan = useMutation({ mutationFn: () => send('post', '/admin/migration/cutovers', { ...f, freezeFrom: new Date(f.freezeFrom).toISOString(), freezeTo: new Date(f.freezeTo).toISOString() }), onSuccess: done });
  const status = useMutation({ mutationFn: (s) => send('post', `/admin/migration/cutovers/${c.id}/status`, { status: s }), onSuccess: done });
  const step = useMutation({ mutationFn: (s) => send('post', `/admin/migration/cutovers/${c.id}/steps/${s.no}`, { done: !s.done }), onSuccess: done });
  const err = plan.error ?? status.error ?? step.error;
  if (!c) return board.canManage ? <Card title={t('cutover')} subtitle={t('cutoverSub')} testid="mig-cutover">
    {err && <ErrorState error={err} />}
    <form className="mig-form" onSubmit={(e) => { e.preventDefault(); plan.mutate(); }}>
      <Field name="mig-c-name" label={t('name')}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={3} /></Field>
      <Field name="mig-c-from" label={t('freezeFrom')}><input type="datetime-local" value={f.freezeFrom} onChange={(e) => setF({ ...f, freezeFrom: e.target.value })} required /></Field>
      <Field name="mig-c-to" label={t('freezeTo')}><input type="datetime-local" value={f.freezeTo} onChange={(e) => setF({ ...f, freezeTo: e.target.value })} required /></Field>
      <Field name="mig-c-rb" label={t('rollback')}><input value={f.rollbackPoint} onChange={(e) => setF({ ...f, rollbackPoint: e.target.value })} required minLength={5} /></Field>
      <button type="submit" className="btn btn-primary" disabled={plan.isPending}>{t('planCutover')}</button>
    </form>
  </Card> : null;
  return <Card title={`${t('cutover')} · ${c.name}`} subtitle={t('window', { from: dateTime(c.freezeFrom), to: dateTime(c.freezeTo) })} testid="mig-cutover">
    {err && <ErrorState error={err} />}
    <p className="small"><StatusBadge status={c.status === 'FROZEN' ? 'IN_REVIEW' : c.status === 'CLOSED' ? 'COMPLETED' : 'DRAFT'} label={t(`cs.${c.status}`)} size="sm" /> · {t('rollbackIs', { r: c.rollbackPoint })}</p>
    <ol className="mig-steps">{c.steps.map((s) => <li key={s.no}><label className="mig-check"><input type="checkbox" checked={s.done} disabled={!board.canManage || c.status === 'CLOSED' || step.isPending} onChange={() => step.mutate(s)} /> {s.title}</label>{s.done && <span className="muted small"> · {s.by}, {dateTime(s.at)}</span>}</li>)}</ol>
    {board.canManage && <div className="actions-row">
      {c.status === 'PLANNED' && <button type="button" className="btn btn-primary" disabled={status.isPending} onClick={() => status.mutate('FROZEN')} data-testid="mig-freeze">{t('freeze')}</button>}
      {c.status !== 'CLOSED' && <button type="button" className="btn" disabled={status.isPending} onClick={() => status.mutate('CLOSED')}>{t('close')}</button>}
    </div>}
  </Card>;
}

function PlanForm({ board }) {
  const t = useT('mig');
  const cache = useQueryClient();
  const [f, setF] = useState({ code: '', name: '', kind: 'OPENING_TB', phase: 'BALANCES', sequence: '10', ownerRole: 'ACCMGR' });
  const create = useMutation({ mutationFn: () => send('post', '/admin/migration/objects', { ...f, code: f.code.trim().toUpperCase(), sequence: Number(f.sequence) }), onSuccess: (r) => { cache.invalidateQueries({ queryKey: ['mig'] }); go({ object: r.data.code }); } });
  return <details className="mig-section"><summary>{t('planObject')}</summary>
    {create.error && <ErrorState error={create.error} />}
    <form className="mig-form" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      <Field name="mig-p-code" label={t('code')}><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required pattern="[A-Za-z][A-Za-z0-9_\-]{1,39}" autoCapitalize="characters" /></Field>
      <Field name="mig-p-name" label={t('name')}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={3} /></Field>
      <Field name="mig-p-kind" label={t('kind')}><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, phase: e.target.value.startsWith('TEMPLATE:') ? 'MASTERS' : 'BALANCES' })}>{board.kinds.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}</select></Field>
      <Field name="mig-p-phase" label={t('phase')}><select value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value })}>{['MASTERS', 'OPEN_DOCUMENTS', 'BALANCES'].map((p) => <option key={p} value={p}>{t(`ph.${p}`)}</option>)}</select></Field>
      <Field name="mig-p-seq" label={t('sequence')}><input inputMode="numeric" value={f.sequence} onChange={(e) => setF({ ...f, sequence: e.target.value.replace(/\D/g, '') })} required /></Field>
      <Field name="mig-p-owner" label={t('owner')}><input value={f.ownerRole} onChange={(e) => setF({ ...f, ownerRole: e.target.value.toUpperCase() })} required /></Field>
      <button type="submit" className="btn btn-primary" disabled={create.isPending}>{t('addObject')}</button>
    </form>
  </details>;
}

export function MigrationCockpit() {
  const t = useT('mig');
  const { number } = useFormat();
  const search = useSearch();
  usePageTitle(t('title'));
  const selected = search.get('object') ?? '';
  const q = useQuery({ queryKey: ['mig', 'board'], queryFn: () => read('/admin/migration'), retry: false });
  return <section aria-labelledby="mig-h" data-testid="mig-page">
    <PageHeader id="mig-h" title={t('title')} subtitle={t('subtitle')} />
    <p className="mig-desk" data-testid="mig-desk">{t('desk')}</p>
    {q.isPending ? <Skeleton label={t('title')} rows={6} /> : q.error?.status === 403 ? <NoPermission message={q.error.message} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : <>
      <KpiRow testid="mig-kpis" label={t('title')}>
        <KpiTile testid="mig-k-objects" kind="count" label={t('k.objects')} value={number(q.data.totals.objects, { decimals: 0 })} tone="neutral">{t('k.objectsHelp')}</KpiTile>
        <KpiTile testid="mig-k-signed" kind="count" label={t('k.signed')} value={number(q.data.totals.signedOff, { decimals: 0 })} tone={q.data.totals.signedOff === q.data.totals.objects && q.data.totals.objects ? 'success' : 'warning'}>{t('k.signedHelp')}</KpiTile>
        <KpiTile testid="mig-k-loaded" kind="count" label={t('k.loaded')} value={number(q.data.totals.loaded, { decimals: 0 })} tone={q.data.totals.loaded === q.data.totals.objects && q.data.totals.objects ? 'success' : 'neutral'}>{t('k.loadedHelp')}</KpiTile>
        <KpiTile testid="mig-k-cutover" label={t('k.cutover')} value={q.data.cutover ? t(`cs.${q.data.cutover.status}`) : t('k.none')} tone={q.data.cutover?.status === 'FROZEN' ? 'warning' : 'neutral'}>{q.data.cutover?.name ?? t('k.noneHelp')}</KpiTile>
      </KpiRow>
      {q.data.canManage && <PlanForm board={q.data} />}
      {!q.data.rows.length ? <EmptyState title={t('none')} message={t('noneBody')} /> :
        <div className="mig-board" data-testid="mig-board">{[['PLANNED', ['PLANNED']], ['TRIAL', ['TRIAL', 'READY']], ['SIGNOFF', ['SIGNOFF']], ['SIGNED_OFF', ['SIGNED_OFF']], ['LOADED', ['LOADED']]].map(([col, sts]) => {
          const items = q.data.rows.filter((r) => sts.includes(r.status));
          return <section key={col} className="mig-lane" aria-label={t(`lane.${col}`)} data-lane={col}>
            <h2 className="mig-lane-h">{t(`lane.${col}`)} <span className="muted">({number(items.length, { decimals: 0 })})</span></h2>
            {items.map((r) => <button key={r.code} type="button" className={`mig-tile${selected === r.code ? ' mig-on' : ''}`} onClick={() => go({ object: r.code === selected ? '' : r.code })} aria-pressed={selected === r.code} data-testid="mig-tile" data-code={r.code}>
              <strong>{r.name}</strong><span className="small">{t(`ph.${r.phase}`)} · #{r.sequence} · {r.ownerRole}</span>
              <span className="small">{t('trials', { n: r.trialsPassed, of: r.trialsNeeded, v: r.mappingVersion })}</span>
              {r.lastRun && <StatusBadge status={RUN[r.lastRun.status]} label={t(`rs.${r.lastRun.status}`)} size="sm" />}
              {r.canSignOff && <span className="small mig-mine">{t('yourSignOff')}</span>}
            </button>)}
          </section>; })}</div>}
      {selected && <ObjectPanel key={selected} code={selected} board={q.data} />}
      <Cutover board={q.data} />
    </>}
  </section>;
}

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { BOQ_TONE, MAP_TONE, bq, downloadBoq, inr } from './api.js';
import { Tabs, useSearch } from './parts.jsx';

// BOQ (part 10.04, FR-01, FR-02, FR-06, FR-07): one BOQ version as a hierarchical grid (bill, section, item, sub-item) with quantity, rate, amount, mapping status, norms and the read-only quantity status columns of the other modules; add and edit lines
// while it is a draft; send a contract or revised version for the freeze (QS, the commercial manager, the project manager); after the freeze nothing changes except mapping and norms by an approved request. Rates are shown to those who may see them.
const blank = { kind: 'ITEM', parentId: '', itemCode: '', description: '', uom: '', qty: '', rate: '', isExtra: false };
export default function BoqVersionPage() {
  const t = useT('proj');
  const qc = useQueryClient();
  const id = Number(useSearch().get('id')) || null;
  const q = useQuery({ queryKey: ['proj', 'boq', id], queryFn: () => bq.lines(id), enabled: Boolean(id), retry: false });
  const [tab, setTab] = useState('items'); const [panel, setPanel] = useState(null); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [unmapped, setUnmapped] = useState(false);
  usePageTitle(q.data ? `${q.data.version.docNo} ${q.data.version.name}` : t('bq.title'));
  if (!id) return <section aria-labelledby="bq-h" data-testid="boq-none"><h1 id="bq-h">{t('bq.title')}</h1><p className="muted">{t('bq.noId')} <Link to="/proj/versions">{t('bq.listTitle')}</Link></p></section>;
  if (q.error?.status === 403) return <NoPermission what={t('bq.listTitle')} permission="proj.version.view" />;
  if (q.isPending) return <Skeleton label={t('bq.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const v = q.data.version; const c = v.can; const lines = unmapped ? q.data.lines.filter((l) => l.leaf && ['UNMAPPED', 'PARTIAL'].includes(l.mapped)) : q.data.lines;
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['proj'] }); return r ?? true; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const showQs = lines.some((l) => l.executed != null || l.certified != null);
  return (
    <section aria-labelledby="bq-h" data-testid="boq-version" data-status={v.status} data-type={v.type}>
      <header>
        <h1 id="bq-h">{v.docNo} · {v.projectCode} {v.name} <StatusBadge status={BOQ_TONE[v.status]} label={v.statusLabel} /></h1>
        <p className="muted">{v.typeLabel} v{v.versionNo} · {v.projectName}{v.sourceRef ? ` · ${v.sourceRef}` : ''}{v.variationRef ? ` · ${t('bq.variation')} ${v.variationRef}` : ''}</p>
        <dl className="op-figures" data-testid="boq-figures">
          <div><dt>{t('bq.items')}</dt><dd data-testid="boq-items">{v.items}</dd></div>
          {v.ratesVisible ? <div><dt>{t('bq.total')}</dt><dd data-testid="boq-total">{inr(v.total)}</dd></div> : <div><dt>{t('bq.total')}</dt><dd className="muted">{t('bq.masked')}</dd></div>}
          <div><dt>{t('bq.unmapped')}</dt><dd data-testid="boq-unmapped">{q.data.version.stats?.unmapped ?? 0}</dd></div>
          <div><dt>{t('bq.withNorms')}</dt><dd>{q.data.version.stats?.withNorms ?? 0}</dd></div>
          {v.frozenAt && <div><dt>{t('bq.frozen')}</dt><dd data-testid="boq-frozen">{String(v.frozenAt).slice(0, 10)} · {v.frozenBy}</dd></div>}
        </dl>
        {error?.form && <p className="field-error" role="alert" data-testid="boq-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 6).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="boq-note">{note}</p>}
        {v.status === 'APPROVED' && <p className="mdm-banner" role="status" data-testid="boq-frozen-note">{t('bq.frozenNote')}</p>}
        {v.openChange && <p className="mdm-banner" role="status">{t('bq.openChange')}</p>}
        <div className="actions-row no-print" data-testid="boq-actions">
          {c.edit && <button type="button" className="btn btn-primary" onClick={() => setPanel(panel === 'line' ? null : 'line')} data-testid="boq-add-line">{t('bq.addLine')}</button>}
          {c.import && <Link to={`/proj/boq-import?versionId=${v.id}&projectId=${v.projectId}`}>{t('bq.importMore')}</Link>}
          {(c.map || c.amend) && <Link to={`/proj/boq-mapping?versionId=${v.id}`}>{t('bq.mapTool')}</Link>}
          {c.submit && <button type="button" className="btn btn-primary" onClick={() => { if (window.confirm(t('bq.confirmFreeze'))) run(() => bq.act(v.id, 'submit'), t('bq.sent')); }} data-testid="boq-submit">{t('bq.submit')}</button>}
          {c.withdraw && <button type="button" className="btn" onClick={() => why((r) => bq.act(v.id, 'withdraw', { reason: r }), t('bq.withdrawn'))}>{t('act.withdraw')}</button>}
          {c.cancel && <button type="button" className="btn" onClick={() => why((r) => bq.act(v.id, 'cancel', { reason: r }), t('bq.cancelled'))}>{t('bl.cancel')}</button>}
          {c.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('bq.confirmDelete'))) { const r = await run(() => bq.remove(v.id)); if (r) navigateTo('/proj/versions', { force: true }); } }} data-testid="boq-delete">{t('act.delete')}</button>}
          {c.print && <button type="button" className="btn" onClick={() => downloadBoq(v.id, 'html')} data-testid="boq-print">{t('act.print')}</button>}
          {c.print && <button type="button" className="btn" onClick={() => downloadBoq(v.id, 'pdf')}>{t('bl.pdf')}</button>}
          {c.export && <button type="button" className="btn" onClick={() => downloadBoq(v.id, 'xlsx')} data-testid="boq-xlsx">{t('bl.xlsx')}</button>}
          <label className="small"><input type="checkbox" checked={unmapped} onChange={(e) => setUnmapped(e.target.checked)} data-testid="boq-unmapped-only" /> {t('bq.unmappedOnly')}</label>
        </div>
        {panel === 'line' && c.edit && <LineForm lines={q.data.lines} run={run} versionId={v.id} error={error} done={() => setPanel(null)} />}
      </header>
      <Tabs tabs={['items', 'changes', 'approvals']} active={tab} onChange={setTab} label={t('bq.title')} />
      {tab === 'items' && (
        lines.length === 0 ? <div className="mdm-banner" data-testid="boq-empty"><strong>{t('bq.noLinesTitle')}</strong> {t('bq.noLinesText')}</div> : (
          <div className="table-wrap" data-testid="boq-grid">
            <table className="data-table"><caption className="sr-only">{t('bq.title')}</caption>
              <thead><tr><th scope="col">{t('bq.code')}</th><th scope="col">{t('bl.description')}</th><th scope="col">{t('bl.uom')}</th><th scope="col" className="num">{t('bl.qty')}</th>{v.ratesVisible && <th scope="col" className="num">{t('bl.rate')}</th>}{v.ratesVisible && <th scope="col" className="num">{t('bl.amount')}</th>}<th scope="col">{t('bq.mapping')}</th><th scope="col">{t('bq.norms')}</th>{showQs && ['executed', 'measured', 'certified', 'billed', 'balance'].map((k) => <th key={k} scope="col" className="num">{t(`bq.qs.${k}`)}</th>)}{c.edit && <th scope="col" className="no-print">{t('wbs.actions')}</th>}</tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.id} data-testid="boq-row" data-code={l.code} data-kind={l.kind} className={l.leaf ? '' : 'muted'}>
                  <td><span style={{ paddingInlineStart: `${l.depth * 16}px` }}>{l.code}</span></td><td>{l.leaf ? '' : <strong>{l.kindLabel}: </strong>}{l.description}{l.isExtra ? ` · ${t('bq.extra')}` : ''}</td><td>{l.uom ?? ''}</td><td className="num">{l.qty ?? ''}</td>
                  {v.ratesVisible && <td className="num">{l.rate ?? ''}</td>}{v.ratesVisible && <td className="num">{l.amount == null ? '' : inr(l.amount)}</td>}
                  <td>{l.leaf && l.mapped !== 'NONE' ? <StatusBadge status={MAP_TONE[l.mapped]} label={t(`bq.map.${l.mapped}`)} /> : ''}</td><td>{l.leaf ? l.norms || '—' : ''}</td>
                  {showQs && ['executed', 'measured', 'certified', 'billed', 'balance'].map((k) => <td key={k} className="num">{l[k] ?? '—'}</td>)}
                  {c.edit && <td className="no-print">{l.leaf && <button type="button" className="btn" onClick={() => { const r = window.prompt(t('bq.newQty'), l.qty); if (r != null && r !== '') run(() => bq.updateLine(l.id, { qty: r, version: l.rowVersion }), t('wbs.saved')); }} data-testid={`boq-qty-${l.code}`}>{t('bq.changeQty')}</button>}<button type="button" className="btn" onClick={() => { if (window.confirm(t('wbs.confirmDelete', { code: l.code }))) run(() => bq.removeLine(l.id)); }} data-testid={`boq-del-${l.code}`}>{t('act.delete')}</button></td>}
                </tr>))}</tbody>
            </table>
          </div>
        )
      )}
      {tab === 'changes' && <Changes v={v} run={run} />}
      {tab === 'approvals' && <Approvals v={v} />}
      <p className="small"><Link to="/proj/versions">{t('bq.listTitle')}</Link> · <Link to={`/proj/boq-reports?versionId=${v.id}`}>{t('bq.reports')}</Link></p>
    </section>
  );
}
function LineForm({ lines, run, versionId, error, done }) {
  const t = useT('proj'); const [f, setF] = useState(blank); const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const groups = lines.filter((l) => !l.leaf || l.kind === 'ITEM');
  return (
    <form className="mdm-panel" aria-label={t('bq.addLine')} data-testid="boq-line-form" onSubmit={async (e) => { e.preventDefault(); const leaf = ['ITEM', 'SUBITEM'].includes(f.kind); if (await run(() => bq.addLine(versionId, { kind: f.kind, parentId: f.parentId ? Number(f.parentId) : null, itemCode: f.itemCode.trim(), description: f.description.trim(), ...(leaf ? { uom: f.uom.trim(), qty: f.qty || '0', rate: f.rate || '0', isExtra: f.isExtra } : {}) }), t('bq.lineAdded'))) done(); }}>
      <h2>{t('bq.addLine')}</h2>
      <div className="form-grid">
        <Field label={t('f.type')} name="kind" error={error}><select value={f.kind} onChange={(e) => set('kind', e.target.value)} data-testid="bl-kind">{['BILL', 'SECTION', 'ITEM', 'SUBITEM'].map((k) => <option key={k} value={k}>{t(`bq.kind.${k}`)}</option>)}</select></Field>
        <Field label={t('wbs.under')} name="parentId" error={error}><select value={f.parentId} onChange={(e) => set('parentId', e.target.value)} data-testid="bl-parent"><option value="">{t('wbs.topLevel')}</option>{groups.map((l) => <option key={l.id} value={l.id}>{l.code} {l.description.slice(0, 40)}</option>)}</select></Field>
        <Field label={t('bq.code')} name="itemCode" error={error}><input value={f.itemCode} onChange={(e) => set('itemCode', e.target.value)} maxLength={60} required data-testid="bl-code" /></Field>
        <Field label={t('bl.description')} name="description" error={error}><input value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={4000} required data-testid="bl-desc" /></Field>
        {['ITEM', 'SUBITEM'].includes(f.kind) && <>
          <Field label={t('bl.uom')} name="uom" error={error}><input value={f.uom} onChange={(e) => set('uom', e.target.value)} maxLength={20} data-testid="bl-uom" /></Field>
          <Field label={t('bl.qty')} name="qty" error={error}><input inputMode="decimal" value={f.qty} onChange={(e) => set('qty', e.target.value)} data-testid="bl-qty" /></Field>
          <Field label={t('bl.rate')} name="rate" error={error}><input inputMode="decimal" value={f.rate} onChange={(e) => set('rate', e.target.value)} data-testid="bl-rate" /></Field>
          <label><input type="checkbox" checked={f.isExtra} onChange={(e) => set('isExtra', e.target.checked)} /> {t('bq.extra')}</label></>}
      </div>
      <div className="actions"><button type="button" className="btn" onClick={done}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="bl-save">{t('bl.save')}</button></div>
    </form>
  );
}
function Changes({ v, run }) {
  const t = useT('proj'); const q = useQuery({ queryKey: ['proj', 'boq-changes', v.id], queryFn: () => bq.changes(v.id), retry: false });
  if (q.isPending) return <Skeleton label={t('bq.changes')} rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <div data-testid="boq-changes">
      <p className="muted small">{t('bq.changesHelp')}</p>
      {q.data.length === 0 ? <p className="muted" data-testid="boq-no-changes">{t('bq.noChanges')}</p> : <ul className="mdm-list">{q.data.map((c) => <li key={c.id} data-testid="boq-change" data-status={c.status}><strong>{c.statusLabel}</strong> · {c.requestedBy} · {c.reason}<ul className="mdm-list">{c.diff.map((d, i) => <li key={i}>{d.code} · {d.kind === 'MAPPING' ? t('bq.mapping') : t('bq.norms')}</li>)}</ul>{c.status === 'SUBMITTED' && <button type="button" className="btn" onClick={() => { const r = window.prompt(t('act.why')); if (r) run(() => bq.actChange(c.id, 'withdraw', { reason: r }), t('bq.withdrawn')); }}>{t('act.withdraw')}</button>}</li>)}</ul>}
    </div>
  );
}
function Approvals({ v }) {
  const t = useT('proj'); const q = useQuery({ queryKey: ['proj', 'boq-history', v.id, v.rowVersion], queryFn: () => bq.history(v.id), retry: false });
  if (q.isPending) return <Skeleton label={t('tab.approvals')} rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const li = (a, i) => <li key={i}><strong>{a.event}</strong> · {a.actor}{a.step_code ? ` · ${a.step_code}` : ''} · <span className="muted small">{String(a.at).slice(0, 16).replace('T', ' ')}</span>{a.comment ? ` · ${a.comment}` : ''}</li>;
  return (
    <div data-testid="boq-approvals"><h2>{t('tab.approvals')}</h2>
      {q.data.approvals.length === 0 ? <p className="muted">{t('obj.noApprovals')}</p> : <ul className="mdm-list">{q.data.approvals.map(li)}</ul>}
      {q.data.changes.length > 0 && <><h2>{t('bq.changes')}</h2><ul className="mdm-list">{q.data.changes.map(li)}</ul></>}
      <h2>{t('obj.changes')}</h2><ul className="mdm-list">{q.data.audit.map((a, i) => <li key={i}>{a.action} · {a.actor} · <span className="muted small">{String(a.at).slice(0, 16).replace('T', ' ')}</span>{a.reason ? ` · ${a.reason}` : ''}</li>)}</ul>
    </div>
  );
}

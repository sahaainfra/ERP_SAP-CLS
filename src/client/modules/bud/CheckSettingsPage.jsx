import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { CFG_TONE, STAGES, dayIST, download, lg } from './api.js';

// Budget Check Settings (part 12.03, FR-01, AC-04): how strictly each stage is checked, per cost head, with a tolerance and a start date; a change is proposed by one person and decided by another, and the list keeps every setting with its history.
export default function CheckSettingsPage() {
  const t = useT('bud');
  usePageTitle(t('cfg.title'));
  const qc = useQueryClient(); const session = useSession(); const perms = session.data?.permissions ?? [];
  const q = useQuery({ queryKey: ['bud', 'check-config'], queryFn: lg.config, retry: false });
  const [f, setF] = useState({ costHeadId: '', stage: '', mode: 'WARN', tolerancePct: '0', effectiveFrom: dayIST(), reason: '' }); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [hist, setHist] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  if (q.error?.status === 403) return <NoPermission what={t('cfg.title')} permission="bud.check.view" />;
  if (q.isPending) return <Skeleton label={t('cfg.title')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const propose = async (e) => {
    e.preventDefault(); setError(null); setNote(null);
    try { await lg.propose({ costHeadId: f.costHeadId ? Number(f.costHeadId) : null, stage: f.stage || null, mode: f.mode, tolerancePct: Number(f.tolerancePct || 0), effectiveFrom: f.effectiveFrom, reason: f.reason.trim() }); setNote(t('cfg.proposed')); set('reason', ''); qc.invalidateQueries({ queryKey: ['bud'] }); } catch (x) { setError(errorInfo(x)); }
  };
  const cancel = async (c) => { const why = window.prompt(t('act.why')); if (!why) return; try { await lg.cancelConfig(c.id, why); qc.invalidateQueries({ queryKey: ['bud'] }); } catch (x) { setError(errorInfo(x)); } };
  const show = async (c) => setHist({ c, h: await lg.configHistory(c.id) });
  return (
    <section aria-labelledby="cfg-h" data-testid="bud-settings">
      <h1 id="cfg-h">{t('cfg.title')}</h1>
      <p className="muted">{t('cfg.intro')} <span data-testid="cfg-inforce">{t('cfg.inForce', { n: d.inForce })}</span></p>
      {note && <p className="mdm-banner" role="status" data-testid="cfg-note">{note}</p>}
      {perms.includes('bud.check.configure') && (
        <form className="mdm-panel" onSubmit={propose} data-testid="cfg-form" aria-label={t('cfg.propose')}>
          <h2>{t('cfg.propose')}</h2>
          <div className="form-grid">
            <Field label={t('cfg.head')} name="costHeadId" error={error}><select value={f.costHeadId} onChange={(e) => set('costHeadId', e.target.value)} data-testid="cfg-head"><option value="">{t('cfg.all')}</option>{d.heads.map((h) => <option key={h.id} value={h.id}>{h.code} {h.name}</option>)}</select></Field>
            <Field label={t('led.stage')} name="stage" error={error}><select value={f.stage} onChange={(e) => set('stage', e.target.value)} data-testid="cfg-stage"><option value="">{t('cfg.all')}</option>{STAGES.map((k) => <option key={k} value={k}>{t(`stage.${k}`)}</option>)}</select></Field>
            <Field label={t('cfg.mode')} name="mode" error={error}><select value={f.mode} onChange={(e) => set('mode', e.target.value)} data-testid="cfg-mode">{['OFF', 'WARN', 'BLOCK'].map((k) => <option key={k} value={k}>{t(`mode.${k}`)}</option>)}</select></Field>
            <Field label={t('cfg.tolerance')} name="tolerancePct" error={error}><input type="number" min="0" max="100" step="0.01" value={f.tolerancePct} onChange={(e) => set('tolerancePct', e.target.value)} data-testid="cfg-tol" /></Field>
            <Field label={t('cfg.from')} name="effectiveFrom" error={error}><input type="date" value={f.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} required data-testid="cfg-from" /></Field>
            <Field label={t('f.reason')} name="reason" error={error}><input value={f.reason} onChange={(e) => set('reason', e.target.value)} required minLength={5} maxLength={1000} data-testid="cfg-reason" /></Field>
          </div>
          {error?.form && <p className="field-error" role="alert" data-testid="cfg-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={f.reason.trim().length < 5} data-testid="cfg-save">{t('cfg.send')}</button></div>
        </form>
      )}
      <div className="actions-row no-print"><button type="button" className="btn" onClick={() => download('/check-config/export', 'budget-check-settings.csv')} data-testid="cfg-export">{t('cmp.export')}</button></div>
      {d.rows.length === 0 ? <p className="muted" data-testid="cfg-empty">{t('cfg.empty')}</p> : (
        <div className="table-scroll"><table className="data-table" data-testid="cfg-table"><caption className="sr-only">{t('cfg.title')}</caption>
          <thead><tr><th>{t('f.docNo')}</th><th>{t('cfg.head')}</th><th>{t('led.stage')}</th><th>{t('cfg.mode')}</th><th className="num">{t('cfg.tolerance')}</th><th>{t('cfg.from')}</th><th>{t('f.status')}</th><th>{t('cfg.by')}</th><th /></tr></thead>
          <tbody>{d.rows.map((c) => (
            <tr key={c.id} data-testid="cfg-row" data-status={c.status}>
              <td>{c.docNo}</td><td>{c.costHead ?? t('cfg.all')}</td><td>{c.stage ? t(`stage.${c.stage}`) : t('cfg.all')}</td><td>{t(`mode.${c.mode}`)}</td><td className="num">{c.tolerancePct} %</td><td>{c.effectiveFrom}</td>
              <td><StatusBadge status={CFG_TONE[c.status]} label={t(`cfs.${c.status}`)} /></td><td>{c.requestedBy}{c.approvedBy ? ` → ${c.approvedBy}` : ''}</td>
              <td><button type="button" className="btn" onClick={() => show(c)} data-testid="cfg-history">{t('page.history')}</button>{c.canCancel && perms.includes('bud.check.configure') && <button type="button" className="btn" onClick={() => cancel(c)} data-testid="cfg-cancel">{t('act.cancel')}</button>}{c.workflowInstanceId && c.status === 'PENDING' && <Link to={`/workflow/instance?id=${c.workflowInstanceId}`}>{t('page.approval')}</Link>}</td>
            </tr>))}</tbody></table></div>
      )}
      {hist && (
        <div className="mdm-panel" data-testid="cfg-hist"><h2>{hist.c.docNo} · {t('page.history')}</h2>
          <ul>{[...hist.h.approvals.map((a) => `${a.at?.slice(0, 16)} · ${a.step_code ?? ''} ${a.event} · ${a.actor}${a.comment ? `: ${a.comment}` : ''}`), ...hist.h.audit.map((a) => `${a.at?.slice(0, 16)} · ${a.action} · ${a.actor}${a.reason ? `: ${a.reason}` : ''}`)].map((s, i) => <li key={i}>{s}</li>)}</ul>
          <div className="actions"><button type="button" className="btn" onClick={() => setHist(null)}>{t('act.close')}</button></div>
        </div>
      )}
    </section>
  );
}

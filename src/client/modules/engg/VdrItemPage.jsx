import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { RESPONSES, VDR_TONE, ep, openPrint } from './api.js';
import { useSearch } from './parts.jsx';

// VDR item (part 11.04): one document a vendor owes: the receipt, the review code proposed by the reviewer and approved by the engineering manager, and the cycles.
export default function VdrItemPage() {
  const t = useT('engg');
  const qc = useQueryClient();
  const id = Number(useSearch().get('id')) || null;
  const q = useQuery({ queryKey: ['engg', 'vdr-item', id], queryFn: () => ep.vdr(id), enabled: Boolean(id), retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [rv, setRv] = useState({ code: 'A', text: '' });
  usePageTitle(q.data ? `${q.data.vdrNo} ${q.data.title}` : t('vdr.itemTitle'));
  if (!id) return <section aria-labelledby="vi-h" data-testid="vdr-none"><h1 id="vi-h">{t('vdr.itemTitle')}</h1><p className="muted"><Link to="/engg/vdr">{t('nav.vdr')}</Link></p></section>;
  if (q.error?.status === 403) return <NoPermission what={t('nav.vdr')} permission="engg.vdr_item.view" />;
  if (q.isPending) return <Skeleton label={t('vdr.itemTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const v = q.data; const c = v.can;
  const run = async (fn, done) => { setError(null); setNote(null); try { const x = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['engg'] }); return x; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  return (
    <section aria-labelledby="vi-h" data-testid="vdr-item" data-status={v.status} data-cycle={v.cycle}>
      <header>
        <h1 id="vi-h">{v.vdrNo} · {v.title} <StatusBadge status={VDR_TONE[v.status]} label={t(`vdrs.${v.status}`)} /></h1>
        <p className="muted">{v.projectCode} · {t('vdr.po')} {v.poRef} · {v.vendor} · {t(`vtype.${v.docType}`)} · {t('vdr.due')} {v.dueDate}{v.overdue ? ` · ${t('dwg.overdue')}` : ''} · {t('vdr.cycle')} {v.cycle}</p>
        <p data-testid="vdr-review">{v.reviewCode ? `${t('vdr.reviewCode')}: ${v.reviewCode} ${t(`sresp.${v.reviewCode}`)}${v.reviewText ? ` — ${v.reviewText}` : ''}` : t('vdr.notReviewed')}{v.submittedOn ? ` · ${t('sub.submittedOn')} ${v.submittedOn}` : ''}</p>
        {error?.form && <p className="field-error" role="alert" data-testid="vdr-act-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="vdr-note">{note}</p>}
        <div className="actions-row no-print">
          {c.receive && <button type="button" className="btn btn-primary" onClick={() => run(() => ep.vdrAct(v.id, 'receive', {}), t('vdr.receivedNote'))} data-testid="vdr-receive">{t('vdr.receive')}</button>}
          {c.withdraw && <button type="button" className="btn" onClick={() => why((x) => ep.vdrAct(v.id, 'withdraw', { reason: x }), t('rev.withdrawn'))} data-testid="vdr-withdraw">{t('act.withdraw')}</button>}
          {c.amend && <button type="button" className="btn" onClick={() => why((x) => ep.vdrAct(v.id, 'amend', { reason: x }), t('vdr.reopened'))} data-testid="vdr-amend">{t('act.amend')}</button>}
          {c.cancel && <button type="button" className="btn" onClick={() => why((x) => ep.vdrAct(v.id, 'cancel', { reason: x }), t('vdr.cancelled'))} data-testid="vdr-cancel">{t('act.cancel')}</button>}
          {c.delete && <button type="button" className="btn" onClick={async () => { if (await run(() => ep.removeVdr(v.id))) navigateTo('/engg/vdr'); }} data-testid="vdr-delete">{t('act.delete')}</button>}
          {c.print && <button type="button" className="btn" onClick={() => openPrint(`/vdr-items/${v.id}/print`, `${v.vdrNo}.html`)} data-testid="vdr-print">{t('act.print')}</button>}
          {v.workflowInstanceId && <Link to={`/workflow/instance?id=${v.workflowInstanceId}`}>{t('rev.approval')}</Link>}
        </div>
      </header>
      {c.review && (
        <form className="mdm-panel" aria-label={t('vdr.proposeReview')} data-testid="vdr-review-form" onSubmit={(e) => { e.preventDefault(); run(() => ep.vdrAct(v.id, 'submit', { code: rv.code, text: rv.text.trim() || null }), t('vdr.reviewSent')); }}>
          <h2>{t('vdr.proposeReview')}</h2>
          <div className="form-grid">
            <Field label={t('vdr.reviewCode')} name="code" error={error}><select value={rv.code} onChange={(e) => setRv({ ...rv, code: e.target.value })} data-testid="vdr-code">{RESPONSES.map((k) => <option key={k} value={k}>{k} {t(`sresp.${k}`)}</option>)}</select></Field>
            <Field label={t('tx.comments')} name="text" error={error}><textarea value={rv.text} onChange={(e) => setRv({ ...rv, text: e.target.value })} rows={3} maxLength={2000} data-testid="vdr-comment" /></Field>
          </div>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="vdr-send-review">{t('vdr.sendReview')}</button></div>
        </form>
      )}
    </section>
  );
}

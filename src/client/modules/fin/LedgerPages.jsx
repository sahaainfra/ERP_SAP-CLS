import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import Chart from '../../platform/charts/Chart.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { gl, money } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';

// Part 23.01 FR-05: the ledger of one account (running balance, drill to the voucher and its source document) and the trial balance on any date and by
// dimension (drill to the account's ledger), with the export of each and, on the trial balance, the carry-forward of a year's balances (FR-06).
const big = { minHeight: 'var(--erp-target-large)', fontSize: '1rem' };
const FILTER_DIMS = [['projectId', 'projects'], ['siteId', 'sites'], ['branchId', 'branches'], ['costCentreId', 'costCentres']];
const pick = (sp, keys) => Object.fromEntries(keys.map((k) => [k, sp.get(k) ?? '']).filter(([, v]) => v !== ''));
const toUrl = (path, f) => `${path}?${gl.q(f)}`;
/** A phone: the report's parameters start closed, below its figures (14 §3.5: chart first, parameters in a sheet). */
const useNarrow = () => useState(() => Boolean(globalThis.matchMedia?.('(max-width: 767px)').matches))[0];

/** The dimension filters, in a sheet on a phone (a details element: closed by default, summary of what is chosen). */
function DimFilters({ f, setF, opt }) {
  const t = useT('fin'); const n = FILTER_DIMS.filter(([k]) => f[k]).length;
  return (
    <details className="mdm-panel gl-filters" data-testid="gl-dim-filters"><summary style={big}>{t('led.filters')}{n ? ` (${n})` : ''}</summary>
      <div className="form-grid">{FILTER_DIMS.map(([k, list]) => (
        <Field key={k} label={t(`dim.${k}`)} name={k} error={null}><select value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} style={big} data-testid={`gl-filter-${k}`}><option value="">{t('common.all')}</option>{(opt?.[list] ?? []).map((o) => <option key={o.id} value={o.id}>{o.code} {o.name}</option>)}</select></Field>
      ))}</div>
    </details>
  );
}

export function LedgerPage() {
  const t = useT('fin'); const tc = useT('common'); usePageTitle(t('led.title')); const sp = useSearch();
  const [f, setF] = useState(() => pick(sp, ['accountId', 'from', 'to', ...FILTER_DIMS.map((d) => d[0])]));
  const [shown, setShown] = useState(f); const [page, setPage] = useState(1);
  const opt = useQuery({ queryKey: ['gl', 'options'], queryFn: gl.options, retry: false });
  const q = useQuery({ queryKey: ['gl', 'ledger', shown, page], queryFn: () => gl.ledger({ ...shown, page, pageSize: 100 }), enabled: Boolean(shown.accountId), retry: false, placeholderData: (p) => p });
  if (opt.error?.status === 403 || q.error?.status === 403) return <NoPermission what={t('led.title')} permission="fin.ledger.view" />;
  if (opt.isPending) return <Skeleton label={t('led.title')} rows={5} />;
  const x = q.data; const bal = (b) => (b ? `${money(b.amount)} ${b.side}` : '—');
  return (
    <section aria-labelledby="led-h" data-testid="gl-ledger">
      <PageHeader id="led-h" title={t('led.title')} subtitle={t('led.intro')} meta={<><Link to="/finance/trial-balance">{t('tb.title')}</Link> · <Link to="/finance/journals">{t('jn.title')}</Link></>} />
      <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); setPage(1); setShown(f); globalThis.history?.replaceState(null, '', toUrl('/finance/ledger', f)); }}>
        <div className="form-grid">
          <Field label={t('led.account')} name="accountId" error={null}><select value={f.accountId ?? ''} onChange={(e) => setF({ ...f, accountId: e.target.value })} style={big} data-testid="gl-ledger-account"><option value="">{t('jn.pickAccount')}</option>{opt.data.accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></Field>
          <Field label={t('led.from')} name="from" error={null}><input type="date" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value })} style={big} data-testid="gl-ledger-from" /></Field>
          <Field label={t('led.to')} name="to" error={null}><input type="date" value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value })} style={big} data-testid="gl-ledger-to" /></Field>
        </div>
        <DimFilters f={f} setF={setF} opt={opt.data} />
        <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={!f.accountId} data-testid="gl-ledger-show">{t('common.apply')}</button>
          {x && <button type="button" className="btn" onClick={() => gl.file(`/ledger/export?${gl.q(shown)}`, `ledger-${x.account.code}-${x.to}.csv`).catch(() => globalThis.alert?.(t('act.exportFailed')))} data-testid="gl-ledger-export">{t('led.export')}</button>}</div>
      </form>
      {!shown.accountId ? <EmptyState title={t('led.title')} message={t('led.pick')} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : !x ? <Skeleton label={t('led.title')} rows={5} /> : (
        <>
          <h2 data-testid="gl-ledger-account-name">{x.account.code} {x.account.name} · {x.from} – {x.to}</h2>
          <KpiRow label={t('led.title')}>
            <KpiTile label={t('led.opening')} value={bal(x.opening)} valueTestid="gl-ledger-opening" />
            <KpiTile label={t('jn.debit')} value={money(x.debit)} amount={x.debit} kind="money" />
            <KpiTile label={t('jn.credit')} value={money(x.credit)} amount={x.credit} kind="money" />
            <KpiTile label={t('led.closing')} value={bal(x.closing)} valueTestid="gl-ledger-closing" />
          </KpiRow>
          {x.rows.length === 0 ? <EmptyState title={t('led.title')} message={t('led.empty')} /> : (
            <div className="table-scroll" data-testid="gl-ledger-rows"><table className="data-table"><caption>{t('led.rows', { n: x.totalRows })}</caption>
              <thead><tr><th scope="col">{t('jn.date')}</th><th scope="col">{t('jn.voucher')}</th><th scope="col">{t('jn.narration')}</th><th scope="col" className="num">{t('jn.debit')}</th><th scope="col" className="num">{t('jn.credit')}</th><th scope="col" className="num">{t('led.balance')}</th><th scope="col">{t('jn.source')}</th></tr></thead>
              <tbody>{x.rows.map((r) => <tr key={r.lineId} data-testid="gl-ledger-row"><td>{r.date}</td><td><Link to={`/finance/journals?id=${r.journalId}`}>{r.voucherNo}</Link></td><td>{r.narration}</td><td className="num">{r.debit ? money(r.debit) : ''}</td><td className="num">{r.credit ? money(r.credit) : ''}</td><td className="num">{bal(r.balance)}</td><td>{r.source?.route ? <Link to={r.source.route}>{r.source.label} {r.source.id}</Link> : ''}</td></tr>)}</tbody>
            </table></div>
          )}
          {x.totalRows > x.pageSize && <div className="actions-row"><button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>{tc('previous')}</button><span>{page} / {Math.ceil(x.totalRows / x.pageSize)}</span><button type="button" className="btn" disabled={page * x.pageSize >= x.totalRows} onClick={() => setPage(page + 1)}>{tc('next')}</button></div>}
        </>
      )}
    </section>
  );
}

export function TrialBalancePage() {
  const t = useT('fin'); usePageTitle(t('tb.title')); const sp = useSearch(); const session = useSession(); const narrow = useNarrow();
  const [f, setF] = useState(() => pick(sp, ['asOf', 'from', ...FILTER_DIMS.map((d) => d[0])])); const [shown, setShown] = useState(f);
  const opt = useQuery({ queryKey: ['gl', 'options'], queryFn: gl.options, retry: false });
  const q = useQuery({ queryKey: ['gl', 'tb', shown], queryFn: () => gl.trialBalance(shown), retry: false, placeholderData: (p) => p });
  const { error, note, busy, run } = useGlRunner();
  if (q.error?.status === 403) return <NoPermission what={t('tb.title')} permission="fin.ledger.view" />;
  if (q.isPending || opt.isPending) return <Skeleton label={t('tb.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const canCarry = Boolean(session.data?.permissions?.includes('fin.journal.create'));
  const chart = { categories: x.byNature.map((n) => t(`nature.${n.nature}`)), series: [{ name: t('led.closing'), values: x.byNature.map((n) => Math.round(n.amount)) }], unit: '' };
  return (
    <section aria-labelledby="tb-h" data-testid="gl-tb">
      <PageHeader id="tb-h" title={t('tb.title')} subtitle={t('tb.intro')} meta={<>{t('tb.fy', { fy: x.fy.code })} · {x.from} – {x.asOf} · <Link to="/finance/ledger">{t('led.title')}</Link></>} />
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <p className={x.balanced ? 'mdm-banner' : 'field-error'} role="status" data-testid="gl-tb-state" data-balanced={x.balanced ? 'yes' : 'no'}>{x.balanced ? t('tb.balanced') : t('tb.unbalanced', { dr: money(x.totals.closingDebit), cr: money(x.totals.closingCredit) })}</p>
      {x.byNature.length > 0 && <div className="mdm-panel" data-testid="gl-tb-chart"><Chart type="bar" data={chart} title={t('tb.byNature')} exportName={`trial-balance-${x.asOf}`} tableSwitch /></div>}
      <details className="gl-params" open={!narrow} data-testid="gl-tb-params"><summary className="btn" style={big}>{t('common.filters')} · {t('tb.asOf')} {x.asOf}</summary>
      <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); setShown(f); globalThis.history?.replaceState(null, '', toUrl('/finance/trial-balance', f)); }}>
        <div className="form-grid">
          <Field label={t('tb.asOf')} name="asOf" error={null}><input type="date" value={f.asOf ?? ''} onChange={(e) => setF({ ...f, asOf: e.target.value })} style={big} data-testid="gl-tb-asof" /></Field>
          <Field label={t('tb.from')} name="from" error={null}><input type="date" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value })} style={big} data-testid="gl-tb-from" /></Field>
        </div>
        <DimFilters f={f} setF={setF} opt={opt.data} />
        <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} data-testid="gl-tb-show">{t('common.apply')}</button>
          <button type="button" className="btn" onClick={() => gl.file(`/trial-balance/export?${gl.q(shown)}`, `trial-balance-${x.asOf}.csv`).catch(() => globalThis.alert?.(t('act.exportFailed')))} data-testid="gl-tb-export">{t('led.export')}</button>
          {canCarry && <button type="button" className="btn" disabled={busy} onClick={() => { if (globalThis.confirm(t('tb.carryConfirm', { fy: x.fy.code }))) run(async () => { const ob = await gl.carryForward(x.fy.id); navigateTo(`/finance/journals?id=${ob.id}`); return ob; }, t('tb.carryDone')); }} data-testid="gl-tb-carry">{t('tb.carry')}</button>}</div>
      </form>
      </details>

      {x.rows.length === 0 ? <EmptyState title={t('tb.title')} message={t('tb.empty')} /> : (
        <div className="table-scroll" data-testid="gl-tb-rows"><table className="data-table"><caption>{t('tb.title')} · {x.asOf}</caption>
          <thead><tr><th scope="col">{t('tb.code')}</th><th scope="col">{t('tb.name')}</th><th scope="col" className="num">{t('tb.openDr')}</th><th scope="col" className="num">{t('tb.openCr')}</th><th scope="col" className="num">{t('jn.debit')}</th><th scope="col" className="num">{t('jn.credit')}</th><th scope="col" className="num">{t('tb.closeDr')}</th><th scope="col" className="num">{t('tb.closeCr')}</th></tr></thead>
          <tbody>{x.rows.map((r) => <tr key={r.accountId} data-testid="gl-tb-row"><td>{r.code}</td><td><Link to={toUrl('/finance/ledger', { accountId: r.accountId, from: x.from, to: x.asOf, ...Object.fromEntries(FILTER_DIMS.map(([k]) => [k, shown[k]]).filter(([, v]) => v)) })}>{r.name}</Link></td><td className="num">{r.openingDebit ? money(r.openingDebit) : ''}</td><td className="num">{r.openingCredit ? money(r.openingCredit) : ''}</td><td className="num">{r.debit ? money(r.debit) : ''}</td><td className="num">{r.credit ? money(r.credit) : ''}</td><td className="num">{r.closingDebit ? money(r.closingDebit) : ''}</td><td className="num">{r.closingCredit ? money(r.closingCredit) : ''}</td></tr>)}</tbody>
          <tfoot><tr><th scope="row" colSpan={2}>{t('tb.total')}</th><td className="num">{money(x.totals.openingDebit)}</td><td className="num">{money(x.totals.openingCredit)}</td><td className="num">{money(x.totals.debit)}</td><td className="num">{money(x.totals.credit)}</td><td className="num"><strong data-testid="gl-tb-dr">{money(x.totals.closingDebit)}</strong></td><td className="num"><strong data-testid="gl-tb-cr">{money(x.totals.closingCredit)}</strong></td></tr></tfoot>
        </table></div>
      )}
    </section>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { DIM_KEYS, JN_TONE, gl, money } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';
import { LineEditor, blank } from './JournalEntryPage.jsx';

// Part 23.01 FR-03: recurring journals. A template (lines, how often, the next date, an optional last date) makes a journal on each due date, sent for approval in
// the owner's name by the morning job; it can be paused, resumed or ended. The journals it made are listed under it.
const big = { minHeight: 48, fontSize: '1rem' };
const TONE = { ACTIVE: 'APPROVED', PAUSED: 'RETURNED', ENDED: 'CANCELLED' };
const toBody = (lines) => lines.filter((l) => l.accountId).map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, ['debit', 'credit', 'narration'].includes(k) ? v : Number(v)])));

function TemplateForm({ x }) {
  const t = useT('fin'); const opt = useQuery({ queryKey: ['gl', 'options'], queryFn: gl.options, retry: false }); const { error, busy, run } = useGlRunner();
  const [h, setH] = useState(() => ({ name: x?.name ?? '', voucherType: x?.voucherType ?? 'JV', frequency: x?.frequency ?? 'MONTHLY', nextRunOn: x?.nextRunOn ?? '', endOn: x?.endOn ?? '', narration: x?.narration ?? '' }));
  const [lines, setLines] = useState(() => (x?.lines?.length ? x.lines.map((l) => ({ ...blank(), ...Object.fromEntries(Object.entries(l).filter(([k]) => k !== 'account').map(([k, v]) => [k, v == null ? '' : String(v)])) })) : [blank(), blank()]));
  if (opt.error?.status === 403) return <NoPermission what={t('rc.title')} permission="fin.recurring.manage" />; if (opt.isPending) return <Skeleton label={t('rc.title')} rows={4} />;
  const f = error?.fields ?? {}; const set = (k) => (e) => setH({ ...h, [k]: e.target.value });
  return (
    <form className="mdm-panel" data-testid="gl-rc-form" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => gl.saveRecurring(x?.id, { ...h, endOn: h.endOn || null, lines: toBody(lines), ...(x ? { version: x.version } : {}) }), t('rc.saved')); if (r) navigateTo(`/finance/recurring-journals?id=${r.id}`); }}>
      <GlError error={error} />
      <div className="form-grid">
        <Field label={t('rc.name')} name="name" error={f.name}><input value={h.name} onChange={set('name')} style={big} maxLength={120} data-testid="gl-rc-name" /></Field>
        <Field label={t('jn.type')} name="voucherType" error={f.voucherType}><select value={h.voucherType} onChange={set('voucherType')} style={big}>{opt.data.voucherTypes.filter((v) => v.code !== 'OB').map((v) => <option key={v.code} value={v.code}>{t(`vt.${v.code}`)}</option>)}</select></Field>
        <Field label={t('rc.frequency')} name="frequency" error={f.frequency}><select value={h.frequency} onChange={set('frequency')} style={big} data-testid="gl-rc-frequency">{['MONTHLY', 'QUARTERLY', 'YEARLY'].map((k) => <option key={k} value={k}>{t(`freq.${k}`)}</option>)}</select></Field>
        <Field label={t('rc.next')} name="nextRunOn" error={f.nextRunOn}><input type="date" value={h.nextRunOn} onChange={set('nextRunOn')} style={big} data-testid="gl-rc-next" /></Field>
        <Field label={t('rc.end')} name="endOn" error={f.endOn}><input type="date" value={h.endOn} onChange={set('endOn')} style={big} /></Field>
        <Field label={t('jn.narration')} name="narration" error={f.narration}><input value={h.narration} onChange={set('narration')} style={big} maxLength={500} data-testid="gl-rc-narration" /></Field>
      </div>
      {lines.map((l, i) => <LineEditor key={i} i={i} line={l} set={(nl) => setLines(lines.map((y, k) => (k === i ? nl : y)))} remove={() => setLines(lines.filter((_, k) => k !== i))} opt={opt.data} errors={f} canRemove={lines.length > 2} opening={false} />)}
      {f.lines && <p className="field-error" role="alert">{f.lines}</p>}
      <div className="actions-row"><button type="button" className="btn" style={big} onClick={() => setLines([...lines, blank()])}>{t('jn.addLine')}</button><button type="submit" className="btn btn-primary" style={big} disabled={busy} data-testid="gl-rc-save">{t('rc.save')}</button></div>
    </form>
  );
}

function Template({ id }) {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'recurring', id], queryFn: () => gl.recurring(id), retry: false }); const { error, note, busy, run } = useGlRunner(); const [editing, setEditing] = useState(false);
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('rc.title')} permission="fin.journal.view" />;
  if (q.isPending) return <Skeleton label={t('rc.title')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const status = (s) => { const r = globalThis.prompt(t('act.why')); if (r) run(() => gl.recurringStatus(x.id, { status: s, reason: r })); };
  return (
    <div data-testid="gl-rc" data-status={x.status}>
      <PageHeader id="rc-h" title={<>{x.docNo} · {x.name} <StatusBadge status={TONE[x.status]} label={t(`rcs.${x.status}`)} /></>} subtitle={x.narration} meta={<Link to="/finance/recurring-journals">{t('rc.title')}</Link>} />
      <KpiRow label={t('rc.title')}><KpiTile label={t('jn.total')} value={money(x.total)} amount={x.total} kind="money" /><KpiTile label={t('rc.next')} value={x.nextRunOn} valueTestid="gl-rc-next-value" /><KpiTile label={t('rc.runs')} value={String(x.runs)} /></KpiRow>
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      {x.can.edit && <div className="actions-row no-print">
        <button type="button" className="btn" onClick={() => setEditing(!editing)} data-testid="gl-rc-edit">{t('jn.edit')}</button>
        {x.status === 'ACTIVE' && <button type="button" className="btn" disabled={busy} onClick={() => status('PAUSED')} data-testid="gl-rc-pause">{t('rc.pause')}</button>}
        {x.status === 'PAUSED' && <button type="button" className="btn" disabled={busy} onClick={() => status('ACTIVE')} data-testid="gl-rc-resume">{t('rc.resume')}</button>}
        <button type="button" className="btn" disabled={busy} onClick={() => status('ENDED')} data-testid="gl-rc-end">{t('rc.end2')}</button></div>}
      {editing ? <TemplateForm x={x} /> : (
        <div className="table-scroll"><table className="data-table"><caption>{t('jn.lines')}</caption><thead><tr><th scope="col">{t('jn.account')}</th><th scope="col">{t('jn.dims')}</th><th scope="col" className="num">{t('jn.debit')}</th><th scope="col" className="num">{t('jn.credit')}</th></tr></thead>
          <tbody>{x.lines.map((l, i) => <tr key={i}><td>{l.account ?? l.accountId}</td><td>{DIM_KEYS.filter((k) => l[k]).map((k) => `${t(`dim.${k}`)} ${l[k]}`).join(' · ')}</td><td className="num">{l.debit ? money(l.debit) : ''}</td><td className="num">{l.credit ? money(l.credit) : ''}</td></tr>)}</tbody></table></div>
      )}
      <div className="table-scroll" data-testid="gl-rc-journals"><table className="data-table"><caption>{t('rc.made')}</caption><thead><tr><th scope="col">{t('jn.voucher')}</th><th scope="col">{t('jn.date')}</th><th scope="col" className="num">{t('jn.total')}</th><th scope="col">{t('st.SUBMITTED')}</th></tr></thead>
        <tbody>{x.journals.map((j) => <tr key={j.id}><td><Link to={`/finance/journals?id=${j.id}`}>{j.docNo}</Link></td><td>{j.date}</td><td className="num">{money(j.total)}</td><td><StatusBadge status={JN_TONE[j.status]} label={t(`st.${j.status}`)} /></td></tr>)}</tbody></table></div>
    </div>
  );
}

export default function RecurringJournalsPage() {
  const t = useT('fin'); usePageTitle(t('rc.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="rc-h"><Template id={id} /></section>;
  if (sp.get('new')) return <section aria-labelledby="rcn-h"><PageHeader id="rcn-h" title={t('rc.new')} meta={<Link to="/finance/recurring-journals">{t('rc.title')}</Link>} /><TemplateForm x={null} /></section>;
  return (
    <section aria-labelledby="rcs-h" data-testid="gl-recurring">
      <PageHeader id="rcs-h" title={t('rc.title')} subtitle={t('rc.intro')} />
      <ListReport listCode="fin.recurring_journals" endpoint="/fin/recurring-journals" title={t('rc.title')} session={session.data} rowHref={(r) => `/finance/recurring-journals?id=${r.id}`} onOpen={(r) => navigateTo(`/finance/recurring-journals?id=${r.id}`)}
        cardFields={['docNo', 'name', 'frequency', 'nextRunOn', 'total', 'status']} statusKey="status"
        newAction={{ label: t('rc.new'), permission: 'fin.recurring.manage', onClick: () => navigateTo('/finance/recurring-journals?new=1') }}
        empty={{ title: t('rc.emptyTitle'), text: t('rc.emptyBody') }} />
    </section>
  );
}

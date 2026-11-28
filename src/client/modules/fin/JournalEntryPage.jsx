import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../site/parts.jsx';
import { DIM_KEYS, DIM_LIST, DIM_RULE, gl, money } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';

// Part 23.01, page "Manual Journal": the header (type, date, kind, narration), the lines in debit or credit with the dimensions each account asks for (its 06.05 rules:
// needed, open or not allowed), the totals live at the bottom and the server's own check of the lines as they are typed; Save draft or Save and send for approval.
const big = { minHeight: 'var(--erp-target-large)', fontSize: '1rem' };
export const blank = () => ({ accountId: '', debit: '', credit: '', narration: '', ...Object.fromEntries(DIM_KEYS.map((k) => [k, ''])) });
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const toPaise = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? 0 : Math.round(Number(v) * 100));

export function LineEditor({ i, line, set, remove, opt, errors, canRemove, opening }) {
  const t = useT('fin');
  const a = opt.accounts.find((x) => String(x.id) === String(line.accountId)); const rules = a?.rules ?? {};
  const shown = DIM_KEYS.filter((k) => (DIM_RULE[k] ? rules[DIM_RULE[k]] && rules[DIM_RULE[k]] !== 'NOT_ALLOWED' : true));
  const err = (k) => errors[`lines.${i}.${k}`];
  const choices = (k) => { const list = opt[DIM_LIST[k]] ?? []; if (k === 'siteId' && line.projectId) return list.filter((s) => String(s.projectId) === String(line.projectId)); if (k === 'wbsId' && line.projectId) return list.filter((s) => String(s.projectId) === String(line.projectId)); return list; };
  const up = (k) => (e) => set({ ...line, [k]: e.target.value, ...(k === 'debit' && e.target.value ? { credit: '' } : {}), ...(k === 'credit' && e.target.value ? { debit: '' } : {}) });
  return (
    <fieldset className="mdm-panel gl-line" data-testid={`gl-entry-line-${i + 1}`}>
      <legend>{t('jn.line', { n: i + 1 })}</legend>
      <div className="form-grid">
        <Field label={t('jn.account')} name={`lines.${i}.accountId`} error={err('accountId')}>
          <select value={line.accountId} onChange={up('accountId')} style={big} data-testid={`gl-account-${i + 1}`}><option value="">{t('jn.pickAccount')}</option>
            {opt.accounts.map((x) => <option key={x.id} value={x.id} disabled={!x.manual && !opening}>{x.code} {x.name}{x.control ? ` — ${t('jn.control')}` : !x.manual ? ` — ${t('jn.noManual')}` : ''}</option>)}</select></Field>
        <Field label={t('jn.debit')} name={`lines.${i}.debit`} error={err('debit')}><input inputMode="decimal" value={line.debit} onChange={up('debit')} style={big} data-testid={`gl-debit-${i + 1}`} /></Field>
        <Field label={t('jn.credit')} name={`lines.${i}.credit`} error={err('credit')}><input inputMode="decimal" value={line.credit} onChange={up('credit')} style={big} data-testid={`gl-credit-${i + 1}`} /></Field>
        {shown.map((k) => (
          <Field key={k} label={`${t(`dim.${k}`)}${DIM_RULE[k] && rules[DIM_RULE[k]] === 'MANDATORY' ? ` (${t('jn.mandatory')})` : ''}`} name={`lines.${i}.${k}`} error={err(k)}>
            <select value={line[k]} onChange={up(k)} style={big} data-testid={`gl-${k}-${i + 1}`}><option value="">{t('common.none')}</option>{choices(k).map((o) => <option key={o.id} value={o.id}>{o.code ? `${o.code} ` : ''}{o.name ?? ''}</option>)}</select></Field>
        ))}
        <Field label={t('jn.lineNarration')} name={`lines.${i}.narration`} error={err('narration')}><input value={line.narration} onChange={up('narration')} style={big} maxLength={300} /></Field>
      </div>
      {canRemove && <div className="actions-row"><button type="button" className="btn" onClick={remove} aria-label={t('jn.removeLine', { n: i + 1 })} data-testid={`gl-remove-${i + 1}`}>{t('jn.removeLine', { n: i + 1 })}</button></div>}
    </fieldset>
  );
}

export default function JournalEntryPage() {
  const t = useT('fin'); usePageTitle(t('jn.entry')); const sp = useSearch(); const id = Number(sp.get('id')) || null;
  const opt = useQuery({ queryKey: ['gl', 'options'], queryFn: gl.options, retry: false });
  const existing = useQuery({ queryKey: ['gl', 'journal', id], queryFn: () => gl.journal(id), enabled: Boolean(id), retry: false });
  const [h, setH] = useState(null); const [lines, setLines] = useState([blank(), blank()]);
  const { error, busy, run } = useGlRunner();
  useEffect(() => {
    if (h) return;
    if (id && existing.data) { const x = existing.data; setH({ voucherType: x.voucherType, voucherDate: x.voucherDate, kind: x.kind, narration: x.narration, autoReverseOn: x.autoReverseOn ?? '', version: x.version }); setLines(x.lines.map((l) => ({ ...blank(), accountId: String(l.accountId), debit: l.debit ? String(l.debit) : '', credit: l.credit ? String(l.credit) : '', narration: l.narration ?? '', ...Object.fromEntries(DIM_KEYS.map((k) => [k, l[k] == null ? '' : String(l[k])])) }))); }
    else if (!id && opt.data) setH({ voucherType: 'JV', voucherDate: opt.data.today ?? today(), kind: 'MANUAL', narration: '', autoReverseOn: '' });
  }, [id, existing.data, opt.data, h]);
  const dr = lines.reduce((a, l) => a + toPaise(l.debit), 0); const cr = lines.reduce((a, l) => a + toPaise(l.credit), 0);
  const body = useMemo(() => ({ kind: h?.kind ?? 'MANUAL', lines: lines.filter((l) => l.accountId).map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== '').map(([k, v]) => [k, ['debit', 'credit', 'narration'].includes(k) ? v : Number(v)]))) }), [lines, h?.kind]);
  const live = useQuery({ queryKey: ['gl', 'check', JSON.stringify(body)], queryFn: () => gl.check(body), enabled: body.lines.length >= 2, retry: false, placeholderData: (p) => p });
  if (opt.error?.status === 403 || existing.error?.status === 403) return <NoPermission what={t('jn.entry')} permission="fin.journal.create" />;
  if (opt.isPending || (id && existing.isPending) || !h) return <Skeleton label={t('jn.entry')} rows={6} />;
  if (opt.isError) return <ErrorState error={opt.error} onRetry={opt.refetch} />;
  if (id && existing.data && !existing.data.can.edit) return <NoPermission what={t('jn.entry')} permission="fin.journal.edit" />;
  const o = opt.data; const fields = { ...Object.fromEntries((live.data?.problems ?? []).map((p) => [p.field, p.message])), ...(error?.fields ?? {}) };
  const save = async (submit) => {
    const payload = { voucherType: h.voucherType, voucherDate: h.voucherDate, narration: h.narration, ...(h.kind === 'ACCRUAL' ? { autoReverseOn: h.autoReverseOn } : {}), lines: body.lines };
    const x = await run(async () => { const saved = id ? await gl.update(id, { ...payload, version: h.version }) : await gl.create({ ...payload, kind: h.kind }); if (submit) await gl.act(saved.id, 'submit'); return saved; }, submit ? t('jn.submitted') : t('jn.saved'));
    if (x) navigateTo(`/finance/journals?id=${x.id}`);
  };
  const setLine = (i) => (l) => setLines(lines.map((x, k) => (k === i ? l : x)));
  return (
    <section aria-labelledby="je-h" data-testid="gl-entry">
      <PageHeader id="je-h" title={id ? `${t('jn.entry')} · ${existing.data?.docNo ?? ''}` : t('jn.entry')} subtitle={t('jn.entryIntro')} meta={<Link to="/finance/journals">{t('jn.title')}</Link>} />
      <GlError error={error} />
      <form onSubmit={(e) => { e.preventDefault(); save(false); }} noValidate>
        <div className="mdm-panel form-grid">
          <Field label={t('jn.kind')} name="kind" error={fields.kind}><select value={h.kind} onChange={(e) => setH({ ...h, kind: e.target.value, voucherType: e.target.value === 'OPENING' ? 'OB' : (h.voucherType === 'OB' ? 'JV' : h.voucherType) })} style={big} disabled={Boolean(id)} data-testid="gl-kind">{o.kinds.map((k) => <option key={k.code} value={k.code}>{t(`kind.${k.code}`)}</option>)}</select></Field>
          <Field label={t('jn.type')} name="voucherType" error={fields.voucherType}><select value={h.voucherType} onChange={(e) => setH({ ...h, voucherType: e.target.value })} style={big} disabled={h.kind === 'OPENING'} data-testid="gl-type">{o.voucherTypes.filter((v) => (h.kind === 'OPENING' ? v.code === 'OB' : v.code !== 'OB')).map((v) => <option key={v.code} value={v.code}>{t(`vt.${v.code}`)}</option>)}</select></Field>
          <Field label={t('jn.date')} name="voucherDate" error={fields.voucherDate}><input type="date" value={h.voucherDate} onChange={(e) => setH({ ...h, voucherDate: e.target.value })} style={big} data-testid="gl-date" /></Field>
          {h.kind === 'ACCRUAL' && <Field label={t('jn.autoReverse')} name="autoReverseOn" error={fields.autoReverseOn}><input type="date" value={h.autoReverseOn} onChange={(e) => setH({ ...h, autoReverseOn: e.target.value })} style={big} data-testid="gl-auto-reverse" /></Field>}
          <Field label={t('jn.narration')} name="narration" error={fields.narration}><input value={h.narration} onChange={(e) => setH({ ...h, narration: e.target.value })} style={big} maxLength={500} data-testid="gl-narration" /></Field>
        </div>
        <p className="muted">{t('jn.cfoNote', { limit: new Intl.NumberFormat('en-IN').format(o.cfoLimit) })}</p>
        {lines.map((l, i) => <LineEditor key={i} i={i} line={l} set={setLine(i)} remove={() => setLines(lines.filter((_, k) => k !== i))} opt={o} errors={fields} canRemove={lines.length > 2} opening={h.kind === 'OPENING'} />)}
        <div className="actions-row"><button type="button" className="btn" style={big} onClick={() => setLines([...lines, blank()])} data-testid="gl-add-line">{t('jn.addLine')}</button></div>
        {fields.lines && <p className="field-error" role="alert" data-testid="gl-lines-error">{fields.lines}</p>}
        <div className="ff-actionbar" data-testid="gl-totals">
          <span>{t('jn.debit')} <strong data-testid="gl-total-debit">{money(dr / 100)}</strong></span>
          <span>{t('jn.credit')} <strong data-testid="gl-total-credit">{money(cr / 100)}</strong></span>
          <span data-testid="gl-balance-state" data-balanced={dr === cr && dr > 0 ? 'yes' : 'no'}>{dr === cr && dr > 0 ? t('jn.balanced') : `${t('jn.notBalanced')} · ${t('jn.difference')} ${money(Math.abs(dr - cr) / 100)}`}</span>
          <button type="submit" className="btn" style={big} disabled={busy} data-testid="gl-save">{t('jn.saveDraft')}</button>
          <button type="button" className="btn btn-primary" style={big} disabled={busy || dr !== cr || dr === 0} onClick={() => save(true)} data-testid="gl-save-submit">{t('jn.saveSubmit')}</button>
        </div>
      </form>
    </section>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { qa } from './api.js';
import { sel, useRunner } from './QaParts.jsx';

// Test Catalogue (part 18.03, FR-02): the tests with their standard, parameters and limits, the frequency rule and the laboratory. A change of limits never alters a result already entered: each result keeps the limits it was judged by.
const p0 = () => ({ code: '', name: '', unit: '', min: '', max: '' }); const num = (v) => (v === '' || v == null ? null : Number(v));
function Editor({ id }) {
  const t = useT('qa'); usePageTitle(t('cat.title')); const { error, run, busy } = useRunner(); const rq = useQuery({ queryKey: ['qa', 'catalogue', id], queryFn: () => qa.one('/test-catalogue', id), enabled: Boolean(id), retry: false }); const [f, setF] = useState(null); const x = rq.data;
  if (id && x && !f) setF({ code: x.code, name: x.name, standard: x.standard ?? '', parameters: x.parameters.map((p) => ({ ...p, unit: p.unit ?? '', min: p.min ?? '', max: p.max ?? '' })), freqBasis: x.freqBasis, freqQty: String(x.freqQty ?? ''), freqUom: x.freqUom ?? '', labType: x.labType, status: x.status, rowVersion: x.version });
  const form = f ?? (id ? null : { code: '', name: '', standard: '', parameters: [p0()], freqBasis: 'NONE', freqQty: '', freqUom: '', labType: 'SITE', status: 'ACTIVE' });
  if (id && rq.error?.status === 403) return <NoPermission what={t('cat.title')} permission="qa.test_catalogue.edit" />; if (!form) return <Skeleton label={t('cat.title')} rows={4} />;
  const set = (k, v) => setF({ ...form, [k]: v }); const setP = (i, k, v) => set('parameters', form.parameters.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const body = () => ({ name: form.name, standard: form.standard || null, parameters: form.parameters.map((p) => ({ code: p.code, name: p.name, unit: p.unit || null, min: num(p.min), max: num(p.max) })), freqBasis: form.freqBasis, freqQty: num(form.freqQty) ?? 0, freqUom: form.freqUom || null, labType: form.labType });
  const save = async () => { const d = await run(() => (id ? qa.edit('/test-catalogue', id, { ...body(), status: form.status, rowVersion: form.rowVersion }) : qa.make('/test-catalogue', { code: form.code, ...body() })), t('saved')); if (d) navigateTo('/qa/test-catalogue'); };
  return (
    <section aria-labelledby="cat-h" data-testid="qa-catalogue-editor"><h1 id="cat-h">{id ? t('cat.edit') : t('cat.new')}</h1><p className="muted"><Link to="/qa/test-catalogue">{t('cat.title')}</Link> · {t('cat.limitsHint')}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="cat-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <div className="mdm-panel"><div className="form-grid">
        <Field label={t('code')} name="code" error={error}><input value={form.code} disabled={Boolean(id)} onChange={(e) => set('code', e.target.value)} maxLength={40} style={sel} data-testid="cat-code" /></Field>
        <Field label={t('name')} name="name" error={error}><input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={200} style={sel} data-testid="cat-name" /></Field>
        <Field label={t('itp.standard')} name="standard" error={error}><input value={form.standard} onChange={(e) => set('standard', e.target.value)} maxLength={120} style={sel} data-testid="cat-standard" /></Field>
        <Field label={t('cat.lab')} name="labType" error={error}><select value={form.labType} onChange={(e) => set('labType', e.target.value)} style={sel}><option value="SITE">{t('lab.SITE')}</option><option value="THIRD_PARTY">{t('lab.THIRD_PARTY')}</option></select></Field>
        <Field label={t('cat.basis')} name="freqBasis" error={error}><select value={form.freqBasis} onChange={(e) => set('freqBasis', e.target.value)} style={sel} data-testid="cat-basis"><option value="NONE">{t('basis.NONE')}</option><option value="QTY">{t('basis.QTY')}</option><option value="LOT">{t('basis.LOT')}</option></select></Field>
        {form.freqBasis === 'QTY' && <><Field label={t('cat.freqQty')} name="freqQty" error={error}><input type="number" min="0" step="any" value={form.freqQty} onChange={(e) => set('freqQty', e.target.value)} style={sel} data-testid="cat-freq-qty" /></Field><Field label={t('cat.freqUom')} name="freqUom" error={error}><input value={form.freqUom} onChange={(e) => set('freqUom', e.target.value)} maxLength={20} style={sel} data-testid="cat-freq-uom" /></Field></>}
        {id && <Field label={t('cat.status')} name="status" error={error}><select value={form.status} onChange={(e) => set('status', e.target.value)} style={sel}><option value="ACTIVE">{t('cat.active')}</option><option value="INACTIVE">{t('cat.inactive')}</option></select></Field>}</div></div>
      <div className="table-scroll"><table className="data-table" data-testid="cat-params"><caption>{t('cat.params')}</caption><thead><tr><th>{t('code')}</th><th>{t('name')}</th><th>{t('tpl.unit')}</th><th>{t('cat.min')}</th><th>{t('cat.max')}</th><th /></tr></thead>
        <tbody>{form.parameters.map((p, i) => <tr key={i} data-testid="cat-param"><td><input aria-label={t('code')} value={p.code} onChange={(e) => setP(i, 'code', e.target.value)} maxLength={30} style={{ ...sel, width: 90 }} data-testid="p-code" /></td><td><input aria-label={t('name')} value={p.name} onChange={(e) => setP(i, 'name', e.target.value)} maxLength={120} style={sel} data-testid="p-name" /></td><td><input aria-label={t('tpl.unit')} value={p.unit} onChange={(e) => setP(i, 'unit', e.target.value)} maxLength={20} style={{ ...sel, width: 70 }} /></td>
          <td><input aria-label={t('cat.min')} type="number" step="any" value={p.min} onChange={(e) => setP(i, 'min', e.target.value)} style={{ ...sel, width: 90 }} data-testid="p-min" /></td><td><input aria-label={t('cat.max')} type="number" step="any" value={p.max} onChange={(e) => setP(i, 'max', e.target.value)} style={{ ...sel, width: 90 }} data-testid="p-max" /></td><td><button type="button" className="btn" disabled={form.parameters.length < 2} onClick={() => set('parameters', form.parameters.filter((_, j) => j !== i))}>{t('remove')}</button></td></tr>)}</tbody></table></div>
      <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => set('parameters', [...form.parameters, p0()])} data-testid="cat-add-param">{t('cat.addParam')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={save} data-testid="cat-save">{t('save')}</button></div>
    </section>
  );
}
export default function TestCataloguePage() {
  const t = useT('qa'); usePageTitle(t('cat.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (sp.get('new')) return <Editor id={null} />; if (id) return <Editor id={id} />;
  return (
    <section aria-labelledby="catl-h" data-testid="qa-catalogue"><h1 id="catl-h">{t('cat.title')}</h1><p className="muted">{t('cat.intro')}</p>
      <div className="actions-row no-print"><Link to="/qa/test-catalogue?new=1">{t('cat.new')}</Link></div>
      <ListReport listCode="qa.test_catalogue" endpoint="/qa/test-catalogue" title={t('cat.title')} session={session.data} rowHref={(r) => `/qa/test-catalogue?id=${r.id}`} onOpen={(r) => navigateTo(`/qa/test-catalogue?id=${r.id}`)} cardFields={['code', 'name', 'standard', 'status']} statusKey="status" empty={{ title: t('cat.emptyTitle'), text: t('cat.emptyBody') }} />
    </section>
  );
}

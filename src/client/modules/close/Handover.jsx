import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authHeaders } from '../../platform/api/index.js';
import { Card } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { useT } from '../../platform/i18n/index.js';
import { downloadReport } from '../bi/api.js';
import { Field, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { TONE, post, qs, read } from './common.js';

// Part 26.02: the handovers (list and new), a handover (checklist with evidence, readiness and certificate, client assets, dossier index) and
// the client asset register. The API checks every rule again.
const transport = browserTransport(authHeaders);
const HO_TONE = { ...TONE, DRAFT: 'DRAFT', DONE: 'APPROVED', NOT_APPLICABLE: 'CANCELLED' };
const Badge = ({ t, status }) => <StatusBadge status={HO_TONE[status] ?? 'DRAFT'} label={t(`ho.st.${status}`)} size="sm" />;
const open = (to) => (e) => { e.preventDefault(); navigateTo(to); };

function Guard({ q, title, children }) {
  if (q.error?.status === 403) return <NoPermission what={title} permission="ho.view" />;
  if (q.isPending) return <section><PageHeader title={title} /><Skeleton label={title} rows={6} /></section>;
  if (q.error) return <section><PageHeader title={title} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  return children(q.data);
}

export function Handovers() {
  const t = useT('close'); usePageTitle(t('ho.title'));
  const q = useQuery({ queryKey: ['close', 'ho', 'list'], queryFn: () => read('/handovers'), retry: false });
  const opts = useQuery({ queryKey: ['close', 'ho', 'options'], queryFn: () => read('/handovers/options'), retry: false });
  const [adding, setAdding] = useState(false);
  return <Guard q={q} title={t('ho.title')}>{(rows) => <section aria-labelledby="ho-h" data-testid="close-handovers">
    <PageHeader id="ho-h" title={t('ho.title')} subtitle={t('ho.subtitle')} actions={<button type="button" className="btn btn-primary" onClick={() => setAdding(!adding)} data-testid="ho-add">{t('ho.add')}</button>} />
    {adding && <NewHandover t={t} projects={opts.data?.projects ?? []} />}
    <KpiRow testid="ho-tiles" label={t('ho.title')}>
      {['DRAFT', 'SUBMITTED', 'APPROVED', 'ISSUED'].map((s) => <KpiTile key={s} testid={`ho-k-${s}`} label={t(`ho.st.${s}`)} kind="count" value={String(rows.filter((h) => h.status === s).length)}>{t('ho.kHandovers')}</KpiTile>)}
    </KpiRow>
    <Card title={t('ho.title')} testid="ho-list">
      {!rows.length ? <EmptyState compact title={t('ho.none')} message={t('ho.noneBody')} /> : <div className="table-scroll"><table className="data-table" data-testid="ho-table">
        <thead><tr><th scope="col">{t('f.docNo')}</th><th scope="col">{t('ho.f.title')}</th><th scope="col">{t('f.project')}</th><th scope="col">{t('ho.f.scope')}</th><th scope="col">{t('f.status')}</th><th scope="col">{t('ho.f.checklist')}</th><th scope="col">{t('ho.f.effective')}</th><th scope="col">{t('ho.f.dlpEnds')}</th></tr></thead>
        <tbody>{rows.map((h) => <tr key={h.id} data-testid="ho-row" data-status={h.status}>
          <td><a href={`/close/handover?id=${h.id}`} onClick={open(`/close/handover?id=${h.id}`)}>{h.docNo}</a></td><td>{h.title}</td><td>{h.project}</td><td>{h.scopeType === 'AREA' ? h.areaLabel ?? t('ho.area') : t('ho.whole')}</td>
          <td><Badge t={t} status={h.status} /></td><td>{`${h.items.done} / ${h.items.total}`}</td><td>{h.effectiveOn ?? ''}</td><td>{h.dlpEndsOn ?? ''}</td>
        </tr>)}</tbody>
      </table></div>}
    </Card>
  </section>}</Guard>;
}

function NewHandover({ t, projects }) {
  const [v, setV] = useState({ projectId: '', title: '', scopeType: 'PROJECT', areaLabel: '', dlpMonths: '12' });
  const m = useMutation({ mutationFn: () => post('/handovers', { projectId: Number(v.projectId), title: v.title, scopeType: v.scopeType, dlpMonths: Number(v.dlpMonths), ...(v.scopeType === 'AREA' ? { areaLabel: v.areaLabel } : {}) }), onSuccess: (h) => navigateTo(`/close/handover?id=${h.id}`) });
  return <Card title={t('ho.add')} testid="ho-new">
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field name="nh-project" label={t('f.project')}><select id="nh-project" required value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value })} data-testid="nh-project"><option value="">{t('f.choose')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
      <Field name="nh-title" label={t('ho.f.title')}><input id="nh-title" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} data-testid="nh-title" /></Field>
      <Field name="nh-scope" label={t('ho.f.scope')}><select id="nh-scope" value={v.scopeType} onChange={(e) => setV({ ...v, scopeType: e.target.value })} data-testid="nh-scope"><option value="PROJECT">{t('ho.whole')}</option><option value="AREA">{t('ho.area')}</option></select></Field>
      {v.scopeType === 'AREA' && <Field name="nh-area" label={t('ho.f.areaLabel')}><input id="nh-area" required value={v.areaLabel} onChange={(e) => setV({ ...v, areaLabel: e.target.value })} data-testid="nh-area" /></Field>}
      <Field name="nh-dlp" label={t('ho.f.dlpMonths')}><input id="nh-dlp" type="number" min="0" max="120" required value={v.dlpMonths} onChange={(e) => setV({ ...v, dlpMonths: e.target.value })} data-testid="nh-dlp" /></Field>
      {m.error && <ErrorState error={m.error} />}
      <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={m.isPending} data-testid="nh-save">{t('save')}</button></div>
    </form>
  </Card>;
}

export function Handover() {
  const t = useT('close'); const id = useSearch().get('id'); const cache = useQueryClient();
  const q = useQuery({ queryKey: ['close', 'ho', 'one', id], queryFn: () => read(`/handovers/${id}`), retry: false, enabled: Boolean(id) });
  usePageTitle(q.data ? `${q.data.docNo} ${q.data.title}` : t('ho.one'));
  const refresh = () => cache.invalidateQueries({ queryKey: ['close', 'ho'] });
  if (!id) return <section><PageHeader title={t('ho.one')} /><EmptyState title={t('ho.pick')} message={t('ho.pickBody')} /></section>;
  return <Guard q={q} title={t('ho.one')}>{(h) => <section aria-labelledby="hd-h" data-testid="close-handover" data-status={h.status}>
    <PageHeader id="hd-h" title={`${h.docNo} ${h.title}`} subtitle={`${h.project} · ${h.scopeType === 'AREA' ? h.areaLabel ?? t('ho.area') : t('ho.whole')} · ${t('ho.dlp', { n: h.dlpMonths })}`} status={<Badge t={t} status={h.status} />}
      menu={h.can.export ? [{ label: t('ho.dossierCsv'), testid: 'hd-dossier-csv', onClick: () => downloadReport(`/api/v1/close/handovers/${h.id}/dossier/export`, `dossier-${h.docNo}.csv`) }] : []} />
    <Certificate t={t} h={h} refresh={refresh} />
    <Checklist t={t} h={h} refresh={refresh} />
    <Assets t={t} h={h} refresh={refresh} />
  </section>}</Guard>;
}

function Certificate({ t, h, refresh }) {
  const [v, setV] = useState({ signatory: '', signedOn: '', file: null });
  const req = useMutation({ mutationFn: () => post(`/handovers/${h.id}/request`), onSuccess: refresh });
  const sign = useMutation({ mutationFn: async () => { const stored = await uploadFile(v.file, { transport, entity: 'ho_handovers', entityId: h.id }); return post(`/handovers/${h.id}/client-sign`, { signatory: v.signatory, signedOn: v.signedOn, fileId: stored.id }); }, onSuccess: refresh });
  const r = h.readiness;
  return <Card title={t('ho.certificate')} subtitle={t('ho.certificateBody')} testid="hd-certificate">
    {(req.error || sign.error) && <ErrorState error={req.error ?? sign.error} />}
    <p data-testid="hd-ready" data-ready={r.ready ? 'yes' : 'no'}><StatusBadge status={r.ready ? 'APPROVED' : 'REJECTED'} label={r.ready ? t('sys.ready') : t('sys.notReady')} size="sm" /></p>
    {!r.ready && <ul className="small">{r.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
    {h.status === 'ISSUED' && <p className="small">{t('ho.issued', { who: h.clientSignatory, on: h.clientSignedOn, ends: h.dlpEndsOn })}</p>}
    {['DRAFT', 'REJECTED'].includes(h.status) && h.can.request && r.ready && <button type="button" className="btn btn-primary" disabled={req.isPending} onClick={() => req.mutate()} data-testid="hd-request">{t('ho.request')}</button>}
    {h.status === 'APPROVED' && h.can.sign && <form className="form-grid" onSubmit={(e) => { e.preventDefault(); sign.mutate(); }} data-testid="hd-sign-form">
      <Field name="hd-signatory" label={t('f.signatory')}><input id="hd-signatory" required value={v.signatory} onChange={(e) => setV({ ...v, signatory: e.target.value })} data-testid="hd-signatory" /></Field>
      <Field name="hd-date" label={t('f.signedOn')}><input id="hd-date" type="date" required value={v.signedOn} onChange={(e) => setV({ ...v, signedOn: e.target.value })} data-testid="hd-date" /></Field>
      <Field name="hd-file" label={t('f.signedCopy')}><input id="hd-file" type="file" required accept=".pdf,image/*" onChange={(e) => setV({ ...v, file: e.target.files?.[0] ?? null })} data-testid="hd-file" /></Field>
      <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={sign.isPending} data-testid="hd-sign">{t('ce.issue')}</button></div>
    </form>}
  </Card>;
}

function Checklist({ t, h, refresh }) {
  const editable = h.can.manage && ['DRAFT', 'REJECTED'].includes(h.status);
  const [edit, setEdit] = useState(null); const [v, setV] = useState({ note: '', file: null, certificateId: '' });
  const opts = useQuery({ queryKey: ['close', 'ho', 'options', h.projectId], queryFn: () => read(`/handovers/options${qs({ projectId: h.projectId })}`), enabled: editable, retry: false });
  const rec = useMutation({
    mutationFn: async ([item, status]) => {
      const body = { status, ...(v.note ? { note: v.note } : {}) };
      if (status === 'DONE' && v.file) body.fileId = (await uploadFile(v.file, { transport, entity: 'ho_checklist_items', entityId: item.id })).id;
      if (status === 'DONE' && v.certificateId) body.certificateId = Number(v.certificateId);
      return post(`/handover-items/${item.id}/record`, body);
    },
    onSuccess: () => { setEdit(null); setV({ note: '', file: null, certificateId: '' }); refresh(); },
  });
  return <Card title={t('ho.checklist')} subtitle={t('ho.checklistBody')} testid="hd-checklist">
    {rec.error && <ErrorState error={rec.error} />}
    <div className="table-scroll"><table className="data-table" data-testid="hd-items">
      <thead><tr><th scope="col">{t('ho.f.section')}</th><th scope="col">{t('ho.f.item')}</th><th scope="col">{t('f.status')}</th><th scope="col">{t('ho.f.evidence')}</th>{editable && <th scope="col">{t('f.record')}</th>}</tr></thead>
      <tbody>{h.checklist.map((i) => <tr key={i.id} data-testid="hd-item" data-category={i.category} data-status={i.status}>
        <td>{t(`ho.cat.${i.category}`)}</td><td>{i.title}{i.mandatory ? ' *' : ''}</td><td><Badge t={t} status={i.status} /></td><td className="small">{i.evidence?.ref ?? i.note ?? ''}</td>
        {editable && <td>{edit === i.id ? <div className="form-grid">
          {i.category === 'COMMISSIONING' ? <Field name={`ce-${i.id}`} label={t('f.certificate')}><select id={`ce-${i.id}`} value={v.certificateId} onChange={(e) => setV({ ...v, certificateId: e.target.value })} data-testid={`hi-cert-${i.id}`}><option value="">{t('f.choose')}</option>{(opts.data?.certificates ?? []).map((c) => <option key={c.id} value={c.id}>{c.kind} {c.docNo} {c.system}</option>)}</select></Field>
            : <Field name={`fi-${i.id}`} label={t('ho.f.evidence')}><input id={`fi-${i.id}`} type="file" onChange={(e) => setV({ ...v, file: e.target.files?.[0] ?? null })} data-testid={`hi-file-${i.id}`} /></Field>}
          <Field name={`no-${i.id}`} label={t('f.note')}><input id={`no-${i.id}`} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} data-testid={`hi-note-${i.id}`} /></Field>
          <div className="actions-row">
            <button type="button" className="btn btn-small btn-primary" disabled={rec.isPending} onClick={() => rec.mutate([i, 'DONE'])} data-testid={`hi-done-${i.id}`}>{t('ho.done')}</button>
            {!i.mandatory && <button type="button" className="btn btn-small" disabled={rec.isPending} onClick={() => rec.mutate([i, 'NOT_APPLICABLE'])} data-testid={`hi-na-${i.id}`}>{t('ho.na')}</button>}
            {i.status !== 'OPEN' && <button type="button" className="btn btn-small" disabled={rec.isPending} onClick={() => rec.mutate([i, 'OPEN'])} data-testid={`hi-open-${i.id}`}>{t('ho.reopen')}</button>}
            <button type="button" className="btn btn-small" onClick={() => setEdit(null)}>{t('cancel')}</button>
          </div>
        </div> : <button type="button" className="btn btn-small" onClick={() => setEdit(i.id)} data-testid={`hi-edit-${i.id}`}>{t('f.record')}</button>}</td>}
      </tr>)}</tbody>
    </table></div>
  </Card>;
}

const ASSET_FIELDS = ['tagNo', 'description', 'location', 'make', 'model', 'serialNo', 'warrantyUntil'];
function Assets({ t, h, refresh }) {
  const editable = h.can.manage && ['DRAFT', 'REJECTED'].includes(h.status);
  const blank = Object.fromEntries(ASSET_FIELDS.map((k) => [k, '']));
  const [v, setV] = useState(blank);
  const add = useMutation({ mutationFn: () => post(`/handovers/${h.id}/assets`, Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''))), onSuccess: () => { setV(blank); refresh(); } });
  return <Card title={t('ca.title')} testid="hd-assets">
    {add.error && <ErrorState error={add.error} />}
    {!h.assets.length ? <EmptyState compact title={t('ca.none')} message={t('ca.noneBody')} /> : <AssetTable t={t} rows={h.assets} />}
    {editable && <form className="form-grid" onSubmit={(e) => { e.preventDefault(); add.mutate(); }} data-testid="hd-asset-form">
      {ASSET_FIELDS.map((k) => <Field key={k} name={`as-${k}`} label={t(`ca.f.${k}`)}><input id={`as-${k}`} type={k === 'warrantyUntil' ? 'date' : 'text'} required={k === 'tagNo' || k === 'description'} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} data-testid={`as-${k}`} /></Field>)}
      <div className="actions-row"><button type="submit" className="btn" disabled={add.isPending} data-testid="as-add">{t('ca.add')}</button></div>
    </form>}
  </Card>;
}

function AssetTable({ t, rows }) {
  return <div className="table-scroll"><table className="data-table" data-testid="ca-table">
    <thead><tr>{['handover', 'tagNo', 'description', 'location', 'make', 'model', 'serialNo', 'warrantyUntil'].map((k) => <th key={k} scope="col">{t(`ca.f.${k}`)}</th>)}</tr></thead>
    <tbody>{rows.map((a) => <tr key={a.id} data-testid="ca-row"><td>{a.handover}</td><td>{a.tagNo}</td><td>{a.description}</td><td>{a.location ?? ''}</td><td>{a.make ?? ''}</td><td>{a.model ?? ''}</td><td>{a.serialNo ?? ''}</td><td>{a.warrantyUntil ?? ''}</td></tr>)}</tbody>
  </table></div>;
}

export function ClientAssets() {
  const t = useT('close'); usePageTitle(t('ca.title'));
  const q = useQuery({ queryKey: ['close', 'ho', 'assets'], queryFn: () => read('/client-assets'), retry: false });
  const exp = useMutation({ mutationFn: () => downloadReport('/api/v1/close/client-assets/export', 'client-assets.csv') });
  return <Guard q={q} title={t('ca.title')}>{(rows) => <section aria-labelledby="ca-h" data-testid="close-client-assets">
    <PageHeader id="ca-h" title={t('ca.title')} subtitle={t('ca.subtitle')} menu={[{ label: t('ca.export'), testid: 'ca-export', onClick: () => exp.mutate() }]} />
    {exp.error && <ErrorState error={exp.error} />}
    {!rows.length ? <EmptyState title={t('ca.none')} message={t('ca.noneBody')} /> : <Card title={t('ca.title')}><AssetTable t={t} rows={rows} /></Card>}
  </section>}</Guard>;
}

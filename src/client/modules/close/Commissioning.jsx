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
import { Field, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { TONE, post, qs, read } from './common.js';

// Part 26.01: testing, pre-commissioning and commissioning. The overview (completion by system and the systems register), a system
// (tags and check sheets, test packs, punch items, readiness and certificates), the test packs and the certificates. Every figure comes
// from the API; the API checks every rule again.
const transport = browserTransport(authHeaders);
const DISCIPLINES = ['GENERAL', 'CIVIL', 'MECHANICAL', 'ELECTRICAL', 'INSTRUMENTATION', 'PIPING', 'HVAC', 'FIRE', 'PLUMBING'];
const PACK_TYPES = ['HYDROTEST', 'PNEUMATIC', 'LOOP_CHECK', 'INSULATION', 'FUNCTION', 'PERFORMANCE', 'OTHER'];
const pct = (s) => (s.total ? `${s.passed} / ${s.total}` : '—');
const Badge = ({ t, status }) => <StatusBadge status={TONE[status] ?? 'DRAFT'} label={t(`st.${status}`)} size="sm" />;

function Guard({ q, t, title, children }) {
  if (q.error?.status === 403) return <NoPermission what={title} permission="tnc.view" />;
  if (q.isPending) return <section><PageHeader title={title} /><Skeleton label={title} rows={6} /></section>;
  if (q.error) return <section><PageHeader title={title} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  return children(q.data, t);
}

export function Commissioning() {
  const t = useT('close'); usePageTitle(t('cm.title'));
  const search = useSearch(); const projectId = search.get('projectId') ?? '';
  const q = useQuery({ queryKey: ['close', 'tnc', 'dashboard', projectId], queryFn: () => read(`/commissioning/dashboard${qs({ projectId })}`), retry: false });
  const opts = useQuery({ queryKey: ['close', 'tnc', 'options'], queryFn: () => read('/commissioning/options'), retry: false });
  const [adding, setAdding] = useState(false);
  return <Guard q={q} t={t} title={t('cm.title')}>{(d) => <section aria-labelledby="cm-h" data-testid="close-commissioning">
    <PageHeader id="cm-h" title={t('cm.title')} subtitle={t('cm.subtitle')} actions={<button type="button" className="btn btn-primary" onClick={() => setAdding(!adding)} data-testid="cm-add">{t('cm.add')}</button>} />
    <div className="actions-row" role="group" aria-label={t('cm.filter')}>
      <Field name="cm-project" label={t('f.project')}><select id="cm-project" value={projectId} onChange={(e) => navigateTo(`/close/commissioning${qs({ projectId: e.target.value })}`)} data-testid="cm-project">
        <option value="">{t('f.allProjects')}</option>{(opts.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
      </select></Field>
    </div>
    {adding && <NewSystem t={t} projects={opts.data?.projects ?? []} onDone={(s) => navigateTo(`/close/commissioning/system?id=${s.id}`)} />}
    <KpiRow testid="cm-tiles" label={t('cm.title')}>
      <KpiTile testid="cm-k-systems" label={t('cm.kSystems')} kind="count" value={String(d.totals.systems)}>{['MC', 'RFC', 'RFSU'].map((s) => `${s} ${d.totals.byStage[s]}`).join(' · ')}</KpiTile>
      {['A', 'B', 'C'].map((c) => <KpiTile key={c} testid={`cm-k-${c}`} label={t(`cm.kClass${c}`)} kind="quality" value={d.totals.sheetsPassedPct[c] == null ? '—' : `${d.totals.sheetsPassedPct[c]} %`} tone={d.totals.sheetsPassedPct[c] === 100 ? 'success' : 'warning'}>{t('cm.kSheets')}</KpiTile>)}
      <KpiTile testid="cm-k-punch" label={t('cm.kPunchA')} kind="count" value={String(d.totals.punchesOpenA)} tone={d.totals.punchesOpenA ? 'error' : 'success'}>{t('cm.kPunchBody')}</KpiTile>
      <KpiTile testid="cm-k-packs" label={t('cm.kPacks')} kind="count" value={`${d.totals.packsPassed} / ${d.totals.packs}`} to="/close/test-packs">{t('cm.kPacksBody')}</KpiTile>
    </KpiRow>
    <Card title={t('cm.systems')} testid="cm-systems">
      {!d.systems.length ? <EmptyState compact title={t('cm.none')} message={t('cm.noneBody')} /> : <div className="table-scroll"><table className="data-table" data-testid="cm-table">
        <thead><tr><th scope="col">{t('f.system')}</th><th scope="col">{t('f.project')}</th><th scope="col">{t('f.discipline')}</th><th scope="col">{t('f.stage')}</th><th scope="col">{t('f.classA')}</th><th scope="col">{t('f.classB')}</th><th scope="col">{t('f.classC')}</th><th scope="col">{t('f.punchesOpen')}</th><th scope="col">{t('f.packs')}</th></tr></thead>
        <tbody>{d.systems.map((s) => <tr key={s.id} data-testid="cm-row" data-code={s.code}>
          <td><a href={`/close/commissioning/system?id=${s.id}`} onClick={(e) => { e.preventDefault(); navigateTo(`/close/commissioning/system?id=${s.id}`); }}>{s.code}</a> <span className="muted small">{s.name}</span></td>
          <td>{s.project}</td><td>{t(`disc.${s.discipline}`)}</td><td><Badge t={t} status={s.stage} /></td>
          <td>{pct(s.progress.sheets.A)}</td><td>{pct(s.progress.sheets.B)}</td><td>{pct(s.progress.sheets.C)}</td><td>{s.progress.punchesOpen}</td><td>{`${s.progress.packs.passed} / ${s.progress.packs.total}`}</td>
        </tr>)}</tbody>
      </table></div>}
    </Card>
  </section>}</Guard>;
}

function NewSystem({ t, projects, onDone }) {
  const [v, setV] = useState({ projectId: '', code: '', name: '', discipline: 'GENERAL' });
  const m = useMutation({ mutationFn: () => post('/commissioning/systems', { ...v, projectId: Number(v.projectId) }), onSuccess: onDone });
  return <Card title={t('cm.add')} testid="cm-new">
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field name="ns-project" label={t('f.project')}><select id="ns-project" required value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value })} data-testid="ns-project"><option value="">{t('f.choose')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
      <Field name="ns-code" label={t('f.code')}><input id="ns-code" required value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} data-testid="ns-code" /></Field>
      <Field name="ns-name" label={t('f.name')}><input id="ns-name" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} data-testid="ns-name" /></Field>
      <Field name="ns-disc" label={t('f.discipline')}><select id="ns-disc" value={v.discipline} onChange={(e) => setV({ ...v, discipline: e.target.value })} data-testid="ns-disc">{DISCIPLINES.map((x) => <option key={x} value={x}>{t(`disc.${x}`)}</option>)}</select></Field>
      {m.error && <ErrorState error={m.error} />}
      <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={m.isPending} data-testid="ns-save">{t('save')}</button></div>
    </form>
  </Card>;
}

export function CommissioningSystem() {
  const t = useT('close'); const search = useSearch(); const id = search.get('id');
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['close', 'tnc', 'system', id], queryFn: () => read(`/commissioning/systems/${id}`), retry: false, enabled: Boolean(id) });
  usePageTitle(q.data ? `${q.data.code} ${q.data.name}` : t('sys.title'));
  const refresh = () => cache.invalidateQueries({ queryKey: ['close', 'tnc'] });
  if (!id) return <section><PageHeader title={t('sys.title')} /><EmptyState title={t('sys.pick')} message={t('sys.pickBody')} /></section>;
  return <Guard q={q} t={t} title={t('sys.title')}>{(s) => <section aria-labelledby="sys-h" data-testid="close-system" data-stage={s.stage}>
    <PageHeader id="sys-h" title={`${s.code} ${s.name}`} subtitle={`${s.project} · ${t(`disc.${s.discipline}`)}`} status={<Badge t={t} status={s.stage} />} />
    <Readiness t={t} s={s} refresh={refresh} />
    <Tags t={t} s={s} refresh={refresh} />
    <Packs t={t} s={s} refresh={refresh} />
    <Punches t={t} s={s} refresh={refresh} />
  </section>}</Guard>;
}

function Readiness({ t, s, refresh }) {
  const req = useMutation({ mutationFn: (kind) => post(`/commissioning/systems/${s.id}/certificates`, { kind }), onSuccess: refresh });
  return <Card title={t('sys.readiness')} subtitle={t('sys.readinessBody')} testid="sys-readiness">
    {req.error && <ErrorState error={req.error} />}
    <ul className="plain-list">{s.readiness.map((r) => { const cert = s.certificates.filter((c) => c.kind === r.kind && c.status !== 'REJECTED' && c.status !== 'CANCELLED').at(-1); return <li key={r.kind} data-testid={`sys-ready-${r.kind}`} data-ready={r.ready ? 'yes' : 'no'}>
      <strong>{t(`kind.${r.kind}`)}</strong> {cert ? <Badge t={t} status={cert.status} /> : <StatusBadge status={r.ready ? 'APPROVED' : 'REJECTED'} label={r.ready ? t('sys.ready') : t('sys.notReady')} size="sm" />}
      {!cert && !r.ready && <ul className="small">{r.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
      {!cert && r.ready && s.can.request && <button type="button" className="btn btn-small btn-primary" disabled={req.isPending} onClick={() => req.mutate(r.kind)} data-testid={`sys-request-${r.kind}`}>{t('sys.request')}</button>}
    </li>; })}</ul>
  </Card>;
}

function Tags({ t, s, refresh }) {
  const [v, setV] = useState({ tagNo: '', description: '' }); const [rec, setRec] = useState({});
  const add = useMutation({ mutationFn: () => post(`/commissioning/systems/${s.id}/tags`, { ...v, sheets: ['A', 'B', 'C'].map((c) => ({ sheetClass: c, title: t(`sheet.default${c}`) })) }), onSuccess: () => { setV({ tagNo: '', description: '' }); refresh(); } });
  const record = useMutation({ mutationFn: ([id, result]) => post(`/commissioning/sheets/${id}/record`, { result, ...(rec[id] ? { note: rec[id] } : {}) }), onSuccess: refresh });
  return <Card title={t('sys.tags')} testid="sys-tags">
    {(add.error || record.error) && <ErrorState error={add.error ?? record.error} />}
    {!s.tags.length ? <EmptyState compact title={t('sys.noTags')} message={t('sys.noTagsBody')} /> : <div className="table-scroll"><table className="data-table" data-testid="sys-sheet-table">
      <thead><tr><th scope="col">{t('f.tag')}</th><th scope="col">{t('f.class')}</th><th scope="col">{t('f.sheet')}</th><th scope="col">{t('f.status')}</th><th scope="col">{t('f.note')}</th>{s.can.record && <th scope="col">{t('f.record')}</th>}</tr></thead>
      <tbody>{s.tags.flatMap((g) => g.sheets.map((c) => <tr key={c.id} data-testid="sys-sheet" data-class={c.sheetClass} data-status={c.status}>
        <td>{g.tagNo}</td><td>{c.sheetClass}</td><td>{c.title}</td><td><Badge t={t} status={c.status} /></td><td>{c.note ?? ''}</td>
        {s.can.record && <td>{c.status !== 'PASSED' && <div className="actions-row">
          <input aria-label={t('f.note')} value={rec[c.id] ?? ''} onChange={(e) => setRec({ ...rec, [c.id]: e.target.value })} data-testid={`sheet-note-${c.id}`} />
          <button type="button" className="btn btn-small btn-primary" disabled={record.isPending} onClick={() => record.mutate([c.id, 'PASSED'])} data-testid={`sheet-pass-${c.id}`}>{t('pass')}</button>
          <button type="button" className="btn btn-small" disabled={record.isPending} onClick={() => record.mutate([c.id, 'FAILED'])} data-testid={`sheet-fail-${c.id}`}>{t('fail')}</button>
        </div>}</td>}
      </tr>))}</tbody>
    </table></div>}
    {s.can.manage && <form className="form-grid" onSubmit={(e) => { e.preventDefault(); add.mutate(); }} data-testid="sys-tag-form">
      <Field name="tag-no" label={t('f.tag')}><input id="tag-no" required value={v.tagNo} onChange={(e) => setV({ ...v, tagNo: e.target.value })} data-testid="tag-no" /></Field>
      <Field name="tag-desc" label={t('f.description')} hint={t('sys.tagHint')}><input id="tag-desc" required value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} data-testid="tag-desc" /></Field>
      <div className="actions-row"><button type="submit" className="btn" disabled={add.isPending} data-testid="tag-add">{t('sys.addTag')}</button></div>
    </form>}
  </Card>;
}

function Packs({ t, s, refresh }) {
  const [v, setV] = useState({ packType: 'HYDROTEST', procedureRef: '' }); const [w, setW] = useState({ witnessedBy: '', testedOn: '' });
  const add = useMutation({ mutationFn: () => post(`/commissioning/systems/${s.id}/test-packs`, v), onSuccess: () => { setV({ packType: 'HYDROTEST', procedureRef: '' }); refresh(); } });
  const record = useMutation({ mutationFn: ([id, result]) => post(`/commissioning/test-packs/${id}/record`, { result, ...w }), onSuccess: refresh });
  return <Card title={t('sys.packs')} testid="sys-packs">
    {(add.error || record.error) && <ErrorState error={add.error ?? record.error} />}
    {!s.testPacks.length ? <EmptyState compact title={t('tp.none')} message={t('tp.noneBody')} /> : <PackTable t={t} rows={s.testPacks} actions={s.can.record ? (p) => p.status !== 'PASSED' && <div className="actions-row">
      <input aria-label={t('f.witness')} placeholder={t('f.witness')} value={w.witnessedBy} onChange={(e) => setW({ ...w, witnessedBy: e.target.value })} data-testid={`pack-witness-${p.id}`} />
      <input type="date" aria-label={t('f.testedOn')} value={w.testedOn} onChange={(e) => setW({ ...w, testedOn: e.target.value })} data-testid={`pack-date-${p.id}`} />
      <button type="button" className="btn btn-small btn-primary" disabled={record.isPending} onClick={() => record.mutate([p.id, 'PASSED'])} data-testid={`pack-pass-${p.id}`}>{t('pass')}</button>
      <button type="button" className="btn btn-small" disabled={record.isPending} onClick={() => record.mutate([p.id, 'FAILED'])} data-testid={`pack-fail-${p.id}`}>{t('fail')}</button>
    </div> : null} />}
    {s.can.manage && <form className="form-grid" onSubmit={(e) => { e.preventDefault(); add.mutate(); }} data-testid="sys-pack-form">
      <Field name="pack-type" label={t('f.packType')}><select id="pack-type" value={v.packType} onChange={(e) => setV({ ...v, packType: e.target.value })} data-testid="pack-type">{PACK_TYPES.map((x) => <option key={x} value={x}>{t(`pack.${x}`)}</option>)}</select></Field>
      <Field name="pack-proc" label={t('f.procedure')}><input id="pack-proc" required value={v.procedureRef} onChange={(e) => setV({ ...v, procedureRef: e.target.value })} data-testid="pack-proc" /></Field>
      <div className="actions-row"><button type="submit" className="btn" disabled={add.isPending} data-testid="pack-add">{t('sys.addPack')}</button></div>
    </form>}
  </Card>;
}

function PackTable({ t, rows, actions }) {
  return <div className="table-scroll"><table className="data-table" data-testid="pack-table">
    <thead><tr><th scope="col">{t('f.docNo')}</th><th scope="col">{t('f.system')}</th><th scope="col">{t('f.packType')}</th><th scope="col">{t('f.procedure')}</th><th scope="col">{t('f.status')}</th><th scope="col">{t('f.witness')}</th><th scope="col">{t('f.testedOn')}</th>{actions && <th scope="col">{t('f.record')}</th>}</tr></thead>
    <tbody>{rows.map((p) => <tr key={p.id} data-testid="pack-row" data-status={p.status}>
      <td>{p.docNo}</td><td>{p.system}</td><td>{t(`pack.${p.packType}`)}</td><td>{p.procedureRef}</td><td><Badge t={t} status={p.status} /></td><td>{[p.witnessedBy, p.witnessParty].filter(Boolean).join(' · ')}</td><td>{p.testedOn ?? ''}</td>
      {actions && <td>{actions(p)}</td>}
    </tr>)}</tbody>
  </table></div>;
}

function Punches({ t, s, refresh }) {
  const opts = useQuery({ queryKey: ['close', 'tnc', 'options', s.projectId], queryFn: () => read(`/commissioning/options${qs({ projectId: s.projectId })}`), enabled: s.can.manage, retry: false });
  const [snagId, setSnagId] = useState('');
  const link = useMutation({ mutationFn: () => post(`/commissioning/systems/${s.id}/punches`, { snagId: Number(snagId) }), onSuccess: () => { setSnagId(''); refresh(); } });
  const linked = new Set(s.punches.map((p) => p.id));
  return <Card title={t('sys.punches')} subtitle={t('sys.punchesBody')} testid="sys-punches">
    {link.error && <ErrorState error={link.error} />}
    {!s.punches.length ? <EmptyState compact title={t('sys.noPunches')} message={t('sys.noPunchesBody')} /> : <ul className="plain-list">{s.punches.map((p) => <li key={p.id} data-testid="sys-punch" data-class={p.punchClass}>{p.docNo} · {t('f.class')} {p.punchClass} <Badge t={t} status={p.status} /> <span className="small">{p.description}</span></li>)}</ul>}
    {s.can.manage && <form className="actions-row" onSubmit={(e) => { e.preventDefault(); link.mutate(); }} data-testid="sys-punch-form">
      <Field name="punch-snag" label={t('sys.linkPunch')}><select id="punch-snag" required value={snagId} onChange={(e) => setSnagId(e.target.value)} data-testid="punch-snag"><option value="">{t('f.choose')}</option>{(opts.data?.snags ?? []).filter((x) => !linked.has(x.id)).map((x) => <option key={x.id} value={x.id}>{x.docNo} · {x.punchClass} · {x.description}</option>)}</select></Field>
      <button type="submit" className="btn" disabled={link.isPending} data-testid="punch-link">{t('sys.link')}</button>
    </form>}
  </Card>;
}

export function TestPacks() {
  const t = useT('close'); usePageTitle(t('tp.title'));
  const q = useQuery({ queryKey: ['close', 'tnc', 'packs'], queryFn: () => read('/commissioning/test-packs'), retry: false });
  return <Guard q={q} t={t} title={t('tp.title')}>{(rows) => <section aria-labelledby="tp-h" data-testid="close-test-packs">
    <PageHeader id="tp-h" title={t('tp.title')} subtitle={t('tp.subtitle')} />
    {!rows.length ? <EmptyState title={t('tp.none')} message={t('tp.noneBody')} /> : <Card title={t('tp.title')}><PackTable t={t} rows={rows} /></Card>}
  </section>}</Guard>;
}

export function Certificates() {
  const t = useT('close'); usePageTitle(t('ce.title'));
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['close', 'tnc', 'certs'], queryFn: () => read('/commissioning/certificates'), retry: false });
  const [sign, setSign] = useState(null); const [v, setV] = useState({ signatory: '', signedOn: '', file: null });
  const m = useMutation({
    mutationFn: async (c) => { const stored = await uploadFile(v.file, { transport, entity: 'tnc_certificates', entityId: c.id }); return post(`/commissioning/certificates/${c.id}/client-sign`, { signatory: v.signatory, signedOn: v.signedOn, fileId: stored.id }); },
    onSuccess: () => { setSign(null); setV({ signatory: '', signedOn: '', file: null }); cache.invalidateQueries({ queryKey: ['close', 'tnc'] }); },
  });
  return <Guard q={q} t={t} title={t('ce.title')}>{(rows) => <section aria-labelledby="ce-h" data-testid="close-certificates">
    <PageHeader id="ce-h" title={t('ce.title')} subtitle={t('ce.subtitle')} />
    {m.error && <ErrorState error={m.error} />}
    {!rows.length ? <EmptyState title={t('ce.none')} message={t('ce.noneBody')} /> : <Card title={t('ce.title')}><div className="table-scroll"><table className="data-table" data-testid="ce-table">
      <thead><tr><th scope="col">{t('f.docNo')}</th><th scope="col">{t('f.certificate')}</th><th scope="col">{t('f.system')}</th><th scope="col">{t('f.status')}</th><th scope="col">{t('f.client')}</th><th scope="col">{t('f.actions')}</th></tr></thead>
      <tbody>{rows.map((c) => <tr key={c.id} data-testid="ce-row" data-kind={c.kind} data-status={c.status}>
        <td>{c.docNo}</td><td>{t(`kind.${c.kind}`)}</td><td>{c.system?.code}</td><td><Badge t={t} status={c.status} /></td><td>{c.clientSignatory ? `${c.clientSignatory} · ${c.clientSignedOn}` : ''}</td>
        <td>{c.status === 'APPROVED' && (sign === c.id ? <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate(c); }} data-testid="ce-sign-form">
          <Field name="ce-signatory" label={t('f.signatory')}><input id="ce-signatory" required value={v.signatory} onChange={(e) => setV({ ...v, signatory: e.target.value })} data-testid="ce-signatory" /></Field>
          <Field name="ce-date" label={t('f.signedOn')}><input id="ce-date" type="date" required value={v.signedOn} onChange={(e) => setV({ ...v, signedOn: e.target.value })} data-testid="ce-date" /></Field>
          <Field name="ce-file" label={t('f.signedCopy')}><input id="ce-file" type="file" required accept=".pdf,image/*" onChange={(e) => setV({ ...v, file: e.target.files?.[0] ?? null })} data-testid="ce-file" /></Field>
          <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={m.isPending} data-testid="ce-sign-save">{t('ce.issue')}</button><button type="button" className="btn" onClick={() => setSign(null)}>{t('cancel')}</button></div>
        </form> : <button type="button" className="btn btn-small" onClick={() => setSign(c.id)} data-testid={`ce-sign-${c.id}`}>{t('ce.sign')}</button>)}</td>
      </tr>)}</tbody>
    </table></div></Card>}
  </section>}</Guard>;
}

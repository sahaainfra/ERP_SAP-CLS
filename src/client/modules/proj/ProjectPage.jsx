import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { CONTRACT_TYPES, dayIST, inr, proj } from './api.js';
import { APPROVAL_TONE, HEALTH_TONE, STATE_TONE, Tabs, useSearch } from './parts.jsx';

// Project (part 10.01, FR-01 to FR-06): one project as an object page: details with the contract summary, sites, the key dates and milestones, settings, the lifecycle history and the approvals. The actions follow the state and the rights of the
// person: send for activation (with its checklist), edit while in setup, amend the contract terms of a live project (approved by the project director and the director), move through the lifecycle with the checklist of each move (the project
// manager's suspension and closure go through the chain), withdraw, cancel, delete, print.
export default function ProjectPage() {
  const t = useT('proj');
  const qc = useQueryClient();
  const id = Number(useSearch().get('id')) || null;
  const q = useQuery({ queryKey: ['proj', 'project', id], queryFn: () => proj.get(id), enabled: Boolean(id), retry: false });
  const x = q.data;
  usePageTitle(x ? `${x.code} ${x.name}` : t('obj.title'));
  const [tab, setTab] = useState('details'); const [panel, setPanel] = useState(null); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  if (!id) return <section aria-labelledby="proj-h" data-testid="project-none"><h1 id="proj-h">{t('obj.title')}</h1><p className="muted">{t('obj.noId')} <Link to="/proj/projects">{t('list.title')}</Link></p></section>;
  if (q.error?.status === 403) return <NoPermission what={t('list.title')} permission="proj.project.view" />;
  if (q.isPending) return <Skeleton label={t('obj.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['proj'] }); return r ?? true; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const errBox = error?.form && <p className="field-error" role="alert" data-testid="proj-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 8).join('; ')}` : ''}</p>;
  const c = x.can; const open = x.openRequest;
  return (
    <section aria-labelledby="proj-h" data-testid="project" data-status={x.status} data-state={x.state}>
      <header>
        <h1 id="proj-h">{x.code} · {x.name} <StatusBadge status={STATE_TONE[x.state]} label={x.stateLabel} /> <StatusBadge status={APPROVAL_TONE[x.status]} label={x.statusLabel} /></h1>
        <p className="muted">{x.client?.name ?? '—'}{x.location ? ` · ${x.location}` : ''} · {t(`ptype.${x.type}`)} · {x.contractTypeLabel}{x.pm ? ` · ${t('f.pm')}: ${x.pm}` : ''}</p>
        <dl className="op-figures" data-testid="proj-figures">
          <div><dt>{t('f.contractValue')}</dt><dd data-testid="proj-value">{inr(x.contractValue)}</dd></div>
          <div><dt>{t('wiz.period')}</dt><dd>{x.startDate ?? '–'} → {x.revisedCompletion ?? x.scheduledCompletion ?? '–'}</dd></div>
          <div><dt>{t('obj.health')}</dt><dd data-testid="proj-health"><StatusBadge status={HEALTH_TONE[x.health]} label={t(`health.${x.health}`)} />{x.timeElapsedPct != null ? ` · ${t('obj.elapsed', { n: x.timeElapsedPct })}` : ''}</dd></div>
          <div><dt>{t('f.dlpMonths')}</dt><dd>{x.dlpMonths}</dd></div>
        </dl>
        {errBox}{note && <p className="mdm-banner" role="status" data-testid="proj-note">{note}</p>}
        {open && <p className="mdm-banner" role="status" data-testid="proj-open">{t('obj.openRequest', { what: open.kind === 'AMENDMENT' ? t('obj.amendment') : t('obj.moveTo', { to: open.toLabel }), by: open.by })}{open.by === undefined ? '' : ''} {open.kind !== 'ACTIVATION' && <button type="button" className="btn btn-small" onClick={() => why((r) => proj.withdrawMove(id, { reason: r }), t('obj.withdrawn'))} data-testid="proj-withdraw-move">{t('act.withdraw')}</button>}</p>}
        <div className="actions-row no-print" data-testid="proj-actions">
          {c.submit && <button type="button" className="btn btn-primary" onClick={() => setPanel(panel === 'activate' ? null : 'activate')} data-testid="proj-activate">{t('act.activate')}</button>}
          {c.edit && <button type="button" className="btn" onClick={() => { setTab('details'); setPanel('edit'); }} data-testid="proj-edit">{t('act.edit')}</button>}
          {c.editLive && <button type="button" className="btn" onClick={() => { setTab('details'); setPanel('edit'); }} data-testid="proj-edit-live">{t('act.edit')}</button>}
          {c.amend && <button type="button" className="btn" onClick={() => setPanel(panel === 'amend' ? null : 'amend')} data-testid="proj-amend">{t('act.amend')}</button>}
          {x.transitions.map((o) => <button key={o.to} type="button" className="btn" disabled={!o.allowed} onClick={() => setPanel(panel === `move:${o.to}` ? null : `move:${o.to}`)} data-testid={`proj-move-${o.to}`}>{t('act.moveTo', { to: o.toLabel })}</button>)}
          {c.withdraw && <button type="button" className="btn" onClick={() => why((r) => proj.act(id, 'withdraw', { reason: r }), t('obj.withdrawn'))} data-testid="proj-withdraw">{t('act.withdraw')}</button>}
          {c.cancel && <button type="button" className="btn" onClick={() => why((r) => proj.act(id, 'cancel', { reason: r }), t('obj.cancelled'))} data-testid="proj-cancel">{t('act.cancel')}</button>}
          {c.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('act.confirmDelete'))) { const r = await run(() => proj.remove(id)); if (r) navigateTo('/proj/projects', { force: true }); } }} data-testid="proj-delete">{t('act.delete')}</button>}
          {c.print && <button type="button" className="btn" onClick={async () => { const w = window.open('', '_blank'); try { const { authHeaders } = await import('../../platform/api/index.js'); const res = await fetch(`/api/v1/proj/projects/${id}/print`, { headers: authHeaders() }); const b = await res.blob(); if (w) w.location.href = URL.createObjectURL(b); } catch { w?.close(); } }} data-testid="proj-print">{t('act.print')}</button>}
        </div>
        {panel === 'activate' && <Activate x={x} run={run} done={() => setPanel(null)} />}
        {panel === 'amend' && <Amend x={x} run={run} done={() => setPanel(null)} />}
        {panel?.startsWith('move:') && <Move x={x} to={panel.slice(5)} run={run} done={() => setPanel(null)} />}
      </header>
      <Tabs tabs={['details', 'sites', 'milestones', 'settings', 'lifecycle', 'approvals', 'files']} active={tab} onChange={setTab} label={t('obj.title')} />
      {tab === 'details' && (panel === 'edit' ? <Edit x={x} run={run} done={() => setPanel(null)} error={error} /> : <Details x={x} />)}
      {tab === 'sites' && <Sites x={x} />}
      {tab === 'milestones' && <Milestones x={x} run={run} error={error} />}
      {tab === 'settings' && <Settings x={x} run={run} />}
      {tab === 'lifecycle' && <Lifecycle x={x} />}
      {tab === 'approvals' && <Approvals id={id} rowVersion={x.rowVersion} />}
      {tab === 'files' && <div data-testid="proj-files"><h2>{t('tab.files')}</h2><AttachmentList entity="proj_project" entityId={x.projectId} canEdit={c.edit || c.editLive} />{(c.edit || c.editLive) && <FileUploader entity="proj_project" entityId={x.projectId} />}</div>}
      <p className="small"><Link to="/proj/projects">{t('list.title')}</Link></p>
    </section>
  );
}

function Details({ x }) {
  const t = useT('proj');
  const row = (k, v) => <div key={k}><dt>{t(k)}</dt><dd>{v ?? '—'}</dd></div>;
  return (
    <dl className="op-figures" data-testid="proj-details">
      {row('f.client', x.client?.name)}{row('f.consultant', x.consultant?.name)}{row('f.funder', x.funder?.name)}{row('f.sector', x.sector ? t(`sector.${x.sector}`) : null)}{row('f.contractNo', x.contractNo)}{row('f.contractType', x.contractTypeLabel)}
      {row('f.retention', `${x.retentionPct}%`)}{row('f.mobAdvance', `${x.mobAdvancePct}%`)}{row('f.ld', x.ldSummary)}{row('f.pm', x.pm)}{row('f.director', x.director)}
      {x.tender && <div><dt>{t('obj.tender')}</dt><dd><Link to={`/bd/tender?id=${x.tender.id}`}>{x.tender.docNo}</Link></dd></div>}
      {row('obj.setupDone', t('obj.setupText', { series: (x.setup.series ?? []).length, folders: x.setup.folders ?? 0 }))}
    </dl>
  );
}

function Edit({ x, run, done, error }) {
  const t = useT('proj'); const live = !x.can.edit;
  const [v, setV] = useState({ name: x.name, sector: x.sector ?? '', location: x.location ?? '', contractType: x.contractType, contractNo: x.contractNo ?? '', contractValue: x.contractValue, startDate: x.startDate ?? '', scheduledCompletion: x.scheduledCompletion ?? '', dlpMonths: x.dlpMonths, retentionPct: x.retentionPct, mobAdvancePct: x.mobAdvancePct, ldSummary: x.ldSummary ?? '', pmUser: x.pm ?? '', directorUser: x.director ?? '', consultantPartnerId: x.consultant?.id ?? null, funderPartnerId: x.funder?.id ?? null, clientPartnerId: x.client?.id ?? null });
  const set = (k, val) => setV({ ...v, [k]: val });
  const save = async (e) => {
    e.preventDefault();
    const common = { location: v.location.trim() || null, ldSummary: v.ldSummary.trim() || null, pmUser: v.pmUser || null, directorUser: v.directorUser || null, consultantPartnerId: v.consultantPartnerId, funderPartnerId: v.funderPartnerId, sector: v.sector || null };
    const setup = live ? {} : { name: v.name.trim(), contractType: v.contractType, contractNo: v.contractNo.trim() || null, contractValue: String(v.contractValue || '0'), startDate: v.startDate || null, scheduledCompletion: v.scheduledCompletion || null, dlpMonths: Number(v.dlpMonths), retentionPct: String(v.retentionPct), mobAdvancePct: String(v.mobAdvancePct), clientPartnerId: v.clientPartnerId };
    if (await run(() => proj.update(x.id, { ...common, ...setup, version: x.rowVersion }), t('act.saved'))) done();
  };
  return (
    <form className="mdm-panel mdm-fields" onSubmit={save} aria-label={t('act.edit')} data-testid="proj-edit-form">
      {live && <p className="small muted">{t('obj.liveEdit')}</p>}
      {!live && <>
        <Field label={t('f.name')} name="name" error={error}><input value={v.name} onChange={(e) => set('name', e.target.value)} data-testid="pe-name" /></Field>
        <LookupField id="pe-client" label={t('f.client')} lookup="proj/clients" value={v.clientPartnerId} onChange={(val) => set('clientPartnerId', val)} />
        <Field label={t('f.contractType')} name="contractType" error={error}><select value={v.contractType} onChange={(e) => set('contractType', e.target.value)}>{CONTRACT_TYPES.map((k) => <option key={k} value={k}>{t(`ctype.${k}`)}</option>)}</select></Field>
        <Field label={t('f.contractNo')} name="contractNo" error={error}><input value={v.contractNo} onChange={(e) => set('contractNo', e.target.value)} data-testid="pe-cno" /></Field>
        <Field label={t('f.contractValue')} name="contractValue" error={error}><input type="number" min="0" step="0.01" value={v.contractValue} onChange={(e) => set('contractValue', e.target.value)} data-testid="pe-value" /></Field>
        <Field label={t('f.startDate')} name="startDate" error={error}><input type="date" value={v.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
        <Field label={t('f.scheduledCompletion')} name="scheduledCompletion" error={error}><input type="date" value={v.scheduledCompletion} onChange={(e) => set('scheduledCompletion', e.target.value)} /></Field>
        <Field label={t('f.dlpMonths')} name="dlpMonths" error={error}><input type="number" min="0" max="120" value={v.dlpMonths} onChange={(e) => set('dlpMonths', e.target.value)} /></Field>
        <Field label={t('f.retention')} name="retentionPct" error={error}><input type="number" min="0" max="100" step="0.01" value={v.retentionPct} onChange={(e) => set('retentionPct', e.target.value)} /></Field>
        <Field label={t('f.mobAdvance')} name="mobAdvancePct" error={error}><input type="number" min="0" max="100" step="0.01" value={v.mobAdvancePct} onChange={(e) => set('mobAdvancePct', e.target.value)} /></Field>
      </>}
      <Field label={t('f.location')} name="location" error={error}><input value={v.location} onChange={(e) => set('location', e.target.value)} data-testid="pe-location" /></Field>
      <Field label={t('f.ld')} name="ldSummary" error={error}><textarea rows={2} value={v.ldSummary} onChange={(e) => set('ldSummary', e.target.value)} data-testid="pe-ld" /></Field>
      <LookupField id="pe-consultant" label={t('f.consultant')} lookup="proj/consultants" value={v.consultantPartnerId} onChange={(val) => set('consultantPartnerId', val)} />
      <LookupField id="pe-funder" label={t('f.funder')} lookup="proj/funders" value={v.funderPartnerId} onChange={(val) => set('funderPartnerId', val)} />
      <LookupField id="pe-pm" label={t('f.pm')} lookup="proj/people" valueKey="code" value={v.pmUser} onChange={(val) => set('pmUser', val)} />
      <LookupField id="pe-director" label={t('f.director')} lookup="proj/people" valueKey="code" value={v.directorUser} onChange={(val) => set('directorUser', val)} />
      <div className="actions"><button type="button" className="btn" onClick={done}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="pe-save">{t('act.save')}</button></div>
    </form>
  );
}

function Checks({ items, picks, setPicks, name }) {
  return <fieldset className="mdm-fields"><legend className="sr-only">{name}</legend>{items.map((c, i) => <label key={c} className="check" style={{ display: 'block' }}><input type="checkbox" checked={picks.includes(i)} onChange={(e) => setPicks(e.target.checked ? [...picks, i] : picks.filter((k) => k !== i))} data-testid={`chk-${i}`} /> {c}</label>)}</fieldset>;
}
function Readiness({ items }) {
  const t = useT('proj');
  return items.length === 0 ? null : <ul className="mdm-list" data-testid="readiness">{items.map((r) => <li key={r.code} className={r.ok ? '' : r.blocking ? 'field-error' : 'muted'} data-testid={`ready-${r.code}`}>{r.ok ? '✓' : r.blocking ? '✗' : '!'} {r.text}{!r.ok && !r.blocking ? ` (${t('obj.warning')})` : ''}</li>)}</ul>;
}
function Activate({ x, run, done }) {
  const t = useT('proj'); const opts = useQuery({ queryKey: ['proj', 'options'], queryFn: proj.options, retry: false });
  const [picks, setPicks] = useState([]); const items = opts.data?.checklists.ACTIVATE ?? [];
  return (
    <form className="mdm-panel" onSubmit={async (e) => { e.preventDefault(); if (await run(() => proj.act(x.id, 'submit', { ticked: picks }), t('obj.sentActivation'))) done(); }} aria-label={t('act.activate')} data-testid="proj-activate-form">
      <h2>{t('act.activate')}</h2><p className="small muted">{t('obj.activateHelp')}</p>
      <Readiness items={x.readiness} /><Checks items={items} picks={picks} setPicks={setPicks} name={t('wiz.activateChecklist')} />
      <div className="actions"><button type="button" className="btn" onClick={done}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={picks.length !== items.length || x.readiness.some((r) => r.blocking && !r.ok)} data-testid="proj-activate-send">{t('obj.sendActivation')}</button></div>
    </form>
  );
}
function Move({ x, to, run, done }) {
  const t = useT('proj'); const o = x.transitions.find((y) => y.to === to);
  const [picks, setPicks] = useState([]); const [reason, setReason] = useState('');
  if (!o) return null;
  return (
    <form className="mdm-panel" onSubmit={async (e) => { e.preventDefault(); if (await run(() => proj.move(x.id, { to, ticked: picks, reason: reason.trim() || null, version: x.rowVersion }), o.approval ? t('obj.moveRequested') : t('obj.moved'))) done(); }} aria-label={t('act.moveTo', { to: o.toLabel })} data-testid="proj-move-form">
      <h2>{t('act.moveTo', { to: o.toLabel })}</h2>{o.approval && <p className="small muted">{t('obj.chainHelp')}</p>}
      <Readiness items={o.readiness} /><Checks items={o.checklist} picks={picks} setPicks={setPicks} name={t('obj.checklist')} />
      <Field label={t('obj.reason')} name="reason" hint={o.approval ? t('obj.reasonRequired') : undefined}><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="move-reason" /></Field>
      <div className="actions"><button type="button" className="btn" onClick={done}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={picks.length !== o.checklist.length || o.readiness.some((r) => r.blocking && !r.ok)} data-testid="move-go">{o.approval ? t('obj.requestMove') : t('obj.doMove')}</button></div>
    </form>
  );
}
function Amend({ x, run, done }) {
  const t = useT('proj');
  const [v, setV] = useState({ contractValue: '', scheduledCompletion: '', revisedCompletion: '', dlpMonths: '', retentionPct: '', mobAdvancePct: '', reason: '' });
  const set = (k, val) => setV({ ...v, [k]: val });
  const changes = Object.fromEntries(Object.entries({ contractValue: v.contractValue, scheduledCompletion: v.scheduledCompletion, revisedCompletion: v.revisedCompletion, retentionPct: v.retentionPct, mobAdvancePct: v.mobAdvancePct }).filter(([, val]) => val !== '').concat(v.dlpMonths === '' ? [] : [['dlpMonths', Number(v.dlpMonths)]]));
  return (
    <form className="mdm-panel mdm-fields" onSubmit={async (e) => { e.preventDefault(); if (await run(() => proj.act(x.id, 'amend', { changes, reason: v.reason.trim() }), t('obj.amendRequested'))) done(); }} aria-label={t('act.amend')} data-testid="proj-amend-form">
      <h2>{t('act.amend')}</h2><p className="small muted">{t('obj.amendHelp')}</p>
      <Field label={t('f.contractValue')} name="contractValue"><input type="number" min="0" step="0.01" value={v.contractValue} placeholder={x.contractValue} onChange={(e) => set('contractValue', e.target.value)} data-testid="am-value" /></Field>
      <Field label={t('f.scheduledCompletion')} name="scheduledCompletion"><input type="date" value={v.scheduledCompletion} onChange={(e) => set('scheduledCompletion', e.target.value)} data-testid="am-end" /></Field>
      <Field label={t('f.revisedCompletion')} name="revisedCompletion"><input type="date" value={v.revisedCompletion} onChange={(e) => set('revisedCompletion', e.target.value)} data-testid="am-revised" /></Field>
      <Field label={t('f.dlpMonths')} name="dlpMonths"><input type="number" min="0" max="120" value={v.dlpMonths} onChange={(e) => set('dlpMonths', e.target.value)} /></Field>
      <Field label={t('f.retention')} name="retentionPct"><input type="number" min="0" max="100" step="0.01" value={v.retentionPct} onChange={(e) => set('retentionPct', e.target.value)} /></Field>
      <Field label={t('f.mobAdvance')} name="mobAdvancePct"><input type="number" min="0" max="100" step="0.01" value={v.mobAdvancePct} onChange={(e) => set('mobAdvancePct', e.target.value)} /></Field>
      <Field label={t('obj.reason')} name="reason"><textarea rows={2} value={v.reason} onChange={(e) => set('reason', e.target.value)} required data-testid="am-reason" /></Field>
      <div className="actions"><button type="button" className="btn" onClick={done}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={!Object.keys(changes).length || v.reason.trim().length < 5} data-testid="am-send">{t('obj.requestAmend')}</button></div>
    </form>
  );
}

function Sites({ x }) {
  const t = useT('proj');
  return (
    <div data-testid="proj-sites">
      {x.sites.length === 0 ? <p className="muted">{t('site.none')}</p> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">{t('site.code')}</th><th scope="col">{t('site.name')}</th><th scope="col">{t('site.type')}</th><th scope="col">{t('site.status')}</th><th scope="col">{t('site.geofence')}</th></tr></thead>
          <tbody>{x.sites.map((s) => <tr key={s.id} data-testid={`site-${s.code}`}><th scope="row" data-label={t('site.code')}>{s.code}</th><td data-label={t('site.name')}>{s.name}</td><td data-label={t('site.type')}>{t(`stype.${s.type}`)}</td><td data-label={t('site.status')}>{s.status}</td><td data-label={t('site.geofence')}>{s.geofence === 'CIRCLE' ? t('site.circle', { r: s.radiusM }) : t(`geo.${s.geofence}`)}</td></tr>)}</tbody></table></div>)}
      <p className="small muted">{t('site.help')} <Link to="/admin/organisation">{t('site.orgLink')}</Link></p>
    </div>
  );
}

function Milestones({ x, run, error }) {
  const t = useT('proj'); const edit = x.can.milestones;
  const [n, setN] = useState({ code: '', name: '', plannedDate: dayIST(30), contractual: false, paymentLinked: false });
  return (
    <div data-testid="proj-milestones">
      {x.milestones.length === 0 ? <p className="muted">{t('ms.none')}</p> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">{t('ms.code')}</th><th scope="col">{t('ms.name')}</th><th scope="col">{t('ms.planned')}</th><th scope="col">{t('ms.actual')}</th><th scope="col">{t('ms.flags')}</th><th scope="col">{t('site.status')}</th>{edit && <th scope="col"><span className="sr-only">{t('act.edit')}</span></th>}</tr></thead>
          <tbody>{x.milestones.map((m) => (
            <tr key={m.id} data-testid={`ms-${m.code}`} className={m.overdue ? 'row-highlight' : ''}>
              <th scope="row" data-label={t('ms.code')}>{m.code}</th><td data-label={t('ms.name')}>{m.name}</td><td data-label={t('ms.planned')}>{m.plannedDate}</td><td data-label={t('ms.actual')}>{m.actualDate ?? '—'}</td>
              <td data-label={t('ms.flags')}>{[m.contractual ? t('ms.contractual') : null, m.paymentLinked ? t('ms.paymentLinked') : null].filter(Boolean).join(', ') || '—'}</td>
              <td data-label={t('site.status')} data-testid={`ms-status-${m.code}`}>{m.overdue ? t('ms.overdue', { n: m.daysLate }) : m.statusLabel}</td>
              {edit && <td>{m.status === 'PLANNED' && <button type="button" className="btn btn-small" onClick={() => run(() => proj.updateMilestone(m.id, { status: 'ACHIEVED', version: m.rowVersion }), t('ms.achievedNote'))} data-testid={`ms-achieve-${m.code}`}>{t('ms.achieve')}</button>}{m.status === 'PLANNED' && <button type="button" className="btn btn-small" onClick={() => run(() => proj.removeMilestone(m.id))} aria-label={t('act.remove')}>✕</button>}</td>}
            </tr>))}</tbody></table></div>)}
      {edit && (
        <form className="mdm-panel mdm-fields" onSubmit={async (e) => { e.preventDefault(); if (await run(() => proj.addMilestone(x.id, { code: n.code.trim(), name: n.name.trim(), plannedDate: n.plannedDate, contractual: n.contractual, paymentLinked: n.paymentLinked }), t('ms.added'))) setN({ ...n, code: '', name: '' }); }} aria-label={t('ms.add')} data-testid="ms-form">
          <h2>{t('ms.add')}</h2>
          <Field label={t('ms.code')} name="code" error={error}><input value={n.code} onChange={(e) => setN({ ...n, code: e.target.value })} required data-testid="ms-code" /></Field>
          <Field label={t('ms.name')} name="name" error={error}><input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} required data-testid="ms-name" /></Field>
          <Field label={t('ms.planned')} name="plannedDate" error={error}><input type="date" value={n.plannedDate} onChange={(e) => setN({ ...n, plannedDate: e.target.value })} required data-testid="ms-date" /></Field>
          <label className="check"><input type="checkbox" checked={n.contractual} onChange={(e) => setN({ ...n, contractual: e.target.checked })} data-testid="ms-contractual" /> {t('ms.contractual')}</label>{' '}
          <label className="check"><input type="checkbox" checked={n.paymentLinked} onChange={(e) => setN({ ...n, paymentLinked: e.target.checked })} /> {t('ms.paymentLinked')}</label>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="ms-save">{t('act.save')}</button></div>
        </form>)}
    </div>
  );
}

function Settings({ x, run }) {
  const t = useT('proj'); const edit = x.can.edit || x.can.editLive; const s = x.settings;
  const [v, setV] = useState(s);
  useEffect(() => { setV(x.settings); }, [x.rowVersion]);
  return (
    <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); run(() => proj.update(x.id, { settings: { calendar: v.calendar, workingDays: v.workingDays, units: v.units, costCodeTemplate: v.costCodeTemplate, wbsTemplate: v.wbsTemplate, budgetRequired: Boolean(v.budgetRequired), planningRequired: Boolean(v.planningRequired), enabledModules: v.enabledModules }, version: x.rowVersion }), t('act.saved')); }} aria-label={t('tab.settings')} data-testid="proj-settings">
      <fieldset disabled={!edit} className="mdm-fields">
        <Field label={t('set.calendar')} name="calendar"><select value={v.calendar} onChange={(e) => setV({ ...v, calendar: e.target.value, workingDays: e.target.value === 'FIVE_DAY' ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6] })} data-testid="set-calendar"><option value="STANDARD_6DAY">{t('cal.STANDARD_6DAY')}</option><option value="FIVE_DAY">{t('cal.FIVE_DAY')}</option></select></Field>
        <Field label={t('set.units')} name="units"><select value={v.units} onChange={(e) => setV({ ...v, units: e.target.value })}><option value="METRIC">{t('units.METRIC')}</option><option value="IMPERIAL">{t('units.IMPERIAL')}</option></select></Field>
        <Field label={t('set.costCode')} name="costCodeTemplate"><input value={v.costCodeTemplate} onChange={(e) => setV({ ...v, costCodeTemplate: e.target.value })} /></Field>
        <Field label={t('set.wbs')} name="wbsTemplate"><input value={v.wbsTemplate} onChange={(e) => setV({ ...v, wbsTemplate: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={Boolean(v.budgetRequired)} onChange={(e) => setV({ ...v, budgetRequired: e.target.checked })} /> {t('set.budgetRequired')}</label>{' '}
        <label className="check"><input type="checkbox" checked={Boolean(v.planningRequired)} onChange={(e) => setV({ ...v, planningRequired: e.target.checked })} /> {t('set.planningRequired')}</label>
        <p className="small">{t('set.modules')}: {(v.enabledModules ?? []).join(', ')}</p>
        {edit && <div className="actions"><button type="submit" className="btn btn-primary" data-testid="set-save">{t('act.save')}</button></div>}
      </fieldset>
    </form>
  );
}

function Lifecycle({ x }) {
  const t = useT('proj');
  return (
    <div data-testid="proj-lifecycle">
      <ol className="mdm-list">{x.log.map((l) => (
        <li key={l.id} data-testid={`log-${l.id}`}>
          <strong>{l.kind === 'AMENDMENT' ? t('obj.amendment') : `${l.fromLabel ? `${l.fromLabel} → ` : ''}${l.toLabel}`}</strong> · {t(`lstatus.${l.status}`)} · {l.by} · <span className="muted small">{String(l.at).slice(0, 16).replace('T', ' ')}</span>
          {l.reason ? <><br />{l.reason}</> : null}
          {l.kind === 'AMENDMENT' && l.changes?.after ? <><br />{Object.entries(l.changes.after).map(([k, v]) => `${k}: ${l.changes.before?.[k] ?? '–'} → ${v}`).join('; ')}</> : null}
          {l.checklist.length > 0 && <><br /><span className="small">{t('obj.checklist')}: {l.checklist.filter((c) => c.ticked).length}/{l.checklist.length}</span></>}
          {l.warnings.length > 0 && <><br /><span className="small muted">{t('obj.warning')}: {l.warnings.join('; ')}</span></>}
        </li>))}</ol>
    </div>
  );
}

function Approvals({ id, rowVersion }) {
  const t = useT('proj');
  const q = useQuery({ queryKey: ['proj', 'history', id, rowVersion], queryFn: () => proj.history(id), retry: false });
  if (q.isPending) return <Skeleton label={t('tab.approvals')} rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <div data-testid="proj-approvals">
      <h2>{t('tab.approvals')}</h2>
      {q.data.approvals.length === 0 ? <p className="muted">{t('obj.noApprovals')}</p> : <ul className="mdm-list">{q.data.approvals.map((a, i) => <li key={i}><strong>{a.event}</strong> · {a.actor}{a.step_code ? ` · ${a.step_code}` : ''} · <span className="muted small">{String(a.at).slice(0, 16).replace('T', ' ')}</span>{a.comment ? <><br />{a.comment}</> : null}</li>)}</ul>}
      <h2>{t('obj.changes')}</h2>
      <ul className="mdm-list">{q.data.audit.map((a, i) => <li key={i}>{a.action} · {a.actor} · <span className="muted small">{String(a.at).slice(0, 16).replace('T', ' ')}</span>{a.reason ? ` · ${a.reason}` : ''}</li>)}</ul>
    </div>
  );
}

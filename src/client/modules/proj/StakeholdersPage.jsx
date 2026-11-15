import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { CHANNELS, FREQS, SKINDS, downloadFile, tm } from './api.js';
import ProjectPicker from './ProjectPicker.jsx';
import { Tabs, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Stakeholders (part 10.05, FR-02, FR-03): the register of the people and organisations around a project (client, consultant, authorities, funders...) with their influence and interest, and the communication matrix: what is reported to whom, how often and
// by which channel. E-mail and phone are shown to those who hold the right to see contact details.
const LV = ['LOW', 'MEDIUM', 'HIGH'];
export default function StakeholdersPage() {
  const t = useT('proj');
  const qc = useQueryClient();
  usePageTitle(t('stk.title'));
  const projectId = Number(useSearch().get('projectId')) || null;
  const q = useQuery({ queryKey: ['proj', 'stakeholders', projectId], queryFn: () => tm.stakeholders(projectId), enabled: Boolean(projectId), retry: false });
  const mq = useQuery({ queryKey: ['proj', 'comm', projectId], queryFn: () => tm.matrix(projectId), enabled: Boolean(projectId), retry: false });
  const [tab, setTab] = useState('register'); const [open, setOpen] = useState(null); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const [s, setS] = useState({ skind: 'CLIENT', organisation: '', name: '', roleTitle: '', influence: 'MEDIUM', interest: 'MEDIUM', email: '', phone: '' });
  const [c, setC] = useState({ info: '', stakeholderId: '', audience: '', frequency: 'WEEKLY', channel: 'REPORT', ownerUser: '' });
  const head = <><PageHeader id="stk-h" title={t('stk.title')} subtitle={t('stk.intro')} /><ProjectPicker route="/proj/stakeholders" projectId={projectId} testId="stk-project" /></>;
  if (!projectId) return <section aria-labelledby="stk-h" data-testid="stk-none">{head}</section>;
  if (q.error?.status === 403) return <NoPermission what={t('stk.title')} permission="proj.stakeholder.view" />;
  if (q.isPending || mq.isPending) return <Skeleton label={t('stk.title')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const m = mq.data;
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['proj'] }); return r ?? true; } catch (e) { setError(errorInfo(e)); return null; } };
  const errBox = error?.form && <p className="field-error" role="alert" data-testid="stk-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>;
  return (
    <section aria-labelledby="stk-h" data-testid="stakeholders">
      {head}{errBox}{note && <p className="mdm-banner" role="status" data-testid="stk-note">{note}</p>}
      <Tabs tabs={['register', 'matrix']} active={tab} onChange={setTab} label={t('stk.title')} />
      {tab === 'register' && (
        <div data-testid="stk-register">
          <div className="actions-row no-print">
            {d.can.manage && <button type="button" className="btn btn-primary" onClick={() => setOpen(open === 's' ? null : 's')} data-testid="stk-add">{t('stk.add')}</button>}
            {d.can.export && <button type="button" className="btn" onClick={() => downloadFile(`/stakeholders/export?projectId=${projectId}&format=xlsx`, 'stakeholders.xlsx')} data-testid="stk-xlsx">{t('bl.xlsx')}</button>}
          </div>
          {open === 's' && (
            <form className="mdm-panel" aria-label={t('stk.add')} data-testid="stk-form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => tm.addStakeholder({ projectId, ...s, roleTitle: s.roleTitle || null, email: s.email || null, phone: s.phone || null }), t('stk.added'))) { setOpen(null); setS({ ...s, organisation: '', name: '', roleTitle: '', email: '', phone: '' }); } }}>
              <h2>{t('stk.add')}</h2>
              <div className="form-grid">
                <Field label={t('f.type')} name="skind" error={error}><select value={s.skind} onChange={(e) => setS({ ...s, skind: e.target.value })} data-testid="stk-f-kind">{SKINDS.map((k) => <option key={k} value={k}>{t(`stk.kind.${k}`)}</option>)}</select></Field>
                <Field label={t('stk.organisation')} name="organisation" error={error}><input value={s.organisation} onChange={(e) => setS({ ...s, organisation: e.target.value })} required maxLength={200} data-testid="stk-f-org" /></Field>
                <Field label={t('f.name')} name="name" error={error}><input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} required maxLength={160} data-testid="stk-f-name" /></Field>
                <Field label={t('stk.roleTitle')} name="roleTitle" error={error}><input value={s.roleTitle} onChange={(e) => setS({ ...s, roleTitle: e.target.value })} maxLength={120} /></Field>
                <Field label={t('stk.influence')} name="influence" error={error}><select value={s.influence} onChange={(e) => setS({ ...s, influence: e.target.value })} data-testid="stk-f-influence">{LV.map((k) => <option key={k} value={k}>{t(`stk.level.${k}`)}</option>)}</select></Field>
                <Field label={t('stk.interest')} name="interest" error={error}><select value={s.interest} onChange={(e) => setS({ ...s, interest: e.target.value })} data-testid="stk-f-interest">{LV.map((k) => <option key={k} value={k}>{t(`stk.level.${k}`)}</option>)}</select></Field>
                <Field label={t('stk.email')} name="email" error={error}><input type="email" value={s.email} onChange={(e) => setS({ ...s, email: e.target.value })} maxLength={160} data-testid="stk-f-email" /></Field>
                <Field label={t('stk.phone')} name="phone" error={error}><input value={s.phone} onChange={(e) => setS({ ...s, phone: e.target.value })} maxLength={30} /></Field>
              </div>
              <div className="actions"><button type="button" className="btn" onClick={() => setOpen(null)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="stk-save">{t('bl.save')}</button></div>
            </form>
          )}
          {d.rows.length === 0 ? <div className="mdm-banner" data-testid="stk-empty"><strong>{t('stk.emptyTitle')}</strong> {t('stk.emptyText')}</div> : (
            <div className="table-wrap"><table className="data-table"><caption className="sr-only">{t('stk.title')}</caption>
              <thead><tr><th scope="col">{t('f.type')}</th><th scope="col">{t('stk.organisation')}</th><th scope="col">{t('f.name')}</th><th scope="col">{t('stk.influence')}</th><th scope="col">{t('stk.interest')}</th><th scope="col">{t('stk.engage')}</th><th scope="col">{t('stk.email')}</th><th scope="col">{t('stk.phone')}</th><th scope="col" className="no-print">{t('wbs.actions')}</th></tr></thead>
              <tbody>{d.rows.map((r) => (
                <tr key={r.id} data-testid="stk-row" data-name={r.name} className={r.status === 'INACTIVE' ? 'muted' : ''}>
                  <td>{r.kindLabel}</td><td>{r.organisation}</td><td>{r.name}{r.roleTitle ? <span className="muted small"> · {r.roleTitle}</span> : null}{r.status === 'INACTIVE' ? ` · ${t('wbs.inactive')}` : ''}</td><td>{r.influenceLabel}</td><td>{r.interestLabel}</td><td><StatusBadge status={r.quadrant === 'MANAGE_CLOSELY' ? 'REJECTED' : r.quadrant === 'MONITOR' ? 'DRAFT' : 'IN_REVIEW'} label={t(`stk.quad.${r.quadrant}`)} /></td>
                  <td data-testid="stk-email">{r.contactVisible ? (r.email ?? '—') : t('stk.hidden')}</td><td>{r.contactVisible ? (r.phone ?? '—') : t('stk.hidden')}</td>
                  <td className="no-print">{d.can.manage && <><button type="button" className="btn" onClick={() => run(() => tm.updateStakeholder(r.id, { status: r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', version: r.rowVersion }))}>{r.status === 'ACTIVE' ? t('wbs.deactivate') : t('wbs.activate')}</button><button type="button" className="btn" onClick={() => { if (window.confirm(t('wbs.confirmDelete', { code: r.name }))) run(() => tm.removeStakeholder(r.id), t('stk.deleted')); }}>{t('act.delete')}</button></>}</td>
                </tr>))}</tbody></table></div>
          )}
        </div>
      )}
      {tab === 'matrix' && (
        <div data-testid="comm-matrix">
          <p className="muted small">{t('comm.intro')}</p>
          <ul className="op-figures">{m.byFrequency.filter((x) => x.count).map((x) => <li key={x.frequency}>{t(`comm.freq.${x.frequency}`)}: <strong>{x.count}</strong></li>)}</ul>
          <div className="actions-row no-print">
            {m.can.manage && <button type="button" className="btn btn-primary" onClick={() => setOpen(open === 'c' ? null : 'c')} data-testid="comm-add">{t('comm.add')}</button>}
            {m.can.export && <button type="button" className="btn" onClick={() => downloadFile(`/comm-matrix/export?projectId=${projectId}&format=xlsx`, 'communication-matrix.xlsx')}>{t('bl.xlsx')}</button>}
          </div>
          {open === 'c' && (
            <form className="mdm-panel" aria-label={t('comm.add')} data-testid="comm-form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => tm.addComm({ projectId, info: c.info.trim(), stakeholderId: c.stakeholderId ? Number(c.stakeholderId) : null, audience: c.audience.trim() || null, frequency: c.frequency, channel: c.channel, ownerUser: c.ownerUser || null }), t('comm.added'))) { setOpen(null); setC({ ...c, info: '', audience: '' }); } }}>
              <h2>{t('comm.add')}</h2>
              <div className="form-grid">
                <Field label={t('comm.info')} name="info" error={error}><input value={c.info} onChange={(e) => setC({ ...c, info: e.target.value })} required maxLength={300} data-testid="comm-f-info" /></Field>
                <Field label={t('comm.stakeholder')} name="stakeholderId" error={error}><select value={c.stakeholderId} onChange={(e) => setC({ ...c, stakeholderId: e.target.value })} data-testid="comm-f-stakeholder"><option value="">—</option>{d.rows.filter((r) => r.status === 'ACTIVE').map((r) => <option key={r.id} value={r.id}>{r.name} · {r.organisation}</option>)}</select></Field>
                <Field label={t('comm.audience')} name="audience" error={error}><input value={c.audience} onChange={(e) => setC({ ...c, audience: e.target.value })} maxLength={160} /></Field>
                <Field label={t('comm.frequency')} name="frequency" error={error}><select value={c.frequency} onChange={(e) => setC({ ...c, frequency: e.target.value })} data-testid="comm-f-frequency">{FREQS.map((k) => <option key={k} value={k}>{t(`comm.freq.${k}`)}</option>)}</select></Field>
                <Field label={t('comm.channel')} name="channel" error={error}><select value={c.channel} onChange={(e) => setC({ ...c, channel: e.target.value })}>{CHANNELS.map((k) => <option key={k} value={k}>{t(`comm.chan.${k}`)}</option>)}</select></Field>
                <LookupField id="comm-owner" label={t('comm.owner')} lookup="proj/people" valueKey="code" value={c.ownerUser} onChange={(v) => setC({ ...c, ownerUser: v })} />
              </div>
              <div className="actions"><button type="button" className="btn" onClick={() => setOpen(null)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="comm-save">{t('bl.save')}</button></div>
            </form>
          )}
          {m.rows.length === 0 ? <div className="mdm-banner" data-testid="comm-empty"><strong>{t('comm.emptyTitle')}</strong> {t('comm.emptyText')}</div> : (
            <div className="table-wrap"><table className="data-table"><caption className="sr-only">{t('comm.title')}</caption>
              <thead><tr><th scope="col">{t('comm.info')}</th><th scope="col">{t('comm.to')}</th><th scope="col">{t('comm.frequency')}</th><th scope="col">{t('comm.channel')}</th><th scope="col">{t('comm.owner')}</th><th scope="col" className="no-print" /></tr></thead>
              <tbody>{m.rows.map((r) => <tr key={r.id} data-testid="comm-row"><td>{r.info}</td><td>{r.audience ?? '—'}</td><td>{r.frequencyLabel}</td><td>{r.channelLabel}</td><td>{r.ownerUser ?? '—'}</td><td className="no-print">{m.can.manage && <button type="button" className="btn" onClick={() => run(() => tm.removeComm(r.id), t('stk.deleted'))}>{t('act.delete')}</button>}</td></tr>)}</tbody></table></div>
          )}
        </div>
      )}
      <p className="small"><Link to={`/proj/team?projectId=${projectId}`}>{t('team.title')}</Link> · <Link to="/proj/meetings">{t('mtg.listTitle')}</Link></p>
    </section>
  );
}

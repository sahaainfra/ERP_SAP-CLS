import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { PURPOSES, dayIST, eg } from './api.js';
import { ProjectSelect, useSearch } from './parts.jsx';

// Transmittals (part 11.01, FR-03): outgoing and incoming; a new one picks its drawings from the register (the current revision of each).
export default function TransmittalsPage() {
  const t = useT('engg');
  usePageTitle(t('tx.listTitle'));
  const qc = useQueryClient();
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const params = useSearch(); const fp = Number(params.get('projectId')) || null;
  const [open, setOpen] = useState(false); const [error, setError] = useState(null);
  const [f, setF] = useState({ projectId: fp ?? '', direction: 'OUT', party: '', contact: '', purpose: 'FOR_APPROVAL', coverNote: '', dueOn: dayIST(14), picked: {} });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v, ...(k === 'projectId' ? { picked: {} } : {}) }));
  const dq = useQuery({ queryKey: ['engg', 'pick', f.projectId], queryFn: () => eg.drawings(f.projectId), enabled: open && Boolean(f.projectId), retry: false });
  const rows = (dq.data ?? []).filter((r) => r.currentRevisionId && (f.purpose !== 'FOR_CONSTRUCTION' || r.statusCode === 'IFC'));
  const ids = Object.keys(f.picked).filter((k) => f.picked[k]);
  const create = async (e) => {
    e.preventDefault(); setError(null);
    try {
      const items = rows.filter((r) => f.picked[r.id]).map((r) => ({ drawingId: r.id, revisionId: r.currentRevisionId, copies: 1 }));
      const r = await eg.createTransmittal({ projectId: Number(f.projectId), direction: f.direction, party: f.party.trim(), contact: f.contact.trim() || null, purpose: f.purpose, coverNote: f.coverNote.trim() || null, dueOn: f.dueOn || null, items });
      qc.invalidateQueries({ queryKey: ['engg'] }); navigateTo(`/engg/transmittal?id=${r.id}`);
    } catch (x) { setError(errorInfo(x)); }
  };
  return (
    <section aria-labelledby="tx-list-h" data-testid="eg-transmittals">
      <h1 id="tx-list-h" className="sr-only">{t('tx.listTitle')}</h1>
      <div className="actions-row no-print">
        {perms.includes('engg.transmittal.create') && <button type="button" className="btn btn-primary" onClick={() => setOpen(!open)} data-testid="tx-new">{t('tx.new')}</button>}
      </div>
      {open && (
        <form className="mdm-panel" aria-label={t('tx.new')} data-testid="tx-new-form" onSubmit={create}>
          <h2>{t('tx.new')}</h2>
          <div className="form-grid">
            <ProjectSelect value={f.projectId} onChange={(v) => set('projectId', v)} required testId="tx-f-project" error={error} />
            <Field label={t('tx.direction')} name="direction" error={error}><select value={f.direction} onChange={(e) => set('direction', e.target.value)} data-testid="tx-f-direction"><option value="OUT">{t('dir.OUT')}</option><option value="IN">{t('dir.IN')}</option></select></Field>
            <Field label={t('tx.party')} name="party" error={error}><input value={f.party} onChange={(e) => set('party', e.target.value)} required maxLength={160} data-testid="tx-f-party" /></Field>
            <Field label={t('tx.contact')} name="contact" error={error}><input value={f.contact} onChange={(e) => set('contact', e.target.value)} maxLength={160} /></Field>
            <Field label={t('tx.purpose')} name="purpose" error={error}><select value={f.purpose} onChange={(e) => set('purpose', e.target.value)} data-testid="tx-f-purpose">{PURPOSES.filter((p) => f.direction === 'OUT' || p !== 'FOR_CONSTRUCTION').map((p) => <option key={p} value={p}>{t(`purpose.${p}`)}</option>)}</select></Field>
            <Field label={t('tx.due')} name="dueOn" error={error}><input type="date" value={f.dueOn} onChange={(e) => set('dueOn', e.target.value)} data-testid="tx-f-due" /></Field>
            <Field label={t('tx.cover')} name="coverNote" error={error}><textarea value={f.coverNote} onChange={(e) => set('coverNote', e.target.value)} rows={2} maxLength={2000} data-testid="tx-f-cover" /></Field>
          </div>
          <fieldset data-testid="tx-pick"><legend>{t('tx.pick')}</legend>
            {!f.projectId ? <p className="muted">{t('f.chooseProject')}</p> : rows.length === 0 ? <p className="muted">{t('tx.nothingToPick')}</p> : (
              <ul style={{ listStyle: 'none', padding: 0 }}>{rows.map((r) => <li key={r.id}><label><input type="checkbox" checked={Boolean(f.picked[r.id])} onChange={(e) => setF((x) => ({ ...x, picked: { ...x.picked, [r.id]: e.target.checked } }))} data-testid={`tx-pick-${r.drawingNo}`} /> {r.drawingNo} · {r.title} · {t('f.revision')} {r.revision} {r.statusCode}</label></li>)}</ul>
            )}
          </fieldset>
          {error?.form && <p className="field-error" role="alert" data-testid="tx-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setOpen(false)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={!f.projectId || f.party.trim().length < 2 || ids.length === 0} data-testid="tx-create">{t('tx.create')}</button></div>
        </form>
      )}
      <ListReport listCode="engg.transmittals" endpoint="/engg/transmittals" title={t('tx.listTitle')} session={session.data} rowHref={(r) => `/engg/transmittal?id=${r.id}`} onOpen={(r) => navigateTo(`/engg/transmittal?id=${r.id}`)} cardFields={['docNo', 'party', 'purpose', 'statusLabel']} statusKey="statusLabel"
        empty={{ title: t('tx.emptyTitle'), text: t('tx.emptyBody') }} contextFilters={fp ? [{ key: 'projectId', op: 'eq', value: String(fp) }] : []} />
    </section>
  );
}

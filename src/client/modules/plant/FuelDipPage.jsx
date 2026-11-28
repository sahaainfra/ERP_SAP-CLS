import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { OfflineNotice, PhotoButton, filePhoto, useOnline } from '../inv/GateParts.jsx';
import { fmtQty, fu } from './api.js';
import { useRunner } from './PlantParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Tank dip entry (part 17.04, FR-02, FR-03, mobile): the dip reading of a tank at the end of the day. The server sets it against the book (opening + receipts - issues) and says at once whether the difference is within the tolerance; a dip is also the starting point of the next day.
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export default function FuelDipPage() {
  const t = useT('plant'); usePageTitle(t('f.dipTitle')); const online = useOnline(); const [f, setF] = useState({ tankId: '', dipDate: today(), dipLitres: '', note: '' }); const [res, setRes] = useState(null); const { error, run, busy, note: ok } = useRunner(); const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const oq = useQuery({ queryKey: ['plant', 'fuel-options'], queryFn: fu.options, retry: false });
  if (oq.error?.status === 403) return <NoPermission what={t('f.dipTitle')} permission="plant.fuel.dip" />; if (oq.isPending) return <Skeleton label={t('f.dipTitle')} rows={3} />; if (oq.isError) return <ErrorState error={oq.error} onRetry={oq.refetch} />;
  const tanks = oq.data.tanks.filter((x) => x.type !== 'CARD'); const save = async () => { const d = await run(() => fu.dip({ tankId: Number(f.tankId), dipDate: f.dipDate, dipLitres: Number(f.dipLitres), note: f.note || null }), t('f.dipSaved')); if (d) setRes(d); };
  const photo = (file) => run(async () => { const up = await filePhoto(file, 'plt_fuel_dips', res.id); return fu.dipFile(res.id, up.id); }, t('f.photoAdded')).then((d) => d && setRes(d));
  return (
    <section aria-labelledby="fd-h" data-testid="plant-fuel-dip"><PageHeader id="fd-h" title={t('f.dipTitle')} subtitle={<>{t('f.dipIntro')} <Link to="/plant/fuel-reports">{t('f.reportsTitle')}</Link></>} />
      <OfflineNotice t={() => t('f.offline')} on={online} />{error?.form && <p className="field-error" role="alert" data-testid="fd-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{ok && <p className="mdm-banner" role="status" data-testid="fd-note">{ok}</p>}
      <div className="mdm-panel"><Field label={t('f.tank')} name="tankId" error={error}><select value={f.tankId} onChange={(ev) => set('tankId', ev.target.value)} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="fd-tank"><option value="">—</option>{tanks.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></Field>
        <div className="form-grid"><Field label={t('date')} name="dipDate" error={error}><input type="date" max={today()} value={f.dipDate} onChange={(ev) => set('dipDate', ev.target.value)} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="fd-date" /></Field>
          <Field label={t('f.dipLitres')} name="dipLitres" error={error}><input type="number" inputMode="decimal" step="any" min="0" value={f.dipLitres} onChange={(ev) => set('dipLitres', ev.target.value)} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="fd-litres" /></Field></div>
        <Field label={t('comment')} name="note" error={error}><input value={f.note} onChange={(ev) => set('note', ev.target.value)} maxLength={300} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="fd-note-in" /></Field>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 56 }} disabled={busy || !online || !f.tankId || f.dipLitres === ''} onClick={save} data-testid="fd-save">{t('f.saveDip')}</button></div></div>
      {res && <div className="mdm-panel" data-testid="fd-result" data-within={res.within ? 'yes' : 'no'}><h2>{res.tank} · {res.date}</h2>
        <dl className="kv"><div><dt>{t('f.opening')}</dt><dd>{fmtQty(res.opening)}</dd></div><div><dt>{t('f.receipts')}</dt><dd>{fmtQty(res.receipts)}</dd></div><div><dt>{t('f.issues')}</dt><dd>{fmtQty(res.issues)}</dd></div><div><dt>{t('f.book')}</dt><dd>{fmtQty(res.book)}</dd></div><div><dt>{t('f.dipLitres')}</dt><dd>{fmtQty(res.dipLitres)}</dd></div><div><dt>{t('f.variance')}</dt><dd data-testid="fd-variance">{fmtQty(res.variance)}</dd></div></dl>
        <p className={res.within ? 'muted' : 'field-error'} role={res.within ? undefined : 'alert'} data-testid="fd-verdict">{res.within ? t('f.withinTolerance', { n: fmtQty(res.tolerance) }) : t('f.outOfTolerance', { n: fmtQty(res.tolerance) })}</p>
        <p><PhotoButton label={t('f.dipPhoto')} onPick={photo} testId="fd-photo" done={Boolean(res.photoFileId)} /></p></div>}
    </section>
  );
}

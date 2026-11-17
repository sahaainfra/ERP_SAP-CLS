import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { DISCIPLINES, eg } from './api.js';
import { FileView, ProjectSelect } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Current Drawings for my site (part 11.01, FR-04, BR-01): only the current issued-for-construction revision of each drawing, with my controlled copy to acknowledge. The last list is kept on the phone so it can be read with no connection;
// the drawing files themselves are opened while there is a connection.
const CACHE = 'erp.engg.site.v1';
const readCache = () => { try { return JSON.parse(localStorage.getItem(CACHE) ?? 'null'); } catch { return null; } };
const writeCache = (v) => { try { localStorage.setItem(CACHE, JSON.stringify(v)); } catch { /* the list is still shown */ } };
export default function SiteDrawingsPage() {
  const t = useT('engg');
  usePageTitle(t('site.title'));
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState(''); const [discipline, setDiscipline] = useState(''); const [error, setError] = useState(null); const [open, setOpen] = useState(null);
  const qs = `?${[projectId && `projectId=${projectId}`, discipline && `discipline=${discipline}`].filter(Boolean).join('&')}`;
  const q = useQuery({ queryKey: ['engg', 'site', projectId, discipline], queryFn: () => eg.site(qs === '?' ? '' : qs), retry: false });
  useEffect(() => { if (q.data && !projectId && !discipline) writeCache({ at: new Date().toISOString(), rows: q.data }); }, [q.data, projectId, discipline]);
  if (q.error?.status === 403) return <NoPermission what={t('site.title')} permission="engg.drawing.view" />;
  const cached = q.isError && !q.error?.status ? readCache() : null;
  if (q.isError && !cached) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const rows = q.data ?? cached?.rows ?? [];
  const ack = async (copyId) => { setError(null); try { await eg.ack(copyId); qc.invalidateQueries({ queryKey: ['engg'] }); } catch (e) { setError(errorInfo(e)); } };
  return (
    <section aria-labelledby="site-h" data-testid="eg-site">
      <PageHeader id="site-h" title={t('site.title')} subtitle={t('site.rule')} />
      {cached && <p className="mdm-banner" role="status" data-testid="site-cached">{t('site.cached', { at: String(cached.at).slice(0, 16).replace('T', ' ') })}</p>}
      <div className="form-grid no-print">
        <ProjectSelect value={projectId} onChange={setProjectId} allowAll testId="site-project" />
        <Field label={t('col.discipline')} name="discipline"><select value={discipline} onChange={(e) => setDiscipline(e.target.value)} data-testid="site-discipline"><option value="">{t('f.all')}</option>{DISCIPLINES.map((k) => <option key={k} value={k}>{t(`disc.${k}`)}</option>)}</select></Field>
      </div>
      {error?.form && <p className="field-error" role="alert" data-testid="site-error">{error.form}</p>}
      {q.isPending ? <Skeleton label={t('site.title')} rows={4} /> : rows.length === 0 ? <EmptyState title={t('site.emptyTitle')} text={t('site.emptyBody')} /> : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.75rem' }} data-testid="site-list">
          {rows.map((r) => (
            <li key={r.drawingId} className="mdm-panel" data-testid={`site-${r.drawingNo}`} data-revision={r.revision} data-copy={r.copyStatus ?? ''}>
              <h2 style={{ fontSize: '1.05rem' }}>{r.drawingNo} · {r.title} <StatusBadge status="APPROVED" label={`${t('site.rev')} ${r.revision} · ${t(`code.${r.statusCode}`)}`} /></h2>
              <p className="muted">{r.project} · {r.discipline}{r.issuedOn ? ` · ${t('rev.issuedOn')} ${r.issuedOn}` : ''}</p>
              {r.changeNote && <p>{r.changeNote}</p>}
              <p data-testid={`site-copy-${r.drawingNo}`}>{r.copyStatusLabel}</p>
              <div className="actions-row">
                {r.copyId && !r.acknowledged && <button type="button" className="btn btn-primary" onClick={() => ack(r.copyId)} data-testid={`site-ack-${r.drawingNo}`}>{t('site.ack')}</button>}
                {r.file && <button type="button" className="btn" onClick={() => setOpen(open === r.drawingId ? null : r.drawingId)} data-testid={`site-open-${r.drawingNo}`}>{open === r.drawingId ? t('act.close') : t('site.open')}</button>}
              </div>
              {open === r.drawingId && <FileView file={r.file} testId={`site-file-${r.drawingNo}`} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

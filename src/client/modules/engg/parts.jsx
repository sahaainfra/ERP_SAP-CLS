import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { Field } from '../core/pages/ui.jsx';
import { eg } from './api.js';

/** The query of the address, followed when the page moves to another record of the same route. */
export function useSearch() {
  const [search, setSearch] = useState(window.location.search);
  useEffect(() => { const on = () => setSearch(window.location.search); window.addEventListener('popstate', on); return () => window.removeEventListener('popstate', on); }, []);
  return new URLSearchParams(search);
}
/** The project chooser: the projects with a project master whose drawings the person may see. */
export function ProjectSelect({ value, onChange, testId = 'eg-project', required = false, allowAll = false, error = null }) {
  const t = useT('engg');
  const q = useQuery({ queryKey: ['engg', 'projects'], queryFn: eg.projects, retry: false });
  return (
    <Field label={t('f.project')} name="projectId" error={error}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={required} data-testid={testId}>
        <option value="">{allowAll ? t('f.allProjects') : t('f.chooseProject')}</option>
        {(q.data ?? []).map((p) => <option key={p.projectId} value={p.projectId}>{p.code} · {p.name}</option>)}
      </select>
    </Field>
  );
}
/** A file of a revision, shown for the viewer: an image inline, anything else as a link; the link is the signed one of the file service. */
export function FileView({ file, testId }) {
  const t = useT('engg');
  const q = useQuery({ queryKey: ['engg', 'file', file?.id], queryFn: () => eg.fileUrl(file.id), enabled: Boolean(file?.id), retry: false, staleTime: 60_000 });
  if (!file) return <p className="muted" data-testid={`${testId}-none`}>{t('rev.noFile')}</p>;
  if (q.isError) return <p className="field-error" role="alert">{t('rev.fileError')}</p>;
  const url = q.data?.url;
  return (
    <figure data-testid={testId} className="eg-file">
      {url && /^image\//.test(file.mime ?? '') ? <img src={url} alt={file.name} style={{ maxWidth: '100%', maxHeight: '22rem', objectFit: 'contain' }} /> : null}
      <figcaption>{url ? <a href={url} target="_blank" rel="noreferrer">{file.name}</a> : file.name}</figcaption>
    </figure>
  );
}

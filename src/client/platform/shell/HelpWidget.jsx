import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/index.js';
import { useT } from '../i18n/index.js';
import { navigateTo } from '../../modules/core/pages/ui.jsx';

// Part 29.08 FR-03 FR-04: the help of every page. A "Help" button opens the articles linked to the page, the tour for the person's roles,
// the current announcements and the latest release, and "Raise a ticket", which carries the page and the last failed call to the form.
// It shows only where the help desk is on for the company and the person may raise tickets (the context call answers enabled: false otherwise).
export default function HelpWidget({ path }) {
  const t = useT('hd');
  const route = path.split('?')[0];
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(-1);
  const q = useQuery({ queryKey: ['hd', 'context', route], queryFn: async () => (await api.get(`/admin/help/context?route=${encodeURIComponent(route)}`)).data, retry: false, staleTime: 60_000 });
  const seen = useMutation({ mutationFn: (id) => api.post(`/admin/help/tours/${id}/seen`, {}, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } }) });
  if (!q.data?.enabled || route.startsWith('/help')) return null;
  const d = q.data;
  const tour = d.tour;
  const raise = () => { setOpen(false); navigateTo(`/help?tab=raise&from=${encodeURIComponent(path)}&title=${encodeURIComponent(document.title)}`); };
  return <>
    {d.announcements.length > 0 && !open && <div className="hd-announce" role="status" data-testid="hd-announcement"><strong>{d.announcements[0].title}</strong> {d.announcements[0].body}</div>}
    <button type="button" className="hd-fab btn btn-primary" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)} data-testid="hd-fab">{t('help')}</button>
    {open && <div className="hd-panel" role="dialog" aria-label={t('helpTitle')} data-testid="hd-panel">
      <div className="actions-row"><strong>{t('helpTitle')}</strong><button type="button" className="btn" onClick={() => setOpen(false)} aria-label={t('close')}>×</button></div>
      {tour && <button type="button" className="btn" onClick={() => { setStep(0); setOpen(false); }} data-testid="hd-tour">{tour.title}{d.tourSeen ? '' : ` · ${t('newTour')}`}</button>}
      <h3 className="hd-h">{t('onThisPage')}</h3>
      {!d.articles.length ? <p className="muted small">{t('noArticles')}</p> : <ul className="hd-links">{d.articles.map((a) => <li key={a.id}><a href={`/help?tab=kb&article=${a.id}`} onClick={(e) => { e.preventDefault(); setOpen(false); navigateTo(`/help?tab=kb&article=${a.id}`); }}>{a.title}</a></li>)}</ul>}
      {d.release && <p className="small muted">{t('latestRelease', { v: d.release.version })} <a href="/help?tab=releases" onClick={(e) => { e.preventDefault(); setOpen(false); navigateTo('/help?tab=releases'); }}>{t('whatsNew')}</a></p>}
      <button type="button" className="btn btn-primary hd-raise" onClick={raise} data-testid="hd-raise">{t('raise')}</button>
    </div>}
    {tour && step >= 0 && step < tour.steps.length && <div className="hd-tour" role="dialog" aria-label={tour.title} data-testid="hd-tour-step">
      <p className="small muted">{t('stepOf', { n: step + 1, of: tour.steps.length })}</p>
      <strong>{tour.steps[step].title}</strong><p>{tour.steps[step].body}</p>
      <div className="actions-row">
        <button type="button" className="btn" onClick={() => { setStep(-1); seen.mutate(tour.id); }}>{t('skip')}</button>
        <button type="button" className="btn btn-primary" onClick={() => { if (step + 1 >= tour.steps.length) { setStep(-1); seen.mutate(tour.id); } else setStep(step + 1); }}>{step + 1 >= tour.steps.length ? t('done') : t('next')}</button>
      </div>
    </div>}
  </>;
}

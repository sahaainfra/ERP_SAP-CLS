import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { INFLUENCE_ROLES, STANCES, bd, inr, inrShort } from './api.js';
import { InteractionsPanel, Tabs } from './parts.jsx';

// Client 360 (business development, part 08.01, FR-02): the client from the partner master with its opportunities and leads (those the person may see), the contacts with the influence map (who decides, who is for and against us, who reports to whom),
// the interactions of every lead and opportunity of the client, and the places where tenders, projects and receivables will appear when those parts exist.
const blank = { name: '', designation: '', email: '', mobile: '', influenceRole: 'INFLUENCER', influenceLevel: 3, stance: 'NEUTRAL', reportsToId: '' };
export default function ClientPage() {
  const t = useT('bd');
  const qc = useQueryClient();
  const id = Number(new URLSearchParams(window.location.search).get('id')) || null;
  const q = useQuery({ queryKey: ['bd', 'client', id], queryFn: () => bd.client(id), enabled: Boolean(id), retry: false });
  const [tab, setTab] = useState('overview'); const [v, setV] = useState(blank); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const c = q.data;
  usePageTitle(c ? c.legalName : t('client.title'));
  if (!id) return <ErrorState error={new Error(t('client.noId'))} />;
  if (q.error?.status === 403) return <NoPermission what={t('client.title')} permission="bd.client.view" />;
  if (q.isPending) return <Skeleton label={t('client.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); setNote(done); qc.invalidateQueries({ queryKey: ['bd'] }); return true; } catch (e) { setError(errorInfo(e)); return false; } };
  const add = async (e) => { e.preventDefault(); if (await run(() => bd.addContact(id, { name: v.name.trim(), designation: v.designation.trim() || null, email: v.email.trim() || null, mobile: v.mobile.trim() || null, influenceRole: v.influenceRole, influenceLevel: Number(v.influenceLevel), stance: v.stance, reportsToId: v.reportsToId ? Number(v.reportsToId) : null }), t('contact.added'))) setV(blank); };
  return (
    <section aria-labelledby="c360-title" data-testid="client360">
      <header>
        <h1 id="c360-title">{c.legalName} <StatusBadge status={c.status === 'ACTIVE' ? 'ACTIVE' : 'IN_REVIEW'} label={c.statusLabel} /></h1>
        <p className="muted">{c.code}{c.tradeName ? ` · ${c.tradeName}` : ''} · <Link to={c.partnerRoute}>{t('client.partnerRecord')}</Link></p>
        <dl className="op-figures" data-testid="c360-figures"><div><dt>{t('dash.open')}</dt><dd data-testid="c360-open">{c.stats.open}</dd></div><div><dt>{t('dash.pipeline')}</dt><dd>{inrShort(c.stats.pipeline)}</dd></div><div><dt>{t('dash.weighted')}</dt><dd>{inrShort(c.stats.weighted)}</dd></div><div><dt>{t('client.won')}</dt><dd>{c.stats.won} · {inrShort(c.stats.wonValue)}</dd></div><div><dt>{t('client.lost')}</dt><dd>{c.stats.lost}</dd></div></dl>
        {error?.form && <p className="field-error" role="alert" data-testid="c360-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="c360-note">{note}</p>}
      </header>
      <Tabs tabs={['overview', 'contacts', 'interactions', 'related']} active={tab} onChange={setTab} label={t('client.title')} />
      {tab === 'overview' && (
        <div>
          <h2>{t('client.opportunities')}</h2>
          {c.opportunities.length === 0 ? <p className="muted">{t('client.noOpps')}</p> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t('client.opportunities')}>
              <table className="grid" data-testid="c360-opps"><thead><tr><th>{t('opp.title')}</th><th>{t('opp.stage')}</th><th>{t('lead.estValue')}</th><th>{t('opp.probability')}</th><th>{t('opp.weighted')}</th><th>{t('lead.owner')}</th></tr></thead>
                <tbody>{c.opportunities.map((o) => <tr key={o.id} data-testid="c360-opp"><th scope="row" data-label={t('opp.title')}><Link to={`/bd/opportunity?id=${o.id}`}>{o.name}</Link> <span className="muted small">{o.docNo}</span></th><td data-label={t('opp.stage')}>{o.stageLabel}</td><td data-label={t('lead.estValue')}>{inr(o.estValue)}</td><td data-label={t('opp.probability')}>{o.probability}%</td><td data-label={t('opp.weighted')}>{inr(o.weighted)}</td><td data-label={t('lead.owner')}>{o.owner}</td></tr>)}</tbody></table>
            </div>)}
          <h2>{t('leads.title')}</h2>
          {c.leads.length === 0 ? <p className="muted">{t('client.noLeads')}</p> : <ul className="mdm-list" data-testid="c360-leads">{c.leads.map((l) => <li key={l.id}><Link to={`/bd/lead?id=${l.id}`}>{l.title}</Link> · {l.docNo} · {l.status} · {inr(l.estValue)}</li>)}</ul>}
        </div>)}
      {tab === 'contacts' && (
        <div data-testid="contacts">
          {c.map.warnings.length > 0 && <ul className="mdm-list" data-testid="map-warnings">{c.map.warnings.map((w) => <li key={w}><StatusBadge status="AT_RISK" label={w} /></li>)}</ul>}
          {c.contacts.length === 0 ? <p className="muted">{t('contact.none')}</p> : (
            <ul className="bd-map" aria-label={t('contact.map')} data-testid="map">{c.contacts.map((p) => (
              <li key={p.id} data-testid="contact" data-stance={p.stance}>
                <strong>{p.name}</strong> <span className="muted small">{p.designation}</span>
                <div>{t(`influence.${p.influenceRole}`)} · {t('contact.level', { n: p.influenceLevel })} · {t(`stance.${p.stance}`)}</div>
                {p.reportsToId && <div className="muted small">{t('contact.reportsTo', { name: c.contacts.find((x) => x.id === p.reportsToId)?.name ?? '—' })}</div>}
                <div className="muted small">{[p.mobile, p.email].filter(Boolean).join(' · ')}</div>
                {c.canManageContacts && (
                  <div className="actions no-print">
                    <select aria-label={`${t('contact.stance')} ${p.name}`} value={p.stance} onChange={(e) => run(() => bd.updateContact(p.id, { stance: e.target.value, version: p.rowVersion }), t('contact.updated'))} data-testid="contact-stance">{STANCES.map((k) => <option key={k} value={k}>{t(`stance.${k}`)}</option>)}</select>
                    <button type="button" className="btn btn-small" onClick={() => run(() => bd.removeContact(p.id), t('contact.removed'))} data-testid="contact-remove">{t('act.remove')}</button>
                  </div>)}
              </li>))}</ul>)}
          {c.canManageContacts && (
            <form className="mdm-panel mdm-fields no-print" onSubmit={add} data-testid="contact-form" aria-label={t('contact.add')}>
              <h2>{t('contact.add')}</h2>
              <Field label={t('contact.name')} name="name" error={error}><input value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} required data-testid="ct-name" /></Field>
              <Field label={t('contact.designation')} name="designation" error={error}><input value={v.designation} onChange={(e) => setV({ ...v, designation: e.target.value })} data-testid="ct-designation" /></Field>
              <Field label={t('lead.phone')} name="mobile" error={error}><input value={v.mobile} inputMode="tel" onChange={(e) => setV({ ...v, mobile: e.target.value })} data-testid="ct-mobile" /></Field>
              <Field label={t('lead.email')} name="email" error={error}><input value={v.email} type="email" onChange={(e) => setV({ ...v, email: e.target.value })} data-testid="ct-email" /></Field>
              <Field label={t('contact.role')} name="influenceRole" error={error}><select value={v.influenceRole} onChange={(e) => setV({ ...v, influenceRole: e.target.value })} data-testid="ct-role">{INFLUENCE_ROLES.map((k) => <option key={k} value={k}>{t(`influence.${k}`)}</option>)}</select></Field>
              <Field label={t('contact.levelLabel')} name="influenceLevel" error={error}><input type="number" min="1" max="5" value={v.influenceLevel} onChange={(e) => setV({ ...v, influenceLevel: e.target.value })} data-testid="ct-level" /></Field>
              <Field label={t('contact.stance')} name="stance" error={error}><select value={v.stance} onChange={(e) => setV({ ...v, stance: e.target.value })} data-testid="ct-stance">{STANCES.map((k) => <option key={k} value={k}>{t(`stance.${k}`)}</option>)}</select></Field>
              <Field label={t('contact.reportsToLabel')} name="reportsToId" error={error}><select value={v.reportsToId} onChange={(e) => setV({ ...v, reportsToId: e.target.value })} data-testid="ct-reports"><option value="">–</option>{c.contacts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <div className="actions"><button type="submit" className="btn btn-primary" data-testid="ct-save">{t('act.save')}</button></div>
            </form>)}
        </div>)}
      {tab === 'interactions' && <InteractionsPanel entity="CLIENT" entityId={id} canLog />}
      {tab === 'related' && (
        <ul className="mdm-list" data-testid="related">{c.later.map((l) => <li key={l.section}>{l.section}: <span className="muted">{t('client.comesWith', { part: l.part })}</span></li>)}</ul>)}
      <p className="small"><Link to="/bd/clients">{t('clients.title')}</Link></p>
    </section>
  );
}

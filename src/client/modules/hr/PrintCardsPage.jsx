import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { api } from '../../platform/api/index.js';
import { Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { lab } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Print Labour ID Cards (HR, part 07.08, FR-05): choose the workers (by contractor, or those named in the address), see them, and print a sheet of cards, each with the photo, name, code, trade, contractor and a QR code that
// holds the token of the card. The QR is read at the site kiosk, the gate and the PPE store. A lost card is reissued: the old token stops working. Cards are issued to approved, working workers only.
export default function PrintCardsPage() {
  usePageTitle('Print Labour ID Cards');
  const preset = (new URLSearchParams(window.location.search).get('ids') ?? '').split(',').map(Number).filter(Boolean);
  const [contractorId, setContractorId] = useState('');
  const [picked, setPicked] = useState(preset);
  const [reissue, setReissue] = useState(false);
  const [cards, setCards] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const list = useQuery({ queryKey: ['lab', 'cardlist', contractorId], queryFn: async () => (await api.get(`/hr/workers?pageSize=100&filter[status]=APPROVED&filter[workerStatus]=ACTIVE${contractorId ? `&filter[contractorId]=${contractorId}` : ''}`)).data, retry: false });
  if (list.error?.status === 403) return <NoPermission what="workers" permission="hr.worker.view" />;
  const rows = list.data ?? [];
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const make = async () => { setBusy(true); setError(null); try { setCards((await lab.workers.cards(picked, reissue)).cards); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="pc-title" data-testid="cards">
      <PageHeader id="pc-title" className="no-print" title={"Print Labour ID Cards"} />
      <div className="no-print">
        <LookupField id="pc-contractor" label="Contractor" lookup="mdm/labour-contractors" value={contractorId} onChange={setContractorId} />
        {error?.form && <p className="field-error" role="alert" data-testid="pc-error">{error.form}</p>}
        {list.isPending ? <Skeleton label="Loading the workers" rows={3} /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : rows.length === 0 ? <p className="muted" data-testid="pc-empty">No approved worker to print a card for.</p> : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Workers">
            <table className="grid" data-testid="pc-table"><thead><tr><th><span className="sr-only">Pick</span></th><th>Worker</th><th>Name</th><th>Trade</th><th>Contractor</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.id} data-testid="pc-row"><td data-label="Pick"><input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Pick ${r.workerCode}, ${r.name}`} data-testid="pc-pick" /></td><td data-label="Worker">{r.workerCode}</td><td data-label="Name">{r.name}</td><td data-label="Trade">{r.trade}</td><td data-label="Contractor">{r.contractor}</td></tr>)}</tbody></table>
          </div>
        )}
        <label className="check"><input type="checkbox" checked={reissue} onChange={(e) => setReissue(e.target.checked)} data-testid="pc-reissue" /> Reissue (a lost card: the old QR stops working)</label>
        <div className="actions"><button type="button" className="btn btn-primary" disabled={busy || !picked.length} onClick={make} data-testid="pc-make">{busy ? 'Making the cards...' : `Make ${picked.length || ''} card${picked.length === 1 ? '' : 's'}`}</button>{cards && <button type="button" className="btn" onClick={() => window.print()} data-testid="pc-print">Print</button>}</div>
      </div>
      {cards && (
        <div className="lab-cards" data-testid="pc-sheet">
          {cards.map((c) => (
            <article key={c.workerId} className="lab-card" data-testid="pc-card" aria-label={`Card of ${c.name}`}>
              <div className="lab-card-id"><strong>{c.name}</strong><span>{c.workerCode}</span><span>{c.trade.replace(/_/g, ' ').toLowerCase()} · {c.skill}</span><span>{c.contractor}</span><span className="muted small">{c.cleared ? 'Cleared for work' : 'Clearance pending'} · card {c.cardVersion}</span></div>
              <div className="lab-card-qr" dangerouslySetInnerHTML={{ __html: c.qrSvg }} />
            </article>))}
        </div>
      )}
      <p className="small no-print"><Link to="/labour/workers">Workers Register</Link></p>
    </section>
  );
}

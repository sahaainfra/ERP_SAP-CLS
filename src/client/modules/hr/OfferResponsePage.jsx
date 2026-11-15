import { useEffect, useState } from 'react';
import { recruit, rupees } from './api.js';
import PrejoiningForm from './PrejoiningForm.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// The offer, opened from the link the candidate received (part 07.02, FR-04, FR-05): no sign-in; the link is the proof. It shows the offer with the CTC breakup, takes the acceptance or the refusal, and after an
// acceptance the pre-joining details, which become the employee record. A link that has been used for a refusal, has lapsed or was replaced says so.
export default function OfferResponsePage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => { try { setInfo(await recruit.link(token)); setError(null); } catch (e) { setError(e.message ?? 'This link is not valid any more.'); } };
  useEffect(() => { document.title = 'Your offer'; load(); }, []);
  const answer = async (action) => { setBusy(true); try { setInfo(await recruit.respond(token, { action, comment: comment || undefined })); setError(null); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return (
    <main style={{ maxWidth: '44rem', margin: '2rem auto', padding: '0 1rem' }} data-testid="offer-response">
      <PageHeader title={"Your offer"} />
      {error && <p className="field-error" role="alert" data-testid="or-error">{error}</p>}
      {!info && !error && <p>Loading…</p>}
      {info && (
        <>
          <p>{info.company}</p>
          <p data-testid="or-summary">Dear {info.candidate}, we offer you the position of <strong>{info.designation}</strong>{info.grade ? ` (grade ${info.grade})` : ''}, joining on <strong>{info.dojProposed}</strong>, at <strong>{rupees(info.ctcAnnual)}</strong> a year.</p>
          <div className="table-wrap"><table className="grid"><thead><tr><th>Component</th><th className="num">Monthly (₹)</th><th className="num">Yearly (₹)</th></tr></thead><tbody>{info.breakup.lines?.map((l) => <tr key={l.code}><th scope="row">{l.label}</th><td className="num">{rupees(l.monthly)}</td><td className="num">{rupees(l.annual)}</td></tr>)}</tbody></table></div>
          <p className="muted">Open until {info.validUntil}. Offer {info.docNo}.</p>
          {info.response === 'NONE' && info.canRespond && (
            <div>
              <label htmlFor="or-comment">A note (optional)</label>
              <textarea id="or-comment" rows="2" value={comment} onChange={(e) => setComment(e.target.value)} />
              <div className="actions"><button type="button" className="btn" disabled={busy} onClick={() => answer('DECLINE')} data-testid="or-decline">Decline</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => answer('ACCEPT')} data-testid="or-accept">Accept the offer</button></div>
            </div>
          )}
          {info.response === 'EXPIRED' && <p role="status">This offer has lapsed. Ask the HR team for a new one.</p>}
          {info.response === 'DECLINED' && <p role="status" data-testid="or-declined">You declined this offer. Thank you for your time.</p>}
          {info.response === 'ACCEPTED' && <p className="mdm-banner" role="status" data-testid="or-accepted">You accepted this offer. Welcome.</p>}
          {info.canFillDetails && (info.detailsDone ? <p role="status" data-testid="or-details-done">Your joining details are in. You can change them below until you join.</p> : <p>Please give your joining details; they become your employee record.</p>)}
          {info.canFillDetails && <PrejoiningForm initialName={info.candidate} doneNote="Your joining details were saved. Thank you." onSave={async (b) => { await recruit.linkDetails(token, b); await load(); }} />}
        </>
      )}
    </main>
  );
}

import { useEffect, useState } from 'react';
import { confirmLink, decideLink, peekLink } from '../../platform/workflow/api.js';
import { formatDateTime, formatINR } from '../../platform/format.js';
import { Flags } from './Evidence.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// The page a secure approval link opens (part 04.03, FR-06, BR-03): outside the application shell and before anybody is signed in. It shows the document at a glance
// and two buttons. Above the threshold of the document type the person must be signed in as themselves; the page then asks them to do so and to open the link again.
export default function ApproveLinkPage() {
  const token = new URLSearchParams(window.location.search).get('t') ?? '';
  const [info, setInfo] = useState(null);
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('');
  const [comment, setComment] = useState('');
  const [rejecting, setRejecting] = useState(false);
  useEffect(() => {
    document.title = 'Approve - ERP';
    peekLink(token).then((d) => { setInfo(d); setState('ready'); }).catch((e) => { setState('gone'); setMessage(e.message); });
  }, [token]);
  const decide = async (action) => {
    setState('busy');
    try {
      if (info.reauthRequired) await confirmLink(token, { action, comment: comment || undefined });
      else await decideLink(token, { action, comment: comment || undefined });
      setState('done');
      setMessage(action === 'approve' ? 'Approved. Thank you.' : 'Rejected. The person who raised it has been told.');
    } catch (e) {
      if (e.code === 'REAUTH_REQUIRED' || e.status === 401) { setState('signin'); setMessage(e.message); } else { setState(e.status === 410 ? 'gone' : 'ready'); setMessage(e.message); }
    }
  };
  return (
    <main id="main" className="link-page" data-testid="approve-link">
      <PageHeader title={"Approval"} />
      {state === 'loading' && <p role="status">Checking the link...</p>}
      {state === 'gone' && <p role="alert" className="error" data-testid="link-gone">{message || 'This link has expired, was already used, or is not valid.'} <a href="/approvals">Open My Approvals</a></p>}
      {state === 'done' && <p role="status" className="notice" data-testid="link-done">{message}</p>}
      {state === 'signin' && <p role="alert" className="error" data-testid="link-signin">{message} <a href="/approvals">Sign in</a>, then open this link again.</p>}
      {info && ['ready', 'busy', 'signin'].includes(state) && (
        <>
          <p><strong>{info.docRef ?? info.title}</strong>: {info.docLabel}. {info.title}</p>
          <dl className="kv"><div><dt>Raised by</dt><dd>{info.submittedBy}</dd></div>{info.amount != null && <div><dt>Amount</dt><dd>{formatINR(info.amount)}</dd></div>}<div><dt>Step</dt><dd>{info.step}</dd></div><div><dt>The link works until</dt><dd>{formatDateTime(info.expiresAt)}</dd></div></dl>
          <Flags flags={info.flags} />
          {info.reauthRequired && <p className="notice" role="note">The amount is high, so you must be signed in as yourself to decide.</p>}
          {message && state === 'ready' && <p role="alert" className="error">{message}</p>}
          <label className="field"><span>{rejecting ? 'Why are you rejecting it? (needed)' : 'Comment (optional)'}</span><textarea rows={3} value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} /></label>
          <div className="mob-actions">
            <button type="button" className="btn btn-primary mob-btn" disabled={state === 'busy'} onClick={() => decide('approve')}>Approve</button>
            {!rejecting ? <button type="button" className="btn btn-danger mob-btn" onClick={() => setRejecting(true)}>Reject</button> : <button type="button" className="btn btn-danger mob-btn" disabled={state === 'busy' || comment.trim().length < 5} onClick={() => decide('reject')}>Reject now</button>}
          </div>
        </>
      )}
    </main>
  );
}

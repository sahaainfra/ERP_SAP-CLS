import { useEffect, useRef, useState } from 'react';
import { navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { ApiError } from '../../platform/api/index.js';
import { ConfirmDialog, ProgressDialog } from '../../platform/feedback/Dialogs.jsx';
import { Banner, useToast } from '../../platform/feedback/Feedback.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// The Object Page and feedback components, documented (part 03.04, section 7): how a record page is built, what the server gives it, and
// every feedback component working. The reference record is the sample material request.

const PROPS = [
  ['type, id', 'The record type the server registered (sample_request) and the record\'s id. The tabs fetch their own data with them.'],
  ['query', 'The query of GET /:id. The record carries allowedActions[], counts and (for approved records) the open approval.'],
  ['heading(r), subtitle(r), chips(r), figures(r), meta(r)', 'The header: number, a one-line title, status chips, key figures and the owner and dates line.'],
  ['renderDetails(r), renderLines(r)', 'The Details tab and the optional Lines tab. Attachments, Approvals, Timeline, Discussion and Related (and Amendments once a version exists) come from the component.'],
  ['attachmentEntity', 'The file service record type, so the Attachments tab can upload and list files.'],
  ['onAction(action, { reasonCode, reason })', 'Does the action once confirmed. The page decides what it calls; the component asks first and shows the result.'],
  ['onEdit(), onBack(), navigate(path)', 'Navigation the page owns.'],
];
const CONTRACT = [
  ['GET /api/v1/<module>/<records>/:id', '{ ...record, allowedActions: [{ id, label, kind, allowed, reason, confirm }], counts, approval }. Every action that applies to the status, each with whether this viewer may do it now and, if not, why (BR-01).'],
  ['GET /api/v1/ui/objects/:type/:id/approvals | timeline | comments | documents | related | versions | compare | print', 'The shared parts of a record, for any record type a module registers with platform/objects.'],
  ['POST /api/v1/ui/objects/:type/:id/comments', '{ body } with @username mentions; the people mentioned are named in the answer and in the event.'],
  ['GET /api/v1/ui/reason-codes?for=cancel|reject|return', 'The reason codes of an action; the confirmation dialog shows them and the server requires one (BR-02).'],
];

export default function ObjectPageDocsPage() {
  usePageTitle('Object Page');
  const toast = useToast();
  const [confirm, setConfirm] = useState(null);
  const [progress, setProgress] = useState(null);
  const [banner, setBanner] = useState(true);
  const [offline, setOffline] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearInterval(timer.current), []);
  const runProgress = () => {
    let v = 0;
    setProgress(0);
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      v += 0.1;
      if (v >= 1) { clearInterval(timer.current); setProgress(null); toast.success('The sample job finished.'); } else setProgress(v);
    }, 300);
  };
  const toggleOffline = () => {
    window.dispatchEvent(new Event(offline ? 'online' : 'offline'));
    setOffline(!offline);
  };
  const fakeError = new ApiError({ status: 500, code: 'INTERNAL', message: 'The server could not finish that request.', correlationId: '3f2c1a9e-7b44-4d51-9b58-0c2a6f1d9e10' });
  return (
    <section aria-labelledby="page-title" className="gallery">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Design System &rsaquo; Object Page</nav>
      <PageHeader id="page-title" title={"Object Page"} actions={<><button type="button" className="btn btn-primary" onClick={() => navigateTo('/admin/sample-requests')}>Open the reference record</button></>} subtitle={"Every record looks and behaves the same: a sticky header with the number, status chips and key figures; the buttons the server allows right now (a button that is off says why); and the tabs Details, Lines, Attachments, Approvals, Timeline, Discussion and Related, plus Amendments once the record has been submitted. A request in Sample Material Requests is the working example."} />

      <h2>Using it in a record page</h2>
      <pre className="doc-code" tabIndex={0}><code>{`import ObjectPage from '../../platform/object/ObjectPage.jsx';

<ObjectPage type="sample_request" id={id} query={useSampleRequest(id)} title="Request"
  heading={(r) => r.docNo} subtitle={(r) => r.title}
  chips={(r) => [{ status: r.status, label: 'Submitted' }]}
  figures={(r) => [{ label: 'Total (₹)', value: r.total }]} meta={(r) => [{ label: 'Requested by', value: r.requestedBy }]}
  renderDetails={(r) => <Details record={r} />} attachmentEntity="sample_request"
  onAction={(action, { reasonCode, reason }) => act(action.id, reasonCode, reason)} onEdit={edit} onBack={back} />`}</code></pre>
      <div className="table-wrap"><table><caption>Properties</caption><thead><tr><th scope="col">Property</th><th scope="col">What it does</th></tr></thead>
        <tbody>{PROPS.map(([p, w]) => <tr key={p}><td data-label="Property"><code>{p}</code></td><td data-label="What it does">{w}</td></tr>)}</tbody></table></div>
      <h2>What the server provides</h2>
      <div className="table-wrap"><table><caption>Contract</caption><thead><tr><th scope="col">Request</th><th scope="col">Rules</th></tr></thead>
        <tbody>{CONTRACT.map(([r, w]) => <tr key={r}><td data-label="Request"><code>{r}</code></td><td data-label="Rules">{w}</td></tr>)}</tbody></table></div>

      <h2>Feedback components</h2>
      <h3>Toasts</h3>
      <div className="toolbar" role="group" aria-label="Toasts">
        <button type="button" className="btn" onClick={() => toast.success('Saved. The request is a draft.')}>Success toast</button>
        <button type="button" className="btn" onClick={() => toast.info('Your export is being prepared.')}>Info toast</button>
        <button type="button" className="btn" onClick={() => toast.warning('This record changed while you were reading it.', { action: { label: 'Reload', onClick: () => toast.info('Reloaded.') } })}>Warning toast with an action</button>
        <button type="button" className="btn" onClick={() => toast.error('The request could not be saved (Correlation ID 3f2c1a9e).')}>Error toast (stays until closed)</button>
      </div>
      <h3>Banners</h3>
      {banner && <Banner tone="info" title="Information." onClose={() => setBanner(false)} testId="demo-banner">A banner sits inside the page, at the top of what it is about.</Banner>}
      <Banner tone="success" title="Done.">The period was closed.</Banner>
      <Banner tone="warning" title="Careful." action={{ label: 'Review', onClick: () => toast.info('Reviewing.') }}>Three requests are overdue.</Banner>
      <Banner tone="error" title="Failed.">The connector did not answer.</Banner>
      <h3>Dialogs</h3>
      <div className="toolbar" role="group" aria-label="Dialogs">
        <button type="button" className="btn" onClick={() => setConfirm('plain')}>Confirmation</button>
        <button type="button" className="btn btn-danger" onClick={() => setConfirm('reason')}>Confirmation with a reason code</button>
        <button type="button" className="btn" onClick={runProgress}>Progress dialog</button>
        <button type="button" className="btn" onClick={toggleOffline} aria-pressed={offline}>{offline ? 'Back online' : 'Show the offline banner'}</button>
      </div>
      <ConfirmDialog open={confirm === 'plain'} title="Close this period?" text="No more postings can be made to it. A reopen needs an approved request." confirmLabel="Close the period" onCancel={() => setConfirm(null)} onConfirm={async () => { setConfirm(null); toast.success('The period is closed.'); }} />
      <ConfirmDialog open={confirm === 'reason'} title="Cancel this request?" text="A cancelled request cannot be changed. If it has a number, it keeps it." confirmLabel="Cancel request" danger reasonFor="cancel" onCancel={() => setConfirm(null)} onConfirm={async (p) => { setConfirm(null); toast.success(`Cancelled with the reason ${p.reasonCode}.`); }} />
      <ProgressDialog open={progress !== null} title="Preparing the report" message="Collecting the figures of the month." value={progress} />

      <h3>Standard states</h3>
      <div className="gallery-states">
        <figure><figcaption>Loading</figcaption><Skeleton label="Loading the sample" rows={2} /></figure>
        <figure><figcaption>Empty</figcaption><EmptyState title="No requests yet" message="Start one to see the whole flow." action={{ label: 'New request', onClick: () => navigateTo('/admin/sample-requests?new=1') }} /></figure>
        <figure><figcaption>Error with its correlation ID</figcaption><ErrorState title="Could not load the requests" error={fakeError} onRetry={() => toast.info('Trying again...')} /></figure>
        <figure><figcaption>No permission</figcaption><NoPermission what="the audit trail" permission="core.audit.view" /></figure>
      </div>
    </section>
  );
}

import { useRef, useState } from 'react';
import { formatDate, formatDateTime, toCsv } from '../../../platform/format.js';
import { Field, FormDialog, Link, Pager, QueryState, can, downloadCsv, errorInfo, usePageTitle } from '../../core/pages/ui.jsx';
import { useCampaign, useCampaignItems, useCampaigns, useCancelCampaign, useCloseCampaign, useDecideReview, useMyReviewItems, useReassignReview, useStartCampaign } from '../api/privileged.js';
import { useOrgTree } from '../api/org.js';
import { useUsers } from '../api/users.js';
import { StatusChip } from '../components/privilegedCommon.jsx';

const SCOPES = [['PRIVILEGED', 'Privileged roles only'], ['ALL', 'Every role of everyone'], ['DEPARTMENT', 'One department']];
const flatten = (nodes) => nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);

function Progress({ c }) {
  const done = c.total - c.pending;
  return <><progress max={c.total || 1} value={done} aria-label={`${done} of ${c.total} decided`} /> <span>{done} of {c.total}</span></>;
}

/** One campaign: who must still decide, the lines, and the reassign and close actions. */
function CampaignDetail({ id, session, onClose, notify }) {
  const q = useCampaign(id);
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState('');
  const items = useCampaignItems(id, { page, pageSize: 50, sort: 'user', filters: { decision } });
  const users = useUsers({ pageSize: 200, sort: 'displayName' });
  const close = useCloseCampaign();
  const cancel = useCancelCampaign();
  const reassign = useReassignReview();
  const reassignDialog = useRef(null);
  const cancelDialog = useRef(null);
  const [target, setTarget] = useState(null);
  const [error, setError] = useState(null);
  const c = q.data;
  const manage = can(session, 'iam.review.manage');
  const rows = items.data?.data ?? [];
  return (
    <aside className="card" aria-labelledby="camp-title" data-testid="campaign-detail">
      <div className="page-head"><h2 id="camp-title">{c ? `${c.code} ${c.name}` : 'Campaign'}</h2><button type="button" className="btn btn-small" onClick={onClose}>Close panel</button></div>
      <QueryState query={q} what="the campaign" permission="iam.review.view" />
      {c && (
        <>
          <dl className="kv">
            <dt>Status</dt><dd><StatusChip status={c.status} />{c.overdue ? ' (overdue)' : ''}</dd>
            <dt>Due</dt><dd>{formatDate(c.dueDate)}</dd>
            <dt>Progress</dt><dd><Progress c={c} /> ({c.certified} certified, {c.revoked} to revoke)</dd>
            {c.closedAt && <><dt>Closed</dt><dd>{formatDateTime(c.closedAt)} by {c.closedBy}: {c.summary.applied} change(s) applied</dd></>}
          </dl>
          <h3>Reviewers</h3>
          <div className="table-wrap"><table><caption className="sr-only">Reviewers</caption>
            <thead><tr><th>Reviewer</th><th>Lines</th><th>Undecided</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{c.reviews.map((r) => (
              <tr key={r.id}><td data-label="Reviewer">{r.reviewerName} ({r.reviewer})</td><td data-label="Lines">{r.total}</td><td data-label="Undecided">{r.pending}</td><td data-label="Status"><StatusChip status={r.status} /></td>
                <td data-label="Actions">{manage && c.status === 'OPEN' && <button type="button" className="btn btn-small" aria-label={`Reassign the lines of ${r.reviewer}`} onClick={() => { setTarget(r); setError(null); reassignDialog.current?.showModal(); }}>Reassign</button>}</td></tr>
            ))}</tbody></table></div>
          {manage && c.status === 'OPEN' && (
            <div className="actions">
              <button type="button" className="btn btn-primary" disabled={close.isPending} onClick={async () => { try { await close.mutateAsync(id); notify(`Campaign ${c.code} was closed and the revokes were applied.`); } catch (err) { notify(errorInfo(err).form); } }}>Close the campaign</button>
              <button type="button" className="btn" onClick={() => { setError(null); cancelDialog.current?.showModal(); }}>Cancel it</button>
            </div>
          )}
          <h3>Lines</h3>
          <label className="field field-inline"><span className="sr-only">Decision</span>
            <select aria-label="Decision" value={decision} onChange={(e) => { setDecision(e.target.value); setPage(1); }}><option value="">Decision: any</option><option value="PENDING">Undecided</option><option value="CERTIFY">Certified</option><option value="REVOKE">To revoke</option></select>
          </label>
          <button type="button" className="btn btn-small" disabled={rows.length === 0} onClick={() => downloadCsv(`${c.code}.csv`, toCsv(['Person', 'Role', 'Held for', 'Privileged', 'Reviewer', 'Decision', 'Comment', 'Applied'], rows.map((i) => [i.user, i.roleCode, i.scope, i.privileged ? 'Yes' : 'No', i.reviewer, i.decision, i.comment ?? '', i.appliedNote ?? ''])))}>Export CSV</button>
          <QueryState query={items} what="the lines" permission="iam.review.view" />
          {rows.length > 0 && (
            <>
              <div className="table-wrap"><table><caption className="sr-only">Campaign lines</caption>
                <thead><tr><th>Person</th><th>Role</th><th>Held for</th><th>Reviewer</th><th>Decision</th><th>Applied</th></tr></thead>
                <tbody>{rows.map((i) => <tr key={i.id}><td data-label="Person">{i.user}</td><td data-label="Role"><code>{i.roleCode}</code>{i.privileged ? ' (privileged)' : ''}</td><td data-label="Held for">{i.scope}</td><td data-label="Reviewer">{i.reviewer}</td><td data-label="Decision"><StatusChip status={i.decision} />{i.comment ? ` ${i.comment}` : ''}</td><td data-label="Applied">{i.appliedNote ?? ''}</td></tr>)}</tbody></table></div>
              <Pager meta={items.data.meta} page={page} setPage={setPage} noun="lines" />
            </>
          )}
          <FormDialog
            dialogRef={reassignDialog}
            title={target ? `Reassign the lines of ${target.reviewer}` : 'Reassign'}
            submitLabel="Reassign"
            error={error}
            busy={reassign.isPending}
            onSubmit={async (f) => {
              setError(null);
              try {
                await reassign.mutateAsync({ id, reviewId: target.id, reviewerId: Number(f.get('reviewerId')), reason: String(f.get('reason')) });
                reassignDialog.current?.close();
                notify(`The lines of ${target.reviewer} were handed to another reviewer.`);
              } catch (err) { setError(errorInfo(err)); }
            }}
          >
            <Field label="New reviewer *" name="reviewerId" error={error}>
              <select name="reviewerId" required defaultValue=""><option value="">Choose a person...</option>{(users.data?.data ?? []).filter((u) => u.status === 'ACTIVE').map((u) => <option key={u.id} value={u.id}>{u.displayName} ({u.username})</option>)}</select>
            </Field>
          </FormDialog>
          <FormDialog
            dialogRef={cancelDialog}
            title={`Cancel ${c.code}`}
            submitLabel="Cancel the campaign"
            error={error}
            busy={cancel.isPending}
            onSubmit={async (f) => {
              setError(null);
              try { await cancel.mutateAsync({ id, reason: String(f.get('reason')) }); cancelDialog.current?.close(); notify(`Campaign ${c.code} was cancelled; nothing was changed.`); } catch (err) { setError(errorInfo(err)); }
            }}
          >
            <p className="muted">Decisions made so far are kept for the record, but no access is taken away.</p>
          </FormDialog>
        </>
      )}
    </aside>
  );
}

/** Access review campaigns (quarterly): started by the auditor or the director, decided by reviewers, closed when every line is decided. */
export default function AccessReviewsPage({ session }) {
  usePageTitle('Access Reviews');
  const manage = can(session, 'iam.review.manage');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(null);
  const [scope, setScope] = useState('PRIVILEGED');
  const list = useCampaigns({ page, pageSize: 25, sort: '-code', filters: { status } });
  const start = useStartCampaign();
  const tree = useOrgTree();
  const dialog = useRef(null);
  const rows = list.data?.data ?? [];
  const departments = flatten(tree.data?.departments ?? []);
  const quarterEnd = (() => { const d = new Date(); const m = Math.floor(d.getMonth() / 3) * 3 + 3; return new Date(d.getFullYear(), m, 0).toISOString().slice(0, 10); })();

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Access reviews</nav>
      <div className="page-head"><h1 id="page-title">Access Reviews</h1>{manage && <button type="button" className="btn btn-primary" onClick={() => { setError(null); dialog.current?.showModal(); }}>Start a campaign</button>}</div>
      <p className="muted">Each quarter, every reviewer confirms or removes the access of the people in their care. A campaign cannot close until every line is decided; closing applies the removals. Reviewers work on <Link to="/account/access-review">My Access Review</Link>.</p>
      <p role="status" className="notice" data-testid="review-notice">{notice}</p>
      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Status</span>
          <select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Status: any</option><option value="OPEN">Open</option><option value="CLOSED">Closed</option><option value="CANCELLED">Cancelled</option></select>
        </label>
      </div>
      <QueryState query={list} what="the campaigns" permission="iam.review.view" />
      {list.data && rows.length === 0 && <div className="state"><h2>No campaigns</h2><p>{manage ? 'Start the first review of the quarter.' : 'No review has been started yet.'}</p></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Access review campaigns</caption>
              <thead><tr><th>Code</th><th>Name</th><th>Scope</th><th>Due</th><th>Progress</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} data-testid={`campaign-${c.code}`}>
                    <td data-label="Code"><code>{c.code}</code></td>
                    <td data-label="Name">{c.name}</td>
                    <td data-label="Scope">{SCOPES.find(([v]) => v === c.scope)?.[1]}</td>
                    <td data-label="Due">{formatDate(c.dueDate)}{c.overdue ? ' (overdue)' : ''}</td>
                    <td data-label="Progress"><Progress c={c} /></td>
                    <td data-label="Status"><StatusChip status={c.status} /></td>
                    <td data-label="Actions"><button type="button" className="btn btn-small" aria-label={`Open campaign ${c.code}`} onClick={() => setSelected(c.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="campaigns" />
        </>
      )}
      {selected && <CampaignDetail id={selected} session={session} onClose={() => setSelected(null)} notify={setNotice} />}

      <FormDialog
        dialogRef={dialog}
        title="Start a review campaign"
        submitLabel="Start the campaign"
        error={error}
        busy={start.isPending}
        reason={false}
        onSubmit={async (f) => {
          setError(null);
          try {
            const out = await start.mutateAsync({ name: String(f.get('name')), scope, departmentId: scope === 'DEPARTMENT' ? Number(f.get('departmentId')) : undefined, dueDate: String(f.get('dueDate')) });
            dialog.current?.close();
            setSelected(out.id);
            setNotice(`Campaign ${out.code} started with ${out.total} line(s) for ${out.reviews.length} reviewer(s)${out.unassigned ? `; ${out.unassigned} line(s) had nobody to review them` : ''}.`);
          } catch (err) { setError(errorInfo(err)); }
        }}
      >
        <div className="form-grid">
          <Field label="Name *" name="name" error={error}><input name="name" required minLength={3} maxLength={120} defaultValue="Quarterly access review" /></Field>
          <Field label="What to review *" name="scope" error={error}><select name="scope" value={scope} onChange={(e) => setScope(e.target.value)}>{SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          {scope === 'DEPARTMENT' && <Field label="Department *" name="departmentId" error={error}><select name="departmentId" required defaultValue=""><option value="">Choose...</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.code} {d.name}</option>)}</select></Field>}
          <Field label="Due date *" name="dueDate" error={error}><input name="dueDate" type="date" required defaultValue={quarterEnd} /></Field>
        </div>
        <p className="muted small">Each person's access goes to their department head; a person never reviews their own, so those lines go to the director.</p>
      </FormDialog>
    </section>
  );
}

/** The reviewer's worklist: certify or revoke each line, one by one or many at once. */
export function MyAccessReviewPage() {
  usePageTitle('My Access Review');
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState('PENDING');
  const [picked, setPicked] = useState([]);
  const [mode, setMode] = useState('CERTIFY');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(null);
  const list = useMyReviewItems({ page, pageSize: 50, sort: 'user', filters: { decision } });
  const decide = useDecideReview();
  const dialog = useRef(null);
  const rows = list.data?.data ?? [];
  const open = (m) => { setMode(m); setError(null); dialog.current?.showModal(); };
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const submit = async (ids, comment) => {
    const out = await decide.mutateAsync({ ids, decision: mode, comment: comment || undefined });
    setPicked([]);
    setNotice(`${out.decided} line(s) ${mode === 'CERTIFY' ? 'certified' : 'marked to be revoked when the campaign closes'}.`);
  };
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">My account &rsaquo; Access review</nav>
      <div className="page-head"><h1 id="page-title">My Access Review</h1></div>
      {list.data?.campaigns?.length > 0 && <p className="muted">Open: {list.data.campaigns.map((c) => `${c.code} (due ${formatDate(c.due_date)})`).join(', ')}. Certify what is still needed; revoke what is not. Revokes take effect when the campaign is closed.</p>}
      <p role="status" className="notice" data-testid="myreview-notice">{notice}</p>
      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Decision</span>
          <select aria-label="Decision" value={decision} onChange={(e) => { setDecision(e.target.value); setPage(1); setPicked([]); }}><option value="PENDING">Undecided</option><option value="">All lines</option><option value="CERTIFY">Certified</option><option value="REVOKE">To revoke</option></select>
        </label>
        <button type="button" className="btn btn-primary" disabled={picked.length === 0} onClick={() => open('CERTIFY')}>Certify selected ({picked.length})</button>
        <button type="button" className="btn" disabled={picked.length === 0} onClick={() => open('REVOKE')}>Revoke selected ({picked.length})</button>
      </div>
      <QueryState query={list} what="your review lines" permission="iam.review.decide" />
      {list.data && rows.length === 0 && <div className="state"><h2>Nothing to review</h2><p>{decision === 'PENDING' ? 'You have no undecided lines.' : 'No lines match.'}</p></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Access to review</caption>
              <thead><tr><th><input type="checkbox" aria-label="Select all lines on this page" checked={rows.filter((r) => !r.appliedAt).every((r) => picked.includes(r.id))} onChange={(e) => setPicked(e.target.checked ? rows.filter((r) => !r.appliedAt).map((r) => r.id) : [])} /></th><th>Person</th><th>Role</th><th>Held for</th><th>Last sign-in</th><th>Decision</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} data-testid={`review-line-${i.id}`}>
                    <td data-label="Select"><input type="checkbox" aria-label={`Select ${i.roleCode} of ${i.user}`} checked={picked.includes(i.id)} onChange={() => toggle(i.id)} disabled={Boolean(i.appliedAt)} /></td>
                    <td data-label="Person">{i.displayName} <span className="muted">({i.user})</span></td>
                    <td data-label="Role"><code>{i.roleCode}</code> {i.roleName}{i.privileged ? ' (privileged)' : ''}</td>
                    <td data-label="Held for">{i.scope}</td>
                    <td data-label="Last sign-in">{i.lastLoginAt ? formatDateTime(i.lastLoginAt) : 'Never'}</td>
                    <td data-label="Decision"><StatusChip status={i.decision} />{i.comment ? ` ${i.comment}` : ''}</td>
                    <td data-label="Actions" className="actions">
                      <button type="button" className="btn btn-small" aria-label={`Certify ${i.roleCode} of ${i.user}`} onClick={async () => { setMode('CERTIFY'); try { const out = await decide.mutateAsync({ ids: [i.id], decision: 'CERTIFY' }); setNotice(`${out.decided} line certified.`); } catch (err) { setNotice(errorInfo(err).form); } }}>Certify</button>
                      <button type="button" className="btn btn-small" aria-label={`Revoke ${i.roleCode} of ${i.user}`} onClick={() => { setPicked([i.id]); open('REVOKE'); }}>Revoke</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="lines" />
        </>
      )}
      <FormDialog
        dialogRef={dialog}
        title={`${mode === 'CERTIFY' ? 'Certify' : 'Revoke'} ${picked.length} line(s)`}
        submitLabel={mode === 'CERTIFY' ? 'Certify' : 'Mark to revoke'}
        error={error}
        busy={decide.isPending}
        reason={false}
        onSubmit={async (f) => {
          setError(null);
          try { await submit(picked, String(f.get('comment') ?? '')); dialog.current?.close(); } catch (err) { setError(errorInfo(err)); }
        }}
      >
        <Field label={mode === 'CERTIFY' ? 'Comment (optional)' : 'Why should this access be removed? (min 5 characters) *'} name="comment" error={error}><textarea name="comment" rows="2" maxLength={500} required={mode === 'REVOKE'} minLength={mode === 'REVOKE' ? 5 : undefined} /></Field>
        {mode === 'REVOKE' && <p className="muted">The access is taken away when the campaign is closed.</p>}
      </FormDialog>
    </section>
  );
}

import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useDocConfig, useProposeDocConfig } from '../../platform/documents/api.js';
import { Field, Link, can, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { LEVELS, RETENTION } from './documents-common.js';

// Document Types & Folder Templates (part 04.10, section 7.4): the types with their approval chain, retention and default confidentiality, and the folder templates a project starts from.
// A change goes through approval (maker-checker) before it takes effect; only one change can wait at a time.
const lines = (nodes, depth = 0) => nodes.flatMap((n) => [`${'  '.repeat(depth)}${n.name}`, ...(n.children ? lines(n.children, depth + 1) : [])]);
const toText = (nodes) => lines(nodes).join('\n');
function fromText(text) {
  const root = [];
  const stack = [{ depth: -1, kids: root }];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const depth = Math.floor((line.length - line.trimStart().length) / 2);
    const node = { name: line.trim(), kids: [] };
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    stack[stack.length - 1].kids.push(node);
    stack.push({ depth, kids: node.kids });
  }
  const clean = (ns) => ns.map((n) => ({ name: n.name, ...(n.kids.length ? { children: clean(n.kids) } : {}) }));
  return clean(root);
}

export default function DocumentTypesPage({ session }) {
  usePageTitle('Document Types');
  const q = useDocConfig();
  const propose = useProposeDocConfig();
  const [types, setTypes] = useState(null);
  const [tpl, setTpl] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (q.data && !types) {
      setTypes(q.data.types.map((t) => ({ ...t })));
      setTpl(q.data.templates.map((t) => ({ code: t.code, name: t.name, text: toText(t.tree) })));
    }
  }, [q.data, types]);
  if (!can(session, 'doc.config.view')) return <NoPermission />;
  if (q.isLoading || !types) return q.isError ? <ErrorState error={q.error} retry={() => q.refetch()} /> : <Skeleton />;
  const c = q.data;
  const setT = (i, p) => setTypes((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const send = (e) => {
    e.preventDefault();
    setError(null);
    propose.mutate({
      types: types.map((t, i) => ({ code: t.code, name: t.name, requiresReview: Boolean(t.requiresReview), reviewerRole: t.reviewerRole, approverRole: t.approverRole, hasValidity: Boolean(t.hasValidity), defaultConfidentiality: t.defaultConfidentiality, retentionClass: t.retentionClass, sortOrder: i + 1 })),
      templates: tpl.map((t) => ({ code: t.code, name: t.name, tree: fromText(t.text) })), reason,
    }, { onSuccess: () => { setSent(true); setReason(''); q.refetch(); }, onError: (er) => setError(errorInfo(er)) });
  };
  return (
    <section aria-labelledby="dt-title" data-testid="document-types">
      <h1 id="dt-title">Document Types &amp; Folder Templates</h1>
      {c.pendingBatch && <p role="status" className="notice" data-testid="doc-config-pending">A change is waiting for approval (proposed by {c.pendingBatch.by}: {c.pendingBatch.reason}).{c.pendingBatch.instanceId ? <> <Link to={`/workflow/instance?id=${c.pendingBatch.instanceId}`}>Open the approval</Link></> : null}</p>}
      {sent && <p role="status" className="notice">Sent for approval. The change takes effect when it is approved.</p>}
      <form className="form-grid" onSubmit={send} aria-label="Change the document configuration">
        <h2>Document types</h2>
        {types.length === 0 && <EmptyState title="No types" message="No document types are set up." />}
        <div className="table-wrap"><table className="data-table" data-testid="type-table">
          <thead><tr><th>Code</th><th>Name</th><th>Review</th><th>Reviewer role</th><th>Approver</th><th>Validity</th><th>Confidentiality</th><th>Retention</th></tr></thead>
          <tbody>{types.map((t, i) => (
            <tr key={t.code}>
              <td>{t.code}</td>
              <td><input aria-label={`Name of ${t.code}`} value={t.name} disabled={!c.canEdit} maxLength={80} onChange={(e) => setT(i, { name: e.target.value })} /></td>
              <td><input type="checkbox" aria-label={`${t.code} needs a review`} checked={Boolean(t.requiresReview)} disabled={!c.canEdit} onChange={(e) => setT(i, { requiresReview: e.target.checked })} /></td>
              <td><input aria-label={`Reviewer role of ${t.code}`} value={t.reviewerRole} disabled={!c.canEdit} onChange={(e) => setT(i, { reviewerRole: e.target.value.toUpperCase() })} /></td>
              <td><select aria-label={`Approver of ${t.code}`} value={t.approverRole} disabled={!c.canEdit} onChange={(e) => setT(i, { approverRole: e.target.value })}><option value="PM">Project Manager</option><option value="QCMGR">QC Manager</option></select></td>
              <td><input type="checkbox" aria-label={`${t.code} has a validity date`} checked={Boolean(t.hasValidity)} disabled={!c.canEdit} onChange={(e) => setT(i, { hasValidity: e.target.checked })} /></td>
              <td><select aria-label={`Confidentiality of ${t.code}`} value={t.defaultConfidentiality} disabled={!c.canEdit} onChange={(e) => setT(i, { defaultConfidentiality: e.target.value })}>{Object.entries(LEVELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
              <td><select aria-label={`Retention of ${t.code}`} value={t.retentionClass} disabled={!c.canEdit} onChange={(e) => setT(i, { retentionClass: e.target.value })}>{Object.entries(RETENTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
            </tr>))}</tbody></table></div>
        <h2>Folder templates</h2>
        <p className="muted">One folder on each line; indent a sub-folder by two spaces. A project gets the folders when the template is applied to it.</p>
        {tpl.map((t, i) => (
          <div key={t.code} className="card">
            <h3>{t.code}</h3>
            <Field label={`Name of ${t.code}`} name={`templates.${i}.name`} error={error}><input value={t.name} disabled={!c.canEdit} onChange={(e) => setTpl((a) => a.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></Field>
            <Field label={`Folders of ${t.code}`} name={`templates.${i}.tree`} error={error}><textarea rows="8" value={t.text} disabled={!c.canEdit} onChange={(e) => setTpl((a) => a.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} /></Field>
          </div>))}
        {c.canEdit && <>
          <Field label="Reason for the change (at least 5 characters)" name="reason" error={error}><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
          {error?.form && <p role="alert" className="error">{error.form}</p>}
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={propose.isPending || reason.trim().length < 5 || Boolean(c.pendingBatch)}>Send for approval</button></div>
        </>}
      </form>
    </section>
  );
}

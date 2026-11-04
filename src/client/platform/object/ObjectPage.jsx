import { useEffect, useMemo, useRef, useState } from 'react';
import { authHeaders } from '../api/index.js';
import Icon from '../design/Icon.jsx';
import StatusBadge from '../design/StatusBadge.jsx';
import { ConfirmDialog, ProgressDialog } from '../feedback/Dialogs.jsx';
import { useToast } from '../feedback/Feedback.jsx';
import { QueryError, Skeleton } from '../feedback/states.jsx';
import { AttachmentPanel, ApprovalPanel, ComparePanel, DiscussionPanel, RelatedPanel, TimelinePanel } from './panels.jsx';
import { useRefreshObject } from './api.js';
import { recordVisit, useFavouriteActions, useFavourites, useFlagOn, useShellMode } from '../shell/api.js';
import { DiscussionTab, TimelineTab, TraceTab } from '../collab/CollabTabs.jsx';

// The Object Page (part 03.04): the same look for every record. A sticky header (number, status chips, key figures, owner and dates, the
// buttons the server allows right now), then the tabs Details, Lines, Attachments, Approvals, Timeline, Discussion, Related (and
// Amendments once a version exists). The server decides the buttons (`allowedActions`, BR-01); an action that needs asking first opens
// the confirmation dialog the server described (BR-02). Print is handled here.

const TAB_LABEL = { details: 'Details', lines: 'Lines', attachments: 'Attachments', approvals: 'Approvals', timeline: 'Timeline', discussion: 'Discussion', related: 'Related', trace: 'Trace', amendments: 'Amendments' };

const currentTab = (valid) => {
  const t = new URLSearchParams(window.location.search).get('tab');
  return valid.includes(t) ? t : valid[0];
};

/**
 * <ObjectPage type="sample_request" id={7} query={useQuery of GET /:id} heading={(r) => ...} chips={(r) => [{ status, label }]} figures={(r) => [{ label, value }]}
 *   meta={(r) => [{ label, value }]} renderDetails={(r) => node} renderLines={(r) => node} attachmentEntity="sample_request"
 *   onAction={(action, { reasonCode, reason, version }) => Promise} onEdit={() => ...} onBack={() => ...} navigate={(path) => ...}
 *   title="Request" section="Administration" listLabel="Sample Material Requests" listPath="/admin/sample-requests" />
 */
/** Keep this record among the person's favourites (part 03.05); nothing is drawn while the shell's favourites are switched off. */
function RecordFavourite({ type, id, label, enabled }) {
  const favs = useFavourites(enabled);
  const { add, remove } = useFavouriteActions();
  if (!favs.data) return null;
  const mine = favs.data.find((f) => f.kind === 'record' && f.entity === type && f.entityId === Number(id));
  return (
    <button type="button" className="btn btn-small" aria-pressed={Boolean(mine)} disabled={add.isPending || remove.isPending} data-testid="record-favourite"
      onClick={() => (mine ? remove.mutate(mine.id) : add.mutate({ entity: type, entityId: Number(id) }))}>
      <Icon name="erp.action.pin" size={14} /> {mine ? 'Remove from favourites' : `Add ${label} to favourites`}
    </button>
  );
}

export default function ObjectPage({ type, id, query, heading, subtitle, chips, figures, meta, renderDetails, renderLines, attachmentEntity, onAction, onEdit, onBack, navigate, title, section = 'Administration', listLabel = 'List', listPath = '/' }) {
  const toast = useToast();
  const refresh = useRefreshObject(type, id);
  const rec = query.data;
  const [pending, setPending] = useState(null); // the action waiting for confirmation
  const [printing, setPrinting] = useState(false);
  const [tab, setTab] = useState(null);
  // part 04.14: with the collaboration engine on, Timeline and Discussion come from it and a Trace tab is added
  const collab = useFlagOn('ff.eng.p0414');
  const tabs = useMemo(() => {
    const list = ['details'];
    if (renderLines) list.push('lines');
    list.push('attachments', 'approvals', 'timeline', 'discussion', 'related');
    if (collab) list.push('trace');
    if (rec?.counts?.versions >= 1) list.push('amendments');
    return list;
  }, [renderLines, rec?.counts?.versions, collab]);
  const active = tab ?? currentTab(tabs);
  const tablist = useRef(null);
  useEffect(() => { if (rec) document.title = `${heading(rec)} - ${title} - ERP`; }, [rec, heading, title]);
  // opening a record puts it among the person's recent records (part 03.05)
  const shellOn = useShellMode() === 'on';
  const recId = rec?.id;
  const recTitle = rec ? heading(rec) : '';
  useEffect(() => { if (shellOn && recId) recordVisit({ entity: type, entityId: Number(id), title: recTitle, route: `${listPath}?open=${id}` }); }, [shellOn, recId, recTitle, type, id, listPath]);

  const choose = (t) => {
    setTab(t);
    const u = new URL(window.location.href);
    u.searchParams.set('tab', t);
    window.history.replaceState(null, '', u);
  };
  const onTabKey = (e) => {
    const i = tabs.indexOf(active);
    const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : null;
    if (!next) return;
    e.preventDefault();
    choose(next);
    requestAnimationFrame(() => tablist.current?.querySelector(`[data-tab="${next}"]`)?.focus());
  };

  const print = async () => {
    setPrinting(true);
    try {
      const res = await fetch(`/api/v1/ui/objects/${type}/${id}/print`, { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
      if (!res.ok) { const j = await res.json().catch(() => null); throw Object.assign(new Error(j?.error?.message ?? `The server answered ${res.status}`), { correlationId: j?.error?.correlationId }); }
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `${type}-${id}.pdf`;
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement('a'), { href: url, download: name }).click();
      URL.revokeObjectURL(url);
      toast.success(`${name} is ready.`);
      refresh();
    } catch (err) {
      toast.error(`The PDF could not be made: ${err.message}${err.correlationId ? ` (Correlation ID ${err.correlationId})` : ''}`);
    } finally {
      setPrinting(false);
    }
  };

  const run = async (action, payload = {}) => {
    try {
      await onAction(action, payload);
      toast.success(`${action.label}: done.`);
      refresh();
      query.refetch();
    } catch (err) {
      if (!action.confirm) toast.error(`${action.label}: ${err.message}${err.correlationId ? ` (Correlation ID ${err.correlationId})` : ''}`);
      throw err;
    }
  };
  const start = (action) => {
    if (!action.allowed) return;
    if (action.id === 'print') { print(); return; }
    if (action.id === 'edit') { onEdit?.(); return; }
    if (action.confirm) setPending(action); else run(action).catch(() => {});
  };

  if (query.isPending) return <section aria-label={`Loading ${title}`}><Skeleton label={`Loading ${title}`} rows={4} /></section>;
  if (query.isError) {
    return (
      <section>
        <button type="button" className="btn" onClick={onBack}>Back to the list</button>
        <QueryError error={query.error} what={`this ${title.toLowerCase()}`} permission="the record's permission" onRetry={query.refetch} />
      </section>
    );
  }
  const actions = rec.allowedActions ?? [];
  const rank = { primary: 0, secondary: 1, danger: 2 };
  const ordered = [...actions].sort((a, b) => rank[a.kind] - rank[b.kind]); // the main action first, the destructive ones last
  const off = actions.filter((a) => !a.allowed && a.reason);
  const canEditFiles = rec.status === 'DRAFT' || rec.status === 'SUBMITTED';
  return (
    <section className="op" aria-labelledby="op-title" data-testid="object-page">
      <nav aria-label="Breadcrumb" className="breadcrumb breadcrumb-object"><span className="bc-section">{section} &rsaquo; </span><a href={listPath} onClick={(e) => { e.preventDefault(); onBack(); }}>{listLabel}</a> &rsaquo; {heading(rec)}</nav>
      <header className="op-head" data-testid="op-header">
        <div className="op-title-row">
          <h1 id="op-title">{heading(rec)}</h1>
          <span className="op-chips">{chips(rec).map((c) => <StatusBadge key={c.label} status={c.status} label={c.label} />)}</span>
        </div>
        {subtitle && <p className="op-subtitle" data-testid="op-subtitle">{subtitle(rec)}</p>}
        <dl className="op-figures" aria-label="Key figures">
          {figures(rec).map((f) => <div key={f.label}><dt>{f.label}</dt><dd data-testid={`fig-${f.label.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`}>{f.value}</dd></div>)}
        </dl>
        <p className="op-meta muted small">{meta(rec).map((m) => `${m.label}: ${m.value}`).join(' · ')}</p>
        <div className="op-actions" role="toolbar" aria-label="Actions">
          {ordered.map((a) => (
            <button key={a.id} type="button" data-testid={`action-${a.id}`} className={`btn ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : ''}`} aria-disabled={!a.allowed} title={a.reason ?? undefined} onClick={() => start(a)}>
              {a.id === 'print' && <Icon name="erp.action.print" size={16} />}{a.id === 'edit' && <Icon name="erp.action.edit" size={16} />}{a.label}
            </button>
          ))}
          <RecordFavourite type={type} id={id} label={title.toLowerCase()} enabled={shellOn} />
        </div>
        {off.length > 0 && (
          <details className="op-why"><summary>Why are some actions off?</summary>
            <ul>{off.map((a) => <li key={a.id}><strong>{a.label}:</strong> {a.reason}</li>)}</ul>
          </details>
        )}
        <div role="tablist" aria-label={`${title} sections`} className="op-tabs" ref={tablist} onKeyDown={onTabKey}>
          {tabs.map((t) => {
            const n = { attachments: rec.counts?.attachments, approvals: rec.counts?.approvals, discussion: rec.counts?.comments, amendments: rec.counts?.versions }[t];
            return (
              <button key={t} type="button" role="tab" id={`tab-${t}`} data-tab={t} aria-selected={active === t} aria-controls={`panel-${t}`} tabIndex={active === t ? 0 : -1} className={`op-tab${active === t ? ' is-active' : ''}`} onClick={() => choose(t)}>
                {TAB_LABEL[t]}{n ? <span className="op-count" aria-label={`${n} items`}>{n}</span> : null}
              </button>
            );
          })}
        </div>
      </header>
      <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} className="op-panel" tabIndex={0}>
        {active === 'details' && renderDetails(rec)}
        {active === 'lines' && renderLines?.(rec)}
        {active === 'attachments' && <AttachmentPanel type={type} id={id} entity={attachmentEntity} canEdit={canEditFiles} />}
        {active === 'approvals' && <ApprovalPanel type={type} id={id} actions={actions} onAction={start} />}
        {active === 'timeline' && (collab ? <TimelineTab entity={type} id={id} /> : <TimelinePanel type={type} id={id} />)}
        {active === 'discussion' && (collab ? <DiscussionTab entity={type} id={id} /> : <DiscussionPanel type={type} id={id} />)}
        {active === 'trace' && <TraceTab entity={type} id={id} navigate={navigate} />}
        {active === 'related' && <RelatedPanel type={type} id={id} navigate={navigate} />}
        {active === 'amendments' && <ComparePanel type={type} id={id} />}
      </div>
      <ConfirmDialog open={Boolean(pending)} title={pending?.confirm.title ?? ''} text={pending?.confirm.text} confirmLabel={pending?.label} danger={pending?.kind === 'danger'}
        reasonFor={pending?.confirm.reasonFor} commentOptional={pending?.confirm.commentOptional}
        onCancel={() => setPending(null)}
        onConfirm={async (payload) => { await run(pending, { ...payload, version: pending.id === 'approve' || pending.id === 'reject' || pending.id === 'return' ? rec.approval?.version : rec.version }); setPending(null); }} />
      <ProgressDialog open={printing} title="Preparing the PDF" message="The record is being written to a PDF. This takes a moment." />
    </section>
  );
}

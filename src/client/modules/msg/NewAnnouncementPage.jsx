import { useEffect, useState } from 'react';
import { fetchLookup } from '../../platform/forms/LookupField.jsx';
import { comm } from '../../platform/messages/Comm.jsx';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';

// New Announcement (part 05.04, section 7.4): title, text, the audience (everyone, roles, projects, sites, departments: places narrow it, roles narrow it further), a live count of who will receive it, confirmation and an
// optional quiz, publish and expiry times. Save as a draft, or publish (now, or at the chosen time).
const useList = (lookup) => { const [rows, setRows] = useState([]); useEffect(() => { fetchLookup(lookup, { pageSize: 100 }).then((r) => setRows(r.data ?? [])).catch(() => setRows([])); }, [lookup]); return rows; };
const label = (r) => r.label ?? r.name ?? r.code ?? String(r.id);
const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const ROLES = ['PD', 'PM', 'SE', 'SUP', 'HRMGR', 'CFO', 'ACCMGR', 'PROCMGR', 'COMMGR', 'EMP'];

export default function NewAnnouncementPage() {
  usePageTitle('New Announcement');
  const projects = useList('iam/projects');
  const departments = useList('iam/departments');
  const [f, setF] = useState({ title: '', body: '', all: false, roles: [], projectIds: [], siteIds: '', departmentIds: [], requireConfirmation: false, quiz: [], publishAt: '', expiresAt: '' });
  const [count, setCount] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (p) => setF((cur) => ({ ...cur, ...p }));
  const audience = { all: f.all, roles: f.roles, projectIds: f.projectIds, siteIds: f.siteIds.split(/[\s,]+/).map(Number).filter(Boolean), departmentIds: f.departmentIds };
  const has = audience.all || audience.roles.length || audience.projectIds.length || audience.siteIds.length || audience.departmentIds.length;
  useEffect(() => { if (!has) { setCount(null); return undefined; } let live = true; const t = setTimeout(() => comm.audience(audience).then((r) => live && setCount(r.recipients)).catch(() => live && setCount(null)), 300); return () => { live = false; clearTimeout(t); }; }, [JSON.stringify(audience)]);
  const body = () => ({ title: f.title, body: f.body, audience, requireConfirmation: f.requireConfirmation, quiz: f.quiz.map((q) => ({ q: q.q, options: q.options.filter((o) => o.trim()), correct: q.correct })), ...(f.publishAt ? { publishAt: f.publishAt } : {}), ...(f.expiresAt ? { expiresAt: f.expiresAt } : {}) });
  const save = async (publish) => {
    setBusy(true); setError(null);
    try { const a = await comm.createAnnouncement(body()); if (publish) await comm.publishAnnouncement(a.id); navigateTo(`/collab/announcements?a=${a.id}`); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  };
  const addQ = () => set({ quiz: [...f.quiz, { q: '', options: ['', ''], correct: 0 }], requireConfirmation: true });
  const setQ = (i, p) => set({ quiz: f.quiz.map((q, k) => (k === i ? { ...q, ...p } : q)) });
  const valid = f.title.trim().length >= 3 && f.body.trim().length >= 3 && has;
  return (
    <section aria-labelledby="na-title" data-testid="new-announcement">
      <h1 id="na-title">New Announcement</h1>
      <form className="card form-grid" onSubmit={(e) => { e.preventDefault(); save(true); }} noValidate aria-label="New announcement">
        <fieldset><legend>The announcement</legend>
          <Field label="Title *" name="title" error={error}><input value={f.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} data-testid="na-title-input" /></Field>
          <Field label="Text *" name="body" error={error}><textarea rows="5" value={f.body} maxLength={4000} onChange={(e) => set({ body: e.target.value })} data-testid="na-body" /></Field>
        </fieldset>
        <fieldset><legend>Who it is for</legend>
          <p className="muted small">Choose places (projects, sites, departments) to reach the people assigned there; add roles to narrow it to those roles. Roles alone, or everyone, need company-wide rights.</p>
          <label className="field field-inline"><span>Everyone in the company</span><input type="checkbox" checked={f.all} onChange={(e) => set({ all: e.target.checked })} data-testid="na-all" /></label>
          {!f.all && <>
            <div role="group" aria-label="Projects"><strong>Projects</strong>{projects.length === 0 && <span className="muted small"> none</span>}{projects.map((p) => <label key={p.id} className="field field-inline"><span>{label(p)}</span><input type="checkbox" checked={f.projectIds.includes(p.id)} onChange={() => set({ projectIds: toggle(f.projectIds, p.id) })} data-testid={`na-project-${p.id}`} /></label>)}</div>
            <div role="group" aria-label="Departments"><strong>Departments</strong>{departments.length === 0 && <span className="muted small"> none</span>}{departments.map((p) => <label key={p.id} className="field field-inline"><span>{label(p)}</span><input type="checkbox" checked={f.departmentIds.includes(p.id)} onChange={() => set({ departmentIds: toggle(f.departmentIds, p.id) })} /></label>)}</div>
            <Field label="Site numbers (comma separated)" name="siteIds" error={error}><input value={f.siteIds} onChange={(e) => set({ siteIds: e.target.value })} inputMode="numeric" /></Field>
          </>}
          <div role="group" aria-label="Roles"><strong>Roles</strong>{ROLES.map((r) => <label key={r} className="field field-inline"><span>{r}</span><input type="checkbox" checked={f.roles.includes(r)} onChange={() => set({ roles: toggle(f.roles, r) })} data-testid={`na-role-${r}`} /></label>)}</div>
          <p role="status" data-testid="na-count">{has ? (count === null ? 'Counting…' : `${count} ${count === 1 ? 'person' : 'people'} will receive it.`) : 'Choose who it is for.'}</p>
        </fieldset>
        <fieldset><legend>Confirmation and quiz</legend>
          <label className="field field-inline"><span>Ask people to confirm they read it</span><input type="checkbox" checked={f.requireConfirmation || f.quiz.length > 0} disabled={f.quiz.length > 0} onChange={(e) => set({ requireConfirmation: e.target.checked })} data-testid="na-confirm" /></label>
          {f.quiz.map((q, i) => (
            <div key={i} className="card" data-testid="na-quiz-item"><Field label={`Question ${i + 1}`} name={`quiz.${i}.q`} error={error}><input value={q.q} maxLength={200} onChange={(e) => setQ(i, { q: e.target.value })} data-testid={`na-q-${i}`} /></Field>
              {q.options.map((o, k) => <div key={k} className="field field-inline"><input aria-label={`Option ${k + 1} of question ${i + 1}`} value={o} maxLength={120} onChange={(e) => setQ(i, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) })} data-testid={`na-q-${i}-o-${k}`} /><label><input type="radio" name={`correct-${i}`} checked={q.correct === k} onChange={() => setQ(i, { correct: k })} data-testid={`na-q-${i}-c-${k}`} /> right answer</label></div>)}
              <div className="actions">{q.options.length < 5 && <button type="button" className="btn btn-small" onClick={() => setQ(i, { options: [...q.options, ''] })}>Add an option</button>}<button type="button" className="btn btn-small" onClick={() => set({ quiz: f.quiz.filter((_, k) => k !== i) })}>Remove the question</button></div></div>
          ))}
          {f.quiz.length < 10 && <button type="button" className="btn" onClick={addQ} data-testid="na-add-q">Add a quiz question</button>}
        </fieldset>
        <fieldset><legend>When</legend>
          <Field label="Publish at (leave empty to publish now)" name="publishAt" error={error}><input type="datetime-local" value={f.publishAt} onChange={(e) => set({ publishAt: e.target.value })} data-testid="na-publish-at" /></Field>
          <Field label="Expires at (optional)" name="expiresAt" error={error}><input type="datetime-local" value={f.expiresAt} onChange={(e) => set({ expiresAt: e.target.value })} /></Field>
        </fieldset>
        {error?.form && <p className="field-error" role="alert" data-testid="na-error">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
        <div className="actions">
          <button type="submit" className="btn btn-primary btn-large" disabled={!valid || busy} data-testid="na-publish">{f.publishAt ? 'Schedule it' : 'Publish'}</button>
          <button type="button" className="btn" disabled={!valid || busy} onClick={() => save(false)} data-testid="na-draft">Save as a draft</button>
          <button type="button" className="btn" onClick={() => { if (!f.title && !f.body || window.confirm('Leave without saving?')) navigateTo('/collab/announcements'); }}>Cancel</button>
        </div>
      </form>
    </section>
  );
}

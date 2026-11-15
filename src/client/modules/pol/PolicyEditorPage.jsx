import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { fetchLookup } from '../../platform/forms/LookupField.jsx';
import { fetchFileUrl } from '../core/api/index.js';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { CATEGORIES, STATUS, pol } from './api.js';
import { Diff } from './PolicyRegisterPage.jsx';
import RichText from './RichText.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Policy Editor with version compare (part 05.05, section 7.2): title, category, department, the text (rich), attachments, what changed, effective and review dates, who it applies to (with a live count of the people),
// the knowledge check (questions and pass mark), the requirements tagged for controls, and the comparison with another version. Save as a draft (it is also saved every half minute while it changes), or send for approval.
// A version in approval or in force is shown read-only: a revision is a new version.
const ROLES = ['PD', 'PM', 'SE', 'SUP', 'HRMGR', 'CFO', 'ACCMGR', 'PROCMGR', 'COMMGR', 'QCMGR', 'HSEE', 'EMP'];
const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const idFromUrl = () => Number(new URLSearchParams(window.location.search).get('id')) || null;
const tabFromUrl = () => new URLSearchParams(window.location.search).get('tab') || 'content';
const useList = (lookup) => { const [rows, setRows] = useState([]); useEffect(() => { fetchLookup(lookup, { pageSize: 100 }).then((r) => setRows(r.data ?? [])).catch(() => setRows([])); }, [lookup]); return rows; };
const label = (r) => r.label ?? r.name ?? r.code ?? String(r.id);
const blank = { title: '', category: 'HR', departmentId: '', body: '', changeSummary: '', effectiveFrom: '', reviewDue: '', ackDueDays: 14, passMark: 100, quiz: [], applicability: { all: false, departments: [], roles: [], sites: '', projects: [] } };
const toForm = (p) => { const w = p.working; return { title: p.title, category: p.category, departmentId: p.departmentId ?? '', body: w.bodyHtml, changeSummary: w.changeSummary ?? '', effectiveFrom: w.effectiveFrom ?? '', reviewDue: w.reviewDue ?? '', ackDueDays: w.ackDueDays, passMark: w.passMark, quiz: w.quiz ?? [], applicability: { all: Boolean(w.applicability.all), departments: w.applicability.departments ?? [], roles: w.applicability.roles ?? [], sites: (w.applicability.sites ?? []).join(', '), projects: w.applicability.projects ?? [] } }; };
const toBody = (f) => ({ title: f.title, category: f.category, ...(f.departmentId ? { departmentId: Number(f.departmentId) } : {}), body: f.body, changeSummary: f.changeSummary, quiz: f.quiz.map((q) => ({ q: q.q, options: q.options.filter((o) => o.trim()), correct: q.correct })), passMark: Number(f.passMark), ackDueDays: Number(f.ackDueDays),
  applicability: { all: f.applicability.all, departments: f.applicability.departments, roles: f.applicability.roles, sites: String(f.applicability.sites).split(/[\s,]+/).map(Number).filter(Boolean), projects: f.applicability.projects }, effectiveFrom: f.effectiveFrom || null, reviewDue: f.reviewDue || null });

const TEMPLATES = {
  CONTROL_POINT: { code: 'CP-PROC-90', module: 'proc', stage: 'APPROVE', description: '', enforcement: 'EXCEPTION', field: 'amount', op: 'gt', value: '500000', ownerRole: 'PROCMGR' },
  APPROVAL_RULE: { docType: 'PO', name: '', field: 'amount', op: 'gt', value: '1000000', roles: 'PROCMGR, DIR' },
  ALERT_RULE: { code: 'pol.', name: '', eventType: '', notifyRole: 'PROCMGR', message: '', severity: 'WARNING' },
};
const configOf = (type, c) => {
  const num = (v) => (v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v);
  if (type === 'CONTROL_POINT') return { code: c.code, module: c.module, stage: c.stage, description: c.description, enforcement: c.enforcement, rule: { field: c.field, op: c.op, value: num(c.value) }, ownerRole: c.ownerRole };
  if (type === 'APPROVAL_RULE') return { docType: c.docType, name: c.name, conditions: c.field ? [{ field: c.field, op: c.op, value: num(c.value) }] : [], steps: c.roles.split(/[\s,]+/).filter(Boolean).map((role) => ({ role })) };
  return { code: c.code, name: c.name, triggerType: 'EVENT', eventType: c.eventType, condition: { all: [] }, actions: [{ type: 'notify', to: [`role:${c.notifyRole}`] }], messageTemplate: c.message, severity: c.severity };
};

function Requirements({ policy, version, canTag }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['pol', 'requirements', version.id], queryFn: () => pol.requirements(version.id), retry: false });
  const [f, setF] = useState({ clauseRef: '', requirementText: '', type: 'CONTROL_POINT', config: TEMPLATES.CONTROL_POINT });
  const [error, setError] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['pol'] });
  const set = (p) => setF((cur) => ({ ...cur, ...p }));
  const setC = (p) => setF({ ...f, config: { ...f.config, ...p } });
  const add = async (e) => { e.preventDefault(); setError(null); try { await pol.addRequirement({ versionId: version.id, clauseRef: f.clauseRef, requirementText: f.requirementText, artifactType: f.type, config: configOf(f.type, f.config) }); setF({ ...f, clauseRef: '', requirementText: '' }); refresh(); } catch (er) { setError(errorInfo(er)); } };
  const convert = async (r) => { setError(null); try { await pol.convert(r.id); refresh(); } catch (er) { setError(errorInfo(er)); } };
  const approved = ['PUBLISHED', 'ACTIVE'].includes(version.status);
  return (
    <section aria-labelledby="rq-title" data-testid="requirements"><h2 id="rq-title">Requirements for controls</h2>
      <p className="muted small">Tag a clause as a requirement the system can enforce. After the policy is approved, <strong>Make a draft</strong> creates it as a control point (off), an approval-matrix version (a draft) or an alert rule (switched off). An administrator reviews and activates it on the screen of that engine; nothing is switched on here.</p>
      {error?.form && <p className="field-error" role="alert" data-testid="rq-error">{error.form}{error.details?.length > 0 && <ul>{error.details.map((d, i) => <li key={i}>{d.field}: {d.message}</li>)}</ul>}</p>}
      {(q.data?.rows ?? []).length > 0 && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Tagged requirements"><table className="grid"><thead><tr><th>Clause</th><th>Requirement</th><th>Becomes</th><th>State</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{q.data.rows.map((r) => <tr key={r.id} data-testid="rq-row"><th scope="row" data-label="Clause">{r.clauseRef}</th><td data-label="Requirement">{r.requirementText}</td><td data-label="Becomes">{r.artifactLabel} (part {r.engine?.part})</td>
            <td data-label="State">{r.status === 'DRAFTED' ? <><StatusBadge status={r.artifact?.state === 'ACTIVE' ? 'COMPLETED' : 'IN_REVIEW'} label={r.artifact?.stateLabel ?? 'Draft'} /> <a href={r.artifact?.route ?? '#'} onClick={(e) => { e.preventDefault(); if (r.artifact?.route) navigateTo(r.artifact.route); }} data-testid="rq-open">{r.artifact?.label}</a></> : r.status === 'DISMISSED' ? 'Dismissed' : 'Tagged'}</td>
            <td>{r.status === 'TAGGED' && canTag && <><button type="button" className="btn btn-small btn-primary" disabled={!approved} title={approved ? '' : 'Available after the policy is approved'} onClick={() => convert(r)} data-testid="rq-convert">Make a draft</button> <button type="button" className="btn btn-small" onClick={async () => { await pol.removeRequirement(r.id); refresh(); }}>Remove</button></>}</td></tr>)}</tbody></table></div>
      )}
      {canTag && (
        <form className="card form-grid" onSubmit={add} noValidate aria-label="Tag a requirement" data-testid="rq-form">
          <Field label="Clause *" name="clauseRef" error={error}><input value={f.clauseRef} maxLength={40} onChange={(e) => set({ clauseRef: e.target.value })} data-testid="rq-clause" /></Field>
          <Field label="Requirement *" name="requirementText" error={error}><textarea rows="2" value={f.requirementText} maxLength={1000} onChange={(e) => set({ requirementText: e.target.value })} data-testid="rq-text" /></Field>
          <Field label="Turn it into" name="type" error={error}><select value={f.type} onChange={(e) => set({ type: e.target.value, config: TEMPLATES[e.target.value] })} data-testid="rq-type"><option value="CONTROL_POINT">A control point (04.04)</option><option value="APPROVAL_RULE">An approval rule (04.02)</option><option value="ALERT_RULE">An alert rule (04.09)</option></select></Field>
          {f.type === 'CONTROL_POINT' && <>
            <Field label="Code (CP-MODULE-nn)" name="code" error={error}><input value={f.config.code} onChange={(e) => setC({ code: e.target.value.toUpperCase() })} data-testid="rq-code" /></Field>
            <Field label="Module (lower case)" name="module" error={error}><input value={f.config.module} onChange={(e) => setC({ module: e.target.value })} /></Field>
            <Field label="What it checks (description) *" name="description" error={error}><input value={f.config.description} maxLength={300} onChange={(e) => setC({ description: e.target.value })} data-testid="rq-description" /></Field>
            <Field label="Stage" name="stage" error={error}><select value={f.config.stage} onChange={(e) => setC({ stage: e.target.value })}>{['PLAN', 'VERIFY', 'APPROVE', 'EXECUTE', 'RECORD', 'MONITOR', 'RECONCILE', 'CLOSE'].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Enforcement" name="enforcement" error={error}><select value={f.config.enforcement} onChange={(e) => setC({ enforcement: e.target.value })}>{['BLOCK', 'EXCEPTION', 'WARN', 'MONITOR'].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="It fails when field" name="field" error={error}><input value={f.config.field} onChange={(e) => setC({ field: e.target.value })} /></Field>
            <Field label="is" name="op" error={error}><select value={f.config.op} onChange={(e) => setC({ op: e.target.value })}>{['gt', 'gte', 'lt', 'lte', 'eq', 'ne'].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="the value" name="value" error={error}><input value={f.config.value} onChange={(e) => setC({ value: e.target.value })} /></Field>
            <Field label="Owner role" name="ownerRole" error={error}><input value={f.config.ownerRole} onChange={(e) => setC({ ownerRole: e.target.value.toUpperCase() })} /></Field>
          </>}
          {f.type === 'APPROVAL_RULE' && <>
            <Field label="Document type (for example PO)" name="docType" error={error}><input value={f.config.docType} onChange={(e) => setC({ docType: e.target.value.toUpperCase() })} data-testid="rq-doctype" /></Field>
            <Field label="Name of the rule *" name="name" error={error}><input value={f.config.name} onChange={(e) => setC({ name: e.target.value })} data-testid="rq-name" /></Field>
            <Field label="When field" name="field" error={error}><input value={f.config.field} onChange={(e) => setC({ field: e.target.value })} /></Field>
            <Field label="is" name="op" error={error}><select value={f.config.op} onChange={(e) => setC({ op: e.target.value })}>{['gt', 'gte', 'lt', 'lte', 'eq', 'ne'].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="the value" name="value" error={error}><input value={f.config.value} onChange={(e) => setC({ value: e.target.value })} /></Field>
            <Field label="Approvers, in order (role codes)" name="roles" error={error}><input value={f.config.roles} onChange={(e) => setC({ roles: e.target.value })} data-testid="rq-roles" /></Field>
          </>}
          {f.type === 'ALERT_RULE' && <>
            <Field label="Code (for example pol.large_po)" name="code" error={error}><input value={f.config.code} onChange={(e) => setC({ code: e.target.value })} /></Field>
            <Field label="Name *" name="name" error={error}><input value={f.config.name} onChange={(e) => setC({ name: e.target.value })} /></Field>
            <Field label="When this event happens (module.entity.verb)" name="eventType" error={error}><input value={f.config.eventType} onChange={(e) => setC({ eventType: e.target.value })} /></Field>
            <Field label="Tell the role" name="notifyRole" error={error}><input value={f.config.notifyRole} onChange={(e) => setC({ notifyRole: e.target.value.toUpperCase() })} /></Field>
            <Field label="Message *" name="messageTemplate" error={error}><input value={f.config.message} onChange={(e) => setC({ message: e.target.value })} /></Field>
          </>}
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={!f.clauseRef.trim() || f.requirementText.trim().length < 5} data-testid="rq-add">Tag the requirement</button></div>
        </form>
      )}
      <p className="muted small">Policy {policy.policyNo}, version {version.version}.</p>
    </section>
  );
}

export default function PolicyEditorPage({ session }) {
  usePageTitle('Policy Editor');
  const qc = useQueryClient();
  const [id, setId] = useState(idFromUrl);
  const [tab, setTab] = useState(tabFromUrl);
  const q = useQuery({ queryKey: ['pol', 'policy', id], queryFn: () => pol.get(id), enabled: Boolean(id), retry: false });
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const rowVersion = useRef(0);
  const departments = useList('iam/departments');
  const projects = useList('iam/projects');
  const [cmp, setCmp] = useState({ from: '', to: '' });
  const diff = useQuery({ queryKey: ['pol', 'compare', id, cmp.from, cmp.to], queryFn: () => pol.compare(id, cmp.from, cmp.to), enabled: Boolean(id && cmp.from && cmp.to && cmp.from !== cmp.to), retry: false });
  useEffect(() => { if (!id) { setF((cur) => cur ?? blank); return; } if (q.data) { if (!f || !dirty) { if (q.data.working) { setF(toForm(q.data)); rowVersion.current = q.data.working.rowVersion; } else setF(null); } } }, [id, q.data]);
  const working = q.data?.working;
  const editable = !id ? true : Boolean(working && working.status === 'DRAFT' && q.data?.can.edit);
  const set = (p) => { setF((cur) => ({ ...cur, ...p })); setDirty(true); };
  const setA = (p) => { setF((cur) => ({ ...cur, applicability: { ...cur.applicability, ...p } })); setDirty(true); };
  const aud = f ? { all: f.applicability.all, departments: f.applicability.departments, roles: f.applicability.roles, sites: String(f.applicability.sites).split(/[\s,]+/).map(Number).filter(Boolean), projects: f.applicability.projects } : null;
  const has = aud && (aud.all || aud.departments.length || aud.roles.length || aud.sites.length || aud.projects.length);
  useEffect(() => { if (!has) { setPreview(null); return undefined; } let live = true; const t = setTimeout(() => pol.preview(aud).then((r) => live && setPreview(r)).catch(() => live && setPreview(null)), 300); return () => { live = false; clearTimeout(t); }; }, [JSON.stringify(aud)]);
  const save = async ({ quiet = false } = {}) => {
    setError(null); if (!quiet) setNotice('');
    try {
      let out;
      if (!id) { out = await pol.create(toBody(f)); setId(out.id); window.history.replaceState(null, '', `/collab/policies/edit?id=${out.id}`); } else out = await pol.update(working.id, { ...toBody(f), version: rowVersion.current });
      rowVersion.current = out.working.rowVersion; setDirty(false); qc.setQueryData(['pol', 'policy', out.id], out); if (!quiet) setNotice('Saved as a draft.');
      return out;
    } catch (e) { if (!quiet) setError(errorInfo(e)); return null; }
  };
  // the draft is saved every half minute while it changes
  useEffect(() => { if (!id || !dirty || !editable) return undefined; const t = setTimeout(() => save({ quiet: true }), 30_000); return () => clearTimeout(t); }, [dirty, f, id, editable]);
  const submit = async () => {
    if (!window.confirm('Send this policy for approval? It cannot be edited while it is in approval.')) return;
    setBusy(true);
    const out = dirty || !id ? await save() : q.data;
    if (out) { try { await pol.submit(out.working.id); setNotice('Sent for approval to the department head and then the director.'); qc.invalidateQueries({ queryKey: ['pol'] }); navigateTo(`/collab/policies?id=${out.id}`); } catch (e) { setError(errorInfo(e)); } }
    setBusy(false);
  };
  const upload = async (files) => { if (!working) { setError({ form: 'Save the draft first; attachments belong to a version.' }); return; } try { const saved = dirty ? await save({ quiet: true }) : q.data; for (const file of files) { const up = await pol.upload(file, saved.working.id); void up; } const out = await pol.get(id); rowVersion.current = out.working.rowVersion; qc.setQueryData(['pol', 'policy', id], out); setNotice('Attached. Attachments are saved with the version.'); } catch (e) { setError(errorInfo(e)); } };
  if (id && q.isPending) return <Skeleton label="Loading the policy" rows={4} />;
  if (id && q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!f && id && !working) {
    return (
      <section aria-labelledby="pe-title" data-testid="policy-editor"><PageHeader id="pe-title" title={"Policy Editor"} />
        <p className="notice" role="status" data-testid="pe-nodraft">{q.data.policyNo} has no draft to edit. {q.data.can.revise ? 'Start a new version to change it.' : 'A published policy is never edited.'}</p>
        <div className="actions">{q.data.can.revise && <button type="button" className="btn btn-primary" onClick={async () => { await pol.revise(id); qc.invalidateQueries({ queryKey: ['pol'] }); setF(null); }} data-testid="pe-revise">Start a new version</button>}<button type="button" className="btn" onClick={() => navigateTo(`/collab/policies?id=${id}`)}>Back to the policy</button></div>
        {q.data.current && <Requirements policy={q.data} version={q.data.current} canTag={q.data.can.tag} />}
      </section>
    );
  }
  if (!f) return <Skeleton label="Preparing the editor" rows={4} />;
  const versions = q.data?.versions ?? [];
  return (
    <section aria-labelledby="pe-title" data-testid="policy-editor">
      <PageHeader id="pe-title" title={<>Policy Editor{q.data ? ` · ${q.data.policyNo}` : ''}</>} actions={<>{working && <StatusBadge status={STATUS[working.status][0]} label={`Version ${working.version}: ${STATUS[working.status][1]}`} />}</>} />
      <div className="msg-filters" role="tablist" aria-label="Parts of the policy">
        {[['content', 'The policy'], ['requirements', 'Requirements for controls'], ['compare', 'Compare versions']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`lr-chip${tab === k ? ' is-on' : ''}`} onClick={() => setTab(k)} data-testid={`pe-tab-${k}`} disabled={k !== 'content' && !id}>{l}</button>)}
      </div>
      {notice && <p role="status" className="notice" data-testid="pe-notice">{notice}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="pe-error">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}{error.details?.length > 0 && <ul>{error.details.map((d, i) => <li key={i}>{d.field}: {d.message}</li>)}</ul>}</p>}
      {tab === 'content' && (
        <form className="card form-grid" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate aria-label="Policy" data-testid="pe-form">
          <fieldset disabled={!editable}><legend>The policy</legend>
            <Field label="Title *" name="title" error={error}><input value={f.title} maxLength={160} onChange={(e) => set({ title: e.target.value })} data-testid="pe-title-input" /></Field>
            <Field label="Category *" name="category" error={error}><select value={f.category} onChange={(e) => set({ category: e.target.value })} data-testid="pe-category">{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Owning department" name="departmentId" error={error}><select value={f.departmentId} onChange={(e) => set({ departmentId: e.target.value })}><option value="">Mine</option>{departments.map((d) => <option key={d.id} value={d.id}>{label(d)}</option>)}</select></Field>
            <div className="field"><span id="pe-body-label">Text *</span><RichText key={`${id ?? 'new'}-${working?.id ?? 0}`} id="pe-body" label="Policy text" value={f.body} onChange={(v) => set({ body: v })} disabled={!editable} /></div>
            <Field label="What changed in this version (required from version 2)" name="changeSummary" error={error}><textarea rows="2" value={f.changeSummary} maxLength={500} onChange={(e) => set({ changeSummary: e.target.value })} data-testid="pe-change" /></Field>
            <div><label className="btn" htmlFor="pe-attach">Attach a file</label><input id="pe-attach" type="file" multiple hidden disabled={!editable} onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} data-testid="pe-attach" />
              {working?.attachments?.length > 0 && <ul aria-label="Attachments" data-testid="pe-attachments">{working.attachments.map((a) => <li key={a.id}><button type="button" className="link-button" onClick={async () => { const l = await fetchFileUrl(a.id, {}); window.open(l.url, '_blank'); }}>{a.name}</button> <span className="muted small">{Math.max(1, Math.round(a.size / 1024))} KB</span></li>)}</ul>}</div>
          </fieldset>
          <fieldset disabled={!editable}><legend>Dates</legend>
            <Field label="Effective from *" name="effectiveFrom" error={error}><input type="date" value={f.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} data-testid="pe-effective" /></Field>
            <Field label="Review by *" name="reviewDue" error={error}><input type="date" value={f.reviewDue} onChange={(e) => set({ reviewDue: e.target.value })} data-testid="pe-review" /></Field>
            <Field label="Days to acknowledge after publication" name="ackDueDays" error={error}><input type="number" min="1" max="365" value={f.ackDueDays} onChange={(e) => set({ ackDueDays: e.target.value })} /></Field>
          </fieldset>
          <fieldset disabled={!editable}><legend>Who it applies to</legend>
            <p className="muted small">Anyone who matches any of the choices below (everyone, a department, a role, a site or a project).</p>
            <label className="field field-inline"><span>Everyone in the company</span><input type="checkbox" checked={f.applicability.all} onChange={(e) => setA({ all: e.target.checked })} data-testid="pe-all" /></label>
            {!f.applicability.all && <>
              <div role="group" aria-label="Departments"><strong>Departments</strong>{departments.map((d) => <label key={d.id} className="field field-inline"><span>{label(d)}</span><input type="checkbox" checked={f.applicability.departments.includes(d.id)} onChange={() => setA({ departments: toggle(f.applicability.departments, d.id) })} data-testid={`pe-dept-${d.id}`} /></label>)}</div>
              <div role="group" aria-label="Roles"><strong>Roles</strong>{ROLES.map((r) => <label key={r} className="field field-inline"><span>{r}</span><input type="checkbox" checked={f.applicability.roles.includes(r)} onChange={() => setA({ roles: toggle(f.applicability.roles, r) })} data-testid={`pe-role-${r}`} /></label>)}</div>
              <div role="group" aria-label="Projects"><strong>Projects</strong>{projects.map((d) => <label key={d.id} className="field field-inline"><span>{label(d)}</span><input type="checkbox" checked={f.applicability.projects.includes(d.id)} onChange={() => setA({ projects: toggle(f.applicability.projects, d.id) })} /></label>)}</div>
              <Field label="Site numbers (comma separated)" name="sites" error={error}><input inputMode="numeric" value={f.applicability.sites} onChange={(e) => setA({ sites: e.target.value })} /></Field>
            </>}
            <p role="status" data-testid="pe-count">{has ? (preview ? `${preview.recipients} ${preview.recipients === 1 ? 'person' : 'people'} will have to read it${preview.sample.length ? `, for example ${preview.sample.slice(0, 4).map((u) => u.name).join(', ')}` : ''}.` : 'Counting…') : 'Choose who it applies to.'}</p>
          </fieldset>
          <fieldset disabled={!editable}><legend>Knowledge check (optional)</legend>
            <Field label="Pass mark (%)" name="passMark" error={error}><input type="number" min="1" max="100" value={f.passMark} onChange={(e) => set({ passMark: e.target.value })} data-testid="pe-passmark" /></Field>
            {f.quiz.map((qz, i) => (
              <div key={i} className="card" data-testid="pe-quiz-item"><Field label={`Question ${i + 1}`} name={`quiz.${i}.q`} error={error}><input value={qz.q} maxLength={300} onChange={(e) => set({ quiz: f.quiz.map((x, k) => (k === i ? { ...x, q: e.target.value } : x)) })} data-testid={`pe-q-${i}`} /></Field>
                {qz.options.map((o, k) => <div key={k} className="field field-inline"><input aria-label={`Option ${k + 1} of question ${i + 1}`} value={o} maxLength={160} onChange={(e) => set({ quiz: f.quiz.map((x, j) => (j === i ? { ...x, options: x.options.map((y, m) => (m === k ? e.target.value : y)) } : x)) })} data-testid={`pe-q-${i}-o-${k}`} /><label><input type="radio" name={`pe-correct-${i}`} checked={qz.correct === k} onChange={() => set({ quiz: f.quiz.map((x, j) => (j === i ? { ...x, correct: k } : x)) })} data-testid={`pe-q-${i}-c-${k}`} /> right answer</label></div>)}
                <div className="actions">{qz.options.length < 5 && <button type="button" className="btn btn-small" onClick={() => set({ quiz: f.quiz.map((x, j) => (j === i ? { ...x, options: [...x.options, ''] } : x)) })}>Add an option</button>}<button type="button" className="btn btn-small" onClick={() => set({ quiz: f.quiz.filter((_, k) => k !== i) })}>Remove the question</button></div></div>
            ))}
            {f.quiz.length < 20 && <button type="button" className="btn" onClick={() => set({ quiz: [...f.quiz, { q: '', options: ['', ''], correct: 0 }] })} data-testid="pe-add-q">Add a question</button>}
          </fieldset>
          <div className="actions">
            {editable && <><button type="submit" className="btn" disabled={busy || !f.title.trim()} data-testid="pe-save">Save as a draft</button><button type="button" className="btn btn-primary btn-large" disabled={busy || !f.title.trim() || !dirty && !id} onClick={submit} data-testid="pe-submit">Send for approval</button></>}
            <button type="button" className="btn" onClick={() => { if (!dirty || window.confirm('Leave without saving your changes?')) navigateTo(id ? `/collab/policies?id=${id}` : '/collab/policies'); }} data-testid="pe-cancel">Cancel</button>
          </div>
          {!editable && id && <p className="muted small" role="status">{working ? `This version is ${STATUS[working.status][1].toLowerCase()} and cannot be edited.` : 'A published policy is never edited.'}</p>}
        </form>
      )}
      {tab === 'requirements' && q.data && (q.data.working || q.data.current) && <Requirements policy={q.data} version={q.data.working ?? q.data.current} canTag={q.data.can.tag} />}
      {tab === 'compare' && (
        <section aria-label="Compare versions" data-testid="pe-compare"><h2>Compare versions</h2>
          {versions.length < 2 ? <p className="muted">There is only one version so far.</p> : <>
            <div className="srch-form"><Field label="From" name="from" error={null}><select value={cmp.from} onChange={(e) => setCmp({ ...cmp, from: e.target.value })} data-testid="cmp-from"><option value="">Choose</option>{versions.map((v) => <option key={v.id} value={v.id}>Version {v.version}</option>)}</select></Field>
              <Field label="To" name="to" error={null}><select value={cmp.to} onChange={(e) => setCmp({ ...cmp, to: e.target.value })} data-testid="cmp-to"><option value="">Choose</option>{versions.map((v) => <option key={v.id} value={v.id}>Version {v.version}</option>)}</select></Field></div>
            {diff.data && <Diff d={diff.data} />}</>}
        </section>
      )}
      <span className="sr-only">{session?.user}</span>
    </section>
  );
}

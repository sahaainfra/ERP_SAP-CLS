import { useEffect, useState } from 'react';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useBuilder, useDryRun, useRule, useSaveRule } from '../../platform/alerts/api.js';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from './common.js';
import { ACTION_LABEL, OP_LABEL, OUTCOME, SEVERITY, TOKENS } from './alerts-common.js';

// Rule Builder (part 04.09, section 7.2): the trigger (an event of the system, or a schedule over something a module offers), the conditions over its fields, the actions, the window within which
// the same alert is not repeated, and a try-out that shows what the rule would do on today's data before it is saved. A rule that sends something outside says so and goes for approval.
const BLANK = { code: '', name: '', description: '', triggerType: 'SCHEDULE', eventType: '', schedule: 'DAILY@07', dataset: '', conditions: [], actions: [{ type: 'notify', to: ['owner'], channels: [] }], messageTemplate: '', throttleMinutes: 1440, severity: 'WARNING', ownerModule: '', ownerRole: 'SYSADM', enabled: true, reason: '' };
const scalar = (v) => (v === 'true' ? true : v === 'false' ? false : v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v);
const fromRule = (r) => ({ ...BLANK, code: r.code, name: r.name, description: r.description ?? '', triggerType: r.triggerType, eventType: r.eventType ?? '', schedule: r.schedule ?? 'DAILY@07', dataset: r.dataset ?? '', conditions: (r.condition.all ?? []).map((c) => ({ ...c, value: Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '') })), actions: r.actions.map((a) => ({ channels: [], to: [], ...a })), messageTemplate: r.messageTemplate, throttleMinutes: r.throttleMinutes, severity: r.severity, ownerModule: r.ownerModule, ownerRole: r.ownerRole, enabled: r.enabled, version: r.version });
const toBody = (f) => ({
  code: f.code, name: f.name, ...(f.description ? { description: f.description } : {}), triggerType: f.triggerType, ...(f.triggerType === 'EVENT' ? { eventType: f.eventType } : { schedule: f.schedule, dataset: f.dataset }),
  condition: { all: f.conditions.filter((c) => c.field).map((c) => ({ field: c.field, op: c.op, ...(['empty', 'notEmpty'].includes(c.op) ? {} : { value: ['in', 'nin'].includes(c.op) ? String(c.value).split(',').map((x) => scalar(x.trim())).filter((x) => x !== '') : scalar(String(c.value)) }) })) },
  actions: f.actions.map((a) => {
    const o = { type: a.type };
    if (a.type === 'notify') { o.to = a.to; if (a.channels?.length) o.channels = a.channels; }
    if (a.type === 'task') Object.assign(o, { title: a.title, assignee: a.assignee, dueDays: Number(a.dueDays ?? 7), ...(a.priority ? { priority: a.priority } : {}) });
    if (a.type === 'escalate') o.role = a.role;
    if (a.type === 'webhook') Object.assign(o, { connector: a.connector, path: a.path });
    if (a.type === 'flag') o.flag = a.flag;
    return o;
  }),
  messageTemplate: f.messageTemplate, throttleMinutes: Number(f.throttleMinutes), severity: f.severity, ownerModule: f.ownerModule || 'custom', ownerRole: f.ownerRole, enabled: f.enabled,
});
const sendsOutside = (f) => f.actions.some((a) => a.type === 'webhook' || (a.type === 'notify' && a.channels?.length));

export default function RuleBuilderPage() {
  usePageTitle('Rule Builder');
  const code = useSearch().get('code');
  const b = useBuilder();
  const existing = useRule(code);
  const save = useSaveRule();
  const dry = useDryRun();
  const [f, setF] = useState(BLANK);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { const r = existing.data?.active ?? existing.data?.pending; if (r && !loaded) { setF(fromRule(r)); setLoaded(true); } }, [existing.data, loaded]);
  if (b.error?.status === 403) return <NoPermission what="the rule builder" permission="alr.rule.view" />;
  if (b.isPending || (code && existing.isPending)) return <section aria-labelledby="rb-title"><h1 id="rb-title">Rule Builder</h1><Skeleton label="Loading the builder" rows={4} /></section>;
  if (b.isError) return <ErrorState title="The builder could not be loaded" error={b.error} onRetry={() => b.refetch()} />;
  const d = b.data;
  const ds = d.datasets.find((x) => x.code === f.dataset);
  const fields = f.triggerType === 'SCHEDULE' ? ds?.fields ?? [] : null;
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const setAction = (i, p) => set({ actions: f.actions.map((a, j) => (j === i ? { ...a, ...p } : a)) });
  const setCond = (i, p) => set({ conditions: f.conditions.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const submit = (e) => {
    e.preventDefault();
    setError(null);
    setNotice('');
    save.mutate({ ...toBody(f), reason: f.reason, ...(f.version ? { version: f.version } : {}) }, {
      onSuccess: (r) => { setNotice(r.status === 'PENDING' ? 'This rule sends messages outside, so it was sent for approval by the process owner and the system administrator. The version in force is unchanged until then.' : `Saved as version ${r.version}.`); if (r.status === 'ACTIVE') navigateTo('/admin/alert-rules'); },
      onError: (er) => setError(errorInfo(er)),
    });
  };
  const tryIt = () => { setError(null); dry.mutate({ draft: toBody(f) }, { onSuccess: setPreview, onError: (er) => { setPreview(null); setError(errorInfo(er)); } }); };
  const err = (path) => error?.fields?.[path];
  return (
    <section aria-labelledby="rb-title" data-testid="rule-builder">
      <h1 id="rb-title">Rule Builder</h1>
      <p className="muted">Say what to watch, when it counts, and what to do. Try it on today&apos;s data before you save.</p>
      {notice && <p role="status" className="notice" data-testid="rb-notice">{notice}</p>}
      {code && existing.data?.pending && <p role="status" className="notice">A change of this rule is waiting for approval; another cannot be sent until it is decided.</p>}
      <form className="form-grid" onSubmit={submit} aria-label="Rule" data-testid="rule-form">
        <fieldset className="card"><legend>The rule</legend>
          <div className="wf-inline">
            <Field label="Code (for example task.overdue)" name="code" error={error}><input value={f.code} disabled={Boolean(code)} maxLength={60} onChange={(e) => set({ code: e.target.value.trim() })} /></Field>
            <Field label="Name" name="name" error={error}><input value={f.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Module that owns it" name="ownerModule" error={error}><input value={f.ownerModule} maxLength={40} onChange={(e) => set({ ownerModule: e.target.value })} /></Field>
          </div>
          <Field label="What it is for" name="description" error={error}><input value={f.description} maxLength={500} onChange={(e) => set({ description: e.target.value })} /></Field>
        </fieldset>
        <fieldset className="card"><legend>When</legend>
          <div role="radiogroup" aria-label="Trigger" className="wf-inline">
            <label><input type="radio" name="trigger" checked={f.triggerType === 'SCHEDULE'} onChange={() => set({ triggerType: 'SCHEDULE' })} /> On a schedule, over records</label>
            <label><input type="radio" name="trigger" checked={f.triggerType === 'EVENT'} onChange={() => set({ triggerType: 'EVENT' })} /> When an event happens</label>
          </div>
          {f.triggerType === 'SCHEDULE' ? (
            <div className="wf-inline">
              <label className="field"><span>Look at</span><select value={f.dataset} onChange={(e) => set({ dataset: e.target.value, conditions: [] })}><option value="">Choose</option>{d.datasets.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></label>
              <label className="field"><span>How often</span><select value={f.schedule} onChange={(e) => set({ schedule: e.target.value })}><option value="HOURLY">Every hour</option>{Array.from({ length: 24 }, (_, h) => <option key={h} value={`DAILY@${String(h).padStart(2, '0')}`}>Every day at {String(h).padStart(2, '0')}:00</option>)}{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((n, i) => <option key={n} value={`WEEKLY@${i}`}>Every {n}</option>)}</select></label>
              {err('dataset') && <p role="alert" className="error small">{err('dataset')}</p>}
              {err('schedule') && <p role="alert" className="error small">{err('schedule')}</p>}
            </div>
          ) : (
            <label className="field"><span>Event</span><select value={f.eventType} onChange={(e) => set({ eventType: e.target.value })}><option value="">Choose</option>{d.events.map((x) => <option key={x.type} value={x.type}>{x.type}</option>)}</select>
              {err('eventType') && <span role="alert" className="error small">{err('eventType')}</span>}</label>
          )}
        </fieldset>
        <fieldset className="card" data-testid="conditions"><legend>Only if</legend>
          {f.conditions.length === 0 && <p className="muted small">No condition: every record or event counts.</p>}
          {f.conditions.map((c, i) => (
            <div key={i} className="wf-inline" data-testid={`cond-${i}`}>
              {fields ? <label className="field"><span>Field</span><select value={c.field} onChange={(e) => setCond(i, { field: e.target.value })}><option value="">Choose</option>{fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
                : <Field label="Field of the event" name={`condition.${i}.field`} error={error}><input value={c.field} onChange={(e) => setCond(i, { field: e.target.value })} /></Field>}
              <label className="field"><span>Is</span><select value={c.op} onChange={(e) => setCond(i, { op: e.target.value })}>{d.ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</select></label>
              {!['empty', 'notEmpty'].includes(c.op) && <Field label={['in', 'nin'].includes(c.op) ? 'Values (comma between)' : 'Value'} name={`condition.${i}.value`} error={error}><input value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} /></Field>}
              <button type="button" className="btn btn-small" onClick={() => set({ conditions: f.conditions.filter((_, j) => j !== i) })}>Remove</button>
              {err(`condition.${i}.field`) && <p role="alert" className="error small">{err(`condition.${i}.field`)}</p>}
            </div>))}
          <button type="button" className="btn" onClick={() => set({ conditions: [...f.conditions, { field: '', op: 'eq', value: '' }] })}>Add a condition</button>
        </fieldset>
        <fieldset className="card" data-testid="actions"><legend>Then</legend>
          {f.actions.map((a, i) => (
            <div key={i} className="card" data-testid={`action-${i}`}>
              <div className="wf-inline">
                <label className="field"><span>Do</span><select value={a.type} onChange={(e) => setAction(i, { type: e.target.value })}>{d.actions.map((t) => <option key={t} value={t}>{ACTION_LABEL[t]}</option>)}</select></label>
                {f.actions.length > 1 && <button type="button" className="btn btn-small" onClick={() => set({ actions: f.actions.filter((_, j) => j !== i) })}>Remove this action</button>}
              </div>
              {a.type === 'notify' && <>
                <div role="group" aria-label="Who is told" className="wf-inline">{TOKENS.map(([k, l]) => <label key={k}><input type="checkbox" checked={a.to.includes(k)} onChange={() => setAction(i, { to: toggle(a.to, k) })} /> {l}</label>)}</div>
                <label className="field"><span>Roles told too (codes, comma between)</span><input value={a.to.filter((x) => x.startsWith('role:')).map((x) => x.slice(5)).join(', ')} onChange={(e) => setAction(i, { to: [...a.to.filter((x) => !x.startsWith('role:')), ...e.target.value.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean).map((x) => `role:${x}`)] })} /></label>
                <div role="group" aria-label="Also by" className="wf-inline">{['EMAIL', 'SMS', 'WHATSAPP'].map((ch) => <label key={ch}><input type="checkbox" checked={(a.channels ?? []).includes(ch)} onChange={() => setAction(i, { channels: toggle(a.channels ?? [], ch) })} /> Also by {ch === 'EMAIL' ? 'e-mail' : ch === 'SMS' ? 'text message' : 'WhatsApp'}</label>)}</div>
              </>}
              {a.type === 'task' && <div className="wf-inline">
                <Field label="Task title (may use {{fields}})" name={`actions.${i}.title`} error={error}><input value={a.title ?? ''} onChange={(e) => setAction(i, { title: e.target.value })} /></Field>
                <label className="field"><span>Given to</span><select value={a.assignee ?? ''} onChange={(e) => setAction(i, { assignee: e.target.value })}><option value="">Choose</option>{TOKENS.slice(0, 3).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <Field label="Days to do it" name={`actions.${i}.dueDays`} error={error}><input type="number" min="0" max="365" value={a.dueDays ?? 7} onChange={(e) => setAction(i, { dueDays: e.target.value })} /></Field>
              </div>}
              {a.type === 'escalate' && <label className="field"><span>Escalate to the role</span><select value={a.role ?? ''} onChange={(e) => setAction(i, { role: e.target.value })}><option value="">Choose</option>{d.roles.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>}
              {a.type === 'webhook' && <div className="wf-inline">
                <label className="field"><span>Connector</span><select value={a.connector ?? ''} onChange={(e) => setAction(i, { connector: e.target.value })}><option value="">Choose</option>{d.connectors.map((c) => <option key={c.code} value={c.code}>{c.code} ({c.type})</option>)}</select></label>
                <Field label="Path (starts with /)" name={`actions.${i}.path`} error={error}><input value={a.path ?? ''} onChange={(e) => setAction(i, { path: e.target.value })} /></Field>
              </div>}
              {a.type === 'flag' && <Field label="Flag (lower case)" name={`actions.${i}.flag`} error={error}><input value={a.flag ?? ''} onChange={(e) => setAction(i, { flag: e.target.value })} /></Field>}
              {['to', 'channels', 'title', 'assignee', 'role', 'connector', 'flag'].map((k) => err(`actions.${i}.${k}`) && <p key={k} role="alert" className="error small">{err(`actions.${i}.${k}`)}</p>)}
            </div>))}
          <button type="button" className="btn" onClick={() => set({ actions: [...f.actions, { type: 'notify', to: ['owner'], channels: [] }] })}>Add an action</button>
          {sendsOutside(f) && <p role="status" className="notice" data-testid="outside-note">This rule sends messages outside the system. It goes to the process owner and the system administrator for approval before it is in force.</p>}
        </fieldset>
        <fieldset className="card"><legend>The alert</legend>
          <Field label="Message (may use {{fields}} of what it looks at)" name="messageTemplate" error={error}><input value={f.messageTemplate} maxLength={500} onChange={(e) => set({ messageTemplate: e.target.value })} /></Field>
          {ds && <p className="muted small">Fields: {ds.fields.map((x) => <code key={x.key}>{`{{${x.key}}} `}</code>)}</p>}
          <div className="wf-inline">
            <label className="field"><span>Severity</span><select value={f.severity} onChange={(e) => set({ severity: e.target.value })}>{Object.entries(SEVERITY).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <Field label="Do not repeat the same alert within (minutes)" name="throttleMinutes" error={error}><input type="number" min="0" max="525600" value={f.throttleMinutes} onChange={(e) => set({ throttleMinutes: e.target.value })} /></Field>
            <label className="field"><span>Process owner role</span><select value={f.ownerRole} onChange={(e) => set({ ownerRole: e.target.value })}>{d.roles.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <label className="field"><span><input type="checkbox" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Switched on</span></label>
          </div>
        </fieldset>
        <Field label="Reason for saving it" name="reason" error={error}><input value={f.reason} maxLength={500} onChange={(e) => set({ reason: e.target.value })} /></Field>
        {error?.form && <p role="alert" className="error" data-testid="rb-error">{error.form}</p>}
        <div className="actions">
          <button type="button" className="btn" disabled={dry.isPending} onClick={tryIt}>Try it on today&apos;s data</button>
          {d.canEdit && <button type="submit" className="btn btn-primary" disabled={save.isPending || f.reason.trim().length < 5}>{sendsOutside(f) ? 'Send for approval' : 'Save the rule'}</button>}
          <Link to="/admin/alert-rules">Back to the rules</Link>
        </div>
      </form>
      {preview && (
        <section className="card" aria-live="polite" aria-label="Preview" data-testid="rb-preview">
          <h2>What it would do now</h2>
          <p>Looked at {preview.looked} record(s): <strong data-testid="prev-matched">{preview.matched}</strong> match, {preview.wouldCreate} new alert(s), {preview.throttled} held back. Nothing was written.</p>
          {preview.error && <p role="alert" className="error">{preview.error}</p>}
          <ul>{preview.items.map((i) => <li key={`${i.entity}-${i.entityId}`}><strong>{i.label}</strong>: {i.message} <span className="muted small">({OUTCOME[i.outcome]}; {i.actions.join('; ') || 'no action'})</span></li>)}</ul>
        </section>)}
    </section>
  );
}

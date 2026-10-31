import { useRef, useState } from 'react';
import { Field, FormDialog, Link, Pager, QueryState, can, errorInfo, usePageTitle } from '../../core/pages/ui.jsx';
import { useRequestRuleChange, useSodRule, useSodRules, useSodTest, useSwitchOffRule } from '../api/privileged.js';
import { useRoles } from '../api/access.js';
import { useUsers } from '../api/users.js';
import { SeverityChip } from '../components/privilegedCommon.jsx';

const lines = (text) => String(text ?? '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

/** A rule in full: both sides, the conditions and the requests made about it. */
function RuleDetail({ id, onClose, manage, onChange, onSwitchOff }) {
  const q = useSodRule(id);
  const r = q.data;
  return (
    <aside className="card" aria-labelledby="rule-detail-title" data-testid="rule-detail">
      <div className="page-head"><h2 id="rule-detail-title">{r ? `${r.code} ${r.name}` : 'Rule'}</h2><button type="button" className="btn btn-small" onClick={onClose}>Close</button></div>
      <QueryState query={q} what="the rule" permission="iam.sod.view" />
      {r && (
        <>
          <p>{r.description}</p>
          <dl className="kv">
            <dt>When it applies</dt><dd>{r.kind === 'PERMISSION' ? 'What a person holds (any two permissions that conflict)' : `Actions on the same ${r.scope.toLowerCase()}`}</dd>
            <dt>If broken</dt><dd><SeverityChip severity={r.severity} /> {r.active ? '' : '(switched off)'}</dd>
            <dt>Side A</dt><dd>{r.setA.map((x) => <code key={x}>{x} </code>)}</dd>
            <dt>Side B</dt><dd>{r.setB.map((x) => <code key={x}>{x} </code>)}</dd>
            {r.conditions?.minAmountPaise != null && <><dt>Only from</dt><dd>{(r.conditions.minAmountPaise / 100).toLocaleString('en-IN')} rupees</dd></>}
            <dt>Open violations</dt><dd><Link to={`/admin/sod/violations?ruleId=${r.id}`}>{r.openViolations}</Link></dd>
          </dl>
          {r.requests.length > 0 && <><h3>Changes asked for</h3><ul>{r.requests.map((x) => <li key={x.id}>#{x.id} {x.title}: <strong>{x.status.toLowerCase()}</strong></li>)}</ul></>}
          {manage && <div className="actions"><button type="button" className="btn" onClick={() => onChange(r)}>Propose a change</button>{r.active && <button type="button" className="btn" onClick={() => onSwitchOff(r)}>Switch off</button>}</div>}
        </>
      )}
    </aside>
  );
}

/** Try the rules on a person: what they hold now, and what one more role would do. */
function TestPanel() {
  const [userId, setUserId] = useState('');
  const [roleId, setRoleId] = useState('');
  const users = useUsers({ pageSize: 200, sort: 'displayName' });
  const roles = useRoles({ pageSize: 100, filters: { status: 'ACTIVE' } });
  const test = useSodTest({ userId, roleId });
  const out = test.data;
  const rows = (list) => list.map((c) => <li key={c.rule}><SeverityChip severity={c.severity} /> <strong>{c.rule}</strong> {c.name}: {c.a.join(', ')} ({c.rolesA.join(', ')}) with {c.b.join(', ')} ({c.rolesB.join(', ')})</li>);
  return (
    <section className="card" aria-labelledby="test-title" data-testid="rule-test">
      <h2 id="test-title">Test the rules on a person</h2>
      <div className="form-grid">
        <label className="field"><span>Person</span>
          <select aria-label="Person to test" value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Choose a person...</option>{(users.data?.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.displayName} ({u.username})</option>)}</select>
        </label>
        <label className="field"><span>If they were also given (optional)</span>
          <select aria-label="Role to try" value={roleId} onChange={(e) => setRoleId(e.target.value)}><option value="">No extra role</option>{(roles.data?.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.code} - {r.name}</option>)}</select>
        </label>
      </div>
      {test.isError && <p className="field-error" role="alert">{errorInfo(test.error).form}</p>}
      {out && (
        <div role="status" aria-live="polite">
          <h3>Holds now</h3>
          {out.now.length === 0 ? <p>No conflicts.</p> : <ul>{rows(out.now)}</ul>}
          {out.withRole && (
            <>
              <h3>With {out.withRole.role}</h3>
              <p><strong data-testid="test-verdict">{out.withRole.allowed ? 'Allowed' : 'Blocked'}</strong>{out.withRole.conflicts.length === 0 ? ': no new conflict.' : ': new conflicts:'}</p>
              {out.withRole.conflicts.length > 0 && <ul>{rows(out.withRole.conflicts)}</ul>}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Segregation-of-duties rules: the standard ten, the changes asked for, and a way to test them. */
export default function SodRulesPage({ session }) {
  usePageTitle('Segregation of Duties Rules');
  const manage = can(session, 'iam.sod.manage');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({});
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [off, setOff] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const list = useSodRules({ page, pageSize: 25, q, sort: 'code', filters });
  const request = useRequestRuleChange();
  const switchOff = useSwitchOffRule();
  const dialog = useRef(null);
  const offDialog = useRef(null);
  const rows = list.data?.data ?? [];

  const open = (rule) => { setEditing(rule ?? null); setError(null); dialog.current?.showModal(); };
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Segregation of duties &rsaquo; Rules</nav>
      <div className="page-head"><h1 id="page-title">Segregation of Duties Rules</h1>{manage && <button type="button" className="btn btn-primary" onClick={() => open(null)}>Propose a rule</button>}</div>
      <p className="muted">These rules keep one person from holding duties that must stay apart. A rule that blocks stops the action and names the conflict; one that warns lets it through and records it. A change to a rule needs the auditor or the director to approve it.</p>
      <p role="status" className="notice" data-testid="rule-notice">{notice}</p>
      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search rules</span><input type="search" placeholder="Search code or name" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <label className="field field-inline"><span className="sr-only">Severity</span>
          <select aria-label="Severity" value={filters.severity ?? ''} onChange={(e) => { setFilters((f) => ({ ...f, severity: e.target.value })); setPage(1); }}><option value="">If broken: any</option><option value="BLOCK">Blocks</option><option value="WARN">Warns</option><option value="DETECT">Detects</option></select>
        </label>
      </div>
      <QueryState query={list} what="the rules" permission="iam.sod.view" />
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Segregation of duties rules</caption>
              <thead><tr><th>Code</th><th>Rule</th><th>Applies to</th><th>If broken</th><th>Open violations</th><th>State</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid={`rule-${r.code}`}>
                    <td data-label="Code"><code>{r.code}</code></td>
                    <td data-label="Rule">{r.name}</td>
                    <td data-label="Applies to">{r.kind === 'PERMISSION' ? 'What a person holds' : `Actions on one ${r.scope.toLowerCase()}`}</td>
                    <td data-label="If broken"><SeverityChip severity={r.severity} /></td>
                    <td data-label="Open violations">{r.openViolations}</td>
                    <td data-label="State">{r.active ? 'On' : 'Off'}</td>
                    <td data-label="Actions"><button type="button" className="btn btn-small" aria-label={`Open rule ${r.code}`} onClick={() => setSelected(r.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="rules" />
        </>
      )}
      {selected && <RuleDetail id={selected} manage={manage} onClose={() => setSelected(null)} onChange={open} onSwitchOff={(r) => { setOff(r); setError(null); offDialog.current?.showModal(); }} />}
      <TestPanel />

      <FormDialog
        dialogRef={dialog}
        title={editing ? `Propose a change to ${editing.code}` : 'Propose a new rule'}
        submitLabel="Send for approval"
        error={error}
        busy={request.isPending}
        onSubmit={async (f) => {
          setError(null);
          try {
            const rule = {
              code: String(f.get('code')), name: String(f.get('name')), description: String(f.get('description') ?? ''), kind: String(f.get('kind')), setA: lines(f.get('setA')), setB: lines(f.get('setB')),
              scope: String(f.get('kind')) === 'PERMISSION' ? 'USER' : String(f.get('scope')), severity: String(f.get('severity')),
              conditions: f.get('minAmount') ? { minAmountPaise: Math.round(Number(f.get('minAmount')) * 100) } : {}, active: true,
            };
            const out = await request.mutateAsync({ ruleId: editing?.id, rule, reason: String(f.get('reason')) });
            dialog.current?.close();
            setNotice(`Request ${out.id} was raised and waits for the auditor or the director.`);
          } catch (err) { setError(errorInfo(err)); }
        }}
      >
        <div key={editing?.id ?? 'new'} className="form-grid">
          <Field label="Code *" name="code" error={error} hint="For example SOD-11"><input name="code" required defaultValue={editing?.code ?? ''} readOnly={Boolean(editing)} maxLength={20} /></Field>
          <Field label="Name *" name="name" error={error}><input name="name" required minLength={3} maxLength={120} defaultValue={editing?.name ?? ''} /></Field>
          <Field label="What it protects" name="description" error={error}><input name="description" maxLength={500} defaultValue={editing?.description ?? ''} /></Field>
          <Field label="Kind *" name="kind" error={error}><select name="kind" defaultValue={editing?.kind ?? 'ACTION'}><option value="ACTION">Actions on one document, vendor, period or project</option><option value="PERMISSION">Permissions a person holds</option></select></Field>
          <Field label="Scope (for actions)" name="scope" error={error}><select name="scope" defaultValue={editing?.scope === 'USER' ? 'DOCUMENT' : editing?.scope ?? 'DOCUMENT'}><option value="DOCUMENT">Same document</option><option value="VENDOR">Same vendor</option><option value="PERIOD">Same period</option><option value="PROJECT">Same project</option></select></Field>
          <Field label="Side A *" name="setA" error={error} hint="One per line. A * stands for any text, for example *.create"><textarea name="setA" rows="3" required defaultValue={editing?.setA.join('\n') ?? ''} /></Field>
          <Field label="Side B *" name="setB" error={error} hint="No one person may do or hold both sides"><textarea name="setB" rows="3" required defaultValue={editing?.setB.join('\n') ?? ''} /></Field>
          <Field label="If broken *" name="severity" error={error}><select name="severity" defaultValue={editing?.severity ?? 'BLOCK'}><option value="BLOCK">Block it</option><option value="WARN">Warn and record</option><option value="DETECT">Record only</option></select></Field>
          <Field label="Only above (rupees, optional)" name="minAmount" error={error}><input name="minAmount" type="number" min="0" step="1" defaultValue={editing?.conditions?.minAmountPaise != null ? editing.conditions.minAmountPaise / 100 : ''} /></Field>
        </div>
      </FormDialog>
      <FormDialog
        dialogRef={offDialog}
        title={off ? `Switch off ${off.code}` : 'Switch off a rule'}
        submitLabel="Send for approval"
        error={error}
        busy={switchOff.isPending}
        onSubmit={async (f) => {
          setError(null);
          try {
            const out = await switchOff.mutateAsync({ id: off.id, reason: String(f.get('reason')) });
            offDialog.current?.close();
            setNotice(`Request ${out.id} was raised to switch off ${off.code}. It stays on until it is approved.`);
          } catch (err) { setError(errorInfo(err)); }
        }}
      >
        <p className="muted">The rule stays in force until the auditor or the director approves.</p>
      </FormDialog>
    </section>
  );
}

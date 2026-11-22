import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { Card } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { useSession } from '../core/api/index.js';
import { Field, can, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from '../bi/api.js';

// Part 29.03: public API clients and keys (list report, UI v3 §3.1), webhooks with their delivery logs, the developer portal with a sandbox
// try-it, and the usage per client and tier. A client's secret and a webhook's signing secret are shown once, when made. A client with a
// write scope is active only after the director approves it.

const read = async (path) => (await api.get(path)).data;
const write = (path, body) => api.post(path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/admin/api${p.toString() ? `?${p}` : ''}`);
};
const CL = { PENDING_APPROVAL: 'IN_REVIEW', ACTIVE: 'APPROVED', SUSPENDED: 'AT_RISK', REVOKED: 'CANCELLED', REJECTED: 'REJECTED' };
const DL = { PENDING: 'DRAFT', DELIVERED: 'APPROVED', FAILED: 'IN_REVIEW', DEAD: 'REJECTED' };

function Secret({ label, value, onDone }) {
  const t = useT('dev');
  const [copied, setCopied] = useState(false);
  return <div className="dev-secret" role="alert" data-testid="dev-secret">
    <strong>{label}</strong><p className="small">{t('secretOnce')}</p>
    <code className="dev-code">{value}</code>
    <div className="actions-row"><button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setCopied(false); } }}>{copied ? t('copied') : t('copy')}</button>
      <button type="button" className="btn btn-primary" onClick={onDone}>{t('saved')}</button></div>
  </div>;
}

function Clients() {
  const t = useT('dev');
  const { dateTime, number } = useFormat();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['dev', 'clients'], queryFn: () => read('/admin/api/clients'), retry: false });
  const [f, setF] = useState({ name: '', role: '', scopes: [], tier: 'STANDARD', environment: 'SANDBOX', reason: '' });
  const [shown, setShown] = useState(null);
  const [why, setWhy] = useState({});
  const done = (r) => { setShown({ title: r.data.name, clientId: r.data.clientId, secret: r.data.clientSecret }); cache.invalidateQueries({ queryKey: ['dev'] }); };
  const create = useMutation({ mutationFn: () => write('/admin/api/clients', f), onSuccess: (r) => { done(r); setF({ ...f, name: '', scopes: [], reason: '' }); } });
  const rotate = useMutation({ mutationFn: (c) => write(`/admin/api/clients/${c.id}/rotate`, { reason: why[c.id] }), onSuccess: done });
  const revoke = useMutation({ mutationFn: (c) => write(`/admin/api/clients/${c.id}/revoke`, { reason: why[c.id] }), onSuccess: () => cache.invalidateQueries({ queryKey: ['dev'] }) });
  const act = useMutation({ mutationFn: ({ c, action }) => write(`/admin/api/clients/requests/${c.requestId}/act`, { action, comment: why[c.id] || undefined }), onSuccess: () => cache.invalidateQueries({ queryKey: ['dev'] }) });
  if (q.isPending) return <Skeleton label={t('tab.clients')} rows={4} />;
  if (q.error?.status === 403) return <NoPermission message={q.error.message} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const writes = f.scopes.some((s) => d.scopes.find((x) => x.code === s)?.write);
  const err = create.error ?? rotate.error ?? revoke.error ?? act.error;
  return <>
    {shown && <Secret label={t('secretFor', { name: shown.title, id: shown.clientId })} value={shown.secret} onDone={() => setShown(null)} />}
    {d.canManage && <Card title={t('newClient')} subtitle={t('newClientSub')} testid="dev-new">
      <form className="dev-form" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field name="dev-name" label={t('name')}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={3} maxLength={80} /></Field>
        <Field name="dev-role" label={t('role')}><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} required><option value="">{t('choose')}</option>{d.roles.map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>
        <Field name="dev-tier" label={t('tier')}><select value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })}>{d.tiers.map((x) => <option key={x.code} value={x.code}>{t(`tierName.${x.code}`, { n: number(x.perMinute, { decimals: 0 }) })}</option>)}</select></Field>
        <Field name="dev-env" label={t('environment')}><select value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value })}><option value="SANDBOX">{t('env.SANDBOX')}</option><option value="LIVE">{t('env.LIVE')}</option></select></Field>
        <fieldset className="dev-scopes"><legend>{t('scopes')}</legend>{d.scopes.map((s) => <label key={s.code} className="dev-check"><input type="checkbox" checked={f.scopes.includes(s.code)} onChange={(e) => setF({ ...f, scopes: e.target.checked ? [...f.scopes, s.code] : f.scopes.filter((x) => x !== s.code) })} /> <code>{s.code}</code> {s.label}{s.write ? ` · ${t('writeScope')}` : ''}</label>)}</fieldset>
        <Field name="dev-reason" label={t('reason')}><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={5} maxLength={500} /></Field>
        {writes && <p className="small muted" data-testid="dev-needs-dir">{t('needsDir')}</p>}
        <button type="submit" className="btn btn-primary" disabled={create.isPending || !f.scopes.length} data-testid="dev-create">{t('create')}</button>
      </form>
    </Card>}
    {err && <ErrorState error={err} />}
    {!d.rows.length ? <EmptyState title={t('noClients')} message={t('noClientsBody')} /> :
      <Card title={t('tab.clients')} count={{ shown: d.rows.length, total: d.rows.length }} testid="dev-clients">
        <ul className="dev-cards">{d.rows.map((c) => <li key={c.id} className="dev-card" data-testid="dev-client">
          <div className="actions-row"><strong>{c.name}</strong><StatusBadge status={CL[c.status]} label={t(`cs.${c.status}`)} size="sm" /></div>
          <p className="small"><code>{c.clientId}</code> · {t('secretEnds', { s: c.secretHint })}{c.previousSecretUntil ? ` · ${t('oldValid', { at: dateTime(c.previousSecretUntil) })}` : ''}</p>
          <p className="muted small">{c.role} · {t(`env.${c.environment}`)} · {t(`tierName.${c.tier}`, { n: number(c.perMinute, { decimals: 0 }) })}</p>
          <p className="small">{c.scopes.map((s) => <code key={s} className="dev-chip">{s}</code>)}</p>
          <p className="muted small">{t('use30', { n: number(c.calls30d, { decimals: 0 }), e: number(c.errors30d, { decimals: 0 }), w: number(c.webhooks, { decimals: 0 }) })}{c.lastUsedAt ? ` · ${t('lastUsed', { at: dateTime(c.lastUsedAt) })}` : ''}</p>
          {(c.canApprove || (d.canManage && !['REVOKED', 'REJECTED'].includes(c.status))) && <div className="dev-decide">
            <Field name={`dev-why-${c.id}`} label={c.canApprove ? t('comment') : t('reason')}><input value={why[c.id] ?? ''} onChange={(e) => setWhy({ ...why, [c.id]: e.target.value })} /></Field>
            <div className="actions-row">
              {c.canApprove && <><button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate({ c, action: 'approve' })} data-testid="dev-approve">{t('approve')}</button>
                <button type="button" className="btn" disabled={act.isPending || (why[c.id] ?? '').trim().length < 5} onClick={() => act.mutate({ c, action: 'reject' })}>{t('reject')}</button></>}
              {d.canManage && !['REVOKED', 'REJECTED'].includes(c.status) && <><button type="button" className="btn" disabled={rotate.isPending || (why[c.id] ?? '').trim().length < 5} onClick={() => rotate.mutate(c)} data-testid="dev-rotate">{t('rotate')}</button>
                <button type="button" className="btn" disabled={revoke.isPending || (why[c.id] ?? '').trim().length < 5} onClick={() => revoke.mutate(c)}>{t('revoke')}</button></>}
            </div>
          </div>}
        </li>)}</ul>
      </Card>}
  </>;
}

function Webhooks() {
  const t = useT('dev');
  const { dateTime, number } = useFormat();
  const cache = useQueryClient();
  const search = useSearch();
  const hook = search.get('hook') ?? '';
  const status = search.get('status') ?? '';
  const q = useQuery({ queryKey: ['dev', 'hooks'], queryFn: () => read('/admin/api/webhooks'), retry: false });
  const cl = useQuery({ queryKey: ['dev', 'clients'], queryFn: () => read('/admin/api/clients'), retry: false });
  const portal = useQuery({ queryKey: ['dev', 'portal'], queryFn: () => read('/admin/api/portal'), retry: false });
  const dq = new URLSearchParams({ ...(hook ? { webhookId: hook } : {}), ...(status ? { status } : {}) }).toString();
  const log = useQuery({ queryKey: ['dev', 'log', dq], queryFn: () => read(`/admin/api/deliveries${dq ? `?${dq}` : ''}`), retry: false });
  const [f, setF] = useState({ clientRef: '', url: '', events: '' });
  const [shown, setShown] = useState(null);
  const create = useMutation({ mutationFn: () => write('/admin/api/webhooks', { clientRef: Number(f.clientRef), url: f.url.trim(), events: f.events.split(/[\s,]+/).filter(Boolean) }), onSuccess: (r) => { setShown(r.data.signingSecret); setF({ ...f, url: '', events: '' }); cache.invalidateQueries({ queryKey: ['dev'] }); } });
  const test = useMutation({ mutationFn: (w) => write(`/admin/api/webhooks/${w.id}/test`, {}), onSuccess: () => cache.invalidateQueries({ queryKey: ['dev'] }) });
  const toggle = useMutation({ mutationFn: (w) => write(`/admin/api/webhooks/${w.id}/${w.status === 'ACTIVE' ? 'disable' : 'enable'}`, {}), onSuccess: () => cache.invalidateQueries({ queryKey: ['dev'] }) });
  const replay = useMutation({ mutationFn: (d) => write(`/admin/api/deliveries/${d.id}/replay`, {}), onSuccess: () => cache.invalidateQueries({ queryKey: ['dev'] }) });
  const exp = useMutation({ mutationFn: (format) => downloadReport(`/api/v1/admin/api/deliveries/export?format=${format}${dq ? `&${dq}` : ''}`, `webhook-deliveries.${format}`) });
  if (q.isPending) return <Skeleton label={t('tab.webhooks')} rows={4} />;
  if (q.error?.status === 403) return <NoPermission message={q.error.message} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const usable = (cl.data?.rows ?? []).filter((c) => !['REVOKED', 'REJECTED'].includes(c.status));
  const err = create.error ?? test.error ?? toggle.error ?? replay.error ?? exp.error;
  return <>
    {shown && <Secret label={t('signingSecret')} value={shown} onDone={() => setShown(null)} />}
    {q.data.canManage && <Card title={t('newHook')} subtitle={t('newHookSub')} testid="dev-new-hook">
      <form className="dev-form" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field name="dev-h-client" label={t('client')}><select value={f.clientRef} onChange={(e) => setF({ ...f, clientRef: e.target.value })} required><option value="">{t('choose')}</option>{usable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field name="dev-h-url" label={t('url')}><input type="url" inputMode="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} required placeholder="https://" /></Field>
        <Field name="dev-h-events" label={t('events')}><input value={f.events} onChange={(e) => setF({ ...f, events: e.target.value })} required list="dev-event-list" /></Field>
        <datalist id="dev-event-list">{(portal.data?.scopes ?? []).flatMap((s) => s.events).map((e) => <option key={e} value={e} />)}{(portal.data?.events ?? []).map((e) => <option key={e.type} value={e.type} />)}</datalist>
        <p className="small muted">{t('eventsHelp')}</p>
        <button type="submit" className="btn btn-primary" disabled={create.isPending} data-testid="dev-h-create">{t('subscribe')}</button>
      </form>
    </Card>}
    {err && <ErrorState error={err} />}
    {!q.data.rows.length ? <EmptyState title={t('noHooks')} message={t('noHooksBody')} /> :
      <ul className="dev-cards" data-testid="dev-hooks">{q.data.rows.map((w) => <li key={w.id} className="dev-card" data-testid="dev-hook">
        <div className="actions-row"><strong className="dev-url">{w.url}</strong><StatusBadge status={w.status === 'ACTIVE' ? 'APPROVED' : 'CANCELLED'} label={t(`hs.${w.status}`)} size="sm" /></div>
        <p className="muted small">{w.client} · {t('secretEnds', { s: w.secretHint })}</p>
        <p className="small">{w.events.map((e) => <code key={e} className="dev-chip">{e}</code>)}</p>
        <p className="small">{t('hookStats', { ok: number(w.ok, { decimals: 0 }), wait: number(w.waiting, { decimals: 0 }), dead: number(w.dead, { decimals: 0 }) })}{w.lastDeliveryAt ? ` · ${t('lastDelivery', { at: dateTime(w.lastDeliveryAt) })}` : ''}</p>
        <div className="actions-row">
          <button type="button" className="btn" onClick={() => go({ hook: w.id, status: '' })}>{t('showLog')}</button>
          {q.data.canManage && <><button type="button" className="btn" disabled={test.isPending || w.status !== 'ACTIVE'} onClick={() => test.mutate(w)} data-testid="dev-ping">{t('ping')}</button>
            <button type="button" className="btn" disabled={toggle.isPending} onClick={() => toggle.mutate(w)}>{w.status === 'ACTIVE' ? t('disable') : t('enable')}</button></>}
        </div>
      </li>)}</ul>}
    <Card title={t('log')} count={log.data ? { shown: log.data.rows.length, total: log.data.total } : undefined} testid="dev-log">
      <div className="toolbar">
        <Field name="dev-l-hook" label={t('webhook')}><select value={hook} onChange={(e) => go({ hook: e.target.value })}><option value="">{t('all')}</option>{q.data.rows.map((w) => <option key={w.id} value={w.id}>{w.url}</option>)}</select></Field>
        <Field name="dev-l-status" label={t('status')}><select value={status} onChange={(e) => go({ status: e.target.value })}><option value="">{t('all')}</option>{['DELIVERED', 'FAILED', 'PENDING', 'DEAD'].map((s) => <option key={s} value={s}>{t(`ds.${s}`)}</option>)}</select></Field>
        <button type="button" className="btn" disabled={exp.isPending} onClick={() => exp.mutate('xlsx')}>{t('exportXlsx')}</button>
        <button type="button" className="btn" disabled={exp.isPending} onClick={() => exp.mutate('csv')}>{t('exportCsv')}</button>
      </div>
      {log.isPending ? <Skeleton label={t('log')} rows={3} /> : log.error ? <ErrorState error={log.error} onRetry={log.refetch} /> : !log.data.rows.length ? <p className="muted">{t('noLog')}</p> :
        <ul className="dev-cards">{log.data.rows.map((d) => <li key={d.id} className="dev-card" data-testid="dev-delivery">
          <div className="actions-row"><strong>{d.eventType}</strong><StatusBadge status={DL[d.status]} label={t(`ds.${d.status}`)} size="sm" /></div>
          <p className="muted small"><code>{d.eventId}</code> · {dateTime(d.createdAt)} · {t('attempts', { n: number(d.attempts, { decimals: 0 }) })}{d.responseCode ? ` · HTTP ${d.responseCode}` : ''}{d.replayOf ? ` · ${t('replayOf', { id: d.replayOf })}` : ''}</p>
          {d.error && <p className="small dev-problem">{d.error}</p>}
          {d.nextAttemptAt && <p className="muted small">{t('nextTry', { at: dateTime(d.nextAttemptAt) })}</p>}
          {q.data.canManage && <button type="button" className="btn" disabled={replay.isPending} onClick={() => replay.mutate(d)} data-testid="dev-replay">{t('replay')}</button>}
        </li>)}</ul>}
    </Card>
  </>;
}

const snippet = (lang, e, base) => {
  const url = `${base}${e.fullPath}`;
  if (lang === 'curl') return `TOKEN=$(curl -s -X POST ${base}/api/public/v1/oauth/token -d grant_type=client_credentials -u "$CLIENT_ID:$CLIENT_SECRET" | jq -r .access_token)\ncurl -X ${e.method} "${url}" -H "Authorization: Bearer $TOKEN"${e.method === 'POST' ? ' -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" -d @body.json' : ''}`;
  if (lang === 'js') return `const tok = await (await fetch('${base}/api/public/v1/oauth/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }) })).json();\nconst res = await fetch('${url}', { method: '${e.method}', headers: { authorization: \`Bearer \${tok.access_token}\`${e.method === 'POST' ? ", 'idempotency-key': crypto.randomUUID(), 'content-type': 'application/json'" : ''} }${e.method === 'POST' ? ', body: JSON.stringify(body)' : ''} });`;
  return `import requests, uuid\ntok = requests.post('${base}/api/public/v1/oauth/token', data={'grant_type': 'client_credentials'}, auth=(CLIENT_ID, CLIENT_SECRET)).json()['access_token']\nr = requests.${e.method.toLowerCase()}('${url}', headers={'Authorization': f'Bearer {tok}'${e.method === 'POST' ? ", 'Idempotency-Key': str(uuid.uuid4())" : ''}}${e.method === 'POST' ? ', json=body' : ''})`;
};

function Portal() {
  const t = useT('dev');
  const { number } = useFormat();
  const q = useQuery({ queryKey: ['dev', 'portal'], queryFn: () => read('/admin/api/portal'), retry: false });
  const [lang, setLang] = useState('curl');
  const [open, setOpen] = useState(null);
  const [tryit, setTry] = useState({ clientId: '', secret: '', endpoint: '', query: '' });
  const [result, setResult] = useState(null);
  const run = useMutation({ mutationFn: async () => {
    const tok = await fetch('/api/public/v1/oauth/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', client_id: tryit.clientId.trim(), client_secret: tryit.secret.trim() }) });
    const tj = await tok.json(); if (!tok.ok) return { status: tok.status, body: tj };
    const e = q.data.endpoints.find((x) => x.id === tryit.endpoint);
    const r = await fetch(`${e.fullPath}${tryit.query.trim() ? `?${tryit.query.trim().replace(/^\?/, '')}` : ''}`, { headers: { authorization: `Bearer ${tj.access_token}` } });
    return { status: r.status, body: await r.json().catch(() => null), limit: r.headers.get('ratelimit-remaining') };
  }, onSuccess: setResult });
  if (q.isPending) return <Skeleton label={t('tab.portal')} rows={6} />;
  if (q.error?.status === 403) return <NoPermission message={q.error.message} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const p = q.data; const base = window.location.origin;
  return <>
    <Card title={t('start')} testid="dev-start">
      <ol className="dev-steps"><li>{t('step1')}</li><li>{t('step2', { url: p.tokenUrl, ttl: number(p.tokenTtl / 60, { decimals: 0 }) })}</li><li>{t('step3')}</li></ol>
      <p className="small">{p.deprecationPolicy}</p>
      <p className="small">{t('versions', { v: p.versions.map((v) => `${v.version} (${v.status.toLowerCase()})`).join(', ') })} · {t('tiers', { t: p.tiers.map((x) => `${x.code} ${x.perMinute}/min`).join(', ') })}</p>
    </Card>
    <Card title={t('endpoints')} count={{ shown: p.endpoints.length, total: p.endpoints.length }} testid="dev-endpoints">
      <div role="tablist" aria-label={t('language')} className="tabs">{['curl', 'js', 'python'].map((l) => <button key={l} type="button" role="tab" aria-selected={lang === l} className={`btn${lang === l ? ' btn-primary' : ''}`} onClick={() => setLang(l)}>{t(`lang.${l}`)}</button>)}</div>
      <ul className="dev-cards">{p.endpoints.map((e) => <li key={e.id} className="dev-card" data-testid="dev-endpoint">
        <div className="actions-row"><strong><code>{e.method} {e.fullPath}</code></strong>{e.deprecated ? <StatusBadge status="AT_RISK" label={t('deprecated', { d: e.sunset })} size="sm" /> : <StatusBadge status="APPROVED" label={e.version} size="sm" />}</div>
        <p className="small">{e.summary}</p>
        <p className="muted small">{t('needs', { s: e.scope })}{e.bulk ? ` · ${t('bulkOk')}` : ''}{e.replacement ? ` · ${t('useInstead', { r: e.replacement })}` : ''}</p>
        <button type="button" className="btn" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? t('hideCode') : t('showCode')}</button>
        {open === e.id && <pre className="dev-code" data-testid="dev-snippet">{snippet(lang, e, base)}</pre>}
      </li>)}</ul>
    </Card>
    <Card title={t('tryIt')} subtitle={t('tryItSub')} testid="dev-try">
      <form className="dev-form" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
        <Field name="dev-t-client" label={t('clientId')}><input value={tryit.clientId} onChange={(e) => setTry({ ...tryit, clientId: e.target.value })} list="dev-sandbox" required autoComplete="off" /></Field>
        <datalist id="dev-sandbox">{p.sandbox.map((c) => <option key={c.id} value={c.clientId}>{c.name}</option>)}</datalist>
        <Field name="dev-t-secret" label={t('clientSecret')}><input type="password" value={tryit.secret} onChange={(e) => setTry({ ...tryit, secret: e.target.value })} required autoComplete="off" /></Field>
        <Field name="dev-t-endpoint" label={t('endpoint')}><select value={tryit.endpoint} onChange={(e) => setTry({ ...tryit, endpoint: e.target.value })} required><option value="">{t('choose')}</option>{p.endpoints.filter((e) => e.method === 'GET').map((e) => <option key={e.id} value={e.id}>{e.method} {e.fullPath}</option>)}</select></Field>
        <Field name="dev-t-query" label={t('query')}><input value={tryit.query} onChange={(e) => setTry({ ...tryit, query: e.target.value })} placeholder="page=1&pageSize=5" /></Field>
        <button type="submit" className="btn btn-primary" disabled={run.isPending} data-testid="dev-t-send">{t('send')}</button>
      </form>
      {run.error && <ErrorState error={run.error} />}
      {result && <div data-testid="dev-t-result"><p className="small"><StatusBadge status={result.status < 400 ? 'APPROVED' : 'REJECTED'} label={`HTTP ${result.status}`} size="sm" />{result.limit != null ? ` · ${t('remaining', { n: result.limit })}` : ''}</p><pre className="dev-code">{JSON.stringify(result.body, null, 2).slice(0, 4000)}</pre></div>}
    </Card>
    <Card title={t('webhookGuide')} testid="dev-sig">
      <p className="small">{t('sigHow', { h: p.signature.header, ts: p.signature.timestampHeader, id: p.signature.deliveryHeader, alg: p.signature.algorithm, tol: p.signature.toleranceSeconds })}</p>
      <pre className="dev-code">{"const expected = crypto.createHmac('sha256', SIGNING_SECRET).update(`${req.headers['x-timestamp']}.${rawBody}`).digest('hex');\nconst ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-signature'].replace('sha256=', '')));"}</pre>
      <p className="small">{t('scopeEvents')}</p>
      <ul className="dev-links">{p.scopes.map((s) => <li key={s.code}><code>{s.code}</code> — {s.label}{s.events.length ? `: ${s.events.join(', ')}` : ''}</li>)}</ul>
    </Card>
    <Card title={t('changelog')} testid="dev-changelog">
      {p.changelog.map((c) => <div key={c.date}><strong>{c.version} · {c.date}</strong><ul className="dev-links">{c.changes.map((x) => <li key={x}>{x}</li>)}</ul></div>)}
    </Card>
  </>;
}

function Usage() {
  const t = useT('dev');
  const { number } = useFormat();
  const q = useQuery({ queryKey: ['dev', 'usage'], queryFn: () => read('/admin/api/usage'), retry: false });
  if (q.isPending) return <Skeleton label={t('tab.usage')} rows={4} />;
  if (q.error?.status === 403) return <NoPermission message={q.error.message} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const u = q.data;
  return <>
    <KpiRow testid="dev-kpis" label={t('tab.usage')}>
      <KpiTile testid="dev-k-calls" kind="count" label={t('k.calls')} value={number(u.total.calls, { decimals: 0 })} tone="neutral">{t('k.days', { n: u.days })}</KpiTile>
      <KpiTile testid="dev-k-errors" kind="percent" label={t('k.errors')} value={`${u.total.errorRatePct} %`} tone={Number(u.total.errorRatePct) > 5 ? 'warning' : 'success'}>{t('k.errorsN', { n: number(u.total.errors, { decimals: 0 }) })}</KpiTile>
      <KpiTile testid="dev-k-throttled" kind="count" label={t('k.throttled')} value={number(u.total.throttled, { decimals: 0 })} tone={u.total.throttled ? 'warning' : 'success'}>{t('k.throttledHelp')}</KpiTile>
      <KpiTile testid="dev-k-dead" kind="count" label={t('k.dead')} value={number(u.deliveries.dead ?? 0, { decimals: 0 })} tone={u.deliveries.dead ? 'error' : 'success'} to="/admin/api?tab=webhooks&status=DEAD">{t('k.delivered', { n: number(u.deliveries.delivered ?? 0, { decimals: 0 }) })}</KpiTile>
    </KpiRow>
    <Card title={t('byClient')} testid="dev-by-client">
      {!u.byClient.length ? <p className="muted">{t('noUsage')}</p> : <ul className="dev-cards">{u.byClient.map((c) => <li key={c.id} className="dev-card"><div className="actions-row"><strong>{c.name}</strong><span className="small">{t(`tierName.${c.tier}`, { n: number(c.perMinute, { decimals: 0 }) })}</span></div>
        <p className="small">{t('clientUse', { n: number(c.calls, { decimals: 0 }), e: number(c.errors, { decimals: 0 }), th: number(c.throttled, { decimals: 0 }), ms: number(c.avgMs, { decimals: 0 }) })}</p></li>)}</ul>}
    </Card>
    <Card title={t('byEndpoint')} testid="dev-by-endpoint">
      {!u.byEndpoint.length ? <p className="muted">{t('noUsage')}</p> : <ul className="dev-cards">{u.byEndpoint.map((e) => <li key={e.endpoint} className="dev-card"><strong><code>{e.endpoint}</code></strong><p className="small">{t('clientUse', { n: number(e.calls, { decimals: 0 }), e: number(e.errors, { decimals: 0 }), th: '0', ms: number(e.avgMs, { decimals: 0 }) })}</p></li>)}</ul>}
    </Card>
  </>;
}

export function ApiPlatform() {
  const t = useT('dev');
  const session = useSession();
  const search = useSearch();
  usePageTitle(t('title'));
  const tabs = ['clients', 'webhooks', ...(can(session.data, 'adm.api.portal') ? ['portal'] : []), 'usage'];
  const tab = tabs.includes(search.get('tab')) ? search.get('tab') : 'clients';
  return <section aria-labelledby="dev-h" data-testid="dev-page">
    <PageHeader id="dev-h" title={t('title')} subtitle={t('subtitle')} />
    <div role="tablist" aria-label={t('title')} className="tabs" data-testid="dev-tabs">{tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} data-tab={k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => go({ tab: k === 'clients' ? '' : k, hook: '', status: '' })}>{t(`tab.${k}`)}</button>)}</div>
    {tab === 'clients' && <Clients />}
    {tab === 'webhooks' && <Webhooks />}
    {tab === 'portal' && <Portal />}
    {tab === 'usage' && <Usage />}
  </section>;
}

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../core/api/index.js';
import { navigateTo } from '../core/pages/ui.jsx';
import ListReport from '../../platform/list/ListReport.jsx';
import { api } from '../../platform/api/index.js';
import { Card } from '../../platform/design/Card.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import './portal.css';

function ErrorNotice({ error }) {
  return error && <p role="alert">{error.message}{error.correlationId && <> · Reference {error.correlationId}</>}</p>;
}

export function InvitePage() {
  const [error, setError] = useState(null);
  const [invitation, setInvitation] = useState(null);
  const [source, setSource] = useState('partner');
  const [pending, setPending] = useState(false);

  async function invite(event) {
    event.preventDefault();
    const { partnerId, contactId, stakeholderId, portalType } = Object.fromEntries(new FormData(event.currentTarget));
    setPending(true);
    setError(null);
    setInvitation(null);
    try {
      const response = await api.post('/portal/admin/invitations', {
        ...(source === 'stakeholder' ? { stakeholderId: Number(stakeholderId) } : { partnerId: Number(partnerId), contactId: Number(contactId) }), portalType,
      });
      setInvitation(response.data);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return <>
    <PageHeader title="Invite portal user" />
    <Card title="Partner contact">
      <ErrorNotice error={error} />
      <form className="portal-form" onSubmit={invite}>
        <label>Record type<select value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="partner">Partner contact</option><option value="stakeholder">Project stakeholder</option>
        </select></label>
        {source === 'stakeholder' ? <label>Stakeholder ID<input name="stakeholderId" type="number" inputMode="numeric" min="1" required /></label> : <>
          <label>Partner ID<input name="partnerId" type="number" inputMode="numeric" min="1" required /></label>
          <label>Contact ID<input name="contactId" type="number" inputMode="numeric" min="1" required /></label>
        </>}
        <label>Portal role<select name="portalType" key={source}>
          {source === 'partner' && <><option value="X-SUP">Supplier</option><option value="X-SUB">Subcontractor</option></>}
          <option value="X-CLI">Client</option><option value="X-CON">Consultant</option>
        </select></label>
        <button className="btn btn-primary" disabled={pending}>Create invitation</button>
      </form>
      {invitation && <div role="status">
        <p>Send this single-use link to the named contact. It expires after 24 hours.</p>
        <output className="portal-reference">{`${location.origin}/portal#invite=${invitation.token}`}</output>
      </div>}
    </Card>
  </>;
}

function AccountActions({ row }) {
  const base = `/portal/admin/accounts/${row.id}`;
  const [error, setError] = useState(null);
  const [requests, setRequests] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  async function run(action) {
    setBusy(true);
    setError(null);
    setResult('');
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function submit(event, action) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    void run(async () => {
      await action(fields);
      form.reset();
    });
  }

  return <details>
    <summary>Documents, notices and requests</summary>
    <ErrorNotice error={error} />
    {result && <p role="status">{result}</p>}
    <form className="portal-form" onSubmit={(event) => submit(event, async ({ versionId }) => {
      await api.post(`${base}/shares`, { versionId: Number(versionId) });
      setResult('Document shared.');
    })}>
      <label>Issued revision ID<input name="versionId" type="number" min="1" required /></label>
      <button className="btn" disabled={busy}>Share document</button>
    </form>
    <form className="portal-form" onSubmit={(event) => submit(event, async (fields) => {
      await api.post(`${base}/notices`, fields);
      setResult('Notice sent.');
    })}>
      <label>Subject<input name="subject" required minLength={3} maxLength={120} /></label>
      <label>Notice<textarea name="body" required minLength={5} maxLength={1500} /></label>
      <button className="btn" disabled={busy}>Send notice</button>
    </form>
    <button className="btn" disabled={busy} type="button" onClick={() => run(async () => {
      setRequests((await api.get(`${base}/requests`)).data);
    })}>Load profile requests</button>
    {requests?.length === 0 && <p>No profile requests for this account.</p>}
    {requests?.map((item) => <article key={item.id} className="portal-item">
      <h3>{item.subject}</h3><p>{item.body}</p><p>{item.status}</p>
      {item.status === 'REQUESTED' && <form className="portal-form" onSubmit={(event) => submit(event, async ({ response }) => {
        await api.post(`${base}/requests/${item.id}/close`, { version: item.version, response });
        setRequests((await api.get(`${base}/requests`)).data);
        setResult('Request closed and response sent.');
      })}>
        <label>Response<textarea name="response" required minLength={5} maxLength={1500} /></label>
        <button className="btn" disabled={busy}>Close request and notify contact</button>
      </form>}
    </article>)}
  </details>;
}

export function AccountsPage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const endpoint = '/portal/admin/accounts';
  const canManage = session.data?.permissions?.includes('portal.account.manage');
  const canInvite = session.data?.permissions?.includes('portal.account.invite');

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`${endpoint}/${selected.id}/revoke`, { version: selected.version });
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ['list', endpoint] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return <section>
    <PageHeader title="Portal users" srOnly />
    <ListReport listCode="portal.accounts" endpoint={endpoint} title="Portal users" session={session.data}
      cardFields={['account', 'role', 'status', 'createdAt']} statusKey="status" dateKey="createdAt"
      newAction={canInvite ? { label: 'Invite portal user', onClick: () => navigateTo('/admin/portal-invite') } : undefined}
      rowActions={canManage ? (row) => [{ label: 'Manage account', onSelect: () => { setError(null); setSelected(row); } }] : undefined}
      bulkActions={[{ id: 'revoke', label: 'Revoke access', permission: 'portal.account.manage',
        confirm: (count) => `Revoke invitations and sessions for the ${count} selected accounts?`,
        run: (ids) => api.post(`${endpoint}/revoke`, { ids }).then((response) => response.data) }]}
      empty={{ title: 'No portal users yet', text: 'Accounts appear here after a partner contact or stakeholder is invited.' }}
    />
    {selected && <Card title="Manage account" subtitle={selected.role}>
      <p className="portal-reference">{selected.account}</p>
      <ErrorNotice error={error} />
      {selected.status === 'ACTIVE' && <AccountActions row={selected} />}
      {selected.status !== 'REVOKED' && <button className="btn" type="button" disabled={busy} onClick={revoke}>Revoke access</button>}
      <button className="btn" type="button" onClick={() => setSelected(null)}>Close</button>
    </Card>}
  </section>;
}

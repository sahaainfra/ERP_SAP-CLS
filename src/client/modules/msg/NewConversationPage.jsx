import { useState } from 'react';
import { usePeople, useCreateConversation } from '../../platform/messages/api.js';
import { ensureDevice, secApi, useSecureReady } from '../../platform/secure/engine.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// New conversation / New group (part 05.01, section 7.3): a person, a group, or a channel for a project, a site or a department; a conversation about a record is started from the record (or by its number).
const KINDS = [['DIRECT', 'A person'], ['GROUP', 'A group'], ['PROJECT', 'A project channel'], ['SITE', 'A site channel'], ['DEPARTMENT', 'A department channel'], ['RECORD', 'About a record']];

export default function NewConversationPage({ session }) {
  usePageTitle('New conversation');
  const [kind, setKind] = useState('DIRECT');
  const [title, setTitle] = useState('');
  const [chosen, setChosen] = useState([]);
  const [who, setWho] = useState('');
  const [place, setPlace] = useState('');
  const [entity, setEntity] = useState('sample_doc');
  const [entityId, setEntityId] = useState('');
  const [error, setError] = useState(null);
  const people = usePeople(who);
  const create = useCreateConversation();
  const ready = useSecureReady();
  const kinds = ready.data?.ready && ready.data?.canCreate ? [...KINDS, ['SECURE', 'A secure conversation (end-to-end encrypted)']] : KINDS;
  const go = async (e) => {
    e.preventDefault(); setError(null);
    try {
      if (kind === 'SECURE') {
        await ensureDevice(session); // this browser needs its keys before it can start one
        const made = await secApi.create({ members: chosen, ...(title.trim() ? { title: title.trim() } : {}) });
        navigateTo(`/collab/messages?c=${made.id}`, { force: true });
        return;
      }
      const body = { type: kind, members: chosen };
      if (title.trim()) body.title = title.trim();
      if (kind === 'PROJECT') body.projectId = Number(place);
      if (kind === 'SITE') body.siteId = Number(place);
      if (kind === 'DEPARTMENT') body.departmentId = Number(place);
      if (kind === 'RECORD') { body.entity = entity; body.entityId = entityId.trim(); }
      const r = await create.mutateAsync(body);
      navigateTo(`/collab/messages?c=${r.id}`, { force: true });
    } catch (er) { setError(errorInfo(er)); }
  };
  const lookup = { PROJECT: 'iam/projects', DEPARTMENT: 'iam/departments' }[kind];
  return (
    <section aria-labelledby="nc-title" data-testid="new-conversation">
      <PageHeader id="nc-title" title={"New conversation"} />
      <form className="card form-grid" onSubmit={go} noValidate aria-label="New conversation">
        <Field label="What for" name="type" error={error}>
          <select value={kind} onChange={(e) => { setKind(e.target.value); setChosen([]); setPlace(''); }} data-testid="nc-kind">{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        {['GROUP', 'PROJECT', 'SITE', 'DEPARTMENT', 'RECORD', 'SECURE'].includes(kind) && <Field label={kind === 'GROUP' ? 'Name of the group *' : 'Name (optional)'} name="title" error={error}><input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} data-testid="nc-title" /></Field>}
        {lookup && <LookupField id="nc-place" label={kind === 'PROJECT' ? 'Project' : 'Department'} lookup={lookup} valueKey="id" value={place} onChange={setPlace} />}
        {kind === 'SITE' && <Field label="Site number" name="siteId" error={error}><input inputMode="numeric" value={place} onChange={(e) => setPlace(e.target.value)} /></Field>}
        {kind === 'RECORD' && <>
          <Field label="Kind of record" name="entity" error={error}><select value={entity} onChange={(e) => setEntity(e.target.value)}><option value="sample_doc">Sample document</option><option value="sample_request">Sample material request</option></select></Field>
          <Field label="Record number (its id)" name="entityId" error={error}><input value={entityId} onChange={(e) => setEntityId(e.target.value)} data-testid="nc-entity" /></Field>
        </>}
        {kind === 'SECURE' && <p className="notice small" data-testid="nc-secure-note">Everything in this conversation is encrypted on your device. Each person needs secure messaging set up on one of their devices first; the people of a secure group cannot be changed later.</p>}
        {['DIRECT', 'GROUP', 'RECORD', 'SECURE'].includes(kind) && (
          <div>
            <Field label={kind === 'DIRECT' ? 'Who' : 'Add people'} name="members" error={error}><input type="search" value={who} onChange={(e) => setWho(e.target.value)} data-testid="nc-who" placeholder="Search by name" /></Field>
            {who && <ul aria-label="People" className="msg-people">{(people.data ?? []).filter((p) => !chosen.includes(p.username) && p.username !== session?.user).map((p) => <li key={p.username}><button type="button" className="btn btn-small" onClick={() => { setChosen(kind === 'DIRECT' ? [p.username] : [...chosen, p.username]); setWho(''); }} data-testid={`pick-${p.username}`}>{p.name} <span className="muted small">@{p.username}</span></button></li>)}</ul>}
            {chosen.length > 0 && <ul aria-label="Chosen" className="msg-people">{chosen.map((u) => <li key={u}>@{u} <button type="button" className="btn btn-small" aria-label={`Remove ${u}`} onClick={() => setChosen(chosen.filter((x) => x !== u))}>×</button></li>)}</ul>}
          </div>
        )}
        {error?.form && <p className="field-error" role="alert" data-testid="nc-error">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
        <div className="actions"><button type="submit" className="btn btn-primary btn-large" disabled={create.isPending} data-testid="nc-start">Start</button><button type="button" className="btn" onClick={() => navigateTo('/collab/messages')}>Cancel</button></div>
      </form>
    </section>
  );
}

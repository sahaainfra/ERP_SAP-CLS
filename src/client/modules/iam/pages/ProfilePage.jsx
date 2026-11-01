import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../../../platform/api/index.js';
import { browserTransport, uploadFile } from '../../../platform/files/upload.js';
import { Field, Link, QueryState, errorInfo, usePageTitle } from '../../core/pages/ui.jsx';
import { useMe } from '../api/index.js';
import { useUpdateMe } from '../api/users.js';
import { LANGUAGES, UserStatusChip, typeLabel } from '../components/userCommon.jsx';
import AppearancePanel from '../../ui/AppearancePanel.jsx';
import { useFeatureFlag } from '../../core/api/index.js';

const CHANNELS = [['email', 'Email'], ['sms', 'Text message'], ['whatsapp', 'WhatsApp'], ['inApp', 'In the application']];
const transport = browserTransport(authHeaders);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function useFileUrl(fileId) {
  return useQuery({ queryKey: ['iam', 'file-url', fileId], queryFn: async () => (await api.get(`/core/files/${fileId}/url`)).data.url, enabled: Boolean(fileId), staleTime: 4 * 60_000, retry: false });
}

/** A picture kept in the document service: choose it, it is scanned, then it becomes the photo or the signature on prints. */
function PictureField({ label, kind, userId, fileId, onChange, hint }) {
  const url = useFileUrl(fileId);
  const input = useRef(null);
  const [state, setState] = useState('');
  const [problem, setProblem] = useState('');
  const pick = async (file) => {
    if (!file) return;
    setProblem('');
    try {
      setState('Uploading...');
      const stored = await uploadFile(file, { transport, entity: 'iam_user_profile', entityId: userId });
      setState('Checking the file for viruses...');
      let status = stored.scanStatus;
      for (let i = 0; i < 40 && status === 'PENDING'; i += 1) {
        await wait(500);
        status = (await api.get(`/core/files/${stored.id}`)).data.scanStatus;
      }
      if (status !== 'CLEAN') throw new Error(status === 'PENDING' ? 'The scan is taking longer than usual. Try again in a minute.' : 'The file did not pass the virus scan.');
      await onChange(stored.id);
      setState('');
    } catch (err) {
      setState('');
      setProblem(err.message);
    }
    if (input.current) input.current.value = '';
  };
  return (
    <div className="field" data-testid={`picture-${kind}`}>
      <span>{label}</span>
      {fileId && url.data ? <img src={url.data} alt={`Your ${kind}`} className="profile-picture" /> : <p className="muted">{fileId ? 'Loading the picture...' : `No ${kind} yet.`}</p>}
      <input ref={input} type="file" accept={kind === 'photo' ? 'image/png,image/jpeg,image/webp' : 'image/png,image/jpeg'} aria-label={`Choose a ${kind}`} onChange={(e) => pick(e.target.files?.[0])} />
      {fileId && <button type="button" className="btn btn-small" onClick={() => onChange(null)}>Remove the {kind}</button>}
      <span className="muted small">{hint}</span>
      {state && <span role="status">{state}</span>}
      {problem && <span className="field-error" role="alert">{problem}</span>}
    </div>
  );
}

/** My Profile: personal details, language, appearance (part 03.01), notifications, photo and the signature used on printed documents. */
export default function ProfilePage({ session }) {
  usePageTitle('My Profile');
  const appearance = useFeatureFlag('ff.ui.p0301');
  const me = useMe();
  const save = useUpdateMe();
  const qc = useQueryClient();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(null);
  const u = me.data;

  const patch = async (body, ok) => {
    setError(null);
    setNotice('');
    try {
      await save.mutateAsync({ ...body, version: u.version });
      await qc.invalidateQueries({ queryKey: ['iam', 'me'] });
      setNotice(ok);
    } catch (err) {
      setError(errorInfo(err));
      throw err;
    }
  };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Account &rsaquo; My Profile</nav>
      <div className="page-head"><h1 id="page-title">My Profile</h1></div>
      <QueryState query={me} what="your profile" permission="a signed-in account" />
      {u && (
        <>
          <p className="muted"><UserStatusChip status={u.lifecycle ?? 'ACTIVE'} /> {typeLabel(u.userType)} account{u.username ? ` · ${u.username}` : ''}</p>
          <p role="status" className="notice" data-testid="profile-notice">{notice}</p>
          {error?.form && <p className="field-error" role="alert">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}

          <form
            className="card"
            aria-labelledby="personal-title"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              patch({
                displayName: String(f.get('displayName')).trim(),
                language: String(f.get('language')),
                preferences: { notifications: Object.fromEntries(CHANNELS.map(([k]) => [k, f.get(`n_${k}`) === 'on'])) },
              }, 'Your profile was saved.').catch(() => {});
            }}
          >
            <h2 id="personal-title">Personal settings</h2>
            <div className="form-grid" key={u.version}>
              <Field label="Full name *" name="displayName" error={error}><input name="displayName" required maxLength={120} defaultValue={u.displayName} /></Field>
              <Field label="Preferred language" name="language" error={error} hint="For messages, notifications and printed documents. The language of the screens is under Appearance.">
                <select name="language" defaultValue={u.language}>{LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </Field>
              <fieldset className="field"><legend>Notify me by</legend>
                {CHANNELS.map(([k, l]) => <label key={k}><input type="checkbox" name={`n_${k}`} defaultChecked={Boolean(u.preferences?.notifications?.[k])} /> {l}</label>)}
                <span className="muted small">Which messages use these channels is set when the messaging part (04.07) is built; your choice is kept.</span>
              </fieldset>
            </div>
            <div className="actions"><button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving...' : 'Save'}</button></div>
          </form>

          {appearance && <AppearancePanel session={session} />}

          <div className="card">
            <h2>Your details</h2>
            <p className="muted">Your email, mobile number, employee link, department and roles are changed by an administrator, so they stay trustworthy.</p>
            <dl className="facts">
              {[['Email', u.email], ['Mobile', u.mobile], ['Employee code', u.employeeCode], ['Department', u.departmentName], ['Home project', u.projectName], ['Roles', u.roles?.length ? u.roles.join(', ') : 'None yet']].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || <span className="muted">Not set</span>}</dd></div>)}
            </dl>
          </div>

          <div className="card">
            <h2>Photo and signature</h2>
            <div className="form-grid">
              <PictureField label="Photo" kind="photo" userId={u.id} fileId={u.photoFileId} hint="PNG, JPEG or WebP." onChange={(id) => patch({ photoFileId: id }, id ? 'Your photo was saved.' : 'Your photo was removed.')} />
              <PictureField label="Signature image" kind="signature" userId={u.id} fileId={u.signatureFileId} hint="A PNG or JPEG of your signature, used on printed documents you approve." onChange={(id) => patch({ signatureFileId: id }, id ? 'Your signature was saved.' : 'Your signature was removed.')} />
            </div>
          </div>

          <div className="card">
            <h2>Security</h2>
            <p><Link to="/account/security">Password and second step</Link> · <Link to="/account/sessions">My sessions and devices</Link></p>
          </div>
        </>
      )}
    </section>
  );
}

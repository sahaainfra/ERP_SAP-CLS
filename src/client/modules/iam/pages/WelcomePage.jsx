import { Link, usePageTitle } from '../../core/pages/ui.jsx';
import { useMe } from '../api/index.js';
import PageHeader from '../../../platform/design/PageHeader.jsx';

/** What a person sees until a role is approved for them (the restricted onboarding state): a welcome, what is happening, and their profile. */
export default function WelcomePage() {
  usePageTitle('Welcome');
  const me = useMe();
  const u = me.data;
  return (
    <section aria-labelledby="page-title">
      <PageHeader id="page-title" title={<>Welcome{u ? `, ${u.displayName}` : ''}</>} />
      <div className="card" data-testid="welcome-card">
        <h2>Your account is ready, but has no access yet</h2>
        <p>Nobody gets access to the ERP until an administrator has asked for a role for them and the request has been approved. That has not happened yet for your account, so only this page and your profile are open.</p>
        <ol className="steps">
          <li>Your account was created and you set your password.</li>
          <li>An administrator raises a request for the role you need.</li>
          <li>The approvers decide it. When it is approved, the menu appears here without you signing in again.</li>
        </ol>
        <p>If this takes long, ask your manager or HR to follow up on your role request.</p>
        <p><Link to="/account/profile">Complete your profile</Link> (photo, signature and language) · <Link to="/account/security">Security and second step</Link></p>
      </div>
    </section>
  );
}

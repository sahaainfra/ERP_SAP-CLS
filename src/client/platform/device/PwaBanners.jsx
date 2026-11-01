import { useEffect } from 'react';
import { Banner } from '../feedback/Feedback.jsx';
import { pwa, usePwa } from './pwa.js';

/**
 * The two notices of the installable app (part 03.06, FR-03): a newer version is ready (a button reloads into it), and the app can be installed
 * on this device (Chrome and Edge offer a prompt; on an iPhone or iPad the steps of Safari are given). Both are quiet banners at the top of the page.
 */
export default function PwaBanners() {
  const s = usePwa();
  useEffect(() => { pwa.register(); }, []);
  const showInstall = s.registered && !s.standalone && !s.dismissed && (s.installEvent || s.ios);
  return (
    <div className="pwa-banners">
      {s.updateReady && (
        <Banner tone="info" title="A new version is ready" testId="pwa-update" action={{ label: 'Reload now', onClick: () => pwa.applyUpdate() }}>
          Reload to use it. Anything you have not saved on this page is kept as a draft where drafts are offered.
        </Banner>
      )}
      {showInstall && (
        <Banner tone="info" title="Install the app on this device" testId="pwa-install" onClose={() => pwa.dismissInstall()}
          action={s.installEvent ? { label: 'Install', onClick: () => pwa.install() } : null}>
          {s.installEvent
            ? 'It opens like any app, from the home screen, and the app itself loads without a connection.'
            : 'In Safari tap Share, then Add to Home Screen. It then opens like any app and the app itself loads without a connection.'}
        </Banner>
      )}
    </div>
  );
}

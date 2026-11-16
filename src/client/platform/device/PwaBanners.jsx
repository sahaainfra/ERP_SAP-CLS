import { useEffect } from 'react';
import { Banner } from '../feedback/Feedback.jsx';
import { pwa, usePwa } from './pwa.js';
import { useT } from '../i18n/index.js';

/**
 * The two notices of the installable app (part 03.06, FR-03): a newer version is ready (a button reloads into it), and the app can be installed
 * on this device (Chrome and Edge offer a prompt; on an iPhone or iPad the steps of Safari are given). Both are quiet banners at the top of the page.
 */
export default function PwaBanners() {
  const s = usePwa();
  const t = useT('field');
  useEffect(() => { pwa.register(); }, []);
  const showInstall = s.registered && !s.standalone && !s.dismissed && (s.installEvent || s.ios);
  return (
    <div className="pwa-banners">
      {s.updateReady && (
        <Banner tone="info" title={t('pwa.updateTitle')} testId="pwa-update" action={s.applying ? null : { label: t('pwa.reload'), onClick: () => pwa.applyUpdate() }}>
          {s.applying ? t('pwa.applying') : s.saveDraftsFirst ? t('pwa.updateBodySaved') : t('pwa.updateBody')}
        </Banner>
      )}
      {showInstall && (
        <Banner tone="info" title={t('pwa.installTitle')} testId="pwa-install" onClose={() => pwa.dismissInstall()}
          action={s.installEvent ? { label: t('pwa.install'), onClick: () => pwa.install() } : null}>
          {s.installEvent ? t('pwa.installBody') : t('pwa.installIos')}
        </Banner>
      )}
    </div>
  );
}

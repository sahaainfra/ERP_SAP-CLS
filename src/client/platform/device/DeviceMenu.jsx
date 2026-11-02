import { useEffect, useState } from 'react';
import { useToast } from '../feedback/Feedback.jsx';
import { useLowBandwidth } from './lowBandwidth.js';
import { useT } from '../i18n/index.js';
import { needsInstallForPush, pushStatus, pushSupported, sendTestPush, subscribePush, unsubscribePush } from './push.js';

/**
 * The device settings in the account menu (part 03.06): low-bandwidth mode for this device, and notifications on this device with a test
 * message. Only shown where the device part is switched on.
 */
export default function DeviceMenu() {
  const t = useT('field');
  const low = useLowBandwidth();
  const toast = useToast();
  const [status, setStatus] = useState({ supported: pushSupported(), permission: 'default', subscribed: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; pushStatus().then((s) => live && setStatus(s)).catch(() => {}); return () => { live = false; }; }, []);

  const run = async (fn, done) => {
    setBusy(true);
    try { await fn(); toast.success(done); setStatus(await pushStatus()); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="device-menu" role="group" aria-label={t('device.group')}>
      <label className="shell-field"><span>{t('device.lowbw')}</span>
        <select value={low.setting} onChange={(e) => low.set(e.target.value)} data-testid="lowbw-select">
          <option value="auto">{t('device.lowbw.auto')}</option>
          <option value="on">{t('device.lowbw.on')}</option>
          <option value="off">{t('device.lowbw.off')}</option>
        </select>
      </label>
      {low.low && <p className="muted small" data-testid="lowbw-on">{t('device.lowbw.now')}</p>}
      {status.supported ? (
        <div className="device-push">
          <span className="muted small">{t('device.push.status', { state: status.subscribed ? t('device.push.on') : status.permission === 'denied' ? t('device.push.blocked') : t('device.push.off') })}</span>
          {needsInstallForPush() && <span className="muted small">{t('device.push.ios')}</span>}
          {status.subscribed ? (
            <>
              <button type="button" className="btn btn-small" disabled={busy} onClick={() => run(sendTestPush, t('device.push.testDone'))}>{t('device.push.test')}</button>
              <button type="button" className="btn btn-small" disabled={busy} onClick={() => run(unsubscribePush, t('device.push.disableDone'))}>{t('device.push.disable')}</button>
            </>
          ) : (
            <button type="button" className="btn btn-small" disabled={busy || status.permission === 'denied'} onClick={() => run(() => subscribePush({ deviceLabel: `${navigator.platform || 'Device'} ${new Date().toLocaleDateString('en-IN')}` }), t('device.push.enableDone'))} data-testid="push-on">{t('device.push.enable')}</button>
          )}
        </div>
      ) : <p className="muted small">{t('device.push.unsupported')}</p>}
    </div>
  );
}

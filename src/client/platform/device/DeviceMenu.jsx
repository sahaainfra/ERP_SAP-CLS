import { useEffect, useState } from 'react';
import { useToast } from '../feedback/Feedback.jsx';
import { useLowBandwidth } from './lowBandwidth.js';
import { needsInstallForPush, pushStatus, pushSupported, sendTestPush, subscribePush, unsubscribePush } from './push.js';

/**
 * The device settings in the account menu (part 03.06): low-bandwidth mode for this device, and notifications on this device with a test
 * message. Only shown where the device part is switched on.
 */
export default function DeviceMenu() {
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
    <div className="device-menu" role="group" aria-label="This device">
      <label className="shell-field"><span>Low-bandwidth mode</span>
        <select value={low.setting} onChange={(e) => low.set(e.target.value)} data-testid="lowbw-select">
          <option value="auto">Automatic (data saver or slow connection)</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </label>
      {low.low && <p className="muted small" data-testid="lowbw-on">On now: photos are smaller and images load when seen.</p>}
      {status.supported ? (
        <div className="device-push">
          <span className="muted small">Notifications on this device: {status.subscribed ? 'on' : status.permission === 'denied' ? 'blocked in the browser' : 'off'}</span>
          {needsInstallForPush() && <span className="muted small">On an iPhone or iPad, add the app to the Home Screen first.</span>}
          {status.subscribed ? (
            <>
              <button type="button" className="btn btn-small" disabled={busy} onClick={() => run(sendTestPush, 'A test notification was sent to your devices.')}>Send a test notification</button>
              <button type="button" className="btn btn-small" disabled={busy} onClick={() => run(unsubscribePush, 'Notifications are off on this device.')}>Turn notifications off</button>
            </>
          ) : (
            <button type="button" className="btn btn-small" disabled={busy || status.permission === 'denied'} onClick={() => run(() => subscribePush({ deviceLabel: `${navigator.platform || 'Device'} ${new Date().toLocaleDateString('en-IN')}` }), 'Notifications are on for this device.')} data-testid="push-on">Turn notifications on</button>
          )}
        </div>
      ) : <p className="muted small">This browser cannot receive notifications.</p>}
    </div>
  );
}

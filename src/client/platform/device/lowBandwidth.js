import { useEffect, useState } from 'react';

// Low-bandwidth mode (part 03.06, FR-06): smaller photos, images that load when seen, panels that wait until they are opened. It follows the
// browser's data-saver switch or a slow connection by itself ("auto"), and the person can switch it on or off for this device.
const KEY = 'erp.lowbw';
export const LOW_BANDWIDTH_EVENT = 'erp:lowbw';

/** Whether the mode is on, from the person's setting ('on', 'off', 'auto') and what the browser says about the connection. */
export function lowBandwidthFrom(setting, connection) {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return Boolean(connection?.saveData) || /^(slow-2g|2g)$/.test(connection?.effectiveType ?? '');
}

export function storedSetting() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

const connection = () => (typeof navigator === 'undefined' ? undefined : navigator.connection);
export const isLowBandwidth = () => lowBandwidthFrom(storedSetting(), connection());

export function setLowBandwidth(setting) {
  try {
    if (setting === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, setting);
  } catch { /* lasts for this page view only */ }
  document.documentElement.toggleAttribute('data-lowbw', isLowBandwidth());
  window.dispatchEvent(new CustomEvent(LOW_BANDWIDTH_EVENT, { detail: setting }));
}

/** { low, setting, set } for a component; follows a change of the setting or of the connection. */
export function useLowBandwidth() {
  const [state, setState] = useState(() => ({ setting: storedSetting(), low: isLowBandwidth() }));
  useEffect(() => {
    const read = () => { const low = isLowBandwidth(); document.documentElement.toggleAttribute('data-lowbw', low); setState({ setting: storedSetting(), low }); };
    read();
    window.addEventListener(LOW_BANDWIDTH_EVENT, read);
    connection()?.addEventListener?.('change', read);
    return () => { window.removeEventListener(LOW_BANDWIDTH_EVENT, read); connection()?.removeEventListener?.('change', read); };
  }, []);
  return { ...state, set: setLowBandwidth };
}

import { useEffect, useState, useSyncExternalStore } from 'react';

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

// Part 166.4 (FR-03), while ff.perf.p16604 is ON (the shell sets it): low-bandwidth mode also stops the dashboards refreshing by themselves, shows
// thumbnails where a list shows photos (the full photo when it is opened), and draws charts as their tables.
let extras = false;
const extraListeners = new Set();
export function setLowBandwidthExtras(on) {
  if (Boolean(on) === extras) return;
  extras = Boolean(on);
  extraListeners.forEach((l) => l());
}
/** True when the extras of part 166.4 apply now: the flag is ON and the mode is on. For code outside a component. */
export const lowBandwidthSaves = () => extras && typeof window !== 'undefined' && isLowBandwidth();
/** The same for a component; it draws again when the mode or the flag changes. */
export function useLowBandwidthSaves() {
  const { low } = useLowBandwidth();
  const on = useSyncExternalStore((fn) => { extraListeners.add(fn); return () => extraListeners.delete(fn); }, () => extras, () => false);
  return on && low;
}

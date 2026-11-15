// Text size of the screens (UI v3, mobile-first). Site teams read the ERP on phones in sunlight, so every person can
// make the text larger or smaller for their own device. The choice is kept on the device (localStorage) and applied
// to <html data-text-size>, which scales the type tokens in ui-v3.css; nothing reloads.
export const TEXT_SIZES = ['s', 'm', 'l', 'xl'];
const KEY = 'erp.ui.textSize';

export function storedTextSize() {
  try {
    const v = localStorage.getItem(KEY);
    return TEXT_SIZES.includes(v) ? v : 'm';
  } catch {
    return 'm';
  }
}

export function applyTextSize(size, { remember = true } = {}) {
  const v = TEXT_SIZES.includes(size) ? size : 'm';
  document.documentElement.dataset.textSize = v;
  if (remember) {
    try { localStorage.setItem(KEY, v); } catch { /* private mode: the size still applies to this visit */ }
  }
  return v;
}

export function initTextSize() {
  applyTextSize(storedTextSize(), { remember: false });
}

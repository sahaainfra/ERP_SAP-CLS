// Contrast of text against its background (part 03.01, BR-02): the WCAG 2.1 relative-luminance ratio, and the list of text and
// background token pairs the components actually use, checked in every theme.

const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
/** '#RRGGBB' or '#RGB' to [r, g, b]. */
export function parseHex(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Not a colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}
export function luminance(hex) {
  const [r, g, b] = parseHex(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** The contrast ratio of two colours, 1 to 21, rounded to two places. */
export function contrastRatio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

/**
 * The text-on-background pairs of the design system. `large` pairs (headings, solid buttons with bold text, icons and chart marks)
 * need 3:1; the others are body text and need 4.5:1. Disabled text is exempt in WCAG and is not listed.
 */
/** @type {{ fg: string, bg: string, large?: boolean }[]} */
export const TEXT_PAIRS = [
  ...['text.primary', 'text.secondary', 'text.muted'].flatMap((fg) => ['bg.page', 'bg.surface', 'bg.surface-sunken', 'bg.hover', 'bg.selected', 'bg.nav', 'bg.nav-active'].map((bg) => ({ fg, bg }))),
  { fg: 'text.link', bg: 'bg.surface' }, { fg: 'text.link', bg: 'bg.page' },
  { fg: 'brand.primary-text', bg: 'bg.surface' }, { fg: 'brand.primary-text', bg: 'bg.page' },
  { fg: 'text.on-primary', bg: 'brand.primary' }, { fg: 'text.on-primary', bg: 'brand.primary-hover' },
  { fg: 'text.on-accent', bg: 'brand.accent' },
  { fg: 'text.on-shell', bg: 'bg.shell' }, { fg: 'text.on-shell-muted', bg: 'bg.shell' }, { fg: 'text.on-shell', bg: 'bg.shell-hover' },
  ...['success', 'warning', 'error', 'info', 'neutral', 'muted'].flatMap((s) => [{ fg: `status.${s}.fg`, bg: `status.${s}.bg` }, { fg: `status.${s}.fg`, bg: 'bg.surface' }]),
  { fg: 'border.focus', bg: 'bg.surface', large: true }, { fg: 'border.control', bg: 'bg.surface', large: true },
];

/** The contrast report of every pair in every theme. AAA (7:1, or 4.5:1 for large) is reported too; the high-contrast theme aims for it. */
export function contrastReport(tokens) {
  const rows = [];
  for (const theme of Object.keys(tokens.color)) {
    const c = tokens.color[theme];
    for (const p of TEXT_PAIRS) {
      if (!c[p.fg] || !c[p.bg] || !c[p.fg].startsWith('#') || !c[p.bg].startsWith('#')) continue;
      const ratio = contrastRatio(c[p.fg], c[p.bg]);
      const aa = p.large ? 3 : 4.5;
      const aaa = p.large ? 4.5 : 7;
      rows.push({ theme, fg: p.fg, bg: p.bg, fgValue: c[p.fg], bgValue: c[p.bg], ratio, large: Boolean(p.large), aa: ratio >= aa, aaa: ratio >= aaa });
    }
  }
  return { rows, failures: rows.filter((r) => !r.aa), aaaShare: Object.fromEntries(Object.keys(tokens.color).map((t) => { const r = rows.filter((x) => x.theme === t); return [t, Math.round((r.filter((x) => x.aaa).length / r.length) * 100)]; })) };
}

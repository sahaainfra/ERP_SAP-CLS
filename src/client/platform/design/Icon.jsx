import registry from '../../../shared/design/icon-registry.json';
import { CONSTRUCTION_GLYPHS } from './construction-icons.jsx';
import { GLYPHS } from './icon-map.js';

// The one icon component (part 03.01, FR-05). Pages name an icon by its registry key (erp.action.approve, erp.state.overdue,
// erp.group.finance, erp.cx.crane or a module key); the registry says which glyph that is, so a module never picks a glyph itself.
const hintOf = (v) => (typeof v === 'string' ? v : v?.glyph_hint);
const KEYS = new Map();
for (const g of ['groups', 'actions', 'states', 'modules', 'kpi']) for (const [k, v] of Object.entries(registry[g] ?? {})) KEYS.set(k, hintOf(v));

/** Every registry key with its group and meaning, for the style guide. */
export const ICON_KEYS = [
  ...Object.keys(registry.groups).map((k) => ({ key: k, group: 'Navigation groups', meaning: k.replace('erp.group.', '') })),
  ...Object.entries(registry.actions).map(([k, v]) => ({ key: k, group: 'Actions', meaning: v.meaning ?? '' })),
  ...Object.entries(registry.states).map(([k, v]) => ({ key: k, group: 'States', meaning: v.meaning ?? k.replace('erp.state.', '') })),
  ...Object.keys(registry.construction).map((k) => ({ key: k, group: 'Construction', meaning: k.replace('erp.cx.', '').replace(/-/g, ' ') })),
  ...Object.entries(registry.modules).map(([k, v]) => ({ key: k, group: 'Modules', meaning: v.label ?? '' })),
  ...Object.entries(registry.kpi ?? {}).map(([k, v]) => ({ key: k, group: 'Key figures', meaning: v.meaning ?? '' })),
];
export const SIZES = registry.sizes;
export const knownIcon = (name) => KEYS.has(name) || name in CONSTRUCTION_GLYPHS;

/**
 * `<Icon name="erp.action.approve" />`. Decorative unless `label` is given (then it is an image with that name). Size 16, 20 or 24
 * (or the density's icon size by default); colour is the text colour around it.
 */
export default function Icon({ name, size, label, className = '' }) {
  const s = size ?? 'var(--erp-icon-density, 20px)';
  const common = { width: s, height: s, className: `icon ${className}`.trim(), 'aria-hidden': label ? undefined : true, role: label ? 'img' : undefined, 'aria-label': label, focusable: 'false' };
  if (name in CONSTRUCTION_GLYPHS) {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={registry.stroke} strokeLinecap="round" strokeLinejoin="round" {...common}>{CONSTRUCTION_GLYPHS[name]}</svg>;
  }
  const Glyph = GLYPHS[KEYS.get(name)];
  if (!Glyph) return <span {...common} data-missing-icon={name} />;
  return <Glyph {...common} strokeWidth={registry.stroke} absoluteStrokeWidth={false} />;
}

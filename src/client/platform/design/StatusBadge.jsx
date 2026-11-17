import { statusTone } from '../../../shared/design/status.js';
import Icon from './Icon.jsx';

const ICON = { neutral: 'erp.state.draft', info: 'erp.state.review', success: 'erp.state.approved', warning: 'erp.state.returned', error: 'erp.state.rejected', muted: 'erp.state.cancelled' };
export const BADGE_VARIANTS = ['soft', 'solid', 'outline', 'dot'];

/**
 * A status shown the same way everywhere (part 03.01, FR-06): its tone's colours, an icon so colour is never the only signal, and the words.
 * Part 166.2 (FR-01) adds the UI v3 variants: `variant` soft (the default, as before), solid (a header's main status), outline (in a dense
 * table) or dot (a list card on a phone: a coloured dot and the words); `size` sm or md.
 */
export default function StatusBadge({ status, label, variant = 'soft', size = 'md' }) {
  const tone = statusTone(status);
  const text = label ?? String(status ?? '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
  const v = BADGE_VARIANTS.includes(variant) ? variant : 'soft';
  const cls = `tone tone-${tone}${v === 'soft' ? '' : ` badge-${v}`}${size === 'sm' ? ' badge-sm' : ''}`;
  return <span className={cls} data-tone={tone}>{v === 'dot' ? <span className="badge-dot" aria-hidden="true" /> : <Icon name={ICON[tone]} size={size === 'sm' ? 12 : 16} />}{text}</span>;
}

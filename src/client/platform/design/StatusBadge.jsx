import { statusTone } from '../../../shared/design/status.js';
import Icon from './Icon.jsx';

const ICON = { neutral: 'erp.state.draft', info: 'erp.state.review', success: 'erp.state.approved', warning: 'erp.state.returned', error: 'erp.state.rejected', muted: 'erp.state.cancelled' };

/** A status shown the same way everywhere (part 03.01, FR-06): its tone's colours, an icon so colour is never the only signal, and the words. */
export default function StatusBadge({ status, label }) {
  const tone = statusTone(status);
  const text = label ?? String(status ?? '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
  return <span className={`tone tone-${tone}`} data-tone={tone}><Icon name={ICON[tone]} size={16} />{text}</span>;
}

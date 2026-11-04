import Icon from '../design/Icon.jsx';
import { useT } from '../i18n/index.js';

/**
 * The notice shown wherever the position is read (part 03.06, BR-01): once, now, for this purpose, never followed. `purpose` completes the
 * sentence, for example "this punch" or "this inspection".
 */
export default function LocationNotice({ purpose }) {
  const t = useT('field');
  return (
    <p className="loc-notice muted small" role="note" data-testid="location-notice">
      <Icon name="erp.action.location" size={14} /> {t('location.notice', { purpose })}
    </p>
  );
}

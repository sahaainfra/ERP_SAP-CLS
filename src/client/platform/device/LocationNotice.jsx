import Icon from '../design/Icon.jsx';

/**
 * The notice shown wherever the position is read (part 03.06, BR-01): once, now, for this purpose, never followed. `purpose` completes the
 * sentence, for example "this punch" or "this inspection".
 */
export default function LocationNotice({ purpose = 'this action' }) {
  return (
    <p className="loc-notice muted small" role="note" data-testid="location-notice">
      <Icon name="erp.action.location" size={14} /> Your position is read once, when you press the button, for {purpose}. It is not followed in the background.
    </p>
  );
}

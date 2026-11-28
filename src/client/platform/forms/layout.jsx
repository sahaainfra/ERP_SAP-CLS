import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/index.js';
import { formatDateTime } from '../format.js';
import Icon from '../design/Icon.jsx';
import { useT } from '../i18n/index.js';
import { fieldId } from './useForm.js';

// Layout of a data-entry form (part 03.02, FR-02, FR-03, FR-07, FR-08): sections in 1, 2 or 3 columns that fold to one on a phone,
// collapsible groups, a sticky action bar, the error summary that links to each field, the draft banner and the duplicate warning.

/** A titled group of fields; `columns` 1-3 (one column under 640 px, two under 1024 px); `collapsible` folds it. */
export function FormSection({ title, columns = 2, collapsible = false, defaultOpen = true, children, id, description }) {
  const body = <div className={`ff-grid ff-cols-${columns}`}>{children}</div>;
  if (!collapsible) {
    return (
      <section className="ff-section" aria-labelledby={id ? `${id}-title` : undefined}>
        {title && <h2 className="ff-section-title" id={id ? `${id}-title` : undefined}>{title}</h2>}
        {description && <p className="muted small">{description}</p>}
        {body}
      </section>
    );
  }
  return (
    <details className="ff-section ff-collapsible" open={defaultOpen}>
      <summary className="ff-section-title">{title}</summary>
      {description && <p className="muted small">{description}</p>}
      {body}
    </details>
  );
}

/** The action bar stays at the bottom of the screen while the form scrolls (Save Draft, Submit, Cancel and the draft status). */
export function ActionBar({ children, status }) {
  return (
    <div className="ff-actionbar" role="toolbar" aria-label="Form actions">
      <span className="ff-actionbar-status" aria-live="polite">{status}</span>
      <div className="actions">{children}</div>
    </div>
  );
}

/** "Draft saved 12:04" and friends, for the action bar. */
export function draftStatus(draft, dirty) {
  if (draft.status === 'saving') return 'Saving the draft...';
  if (draft.status === 'conflict') return 'A newer draft was saved in another window. Reload to see it.';
  if (draft.status === 'error') return `The draft could not be saved: ${draft.error?.message ?? 'try again'}.`;
  if (draft.savedAt) return `Draft saved ${formatDateTime(draft.savedAt)}${dirty ? ', with changes since' : ''}`;
  return dirty ? 'Changes not saved yet; a draft is kept every 30 seconds.' : '';
}

/**
 * The summary of everything wrong, at the top of the form, each line a link that moves to the field (FR-03). It takes focus when it
 * appears so a screen reader announces it. `labelOf(path)` turns 'lines.2.quantity' into 'Items, row 3: Quantity'.
 */
export function ErrorSummary({ formError, errors, labelOf = (p) => p }) {
  const ref = useRef(null);
  const entries = Object.entries(errors ?? {});
  useEffect(() => { if (formError || entries.length) ref.current?.focus(); }, [formError, entries.length]);
  if (!formError && entries.length === 0) return null;
  const go = (path) => (e) => {
    e.preventDefault();
    const el = document.getElementById(fieldId(path)) ?? document.querySelector(`[data-field="${fieldId(path)}"] input, [data-field="${fieldId(path)}"] select, [data-field="${fieldId(path)}"] textarea, [data-field="${fieldId(path)}"] button`);
    el?.scrollIntoView({ block: 'center' });
    el?.focus();
  };
  return (
    <div className="ff-summary" role="alert" tabIndex={-1} ref={ref} data-testid="error-summary">
      <h2 className="ff-summary-title"><Icon name="erp.state.exception" size={18} /> {formError?.form ?? 'Please correct the fields below.'}</h2>
      {entries.length > 0 && (
        <ul>
          {entries.map(([path, msg]) => <li key={path}><a href={`#${fieldId(path)}`} onClick={go(path)}>{labelOf(path)}: {msg}</a></li>)}
        </ul>
      )}
      {formError?.correlationId && <p className="muted small">Correlation ID: <code>{formError.correlationId}</code></p>}
    </div>
  );
}

/** "You have a draft from 31-Oct-2026 11:40. Resume or discard?" */
export function DraftBanner({ draft, onResume, onDiscard }) {
  const t = useT('common'); // PACK-09: the banner's text is in the catalogue (en, hi, te); the English text is unchanged
  if (!draft.found) return null;
  const when = formatDateTime(draft.found.savedAt);
  return (
    <div className="ff-draft" role="status" data-testid="draft-banner">
      <Icon name="erp.state.draft" size={18} />
      <span>{t(draft.found.title ? 'draft.foundTitled' : 'draft.found', { title: draft.found.title, when, auto: draft.found.savedBy === 'autosave' ? ` ${t('draft.auto')}` : '' })}</span>
      <span className="spacer" />
      <button type="button" className="btn btn-small btn-primary" onClick={onResume}>{t('draft.resume')}</button>
      <button type="button" className="btn btn-small" onClick={onDiscard}>{t('draft.discard')}</button>
    </div>
  );
}

/**
 * Warns while the form is filled in that a similar record exists (FR-08). It asks the server's duplicate check a moment after the
 * named fields change; the person decides whether to go on.
 */
export function DuplicateWarning({ check, fields, enabled = true }) {
  const [debounced, setDebounced] = useState(fields);
  const key = JSON.stringify(fields);
  useEffect(() => { const t = setTimeout(() => setDebounced(JSON.parse(key)), 600); return () => clearTimeout(t); }, [key]);
  const q = useQuery({
    queryKey: ['duplicate-check', check, JSON.stringify(debounced)],
    queryFn: async () => (await api.post(`/ui/duplicate-check/${check}`, { fields: debounced })).data,
    enabled: enabled && Object.values(debounced).some((v) => v !== '' && v !== null && v !== undefined),
    staleTime: 0, // a record saved a moment ago must be found: never reuse an older answer
    gcTime: 0,
    retry: false,
  });
  const matches = q.data?.matches ?? [];
  if (!matches.length) return null;
  return (
    <div className="ff-dup" role="status" data-testid="duplicate-warning">
      <strong><Icon name="erp.action.info" size={16} /> This may already exist</strong>
      <ul>{matches.map((m) => <li key={m.id}>{m.link ? <a href={m.link}>{m.label}</a> : m.label} <span className="muted">({m.reason})</span></li>)}</ul>
      <span className="muted small">Check before saving; you can still go on if it is a different record.</span>
    </div>
  );
}

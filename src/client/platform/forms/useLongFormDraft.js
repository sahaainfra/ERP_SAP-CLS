import { useCallback, useEffect, useRef, useState } from 'react';
import { useDraft } from './useDraft.js';
import { useUnsavedGuard } from './guard.js';

/**
 * Drafts and the unsaved-changes guard for a long form that keeps its own state (PACK-09: DPR entry, Record Measurement, Import Client
 * BOQ), built on the framework's server drafts (useDraft, part 03.02 FR-07) and guard (FR-02).
 *
 *   const d = useLongFormDraft({ formCode: 'site.dpr', entityKey, values, enabled, title });
 *   <DraftBanner draft={d.draft} onResume={() => apply(d.resume())} onDiscard={d.discard} />
 *   after a successful save: d.done()
 *
 * `values` is what goes into the draft (null while the form is not started). The first values seen are the baseline: the form is dirty
 * while its values differ from it. Resuming a draft counts as unsaved (the record does not have those values yet). `done()` drops the
 * server draft and makes the values after the save the new baseline. With `enabled` false nothing is asked, kept or guarded.
 */
export function useLongFormDraft({ formCode, entityKey = '', values, enabled = true, title = '', projectId = null, siteId = null }) {
  const json = values == null ? null : JSON.stringify(values);
  const [baseline, setBaseline] = useState(null);
  const resumed = useRef(false);
  useEffect(() => { if (enabled && json !== null && baseline === null) setBaseline(json); }, [enabled, json, baseline]);
  // a new record (another site or day) starts afresh
  useEffect(() => { setBaseline(null); resumed.current = false; }, [formCode, entityKey]);
  const dirty = Boolean(enabled && json !== null && baseline !== null && (resumed.current || json !== baseline));
  const draft = useDraft({ formCode, entityKey, values, dirty, enabled, title, projectId, siteId });
  useUnsavedGuard(dirty);

  const resume = useCallback(() => { const p = draft.resume(); if (p) resumed.current = true; return p; }, [draft]);
  const discard = useCallback(() => draft.discard(), [draft]);
  const done = useCallback(async () => {
    resumed.current = false;
    setBaseline(null); // the values after the save (a page may clear its fields) become the new baseline on the next render
    draft.consumed();
    await draft.discard();
  }, [draft]);
  return { draft, dirty, resume, discard, done, onBlur: draft.onBlur };
}

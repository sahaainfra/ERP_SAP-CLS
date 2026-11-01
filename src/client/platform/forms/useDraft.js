import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';

// Server drafts for a form (part 03.02, FR-07): every 30 seconds while there are unsaved changes, and when the person leaves a field,
// the values go to /ui/drafts; opening the form again (after closing the tab or a crash, or on another device) offers the draft
// back. The version is tracked so two windows cannot overwrite each other unseen.
export const AUTOSAVE_MS = 30_000;
const BLUR_DEBOUNCE_MS = 1_500;

const path = (formCode, entityKey) => `/ui/drafts/${formCode}${entityKey ? `/${encodeURIComponent(entityKey)}` : ''}`;

/**
 * useDraft({ formCode, entityKey, values, dirty, enabled, title }) -> { found, status, savedAt, error, save, discard, resume, dismiss, onBlur }
 * `found` is the draft waiting to be resumed (shown as a banner); `status` is idle | saving | saved | error | conflict.
 */
export function useDraft({ formCode, entityKey = '', values, dirty, enabled = true, title = '', projectId = null, siteId = null }) {
  const [found, setFound] = useState(null);
  const [status, setStatus] = useState('idle');
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);
  const version = useRef(0);
  const latest = useRef({ values, dirty, title, projectId, siteId });
  latest.current = { values, dirty, title, projectId, siteId };
  const lastSent = useRef('');
  const blurTimer = useRef(null);

  // Is there a draft from before? Asked on every mount: each run keeps only its own answer (React may mount twice in development).
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    // a busy server (429) or a passing failure must not lose the person's draft: ask again a few times before giving up
    const ask = (attempt) => api.get(path(formCode, entityKey)).then((r) => {
      if (!live || !r.data) return;
      version.current = r.data.version;
      setFound(r.data);
    }).catch((err) => {
      if (live && attempt < 3 && (err.status === 429 || err.status >= 500 || err.status === 0)) setTimeout(() => ask(attempt + 1), 800 * 2 ** attempt);
      /* otherwise: no draft service, the form still works without drafts */
    });
    ask(0);
    return () => { live = false; };
  }, [enabled, formCode, entityKey]);

  const save = useCallback(async (savedBy = 'manual') => {
    const cur = latest.current;
    const body = JSON.stringify(cur.values);
    if (savedBy !== 'manual' && (!cur.dirty || body === lastSent.current)) return null;
    setStatus('saving');
    try {
      const r = await api.put(path(formCode, entityKey), { payload: cur.values, title: cur.title || undefined, savedBy, projectId: Number(cur.projectId) || null, siteId: Number(cur.siteId) || null, ...(version.current ? { version: version.current } : {}) });
      version.current = r.data.version;
      lastSent.current = body;
      setSavedAt(r.data.savedAt);
      setStatus('saved');
      setError(null);
      setFound(null);
      return r.data;
    } catch (err) {
      setStatus(err.status === 409 ? 'conflict' : 'error');
      setError(err);
      return null;
    }
  }, [formCode, entityKey]);

  // autosave every 30 s while there are changes (FR-07)
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setInterval(() => { if (latest.current.dirty && !found) save('autosave'); }, AUTOSAVE_MS);
    return () => clearInterval(t);
  }, [enabled, save, found]);
  useEffect(() => () => clearTimeout(blurTimer.current), []);

  /** Leaving a field saves soon after (debounced, so tabbing through a row saves once). */
  const onBlur = useCallback(() => {
    if (!enabled || found) return;
    clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => save('blur'), BLUR_DEBOUNCE_MS);
  }, [enabled, save, found]);

  const discard = useCallback(async () => {
    try {
      if (version.current) await api.delete(path(formCode, entityKey), {}, { version: version.current });
    } catch (err) {
      if (err.status !== 404) { setError(err); return false; }
    }
    version.current = 0;
    lastSent.current = '';
    setFound(null);
    setSavedAt(null);
    setStatus('idle');
    return true;
  }, [formCode, entityKey]);

  /** Take the waiting draft's values (the caller puts them in the form). */
  const resume = useCallback(() => {
    const d = found;
    setFound(null);
    if (d) { lastSent.current = JSON.stringify(d.payload); setSavedAt(d.savedAt); setStatus('saved'); }
    return d?.payload ?? null;
  }, [found]);

  /** The record was saved for real: the server used the draft up, start counting afresh. */
  const consumed = useCallback(() => { version.current = 0; lastSent.current = ''; setSavedAt(null); setStatus('idle'); }, []);

  return { found, status, savedAt, error, save, discard, resume, consumed, onBlur };
}

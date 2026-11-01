import { useEffect, useRef } from 'react';

// The unsaved-changes guard (part 03.02, FR-02). A form with changes registers itself; leaving the page (closing the tab, reloading)
// asks the browser's own question, and moving to another page of the shell asks first. The shell calls confirmLeave() before it
// navigates; nothing else needs to know which form is open.
const dirtyForms = new Map();

export const hasUnsavedChanges = () => [...dirtyForms.values()].some(Boolean);

/** Ask before leaving when a form has unsaved changes. Returns true when it is fine to go. */
export function confirmLeave(ask = (text) => window.confirm(text)) {
  if (!hasUnsavedChanges()) return true;
  const ok = ask('You have changes that are not saved. Leave this page and lose them? (A draft is kept if one was saved.)');
  if (ok) dirtyForms.clear();
  return ok;
}

/** Register a form's dirty state for as long as it is on screen. */
export function useUnsavedGuard(dirty) {
  const id = useRef(Symbol('form'));
  useEffect(() => {
    const key = id.current;
    dirtyForms.set(key, dirty);
    const onBeforeUnload = (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      dirtyForms.delete(key);
    };
  }, [dirty]);
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const FlagsContext = createContext({ flags: {}, ready: false, refresh: () => {} });
export const FLAGS_CHANGED = 'erp:flags-changed';

/**
 * Loads the flags the UI cares about in one call and refreshes them whenever an admin changes one,
 * so scoped users see the new behaviour without reloading (AC-02).
 */
export function FlagsProvider({ keys, identityVersion, children }) {
  const [flags, setFlags] = useState({});
  const [ready, setReady] = useState(false);
  const keyList = keys.join(',');

  const refresh = useCallback(async () => {
    try {
      const { data } = await api('GET', `/core/feature-flags/evaluate?keys=${encodeURIComponent(keyList)}`);
      setFlags(data);
    } catch {
      setFlags({});
    }
    setReady(true);
  }, [keyList]);

  useEffect(() => {
    refresh();
    window.addEventListener(FLAGS_CHANGED, refresh);
    return () => window.removeEventListener(FLAGS_CHANGED, refresh);
  }, [refresh, identityVersion]);

  const value = useMemo(() => ({ flags, ready, refresh }), [flags, ready, refresh]);
  return <FlagsContext.Provider value={value}>{children}</FlagsContext.Provider>;
}

/** useFeatureFlag('ff.prog.p0002') -> boolean (false until loaded or if undefined). */
export function useFeatureFlag(key) {
  return useContext(FlagsContext).flags[key] === true;
}

export const useFlagsReady = () => useContext(FlagsContext).ready;

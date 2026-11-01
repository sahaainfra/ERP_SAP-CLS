import { useEffect, useState } from 'react';
import { useContextOptions, useShellMode } from './api.js';
import { readContext } from './ContextSwitcher.jsx';

/**
 * The project and site the person is working in (part 03.05, FR-03), for pages that narrow their lists to it: ids from the browser mirror
 * the switcher keeps, codes from the person's scope. Follows the switcher at once through its 'erp:context' event.
 */
export function useWorkContext() {
  const on = useShellMode() === 'on';
  const opts = useContextOptions(on);
  const [ctx, setCtx] = useState(readContext);
  useEffect(() => {
    const onChange = (e) => setCtx(e.detail ?? readContext());
    window.addEventListener('erp:context', onChange);
    return () => window.removeEventListener('erp:context', onChange);
  }, []);
  const project = on ? opts.data?.projects.find((p) => p.id === Number(ctx.projectId)) ?? null : null;
  const site = project ? opts.data?.sites.find((s) => s.id === Number(ctx.siteId) && s.projectId === project.id) ?? null : null;
  return { projectId: project?.id ?? null, siteId: site?.id ?? null, project, site };
}

/** The list filters the working context adds: the project and the site, by code, for a list that has those columns. */
export const contextFiltersFor = (wc, { projectKey = 'projectCode', siteKey = 'siteCode' } = {}) => [
  ...(wc.project ? [{ key: projectKey, op: 'eq', value: wc.project.code }] : []),
  ...(wc.site ? [{ key: siteKey, op: 'eq', value: wc.site.code }] : []),
];

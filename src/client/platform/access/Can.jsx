import { useQuery } from '@tanstack/react-query';
import { api } from '../api/index.js';
import { queryKeys } from '../query/keys.js';
import { canWith } from './index.js';

/** The person's own access, loaded once and kept for 30 seconds. Null while it loads or when the role engine is off for the company. */
export function useAccess() {
  const q = useQuery({ queryKey: queryKeys.iam.access.mine(), queryFn: async () => (await api.get('/iam/me/access')).data, retry: false, staleTime: 30_000 });
  return q.data ?? null;
}

/** `const can = useCan(); can('org.project.manage', { projectId: 3 })` */
export function useCan() {
  const access = useAccess();
  return (permission, record = null) => canWith(access, permission, record);
}

/** `<Can permission="org.project.manage" record={{ projectId }}>…</Can>`: draws its children only when the person may. */
export function Can({ permission, record = null, children, fallback = null }) {
  const can = useCan();
  return can(permission, record) ? children : fallback;
}

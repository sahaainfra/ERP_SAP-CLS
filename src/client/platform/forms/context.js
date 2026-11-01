import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, authMode } from '../api/index.js';
import { useSession } from '../../modules/core/api/index.js';
import { fiscalYearFrom } from '../../../shared/fiscal.js';
import { todayIst } from './dates.js';

// Context auto-fill (part 03.02, FR-04): what a new form can fill in without asking. The company and the person come from the session,
// the project and site from the shell's working context, the department from the person's own profile, the date is today in India
// and the financial year follows from it (April to March).
const CONTEXT_KEY = 'erp.context';
const readWorkContext = () => {
  try { return JSON.parse(localStorage.getItem(CONTEXT_KEY) ?? '{}'); } catch { return {}; }
};

/** The financial year a business date falls in ("2026-27"), for a year starting in `startMonth` (4 = April). */
export function financialYearOf(iso, startMonth = 4) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const startYear = m >= startMonth ? y : y - 1;
  return fiscalYearFrom(`${startYear}-${String(startMonth).padStart(2, '0')}-01`).code;
}

export function useFormContext() {
  const session = useSession();
  const me = useQuery({ queryKey: ['iam', 'me'], queryFn: async () => (await api.get('/iam/me')).data, enabled: authMode() === 'iam', retry: false, staleTime: 60_000 });
  const [work, setWork] = useState(readWorkContext);
  useEffect(() => {
    const on = (e) => setWork(e.detail ?? readWorkContext());
    window.addEventListener('erp:context', on);
    return () => window.removeEventListener('erp:context', on);
  }, []);
  const today = todayIst();
  return {
    ready: session.isSuccess,
    companyId: session.data?.companyId ?? null,
    user: me.data?.displayName ?? session.data?.user ?? '',
    username: session.data?.user ?? '',
    projectId: work.projectId || '',
    siteId: work.siteId || '',
    departmentId: me.data?.departmentId ?? '',
    today,
    financialYear: financialYearOf(today),
  };
}

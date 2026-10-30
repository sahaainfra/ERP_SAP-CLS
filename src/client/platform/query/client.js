import { QueryClient } from '@tanstack/react-query';

/**
 * Defaults: data is fresh for 30 s; no automatic retry here because the API client already retries
 * idempotent GETs, and a retried write could apply twice; no refetch on window focus (screens are explicit).
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

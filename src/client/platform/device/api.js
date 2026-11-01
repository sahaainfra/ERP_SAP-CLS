import { useQuery } from '@tanstack/react-query';
import { api } from '../api/index.js';

// The camera's limits for the person's company (part 03.06, BR-02). A system that has not switched the device part on answers 404; the standard
// limits then apply, so photos are still made smaller.
export const DEFAULT_DEVICE_SETTINGS = Object.freeze({ image: { maxPx: 1600, quality: 0.8 }, lowBandwidth: { maxPx: 1024, quality: 0.6 }, push: { available: false, publicKey: null } });

export const useDeviceSettings = () => useQuery({
  queryKey: ['device', 'settings'],
  queryFn: async () => (await api.get('/ui/device-settings')).data,
  retry: false,
  staleTime: 5 * 60_000,
  select: (d) => d ?? DEFAULT_DEVICE_SETTINGS,
  placeholderData: DEFAULT_DEVICE_SETTINGS,
});

/** Resolve a scanned or typed code to the record it names. Resolves { status, ... } or rejects with the server's message. */
export const resolveCode = async (code) => (await api.get(`/ui/qr/resolve?code=${encodeURIComponent(code)}`)).data;

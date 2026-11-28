// PACK-12 harness (not part of the application): renders the application's own Chart with an S-curve of N points (query ?n=5000&type=line)
// so that a browser can time it, count its DOM nodes and run axe on it. Built with pack-reports/tools/chart-perf/vite.config.js.
import { createRoot } from 'react-dom/client';
import '../../../src/client/design-tokens.css';
import '../../../src/client/styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Chart from '../../../src/client/platform/charts/Chart.jsx';
import { queryKeys } from '../../../src/client/platform/query/keys.js';

const q = new URLSearchParams(location.search);
const n = Number(q.get('n') ?? 5000);
const type = q.get('type') ?? 'line';
const start = Date.UTC(2020, 0, 1);
const categories = Array.from({ length: n }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
const s = (i, shift) => Math.round(100 / (1 + Math.exp(-((i / n) * 12 - 6 - shift))) * 100) / 100;
const data = { categories, series: [{ name: 'Planned', values: categories.map((_, i) => s(i, 0)) }, { name: 'Actual', values: categories.map((_, i) => (i < n * 0.7 ? s(i, 0.4) : null)) }], unit: '%' };
// the flag the chart reads (?flag=1 for PACK-12 on, 0 for off), answered without a server
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: async () => ({}) } } });
qc.setQueryData(queryKeys.core.flags.evaluate(['ff.charts.pack12']), { 'ff.charts.pack12': q.get('flag') === '1' });
const t0 = performance.now();
createRoot(document.getElementById('root')).render(<QueryClientProvider client={qc}><div style={{ maxWidth: 960, padding: 16 }}><Chart type={type} data={data} title="S-curve (%)" tableSwitch={q.get('switch') === '1'} /></div></QueryClientProvider>);
requestAnimationFrame(() => requestAnimationFrame(() => { window.__renderMs = Math.round(performance.now() - t0); window.__ready = true; }));

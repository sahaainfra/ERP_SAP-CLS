import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
// PACK-12 harness build: npx vite build --config pack-reports/tools/chart-perf/vite.config.js  (output in node_modules/.cache/chart-perf-dist, which lint does not read)
const here = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({ root: here, base: './', plugins: [react()], build: { outDir: fileURLToPath(new URL('../../../node_modules/.cache/chart-perf-dist', import.meta.url)), emptyOutDir: true }, logLevel: 'warn' });

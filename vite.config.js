import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  // fonts stay files (never inlined as data: URLs), so the content security policy can keep font-src to 'self' (part 03.01)
  build: { outDir: 'dist', sourcemap: false, assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined) },
});

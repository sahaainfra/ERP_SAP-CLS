import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Files from public/ that the service worker keeps with the app shell (part 03.06).
const PUBLIC_SHELL = ['/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'];

/**
 * Writes sw.js (from src/client/sw.js) with the id and the file list of this build, so each build has its own cache and an old one is dropped
 * when the new one takes over. The id comes from the names of the files, which carry their content hashes.
 */
function serviceWorker() {
  return {
    name: 'erp-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'sw.js');
      // fonts of scripts the people here do not write in are fetched (and then kept) only if a page ever asks for them
      const kept = files.filter((f) => !/-(cyrillic|cyrillic-ext|greek|greek-ext|vietnamese|math|symbols)-\d+-/.test(f));
      const urls = [...kept.map((f) => `/${f}`), ...PUBLIC_SHELL];
      const id = createHash('sha1').update(files.join('|')).digest('hex').slice(0, 10);
      const source = readFileSync('src/client/sw.js', 'utf8').replace("'__BUILD_ID__'", JSON.stringify(id)).replace("'__PRECACHE__'", JSON.stringify(urls));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  // fonts stay files (never inlined as data: URLs), so the content security policy can keep font-src to 'self' (part 03.01)
  build: { outDir: 'dist', sourcemap: false, assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined) },
});

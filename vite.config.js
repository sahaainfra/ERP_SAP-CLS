import { createHash } from 'node:crypto';
import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Files from public/ that the service worker keeps with the app shell (part 03.06).
const PUBLIC_SHELL = ['/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'];

// The pages kept at install, so that they open with no connection from the first visit on: the homes and the field pages (part 166.4, FR-02).
const OFFLINE_PAGES = /\/src\/client\/modules\/(ui\/(LaunchpadPage|FieldHomePage|ScannerPage)|eng\/(MobileApprovalsPage|FieldFormsPage|SyncStatusPage|ConflictPage)|site\/DprEntryPage)\.jsx$/;

/** The entry script with everything it imports statically, and the same for the chunks of OFFLINE_PAGES. */
function shellScripts(bundle) {
  const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
  const out = new Set();
  const add = (name) => {
    if (out.has(name)) return;
    out.add(name);
    for (const i of bundle[name]?.imports ?? []) add(i);
  };
  for (const c of chunks) if (c.isEntry || (c.moduleIds ?? Object.keys(c.modules ?? {})).some((id) => OFFLINE_PAGES.test(id.replace(/\\/g, '/')))) add(c.fileName);
  return out;
}

/**
 * Writes sw.js (from src/client/sw.js) with the id and the file list of this build, so each build has its own cache and an old one is dropped
 * when the new one takes over. The id comes from the names of the files, which carry their content hashes.
 */
function serviceWorker() {
  return {
    name: 'erp-service-worker',
    apply: 'build',
    // after the files are written: a chunk the bundler reports and then drops (an empty wrapper of a dynamic import) must not be listed, or the offline install would fail on a missing file
    writeBundle(options, bundle) {
      const dir = options.dir ?? 'dist';
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'sw.js' && existsSync(join(dir, f)));
      // fonts of scripts the people here do not write in are fetched (and then kept) only if a page ever asks for them;
      // of the scripts, only the shell and the pages a site person needs offline (part 166.4): other pages are kept when first opened
      const scripts = shellScripts(bundle);
      const kept = files.filter((f) => !/-(cyrillic|cyrillic-ext|greek|greek-ext|vietnamese|math|symbols)-\d+-/.test(f) && (!f.endsWith('.js') || scripts.has(f)));
      // no address twice: Cache.addAll refuses a list with a duplicate, and the whole install fails with it (index.html is in the bundle and in the shell list)
      const urls = [...new Set([...kept.map((f) => `/${f}`), ...PUBLIC_SHELL])];
      const id = createHash('sha1').update(files.join('|')).digest('hex').slice(0, 10);
      const source = readFileSync('src/client/sw.js', 'utf8').replace("'__BUILD_ID__'", JSON.stringify(id)).replace("'__PRECACHE__'", JSON.stringify(urls));
      writeFileSync(join(dir, 'sw.js'), source);
    },
  };
}

/**
 * Part 166.4: a Brotli (.br) and a gzip (.gz) copy of each script, style and text file of the build, made once here so the server sends the
 * smaller copy without compressing on every request (src/server/platform/http/staticAssets.js). Files under 1 KB are left as they are.
 */
function precompress() {
  return {
    name: 'erp-precompress',
    apply: 'build',
    writeBundle(options, bundle) {
      const dir = options.dir ?? 'dist';
      for (const f of Object.keys(bundle)) {
        if (!/\.(js|css|html|json|svg|webmanifest)$/.test(f) || !existsSync(join(dir, f))) continue;
        const raw = readFileSync(join(dir, f));
        if (raw.length < 1024) continue;
        writeFileSync(join(dir, `${f}.br`), brotliCompressSync(raw, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: raw.length } }));
        writeFileSync(join(dir, `${f}.gz`), gzipSync(raw, { level: 9 }));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker(), precompress()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  // fonts stay files (never inlined as data: URLs), so the content security policy can keep font-src to 'self' (part 03.01)
  build: {
    outDir: 'dist', sourcemap: false, assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
    // Part 166.4 (P-03): the libraries get chunks of their own, so a release that changes only application code leaves them in the phone's cache,
    // and a library that only some pages use (spreadsheets, PDF writing, QR codes, the real-time client) is fetched with those pages only.
    // pdfjs-dist and leaflet were already split by their dynamic imports (04.10, GIS). The budget is checked by scripts/bundle_budget.mjs.
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            { name: 'vendor-query', test: /[\\/]node_modules[\\/]@tanstack[\\/]/, priority: 30 },
            { name: 'vendor-icons', test: /[\\/]node_modules[\\/]lucide-react[\\/]/, priority: 30 },
            { name: 'vendor-xlsx', test: /[\\/]node_modules[\\/](read-excel-file|fflate|unzipper|@xmldom|xpath)[\\/]/, priority: 20 },
            { name: 'vendor-pdf-lib', test: /[\\/]node_modules[\\/](pdf-lib|@pdf-lib|pako|tslib)[\\/]/, priority: 20 },
            { name: 'vendor-qrcode', test: /[\\/]node_modules[\\/](qrcode|dijkstrajs|pngjs)[\\/]/, priority: 20 },
            { name: 'vendor-realtime', test: /[\\/]node_modules[\\/](socket\.io-client|socket\.io-parser|engine\.io-client|engine\.io-parser|@socket\.io|xmlhttprequest-ssl|debug|ms)[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
});

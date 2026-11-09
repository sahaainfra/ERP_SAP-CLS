#!/usr/bin/env node
// Installable-app check (part 03.06, FR-03): the manifest and icons are valid, and the built service worker names real files. Run after
// `vite build` (the regression does): a service worker that lists a file the build did not write fails to install, and the app would then
// never open offline, which nobody would notice until a site loses its signal.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICONS, pngSize } from './build_pwa_assets.mjs';

const problems = [];
const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons', 'theme_color', 'background_color']) if (!manifest[k]) problems.push(`manifest.${k} is missing`);
for (const i of ICONS) {
  const file = join('public/icons', i.file);
  const size = existsSync(file) ? pngSize(readFileSync(file)) : null;
  if (!size || size.width !== i.size) problems.push(`${file} is missing or not ${i.size} px (node scripts/build_pwa_assets.mjs)`);
}
const dist = 'dist';
if (!existsSync(join(dist, 'sw.js'))) {
  problems.push('dist/sw.js is missing: run the client build first');
} else {
  const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
  if (/'__(BUILD_ID|PRECACHE)__'/.test(sw)) problems.push('dist/sw.js still holds its placeholders: the build did not fill them in');
  const listed = /const PRECACHE = (\[.*?\]);/s.exec(sw);
  if (!listed) problems.push('dist/sw.js has no file list');
  else {
    const urls = JSON.parse(listed[1]);
    if (!urls.includes('/index.html')) problems.push('the service worker does not keep /index.html, so the app cannot open offline');
    if (!urls.some((u) => /^\/assets\/.*\.js$/.test(u)) || !urls.some((u) => /^\/assets\/.*\.css$/.test(u))) problems.push('the service worker does not keep the script and the style of the app');
    // Cache.addAll rejects a list with the same address twice, and then the worker never installs
    for (const u of new Set(urls.filter((x, i) => urls.indexOf(x) !== i))) problems.push(`the service worker lists ${u} twice: Cache.addAll would refuse the list and the app could not install offline`);
    for (const u of urls) if (!existsSync(join(dist, u))) problems.push(`the service worker lists ${u}, which is not in dist`);
  }
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  if (!html.includes('rel="manifest"')) problems.push('dist/index.html does not link the manifest');
  for (const icon of manifest.icons) if (!existsSync(join(dist, icon.src))) problems.push(`the manifest names ${icon.src}, which is not in dist`);
}
if (problems.length) {
  console.error(`Installable app check FAILED:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('Installable app check OK: manifest, icons and the service worker\'s file list.');

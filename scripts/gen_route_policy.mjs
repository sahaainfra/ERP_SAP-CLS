// @ts-nocheck
// One-off helper that drafted src/server/platform/security/route-policy.js: for each live route it finds the route line in the
// source, the controller or service function it calls and the first permission that function asserts. The result is reviewed by
// hand; the route check (npm run erp:route-check) keeps the committed policy complete.
// Usage: node scripts/dump_routes.mjs > routes.json; node scripts/gen_route_policy.mjs routes.json > draft.json
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

const routes = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.js') ? [join(d, f)] : []));
const files = walk('src/server/modules').map((f) => ({ f: f.split('\\').join('/'), text: readFileSync(f, 'utf8') }));
const lines = [];
for (const { f, text } of files) {
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\.(get|post|put|patch|delete)\(\s*(?:\[[^\]]*\]\s*|'([^']*)')/g)) {
      if (m[2] !== undefined) lines.push({ file: f, method: m[1].toUpperCase(), rel: m[2], line, no: i });
    }
  });
}
const PERM = [/assertPermission(?:Anywhere)?\(\s*(?:actor|req\.actor),\s*'([^']+)'/, /hasPermission(?:Anywhere)?\(\s*(?:actor|req\.actor),\s*'([^']+)'/, /requirePermission(?:Anywhere)?\('([^']+)'/, /\bcan\([^,]*,\s*'([^']+)'/];
const permIn = (text) => { for (const re of PERM) { const m = re.exec(text); if (m) return m[1]; } return null; };
const bodyOf = (dir, fn) => {
  const re = new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?(?:function\\s+)?${fn}\\s*(?::\\s*(?:async\\s*)?)?\\(([^)]*)\\)\\s*(?:=>\\s*)?\\{`);
  for (const { f, text } of files) {
    if (!f.startsWith(dir)) continue;
    const m = re.exec(text);
    if (m) {
      // the function's own lines only: up to the next method written at the same indent, or the closing brace of the object
      const lines = text.slice(m.index).split('\n').filter((l, i) => i > 0 || l.trim());
      const first = lines[0].trim() === '' ? lines.slice(1) : lines;
      const indent = /^(\s*)/.exec(first[0])[1].length;
      const body = [first[0]];
      for (const line of first.slice(1, 60)) {
        const lead = /^(\s*)/.exec(line)[1].length;
        if (line.trim() && lead <= indent && /^\s*(\}|[a-zA-Z]+\(|async [a-zA-Z]+\(|const |function )/.test(line)) break;
        body.push(line);
      }
      return { body: body.join('\n'), text };
    }
  }
  return null;
};
const helperPerm = (body, text) => {
  for (const h of body.matchAll(/\b([a-zA-Z]+)\((?:actor|req\.actor)\)/g)) {
    const m = new RegExp(`const ${h[1]} = \\((?:actor|a)[^)]*\\) => [^\\n]*?'([a-z0-9_.]+)'`).exec(text) ?? new RegExp(`function ${h[1]}\\([^)]*\\)\\s*\\{[^}]*?'([a-z0-9_.]+)'`).exec(text);
    if (m) return m[1];
  }
  return null;
};
const resolveFn = (dir, fn) => {
  for (const d of [dir, dirname(dir)]) {
    const b = bodyOf(d, fn);
    if (b) return permIn(b.body) ?? helperPerm(b.body, b.text);
  }
  return null;
};
const out = [];
for (const r of routes) {
  if (!r.path.startsWith('/api/v1')) { out.push({ ...r, kind: 'infra' }); continue; }
  const best = lines.filter((l) => l.method === r.method && l.rel !== '/' && r.path.endsWith(l.rel)).sort((a, b) => b.rel.length - a.rel.length)[0];
  const entry = { ...r, schema: null, permission: null, how: 'none' };
  if (best) {
    entry.schema = /\b(parse[A-Za-z]+)\(/.exec(best.line)?.[1] ?? null;
    const dir = dirname(best.file);
    entry.permission = /requirePermission(?:Anywhere)?\('([^']+)'/.exec(best.line)?.[1] ?? null;
    if (entry.permission) entry.how = 'requirePermission';
    const call = /(\w+)\.(\w+)\(\s*req\.actor/.exec(best.line);
    if (!entry.permission && call) { entry.how = `${call[1]}.${call[2]}`; entry.permission = resolveFn(dir, call[2]); }
    const ctl = /\b(?:c|ctl|controller)\.(\w+)/.exec(best.line);
    if (!entry.permission && ctl) {
      const cb = bodyOf(dir, ctl[1]) ?? bodyOf(dir, `${ctl[1]}:`);
      entry.how = `controller.${ctl[1]}`;
      if (cb) {
        entry.permission = permIn(cb.body);
        const s = /service\.(\w+)\(/.exec(cb.body);
        if (!entry.permission && s) entry.permission = resolveFn(dir, s[1]);
      }
    }
  }
  out.push(entry);
}

// ---- what the source could not tell: reviewed by hand ----
const ORG_MANAGE = ['org.company.manage', 'org.costcentre.manage', 'org.hr.manage', 'org.project.manage', 'org.site.manage'];
const MANUAL = [
  [/^\/api\/v1\/core\/audit\/export-log$/, { g: 'self' }],
  [/^\/api\/v1\/ui\/preferences$/, { g: 'self' }],
  [/^\/api\/v1\/ui\/style-guide$/, { g: 'record', k: 'ui.styleguide.view' }],
  [/^\/api\/v1\/ui\/(drafts|forms|form-registry|saved-views|exports)(\/|$)/, { g: 'self' }],
  [/^\/api\/v1\/ui\/lists\//, { g: 'record' }],
  [/^\/api\/v1\/ui\/objects\//, { g: 'record' }], // the record type's own permission and data scope decide (platform/objects)
  [/^\/api\/v1\/ui\/reason-codes$/, { g: 'self' }],
  [/^\/api\/v1\/ui\/navigation\/(registry|changes)/, { k: 'ui.nav.manage' }],
  [/^\/api\/v1\/ui\/(navigation|favourites|recent|context-options|context|launchpad|bell)(\/|$)/, { g: 'self' }], // the shell serves every signed-in person what they may see (part 03.05)
  [/^\/api\/v1\/ui\/(device-settings|push-subscriptions|push\/test)(\/|$)/, { g: 'self' }], // a person's own camera settings and devices (part 03.06)
  [/^\/api\/v1\/ui\/dashboards\/:code\/(role-defaults|history)$/, { k: 'ui.dashboard.manage' }],
  [/^\/api\/v1\/ui\/(widgets|dashboards)(\/|$)/, { g: 'record' }], // each widget's own permission and data scope decide (part 03.07)
  [/^\/api\/v1\/ui\/qr\/resolve$/, { g: 'record' }], // the record a code names is checked by its own permission and data scope
  [/^\/api\/v1\/ui\/(duplicate-check|create-from)\//, { g: 'record' }],
  [/^\/api\/v1\/ui\/sample-requests/, { k: 'core.sample.use' }],
  [/^\/api\/v1\/(core|iam)\/lookups$/, { g: 'self' }],
  [/^\/api\/v1\/(core|iam)\/lookups\/:name$/, { g: 'record' }],
  [/^\/api\/v1\/core\/holidays$/, { g: 'self' }],
  [/^\/api\/v1\/core\/audit\/history$/, { g: 'record', k: 'core.audit.view' }],
  [/^\/api\/v1\/core\/audit\/segments\/:period\/export$/, { k: 'core.audit.view' }],
  [/^\/api\/v1\/core\/calc-traces$/, { g: 'self' }],
  [/^\/api\/v1\/core\/calc\/convert$/, { k: 'core.calc.view' }],
  [/^\/api\/v1\/core\/uoms?(-conversions)?(\/:id)?$/, { k: (m) => (m === 'GET' ? 'core.calc.view' : 'core.calc.manage') }],
  [/^\/api\/v1\/core\/connectors\/(:id\/(change-requests|disable|sample|test)|)$/, { k: (m) => (m === 'GET' ? 'core.connectors.view' : 'core.connectors.configure') }],
  [/^\/api\/v1\/core\/connectors/, { k: (m) => (m === 'GET' ? 'core.connectors.view' : 'core.connectors.configure') }],
  [/^\/api\/v1\/core\/(display-settings|session)$|feature-flags\/evaluate$|holidays\/check$/, { g: 'self' }],
  [/^\/api\/v1\/core\/files\/:id\/content$/, { g: 'public' }],
  [/^\/api\/v1\/core\/files/, { g: 'record' }],
  [/^\/api\/v1\/core\/formulas/, { k: (m, p) => (m === 'GET' || /\/(compare|test)$/.test(p) ? 'core.calc.view' : 'core.calc.manage') }],
  [/^\/api\/v1\/core\/integration-logs/, { k: 'core.connectors.view' }],
  [/^\/api\/v1\/core\/ops\/client-events$/, { k: (m) => (m === 'GET' ? 'core.ops.view' : null), g: (m) => (m === 'GET' ? 'permission' : 'self') }],
  [/^\/api\/v1\/core\/ops\//, { k: (m, p) => (m === 'GET' && !/follow/.test(p) ? 'core.ops.view' : /follow$|traces/.test(p) && m === 'GET' ? 'core.ops.view' : 'core.ops.manage') }],
  [/^\/api\/v1\/core\/parameters$/, { k: ['core.param.configure', 'core.param.configure_system'] }],
  [/^\/api\/v1\/core\/sample-bills/, { k: 'core.sample.use' }],
  [/^\/api\/v1\/core\/webhooks\//, { g: 'public' }],
  [/^\/api\/v1\/iam\/auth\/password\/change$/, { g: 'self' }],
  [/^\/api\/v1\/iam\/auth\//, { g: 'public' }],
  [/^\/api\/v1\/iam\/invitations\//, { g: 'public' }],
  [/^\/api\/v1\/iam\/dormant-accounts\/scan$/, { k: 'iam.sod.resolve' }],
  [/^\/api\/v1\/iam\/sod-rules\/:id$/, { o: true, k: (m) => (m === 'GET' ? 'iam.sod.view' : 'iam.sod.manage') }],
  [/^\/api\/v1\/iam\/sod-rules$/, { o: true, k: (m) => (m === 'GET' ? 'iam.sod.view' : 'iam.sod.manage') }],
  [/^\/api\/v1\/iam\/sod-violations\/:id\/resolve$/, { o: true, k: 'iam.sod.view' }],
  [/^\/api\/v1\/iam\/access-reviews\/:id\/cancel$/, { o: true, k: 'iam.review.manage' }],
  [/^\/api\/v1\/iam\/access-reviews\/decisions$/, { o: true, k: 'iam.review.decide' }],
  [/^\/api\/v1\/iam\/access-reviews\/:id\/items$/, { o: true, k: ['iam.review.view', 'iam.review.decide'] }],
  [/^\/api\/v1\/iam\/me(\/|$)/, { g: 'self' }],
  [/^\/api\/v1\/iam\/org\/:entity(\/:id)?$/, { k: (m) => (m === 'GET' ? 'org.view' : ORG_MANAGE), g: (m) => (m === 'GET' ? 'permission' : 'record') }],
  [/^\/api\/v1\/iam\/org\/:entity\/:id\/(blockers|descendants|history)$/, { k: 'org.view' }],
  [/^\/api\/v1\/iam\/org\//, { k: ORG_MANAGE, g: 'record' }],
  [/^\/api\/v1\/iam\/users\/export$/, { k: 'iam.user.export' }],
  [/^\/api\/v1\/iam\/users\/roles$/, { o: true, k: 'iam.user.view' }],
  [/^\/api\/v1\/iam\/roles$/, { o: true, k: (m) => (m === 'GET' ? 'iam.role.view' : 'iam.role.manage') }],
  [/^\/api\/v1\/iam\/users\/bulk$/,{ k: ['iam.user.manage', 'iam.user.suspend'] }],
  [/^\/api\/v1\/core\/holiday-calendars(\/:id)?$/, { g: (m) => (m === 'GET' ? 'self' : undefined), k: (m) => (m === 'GET' ? null : 'core.holiday.configure') }],
  [/^\/api\/v1\/iam\/users(\/import(\/template)?)?$/, { k: (m, p) => (m === 'GET' && p === '/api/v1/iam/users' ? 'iam.user.view' : 'iam.user.manage') }],
  [/^\/api\/v1\/iam\/users\/:id\/invite$/, { k: 'iam.user.manage' }],
];
const RATE = (m, p) => {
  // refresh and resume carry a long random token and happen on every page load, so they are ordinary writes, not guessable sign-ins
  if (/\/auth\/(login|captcha|password\/(forgot|reset|required-change)|pin-unlock)$/.test(p)) return 'auth';
  if (/\/auth\/mfa\/|\/me\/mfa\//.test(p)) return 'otp';
  if (/\/ui\/exports$/.test(p)) return 'read'; // the list of one's own exports (polled while one is being prepared), not an export
  if (/export|\/template$/.test(p)) return 'export';
  if (/webhooks/.test(p)) return 'webhook';
  return m === 'GET' ? 'read' : 'write';
};
const SCOPE = (p) => (/\/iam\/me|\/auth\//.test(p) ? 'own' : /org\/(:entity|projects|sites|cost)|sample-|\/files/.test(p) ? 'project' : 'company');
const rows = out.map((e) => {
  if (e.kind === 'infra') return { m: e.method, p: e.path, g: 'infra', k: null, s: null, scope: 'none', rate: 'read', audit: false };
  let k = e.permission;
  let g = k ? 'permission' : null;
  for (const [re, v] of MANUAL) {
    if (!re.test(e.path)) continue;
    if (!k || v.o || re.source.includes('auth') || v.g) {
      const val = typeof v.k === 'function' ? v.k(e.method, e.path) : v.k;
      const gg = typeof v.g === 'function' ? v.g(e.method) : v.g;
      if (val !== undefined) k = val;
      if (gg) g = gg; else if (val) g = 'permission';
      if (gg && !val) k = null;
    }
    break;
  }
  if (!g) g = k ? 'permission' : 'UNRESOLVED';
  return { m: e.method, p: e.path, g, k: k ?? null, s: e.schema, scope: SCOPE(e.path), rate: RATE(e.method, e.path), audit: e.method !== 'GET' };
});
console.log(JSON.stringify(rows, null, 1));

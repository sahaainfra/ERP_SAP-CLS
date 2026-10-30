// Usage: node scripts/secret_scan.mjs
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepository } from './lib/secrets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const findings = scanRepository(root);
if (findings.length) {
  console.error(`Secret scan FAILED: ${findings.length} possible secret(s). Remove them and rotate the credential.`);
  for (const f of findings) console.error(`  - ${f.file}:${f.line} (${f.id})`);
  process.exit(1);
}
console.log('Secret scan OK: no credentials found in tracked or new files.');

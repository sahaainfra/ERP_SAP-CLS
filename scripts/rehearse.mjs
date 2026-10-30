// Usage: node scripts/rehearse.mjs  -> deploy, rollback and failure drills on a local "staging" directory.
// Writes reports/rehearsal.json. Exit code 1 if any step fails or rollback exceeds its target.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rehearse } from './lib/rehearsal.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = await rehearse({ root, workDir: join(root, '.deploy-rehearsal'), port: 3390, log: () => {} });
for (const s of result.steps) console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name} (${s.ms} ms) ${s.detail}`);
mkdirSync(join(root, 'reports'), { recursive: true });
writeFileSync(join(root, 'reports', 'rehearsal.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(result.ok ? '\nRehearsal PASSED.' : '\nRehearsal FAILED.');
process.exit(result.ok ? 0 : 1);

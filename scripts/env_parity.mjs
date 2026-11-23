#!/usr/bin/env node
// Part 30.08 FR-01: environment parity of infra/environments (the rules are in src/server/modules/tst/envparity.js). Exit 1 on any problem.
import { checkParity } from '../src/server/modules/tst/envparity.js';

const r = checkParity();
for (const p of r.problems) console.error(`  ${p}`);
console.log(r.problems.length ? `Environment parity FAILED: ${r.problems.length} problem(s).` : `Environment parity OK: ${r.environments.join(', ')} name the same ${r.keys.length} keys.`);
process.exit(r.problems.length ? 1 : 0);

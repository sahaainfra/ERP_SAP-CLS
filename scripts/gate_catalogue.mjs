// Part 166.6: the checklists of the gates G1–G4, derived from what the repository records (the original WG-01…WG-16 of 07.14 and the criteria of
// 03_MASTER_ROADMAP.md are not in the repository: D-690). For each gate: one criterion per part that docs/erp/PROGRESS.csv gives the gate, with its
// completion report and discovery note as evidence, and one criterion for the open Critical and High defects of those parts.
//   node scripts/gate_catalogue.mjs      writes src/server/modules/hr/gate-catalogue.json
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const GATES = [
  { code: 'G1', name: 'Platform Gate', prefix: 'G1' },
  { code: 'G2', name: 'Workforce-First Gate', prefix: 'G2' },
  { code: 'G3', name: 'Project Baseline Gate', prefix: 'G3' },
  { code: 'G4', name: 'Execution Gate', prefix: 'G4' },
];

/** A CSV line with quoted fields (commas and doubled quotes inside quotes). */
function csvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

const [head, ...lines] = readFileSync('docs/erp/PROGRESS.csv', 'utf8').split('\n').filter((l) => l.trim());
const cols = csvLine(head);
const rows = lines.map((l) => Object.fromEntries(csvLine(l).map((v, i) => [cols[i], v])));

const evidenceOf = (part) => [
  { label: `Completion report ${part}`, path: `docs/erp/COMPLETION/${part}.md` },
  ...(existsSync(`docs/erp/DISCOVERY/${part}.md`) ? [{ label: `Discovery note ${part}`, path: `docs/erp/DISCOVERY/${part}.md` }] : []),
];

const gates = GATES.map((g) => {
  const parts = rows.filter((r) => String(r.gate).startsWith(g.prefix));
  return {
    code: g.code,
    name: g.name,
    criteria: [
      ...parts.map((r) => ({
        code: `${g.code}-P${r.part_id}`, kind: 'PART', partId: r.part_id,
        title: `Part ${r.part_id} ${r.title}: built, its acceptance criteria and tests reported`,
        evidence: evidenceOf(r.part_id),
      })),
      {
        code: `${g.code}-DEF`, kind: 'DEFECTS', partId: null,
        title: `No open Critical or High defect of the gate's ${parts.length} parts is left without a decision`,
        evidence: [{ label: 'Defects by part', path: 'docs/erp/DEFECTS_BY_PART.md' }, { label: 'Defect register', path: 'docs/erp/DEFECTS.md' }],
      },
    ],
  };
});

const out = { version: '166.6-1', derived: true, note: 'Derived from docs/erp/PROGRESS.csv, the completion reports and the discovery notes (D-690).', gates };
writeFileSync('src/server/modules/hr/gate-catalogue.json', `${JSON.stringify(out, null, 1)}\n`);
console.log(gates.map((g) => `${g.code}: ${g.criteria.length} criteria`).join(', '));

// Part 166.6: the checklists of the gates G1–G4, derived from what the repository records (the original WG-01…WG-16 of 07.14 and the criteria of
// 03_MASTER_ROADMAP.md are not in the repository: D-690). For each gate: one criterion per part that docs/erp/PROGRESS.csv gives the gate, with its
// completion report and discovery note as evidence, and one criterion for the open Critical and High defects of those parts.
//   node scripts/gate_catalogue.mjs      writes src/server/modules/hr/gate-catalogue.json and docs/erp/GATES/G1.md … G4.md
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

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

// ---- docs/erp/GATES/<gate>.md: the evidence of each gate, written from the same catalogue (the review and the sign-off are in the application) ----
const statusOf = new Map(rows.map((r) => [r.part_id, r.status]));
const defects = readFileSync('docs/erp/DEFECTS.md', 'utf8').split('\n').filter((l) => l.startsWith('| D-')).map((l) => l.slice(1, -1).split('|').map((x) => x.trim()))
  .filter((c) => c.length >= 9).map(([id, area, description, severity, _cause, owner, status]) => ({ id, area, description, severity, owner, status }));
mkdirSync('docs/erp/GATES', { recursive: true });
for (const g of gates) {
  const parts = new Set(g.criteria.filter((c) => c.partId).map((c) => c.partId));
  const open = defects.filter((d) => parts.has(d.owner) && ['Critical', 'High'].includes(d.severity) && /^Open/.test(d.status));
  const md = [
    `# ${g.code} ${g.name}: evidence`,
    '',
    `Written by \`scripts/gate_catalogue.mjs\` (catalogue ${out.version}) from \`docs/erp/PROGRESS.csv\`, the completion reports, the discovery notes and \`docs/erp/DEFECTS.md\`.`,
    'The criteria are **derived** from what the repository records: the original checklist (WG-01…WG-16 of 07.14) and the criteria of',
    '`03_MASTER_ROADMAP.md` are not in the repository (D-690). The review of each criterion (met / not met, note, reviewer, date) and the sign-off',
    '(technical lead ITADM, then the director, through the workflow engine) are recorded in the application: **Programme Gates** (`/admin/gates`),',
    `gate page \`/admin/gate?code=${g.code}\`, and its PDF report.`,
    '',
    `## Criteria (${g.criteria.length})`,
    '',
    '| Criterion | Part status in PROGRESS.csv | Evidence |',
    '|---|---|---|',
    ...g.criteria.map((c) => `| ${c.code}: ${c.title} | ${c.partId ? statusOf.get(c.partId) ?? '—' : `${open.length} open Critical/High`} | ${c.evidence.map((e) => `[${e.label}](../${e.path.replace(/^docs\/erp\//, '')})`).join('<br>')} |`),
    '',
    `## Open Critical and High defects owned by the parts of ${g.code} (${open.length})`,
    '',
    ...(open.length ? ['| Defect | Severity | Owning part | Description |', '|---|---|---|---|', ...open.map((d) => `| ${d.id} | ${d.severity} | ${d.owner} | ${d.description.replace(/\|/g, '/')} |`)] : ['None.']),
    '',
  ].join('\n');
  writeFileSync(`docs/erp/GATES/${g.code}.md`, md);
}
console.log('docs/erp/GATES/G1.md … G4.md written');

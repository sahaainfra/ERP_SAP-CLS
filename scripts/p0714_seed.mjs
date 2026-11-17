// Part 07.14 (built in 166.6): writes its migration. The workforce dashboard's widgets and system layout come from the card definitions in
// src/server/modules/ui/overviews.js (as for 166.5); the gates' tables are new (the criteria come from src/server/modules/hr/gate-catalogue.json
// when a company first opens the gates, so a criterion added to the catalogue reaches every company).
//   node scripts/p0714_seed.mjs       writes migrations/20261212000331_hr_p0714.{up,down}.sql
import { writeFileSync } from 'node:fs';
import { OVERVIEWS, allCards } from '../src/server/modules/ui/overviews.js';
import { dashboardSql, q, widgetSql } from './overview_seed.mjs';

const NAME = 'migrations/20261212000331_hr_p0714';
const wf = OVERVIEWS.find((o) => o.part === '07.14');
const cards = allCards().filter((c) => c.overview?.part === '07.14');
const STD = `created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at TEXT,
  deleted_by TEXT,
  source_type TEXT,
  source_id TEXT,
  remarks TEXT`;
const nav = [
  ['hr-workforce', 'g-hr', 'sidebar', 'Workforce Dashboard', 'कार्यबल डैशबोर्ड', '/hr/workforce', 'erp.group.workforce', 'hr.workforce.view', 141, 'workforce attendance today present absent late leave contract labour overtime leave liability attrition expiring documents', 1],
  ['admin-gates', 'g-administration', 'sidebar', 'Programme Gates', 'कार्यक्रम गेट', '/admin/gates', 'erp.state.approved', 'hr.gate.view', 405, 'gate gates sign-off checklist evidence platform workforce baseline execution g1 g2 g3 g4', 1],
];
const navSql = nav.map(([code, parent, placement, label, hi, route, icon, perm, sort, kw, mobile]) => `INSERT OR IGNORE INTO ui_navigation_entries (code, parent_code, kind, placement, label, label_hi, route, icon, permission_key, feature_flag, sort_order, keywords, mobile_visible, onboarding, shortcut, tile, quick_create_label, quick_create_route, created_by, source_type) VALUES (${q(code)}, ${q(parent)}, 'page', ${q(placement)}, ${q(label)}, ${q(hi)}, ${q(route)}, ${q(icon)}, ${q(perm)}, 'ff.hr.p0714', ${sort}, ${q(kw)}, ${mobile}, 'none', NULL, 0, NULL, NULL, 'migration', 'reference_seed');`);

const up = `-- Part 07.14 (HR & workforce dashboards and the Workforce-First Gate), built in 166.6. Written by scripts/p0714_seed.mjs.
-- The flag; the gates G1–G4 of each company (hr_gates) and their criteria (hr_gate_criteria: status, note, reviewer, date; the evidence links come
-- from the catalogue in code); the menu entries; the ${cards.length} cards of the workforce dashboard as widgets and its system layout.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type) VALUES ('ff.hr.p0714', 'HR: workforce dashboard and the gates G1–G4 with their sign-off (part 07.14, built in 166.6)', 0, NULL, 0, 'migration', 'reference_seed');
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type) SELECT 'ff.hr.p0714', 'HR: workforce dashboard and the gates G1–G4 with their sign-off (part 07.14, built in 166.6)', 0, env.name, 1, 'migration', 'reference_seed' FROM (SELECT 'development' AS name UNION ALL SELECT 'test') AS env;
CREATE TABLE IF NOT EXISTS hr_gates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code TEXT NOT NULL CHECK (code IN ('G1', 'G2', 'G3', 'G4')),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SUBMITTED', 'PASSED', 'RETURNED')),
  catalogue_version TEXT NOT NULL,
  workflow_instance_id INTEGER,
  submitted_by TEXT,
  submitted_at TEXT,
  passed_at TEXT,
  ${STD}
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_gates_company_code ON hr_gates (company_id, code);
CREATE TABLE IF NOT EXISTS hr_gate_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  gate_id INTEGER NOT NULL REFERENCES hr_gates (id),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  part_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('PART', 'DEFECTS')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'MET', 'NOT_MET')),
  note TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  extra_evidence_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 100,
  ${STD}
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_gate_criteria_gate_code ON hr_gate_criteria (gate_id, code);
CREATE INDEX IF NOT EXISTS ix_hr_gate_criteria_company ON hr_gate_criteria (company_id, status);
${navSql.join('\n')}
${widgetSql(cards, 700).join('\n')}
${dashboardSql(wf)}
`;
const down = `-- Part 07.14 down: the dashboard, its widgets, the menu entries, the gates and the flag.
DELETE FROM ui_dashboards WHERE code = ${q(wf.code)};
DELETE FROM ui_widgets WHERE code IN (${cards.map((c) => q(c.code)).join(', ')});
DELETE FROM ui_navigation_entries WHERE code IN ('hr-workforce', 'admin-gates');
DROP TABLE IF EXISTS hr_gate_criteria;
DROP TABLE IF EXISTS hr_gates;
DELETE FROM core_feature_flags WHERE key = 'ff.hr.p0714';
`;
writeFileSync(`${NAME}.up.sql`, up);
writeFileSync(`${NAME}.down.sql`, down);
console.log(`${NAME}: ${cards.length} widgets, the gates' tables, ${nav.length} menu entries`);

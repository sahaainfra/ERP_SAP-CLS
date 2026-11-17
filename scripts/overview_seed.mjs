// Part 166.5: writes the migration of the overview pages from the card definitions in src/server/modules/ui/overviews.js, so the rows of
// `ui_widgets` and `ui_dashboards` and the providers in code cannot drift apart (tests/overviews-p16605.test.js checks both ways).
//   node scripts/overview_seed.mjs            writes migrations/20261211000330_ui_p16605.{up,down}.sql
import { writeFileSync } from 'node:fs';
import { OVERVIEWS, STANDALONE, allCards } from '../src/server/modules/ui/overviews.js';

const NAME = 'migrations/20261211000330_ui_p16605';
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const TYPES_OLD = "'kpi', 'line', 'bar', 'stacked', 'area', 'donut', 'gauge', 'heatmap', 'gantt', 'table', 'alerts', 'list', 'calendar', 'map', 'notice', 'actions'";
const TYPES_NEW = `${TYPES_OLD}, 'topn', 'todo', 'scatter'`;
const table = (name, types) => `CREATE TABLE ${name} (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER REFERENCES org_companies (id),
  code               TEXT    NOT NULL UNIQUE,
  module             TEXT    NOT NULL,
  title              TEXT    NOT NULL,
  title_hi           TEXT,
  description        TEXT,
  type               TEXT    NOT NULL CHECK (type IN (${types})),
  data_endpoint      TEXT    NOT NULL,
  params_schema_json TEXT    NOT NULL DEFAULT '{}',
  permission_key     TEXT    NOT NULL,
  default_w          INTEGER NOT NULL DEFAULT 4 CHECK (default_w BETWEEN 1 AND 12),
  default_h          INTEGER NOT NULL DEFAULT 1 CHECK (default_h BETWEEN 1 AND 4),
  refresh_sec        INTEGER NOT NULL DEFAULT 60 CHECK (refresh_sec = 0 OR refresh_sec >= 15),
  drill_route        TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 100,
  project_id         INTEGER,
  site_id            INTEGER,
  created_by         TEXT,
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by         TEXT,
  updated_at         TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at         TEXT,
  deleted_by         TEXT,
  source_type        TEXT,
  source_id          TEXT,
  remarks            TEXT
);`;
const rebuild = (types) => [
  table('ui_widgets_rebuild', types),
  'INSERT INTO ui_widgets_rebuild SELECT * FROM ui_widgets;',
  'DROP TABLE ui_widgets;',
  'ALTER TABLE ui_widgets_rebuild RENAME TO ui_widgets;',
  'CREATE INDEX IF NOT EXISTS ix_ui_widgets_module ON ui_widgets (module, sort_order);',
  'CREATE INDEX IF NOT EXISTS ix_ui_widgets_company ON ui_widgets (company_id);',
].join('\n');

const cards = allCards();
const widgetRows = cards.map((c, i) => {
  const o = c.overview;
  const permission = o ? o.permission : c.permission;
  const module = o ? o.module : c.module;
  const description = o ? `${c.title}, from the ${o.source}. Opens ${c.drill}.` : c.description;
  return `INSERT OR IGNORE INTO ui_widgets (code, module, title, description, type, data_endpoint, permission_key, default_w, default_h, refresh_sec, drill_route, sort_order, created_by, source_type) VALUES (${q(c.code)}, ${q(module)}, ${q(c.title)}, ${q(description)}, ${q(c.type)}, ${q(`/api/v1/ui/widgets/${c.code}/data`)}, ${q(permission)}, ${c.w}, ${c.h}, ${c.type === 'todo' || c.type === 'alerts' ? 60 : 300}, ${q(c.drill)}, ${600 + i}, 'migration', 'reference_seed');`;
});
const layout = (cs) => JSON.stringify(cs.map((c, i) => ({ id: `c${i + 1}`, widget: c.code, w: c.w, h: c.h })));
const dashRows = [
  ...OVERVIEWS.map((o) => `INSERT OR IGNORE INTO ui_dashboards (company_id, code, name, owner_type, owner_ref, permission_key, layout_json, filters_json, is_default, created_by, source_type) VALUES (NULL, ${q(o.code)}, ${q(o.name)}, 'system', 'system', ${q(o.permission)}, ${q(layout(o.cards))}, '{}', 1, 'migration', 'reference_seed');`),
  `INSERT OR IGNORE INTO ui_dashboards (company_id, code, name, owner_type, owner_ref, permission_key, layout_json, filters_json, is_default, created_by, source_type) VALUES (NULL, 'home-insights', 'Home insights', 'system', 'system', 'self', ${q(layout(STANDALONE))}, '{}', 1, 'migration', 'reference_seed');`,
];
const codes = cards.map((c) => q(c.code)).join(', ');
const dashCodes = [...OVERVIEWS.map((o) => q(o.code)), "'home-insights'"].join(', ');

const up = `-- Part 166.5: Home, role dashboards and overview pages (Fiori overview style). Written by scripts/overview_seed.mjs from src/server/modules/ui/overviews.js.
-- The flag; the widget types of the new cards (Top-N, to-do, scatter) in the CHECK of ui_widgets (SQLite: the table is rebuilt with the same columns
-- and rows); the ${cards.length} cards as widgets (each reads the service of the page it belongs to, never a figure of its own) and the system layout of
-- each overview page and of Home insights. Home insights take their role layouts from code (roleLayouts) until a role default is saved.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type) VALUES ('ff.ui.p16605', 'UI: Home insight cards by role and the module dashboards as overview pages of cards (part 166.5)', 0, NULL, 0, 'migration', 'reference_seed');
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type) SELECT 'ff.ui.p16605', 'UI: Home insight cards by role and the module dashboards as overview pages of cards (part 166.5)', 0, env.name, 1, 'migration', 'reference_seed' FROM (SELECT 'development' AS name UNION ALL SELECT 'test') AS env;
${rebuild(TYPES_NEW)}
${widgetRows.join('\n')}
${dashRows.join('\n')}
`;
const down = `-- Part 166.5 down: the dashboards and personal or role copies of them, the cards, the widget types, the flag.
DELETE FROM ui_dashboards WHERE code IN (${dashCodes});
DELETE FROM ui_widgets WHERE code IN (${codes});
${rebuild(TYPES_OLD)}
DELETE FROM core_feature_flags WHERE key = 'ff.ui.p16605';
`;
writeFileSync(`${NAME}.up.sql`, up);
writeFileSync(`${NAME}.down.sql`, down);
console.log(`${NAME}: ${cards.length} widgets, ${OVERVIEWS.length + 1} dashboards`);

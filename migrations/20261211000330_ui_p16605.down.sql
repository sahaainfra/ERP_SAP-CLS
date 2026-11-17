-- Part 166.5 down: the dashboards and personal or role copies of them, the cards, the widget types, the flag.
DELETE FROM ui_dashboards WHERE code IN ('ov-qs', 'ov-tower', 'ov-stores', 'ov-hse', 'ov-qa', 'ov-proc', 'ov-plant', 'ov-hr', 'ov-budget', 'home-insights');
DELETE FROM ui_widgets WHERE code IN ('ov.qs.unbilled_wip', 'ov.qs.certified_not_billed', 'ov.qs.billed_not_collected', 'ov.qs.margin', 'ov.qs.chain', 'ov.qs.top_unbilled', 'ov.qs.queues', 'ov.qs.leakage', 'ov.tower.value', 'ov.tower.billed', 'ov.tower.outstanding', 'ov.tower.margin', 'ov.tower.position', 'ov.tower.exceptions', 'ov.stores.value', 'ov.stores.below_reorder', 'ov.stores.pending', 'ov.stores.reserved', 'ov.stores.by_store', 'ov.stores.ageing', 'ov.stores.reorder_list', 'ov.hse.safe_hours', 'ov.hse.ltifr', 'ov.hse.trir', 'ov.hse.incidents', 'ov.hse.observations', 'ov.hse.leading', 'ov.qa.first_time_ir', 'ov.qa.open_ncr', 'ov.qa.cube_fail', 'ov.qa.open_ir', 'ov.qa.kpis', 'ov.qa.exceptions', 'ov.proc.spend_fy', 'ov.proc.open_prs', 'ov.proc.overdue', 'ov.proc.savings', 'ov.proc.queues', 'ov.proc.single_source', 'ov.plant.fleet', 'ov.plant.utilisation', 'ov.plant.breakdown', 'ov.plant.expiring', 'ov.plant.by_state', 'ov.plant.by_project', 'ov.hr.headcount', 'ov.hr.joiners', 'ov.hr.leavers', 'ov.hr.pending', 'ov.hr.by_department', 'ov.hr.by_site', 'ov.budget.totals', 'ov.budget.available', 'ov.budget.top_overrun', 'ov.todo.mine', 'ov.feed.notifications');
CREATE TABLE ui_widgets_rebuild (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER REFERENCES org_companies (id),
  code               TEXT    NOT NULL UNIQUE,
  module             TEXT    NOT NULL,
  title              TEXT    NOT NULL,
  title_hi           TEXT,
  description        TEXT,
  type               TEXT    NOT NULL CHECK (type IN ('kpi', 'line', 'bar', 'stacked', 'area', 'donut', 'gauge', 'heatmap', 'gantt', 'table', 'alerts', 'list', 'calendar', 'map', 'notice', 'actions')),
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
);
INSERT INTO ui_widgets_rebuild SELECT * FROM ui_widgets;
DROP TABLE ui_widgets;
ALTER TABLE ui_widgets_rebuild RENAME TO ui_widgets;
CREATE INDEX IF NOT EXISTS ix_ui_widgets_module ON ui_widgets (module, sort_order);
CREATE INDEX IF NOT EXISTS ix_ui_widgets_company ON ui_widgets (company_id);
DELETE FROM core_feature_flags WHERE key = 'ff.ui.p16605';

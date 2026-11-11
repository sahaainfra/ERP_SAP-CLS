-- Part 15.03: requests for quotation and vendor quotations.
-- proc_rfqs / proc_rfq_lines: an RFQ made from approved requisition lines, with its terms, due date and, when fewer vendors than the minimum are invited, the single-source justification and its approval.
-- proc_rfq_vendors: the vendors invited, the channel, the tokenised link (only its hash is kept), its expiry and use, the response status and the reminders; proc_rfq_clarifications: the questions and answers.
-- proc_quotations / proc_quotation_lines: what a vendor offered (entered by procurement or by the vendor on the tokenised page), versions of a revised quotation, and the landed rate of each line.

CREATE TABLE IF NOT EXISTS proc_rfqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  title           TEXT    NOT NULL,
  issue_date      TEXT,
  due_date        TEXT    NOT NULL,
  terms_json      TEXT,
  est_total       INTEGER NOT NULL DEFAULT 0 CHECK (est_total >= 0),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'ISSUED', 'CLOSED', 'CANCELLED', 'SUPERSEDED')),
  revision_no     INTEGER NOT NULL DEFAULT 0 CHECK (revision_no >= 0),
  parent_id       INTEGER REFERENCES proc_rfqs (id),
  justified       INTEGER NOT NULL DEFAULT 0 CHECK (justified IN (0, 1)),
  justification   TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
  issued_at       TEXT,
  issued_by       TEXT,
  closed_at       TEXT,
  cancel_reason   TEXT,
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_rfqs_doc ON proc_rfqs (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_proc_rfqs_company ON proc_rfqs (company_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_rfqs_project ON proc_rfqs (org_project_id, status, due_date);
CREATE INDEX IF NOT EXISTS ix_proc_rfqs_parent ON proc_rfqs (parent_id);

CREATE TABLE IF NOT EXISTS proc_rfq_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  rfq_id          INTEGER NOT NULL REFERENCES proc_rfqs (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  pr_line_id      INTEGER NOT NULL REFERENCES proc_pr_lines (id),
  item_id         INTEGER REFERENCES mdm_items (id),
  service_desc    TEXT,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  uom             TEXT    NOT NULL,
  spec            TEXT,
  required_by     TEXT,
  delivery_site_id INTEGER REFERENCES org_sites (id),
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_rfq_lines_no ON proc_rfq_lines (rfq_id, line_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proc_rfq_lines_company ON proc_rfq_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_rfq_lines_pr ON proc_rfq_lines (pr_line_id);
CREATE INDEX IF NOT EXISTS ix_proc_rfq_lines_item ON proc_rfq_lines (item_id);

CREATE TABLE IF NOT EXISTS proc_rfq_vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  rfq_id          INTEGER NOT NULL REFERENCES proc_rfqs (id),
  vendor_id       INTEGER NOT NULL REFERENCES mdm_partners (id),
  channel         TEXT    NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL', 'WHATSAPP', 'LINK')),
  contact_to      TEXT,
  token_hash      TEXT,
  token_expires   TEXT,
  token_used_at   TEXT,
  response_status TEXT    NOT NULL DEFAULT 'INVITED' CHECK (response_status IN ('INVITED', 'SENT', 'VIEWED', 'RESPONDED', 'DECLINED')),
  sent_at         TEXT,
  send_status     TEXT,
  send_note       TEXT,
  viewed_at       TEXT,
  responded_at    TEXT,
  decline_reason  TEXT,
  reminder_count  INTEGER NOT NULL DEFAULT 0 CHECK (reminder_count >= 0),
  last_reminder_at TEXT,
  regret_sent_at  TEXT,
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_rfq_vendors ON proc_rfq_vendors (rfq_id, vendor_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_rfq_vendors_token ON proc_rfq_vendors (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_proc_rfq_vendors_company ON proc_rfq_vendors (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_rfq_vendors_vendor ON proc_rfq_vendors (vendor_id);
CREATE INDEX IF NOT EXISTS ix_proc_rfq_vendors_status ON proc_rfq_vendors (response_status, last_reminder_at);

CREATE TABLE IF NOT EXISTS proc_quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  rfq_id          INTEGER NOT NULL REFERENCES proc_rfqs (id),
  vendor_id       INTEGER NOT NULL REFERENCES mdm_partners (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  quote_ref       TEXT,
  quote_date      TEXT    NOT NULL,
  valid_until     TEXT    NOT NULL,
  delivery_days   INTEGER NOT NULL DEFAULT 0 CHECK (delivery_days >= 0),
  payment_terms   TEXT,
  freight_terms   TEXT,
  gst_inclusive   INTEGER NOT NULL DEFAULT 0 CHECK (gst_inclusive IN (0, 1)),
  gst_recoverable INTEGER NOT NULL DEFAULT 1 CHECK (gst_recoverable IN (0, 1)),
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  parent_id       INTEGER REFERENCES proc_quotations (id),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'RECEIVED', 'SUPERSEDED', 'WITHDRAWN', 'CANCELLED')),
  entered_via     TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (entered_via IN ('MANUAL', 'PORTAL')),
  entered_by      TEXT,
  received_at     TEXT,
  total_landed    INTEGER NOT NULL DEFAULT 0 CHECK (total_landed >= 0),
  deviations      TEXT,
  cancel_reason   TEXT,
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_quotations_doc ON proc_quotations (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_proc_quotations_company ON proc_quotations (company_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_quotations_rfq ON proc_quotations (rfq_id, vendor_id, version_no);
CREATE INDEX IF NOT EXISTS ix_proc_quotations_vendor ON proc_quotations (vendor_id);
CREATE INDEX IF NOT EXISTS ix_proc_quotations_project ON proc_quotations (org_project_id);
CREATE INDEX IF NOT EXISTS ix_proc_quotations_parent ON proc_quotations (parent_id);

CREATE TABLE IF NOT EXISTS proc_quotation_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  quotation_id    INTEGER NOT NULL REFERENCES proc_quotations (id),
  rfq_line_id     INTEGER NOT NULL REFERENCES proc_rfq_lines (id),
  offered_qty     INTEGER NOT NULL CHECK (offered_qty >= 0),
  rate            INTEGER NOT NULL CHECK (rate >= 0),
  discount_pct    INTEGER NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 1000000),
  gst_rate        INTEGER NOT NULL DEFAULT 0 CHECK (gst_rate >= 0 AND gst_rate <= 1000000),
  freight         INTEGER NOT NULL DEFAULT 0 CHECK (freight >= 0),
  loading         INTEGER NOT NULL DEFAULT 0 CHECK (loading >= 0),
  other_charges   INTEGER NOT NULL DEFAULT 0 CHECK (other_charges >= 0),
  landed_rate     INTEGER NOT NULL DEFAULT 0 CHECK (landed_rate >= 0),
  landed_amount   INTEGER NOT NULL DEFAULT 0 CHECK (landed_amount >= 0),
  make            TEXT,
  deviation       TEXT,
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_quotation_lines ON proc_quotation_lines (quotation_id, rfq_line_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proc_quotation_lines_company ON proc_quotation_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_quotation_lines_rfq_line ON proc_quotation_lines (rfq_line_id);

CREATE TABLE IF NOT EXISTS proc_rfq_clarifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  rfq_id          INTEGER NOT NULL REFERENCES proc_rfqs (id),
  vendor_id       INTEGER REFERENCES mdm_partners (id),
  asked_by        TEXT    NOT NULL,
  question        TEXT    NOT NULL,
  answer          TEXT,
  answered_by     TEXT,
  answered_at     TEXT,
  share_all       INTEGER NOT NULL DEFAULT 0 CHECK (share_all IN (0, 1)),
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE INDEX IF NOT EXISTS ix_proc_rfq_clar_company ON proc_rfq_clarifications (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_rfq_clar_rfq ON proc_rfq_clarifications (rfq_id, answered_at);
CREATE INDEX IF NOT EXISTS ix_proc_rfq_clar_vendor ON proc_rfq_clarifications (vendor_id);
CREATE INDEX IF NOT EXISTS ix_proc_rfq_lines_delivery_site_id ON proc_rfq_lines (delivery_site_id);

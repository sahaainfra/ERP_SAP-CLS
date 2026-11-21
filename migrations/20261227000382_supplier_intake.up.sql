CREATE TABLE IF NOT EXISTS ptl_asn_invoices (
  dispatch_id INTEGER PRIMARY KEY REFERENCES proc_dispatches (id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES core_files (id)
);
CREATE INDEX IF NOT EXISTS ix_ptl_asn_invoices_file ON ptl_asn_invoices (file_id);

CREATE TABLE IF NOT EXISTS ptl_vdr_orders (
  item_id INTEGER PRIMARY KEY REFERENCES engg_vdr_items (id) ON DELETE CASCADE,
  po_id INTEGER NOT NULL REFERENCES proc_purchase_orders (id)
);
CREATE INDEX IF NOT EXISTS ix_ptl_vdr_orders_po ON ptl_vdr_orders (po_id);

CREATE TABLE IF NOT EXISTS ptl_rfq_files (
  file_id INTEGER PRIMARY KEY REFERENCES core_files (id) ON DELETE CASCADE
);

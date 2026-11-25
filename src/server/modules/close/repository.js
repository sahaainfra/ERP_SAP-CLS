/**
 * Module M26: the reads the mount file (index.js) needs for file access, event consumers, jobs and the part tables
 * (audit AUD-DEF-003: mount files carry no SQL of their own).
 */

/** Whether a table of a part exists (a part's routes mount only after its migration). */
export const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

/** The status and project scope of a commissioning record that carries files (a certificate or a test pack). */
export function systemChildScope(db, table, id, companyId) {
  if (!['tnc_certificates', 'tnc_test_packs'].includes(table)) throw new Error(`not a commissioning file table: ${table}`);
  return db.prepare(`SELECT x.status, x.company_id, s.org_project_id, s.org_site_id FROM ${table} x JOIN tnc_systems s ON s.id = x.system_id WHERE x.id = ? AND x.company_id = ? AND x.deleted_at IS NULL`).get(Number(id), companyId);
}

/** The status and project scope of a handover, or of the handover of a checklist item. */
export function handoverScope(db, table, id, companyId) {
  const from = table === 'ho_handovers' ? 'ho_handovers h WHERE h.id = ?' : 'ho_checklist_items i JOIN ho_handovers h ON h.id = i.handover_id WHERE i.id = ?';
  return db.prepare(`SELECT h.status, h.company_id, h.org_project_id, h.org_site_id FROM ${from} AND h.company_id = ? AND h.deleted_at IS NULL`).get(Number(id), companyId);
}

/** The status and project scope of a defects liability complaint. */
export const complaintScope = (db, id, companyId) => db.prepare('SELECT c.status, c.company_id, p.org_project_id, p.org_site_id FROM dlp_complaints c JOIN dlp_periods p ON p.id = c.period_id WHERE c.id = ? AND c.company_id = ? AND c.deleted_at IS NULL').get(Number(id), companyId);

/** The status and project of a closeout. */
export const closureScope = (db, id, companyId) => db.prepare('SELECT status, company_id, org_project_id FROM cls_closures WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), companyId);

/** The company of a handover (for the event consumer). */
export const handoverCompany = (db, id) => db.prepare('SELECT company_id FROM ho_handovers WHERE id = ?').get(Number(id))?.company_id ?? null;

/** Every company (for the sweep job). */
export const companyIds = (db) => db.prepare('SELECT id FROM org_companies').all().map((c) => c.id);

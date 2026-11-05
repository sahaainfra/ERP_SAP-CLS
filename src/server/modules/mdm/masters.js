import { masterReferences, masterTypes } from '../../platform/mdm/index.js';

// The first master governed by the framework (part 06.01, AC-01): the business partner (vendors, subcontractors, clients, consultants). Part 06.04 builds the full partner master (contacts, addresses, bank verification,
// compliance) on this same type: the framework, its approvals, duplicate rules and quality rules stay. It is a financial master, so new records, sensitive changes and merges also go to the accounts manager.
masterTypes.register({
  type: 'PARTNER', label: 'Business partner', module: 'mdm', financial: true, codePrefix: 'BP', nameField: 'name',
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true, max: 160 },
    { key: 'kind', label: 'Kind', type: 'enum', required: true, options: [['VENDOR', 'Vendor'], ['SUBCONTRACTOR', 'Subcontractor'], ['CLIENT', 'Client'], ['CONSULTANT', 'Consultant']] },
    { key: 'pan', label: 'PAN', type: 'text', format: 'PAN', sensitive: true, unique: 'block', max: 10 },
    { key: 'gstin', label: 'GSTIN', type: 'text', format: 'GSTIN', sensitive: true, unique: 'block', max: 15 },
    { key: 'mobile', label: 'Mobile', type: 'text', format: 'MOBILE', unique: 'warn', max: 16 },
    { key: 'email', label: 'E-mail', type: 'text', format: 'EMAIL', max: 120 },
    { key: 'address', label: 'Address', type: 'text', max: 300 },
    { key: 'state', label: 'State', type: 'text', max: 60, lookup: 'states' },
    { key: 'pinCode', label: 'PIN code', type: 'text', format: 'PIN', max: 6 },
    { key: 'bankAccount', label: 'Bank account number', type: 'text', format: 'BANK_ACCOUNT', sensitive: true, max: 18 },
    { key: 'ifsc', label: 'IFSC', type: 'text', format: 'IFSC', sensitive: true, max: 11 },
  ],
  fuzzy: { field: 'name', threshold: 85 },
  defaultRules: [
    { field: 'name', rule: 'REQUIRED', severity: 'ERROR' }, { field: 'kind', rule: 'REQUIRED', severity: 'ERROR' }, { field: 'pan', rule: 'REQUIRED', severity: 'WARNING' },
    { field: 'gstin', rule: 'REQUIRED', severity: 'INFO' }, { field: 'mobile', rule: 'REQUIRED', severity: 'WARNING' }, { field: 'pinCode', rule: 'REQUIRED', severity: 'INFO' },
    { field: 'pan', rule: 'FORMAT', param: 'PAN', severity: 'ERROR' }, { field: 'gstin', rule: 'FORMAT', param: 'GSTIN', severity: 'ERROR' }, { field: 'ifsc', rule: 'FORMAT', param: 'IFSC', severity: 'ERROR' },
    { field: 'pinCode', rule: 'FORMAT', param: 'PIN', severity: 'ERROR' }, { field: 'mobile', rule: 'FORMAT', param: 'MOBILE', severity: 'ERROR' }, { field: 'email', rule: 'FORMAT', param: 'EMAIL', severity: 'WARNING' },
    { field: 'bankAccount', rule: 'FORMAT', param: 'BANK_ACCOUNT', severity: 'ERROR' }, { field: '*', rule: 'STALE', param: '365', severity: 'WARNING' },
  ],
  crossCheck(d, h = {}) {
    const out = [];
    const gst = d.gstin && d.state && h.stateGstCode ? h.stateGstCode(d.state) : null;
    if (gst && d.gstin.length === 15 && d.gstin.slice(0, 2) !== gst) out.push({ field: 'gstin', message: `The GSTIN starts with ${d.gstin.slice(0, 2)}, but ${d.state} has GST state code ${gst} (06.02).` });
    if (d.gstin && d.pan && d.gstin.length === 15 && d.gstin.slice(2, 12) !== d.pan) out.push({ field: 'gstin', message: 'The GSTIN does not contain this PAN (characters 3 to 12 of a GSTIN are the PAN).' });
    if (d.bankAccount && !d.ifsc) out.push({ field: 'ifsc', message: 'A bank account needs its IFSC.' });
    return out;
  },
});

// Who refers to a master record: tasks about it (04.08) and trace links (04.14). A merged record keeps them; the framework shows them under the record it was merged into (BR-01).
const has = (db, t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
masterReferences.register({
  code: 'tasks', label: 'Tasks',
  find(db, companyId, ids) {
    if (!ids.length || !has(db, 'tsk_tasks')) return [];
    return db.prepare(`SELECT id, task_no, title, entity_id FROM tsk_tasks WHERE company_id = ? AND entity = 'mdm_record' AND entity_id IN (${ids.map(() => '?').join(',')}) AND is_active = 1`).all(companyId, ...ids.map(String))
      .map((t) => ({ entity: 'tsk_task', id: t.id, label: `${t.task_no} ${t.title}`, route: `/work/tasks/${t.id}`, recordId: Number(t.entity_id) }));
  },
});
masterReferences.register({
  code: 'trace', label: 'Linked records',
  find(db, companyId, ids) {
    if (!ids.length || !has(db, 'col_trace_links')) return [];
    const q = ids.map(() => '?').join(',');
    return db.prepare(`SELECT from_entity, from_id, to_entity, to_id, relation FROM col_trace_links WHERE company_id = ? AND is_active = 1 AND ((to_entity = 'mdm_record' AND to_id IN (${q})) OR (from_entity = 'mdm_record' AND from_id IN (${q})))`).all(companyId, ...ids.map(String), ...ids.map(String))
      .map((l) => (l.to_entity === 'mdm_record' ? { entity: l.from_entity, id: l.from_id, label: `${l.from_entity} ${l.from_id} (${l.relation.toLowerCase()})`, route: null, recordId: Number(l.to_id) } : { entity: l.to_entity, id: l.to_id, label: `${l.to_entity} ${l.to_id} (${l.relation.toLowerCase()})`, route: null, recordId: Number(l.from_id) }));
  },
});

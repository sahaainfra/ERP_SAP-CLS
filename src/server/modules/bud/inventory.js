// F01-1 (D-799): material cost reaches the project budget from the inventory events, once.
//
// The rule (finance decision recorded in docs/erp/DECISIONS/F01-1-material-cost-recognition.md):
// - Material received into a store that belongs to a project (a site store) is that project's cost at the goods receipt. The receipt consumes the
//   purchase-order commitment line it was received against, so the same rupee is committed, then spent, never both.
// - A direct-charge line (a non-stock item charged to its WBS or cost code at receipt) is cost at the receipt, whatever the store.
// - Material received into a store that belongs to no project (a central warehouse) is not yet anyone's cost; it becomes the cost of the project it is
//   issued to, at the issue.
// - An issue from a project's own store changes nothing: that material was the project's cost when it was received.
// - A return to the vendor takes back what it returns from stock out of the receipt's cost, and gives the order its commitment back.
// - Material that comes back from site into a store that belongs to no project takes back the issue's cost (scrap does not: it was consumed).
//
// The events are the ones inventory publishes for every other consumer; nothing is added to them. An event that already carries the ledger contract
// (a sourceId) is left to the ledger's own handler. The bus delivers an event once per consumer, inside one transaction with the inbox.

export const INVENTORY_EVENTS = ['inv.grn.posted', 'inv.rtv.posted', 'inv.issue.posted', 'inv.site_return.posted'];

export function createInventoryActuals({ db, ledger }) {
  const system = (companyId) => ({ user: 'system', companyId, roles: ['SYSTEM'] });
  const storeOf = (id) => (id ? db.prepare('SELECT id, org_project_id FROM inv_stores WHERE id = ?').get(Number(id)) : null);
  const rupeesOf = (paise) => Number(paise ?? 0) / 100;
  const poLineNo = (poLineId) => (poLineId ? db.prepare('SELECT po_id, line_no FROM proc_po_lines WHERE id = ?').get(Number(poLineId)) : null);

  function receipt(actor, e, d) {
    const store = storeOf(d.storeId);
    const projectId = Number(e.projectId ?? store?.org_project_id ?? 0);
    if (!projectId) return null;
    const projectStore = Boolean(store?.org_project_id);
    const lines = (d.lines ?? []).filter((l) => Number(l.acceptedQty) > 0 && Number(l.value) > 0 && (projectStore || l.directCharge)).map((l) => {
      const po = poLineNo(l.poLineId);
      return {
        lineId: String(l.lineId), wbsId: l.wbsId ?? null, costCodeId: l.costCodeId ?? null, resourceType: 'MATERIAL', qty: Number(l.acceptedQty), amount: rupeesOf(l.value), description: `Goods receipt ${d.docNo}`,
        commitment: po ? { sourceType: 'proc_po', sourceId: String(po.po_id), lineId: String(po.line_no) } : null,
      };
    });
    if (!lines.length) return null;
    return ledger.actuals.post(actor, { projectId, sourceType: 'inv_grn', sourceId: String(d.grnId), docRef: d.docNo ?? null, date: d.receivedOn ?? null, lines });
  }

  function returnToVendor(actor, d) {
    const r = db.prepare('SELECT lines_json FROM inv_rtvs WHERE id = ?').get(Number(d.rtvId));
    const stored = (() => { try { return JSON.parse(r?.lines_json ?? '[]'); } catch { return []; } })();
    const out = [];
    for (const l of stored) {
      // only what left the accepted stock was ever cost; rejected material sent back was never accepted
      const fromStock = Number(l.fromStock ?? 0); if (fromStock <= 0) continue;
      const amount = Math.round((fromStock * Number(l.rate ?? 0)) / 1000);
      const res = ledger.actuals.reduce(actor, { sourceType: 'inv_grn', sourceId: String(d.grnId), lineId: String(l.grnLineId), amount: rupeesOf(amount), qty: fromStock / 1000, refType: 'inv_rtv', refId: String(d.rtvId), note: `Returned to vendor ${d.docNo}` });
      if (res) out.push(res);
    }
    return out;
  }

  function issue(actor, e, d) {
    const store = storeOf(d.storeId);
    const projectId = Number(d.projectId ?? e.projectId ?? 0);
    if (!projectId || store?.org_project_id) return null; // from a project's own store: costed at its receipt
    const lines = (d.lines ?? []).filter((l) => Number(l.value) > 0).map((l) => ({ lineId: String(l.lineId), wbsId: d.wbsId ?? null, costCodeId: d.costCodeId ?? null, resourceType: 'MATERIAL', qty: Number(l.qty ?? 0), amount: rupeesOf(l.value), description: `Material issue ${d.docNo}` }));
    if (!lines.length) return null;
    return ledger.actuals.post(actor, { projectId, sourceType: 'inv_issue', sourceId: String(d.issueId), docRef: d.docNo ?? null, date: d.issueDate ?? null, lines });
  }

  function siteReturn(actor, d) {
    if (d.backToStock === false) return []; // scrap: the material was consumed
    const store = storeOf(d.storeId);
    if (store?.org_project_id) return []; // back into a project's own store: still the project's material, costed at its receipt
    const out = [];
    for (const l of d.lines ?? []) {
      const res = ledger.actuals.reduce(actor, { sourceType: 'inv_issue', sourceId: String(d.issueId), lineId: String(l.issueLineId), amount: rupeesOf(l.value), qty: Number(l.qty ?? 0), refType: 'inv_site_return', refId: String(d.returnId), note: `Returned from site ${d.docNo}` });
      if (res) out.push(res);
    }
    return out;
  }

  return {
    onEvent(e) {
      const t = String(e.type ?? e.eventType ?? ''); const d = e.data ?? {};
      if (d.sourceId != null) return null; // already in the ledger's contract: the ledger's own handler takes it
      const companyId = Number(e.companyId ?? d.companyId); if (!companyId) return null;
      const actor = system(companyId);
      if (t === 'inv.grn.posted') return receipt(actor, e, d);
      if (t === 'inv.rtv.posted') return returnToVendor(actor, d);
      if (t === 'inv.issue.posted') return issue(actor, e, d);
      if (t === 'inv.site_return.posted') return siteReturn(actor, d);
      return null;
    },
  };
}

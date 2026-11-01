// Amendment comparison (part 03.04, FR-10): two versions of a record side by side, changed header fields and line fields marked, lines
// added or removed named. Pure, so the server can test it and the browser draw it. Lines are matched by their id, which an amendment keeps.
const same = (a, b) => (a ?? '') === (b ?? '');

/**
 * compareSnapshots(from, to, { header: [{ key, label }], line: [{ key, label }], lineKey = 'id' }) ->
 * { header: [{ key, label, from, to, changed }], lines: [{ status: 'same'|'changed'|'added'|'removed', no, key, fields: [{ key, label, from, to, changed }] }],
 *   summary: { headerChanged, linesAdded, linesRemoved, linesChanged } }
 */
export function compareSnapshots(from, to, { header, line, lineKey = 'id' }) {
  const headerRows = header.map((f) => ({ key: f.key, label: f.label, from: from.header?.[f.key] ?? '', to: to.header?.[f.key] ?? '', changed: !same(from.header?.[f.key], to.header?.[f.key]) }));
  const before = new Map((from.lines ?? []).map((l) => [l[lineKey], l]));
  const after = new Map((to.lines ?? []).map((l) => [l[lineKey], l]));
  const fieldsOf = (a, b) => line.map((f) => ({ key: f.key, label: f.label, from: a?.[f.key] ?? '', to: b?.[f.key] ?? '', changed: !same(a?.[f.key], b?.[f.key]) }));
  const rows = [];
  for (const [k, b] of after) {
    const a = before.get(k);
    if (!a) rows.push({ status: 'added', no: b.lineNo, key: k, fields: fieldsOf(null, b).map((x) => ({ ...x, changed: true })) });
    else {
      const fields = fieldsOf(a, b);
      rows.push({ status: fields.some((x) => x.changed) ? 'changed' : 'same', no: b.lineNo, key: k, fields });
    }
  }
  for (const [k, a] of before) if (!after.has(k)) rows.push({ status: 'removed', no: a.lineNo, key: k, fields: fieldsOf(a, null).map((x) => ({ ...x, changed: true })) });
  rows.sort((x, y) => (x.no ?? 1e9) - (y.no ?? 1e9) || String(x.key).localeCompare(String(y.key)));
  return {
    header: headerRows,
    lines: rows,
    summary: {
      headerChanged: headerRows.filter((r) => r.changed).length,
      linesAdded: rows.filter((r) => r.status === 'added').length,
      linesRemoved: rows.filter((r) => r.status === 'removed').length,
      linesChanged: rows.filter((r) => r.status === 'changed').length,
    },
  };
}

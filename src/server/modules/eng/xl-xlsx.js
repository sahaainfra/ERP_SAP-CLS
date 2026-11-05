import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';
import readXlsxFile from 'read-excel-file/node';
import { inert } from '../../platform/export/index.js';

// Workbooks for the Excel engine (part 04.13): a writer of templates (a Data sheet with a protected header and unlocked cells, an Instructions sheet, a Lists sheet that the drop-down lists point at, and a hidden
// sheet that names the import type and version) and a reader that returns the cells and also finds what a spreadsheet would run as a formula.
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const colName = (i) => { let n = i + 1; let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
export const colIndex = (letters) => letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
// the invisible characters of a spreadsheet cell that XML cannot hold
// eslint-disable-next-line no-control-regex
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const cell = (ref, v, style = 0, { raw = false } = {}) => {
  if (v === null || v === undefined || v === '') return `<c r="${ref}"${style ? ` s="${style}"` : ''}/>`;
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${esc(clean(raw ? v : inert(v)))}</t></is></c>`;
};

// styles: 0 plain locked, 1 header (bold, grey), 2 data cell (unlocked, text), 3 required header (bold, amber), 4 wrapped text locked, 5 data cell unlocked with date format
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\-mmm\\-yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE699"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" applyNumberFormat="1" applyProtection="1"><protection locked="0"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1" applyProtection="1"><protection locked="0"/></xf></cellXfs></styleSheet>`;

/**
 * @param {{ importType: string, version: number, title: string, columns: { key: string, label: string, required?: boolean, type: string, help?: string, width?: number, list?: string[] | null, min?: number | null, max?: number | null }[], instructions: string[], rows?: any[][], maxRows?: number, rowsRaw?: boolean }} t
 * Returns the bytes of the workbook. Text that a spreadsheet would run as a formula is made inert (FR-05), unless `rowsRaw` (a test that builds the file a person would upload).
 */
export function templateWorkbook(t) {
  const maxRows = t.maxRows ?? 5000;
  const lists = t.columns.map((c, i) => ({ c, i })).filter((x) => x.c.list?.length);
  const header = t.columns.map((c, i) => cell(`${colName(i)}1`, `${c.label}${c.required ? ' *' : ''}`, c.required ? 3 : 1, { raw: true })).join('');
  const body = (t.rows ?? []).map((r, j) => `<row r="${j + 2}">${t.columns.map((c, i) => cell(`${colName(i)}${j + 2}`, r[i], c.type === 'date' ? 5 : 2, { raw: t.rowsRaw === true })).join('')}</row>`).join('');
  const cols = t.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(50, Math.max(14, c.width ?? c.label.length + 4))}" style="${c.type === 'date' ? 5 : 2}" customWidth="1"/>`).join('');
  const validations = t.columns.map((c, i) => {
    const sq = `${colName(i)}2:${colName(i)}${maxRows + 1}`;
    const L = lists.find((x) => x.i === i);
    if (L) return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Not in the list" error="Choose one of the values of the list." sqref="${sq}"><formula1>Lists!$${colName(lists.indexOf(L))}$2:$${colName(lists.indexOf(L))}$${L.c.list.length + 1}</formula1></dataValidation>`;
    if (c.type === 'int') return `<dataValidation type="whole" operator="between" allowBlank="1" showErrorMessage="1" error="Write a whole number." sqref="${sq}"><formula1>${c.min ?? -1_000_000_000}</formula1><formula2>${c.max ?? 1_000_000_000}</formula2></dataValidation>`;
    if (c.type === 'decimal' || c.type === 'money') return `<dataValidation type="decimal" operator="greaterThanOrEqual" allowBlank="1" showErrorMessage="1" error="Write a number." sqref="${sq}"><formula1>${c.min ?? -1_000_000_000_000}</formula1></dataValidation>`;
    return null;
  }).filter(Boolean);
  const data = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData><row r="1">${header}</row>${body}</sheetData><sheetProtection sheet="1" objects="1" scenarios="1" formatColumns="0" formatRows="0" sort="0" autoFilter="0"/>${validations.length ? `<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>` : ''}</worksheet>`;
  const instr = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="14" customWidth="1"/><col min="3" max="3" width="90" customWidth="1"/></cols><sheetData>${[
    `<row r="1">${cell('A1', t.title, 1, { raw: true })}${cell('B1', `Template version ${t.version}`, 1, { raw: true })}${cell('C1', '', 1)}</row>`,
    ...t.instructions.map((line, j) => `<row r="${j + 2}">${cell(`A${j + 2}`, line, 4, { raw: true })}</row>`),
    `<row r="${t.instructions.length + 3}">${cell(`A${t.instructions.length + 3}`, 'Column', 1, { raw: true })}${cell(`B${t.instructions.length + 3}`, 'Kind', 1, { raw: true })}${cell(`C${t.instructions.length + 3}`, 'What to write', 1, { raw: true })}</row>`,
    ...t.columns.map((c, j) => { const r = t.instructions.length + 4 + j; return `<row r="${r}">${cell(`A${r}`, `${c.label}${c.required ? ' *' : ''}`, 0, { raw: true })}${cell(`B${r}`, c.type, 0, { raw: true })}${cell(`C${r}`, c.help ?? '', 4, { raw: true })}</row>`; }),
  ].join('')}</sheetData><sheetProtection sheet="1" objects="1" scenarios="1"/></worksheet>`;
  const longest = Math.max(1, ...lists.map((x) => x.c.list.length));
  const listRows = Array.from({ length: longest + 1 }, (_, r) => `<row r="${r + 1}">${lists.map((x, k) => (r === 0 ? cell(`${colName(k)}1`, x.c.label, 1, { raw: true }) : cell(`${colName(k)}${r + 1}`, x.c.list[r - 1], 0))).join('')}</row>`).join('');
  const listSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${listRows}</sheetData><sheetProtection sheet="1" objects="1" scenarios="1"/></worksheet>`;
  const meta = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cell('A1', 'importType', 0, { raw: true })}${cell('B1', t.importType, 0, { raw: true })}</row><row r="2">${cell('A2', 'version', 0, { raw: true })}${cell('B2', t.version, 0)}</row><row r="3">${cell('A3', 'columns', 0, { raw: true })}${cell('B3', t.columns.map((c) => c.key).join(','), 0, { raw: true })}</row></sheetData><sheetProtection sheet="1" objects="1" scenarios="1"/></worksheet>`;
  const sheets = [['Data', data], ['Instructions', instr], ...(lists.length ? [['Lists', listSheet]] : []), ['__xl', meta]];
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files = {
    '[Content_Types].xml': `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${X}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([n], i) => `<sheet name="${n}" sheetId="${i + 1}"${n === '__xl' ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': STYLES,
  };
  sheets.forEach(([, xml], i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = xml; });
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 }));
}

/** A plain one-sheet workbook of rows (the error file and exports of an import type): header row, then the values, formulas made inert. */
export function tableWorkbook({ name = 'Data', columns, rows }) {
  const head = columns.map((c, i) => cell(`${colName(i)}1`, c.label, 1, { raw: true })).join('');
  const body = rows.map((r, j) => `<row r="${j + 2}">${columns.map((c, i) => cell(`${colName(i)}${j + 2}`, r[c.key], 0)).join('')}</row>`).join('');
  const widths = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(12, c.label.length + 2))}" customWidth="1"/>`).join('');
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files = {
    '[Content_Types].xml': `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels': `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${X}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': `${X}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData><row r="1">${head}</row>${body}</sheetData></worksheet>`,
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 }));
}

/**
 * Read a workbook: { sheets: [{ name, rows: any[][] }], formulas: [{ sheet, row, col }], meta: { importType, version, columns } | null }.
 * Throws a plain Error('NOT_XLSX') when the bytes are not a workbook. `formulas` are the cells that hold a formula (a cell a spreadsheet would run).
 */
export async function readWorkbook(buffer) {
  let zip;
  try { zip = unzipSync(new Uint8Array(buffer)); } catch { throw new Error('NOT_XLSX'); }
  if (!zip['xl/workbook.xml']) throw new Error('NOT_XLSX');
  let parsed;
  try { parsed = await readXlsxFile(buffer); } catch { throw new Error('NOT_XLSX'); }
  const sheets = parsed.map((s) => ({ name: s.sheet, rows: s.data }));
  const wb = strFromU8(zip['xl/workbook.xml']);
  const rels = zip['xl/_rels/workbook.xml.rels'] ? strFromU8(zip['xl/_rels/workbook.xml.rels']) : '';
  const targets = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  const formulas = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(m[0])?.[1];
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
    const target = targets[rid];
    const file = target ? zip[`xl/${target.replace(/^\/?(xl\/)?/, '')}`] : null;
    if (!file) continue;
    for (const c of strFromU8(file).matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"[^>]*>\s*<f[\s>/]/g)) formulas.push({ sheet: name?.replace(/&amp;/g, '&'), row: Number(c[2]), col: colIndex(c[1]) });
  }
  const metaSheet = sheets.find((s) => s.name === '__xl');
  const meta = metaSheet ? Object.fromEntries(metaSheet.rows.map((r) => [String(r[0]), r[1]])) : null;
  return { sheets, formulas, meta: meta ? { importType: String(meta.importType ?? ''), version: Number(meta.version ?? 0), columns: String(meta.columns ?? '').split(',').filter(Boolean) } : null, entries: zip };
}

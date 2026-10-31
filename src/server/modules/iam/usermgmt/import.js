import { badRequest } from '../../../platform/http/errors.js';
import { LANGUAGES, MAX_IMPORT_ROWS, USER_TYPES, normaliseEmail, normaliseMobile } from './validators.js';

/** The columns of an import file (header names are matched without case, spaces or underscores). */
export const IMPORT_COLUMNS = ['username', 'displayName', 'email', 'mobile', 'language', 'userType', 'employeeCode', 'department', 'project'];
const ALIASES = {
  username: 'username', displayname: 'displayName', name: 'displayName', fullname: 'displayName', email: 'email', mobile: 'mobile', phone: 'mobile', language: 'language', usertype: 'userType', type: 'userType',
  employeecode: 'employeeCode', employee: 'employeeCode', employeeid: 'employeeCode', department: 'department', departmentcode: 'department', project: 'project', projectcode: 'project',
};
export const IMPORT_TEMPLATE = `${IMPORT_COLUMNS.join(',')}\nanil.kumar,Anil Kumar,anil.kumar@example.com,9876543210,en,INTERNAL,E-1001,ENG,\n`;

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF or LF, an optional byte-order mark. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (quoted) throw badRequest('The file is not valid CSV: a quoted value is never closed.');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Read and check an import file row by row. Nothing here touches the database: duplicates and organisation codes are checked by the service. */
export function parseImportCsv(text) {
  if (typeof text !== 'string' || !text.trim()) throw badRequest('The file is empty. Send CSV text with a header row.');
  const records = parseCsv(text);
  const raw = records.shift() ?? [];
  const header = raw.map((h) => ALIASES[String(h).trim().toLowerCase().replace(/[\s_-]/g, '')] ?? null);
  const unknown = raw.filter((h, i) => !header[i] && String(h).trim()).map((h) => String(h).trim());
  if (unknown.length) throw badRequest(`Unknown column(s): ${unknown.join(', ')}. Use ${IMPORT_COLUMNS.join(', ')}.`);
  if (!header.includes('displayName')) throw badRequest('The header row needs a displayName (or name) column.');
  if (!header.includes('email') && !header.includes('mobile')) throw badRequest('The header row needs an email or a mobile column.');
  const dataRows = records.map((r, i) => ({ r, row: i + 2 })).filter(({ r }) => r.some((c) => String(c).trim() !== ''));
  if (dataRows.length === 0) throw badRequest('The file has a header but no people.');
  if (dataRows.length > MAX_IMPORT_ROWS) throw badRequest(`The file has ${dataRows.length} rows; import at most ${MAX_IMPORT_ROWS} at a time.`);

  const rows = dataRows.map(({ r, row }) => {
    const cell = {};
    header.forEach((name, i) => { if (name) cell[name] = String(r[i] ?? '').trim(); });
    const errors = [];
    const fail = (field, message) => errors.push({ field, message });
    const values = { username: null, displayName: cell.displayName ?? '', email: null, mobile: null, language: 'en', userType: 'INTERNAL', employeeCode: null };
    if (!values.displayName) fail('displayName', 'The name is required.');
    else if (values.displayName.length > 120) fail('displayName', 'Use at most 120 characters.');
    if (cell.username) {
      const u = cell.username.toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{2,59}$/.test(u)) fail('username', 'Use 3 to 60 letters, digits, dot, dash or underscore, starting with a letter or digit.');
      else values.username = u;
    }
    if (cell.email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cell.email) || cell.email.length > 200) fail('email', 'Not a valid email address.');
      else values.email = normaliseEmail(cell.email);
    }
    if (cell.mobile) {
      const m = normaliseMobile(cell.mobile);
      if (m === undefined) fail('mobile', 'Not a valid mobile number (10 digits, or with a country code).');
      else values.mobile = m;
    }
    if (!values.email && !values.mobile && !errors.some((e) => e.field === 'email' || e.field === 'mobile')) fail('email', 'Give an email address or a mobile number.');
    if (cell.language) {
      const l = cell.language.toLowerCase();
      if (!LANGUAGES.includes(l)) fail('language', `Use ${LANGUAGES.join(' or ')}.`);
      else values.language = l;
    }
    if (cell.userType) {
      const t = cell.userType.toUpperCase().replace(/[\s-]/g, '_');
      if (!USER_TYPES.includes(t)) fail('userType', `Use one of ${USER_TYPES.join(', ')}.`);
      else values.userType = t;
    }
    if (cell.employeeCode) {
      if (cell.employeeCode.length > 40) fail('employeeCode', 'Use at most 40 characters.');
      else values.employeeCode = cell.employeeCode;
    }
    return { row, data: { values, department: cell.department || null, project: cell.project || null }, errors };
  });
  return { rows };
}

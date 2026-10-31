import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authHeaders } from '../../../platform/api/index.js';
import { toCsv } from '../../../platform/format.js';
import { downloadCsv } from '../../core/pages/ui.jsx';
import { importTemplateUrl, importUsers } from '../api/users.js';
import { queryKeys } from '../../../platform/query/keys.js';

/**
 * Bulk import of users from a CSV file (FR-04): choose or paste the file, check it (nothing is written), read the row-level problems,
 * then import. A file with any wrong row is refused whole unless "only the valid rows" is ticked. Excel files are added with the
 * Excel engine of part 04.13; until then save the sheet as CSV.
 */
export default function UserImport({ onClose, onDone }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [check, setCheck] = useState(null);
  const [skipInvalid, setSkip] = useState(false);
  const [invite, setInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const reset = () => { setCheck(null); setProblem(null); };
  const pick = async (file) => {
    if (!file) return;
    setFileName(file.name);
    setText(await file.text());
    reset();
  };
  const run = async (mode) => {
    setBusy(true);
    setProblem(null);
    try {
      const out = await importUsers(text, { mode, skipInvalid, invite });
      if (mode === 'validate') setCheck(out);
      else {
        await qc.invalidateQueries({ queryKey: queryKeys.iam.all });
        onDone(`Imported ${out.created} user(s) as Invited${invite ? `; ${out.invited} invitation(s) sent${out.inviteFailed.length ? `, ${out.inviteFailed.length} not sent` : ''}` : ''}${out.invalid ? `; ${out.invalid} row(s) skipped` : ''}.`);
        setText(''); setFileName(''); setCheck(null);
        onClose();
      }
    } catch (err) {
      setProblem({ message: err.message, details: err.details ?? [], correlationId: err.correlationId });
    } finally {
      setBusy(false);
    }
  };
  const template = async () => {
    const res = await fetch(importTemplateUrl, { headers: authHeaders() });
    downloadCsv('users-import-template.csv', await res.text());
  };
  const errorsCsv = () => downloadCsv('users-import-errors.csv', toCsv(['Row', 'Field', 'Problem'], check.errors.map((e) => [e.row, e.field, e.message])));

  return (
    <div>
      <h2 id="import-title">Import users from a file</h2>
      <p className="muted">One person per row, with a header row. Columns: username (optional), name, email, mobile, language (en or hi), type, employeeCode, department (code), project (code). Save an Excel sheet as CSV first.</p>
      <div className="actions">
        <button type="button" className="btn" onClick={template}>Download the template</button>
      </div>
      <label className="field"><span>CSV file</span><input type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files?.[0])} data-testid="import-file" /></label>
      <label className="field"><span>Or paste the rows{fileName ? ` (${fileName} loaded)` : ''}</span>
        <textarea rows="6" value={text} onChange={(e) => { setText(e.target.value); setFileName(''); reset(); }} data-testid="import-text" spellCheck="false" />
      </label>
      {problem && (
        <p className="field-error" role="alert" data-testid="import-problem">
          {problem.message}{problem.correlationId && <> (Correlation ID: <code>{problem.correlationId}</code>)</>}
        </p>
      )}
      {check && (
        <div data-testid="import-summary">
          <p role="status"><strong>{check.valid}</strong> of {check.total} rows are ready{check.invalid ? `; ${check.invalid} have problems` : ''}. Nothing has been imported yet.</p>
          {check.errors.length > 0 && (
            <>
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Problems found, by row</caption>
                  <thead><tr><th>Row</th><th>Field</th><th>Problem</th></tr></thead>
                  <tbody>{check.errors.map((e, i) => <tr key={i} data-testid="import-error"><td data-label="Row">{e.row}</td><td data-label="Field">{e.field}</td><td data-label="Problem">{e.message}</td></tr>)}</tbody>
                </table>
              </div>
              <button type="button" className="btn btn-small" onClick={errorsCsv}>Download the problems as CSV</button>
              <label className="field"><span><input type="checkbox" checked={skipInvalid} onChange={(e) => setSkip(e.target.checked)} /> Import only the valid rows</span></label>
            </>
          )}
          <label className="field"><span><input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} /> Send invitations after importing</span></label>
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>Close</button>
        <button type="button" className="btn" disabled={busy || !text.trim()} onClick={() => run('validate')}>{busy && !check ? 'Checking...' : 'Check the file'}</button>
        <button type="button" className="btn btn-primary" disabled={busy || !check || check.valid === 0 || (check.errors.length > 0 && !skipInvalid)} onClick={() => run('commit')}>{busy && check ? 'Importing...' : `Import ${check ? (skipInvalid ? check.valid : check.total) : ''} user(s)`}</button>
      </div>
    </div>
  );
}

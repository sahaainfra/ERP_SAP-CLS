import { useState } from 'react';
import { useT } from '../i18n/index.js';
import { idForSending, idProblem } from '../../../shared/forms/indian-ids.js';
import { TextField } from './fields.jsx';

const INPUT_MODE = { uan: 'numeric', esic: 'numeric', esicEmployer: 'numeric', pincode: 'numeric', mobile: 'tel' };
const MAX = { gstin: 20, pan: 14, tan: 14, ifsc: 15, uan: 16, esic: 14, esicEmployer: 22, aadhaar: 16, vehicle: 16, pincode: 8, mobile: 16 };

/**
 * An Indian identifier field (PACK-09): GSTIN, PAN, TAN, IFSC, UAN, ESIC, Aadhaar (last four digits), vehicle number, PIN code or
 * mobile number. Leaving the field tidies the value (capitals, no spaces, +91 dropped, a full Aadhaar number cut to its last four
 * digits) and checks it with the same rule the server uses (`src/shared/forms/indian-ids.js`); the problem is shown under the field
 * in the person's language. An error from the server (`error`) wins over the field's own check.
 */
export function IdField({ id, kind, label, value, onChange, onBlur, error, hint, required, disabled, readOnly }) {
  const t = useT('format');
  const [problem, setProblem] = useState(null);
  const leave = (e) => {
    const p = idProblem(kind, value, { client: true });
    setProblem(p);
    if (!p) { const tidy = idForSending(kind, value); if (tidy !== (value ?? '')) onChange(tidy); }
    onBlur?.(e);
  };
  const own = problem ? t(problem.key) : null;
  return (
    <TextField id={id} label={label ?? t(`id.${kind}.label`)} value={value} onChange={(v) => { if (problem) setProblem(null); onChange(v); }} onBlur={leave}
      error={error || own || undefined} hint={hint ?? t(`id.${kind}.hint`)} required={required} disabled={disabled} readOnly={readOnly}
      maxLength={MAX[kind]} inputMode={INPUT_MODE[kind]} autoComplete="off" />
  );
}

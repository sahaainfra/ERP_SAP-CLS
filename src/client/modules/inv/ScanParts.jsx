import { useState } from 'react';
import { ro } from './api.js';
import { errorInfo } from '../core/pages/ui.jsx';

// The scan field of the store screens (part 16.07, FR-05): a handheld scanner types the code and presses Enter; so does a person. The server says what the label is (item, bin or batch).
export function ScanInput({ t, onResult, testId = 'scan-input' }) {
  const [code, setCode] = useState(''); const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const go = async () => { const c = code.trim(); if (!c) return; setBusy(true); setMsg(null); try { const r = await ro.scan(c); setCode(''); setMsg({ ok: true, text: `${r.type === 'BIN' ? r.bin : r.code}${r.batchNo ? ` · ${r.batchNo}` : ''}` }); onResult(r); } catch (e) { setMsg({ ok: false, text: errorInfo(e).form ?? t('sc.notFound') }); } finally { setBusy(false); } };
  return (
    <div className="mdm-panel no-print" data-testid={`${testId}-panel`}><label>{t('sc.label')}<input value={code} onChange={(ev) => setCode(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } }} inputMode="search" autoComplete="off" disabled={busy} style={{ minHeight: 'var(--erp-target-large)' }} data-testid={testId} /></label>
      {msg && <p className={msg.ok ? 'muted' : 'field-error'} role={msg.ok ? 'status' : 'alert'} data-testid={`${testId}-msg`}>{msg.ok ? t('sc.found', { what: msg.text }) : msg.text}</p>}</div>
  );
}

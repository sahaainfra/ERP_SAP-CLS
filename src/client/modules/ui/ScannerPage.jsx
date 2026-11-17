import { useState } from 'react';
import CodeScanner from '../../platform/device/CodeScanner.jsx';
import { resolveCode } from '../../platform/device/api.js';
import { vibrate } from '../../platform/device/haptics.js';
import { confirmLeave } from '../../platform/forms/guard.js';
import Icon from '../../platform/design/Icon.jsx';
import { useT } from '../../platform/i18n/index.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

const RECENT_KEY = 'erp.scan.recent';
const readRecent = () => {
  try { return JSON.parse(sessionStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
};
const open = (to) => {
  if (!confirmLeave()) return;
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

/** Scanner (Mobile): scan or type a code and be taken to the record it names (item, asset, GRN, employee badge as their parts register them). */
export default function ScannerPage() {
  const t = useT('field');
  const [state, setState] = useState({ busy: false, result: null, error: null, code: '' });
  const [recent, setRecent] = useState(readRecent);

  const remember = (entry) => {
    const next = [entry, ...readRecent().filter((r) => r.route !== entry.route)].slice(0, 8);
    try { sessionStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* the list lasts for this page view */ }
    setRecent(next);
  };

  const onCode = async (code) => {
    setState({ busy: true, result: null, error: null, code });
    try {
      const found = await resolveCode(code);
      if (found.status === 'found') {
        vibrate('success');
        remember({ title: found.title, label: found.label, route: found.route });
        setState({ busy: false, result: found, error: null, code });
        open(found.route);
      } else {
        vibrate('warning');
        setState({ busy: false, result: found, error: null, code });
      }
    } catch (err) {
      vibrate('error');
      setState({ busy: false, result: null, error: err, code });
    }
  };

  const { busy, result, error, code } = state;
  return (
    <section aria-labelledby="page-title" className="scanner">
      <PageHeader id="page-title" title={t('scan.title')} subtitle={t('scan.intro')} />
      <CodeScanner onCode={onCode} busy={busy} />
      {busy && <p role="status" data-testid="scan-busy">{t('scan.busy', { code })}</p>}
      {error && (
        <div className="state state-error" role="alert" data-testid="scan-error">
          <h2>{t('scan.errorTitle', { code })}</h2>
          <p>{error.message}</p>
          {error.correlationId && <p className="muted small">{t('scan.correlation', { id: '' })}<code>{error.correlationId}</code></p>}
        </div>
      )}
      {result?.status === 'found' && <p role="status" data-testid="scan-found"><Icon name="erp.state.approved" size={16} /> {t('scan.found', { title: result.title, label: result.label })}</p>}
      {result?.status === 'ambiguous' && (
        <div role="group" aria-label={t('scan.ambiguous')} data-testid="scan-ambiguous">
          <h2>{t('scan.ambiguous')}</h2>
          <ul className="lp-list">{result.matches.map((m) => <li key={`${m.type}-${m.id}`}><button type="button" className="btn btn-large" onClick={() => { remember({ title: m.title, label: m.label, route: m.route }); open(m.route); }}>{m.title} <span className="muted small">{m.label}</span></button></li>)}</ul>
        </div>
      )}
      <h2>{t('scan.recent')}</h2>
      {recent.length === 0 ? <p className="muted" data-testid="no-scans">{t('scan.none')}</p> : (
        <ul className="lp-list" aria-label={t('scan.recentAria')}>
          {recent.map((r) => <li key={r.route}><button type="button" className="btn" onClick={() => open(r.route)}>{r.title}</button> <span className="muted small">{r.label}</span></li>)}
        </ul>
      )}
    </section>
  );
}

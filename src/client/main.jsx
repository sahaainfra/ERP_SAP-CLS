import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
// Fonts are served by the application itself (part 03.01, FR-04): IBM Plex Sans, Plex Sans Devanagari for Hindi, Plex Mono for codes.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans-devanagari/400.css';
import '@fontsource/ibm-plex-sans-devanagari/600.css';
import '@fontsource/noto-sans-telugu/telugu-400.css'; // Telugu (part 166.3): the Telugu letters only, fetched when a Telugu letter is drawn
import '@fontsource/noto-sans-telugu/telugu-600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './design-tokens.css';
import './styles.css';
import './ui-v3.css'; // the UI v3 page patterns (part 166.2)
import './field-v3.css'; // the mobile site app (part 166.3)
import './modules/core/index.js'; // each module registers its pages with the shell
import './modules/iam/index.js';
import './modules/ui/index.js';
import './modules/eng/index.js';
import './modules/msg/index.js';
import './modules/pol/index.js';
import './modules/mdm/index.js';
import './modules/hr/index.js';
import './modules/bd/index.js';
import './modules/est/index.js';
import './modules/proj/index.js';
import './modules/engg/index.js';
import './modules/bud/index.js';
import './modules/plan/index.js';
import './modules/site/index.js';
import './modules/proc/index.js';
import './modules/inv/index.js';
import './modules/plant/index.js';
import './modules/qa/index.js';
import './modules/hse/index.js';
import './modules/rmc/index.js';
import './modules/ctr/index.js';
import './modules/bill/index.js';
import './modules/fin/index.js';
import './modules/pay/index.js';
import './modules/portal/index.js';
import './modules/bi/index.js';
import './modules/ai/index.js';
import { initAuth, signedInUser } from './platform/api/index.js';
import { loadLanguage } from './platform/i18n/index.js';
import { findRoute } from './platform/shell/registry.js';
import { storedAppearance } from './platform/design/appearance.js';
import { installPrintLogging } from './platform/audit/index.js';
import { createQueryClient } from './platform/query/client.js';
import { primeShellFlags } from './platform/shell/api.js';
import App from './App.jsx';

// Find out how people sign in, and resume a session from the cookie, before the first screen is drawn.
// the address the person opened, before the shell replaces '/' with its first page: a saved start page applies only then
window.__erpBooted = true; // every script of the shell arrived: public/boot-guard.js leaves the page alone (part 166.4)
window.__erpOpenedAt = window.location.pathname;
if (['/portal', '/portal/'].includes(window.location.pathname)) {
  const invitationToken = new URLSearchParams(window.location.hash.slice(1)).get('invite');
  if (invitationToken) window.history.replaceState(null, '', window.location.pathname);
  const root = createRoot(document.getElementById('root'));
  void import('./modules/portal/Portal.jsx').then(({ default: Portal }) => {
    window.__erpBooted = true;
    root.render(<StrictMode><Portal invitationToken={invitationToken} /></StrictMode>);
  }).catch(() => {
    root.render(<main role="alert">The partner portal could not load. Refresh the page to try again.</main>);
  });
} else {
  // the code of the page being opened is fetched with the sign-in check, not after the menu has arrived (part 166.4); '/' lands on Home or the field home
  for (const path of window.location.pathname === '/' ? ['/home', '/field'] : [window.location.pathname]) findRoute(path)?.Page?.preload?.().catch(() => null);
  // the saved language's text arrives with the sign-in check (Hindi and Telugu are fetched only for those who use them, part 166.4)
  const [{ mode }] = await Promise.all([initAuth(), loadLanguage(storedAppearance().language)]);
  installPrintLogging();
  const queryClient = createQueryClient();
  if (mode !== 'iam' || signedInUser()) primeShellFlags(queryClient); // the shell's flags in one request, once someone is signed in (part 166.4)

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App authMode={mode} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

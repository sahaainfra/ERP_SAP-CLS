import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
// Fonts are served by the application itself (part 03.01, FR-04): IBM Plex Sans, Plex Sans Devanagari for Hindi, Plex Mono for codes.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans-devanagari/400.css';
import '@fontsource/ibm-plex-sans-devanagari/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './design-tokens.css';
import './styles.css';
import './modules/core/index.js'; // each module registers its pages with the shell
import './modules/iam/index.js';
import './modules/ui/index.js';
import './modules/eng/index.js';
import './modules/msg/index.js';
import './modules/pol/index.js';
import { initAuth } from './platform/api/index.js';
import { installPrintLogging } from './platform/audit/index.js';
import { createQueryClient } from './platform/query/client.js';
import App from './App.jsx';

// Find out how people sign in, and resume a session from the cookie, before the first screen is drawn.
// the address the person opened, before the shell replaces '/' with its first page: a saved start page applies only then
window.__erpOpenedAt = window.location.pathname;
const { mode } = await initAuth();
installPrintLogging();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <App authMode={mode} />
    </QueryClientProvider>
  </StrictMode>,
);

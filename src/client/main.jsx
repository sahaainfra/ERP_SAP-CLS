import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import './design-tokens.css';
import './styles.css';
import './modules/core/index.js'; // each module registers its pages with the shell
import './modules/iam/index.js';
import { initAuth } from './platform/api/index.js';
import { installPrintLogging } from './platform/audit/index.js';
import { createQueryClient } from './platform/query/client.js';
import App from './App.jsx';

// Find out how people sign in, and resume a session from the cookie, before the first screen is drawn.
const { mode } = await initAuth();
installPrintLogging();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <App authMode={mode} />
    </QueryClientProvider>
  </StrictMode>,
);

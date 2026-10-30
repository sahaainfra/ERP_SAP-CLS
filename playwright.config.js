import { defineConfig } from '@playwright/test';

const PORT = 3100;

// Uses the Chrome installed on the machine (no browser download). Set PW_CHANNEL=msedge for Edge.
const channel = process.env.PW_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, channel, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 360, height: 740 }, hasTouch: true } },
  ],
  webServer: {
    // Serves the built client (npm run build) and the API on a throw-away database.
    command: 'node scripts/e2e_server.mjs',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    env: { NODE_ENV: 'test', PORT: String(PORT), DATABASE_PATH: 'data/e2e.sqlite', AUTH_MODE: 'dev-headers' },
    timeout: 30_000,
  },
});

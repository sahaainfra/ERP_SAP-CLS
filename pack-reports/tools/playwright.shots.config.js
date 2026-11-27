// PACK-02: runs pack-reports/tools/top50-shots.spec.js against the same throw-away servers as the E2E suite (playwright.local.config.js).
// Run from the repository root; the servers start there too (their commands are relative to it).
import { fileURLToPath } from 'node:url';
import base from '../../playwright.local.config.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
export default { ...base, testDir: '.', testMatch: 'top50-shots.spec.js', projects: [{ name: 'shots', use: {} }], webServer: base.webServer.map((w) => ({ ...w, cwd: root })) };

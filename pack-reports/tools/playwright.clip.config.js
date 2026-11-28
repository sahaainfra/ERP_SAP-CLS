// PACK-06: runs pack-reports/tools/clip320.spec.js against the E2E throw-away servers (as playwright.shots.config.js does).
import { fileURLToPath } from 'node:url';
import base from '../../playwright.local.config.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
export default { ...base, testDir: '.', testMatch: 'clip320.spec.js', projects: [{ name: 'clip', use: {} }], webServer: base.webServer.map((w) => ({ ...w, cwd: root })) };

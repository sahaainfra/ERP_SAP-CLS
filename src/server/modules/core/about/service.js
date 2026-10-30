import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../../platform/db/index.js';
import { assertPermission } from '../../../platform/auth/index.js';

/**
 * Build information. A packaged release carries `build-info.json` at its root (written by
 * scripts/package.mjs); a local run reports buildId "dev" with the version from package.json.
 */
export function loadBuildInfo(root = ROOT) {
  const file = join(root, 'build-info.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  let commit = process.env.GIT_COMMIT ?? 'unknown';
  if (commit === 'unknown') {
    try {
      commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      /* not a git checkout */
    }
  }
  return { version: pkg.version, buildId: 'dev', commit, builtAt: null };
}

export function createAboutService({ db, config, buildInfo }) {
  return {
    about(actor) {
      assertPermission(actor, 'core.about.view');
      const migrations = db.prepare('SELECT id, applied_at AS appliedAt FROM core_schema_migrations ORDER BY id').all();
      return {
        version: buildInfo.version,
        buildId: buildInfo.buildId,
        commit: buildInfo.commit,
        builtAt: buildInfo.builtAt ?? null,
        deployedAt: process.env.ERP_DEPLOYED_AT ?? null,
        environment: config.environment,
        node: process.version,
        migrations,
      };
    },
  };
}

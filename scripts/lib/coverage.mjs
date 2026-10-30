import { execFileSync } from 'node:child_process';

/** Parse lcov text into { file: { found, hit } } using line coverage (DA records). */
export function parseLcov(text) {
  const files = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      current = line.slice(3).replace(/\\/g, '/');
      files[current] = { found: 0, hit: 0 };
    } else if (line.startsWith('DA:') && current) {
      const hits = Number(line.slice(3).split(',')[1]);
      files[current].found += 1;
      if (hits > 0) files[current].hit += 1;
    } else if (line === 'end_of_record') {
      current = null;
    }
  }
  return files;
}

/**
 * Gate coverage of the changed files (FR-02). Only files that appear in the coverage data and match
 * `include` are judged; a changed file with no coverage data counts as 0 %. Returns { failures, checked }.
 */
export function gateCoverage({ lcov, changed, minPercent, include = (f) => /^(src\/server|scripts\/lib)\//.test(f) && /\.m?js$/.test(f) && f !== 'src/server/index.js' }) {
  const cov = parseLcov(lcov);
  const byRelative = new Map();
  for (const [abs, v] of Object.entries(cov)) {
    const i = abs.search(/(src\/server|scripts\/lib)\//);
    if (i >= 0) byRelative.set(abs.slice(i), v);
  }
  const checked = [];
  const failures = [];
  for (const f of changed.map((x) => x.replace(/\\/g, '/')).filter(include)) {
    const v = byRelative.get(f);
    const percent = v && v.found ? (100 * v.hit) / v.found : 0;
    checked.push({ file: f, percent: Math.round(percent * 10) / 10 });
    if (percent < minPercent) failures.push({ file: f, percent: Math.round(percent * 10) / 10, minPercent });
  }
  return { failures, checked };
}

/** Files changed against a base ref; null when the ref does not exist (caller falls back to all files). */
export function changedFiles(root, base) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .map((l) => l.slice(3).trim())
      .filter(Boolean);
    return [...new Set([...out.split('\n').filter(Boolean), ...dirty])];
  } catch {
    return null;
  }
}

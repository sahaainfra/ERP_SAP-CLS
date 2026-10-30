import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../../src/server/db.js';

export function bumpVersion(version, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`Not a plain semantic version: ${version}`);
  const [maj, min, pat] = m.slice(1).map(Number);
  if (kind === 'major') return `${maj + 1}.0.0`;
  if (kind === 'minor') return `${maj}.${min + 1}.0`;
  if (kind === 'patch') return `${maj}.${min}.${pat + 1}`;
  throw new Error(`Unknown bump "${kind}": use patch, minor or major.`);
}

const RS = '\x1e';
const US = '\x1f';
export const GIT_LOG_FORMAT = `%H${US}%s${US}%b${RS}`;

/**
 * Parse `git log --format=GIT_LOG_FORMAT` output. Subjects look like "P00.03: summary (module prog)".
 * A body line "Release-note: <business language>" becomes the user-facing text of that change.
 */
export function parseCommits(raw) {
  return raw
    .split(RS)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [hash, subject, body = ''] = c.split(US);
      const part = /^P(\d+\.\d+):\s*(.+?)(?:\s+\(module\s+\w+\))?$/.exec(subject);
      const note = /^Release-note:\s*(.+)$/m.exec(body);
      return { hash: hash.slice(0, 7), subject, part: part?.[1] ?? null, summary: part?.[2] ?? subject, userNote: note?.[1].trim() ?? null };
    });
}

export function renderChangelog({ version, date, commits }) {
  const lines = [`## ${version} - ${date}`, ''];
  for (const c of commits) lines.push(`- ${c.part ? `**${c.part}** ` : ''}${c.summary} (${c.hash})`);
  return `${lines.join('\n')}\n`;
}

/** Feature flags and their defaults, read from the reference-seed migrations. */
export function flagList(migrationsDir) {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, migrationsDir);
  const rows = db
    .prepare(
      `SELECT key, description, MAX(CASE WHEN environment IS NULL AND company_id IS NULL THEN default_enabled END) AS def,
              GROUP_CONCAT(CASE WHEN environment IS NOT NULL THEN environment || '=' || CASE enabled WHEN 1 THEN 'ON' ELSE 'OFF' END END, ', ') AS envs
       FROM core_feature_flags WHERE source_type = 'reference_seed' GROUP BY key ORDER BY key`,
    )
    .all();
  db.close();
  return rows.map((r) => ({ key: r.key, description: r.description, defaultOn: r.def === 1, environments: r.envs ?? '' }));
}

export function renderReleaseNotes({ version, date, commits, flags }) {
  const userChanges = commits.filter((c) => c.userNote);
  const lines = [`# Release ${version} (${date})`, '', '## What changed for users', ''];
  lines.push(...(userChanges.length ? userChanges.map((c) => `- ${c.userNote}`) : ['- No user-visible changes in this release.']));
  lines.push('', '## Technical changes', '', ...commits.map((c) => `- ${c.part ? `${c.part}: ` : ''}${c.summary}`));
  lines.push('', '## Feature flags in this release', '', '| Flag | Meaning | Default | Environments |', '|---|---|---|---|');
  lines.push(...flags.map((f) => `| ${f.key} | ${f.description} | ${f.defaultOn ? 'ON' : 'OFF'} | ${f.environments || '-'} |`));
  return `${lines.join('\n')}\n`;
}

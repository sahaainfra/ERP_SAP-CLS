import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Patterns for credentials that must never be committed (FR-01 secret scan, AC-02).
export const PATTERNS = [
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    id: 'credential-assignment',
    re: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*['"][^'"\s$]{8,}['"]/i,
  },
];

const ALLOW_MARKER = 'secret-scan:allow';
const SKIP_FILES = new Set(['package-lock.json']);
const SKIP_EXT = /\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip|gz|sqlite)$/i;

/** Scan text; returns [{ line, id }]. A line containing `secret-scan:allow` is skipped. */
export function scanText(text) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const p of PATTERNS) if (p.re.test(line)) hits.push({ line: i + 1, id: p.id });
  });
  return hits;
}

/** Tracked and untracked-but-not-ignored files, so a secret is caught before it is committed. */
export function candidateFiles(root) {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  return out.split('\0').filter((f) => f && !SKIP_FILES.has(f) && !SKIP_EXT.test(f));
}

export function scanRepository(root, files = candidateFiles(root)) {
  const findings = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(join(root, f), 'utf8');
    } catch {
      continue;
    }
    for (const h of scanText(text)) findings.push({ file: f.replace(/\\/g, '/'), ...h });
  }
  return findings;
}

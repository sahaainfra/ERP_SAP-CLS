import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupDifferences, verifiedBackup } from '../scripts/lib/bluegreen.mjs';

// Audit AUD-DEF-015: the restore point of a blue-green deploy is checked while the live server keeps writing.

test('BR-AUD-015 a table written during the copy may hold any count between its two counts; a quiet table must match exactly', () => {
  const before = { core_outbox: 10, core_jobs: 5, fin_journals: 100 };
  const after = { core_outbox: 14, core_jobs: 5, fin_journals: 100 };
  assert.deepEqual(backupDifferences(before, after, { core_outbox: 12, core_jobs: 5, fin_journals: 100 }), [], 'the outbox grew while copying');
  assert.deepEqual(backupDifferences(before, after, { core_outbox: 14, core_jobs: 5, fin_journals: 99 }), ['fin_journals'], 'a lost row of a quiet table');
  assert.deepEqual(backupDifferences(before, after, { core_outbox: 9, core_jobs: 5, fin_journals: 100 }), ['core_outbox'], 'fewer rows than before the copy');
  assert.deepEqual(backupDifferences(before, after, { core_outbox: 15, core_jobs: 5, fin_journals: 100 }), ['core_outbox'], 'more rows than after the copy');
});

test('BR-AUD-015 a real copy of a database passes, with the tables and the rows it holds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bg-backup-'));
  try {
    const db = new DatabaseSync(join(dir, 'live.sqlite'));
    db.exec('PRAGMA journal_mode = WAL; CREATE TABLE a (id INTEGER PRIMARY KEY, v TEXT); CREATE TABLE b (id INTEGER PRIMARY KEY);');
    for (let i = 0; i < 50; i += 1) db.prepare('INSERT INTO a (v) VALUES (?)').run(`row ${i}`);
    db.close();
    const r = verifiedBackup(join(dir, 'live.sqlite'), join(dir, 'copy.sqlite'));
    assert.equal(r.tables, 2);
    assert.deepEqual(r.writtenDuringCopy, []);
    const copy = new DatabaseSync(join(dir, 'copy.sqlite'), { readOnly: true });
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM a').get().n, 50);
    copy.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

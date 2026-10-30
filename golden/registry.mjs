// Golden-output registry (FR-05, AC-04 of 00.01). Every business calculation or report
// registers a deterministic run() here; outputs are stored in golden/outputs/<id>.json
// and compared byte-for-byte by `npm run erp:golden` and `npm run erp:regression`.
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { resolveFlag } from '../src/server/modules/core/feature-flags/service.js';

function flagEvaluationMatrix() {
  const db = new DatabaseSync(':memory:');
  migrateUp(db);
  const ins = db.prepare(
    `INSERT INTO core_feature_flags (key, description, default_enabled, environment, company_id, project_id, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  // Fixed fixture: base OFF, production ON, company 1 OFF, project 11 of company 1 ON.
  ins.run('ff.golden.demo', 'golden fixture', 0, null, null, null, 0);
  ins.run('ff.golden.demo', 'golden fixture', 0, 'production', null, null, 1);
  ins.run('ff.golden.demo', 'golden fixture', 0, null, 1, null, 0);
  ins.run('ff.golden.demo', 'golden fixture', 0, null, 1, 11, 1);
  const rows = [];
  for (const environment of ['development', 'production']) {
    for (const [companyId, projectId] of [[null, null], [1, null], [1, 11], [1, 12], [2, 11]]) {
      rows.push({ environment, companyId, projectId, ...resolveFlag(db, 'ff.golden.demo', { environment, companyId, projectId }) });
    }
  }
  rows.push({ environment: 'production', companyId: null, projectId: null, ...resolveFlag(db, 'ff.golden.missing', { environment: 'production' }) });
  db.close();
  return rows;
}

export const registry = [
  { id: 'prog.flag_evaluation_matrix', description: 'Feature flag precedence over environment x company x project', run: flagEvaluationMatrix },
];

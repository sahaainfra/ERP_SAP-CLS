/** Demo company/project overrides so the admin page has scoped rows to show. Idempotent. */
export function seedDemo(db) {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO core_feature_flags
       (key, description, default_enabled, environment, company_id, project_id, enabled, created_by, source_type)
     VALUES (?, ?, 0, NULL, ?, ?, ?, 'demo-seed', 'demo_seed')`,
  );
  let n = 0;
  n += Number(ins.run('ff.prog.p0002', 'Part 00.02 engineering baseline and feature flags', 1, null, 1).changes);
  n += Number(ins.run('ff.prog.p0002', 'Part 00.02 engineering baseline and feature flags', 1, 101, 0).changes);
  return n;
}

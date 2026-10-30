# DB_CATALOGUE

Database: SQLite (node:sqlite). Source of truth: `migrations/*.up.sql`.
Row counts are not recorded: the catalogue is generated from migrations, not from a live database.

## Tables

| Table | Migration | Columns |
|---|---|---|
| core_feature_flags | 20261030000001_core_feature_flags.up.sql | id, key, description, default_enabled, environment, company_id, project_id, enabled, changed_by, changed_at, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_audit_log | 20261030000002_core_audit_and_outbox.up.sql | id, entity, entity_id, action, old_values, new_values, reason, actor, correlation_id, created_at |
| core_outbox | 20261030000002_core_audit_and_outbox.up.sql | id, event_type, aggregate_id, payload, created_at, published_at |

## Indexes

| Index | Table | Unique | Migration |
|---|---|---|---|
| ux_core_feature_flags_scope | core_feature_flags | yes | 20261030000001_core_feature_flags.up.sql |
| ix_core_feature_flags_company | core_feature_flags | no | 20261030000001_core_feature_flags.up.sql |
| ix_core_feature_flags_project | core_feature_flags | no | 20261030000001_core_feature_flags.up.sql |
| ix_core_audit_log_entity | core_audit_log | no | 20261030000002_core_audit_and_outbox.up.sql |
| ix_core_outbox_unpublished | core_outbox | no | 20261030000002_core_audit_and_outbox.up.sql |

Views, triggers and functions: none.

## ER diagram

```mermaid
erDiagram
  core_feature_flags
  core_audit_log
  core_outbox
```

No foreign keys exist yet; tables are independent until the organisation tables (02.02) are built.

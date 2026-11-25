DROP INDEX IF EXISTS ux_cls_closures_live;
CREATE UNIQUE INDEX IF NOT EXISTS ux_cls_closures_live ON cls_closures (org_project_id) WHERE status IN ('DRAFT', 'SUBMITTED', 'APPROVED') AND deleted_at IS NULL;
DROP INDEX IF EXISTS ux_ho_client_assets_tag;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ho_client_assets_tag ON ho_client_assets (handover_id, tag_no);

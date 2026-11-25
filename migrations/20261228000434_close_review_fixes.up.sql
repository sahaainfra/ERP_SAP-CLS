-- Review fixes for parts 26.02 and 26.04:
--  - A client asset removed from a handover (soft-deleted) no longer blocks adding the same tag again.
--  - A rejected closeout still counts as the project's live closeout (it can be edited and requested again), so a second one is refused.
DROP INDEX IF EXISTS ux_ho_client_assets_tag;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ho_client_assets_tag ON ho_client_assets (handover_id, tag_no) WHERE deleted_at IS NULL;
DROP INDEX IF EXISTS ux_cls_closures_live;
CREATE UNIQUE INDEX IF NOT EXISTS ux_cls_closures_live ON cls_closures (org_project_id) WHERE status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED') AND deleted_at IS NULL;

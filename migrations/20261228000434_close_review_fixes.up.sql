-- Review fixes for parts 26.02 and 26.04:
--  - A client asset removed from a handover (soft-deleted) no longer blocks adding the same tag again.
--  - A rejected closeout still counts as the project's live closeout (it can be edited and requested again), so a second one is refused.
DROP INDEX IF EXISTS ux_ho_client_assets_tag;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ho_client_assets_tag ON ho_client_assets (handover_id, tag_no) WHERE deleted_at IS NULL;
DROP INDEX IF EXISTS ux_cls_closures_live;
-- Before this migration a project could hold a REJECTED closeout next to a live one; the newer live record stays and each older rejected one
-- is cancelled (it can no longer be requested again), so the index below can be built.
UPDATE cls_closures SET status = 'CANCELLED', remarks = 'Cancelled by migration 20261228000434: the project has a newer live closeout.',
  updated_by = 'migration', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), version = version + 1
WHERE status = 'REJECTED' AND deleted_at IS NULL AND EXISTS (
  SELECT 1 FROM cls_closures o WHERE o.org_project_id = cls_closures.org_project_id AND o.id != cls_closures.id AND o.deleted_at IS NULL
    AND (o.status IN ('DRAFT', 'SUBMITTED', 'APPROVED') OR (o.status = 'REJECTED' AND o.id > cls_closures.id)));
CREATE UNIQUE INDEX IF NOT EXISTS ux_cls_closures_live ON cls_closures (org_project_id) WHERE status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED') AND deleted_at IS NULL;

import { notFound } from '../../platform/http/errors.js';
import { projectStatusDatasetVersion, readProjectStatusCounts } from './project-status-dataset.js';

export function requireMetricFlag(context, actor) {
  const companyId = actor?.companyId;
  if (!Number.isSafeInteger(companyId) || companyId < 1 || !context.flags.isOn(actor, 'ff.bi.p2703')) {
    throw notFound('The metric catalogue is unavailable.');
  }
}

export function metricCertification(db, companyId, code = 'project-count', datasetVersion = projectStatusDatasetVersion) {
  return db.prepare(`SELECT status, version FROM bi_metrics
    WHERE company_id = ? AND code = ? AND dataset_version = ?
    ORDER BY version DESC LIMIT 1`).get(companyId, code, datasetVersion);
}

export const projectCountDefinition = {
  code: 'project-count',
  name: 'Project count',
  unit: 'projects',
  definition: 'Count of projects visible to the requester in the Project Status dataset.',
  lineage: { dataset: 'project-status', datasetVersion: projectStatusDatasetVersion, source: 'proj.projects', groupedBy: 'lifecycle_state' },
};

/** Live aggregate over the same projects visible in the Project Status dataset. */
export function readProjectCountMetric(context, actor, projectId = null) {
  requireMetricFlag(context, actor);
  const byLifecycle = readProjectStatusCounts(context, actor, projectId);
  const certification = metricCertification(context.db, actor.companyId);
  return {
    ...projectCountDefinition,
    certified: certification?.status === 'CERTIFIED',
    evaluatedAt: new Date().toISOString(),
    value: byLifecycle.reduce((total, group) => total + group.count, 0),
    byLifecycle,
  };
}

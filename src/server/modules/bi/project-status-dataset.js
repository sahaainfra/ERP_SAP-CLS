import { badRequest, notFound } from '../../platform/http/errors.js';
import { projectStatusSource, readProjectStatusReport } from './project-status.js';
import { projectsOf } from '../proj/project.js';

export const projectStatusColumns = Object.freeze([
  { key: 'projectId', label: 'Project ID', type: 'id' },
  { key: 'code', label: 'Code', type: 'text' },
  { key: 'name', label: 'Project', type: 'text' },
  { key: 'state', label: 'Lifecycle code', type: 'text' },
  { key: 'stateLabel', label: 'Lifecycle', type: 'text' },
  { key: 'status', label: 'Approval code', type: 'text' },
  { key: 'statusLabel', label: 'Approval status', type: 'text' },
  { key: 'health', label: 'Health', type: 'text' },
]);
const projectStatusFields = projectStatusColumns.map(({ key }) => key);
export const projectStatusDatasetVersion = 1;
export const projectStatusGroups = [['state', 'Lifecycle'], ['status', 'Approval status']];

function requireProjectStatusDataset(context, actor) {
  const companyId = actor?.companyId;
  if (!Number.isSafeInteger(companyId) || companyId < 1 || !context.flags.isOn(actor, 'ff.bi.p2702')) {
    throw notFound('The project status dataset is unavailable.');
  }
}

export function projectStatusDatasetSource(context, actor) {
  requireProjectStatusDataset(context, actor);
  return projectStatusSource(context, actor);
}

export function readProjectStatusCounts(context, actor, projectId = null) {
  return projectStatusDatasetSource(context, actor).statusCounts(actor, {}, 'state', projectId);
}

/**
 * Preview a fixed dataset using the scope and pagination of the project status report.
 * @param {Parameters<typeof readProjectStatusReport>[0]} context
 * @param {Parameters<typeof readProjectStatusReport>[1]} actor
 * @param {{ fields?: unknown, [key: string]: unknown }} [input]
 */
export function readProjectStatusDataset(context, actor, input = {}) {
  requireProjectStatusDataset(context, actor);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Provide dataset parameters as an object.');
  }
  const { fields = projectStatusFields, groupBy, ...query } = input;
  if (!Array.isArray(fields) || fields.length === 0 || fields.length > projectStatusFields.length
    || new Set(fields).size !== fields.length || !Array.from(fields).every((field) => projectStatusFields.includes(field))) {
    throw badRequest('Select distinct fields from the project status dataset.',
      [{ field: 'fields', message: 'Use project identity, lifecycle, approval status or health fields.' }]);
  }
  if (groupBy !== undefined && !projectStatusGroups.some(([key]) => key === groupBy)) {
    throw badRequest('Select lifecycle or approval status for the project count.');
  }
  const { data, meta } = readProjectStatusReport(context, actor, query);
  return {
    fields: [...fields],
    data: data.map((row) => Object.fromEntries(fields.map((field) => [field, row[field]]))),
    meta,
    ...(groupBy ? { summary: { groupBy, rows: projectsOf(context.db).projects.statusCounts(actor, query, groupBy) } } : {}),
  };
}

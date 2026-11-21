import { badRequest, notFound } from '../../platform/http/errors.js';
import { gatesOf } from '../hr/gates.js';
import { projectsOf } from '../proj/project.js';

export function requireReportRegistry({ db, flags }, actor) {
  const companyId = actor?.companyId;
  const gates = gatesOf(db);
  if (!Number.isSafeInteger(companyId) || companyId < 1 || !flags.isOn(actor, 'ff.bi.p2701')
    || !gates?.hasPassed(companyId, 'G1') || !gates.hasPassed(companyId, 'G2')) {
    throw notFound('The report catalogue is unavailable.');
  }
}

export function projectStatusSource(context, actor) {
  requireReportRegistry(context, actor);
  const projectService = projectsOf(context.db);
  if (!projectService || !context.flags.isOn(actor, 'ff.proj.p1001')) {
    throw notFound('The project status report is unavailable.');
  }
  return projectService.projects;
}

/** Read a page of project lifecycle status from the owning register. */
export function readProjectStatusReport(context, actor, query = {}) {
  const source = projectStatusSource(context, actor);
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw badRequest('Provide report parameters as an object.');
  }
  for (const field of Object.keys(query)) {
    if (!['page', 'pageSize', 'filter[state]'].includes(field)) {
      throw badRequest('Some report parameters are invalid.', [{ field, message: 'Use pagination or a lifecycle state filter.' }]);
    }
  }
  const { data, meta } = source.list(actor, query);
  return {
    data: data.map(({ projectId, code, name, state, stateLabel, status, statusLabel, health }) => ({
      projectId, code, name, state, stateLabel, status, statusLabel, health,
    })),
    meta: { page: meta.page, pageSize: meta.pageSize, total: meta.total, totalPages: meta.totalPages },
  };
}

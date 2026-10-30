import { parseListQuery } from '../../../platform/pagination/index.js';

export const listOptions = {
  sortable: ['run_at', 'check_code', 'status', 'severity'],
  filterable: ['check_code', 'status', 'severity'],
  defaultSort: [{ column: 'run_at', dir: 'desc' }],
};
export const parseRuns = (query) => parseListQuery(query, listOptions);

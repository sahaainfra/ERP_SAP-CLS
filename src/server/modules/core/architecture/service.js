import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../../platform/db/index.js';
import { assertPermission } from '../../../platform/auth/index.js';
import { ERROR_CODES, notFound } from '../../../platform/http/errors.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../../platform/pagination/index.js';
import { OUTBOX_MAX_AGE_MS, OUTBOX_MAX_BACKLOG } from '../../../platform/health/index.js';

export const GUIDE_PATH = 'docs/erp/ARCHITECTURE.md';

/** The pagination contract as data, so the guide page and the code cannot disagree. */
export const PAGINATION_CONTRACT = {
  request: [
    'page (default 1)',
    `pageSize (default ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE})`,
    'sort (comma list, "-" prefix for descending, allow-listed columns)',
    'q (free text, max 100 characters)',
    'filter[column] (allow-listed columns)',
    'from, to (YYYY-MM-DD)',
  ],
  response: '{ data: [...], meta: { page, pageSize, total, totalPages } }',
  limits: { defaultPageSize: DEFAULT_PAGE_SIZE, maxPageSize: MAX_PAGE_SIZE },
};

export function createArchitectureService({ modules, isFlagOn = (_actor, _key) => true, root = ROOT }) {
  return {
    guide(actor) {
      assertPermission(actor, 'core.arch.view');
      if (!isFlagOn(actor, 'ff.core.p0101')) {
        throw notFound('The architecture guide is not enabled for your company yet (feature flag ff.core.p0101 is OFF).');
      }
      const file = join(root, ...GUIDE_PATH.split('/'));
      if (!existsSync(file)) throw notFound(`The architecture guide (${GUIDE_PATH}) is not part of this installation.`);
      return {
        markdown: readFileSync(file, 'utf8'),
        modules: modules.map(({ mount: _mount, ...m }) => m),
        errorCodes: ERROR_CODES,
        pagination: PAGINATION_CONTRACT,
        health: { outboxMaxBacklog: OUTBOX_MAX_BACKLOG, outboxMaxAgeMinutes: OUTBOX_MAX_AGE_MS / 60000 },
      };
    },
  };
}

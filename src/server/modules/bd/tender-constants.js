import { parameterRegistry } from '../../platform/parameters/index.js';

// The tender register (part 08.02): words and settings. A tender has two states: its approval status is the registration (a colleague of the estimation team checks it), its stage is its progress: Open, then Bid or No bid by the approved decision,
// then Ready (submission readiness, BR-01), then Submitted, and Awarded or Lost from 08.03.
export const PORTALS = { CPPP: 'CPPP (central portal)', GEM: 'GeM', STATE_PORTAL: 'State e-procurement portal', CLIENT_SITE: 'Client website', OTHER: 'Other' };
export const BID_TYPES = { ITEM_RATE: 'Item rate', PERCENTAGE: 'Percentage rate', LUMP_SUM: 'Lump sum', EPC: 'EPC', HAM: 'HAM' };
export const TENDER_STAGES = { OPEN: 'Open', NO_BID: 'No bid', BID: 'Bid: preparing', READY: 'Ready for submission', SUBMITTED: 'Submitted', AWARDED: 'Awarded', LOST: 'Lost', CLOSED: 'Closed' };
export const LIVE_STAGES = ['OPEN', 'BID', 'READY'];
export const CRITERIA = { TURNOVER: 'Turnover', SIMILAR_WORK: 'Similar work experience', NET_WORTH: 'Net worth', BID_CAPACITY: 'Bid capacity', REGISTRATION_CLASS: 'Registration class', JV: 'Joint venture conditions', OTHER: 'Other' };
export const NUMERIC_CRITERIA = ['TURNOVER', 'NET_WORTH', 'BID_CAPACITY'];
export const RESULTS = { PENDING: 'Not assessed', PASS: 'Pass', FAIL: 'Fail', WAIVED: 'Waived' };
export const IMPACTS = { NONE: 'No impact', DATES: 'Dates', SCOPE: 'Scope', VALUE: 'Value', DOCUMENTS: 'Documents' };
export const QUERY_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Sent to the authority', ANSWERED: 'Answered', NO_RESPONSE: 'No response' };
export const TEAM_KINDS = { ESTIMATION: 'Estimation', TECHNICAL_DOCS: 'Technical documents', FINANCIAL_DOCS: 'Financial documents', SITE_VISIT: 'Site visit', OTHER: 'Other' };
export const TASK_STATUS = { OPEN: 'Open', DONE: 'Done', CANCELLED: 'Cancelled' };
export const SCORE_KEYS = { STRATEGIC_FIT: 'Strategic fit', MARGIN: 'Margin', RISK: 'Risk', CAPACITY: 'Capacity', COMPETITION: 'Competition' };
export const DECISIONS = { BID: 'Bid', NO_BID: 'No bid' };
export const TENDER_DOC = 'TDR_TENDER'; export const DECISION_DOC = 'TDR_BID_DECISION';
const CHECKLIST = [['TURNOVER', 'Average annual turnover'], ['SIMILAR_WORK', 'Similar work experience'], ['NET_WORTH', 'Net worth'], ['BID_CAPACITY', 'Bid capacity (A x N x 2 - B)'], ['REGISTRATION_CLASS', 'Contractor registration class'], ['JV', 'Joint venture conditions']];
for (const [key, dataType, def, description, extra] of [
  ['tdr.bid_weights', 'json', { STRATEGIC_FIT: 25, MARGIN: 25, RISK: 20, CAPACITY: 15, COMPETITION: 15 }, 'FR-03: the weight (percent, adding up to 100) of each criterion of the bid or no-bid score; each criterion is scored 1 to 5.', {}],
  ['tdr.bid_score_threshold', 'integer', 60, 'FR-03: the score (0 to 100) from which a bid is recommended; a decision against the recommendation needs reasons.', { min: 0, max: 100 }],
  ['tdr.reminder_offsets_days', 'json', [7, 3, 1, 0], 'FR-07: the days before the pre-bid meeting, the submission and the opening (and before a team task is due) on which the owner and the team are reminded.', {}],
  ['tdr.profile.max_turnover_minor', 'integer', 0, 'BR-02: A of the bid capacity, in paise: the highest value of works the company did in any one of the last five years.', { min: 0 }],
  ['tdr.profile.commitments_minor', 'integer', 0, 'BR-02: B of the bid capacity, in paise: the value of the works in hand.', { min: 0 }],
  ['tdr.capacity_factor', 'integer', 2, 'BR-02: the factor of the bid capacity formula (A x N x factor - B), 2 unless the tender says otherwise.', { min: 1, max: 10 }],
  ['tdr.eligibility_checklist', 'json', CHECKLIST, 'FR-02: the criteria a new tender starts with, as [criterion, title].', {}],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

import { parameterRegistry } from '../../platform/parameters/index.js';

// Business development (part 08.01): the words and the settings of leads, opportunities and the pipeline. An opportunity has two states that must not be mixed up: its approval status is the go-ahead for tendering (DRAFT to APPROVED, by the
// workflow) and its stage is where it is in the pipeline (Identified to Won or Lost, moved by the people who work it). A win comes only from a tender award (08.03) or from a direct award the director approved (BR-01).
export const SECTORS = { BUILDING: 'Building', ROADS: 'Roads', BRIDGES: 'Bridges', WATER: 'Water', INDUSTRIAL: 'Industrial', EPC: 'EPC', OTHER: 'Other' };
export const SOURCES = { TENDER_PORTAL: 'Tender portal', REFERRAL: 'Referral', CLIENT_ENQUIRY: 'Client enquiry', WEBSITE: 'Website', EVENT: 'Event', OTHER: 'Other' };
export const STAGE_LIST = ['IDENTIFIED', 'QUALIFIED', 'PRE_BID', 'TENDER_EXPECTED', 'BID_SUBMITTED', 'NEGOTIATION', 'WON', 'LOST'];
export const STAGES = { IDENTIFIED: 'Identified', QUALIFIED: 'Qualified', PRE_BID: 'Pre-bid', TENDER_EXPECTED: 'Tender expected', BID_SUBMITTED: 'Bid submitted', NEGOTIATION: 'Negotiation', WON: 'Won', LOST: 'Lost' };
export const OPEN_STAGES = STAGE_LIST.slice(0, 6);
/** From this stage on a tender is being pursued, which needs the go-ahead. */
export const GO_AHEAD_FROM = 'PRE_BID';
export const APPROVAL = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const LEAD_STATUS = { ...APPROVAL, APPROVED: 'Qualified', REJECTED: 'Not qualified', CONVERTED: 'Converted to an opportunity' };
export const OPP_STATUS = { ...APPROVAL, DRAFT: 'Go-ahead not asked', SUBMITTED: 'Go-ahead waiting', APPROVED: 'Go-ahead given', RETURNED: 'Go-ahead returned', REJECTED: 'Go-ahead refused' };
export const AWARD_STATUS = { NONE: 'None', REQUESTED: 'Direct award waiting for approval', APPROVED: 'Direct award approved', REJECTED: 'Direct award refused' };
export const INTERACTION_TYPES = { CALL: 'Call', MEETING: 'Meeting', SITE_VISIT: 'Site visit', EMAIL: 'E-mail', NOTE: 'Note' };
export const INFLUENCE_ROLES = { DECISION_MAKER: 'Decision maker', INFLUENCER: 'Influencer', TECHNICAL: 'Technical evaluator', FINANCE: 'Finance', USER: 'End user', GATEKEEPER: 'Gatekeeper' };
export const STANCES = { CHAMPION: 'Champion', SUPPORTER: 'Supporter', NEUTRAL: 'Neutral', SKEPTIC: 'Sceptic', BLOCKER: 'Blocker' };
export const RATINGS = { YES: 'Yes', PARTIAL: 'Partly', NO: 'No' };
export const BANT = ['budget', 'authority', 'need', 'timeline'];
export const LEAD_DOC = 'BD_LEAD'; export const OPP_DOC = 'BD_OPPORTUNITY'; export const AWARD_DOC = 'BD_DIRECT_AWARD';
const DEFAULT_PROB = { IDENTIFIED: 5, QUALIFIED: 15, PRE_BID: 25, TENDER_EXPECTED: 35, BID_SUBMITTED: 50, NEGOTIATION: 75, WON: 100, LOST: 0 };
const DEFAULT_LOST = [['PRICE', 'Our price was higher'], ['TECHNICAL', 'Technical score was lower'], ['RELATIONSHIP', 'The client preferred another firm'], ['CAPACITY', 'We lacked the capacity or the track record'], ['SCOPE_CHANGE', 'The scope changed'], ['CLIENT_CANCELLED', 'The client cancelled or deferred the work'], ['NO_BID', 'We decided not to bid'], ['OTHER', 'Another reason']];
for (const [key, dataType, def, description, extra] of [
  ['bd.stage_probability', 'json', DEFAULT_PROB, 'BR-02: the probability (percent) that an opportunity at each stage is won; a person may override it for an opportunity with a reason.', {}],
  ['bd.go_ahead.director_above_minor', 'integer', 10_000_000_000, 'The estimated value (in paise) above which the director gives the go-ahead after the business development review: ₹10 crore.', { min: 0 }],
  ['bd.lead.min_score', 'integer', 40, 'FR-01: the qualification score (0 to 100, from budget, authority, need and timeline) a lead needs before it is sent for qualification.', { min: 0, max: 100 }],
  ['bd.regions', 'json', ['NORTH', 'SOUTH', 'EAST', 'WEST', 'CENTRAL', 'NORTH_EAST'], 'FR-05: the regions a lead or an opportunity belongs to, for the forecast.', {}],
  ['bd.lost_reasons', 'json', DEFAULT_LOST, 'FR-06: the reasons an opportunity is lost, as [code, label].', {}],
  ['bd.followup.remind_days', 'integer', 0, 'FR-03: the days before the date of a next action that the person is reminded (0 = on the day).', { min: 0, max: 30 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

export const nowIso = () => new Date().toISOString();
export const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
export const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
/** Paise to rupees and back: money is kept in paise and the API speaks rupees. */
export const rupees = (m) => (m == null ? null : Math.round(m) / 100);
export const toMinor = (r) => (r == null ? null : Math.round(Number(r) * 100));
/** The weighted value of one opportunity, in paise: value times probability, rounded once per opportunity (the same rounding as the SQL of the forecast). */
export const weightedMinor = (valueMinor, pct) => Math.round((Number(valueMinor) * Number(pct)) / 100);
export const WEIGHTED_SQL = (a) => `CAST(ROUND(${a}.est_value_minor * ${a}.probability_pct / 100.0) AS INTEGER)`;
export const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
export const stageIndex = (s) => STAGE_LIST.indexOf(s);

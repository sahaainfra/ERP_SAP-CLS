// The reference form of the data-entry framework (part 03.02, AC-02): a sample material request. One definition and one schema,
// used by the browser (layout, inline validation) and by the server (the same validation again, BR-01). The definition is also
// seeded into ui_form_metadata by migration 39; a test keeps the two equal.
import { z } from 'zod';
import { parseNumberInput } from './numbers.js';

export const SAMPLE_REQUEST_FORM = 'ui.sample_request';
export const MAX_LINES = 500;

/** Declarative definition (FR-10): sections, fields, context defaults, conditions, dependent lookups and the line grid. */
export const sampleRequestDefinition = {
  code: SAMPLE_REQUEST_FORM,
  version: 1,
  name: 'Sample material request',
  module: 'ui',
  sections: [
    { id: 'request', title: 'Request', columns: 3, fields: ['title', 'docDate', 'requiredBy', 'projectId', 'siteId', 'costCentreId', 'departmentId', 'requestedBy', 'priority', 'urgencyReason'] },
    { id: 'delivery', title: 'Delivery', columns: 2, collapsible: true, fields: ['returnable', 'returnBy', 'deliveryNote', 'deliveryLocation'] },
    { id: 'lines', title: 'Items', grid: 'lines' },
  ],
  fields: {
    title: { type: 'text', label: 'Title', required: true, maxLength: 120, hint: 'What the material is for, for example "Footing F3 reinforcement"' },
    docDate: { type: 'date', label: 'Request date', required: true, context: 'today' },
    requiredBy: { type: 'date', label: 'Required by', required: true, hint: 'Holidays are marked in the calendar' },
    projectId: { type: 'lookup', label: 'Project', required: true, lookup: 'iam/projects', context: 'project' },
    siteId: { type: 'lookup', label: 'Site', lookup: 'iam/sites', parent: 'projectId', context: 'site' },
    costCentreId: { type: 'lookup', label: 'Cost centre', lookup: 'iam/cost-centres', parent: 'siteId', default: 'firstOfParent' },
    departmentId: { type: 'lookup', label: 'Department', lookup: 'iam/departments', context: 'department' },
    requestedBy: { type: 'text', label: 'Requested by', readOnly: true, context: 'user' },
    priority: { type: 'radio', label: 'Priority', options: [['NORMAL', 'Normal'], ['URGENT', 'Urgent']], default: 'NORMAL' },
    urgencyReason: { type: 'textarea', label: 'Why is it urgent?', required: true, when: { field: 'priority', equals: 'URGENT' }, maxLength: 500 },
    returnable: { type: 'switch', label: 'Returnable (scaffolding, shuttering, tools)', default: false },
    returnBy: { type: 'date', label: 'Return by', required: true, when: { field: 'returnable', equals: true } },
    deliveryNote: { type: 'richtext', label: 'Delivery instructions', maxLength: 2000 },
    deliveryLocation: { type: 'gps', label: 'Delivery point' },
  },
  grids: {
    lines: {
      label: 'Items',
      maxRows: MAX_LINES,
      columns: [
        { key: 'description', label: 'Description', type: 'text', required: true, maxLength: 200, freeze: true },
        { key: 'uom', label: 'Unit', type: 'lookup', lookup: 'core/uoms', required: true },
        { key: 'quantity', label: 'Quantity', type: 'quantity', required: true, scale: 3 },
        { key: 'unitRate', label: 'Rate (₹)', type: 'currency', required: true, scale: 4 },
        { key: 'amount', label: 'Amount (₹)', type: 'currency', computed: ['quantity', 'unitRate'], formula: 'boq.line_amount', scale: 2, total: true },
        { key: 'neededOn', label: 'Needed on', type: 'date' },
        { key: 'comment', label: 'Comment', type: 'text', maxLength: 300 },
      ],
    },
  },
  duplicateCheck: 'ui.sample_request',
  createFrom: [{ source: 'core.sample_document', label: 'Sample document' }],
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (v) => DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const date = (label) => z.string({ error: `Enter the ${label}` }).refine(realDate, `Enter the ${label} as a real date`);
const optionalDate = (label) => z.union([z.literal(''), z.null(), date(label)]).optional().transform((v) => v || null);
const id = (label) => z.coerce.number({ error: `Choose the ${label}` }).int().positive(`Choose the ${label}`);
const optionalId = z.union([z.literal(''), z.null(), z.coerce.number().int().positive()]).optional().transform((v) => v || null);
const decimal = (label, scale, { positive = false } = {}) =>
  z.union([z.string(), z.number()]).transform(String).superRefine((v, ctx) => {
    const r = parseNumberInput(v, { scale, max: '999999999' });
    if (!r.ok) ctx.addIssue({ code: 'custom', message: r.error });
    else if (r.value === '') ctx.addIssue({ code: 'custom', message: `Enter the ${label}` });
    else if (positive && Number(r.value) <= 0) ctx.addIssue({ code: 'custom', message: `The ${label} must be more than zero` });
  }).transform((v) => parseNumberInput(v, { scale }).value);
const coordinate = (max) => z.union([z.literal(''), z.null(), z.string().regex(/^-?\d{1,3}\.\d{1,7}$/, 'Not a coordinate').refine((v) => Math.abs(Number(v)) <= max, 'Not a coordinate')]).optional().transform((v) => v || null);

export const sampleRequestLine = z.object({
  id: z.number().int().positive().optional(),
  description: z.string({ error: 'Describe the item' }).trim().min(2, 'Describe the item (at least 2 characters)').max(200, 'Use at most 200 characters'),
  uom: z.string({ error: 'Choose the unit' }).trim().regex(/^[A-Z0-9]{1,10}$/, 'Choose the unit'),
  quantity: decimal('quantity', 3, { positive: true }),
  unitRate: decimal('rate', 4),
  amount: z.union([z.string(), z.number()]).transform(String).optional(),
  neededOn: optionalDate('date needed'),
  comment: z.string().trim().max(300, 'Use at most 300 characters').optional().transform((v) => v || null),
});

/** The request as the form sends it. `total` and line `amount` are what the person saw; the server recomputes and compares. */
export const sampleRequestSchema = z.object({
  title: z.string({ error: 'Enter a title' }).trim().min(3, 'Enter a title of at least 3 characters').max(120, 'Use at most 120 characters'),
  docDate: date('request date'),
  requiredBy: date('date it is required by'),
  projectId: id('project'),
  siteId: optionalId,
  costCentreId: optionalId,
  departmentId: optionalId,
  priority: z.enum(['NORMAL', 'URGENT']).default('NORMAL'),
  urgencyReason: z.string().trim().max(500, 'Use at most 500 characters').optional().transform((v) => v || null),
  returnable: z.boolean().default(false),
  returnBy: optionalDate('return date'),
  deliveryNote: z.string().max(2000, 'Use at most 2000 characters').optional().transform((v) => v || null),
  deliveryLat: coordinate(90),
  deliveryLng: coordinate(180),
  lines: z.array(sampleRequestLine).min(1, 'Add at least one item').max(MAX_LINES, `At most ${MAX_LINES} items`),
  total: z.union([z.string(), z.number()]).transform(String).optional(),
  sourceType: z.enum(['core.sample_document']).optional(),
  sourceId: z.coerce.number().int().positive().optional(),
}).superRefine((v, ctx) => {
  if (v.requiredBy < v.docDate) ctx.addIssue({ code: 'custom', path: ['requiredBy'], message: 'The required-by date cannot be before the request date' });
  if (v.priority === 'URGENT' && (!v.urgencyReason || v.urgencyReason.length < 10)) ctx.addIssue({ code: 'custom', path: ['urgencyReason'], message: 'Say why it is urgent (at least 10 characters)' });
  if (v.returnable && !v.returnBy) ctx.addIssue({ code: 'custom', path: ['returnBy'], message: 'Enter the date it will be returned by' });
  if (v.returnable && v.returnBy && v.returnBy < v.docDate) ctx.addIssue({ code: 'custom', path: ['returnBy'], message: 'The return date cannot be before the request date' });
  if ((v.deliveryLat === null) !== (v.deliveryLng === null)) ctx.addIssue({ code: 'custom', path: ['deliveryLat'], message: 'Capture both latitude and longitude, or neither' });
  v.lines.forEach((l, i) => {
    if (l.neededOn && l.neededOn < v.docDate) ctx.addIssue({ code: 'custom', path: ['lines', i, 'neededOn'], message: 'Cannot be before the request date' });
  });
});

/** Is a field shown, given the current values? (conditional fields, FR-05) */
export const isShown = (field, values) => !field.when || values[field.when.field] === field.when.equals;

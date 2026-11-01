import { useState } from 'react';
import { useFormRegistry } from './api.js';
import { QueryState, usePageTitle } from '../core/pages/ui.jsx';
import {
  CheckboxField, DateField, DateRangeField, FileField, GpsField, LineGrid, LookupField, MultiSelectField, NumberField, PhotoField, QrScanField, RadioGroupField, RichTextField,
  SelectField, SignaturePad, SwitchField, TextareaField, TextField, TimeField, newRow, todayIst,
} from '../../platform/forms/index.js';

// The Form Components Gallery (part 03.02, AC-01): every field type of the data-entry framework in each state (default, focus, error,
// disabled, read-only), working, in the current theme and density; a line grid to try keyboard entry and paste from Excel; and what
// the framework offers on this server (forms, lookups, duplicate checks, create-from), read live.

const STATES = [['default', 'Default'], ['focus', 'Focus'], ['error', 'Error'], ['disabled', 'Disabled'], ['readonly', 'Read-only']];
const OPTIONS = [['RCC', 'RCC works'], ['STEEL', 'Structural steel'], ['FINISH', 'Finishing'], ['MEP', 'MEP services']];
const today = todayIst();

/** One component type, shown in every state; each instance keeps its own value so it can be tried. */
const COMPONENTS = [
  { name: 'Text', C: TextField, value: 'Footing F3 reinforcement', error: 'Enter a title of at least 3 characters', props: { maxLength: 120 } },
  { name: 'Number', C: NumberField, value: '1234567.5', error: 'The digit grouping is not right: use 12,34,567 or 1,234,567', props: { kind: 'number' } },
  { name: 'Quantity', C: NumberField, value: '1250.5', error: 'Use at most 3 decimal places', props: { kind: 'quantity' } },
  { name: 'Currency (₹)', C: NumberField, value: '1450000', error: 'Enter zero or more', props: { kind: 'currency' } },
  { name: 'Percentage', C: NumberField, value: '18', error: 'Enter at most 100', props: { kind: 'percent' } },
  { name: 'Date (holidays marked)', C: DateField, value: today, error: 'Enter the date as a real date', props: {} },
  { name: 'Date range', C: DateRangeField, value: { from: today, to: '' }, error: 'The end date cannot be before the start date', props: {} },
  { name: 'Time', C: TimeField, value: '07:30', error: 'Enter a time between 06:00 and 22:00', props: {} },
  { name: 'Select', C: SelectField, value: 'RCC', error: 'Choose the work type', props: { options: OPTIONS } },
  { name: 'Lookup (server search)', C: LookupField, value: '', error: 'Choose the project', props: { lookup: 'iam/projects' } },
  { name: 'Multi-select', C: MultiSelectField, value: ['RCC', 'MEP'], error: 'Choose at least one', props: { options: OPTIONS } },
  { name: 'Checkbox', C: CheckboxField, value: true, error: 'Confirm the safety briefing', props: {} },
  { name: 'Radio', C: RadioGroupField, value: 'NORMAL', error: 'Choose the priority', props: { options: [['NORMAL', 'Normal'], ['URGENT', 'Urgent']] } },
  { name: 'Switch', C: SwitchField, value: true, error: 'Returnable items need a return date', props: {} },
  { name: 'Textarea', C: TextareaField, value: 'Deliver to the Km 12 camp store before 10:00.', error: 'Use at most 500 characters', props: {} },
  { name: 'Rich text (restricted)', C: RichTextField, value: '## Delivery\n- **Gate 2** only\n- Unload with the site crane', error: 'Use at most 2000 characters', props: {} },
  { name: 'QR / barcode', C: QrScanField, value: 'MTC-2026-00412', error: 'This code does not match any material', props: {} },
  { name: 'GPS', C: GpsField, value: { lat: '19.076000', lng: '72.877700', accuracy: '12' }, error: 'Capture both latitude and longitude', props: {} },
  { name: 'Signature', C: SignaturePad, value: '', error: 'The receiver must sign', props: {} },
  { name: 'Photo', C: PhotoField, value: null, error: 'Add a photo of the delivered material', props: {} },
  { name: 'File (01.05)', C: FileField, value: null, error: 'Attach the test certificate', props: {} },
];

function Demo({ spec, state, index }) {
  const [value, setValue] = useState(spec.value);
  const id = `g-${index}-${state}`;
  const { C } = spec;
  return (
    <div className="gallery-cell" data-state={state} data-label={STATES.find(([k]) => k === state)[1]}>
      <C id={id} label={spec.name} value={value} onChange={setValue} {...spec.props}
        error={state === 'error' ? spec.error : undefined} disabled={state === 'disabled'} readOnly={state === 'readonly'} demo={state === 'focus' ? 'focus' : undefined}
        required={state === 'error'} />
    </div>
  );
}

const GRID_COLUMNS = [
  { key: 'description', label: 'Description', type: 'text', required: true, freeze: true },
  { key: 'uom', label: 'Unit', type: 'lookup', lookup: 'core/uoms', valueKey: 'code', required: true },
  { key: 'quantity', label: 'Quantity', type: 'quantity', required: true, scale: 3 },
  { key: 'unitRate', label: 'Rate (₹)', type: 'currency', required: true, scale: 4 },
  { key: 'amount', label: 'Amount (₹)', type: 'currency', computed: ['quantity', 'unitRate'], scale: 2, total: true },
  { key: 'neededOn', label: 'Needed on', type: 'date' },
];

function Registry() {
  const reg = useFormRegistry();
  if (!reg.data) return <QueryState query={reg} what="the form registry" permission="a signed-in account" />;
  const { forms, lookups, duplicateChecks, createFrom } = reg.data;
  return (
    <div className="gallery-registry">
      <div className="table-wrap"><table><caption>Form definitions ({forms.length})</caption><thead><tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Version</th><th scope="col">Module</th></tr></thead>
        <tbody>{forms.map((f) => <tr key={f.code}><td data-label="Code"><code>{f.code}</code></td><td data-label="Name">{f.name}</td><td data-label="Version">{f.version}</td><td data-label="Module">{f.module}</td></tr>)}</tbody></table></div>
      <div className="table-wrap"><table><caption>Lookups ({lookups.length})</caption><thead><tr><th scope="col">Address</th><th scope="col">Lists</th><th scope="col">Extra columns</th><th scope="col">Needs</th></tr></thead>
        <tbody>{lookups.map((l) => <tr key={l.path}><td data-label="Address"><code>{l.path}</code></td><td data-label="Lists">{l.label}</td><td data-label="Extra columns">{l.columns.join(', ') || '-'}</td><td data-label="Needs">{l.permission}</td></tr>)}</tbody></table></div>
      <div className="table-wrap"><table><caption>Duplicate checks ({duplicateChecks.length})</caption><thead><tr><th scope="col">Name</th><th scope="col">Checks</th><th scope="col">Needs</th></tr></thead>
        <tbody>{duplicateChecks.map((d) => <tr key={d.name}><td data-label="Name"><code>{d.name}</code></td><td data-label="Checks">{d.label}</td><td data-label="Needs">{d.permission}</td></tr>)}</tbody></table></div>
      <div className="table-wrap"><table><caption>Create from ({createFrom.length})</caption><thead><tr><th scope="col">New</th><th scope="col">Started from</th></tr></thead>
        <tbody>{createFrom.map((c) => <tr key={`${c.target}-${c.source}`}><td data-label="New"><code>{c.target}</code></td><td data-label="Started from">{c.label} (<code>{c.source}</code>)</td></tr>)}</tbody></table></div>
    </div>
  );
}

export default function FormsGalleryPage() {
  usePageTitle('Form Components');
  const [rows, setRows] = useState(() => [newRow({ description: 'TMT bar 12 mm', uom: 'MT', quantity: '2.5', unitRate: '58000', neededOn: today }), newRow()]);
  const [filter, setFilter] = useState('');
  const shown = COMPONENTS.map((c, i) => ({ ...c, i })).filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <section aria-labelledby="page-title" className="gallery">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Design System &rsaquo; Form Components</nav>
      <div className="page-head"><h1 id="page-title">Form Components</h1></div>
      <p className="muted">Every field of the data-entry framework in each state, working: type, pick, paste and tab through them. They follow the theme and the density you chose under Appearance. Read-only values are shown as text, not as greyed-out boxes.</p>

      <h2 id="states-title">Fields in every state</h2>
      <div className="toolbar">
        <input type="search" aria-label="Find a component" placeholder="Find a component" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="muted small">{shown.length} of {COMPONENTS.length} components</span>
      </div>
      {shown.length === 0 && <div className="state"><h2>No component matches "{filter}"</h2><button type="button" className="btn" onClick={() => setFilter('')}>Show all</button></div>}
      <div className="gallery-table" role="table" aria-labelledby="states-title">
        <div className="gallery-row gallery-head" role="row">
          <span role="columnheader">Component</span>
          {STATES.map(([k, l]) => <span key={k} role="columnheader">{l}</span>)}
        </div>
        {shown.map((c) => (
          <div className="gallery-row" role="row" key={c.name} data-testid={`gallery-${c.i}`}>
            <span role="rowheader" className="gallery-name">{c.name}</span>
            {STATES.map(([k]) => <div role="cell" key={k}><Demo spec={c} state={k} index={c.i} /></div>)}
          </div>
        ))}
      </div>

      <h2 id="grid-title">Line-item grid</h2>
      <p className="muted small">Tab and Shift+Tab move across, Enter and the arrow keys move down and up, Enter on the last row adds one, Alt+N inserts a row, Alt+D duplicates. Copy a block of rows in Excel and paste it into a cell: each line becomes a row and each column a field. The amount is calculated as you type and the total kept in the footer; the first column stays in view.</p>
      <LineGrid id="gallery-lines" label="Sample items" columns={GRID_COLUMNS} rows={rows} onChange={setRows} maxRows={500} />

      <h2>Keyboard</h2>
      <div className="table-wrap">
        <table>
          <caption className="visually-hidden">Keyboard use</caption>
          <thead><tr><th scope="col">Where</th><th scope="col">Keys</th><th scope="col">What happens</th></tr></thead>
          <tbody>
            <tr><td data-label="Where">Any field</td><td data-label="Keys"><kbd>Tab</kbd> / <kbd>Shift+Tab</kbd></td><td data-label="What happens">Next or previous field, in reading order</td></tr>
            <tr><td data-label="Where">Lookup</td><td data-label="Keys"><kbd>↓</kbd> <kbd>↑</kbd> <kbd>Enter</kbd> <kbd>Esc</kbd> <kbd>Page Down</kbd></td><td data-label="What happens">Open the list, move, choose, close, load more</td></tr>
            <tr><td data-label="Where">Date</td><td data-label="Keys"><kbd>Alt+↓</kbd>, then arrows, <kbd>Page Up/Down</kbd>, <kbd>Home/End</kbd>, <kbd>Enter</kbd></td><td data-label="What happens">Open the calendar, move by day, week or month, choose; or type 31-10-2026</td></tr>
            <tr><td data-label="Where">Line grid</td><td data-label="Keys"><kbd>Enter</kbd> <kbd>↓</kbd> <kbd>↑</kbd> <kbd>Alt+N</kbd> <kbd>Alt+D</kbd> <kbd>Ctrl+V</kbd></td><td data-label="What happens">Down, up, insert a row, duplicate, paste rows from a spreadsheet</td></tr>
          </tbody>
        </table>
      </div>

      <h2>What the framework offers here</h2>
      <Registry />
    </section>
  );
}

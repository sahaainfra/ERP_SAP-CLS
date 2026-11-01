import { CheckboxField, MultiSelectField, NumberField, RadioGroupField, RichTextField, SelectField, SwitchField, TextareaField, TextField, TimeField } from './fields.jsx';
import { DateField, DateRangeField } from './DateField.jsx';
import { LookupField } from './LookupField.jsx';
import { GpsField, PhotoField, QrScanField, SignaturePad } from './capture.jsx';
import { fieldId } from './useForm.js';

// Renders a field from a form definition (part 03.02, FR-10): the definition says the type, label, rules and lookups; the page
// supplies the value and what happens on change. Any field type of FR-01 can be declared.
const BY_TYPE = {
  text: TextField, textarea: TextareaField, richtext: RichTextField, select: SelectField, multiselect: MultiSelectField, checkbox: CheckboxField,
  radio: RadioGroupField, switch: SwitchField, time: TimeField, date: DateField, daterange: DateRangeField, lookup: LookupField,
  gps: GpsField, photo: PhotoField, signature: SignaturePad, scan: QrScanField,
  number: NumberField, quantity: NumberField, currency: NumberField, percent: NumberField,
};

export function MetaField({ name, def, value, onChange, onPick, onBlur, error, readOnly = false, disabled = false, parentValue, parentLabel, siteId }) {
  const Component = BY_TYPE[def.type];
  if (!Component) throw new Error(`No field component for type "${def.type}" (${name})`);
  const props = {
    id: fieldId(name), label: def.label, value, onChange, onBlur, error, hint: def.hint, required: def.required, disabled, readOnly: readOnly || def.readOnly,
    ...(def.options ? { options: def.options } : {}),
    ...(def.maxLength ? { maxLength: def.maxLength } : {}),
    ...(['number', 'quantity', 'currency', 'percent'].includes(def.type) ? { kind: def.type, scale: def.scale } : {}),
    ...(def.type === 'lookup' ? { lookup: def.lookup, onPick, valueKey: def.valueKey ?? 'id', ...(def.parent ? { parent: parentValue, parentLabel } : {}) } : {}),
    ...(def.type === 'date' || def.type === 'daterange' ? { siteId } : {}),
  };
  return <Component {...props} />;
}

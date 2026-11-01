import { useId, useRef, useState } from 'react';
import Markdown from '../Markdown.jsx';
import { formatNumberInput, parseNumberInput } from '../../../shared/forms/numbers.js';
import { formatBusinessDate } from './dates.js';

// The field components of the data-entry framework (part 03.02, FR-01). Every field is controlled (value, onChange(value)), has a
// visible label, an optional hint, an error shown under it and announced (aria-invalid, aria-describedby), and a read-only form
// that shows the value as text rather than a greyed-out input (BR-03). `demo` forces a visual state for the components gallery.

/** Label, hint, error and read-only text around a control. */
export function FieldShell({ id, label, required = false, hint, error, readOnly = false, text, children, group = false, className = '' }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const Tag = group ? 'fieldset' : 'div';
  const Title = group ? 'legend' : 'label';
  return (
    <Tag className={`ff ${error ? 'ff-invalid' : ''} ${readOnly ? 'ff-readonly' : ''} ${className}`} data-field={id}>
      <Title className="ff-label" {...(group ? {} : { htmlFor: readOnly ? undefined : id })} id={`${id}-label`}>
        {label}{required && !readOnly && <span className="ff-req" aria-hidden="true"> *</span>}{required && !readOnly && <span className="visually-hidden"> (required)</span>}
      </Title>
      {readOnly
        ? <div className="ff-text" id={id} aria-labelledby={`${id}-label`}>{text === '' || text === null || text === undefined ? <span className="muted">Not given</span> : text}</div>
        : (typeof children === 'function' ? children({ 'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined, 'aria-invalid': error ? true : undefined }) : children)}
      {hint && !readOnly && <span className="ff-hint" id={hintId}>{hint}</span>}
      {error && <span className="ff-error" id={errId} role="alert">{error}</span>}
    </Tag>
  );
}

const demoClass = (demo) => (demo === 'focus' ? ' is-focus' : '');

export function TextField({ id, label, value, onChange, onBlur, error, hint, required, disabled, readOnly, maxLength, placeholder, inputMode, autoComplete, type = 'text', demo }) {
  return (
    <FieldShell id={id} label={label} required={required} hint={hint} error={error} readOnly={readOnly} text={value}>
      {(aria) => <input id={id} name={id} type={type} className={`ff-input${demoClass(demo)}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} required={required} disabled={disabled} maxLength={maxLength} placeholder={placeholder} inputMode={inputMode} autoComplete={autoComplete} {...aria} />}
    </FieldShell>
  );
}

export function TextareaField({ id, label, value, onChange, onBlur, error, hint, required, disabled, readOnly, maxLength = 500, rows = 3, demo }) {
  const len = String(value ?? '').length;
  return (
    <FieldShell id={id} label={label} required={required} hint={hint ?? `${len} of ${maxLength} characters`} error={error} readOnly={readOnly} text={value}>
      {(aria) => <textarea id={id} name={id} className={`ff-input${demoClass(demo)}`} rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} required={required} disabled={disabled} maxLength={maxLength} {...aria} />}
    </FieldShell>
  );
}

const NUMBER_KINDS = { number: { scale: 2 }, quantity: { scale: 3 }, currency: { scale: 2, prefix: '₹' }, percent: { scale: 4, suffix: '%', max: '100' } };

/**
 * Numbers, quantities, money and percentages (BR-02): typed or pasted with Indian or international grouping, kept as a plain decimal
 * string, shown with Indian grouping when the field is not being edited. The value is whatever was typed until it reads as a number,
 * so the shared schema can name what is wrong with it.
 */
export function NumberField({ id, label, value, onChange, onBlur, error, hint, required, disabled, readOnly, kind = 'number', scale, allowNegative = false, demo }) {
  const k = NUMBER_KINDS[kind] ?? NUMBER_KINDS.number;
  const places = scale ?? k.scale;
  const [typed, setTyped] = useState(null); // what is being typed; the formatted value otherwise (no swap on focus, so select-all works)
  const parsed = parseNumberInput(value, { scale: places, allowNegative, max: k.max ?? null });
  const shown = typed ?? (parsed.ok && parsed.value !== '' ? formatNumberInput(parsed.value, { scale: places, trim: kind === 'percent' }) : (value ?? ''));
  const text = parsed.ok && parsed.value !== '' ? `${k.prefix ?? ''}${formatNumberInput(parsed.value, { scale: places, trim: kind === 'percent' })}${k.suffix ?? ''}` : value;
  return (
    <FieldShell id={id} label={label} required={required} hint={hint} error={error} readOnly={readOnly} text={text}>
      {(aria) => (
        <span className={`ff-affix${disabled ? ' is-disabled' : ''}`}>
          {k.prefix && <span className="ff-prefix" aria-hidden="true">{k.prefix}</span>}
          <input id={id} name={id} className={`ff-input ff-num${demoClass(demo)}`} inputMode="decimal" value={shown} disabled={disabled} required={required} {...aria}
            onChange={(e) => { setTyped(e.target.value); onChange(e.target.value); }}
            onBlur={(e) => { setTyped(null); const r = parseNumberInput(e.target.value, { scale: places, allowNegative, max: k.max ?? null }); if (r.ok && r.value !== e.target.value) onChange(r.value); onBlur?.(e); }} />
          {k.suffix && <span className="ff-suffix" aria-hidden="true">{k.suffix}</span>}
        </span>
      )}
    </FieldShell>
  );
}

export function SelectField({ id, label, value, onChange, onBlur, error, hint, required, disabled, readOnly, options, placeholder = 'Choose...', demo }) {
  const text = options.find(([v]) => String(v) === String(value))?.[1] ?? '';
  return (
    <FieldShell id={id} label={label} required={required} hint={hint} error={error} readOnly={readOnly} text={text}>
      {(aria) => (
        <select id={id} name={id} className={`ff-input${demoClass(demo)}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} required={required} disabled={disabled} {...aria}>
          <option value="">{placeholder}</option>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      )}
    </FieldShell>
  );
}

/** Several choices from a short list: checkboxes, with select all / none. The value is an array. */
export function MultiSelectField({ id, label, value = [], onChange, error, hint, required, disabled, readOnly, options, demo }) {
  const chosen = new Set((value ?? []).map(String));
  const toggle = (v) => onChange(chosen.has(String(v)) ? value.filter((x) => String(x) !== String(v)) : [...value, v]);
  const text = options.filter(([v]) => chosen.has(String(v))).map(([, l]) => l).join(', ');
  return (
    <FieldShell id={id} label={label} required={required} hint={hint ?? `${chosen.size} of ${options.length} chosen`} error={error} readOnly={readOnly} text={text} group>
      {(aria) => (
        <div className={`ff-multi${demoClass(demo)}`} id={id} role="group" {...aria}>
          <div className="ff-multi-actions">
            <button type="button" className="btn btn-small" disabled={disabled} onClick={() => onChange(options.map(([v]) => v))}>Select all</button>
            <button type="button" className="btn btn-small" disabled={disabled} onClick={() => onChange([])}>Clear</button>
          </div>
          {options.map(([v, l]) => (
            <label key={v} className="ff-check"><input type="checkbox" checked={chosen.has(String(v))} disabled={disabled} onChange={() => toggle(v)} /> {l}</label>
          ))}
        </div>
      )}
    </FieldShell>
  );
}

export function CheckboxField({ id, label, value, onChange, onBlur, error, hint, disabled, readOnly, demo }) {
  if (readOnly) return <FieldShell id={id} label={label} readOnly text={value ? 'Yes' : 'No'} />;
  return (
    <div className={`ff ${error ? 'ff-invalid' : ''}`} data-field={id}>
      <label className="ff-check" htmlFor={id}>
        <input id={id} name={id} type="checkbox" className={demoClass(demo).trim()} checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} onBlur={onBlur} disabled={disabled} aria-invalid={error ? true : undefined} aria-describedby={hint ? `${id}-hint` : undefined} />
        {label}
      </label>
      {hint && <span className="ff-hint" id={`${id}-hint`}>{hint}</span>}
      {error && <span className="ff-error" role="alert">{error}</span>}
    </div>
  );
}

export function RadioGroupField({ id, label, value, onChange, onBlur, error, hint, required, disabled, readOnly, options, demo }) {
  const text = options.find(([v]) => String(v) === String(value))?.[1] ?? '';
  return (
    <FieldShell id={id} label={label} required={required} hint={hint} error={error} readOnly={readOnly} text={text} group>
      {(aria) => (
        <div className={`ff-radios${demoClass(demo)}`} role="radiogroup" id={id} aria-labelledby={`${id}-label`} {...aria}>
          {options.map(([v, l]) => (
            <label key={v} className="ff-check"><input type="radio" name={id} value={v} checked={String(value) === String(v)} disabled={disabled} onChange={() => onChange(v)} onBlur={onBlur} /> {l}</label>
          ))}
        </div>
      )}
    </FieldShell>
  );
}

/** An on/off setting that takes effect in the form at once (role="switch"). */
export function SwitchField({ id, label, value, onChange, onBlur, error, hint, disabled, readOnly, demo }) {
  if (readOnly) return <FieldShell id={id} label={label} readOnly text={value ? 'On' : 'Off'} />;
  return (
    <div className={`ff ff-switch ${error ? 'ff-invalid' : ''}`} data-field={id}>
      <span className="ff-label" id={`${id}-label`}>{label}</span>
      <button id={id} type="button" role="switch" aria-checked={Boolean(value)} aria-labelledby={`${id}-label`} className={`switch ${value ? 'switch-on' : ''}${demoClass(demo)}`} disabled={disabled} onClick={() => onChange(!value)} onBlur={onBlur}>
        {value ? 'On' : 'Off'}
      </button>
      {hint && <span className="ff-hint">{hint}</span>}
      {error && <span className="ff-error" role="alert">{error}</span>}
    </div>
  );
}

export function TimeField({ id, label, value, onChange, onBlur, error, hint, required, disabled, readOnly, demo }) {
  return (
    <FieldShell id={id} label={label} required={required} hint={hint ?? '24-hour time, for example 07:30'} error={error} readOnly={readOnly} text={value}>
      {(aria) => <input id={id} name={id} type="time" className={`ff-input${demoClass(demo)}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} required={required} disabled={disabled} {...aria} />}
    </FieldShell>
  );
}

/**
 * Restricted rich text: bold, headings and lists only, kept as the same small Markdown the application renders everywhere (no HTML is
 * stored, so nothing can be injected). Write and Preview tabs.
 */
export function RichTextField({ id, label, value, onChange, onBlur, error, hint, required, disabled, readOnly, maxLength = 2000, demo }) {
  const [preview, setPreview] = useState(false);
  const area = useRef(null);
  const wrap = (before, after = before) => {
    const el = area.current;
    if (!el) return;
    const v = value ?? '';
    const [s, e] = [el.selectionStart, el.selectionEnd];
    const next = `${v.slice(0, s)}${before}${v.slice(s, e) || 'text'}${after}${v.slice(e)}`;
    onChange(next.slice(0, maxLength));
    requestAnimationFrame(() => el.focus());
  };
  const linePrefix = (prefix) => {
    const el = area.current;
    const v = value ?? '';
    const s = el ? v.lastIndexOf('\n', el.selectionStart - 1) + 1 : 0;
    onChange(`${v.slice(0, s)}${prefix}${v.slice(s)}`.slice(0, maxLength));
    requestAnimationFrame(() => el?.focus());
  };
  if (readOnly) return <FieldShell id={id} label={label} readOnly text={value ? <Markdown source={value} /> : ''} />;
  return (
    <FieldShell id={id} label={label} required={required} hint={hint ?? `Bold, headings and lists. ${String(value ?? '').length} of ${maxLength} characters`} error={error}>
      {(aria) => (
        <div className={`ff-rich${demoClass(demo)}`}>
          <div className="ff-rich-bar" role="toolbar" aria-label={`Format ${label}`}>
            <button type="button" className="btn btn-small" disabled={disabled || preview} onClick={() => wrap('**')} aria-label="Bold"><strong>B</strong></button>
            <button type="button" className="btn btn-small" disabled={disabled || preview} onClick={() => linePrefix('## ')}>Heading</button>
            <button type="button" className="btn btn-small" disabled={disabled || preview} onClick={() => linePrefix('- ')}>Bullets</button>
            <button type="button" className="btn btn-small" disabled={disabled || preview} onClick={() => linePrefix('1. ')}>Numbered</button>
            <span className="spacer" />
            <button type="button" className="btn btn-small" aria-pressed={preview} disabled={disabled} onClick={() => setPreview(!preview)}>{preview ? 'Write' : 'Preview'}</button>
          </div>
          {preview
            ? <div className="ff-rich-preview" id={id} tabIndex={0}>{value ? <Markdown source={value} /> : <span className="muted">Nothing written yet</span>}</div>
            : <textarea ref={area} id={id} name={id} className="ff-input" rows={4} value={value ?? ''} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} disabled={disabled} required={required} {...aria} />}
        </div>
      )}
    </FieldShell>
  );
}

/** A read-only value as text (BR-03), for values the form fills in itself. */
export function ReadOnlyField({ id, label, text, hint }) {
  const auto = useId();
  return <FieldShell id={id ?? auto} label={label} readOnly text={text} hint={hint} />;
}

export { formatBusinessDate };

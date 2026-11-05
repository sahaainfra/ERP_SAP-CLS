import { useEffect, useRef } from 'react';

// The rich text field of the policy editor (part 05.05, FR-02): bold, italic, underline, headings, lists, links. It edits HTML; the server cleans it again before it is stored (an allow-list of tags and safe links), so
// what is shown to readers never depends on this field. The content is set when the field is mounted (give it a key that changes when another version is opened).
const exec = (cmd, value) => document.execCommand(cmd, false, value);
export default function RichText({ id, label, value, onChange, disabled }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.innerHTML = value ?? ''; }, []);
  const tool = (cmd, arg) => (e) => { e.preventDefault(); ref.current?.focus(); exec(cmd, arg); onChange(ref.current.innerHTML); };
  const link = (e) => { e.preventDefault(); const url = window.prompt('Address of the link (https://...)'); if (url && /^(https?:\/\/|mailto:)/i.test(url)) { ref.current?.focus(); exec('createLink', url); onChange(ref.current.innerHTML); } };
  return (
    <div className="rt" data-testid="richtext">
      <div className="rt-bar" role="toolbar" aria-label={`Format ${label}`}>
        <button type="button" className="btn btn-small" onMouseDown={tool('bold')} disabled={disabled} aria-label="Bold" data-testid="rt-bold"><strong>B</strong></button>
        <button type="button" className="btn btn-small" onMouseDown={tool('italic')} disabled={disabled} aria-label="Italic"><em>I</em></button>
        <button type="button" className="btn btn-small" onMouseDown={tool('underline')} disabled={disabled} aria-label="Underline"><u>U</u></button>
        <button type="button" className="btn btn-small" onMouseDown={tool('formatBlock', 'h2')} disabled={disabled} aria-label="Heading" data-testid="rt-h2">Heading</button>
        <button type="button" className="btn btn-small" onMouseDown={tool('formatBlock', 'p')} disabled={disabled} aria-label="Paragraph">Text</button>
        <button type="button" className="btn btn-small" onMouseDown={tool('insertUnorderedList')} disabled={disabled} aria-label="Bullet list">• List</button>
        <button type="button" className="btn btn-small" onMouseDown={tool('insertOrderedList')} disabled={disabled} aria-label="Numbered list">1. List</button>
        <button type="button" className="btn btn-small" onMouseDown={link} disabled={disabled} aria-label="Link">Link</button>
      </div>
      <div ref={ref} id={id} className="rt-body" contentEditable={!disabled} suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label} tabIndex={0} onInput={() => onChange(ref.current.innerHTML)} data-testid="rt-body" />
    </div>
  );
}

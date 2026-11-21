import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authHeaders } from '../../../platform/api/index.js';
import { browserTransport, uploadFile } from '../../../platform/files/upload.js';
import { formatDateTime } from '../../../platform/format.js';
import { queryKeys } from '../../../platform/query/keys.js';
import { fetchFileUrl, useDeleteFile, useFiles } from '../api/index.js';
import { FormDialog, errorInfo } from '../pages/ui.jsx';

const transport = browserTransport(authHeaders);
const STATUS = { PENDING: ['Scanning...', 'chip-status-soft-closed'], CLEAN: ['Clean', 'chip-on'], INFECTED: ['Quarantined', 'chip-status-closed'], ERROR: ['Scan failed', 'chip-status-closed'] };
const size = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);

/**
 * Upload component (FR-08): drag and drop, file picker, camera capture on phones, progress, retry and cancel per file.
 * Each file is checked by the server (type, content, size, duplicates, virus scan); this component only shows the result.
 * Props: entity, entityId (the record), disabled, supersedes (a file to replace with a new version), onDone.
 */
export function FileUploader({ entity, entityId, disabled = false, supersedes = null, stripExif = false, onDone = () => {} }) {
  const qc = useQueryClient();
  const [items, setItems] = useState([]);
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const camera = useRef(null);
  const controllers = useRef(new Map());
  const seq = useRef(0);

  const patch = useCallback((id, change) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...change } : i))), []);

  const run = useCallback(
    async (item) => {
      const ctl = new AbortController();
      controllers.current.set(item.id, ctl);
      patch(item.id, { state: 'uploading', progress: item.progress ?? 0, error: null });
      try {
        const out = await uploadFile(item.file, {
          transport,
          entity,
          entityId,
          supersedesId: supersedes?.id,
          stripExif,
          resumeFrom: item.uploadId ?? null,
          signal: ctl.signal,
          onProgress: (f) => patch(item.id, { progress: f }),
          onSession: (uploadId) => patch(item.id, { uploadId }),
        });
        patch(item.id, { state: 'done', progress: 1, result: out });
        qc.invalidateQueries({ queryKey: queryKeys.core.files.all });
        onDone(out);
      } catch (err) {
        if (err.code === 'CANCELLED') patch(item.id, { state: 'cancelled' });
        else patch(item.id, { state: 'failed', error: err.message, correlationId: err.correlationId, uploadId: err.uploadId ?? item.uploadId ?? null });
      } finally {
        controllers.current.delete(item.id);
      }
    },
    [entity, entityId, supersedes, stripExif, patch, qc, onDone],
  );

  const add = (fileList) => {
    const files = [...fileList];
    const created = files.map((file) => ({ id: (seq.current += 1), file, state: 'queued', progress: 0, error: null, uploadId: null }));
    setItems((list) => [...list, ...created]);
    created.forEach(run);
  };

  useEffect(() => () => controllers.current.forEach((c) => c.abort()), []);

  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    if (!disabled && e.dataTransfer?.files?.length) add(e.dataTransfer.files);
  };

  return (
    <div className="uploader">
      <div
        className={`dropzone ${over ? 'dropzone-over' : ''} ${disabled ? 'dropzone-disabled' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        data-testid="dropzone"
      >
        <p>{supersedes ? `Drop the new version of ${supersedes.name} here` : 'Drag files here'}, or</p>
        <div className="actions">
          <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => input.current?.click()}>Choose files</button>
          <button type="button" className="btn" disabled={disabled} onClick={() => camera.current?.click()}>Take photo</button>
        </div>
        <input ref={input} type="file" multiple={!supersedes} className="sr-only" aria-label="Choose files to attach" data-testid="file-input" onChange={(e) => { add(e.target.files); e.target.value = ''; }} disabled={disabled} />
        <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo to attach" data-testid="camera-input" onChange={(e) => { add(e.target.files); e.target.value = ''; }} disabled={disabled} />
        <p className="muted small">Documents, drawings, photos and videos. Every file is checked and scanned for viruses before it can be opened.</p>
      </div>
      {items.length > 0 && (
        <ul className="plain upload-list" aria-label="Uploads">
          {items.map((i) => (
            <li key={i.id} data-testid={`upload-${i.file.name}`}>
              <div><strong>{i.file.name}</strong> <span className="muted small">{size(i.file.size)}</span></div>
              {['uploading', 'queued'].includes(i.state) && (
                <div>
                  <progress max="100" value={Math.round(i.progress * 100)} aria-label={`Uploading ${i.file.name}`} /> <span className="small">{Math.round(i.progress * 100)}%</span>{' '}
                  <button type="button" className="link" onClick={() => controllers.current.get(i.id)?.abort()}>Cancel</button>
                </div>
              )}
              {i.state === 'done' && <div className="small" role="status">Uploaded. It is being scanned and will be available in a moment.</div>}
              {i.state === 'cancelled' && <div className="muted small">Cancelled. <button type="button" className="link" onClick={() => run(i)}>Start again</button></div>}
              {i.state === 'failed' && (
                <div className="field-error" role="alert">
                  {i.error}{i.correlationId && <> (Correlation ID: <code>{i.correlationId}</code>)</>}{' '}
                  <button type="button" className="link" onClick={() => run(i)}>Retry</button>{' '}
                  <button type="button" className="link" onClick={() => setItems((list) => list.filter((x) => x.id !== i.id))}>Dismiss</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Thumb({ file }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let live = true;
    if (file.hasThumbnail && file.scanStatus === 'CLEAN') fetchFileUrl(file.id, { variant: 'thumbnail' }).then((l) => live && setUrl(l.url)).catch(() => {});
    return () => { live = false; };
  }, [file.id, file.hasThumbnail, file.scanStatus]);
  return url ? <img src={url} alt={`Preview of ${file.name}`} className="thumb" width="64" height="64" /> : <span className="thumb thumb-empty" aria-hidden="true">{file.extension}</span>;
}

/** The files attached to a record: preview, open, download, replace with a new version, remove (unless the record is approved). */
export function AttachmentList({ entity, entityId, canEdit = false, onReplace = () => {}, renderActions = null }) {
  const files = useFiles({ entity, entityId });
  const remove = useDeleteFile();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(null);
  const [target, setTarget] = useState(null);
  const [error, setError] = useState(null);
  const dialog = useRef(null);

  const open = async (f, download) => {
    setMessage('');
    setBusy(f.id);
    // A window opened after an await is treated as a pop-up and blocked, so open it now and point it at the link later.
    const win = download ? null : window.open('', '_blank');
    try {
      const link = await fetchFileUrl(f.id, { download });
      if (win) {
        win.opener = null;
        win.location.href = link.url;
      } else {
        Object.assign(document.createElement('a'), { href: link.url, download: f.name }).click();
      }
    } catch (err) {
      win?.close();
      setMessage(err.message);
    } finally {
      setBusy(null);
    }
  };
  const askRemove = (f) => {
    setTarget(f);
    setError(null);
    dialog.current?.showModal();
  };
  const submitRemove = async (form) => {
    setError(null);
    try {
      await remove.mutateAsync({ id: target.id, reason: String(form.get('reason')) });
      dialog.current?.close();
      setMessage(`${target.name} was removed.`);
    } catch (err) {
      setError(errorInfo(err));
    }
  };

  if (files.isPending) return <div className="skeleton" aria-busy="true" aria-label="Loading attachments"><div className="skeleton-row" /></div>;
  if (files.isError) {
    return (
      <div className="state state-error" role="alert">
        <p>{files.error.status === 403 ? 'You may not view the files of this record.' : `Could not load the attachments: ${files.error.message}`}</p>
        {files.error.correlationId && <p className="muted small">Correlation ID: <code>{files.error.correlationId}</code></p>}
        <button type="button" className="btn" onClick={() => files.refetch()}>Try again</button>
      </div>
    );
  }
  return (
    <div>
      <p role="status" className="notice">{message}</p>
      {files.data.length === 0 && <div className="state"><h3>No attachments yet</h3><p>Drag a file into the box above, or use Choose files or Take photo.</p></div>}
      {files.data.length > 0 && (
        <ul className="plain attachment-list" aria-label="Attachments">
          {files.data.map((f) => {
            const [label, chip] = STATUS[f.scanStatus];
            return (
              <li key={f.id} className="attachment" data-testid={`file-${f.name}`}>
                <Thumb file={f} />
                <div className="attachment-body">
                  <strong>{f.name}</strong> {f.versionNo > 1 && <span className="chip chip-off">v{f.versionNo}</span>} {!f.current && <span className="muted small">(replaced)</span>}
                  <div className="muted small">{size(f.sizeBytes)} - {f.uploadedBy}, {formatDateTime(f.uploadedAt)}{f.exif?.capturedAt ? ` - taken ${f.exif.capturedAt.replace('T', ' ')}` : ''}{f.exif?.gps ? ` at ${f.exif.gps.lat}, ${f.exif.gps.lon}` : ''}</div>
                  <span className={`chip ${chip}`} data-testid={`scan-${f.name}`}>{label}</span>
                  {f.scanStatus === 'INFECTED' && <span className="field-error small"> This file failed the virus scan and cannot be opened.</span>}
                </div>
                <div className="attachment-actions">
                  {renderActions?.(f, files.refetch)}
                  <button type="button" className="link" disabled={f.scanStatus !== 'CLEAN' || busy === f.id} onClick={() => open(f, false)} aria-label={`Open ${f.name}`}>Open</button>
                  <button type="button" className="link" disabled={f.scanStatus !== 'CLEAN' || busy === f.id} onClick={() => open(f, true)} aria-label={`Download ${f.name}`}>Download</button>
                  {canEdit && f.current && <button type="button" className="link" onClick={() => onReplace(f)} aria-label={`Replace ${f.name} with a new version`}>New version</button>}
                  {canEdit && <button type="button" className="link" disabled={f.locked} title={f.locked ? 'The record is approved: upload a new version instead' : ''} onClick={() => askRemove(f)} aria-label={`Remove ${f.name}`}>Remove</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <FormDialog dialogRef={dialog} title={target ? `Remove ${target.name}` : ''} error={error} busy={remove.isPending} submitLabel="Remove file" onSubmit={submitRemove}>
        <p>The file is hidden from the record and kept for audit. This is written to the audit trail.</p>
      </FormDialog>
    </div>
  );
}

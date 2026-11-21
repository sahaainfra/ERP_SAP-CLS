import { useEffect, useState } from 'react';
import { useSupplierLocale } from './SupplierLocale.js';

async function uploadRequest(auth, path, options) {
  const response = await fetch(`/api/v1/portal/supplier/uploads${path}`, {
    ...options, cache: 'no-store', headers: { Authorization: auth },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message ?? 'The document could not be uploaded.');
  return result.data;
}

async function photoPdf(file) {
  const photo = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(photo.width, photo.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(photo.width * scale));
  canvas.height = Math.max(1, Math.round(photo.height * scale));
  try { canvas.getContext('2d').drawImage(photo, 0, 0, canvas.width, canvas.height); } finally { photo.close(); }
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!jpeg) throw new Error('The photo could not be prepared.');
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const image = await pdf.embedJpg(await jpeg.arrayBuffer());
  const page = pdf.addPage([canvas.width, canvas.height]);
  page.drawImage(image, { x: 0, y: 0, width: canvas.width, height: canvas.height });
  return new File([await pdf.save()], 'invoice-photo.pdf', { type: 'application/pdf' });
}

export default function SupplierUpload({ auth, label, accept, onChange }) {
  const { t } = useSupplierLocale();
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (file?.scanStatus !== 'PENDING' || busy) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      uploadRequest(auth, `/${file.id}`, { signal: controller.signal }).then((fresh) => {
        if (controller.signal.aborted) return;
        setFile(fresh);
        if (fresh.scanStatus === 'CLEAN') onChange(fresh.id);
      }).catch(() => {});
    }, 1800);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [auth, busy, file, onChange]);

  async function run(action) {
    setBusy(true);
    setError(null);
    onChange(0);
    try {
      const result = await action();
      setFile(result);
      if (result.scanStatus === 'CLEAN') onChange(result.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function upload(event, camera = false) {
    const selected = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!selected) return;
    void run(async () => {
      const body = new FormData();
      body.append('file', camera && accept ? await photoPdf(selected) : selected);
      return uploadRequest(auth, '', { method: 'POST', body });
    });
  }

  async function discard() {
    setBusy(true);
    setError(null);
    try {
      if (file?.id) await uploadRequest(auth, `/${file.id}`, { method: 'DELETE' });
      setFile(null);
      onChange(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <label>{t(label)}<input type="file" accept={accept} onChange={(event) => upload(event)} disabled={busy || Boolean(file)} /></label>
    <label>{t("Take a photo")}<input type="file" accept="image/*" capture="environment"
      onChange={(event) => upload(event, true)} disabled={busy || Boolean(file)} /></label>
    {busy && <p role="status">{t("Checking the document…")}</p>}
    {error && <p role="alert">{error}</p>}
    {(file || error) && <button type="button" className="btn" disabled={busy} onClick={discard}>{t("Clear selection")}</button>}
    {file && <>
      <p role="status">{file.name} · {t({ CLEAN: 'Ready to submit', PENDING: 'Scan pending', INFECTED: 'Scan failed', ERROR: 'Scan could not finish' }[file.scanStatus])}</p>
      {file.scanStatus === 'PENDING' && <button type="button" className="btn" disabled={busy}
        onClick={() => void run(() => uploadRequest(auth, `/${file.id}`))}>{t("Check scan status")}</button>}
    </>}
  </div>;
}

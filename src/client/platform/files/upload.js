// Uploading a file (FR-02, FR-08). Small files go in one multipart request with progress; large ones (drawings, videos)
// use the resumable protocol: start a session, send chunks at known offsets, and after a dropped connection ask the
// server where it stopped and continue from there. Pure functions over an injected `transport`, so Node tests drive
// the same code the browser runs.

export const SMALL_FILE_BYTES = 5 * 1024 * 1024;

export class UploadError extends Error {
  constructor(message, { status = 0, code = null, details = [], correlationId = null, uploadId = null } = {}) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.correlationId = correlationId;
    this.uploadId = uploadId; // lets the caller resume the same session
  }
}

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const asError = (res, uploadId = null) => {
  const e = res.json?.error;
  return new UploadError(e?.message ?? `The server answered ${res.status}.`, { status: res.status, code: e?.code ?? null, details: e?.details ?? [], correlationId: e?.correlationId ?? null, uploadId });
};

/**
 * The browser transport: `send(method, url, { body, headers, onProgress })` resolves to { status, json } for any HTTP answer
 * and rejects only when the network fails. XMLHttpRequest is used because fetch cannot report upload progress.
 */
export function browserTransport(getHeaders) {
  return (method, url, { body, headers = {}, onProgress } = {}) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url);
      for (const [k, v] of Object.entries({ ...getHeaders(), ...headers })) xhr.setRequestHeader(k, v);
      if (onProgress && xhr.upload) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded, e.total);
      xhr.onload = () => {
        let json;
        try {
          json = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          json = null; // not JSON (a proxy error page): there is no error envelope to read
        }
        resolve({ status: xhr.status, json });
      };
      xhr.onerror = () => reject(new Error('The network connection failed.'));
      xhr.ontimeout = () => reject(new Error('The network connection timed out.'));
      xhr.onabort = () => reject(new Error('The upload was cancelled.'));
      xhr.send(body ?? null);
    });
}

const jsonHeaders = () => ({ 'content-type': 'application/json', 'idempotency-key': globalThis.crypto.randomUUID() });

/**
 * Upload one file to a record. Resolves to the stored file's metadata. Options:
 *   entity, entityId, supersedesId, stripExif     what the file belongs to
 *   onProgress(fraction)                          0..1
 *   onSession(uploadId)                           called once a resumable session exists (so Retry can resume it)
 *   resumeFrom                                    an uploadId from an earlier attempt of the same file
 *   retries, backoffMs, sleep, signal             retry policy for dropped connections
 */
export async function uploadFile(file, { transport, entity, entityId, supersedesId, stripExif = false, onProgress = () => {}, onSession = () => {}, resumeFrom = null, retries = 3, backoffMs = 500, sleep = sleepFor, signal = null }) {
  const check = () => {
    if (signal?.aborted) throw new UploadError('The upload was cancelled.', { code: 'CANCELLED' });
  };
  check();

  if (file.size <= SMALL_FILE_BYTES && !resumeFrom) {
    const fd = new FormData();
    fd.append('entity', entity);
    fd.append('entityId', String(entityId));
    if (supersedesId) fd.append('supersedesId', String(supersedesId));
    if (stripExif) fd.append('stripExif', 'true');
    fd.append('file', file, file.name);
    let res;
    try {
      res = await transport('POST', '/api/v1/core/files', { body: fd, onProgress: (loaded, total) => onProgress(total ? loaded / total : 0) });
    } catch (err) {
      throw new UploadError(err.message);
    }
    if (res.status !== 201) throw asError(res);
    onProgress(1);
    return res.json.data;
  }

  let session;
  if (resumeFrom) {
    const res = await transport('GET', `/api/v1/core/files/uploads/${resumeFrom}`);
    if (res.status !== 200) throw asError(res, resumeFrom);
    session = res.json.data;
  } else {
    const res = await transport('POST', '/api/v1/core/files/uploads', { headers: jsonHeaders(), body: JSON.stringify({ fileName: file.name, size: file.size, entity, entityId, supersedesId, stripExif }) });
    if (res.status !== 201) throw asError(res);
    session = res.json.data;
  }
  onSession(session.uploadId);
  let offset = session.received;
  let failures = 0;
  const path = `/api/v1/core/files/uploads/${session.uploadId}`;
  onProgress(offset / file.size);

  while (offset < file.size) {
    check();
    const chunk = file.slice(offset, offset + session.chunkSize);
    let res;
    try {
      res = await transport('PUT', `${path}?offset=${offset}`, { body: chunk, headers: { 'content-type': 'application/octet-stream' }, onProgress: (loaded) => onProgress((offset + loaded) / file.size) });
    } catch {
      res = null; // the connection dropped: ask the server where it stopped
    }
    if (res && res.status === 200) {
      offset = res.json.data.received;
      failures = 0;
      onProgress(offset / file.size);
      continue;
    }
    const retryable = res === null || res.status === 409 || res.status >= 500;
    if (!retryable) throw asError(res, session.uploadId);
    failures += 1;
    if (failures > retries) throw res ? asError(res, session.uploadId) : new UploadError('The connection kept failing. Check the network and press Retry; the upload will continue where it stopped.', { uploadId: session.uploadId });
    await sleep(backoffMs * 2 ** (failures - 1));
    try {
      const where = await transport('GET', path);
      if (where.status === 200) offset = where.json.data.received;
    } catch {
      /* still offline: the next loop sends from the same offset and fails again, counting towards the retries */
    }
  }

  const done = await transport('POST', `${path}/complete`, { headers: jsonHeaders(), body: '{}' }).catch((err) => {
    throw new UploadError(err.message, { uploadId: session.uploadId });
  });
  if (done.status !== 201) throw asError(done, session.uploadId);
  onProgress(1);
  return done.json.data;
}

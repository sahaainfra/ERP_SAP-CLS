import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SMALL_FILE_BYTES, UploadError, uploadFile } from '../src/client/platform/files/upload.js';

const MB = 1024 * 1024;
const fileOf = (size, name = 'drawing.pdf') => new File([new Uint8Array(size)], name);

/** A fake server that remembers the bytes of each upload session; `failAt` drops the connection on given chunk numbers. */
function fakeServer({ failChunks = [], chunkSize = 4 * MB, fail409Once = false } = {}) {
  const state = { received: 0, chunks: 0, log: [], completed: 0, began: 0 };
  let mismatch = fail409Once;
  const transport = async (method, url, { body, onProgress } = {}) => {
    state.log.push(`${method} ${url.replace('/api/v1/core/files', '')}`);
    if (method === 'POST' && url === '/api/v1/core/files') {
      onProgress?.(body.get('file').size, body.get('file').size);
      return { status: 201, json: { data: { id: 1, name: body.get('file').name, via: 'multipart', fields: [...body.keys()] } } };
    }
    if (method === 'POST' && url.endsWith('/uploads')) {
      state.began += 1;
      return { status: 201, json: { data: { uploadId: 'u-1', received: 0, chunkSize } } };
    }
    if (method === 'GET') return { status: 200, json: { data: { uploadId: 'u-1', received: state.received, chunkSize } } };
    if (method === 'PUT') {
      state.chunks += 1;
      if (failChunks.includes(state.chunks)) {
        state.received += Math.floor(body.size / 3); // some bytes arrived, then the connection died
        state.received -= Math.floor(body.size / 3); // the server counts a half chunk for nothing
        throw new Error('network down');
      }
      if (mismatch) {
        mismatch = false;
        return { status: 409, json: { error: { code: 'VERSION_CONFLICT', message: 'Resume from 0' } } };
      }
      state.received += body.size;
      onProgress?.(body.size, body.size);
      return { status: 200, json: { data: { uploadId: 'u-1', received: state.received } } };
    }
    if (method === 'POST' && url.endsWith('/complete')) {
      state.completed += 1;
      return { status: 201, json: { data: { id: 2, via: 'resumable', size: state.received } } };
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { transport, state };
}

const base = { entity: 'sample_document', entityId: 5, sleep: async () => {} };

test('FR-02 a small file goes in one multipart request with its fields and progress', async () => {
  const { transport, state } = fakeServer();
  const progress = [];
  const out = await uploadFile(fileOf(1000, 'photo.jpg'), { ...base, transport, supersedesId: 9, stripExif: true, onProgress: (f) => progress.push(f) });
  assert.deepEqual([out.via, out.name], ['multipart', 'photo.jpg']);
  assert.deepEqual(out.fields, ['entity', 'entityId', 'supersedesId', 'stripExif', 'file']);
  assert.equal(progress.at(-1), 1);
  assert.equal(state.began, 0);
});

test('FR-02 a large file is sent in chunks and completed once', async () => {
  const { transport, state } = fakeServer();
  const progress = [];
  const out = await uploadFile(fileOf(SMALL_FILE_BYTES + 6 * MB), { ...base, transport, onProgress: (f) => progress.push(f) });
  assert.deepEqual([out.via, out.size, state.chunks, state.completed], ['resumable', SMALL_FILE_BYTES + 6 * MB, 3, 1]);
  assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]), 'progress never goes backwards');
  assert.equal(progress.at(-1), 1);
});

test('T-04 after a dropped connection the upload asks where the server stopped and continues from there', async () => {
  const { transport, state } = fakeServer({ failChunks: [2] });
  const out = await uploadFile(fileOf(SMALL_FILE_BYTES + 6 * MB), { ...base, transport });
  assert.equal(out.size, SMALL_FILE_BYTES + 6 * MB, 'every byte arrived once');
  assert.equal(state.began, 1, 'one session, not a restart');
  assert.ok(state.log.some((l) => l.startsWith('GET /uploads/u-1')), 'it asked for the offset');
  assert.equal(state.chunks, 4, 'the failed chunk was sent again');
});

test('an offset mismatch (409) is answered by asking the server where to resume', async () => {
  const { transport } = fakeServer({ fail409Once: true });
  const out = await uploadFile(fileOf(SMALL_FILE_BYTES + 1), { ...base, transport });
  assert.equal(out.via, 'resumable');
});

test('FR-08 retry resumes the same session after the retries ran out', async () => {
  const { transport, state } = fakeServer({ failChunks: [1, 2, 3, 4] });
  let session = null;
  const file = fileOf(SMALL_FILE_BYTES + 6 * MB);
  await assert.rejects(() => uploadFile(file, { ...base, transport, retries: 3, onSession: (id) => (session = id) }), (err) => {
    assert.ok(err instanceof UploadError);
    assert.equal(err.uploadId, 'u-1');
    assert.match(err.message, /press Retry/);
    return true;
  });
  assert.equal(session, 'u-1');
  const out = await uploadFile(file, { ...base, transport, resumeFrom: 'u-1' });
  assert.equal(out.via, 'resumable');
  assert.equal(state.began, 1, 'the retry did not start a new session');
});

test('server refusals are surfaced with their code, message and correlation ID and are not retried', async () => {
  const transport = async () => ({ status: 422, json: { error: { code: 'FILE_REJECTED', message: 'Files of type .exe are not allowed.', details: [{ field: 'file', message: 'x' }], correlationId: 'c-1' } } });
  await assert.rejects(() => uploadFile(fileOf(100, 'a.exe'), { ...base, transport }), (err) => err.code === 'FILE_REJECTED' && err.status === 422 && err.correlationId === 'c-1' && /not allowed/.test(err.message));
  const down = async () => { throw new Error('offline'); };
  await assert.rejects(() => uploadFile(fileOf(100), { ...base, transport: down }), /offline/);
});

test('cancelling stops the upload', async () => {
  const { transport } = fakeServer();
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(() => uploadFile(fileOf(100), { ...base, transport, signal: ctl.signal }), (err) => err.code === 'CANCELLED');
});

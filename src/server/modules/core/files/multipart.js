import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Busboy from 'busboy';
import { HttpError, badRequest } from '../../../platform/http/errors.js';

/**
 * Read one multipart/form-data request: the text fields and exactly one file, streamed to a temporary file (the file is
 * never held in memory). Resolves to { fields, file: { path, name } }. Fields should come before the file.
 */
export function receiveMultipart(req, { tmpRoot, maxBytes }) {
  return new Promise((resolve, reject) => {
    if (!/^multipart\/form-data/i.test(req.get('content-type') ?? '')) return reject(badRequest('Send the file as multipart/form-data with a "file" part.'));
    let bb;
    try {
      bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: maxBytes, fields: 20, fieldSize: 10_000 } });
    } catch (err) {
      return reject(badRequest(`The upload could not be read: ${err.message}`));
    }
    const fields = {};
    let file = null;
    let tooBig = false;
    let writing = null;
    let failed = false;
    const fail = async (err) => {
      if (failed) return;
      failed = true;
      if (file) await rm(file.path, { force: true });
      reject(err);
    };
    bb.on('field', (name, value) => {
      fields[name] = value;
    });
    bb.on('file', (name, stream, info) => {
      if (name !== 'file' || file) {
        stream.resume();
        return;
      }
      file = { path: join(tmpRoot, randomUUID()), name: info.filename };
      writing = mkdir(tmpRoot, { recursive: true }).then(
        () =>
          new Promise((done, bad) => {
            const out = createWriteStream(file.path);
            stream.on('limit', () => {
              tooBig = true;
            });
            stream.pipe(out);
            out.on('finish', done);
            out.on('error', bad);
            stream.on('error', bad);
          }),
      );
    });
    bb.on('error', (err) => fail(badRequest(`The upload could not be read: ${err.message}`)));
    bb.on('close', async () => {
      try {
        await writing;
      } catch (err) {
        return fail(err);
      }
      if (!file) return fail(badRequest('The request has no "file" part.'));
      if (tooBig) return fail(new HttpError(413, 'PAYLOAD_TOO_LARGE', `The file is larger than ${Math.round(maxBytes / 1048576)} MB, the largest limit for any file type.`));
      if (!failed) resolve({ fields, file });
    });
    req.on('aborted', () => fail(badRequest('The upload was interrupted.')));
    req.pipe(bb);
  });
}

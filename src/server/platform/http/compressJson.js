import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib';
import { pickEncoding } from './staticAssets.js';

// JSON answers of the API compressed for a browser that accepts it (part 166.4, P-05): the menu of a person is about 180 KB of JSON, about 15 KB
// compressed. Only res.json answers above a threshold; files, exports and streams are sent as they are. Brotli at a low level (fast, still about
// gzip's size), else gzip. Node's zlib: no new dependency. The answer is the same JSON once the browser has decoded it.
const THRESHOLD = 1400; // under one network packet there is nothing to gain

export function compressJson({ threshold = THRESHOLD } = {}) {
  return (req, res, next) => {
    const enc = pickEncoding(req.headers['accept-encoding']);
    if (!enc) return next();
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.getHeader('Content-Encoding')) return json(body);
      const text = JSON.stringify(body);
      if (text === undefined || Buffer.byteLength(text) < threshold) return json(body);
      const packed = enc === 'br' ? brotliCompressSync(text, { params: { [zlib.BROTLI_PARAM_QUALITY]: 4, [zlib.BROTLI_PARAM_MODE]: zlib.BROTLI_MODE_TEXT } }) : gzipSync(text, { level: 6 });
      res.vary('Accept-Encoding');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Encoding', enc);
      return res.send(packed);
    };
    return next();
  };
}

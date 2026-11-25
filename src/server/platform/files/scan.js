import net from 'node:net';

/** The standard anti-virus test string. Every scanner must flag it; it is harmless. */
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/**
 * A second, harmless test string of our own. A real anti-virus on a developer's machine or file server deletes a file
 * holding the EICAR string the moment it is written, so tests that must put a "virus" on disk use this one instead.
 */
export const TEST_VIRUS = 'ERP-TEST-VIRUS-SIGNATURE-1b6f1c52-DO-NOT-STORE';

/**
 * Scanners (FR-03). A scanner has a name and `scan(openStream)` which resolves to { status: 'CLEAN' | 'INFECTED', detail }
 * or rejects when it cannot decide (the scan job then retries, and the file stays unavailable: BR-01).
 *
 *  - built-in: finds the EICAR test string. It is NOT an anti-virus; it exists so the quarantine path works everywhere.
 *  - clamd:    streams the file to a ClamAV daemon (INSTREAM) and reports its verdict. Use it in any real installation.
 */
export function createBuiltinScanner() {
  const signatures = [
    { needle: Buffer.from(EICAR, 'latin1'), detail: 'Eicar-Test-Signature' },
    { needle: Buffer.from(TEST_VIRUS, 'latin1'), detail: 'ERP-Test-Signature' },
  ];
  const longest = Math.max(...signatures.map((x) => x.needle.length));
  return {
    name: 'builtin',
    async scan(openStream) {
      let tail = Buffer.alloc(0);
      for await (const chunk of openStream()) {
        const window = Buffer.concat([tail, chunk]);
        const hit = signatures.find((x) => window.includes(x.needle));
        if (hit) return { status: 'INFECTED', detail: hit.detail };
        tail = window.subarray(Math.max(0, window.length - longest + 1));
      }
      return { status: 'CLEAN', detail: null };
    },
  };
}

/**
 * Active content in documents (audit AUD-DEF-010). A PDF can carry JavaScript (`/JavaScript`, `/JS`) or an action that starts a program
 * (`/Launch`); a desktop reader may run them when someone downloads the file. Neither the type check (first bytes only) nor an anti-virus
 * flags them, so this scanner always runs beside the others and holds such a PDF in quarantine. The in-app viewer (pdf.js) never runs them.
 */
const PDF_ACTIVE = [/\/JavaScript\b/, /\/JS\s*[(<[\d]/, /\/Launch\b/];
const ACTIVE_DETAIL = 'PDF-Active-Content: the PDF carries JavaScript or a launch action';
/** True when a parsed PDF holds a JavaScript or launch action anywhere, including inside compressed object streams. */
async function pdfHasActiveContent(bytes) {
  const { PDFDocument, PDFDict, PDFName } = await import('pdf-lib');
  let doc;
  try { doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false }); } catch { return null; }
  const JS = PDFName.of('JS'); const JAVASCRIPT = PDFName.of('JavaScript'); const S = PDFName.of('S'); const LAUNCH = PDFName.of('Launch');
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj?.dict instanceof PDFDict ? obj.dict : null;
    if (!dict) continue;
    if (dict.has(JS) || dict.has(JAVASCRIPT)) return true;
    const kind = dict.get(S);
    if (kind === JAVASCRIPT || kind === LAUNCH) return true;
  }
  return false;
}
export function createActiveContentScanner({ maxBytes = 200 * 1024 * 1024 } = {}) {
  return {
    name: 'active-content',
    async scan(openStream) {
      const parts = []; let size = 0; let isPdf = null;
      for await (const chunk of openStream()) {
        const b = Buffer.from(chunk);
        if (isPdf === null) isPdf = b.subarray(0, 5).toString('latin1') === '%PDF-';
        if (!isPdf) return { status: 'CLEAN', detail: null };
        size += b.length; if (size > maxBytes) return { status: 'CLEAN', detail: null };
        parts.push(b);
      }
      if (!isPdf) return { status: 'CLEAN', detail: null };
      const bytes = Buffer.concat(parts);
      const parsed = await pdfHasActiveContent(bytes);
      // a PDF the parser cannot read is searched as text for the same markers
      const found = parsed ?? PDF_ACTIVE.some((re) => re.test(bytes.toString('latin1')));
      return found ? { status: 'INFECTED', detail: ACTIVE_DETAIL } : { status: 'CLEAN', detail: null };
    },
  };
}

/** Parse clamd's reply, for example "stream: OK" or "stream: Win.Test.EICAR_HDB-1 FOUND" or "INSTREAM size limit exceeded. ERROR". */
export function parseClamdReply(text) {
  const reply = text.replace(/\0/g, '').trim();
  if (/ OK$/.test(reply)) return { status: 'CLEAN', detail: null };
  const found = /^stream:\s*(.+) FOUND$/.exec(reply);
  if (found) return { status: 'INFECTED', detail: found[1] };
  throw new Error(`ClamAV could not scan the file: ${reply || 'no reply'}`);
}

export function createClamdScanner({ host, port = 3310, timeoutMs = 30_000 }) {
  return {
    name: 'clamd',
    scan: (openStream) =>
      new Promise((resolve, reject) => {
        const socket = net.connect({ host, port });
        let reply = '';
        let settled = false;
        const done = (fn, value) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          fn(value);
        };
        socket.setTimeout(timeoutMs, () => done(reject, new Error('ClamAV did not answer in time')));
        socket.on('error', (err) => done(reject, new Error(`ClamAV is not reachable: ${err.message}`)));
        socket.on('data', (d) => {
          reply += d.toString('latin1');
          if (reply.includes('\0') || reply.includes('\n')) {
            try {
              done(resolve, parseClamdReply(reply));
            } catch (err) {
              done(reject, err);
            }
          }
        });
        socket.on('connect', async () => {
          try {
            socket.write('zINSTREAM\0');
            for await (const chunk of openStream()) {
              const size = Buffer.alloc(4);
              size.writeUInt32BE(chunk.length);
              if (!socket.write(Buffer.concat([size, chunk]))) await new Promise((r) => socket.once('drain', r));
            }
            socket.write(Buffer.alloc(4));
          } catch (err) {
            done(reject, err);
          }
        });
      }),
  };
}

/** Run every scanner. The first INFECTED verdict wins; a scanner that cannot decide makes the whole scan fail (so it is retried). */
export async function runScanners(scanners, openStream) {
  const names = [];
  for (const s of scanners) {
    const verdict = await s.scan(openStream);
    names.push(s.name);
    if (verdict.status === 'INFECTED') return { status: 'INFECTED', detail: `${verdict.detail} (${s.name})`, scanners: names };
  }
  return { status: 'CLEAN', detail: null, scanners: names };
}

// What may be stored: each allowed extension, its MIME type, its category (which sets the size limit and the retention
// class) and the leading bytes a real file of that type starts with. The extension alone is never trusted (FR-03).

const hex = (...bytes) => Buffer.from(bytes);
const startsWith = (head, bytes, at = 0) => head.length >= at + bytes.length && head.subarray(at, at + bytes.length).equals(bytes);
const ascii = (head, text, at = 0) => startsWith(head, Buffer.from(text, 'latin1'), at);

/** Plain text: no NUL bytes and almost no control characters in what we can see. */
export function looksLikeText(head) {
  if (head.length === 0) return false;
  let odd = 0;
  for (const b of head) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) odd += 1;
  }
  return odd / head.length < 0.01;
}

const ooxml = (head) => startsWith(head, hex(0x50, 0x4b, 0x03, 0x04)) && (head.includes('[Content_Types].xml') || head.includes('word/') || head.includes('xl/') || head.includes('ppt/'));
const ole = (head) => startsWith(head, hex(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1));
const jpeg = (h) => startsWith(h, hex(0xff, 0xd8, 0xff));

export const FILE_TYPES = Object.freeze({
  jpg: { mime: 'image/jpeg', category: 'image', inline: true, matches: jpeg },
  jpeg: { mime: 'image/jpeg', category: 'image', inline: true, matches: jpeg },
  png: { mime: 'image/png', category: 'image', inline: true, matches: (h) => startsWith(h, hex(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) },
  gif: { mime: 'image/gif', category: 'image', inline: true, matches: (h) => ascii(h, 'GIF87a') || ascii(h, 'GIF89a') },
  webp: { mime: 'image/webp', category: 'image', inline: true, matches: (h) => ascii(h, 'RIFF') && ascii(h, 'WEBP', 8) },
  pdf: { mime: 'application/pdf', category: 'document', inline: true, matches: (h) => ascii(h, '%PDF-') },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', category: 'document', inline: false, matches: ooxml },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', category: 'document', inline: false, matches: ooxml },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', category: 'document', inline: false, matches: ooxml },
  doc: { mime: 'application/msword', category: 'document', inline: false, matches: ole },
  xls: { mime: 'application/vnd.ms-excel', category: 'document', inline: false, matches: ole },
  ppt: { mime: 'application/vnd.ms-powerpoint', category: 'document', inline: false, matches: ole },
  txt: { mime: 'text/plain', category: 'document', inline: false, matches: looksLikeText },
  csv: { mime: 'text/csv', category: 'document', inline: false, matches: looksLikeText },
  dwg: { mime: 'application/acad', category: 'drawing', inline: false, matches: (h) => ascii(h, 'AC10') },
  dxf: { mime: 'application/dxf', category: 'drawing', inline: false, matches: (h) => looksLikeText(h) && /SECTION/.test(h.toString('latin1', 0, 4096)) },
  mp4: { mime: 'video/mp4', category: 'video', inline: true, matches: (h) => ascii(h, 'ftyp', 4) },
  mov: { mime: 'video/quicktime', category: 'video', inline: true, matches: (h) => ascii(h, 'ftyp', 4) || ascii(h, 'moov', 4) || ascii(h, 'wide', 4) || ascii(h, 'mdat', 4) },
  webm: { mime: 'video/webm', category: 'video', inline: true, matches: (h) => startsWith(h, hex(0x1a, 0x45, 0xdf, 0xa3)) },
});

export const CATEGORIES = ['image', 'document', 'drawing', 'video'];
export const RETENTION_CLASSES = ['permanent', 'statutory', 'standard', 'short'];

/** Executables are refused whatever their name says (T-02): Windows PE, Linux ELF, Mach-O, Java class and scripts with a shebang. */
export function looksExecutable(head) {
  if (ascii(head, 'MZ')) {
    const stub = head.includes('This program cannot be run in DOS mode') || head.includes('This program must be run under Win32');
    const lfanew = head.length >= 0x40 ? head.readUInt32LE(0x3c) : 0;
    const pe = lfanew > 0 && lfanew + 4 <= head.length && ascii(head, 'PE\0\0', lfanew);
    if (stub || pe) return 'a Windows program';
  }
  if (startsWith(head, hex(0x7f, 0x45, 0x4c, 0x46))) return 'a Linux program';
  const macho = [hex(0xcf, 0xfa, 0xed, 0xfe), hex(0xce, 0xfa, 0xed, 0xfe), hex(0xfe, 0xed, 0xfa, 0xce), hex(0xfe, 0xed, 0xfa, 0xcf)];
  if (macho.some((m) => startsWith(head, m))) return 'a macOS program';
  if (startsWith(head, hex(0xca, 0xfe, 0xba, 0xbe))) return 'a Java or macOS program';
  if (ascii(head, '#!')) return 'a script';
  return null;
}

export const extensionOf = (name) => {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name ?? '');
  return m ? m[1].toLowerCase() : '';
};

/**
 * Check a file's name and leading bytes against the allow-list. Returns { ok: true, extension, mime, category, inline } or
 * { ok: false, problem }. `allowed` is the company's list of extensions (a subset of FILE_TYPES).
 */
export function checkType(fileName, head, allowed = Object.keys(FILE_TYPES)) {
  const extension = extensionOf(fileName);
  if (!extension) return { ok: false, problem: 'The file name has no extension, so its type cannot be checked.' };
  const type = FILE_TYPES[extension];
  if (!type || !allowed.includes(extension)) return { ok: false, problem: `Files of type .${extension} are not allowed.` };
  const exe = looksExecutable(head);
  if (exe) return { ok: false, problem: `This file is ${exe} renamed to .${extension}. Programs are never accepted.` };
  if (!type.matches(head)) return { ok: false, problem: `The content of this file is not a real .${extension} file.` };
  return { ok: true, extension, mime: type.mime, category: type.category, inline: type.inline };
}

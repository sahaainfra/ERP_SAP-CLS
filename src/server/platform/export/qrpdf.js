// A one-page PDF of lines of text with a QR code drawn as squares at the top right (no image library needed): the e-invoice's signed QR (23.07)
// on the e-invoice page and on the tax invoice's own print (D-732).
/** @param {Array<[string, any]>} lines @param {{ size: number, get: (x: number, y: number) => any }} modules @param {string} title */
export function qrPdf(lines, modules, title) {
  const esc = (s) => String(s).replace(/[^\x20-\x7e]/g, '?').replace(/([()\\])/g, '\\$1');
  const n = modules.size; const cell = Math.min(4, 220 / n); const x0 = 595 - 36 - n * cell; const y0 = 842 - 60;
  let qr = '0 0 0 rg\n'; for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) if (modules.get(x, y)) qr += `${(x0 + x * cell).toFixed(2)} ${(y0 - (y + 1) * cell).toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re f\n`;
  let txt = `BT /F1 14 Tf 36 800 Td (${esc(title)}) Tj ET\n`; lines.forEach(([k, v], i) => { const y = 770 - i * 18; txt += `BT /F1 9 Tf 36 ${y} Td (${esc(k)}) Tj ET\nBT /F1 9 Tf 140 ${y} Td (${esc(String(v).slice(0, 70))}) Tj ET\n`; if (String(v).length > 70) txt += `BT /F1 9 Tf 140 ${y - 9} Td (${esc(String(v).slice(70, 140))}) Tj ET\n`; });
  const stream = `${txt}${qr}`; const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs = []; objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; }); const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`; return Buffer.from(out, 'latin1');
}

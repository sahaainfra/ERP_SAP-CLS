// The server needs Node 24 (node:sqlite, argon2 in node:crypto). On an older Node it would fail later with an unrelated message; this module is the first import of the entry point and stops with a clear one.
export const MIN_NODE_MAJOR = 24;
/** @param {string} version e.g. "22.11.0" @returns {{ ok: boolean, message: string | null }} */
export function checkNode(version = process.versions.node) {
  const major = Number(String(version).split('.')[0]);
  if (Number.isFinite(major) && major >= MIN_NODE_MAJOR) return { ok: true, message: null };
  return { ok: false, message: `This application needs Node ${MIN_NODE_MAJOR} or newer; this is Node ${version}. Install Node ${MIN_NODE_MAJOR} (see .nvmrc, for example "nvm use") and start again.` };
}
const r = checkNode();
if (!r.ok) { console.error(r.message); process.exit(1); }

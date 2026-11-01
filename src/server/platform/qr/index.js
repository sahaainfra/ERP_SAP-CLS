/**
 * The QR and barcode resolver registry (part 03.06). A module registers what its codes look like and how to find the record; the scanner
 * page asks `GET /api/v1/ui/qr/resolve?code=` and is sent to the record. The record's own permission and data scope decide what the
 * person may be sent to, so a code never opens something the person could not open by hand.
 *
 *   register({
 *     type: 'SAMPLE_REQUEST', label: 'Sample material request',
 *     match({ code, typed }) -> boolean            whether this resolver reads the code (typed is { type, ref } for an ERP:TYPE:ref code)
 *     resolve(db, actor, { code, typed }) -> { id, title, route } | null     the record the code names, if the person may open it
 *   })
 *
 * A code the application prints is `ERP:<TYPE>:<reference>`; a business number printed on a document (such as a request number) can be
 * recognised too, by `match`.
 */
const resolvers = new Map();

const MAX_CODE = 200;
const TYPED = /^ERP:([A-Z][A-Z0-9_]{1,30}):([^\s]{1,150})$/;

export const parseCode = (raw) => {
  const code = String(raw ?? '').trim();
  if (!code || code.length > MAX_CODE || [...code].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null; // no control characters in a code
  const m = TYPED.exec(code);
  return { code, typed: m ? { type: m[1], ref: m[2] } : null };
};

export const qrRegistry = {
  register(def) {
    if (!/^[A-Z][A-Z0-9_]{1,30}$/.test(def.type)) throw new Error(`Bad QR type ${def.type}`);
    if (resolvers.has(def.type)) throw new Error(`QR type ${def.type} is already registered`);
    resolvers.set(def.type, def);
  },
  types: () => [...resolvers.values()].map((d) => ({ type: d.type, label: d.label })),

  /** What a code names: { status: 'found', type, label, id, title, route } | { status: 'unknown' } | { status: 'ambiguous', matches }. */
  resolve(db, actor, raw) {
    const parsed = parseCode(raw);
    if (!parsed) return { status: 'unknown' };
    const hits = [];
    for (const def of resolvers.values()) {
      if (parsed.typed && parsed.typed.type !== def.type && !def.match(parsed)) continue;
      if (!def.match(parsed)) continue;
      const found = def.resolve(db, actor, parsed);
      if (found) hits.push({ type: def.type, label: def.label, id: found.id, title: found.title, route: found.route });
    }
    if (hits.length === 0) return { status: 'unknown' };
    if (hits.length > 1) return { status: 'ambiguous', matches: hits };
    return { status: 'found', ...hits[0] };
  },

  /** The text to print as a QR code for a record. */
  payload: (type, ref) => `ERP:${type}:${ref}`,
};

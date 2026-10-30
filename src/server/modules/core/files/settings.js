import { CATEGORIES, FILE_TYPES, RETENTION_CLASSES } from '../../../platform/files/types.js';

export const HARD_CEILING_MB = 2048;

/** What applies until a company changes it (through an approved request). */
export const DEFAULT_SETTINGS = Object.freeze({
  allowedExtensions: Object.keys(FILE_TYPES),
  maxSizeMb: Object.freeze({ image: 20, document: 50, drawing: 200, video: 500 }),
  retention: Object.freeze({ image: 'standard', document: 'standard', drawing: 'permanent', video: 'short' }),
  urlTtlSeconds: 120,
});

/** Problems with a complete settings object; an empty list means it is valid. */
export function settingsProblems(s) {
  const out = [];
  if (!Array.isArray(s.allowedExtensions) || s.allowedExtensions.length === 0) out.push('Allow at least one file type.');
  else for (const e of s.allowedExtensions) if (!FILE_TYPES[e]) out.push(`.${e} is not a file type the system can check.`);
  for (const c of CATEGORIES) {
    const mb = s.maxSizeMb?.[c];
    if (!Number.isInteger(mb) || mb < 1 || mb > HARD_CEILING_MB) out.push(`The size limit for ${c} files must be a whole number of MB from 1 to ${HARD_CEILING_MB}.`);
    if (!RETENTION_CLASSES.includes(s.retention?.[c])) out.push(`The retention class for ${c} files must be one of ${RETENTION_CLASSES.join(', ')}.`);
  }
  if (!Number.isInteger(s.urlTtlSeconds) || s.urlTtlSeconds < 30 || s.urlTtlSeconds > 3600) out.push('A download link must last between 30 and 3600 seconds.');
  return out;
}

/** The stored settings of a company merged over the defaults (so a setting added later has its default). */
export function mergeSettings(stored, changes = {}) {
  const base = stored ?? DEFAULT_SETTINGS;
  return {
    allowedExtensions: changes.allowedExtensions ?? base.allowedExtensions,
    maxSizeMb: { ...DEFAULT_SETTINGS.maxSizeMb, ...base.maxSizeMb, ...changes.maxSizeMb },
    retention: { ...DEFAULT_SETTINGS.retention, ...base.retention, ...changes.retention },
    urlTtlSeconds: changes.urlTtlSeconds ?? base.urlTtlSeconds,
  };
}

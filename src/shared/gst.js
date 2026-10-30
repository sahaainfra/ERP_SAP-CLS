// Indian tax identity: GST state codes and the format and check-digit rules for GSTIN, PAN and CIN.
// Shared by the server (validation) and the browser (instant feedback in forms).

export const GST_STATES = Object.freeze([
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'],
  ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'],
  ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'],
  ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman and Nicobar Islands'],
  ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'], ['97', 'Other Territory'], ['99', 'Centre Jurisdiction'],
].map(([code, name]) => Object.freeze({ code, name })));

export const stateName = (code) => GST_STATES.find((s) => s.code === code)?.name ?? null;
export const isStateCode = (code) => GST_STATES.some((s) => s.code === code);

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const CIN = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const isPan = (v) => PAN.test(v);
export const isCin = (v) => CIN.test(v);

/** The 15th character of a GSTIN, computed from the first 14 (base-36 weighted checksum). */
export function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = ALPHABET.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36];
}

/**
 * Check a GSTIN: shape, a real state code, and the check character. Returns a problem text or null.
 * `pan` (optional) must equal characters 3 to 12 of the GSTIN, which carry the holder's PAN.
 */
export function gstinProblem(gstin, { pan = null } = {}) {
  if (!GSTIN.test(gstin)) return 'A GSTIN has 15 characters: 2 digits of state code, the 10-character PAN, an entity number, Z and a check character';
  if (!isStateCode(gstin.slice(0, 2))) return `${gstin.slice(0, 2)} is not a GST state code`;
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) return 'The check character of this GSTIN is wrong; re-check the number';
  if (pan && gstin.slice(2, 12) !== pan) return 'The PAN inside this GSTIN is not the company PAN';
  return null;
}

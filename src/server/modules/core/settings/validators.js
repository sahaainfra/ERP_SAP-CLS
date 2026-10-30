import { z } from 'zod';
import { parse } from '../../../platform/validation/index.js';
import { gstinProblem, isCin, isPan, isStateCode } from '../../../../shared/gst.js';

const DATE_FORMATS = ['DD-MMM-YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];
const text = (max) => z.string().trim().max(max);
const validZone = (tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const address = z
  .object({
    line1: text(120).default(''),
    line2: text(120).default(''),
    city: text(60).default(''),
    stateCode: z.string().default(''),
    pincode: z.string().default(''),
  })
  .superRefine((a, ctx) => {
    if (a.stateCode && !isStateCode(a.stateCode)) ctx.addIssue({ code: 'custom', path: ['stateCode'], message: 'is not a GST state code' });
    if (a.pincode && !/^[1-9][0-9]{5}$/.test(a.pincode)) ctx.addIssue({ code: 'custom', path: ['pincode'], message: 'must be a 6-digit PIN code' });
  });

const body = z
  .object({
    legalName: text(200).min(2, 'Enter the registered legal name'),
    tradeName: text(200).nullable().optional(),
    address: address.default({ line1: '', line2: '', city: '', stateCode: '', pincode: '' }),
    gstins: z.array(z.object({ stateCode: z.string(), gstin: z.string(), tradeName: text(200).optional() })).max(40).default([]),
    pan: z.string().trim().toUpperCase().nullable().optional(),
    cin: z.string().trim().toUpperCase().nullable().optional(),
    logoFileId: text(80).nullable().optional(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code such as INR').default('INR'),
    timezone: z.string().refine(validZone, 'Is not a known time zone, for example Asia/Kolkata').default('Asia/Kolkata'),
    dateFormat: z.enum(DATE_FORMATS).default('DD-MMM-YYYY'),
    numberFormat: z.enum(['indian', 'international']).default('indian'),
    fyStartMonth: z.number().int().min(1).max(12).default(4),
    reason: text(500).min(5, 'Give a reason of at least 5 characters'),
    version: z.number().int().min(0).optional(),
  })
  .superRefine((b, ctx) => {
    const bad = (path, message) => ctx.addIssue({ code: 'custom', path, message });
    if (b.pan && !isPan(b.pan)) bad(['pan'], 'A PAN has 10 characters: 5 letters, 4 digits, 1 letter');
    if (b.cin && !isCin(b.cin)) bad(['cin'], 'A CIN has 21 characters, for example U45200MH2010PTC123456');
    const seen = new Set();
    b.gstins.forEach((g, i) => {
      const gstin = g.gstin.trim().toUpperCase();
      if (!isStateCode(g.stateCode)) bad(['gstins', i, 'stateCode'], 'is not a GST state code');
      const problem = gstinProblem(gstin, { pan: b.pan || null });
      if (problem) bad(['gstins', i, 'gstin'], problem);
      else if (gstin.slice(0, 2) !== g.stateCode) bad(['gstins', i, 'stateCode'], `does not match the state code ${gstin.slice(0, 2)} inside the GSTIN`);
      if (seen.has(gstin)) bad(['gstins', i, 'gstin'], 'is listed twice');
      seen.add(gstin);
    });
  });

export const parseSettings = (payload) => {
  const b = parse(body, payload);
  return { ...b, gstins: b.gstins.map((g) => ({ ...g, gstin: g.gstin.trim().toUpperCase() })), pan: b.pan || null, cin: b.cin || null, tradeName: b.tradeName || null, logoFileId: b.logoFileId || null };
};

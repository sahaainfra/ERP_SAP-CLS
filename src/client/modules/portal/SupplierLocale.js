import { createContext, useContext } from 'react';
import { formatDate, formatMoney, formatQuantity } from '../../../shared/i18n/format.js';
import { portalLabel } from './labels.js';

export const SupplierLanguage = createContext('en');

export function useSupplierLocale() {
  const lang = useContext(SupplierLanguage);
  return {
    t: (label) => portalLabel(lang, label),
    date: (value) => formatDate(value, { lang }),
    money: (value) => formatMoney(value == null ? null : String(value), { lang }),
    qty: (value, unit) => formatQuantity(value == null ? null : String(value), unit, { lang }),
  };
}

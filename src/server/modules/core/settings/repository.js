/** Data access for core_company_settings: one row per company. */
export function createSettingsRepository(db) {
  return {
    find: (companyId) => db.prepare('SELECT * FROM core_company_settings WHERE company_id = ? AND is_active = 1 AND deleted_at IS NULL').get(companyId),

    insert(companyId, v, actor, now) {
      db.prepare(
        `INSERT INTO core_company_settings (company_id, legal_name, trade_name, address_json, gstins_json, pan, cin, logo_file_id, currency, timezone, date_format, number_format, fy_start_month, created_by, created_at, remarks)
         VALUES (:companyId, :legalName, :tradeName, :address, :gstins, :pan, :cin, :logoFileId, :currency, :timezone, :dateFormat, :numberFormat, :fyStartMonth, :actor, :now, :reason)`,
      ).run({ companyId, ...flat(v), actor, now });
    },

    update(id, version, v, actor, now) {
      const res = db
        .prepare(
          `UPDATE core_company_settings SET legal_name = :legalName, trade_name = :tradeName, address_json = :address, gstins_json = :gstins, pan = :pan, cin = :cin,
             logo_file_id = :logoFileId, currency = :currency, timezone = :timezone, date_format = :dateFormat, number_format = :numberFormat, fy_start_month = :fyStartMonth,
             updated_by = :actor, updated_at = :now, remarks = :reason, version = version + 1
           WHERE id = :id AND version = :version`,
        )
        .run({ id, version, ...flat(v), actor, now });
      return Number(res.changes) === 1;
    },

    financialYearCount: (companyId) => db.prepare('SELECT COUNT(*) AS n FROM core_financial_years WHERE company_id = ? AND is_active = 1').get(companyId).n,
  };
}

const flat = (v) => ({
  legalName: v.legalName,
  tradeName: v.tradeName,
  address: JSON.stringify(v.address),
  gstins: JSON.stringify(v.gstins),
  pan: v.pan,
  cin: v.cin,
  logoFileId: v.logoFileId,
  currency: v.currency,
  timezone: v.timezone,
  dateFormat: v.dateFormat,
  numberFormat: v.numberFormat,
  fyStartMonth: v.fyStartMonth,
  reason: v.reason,
});

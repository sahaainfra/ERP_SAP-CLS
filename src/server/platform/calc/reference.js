// Reference units of measure and their generic conversions, until the UOM master of part 06.02 owns them (D-042).
// Item-specific factors (a bag of cement, a bar of steel by diameter) are NOT seeded: they are master data per item.

const UNITS = [
  ['NOS', 'Numbers', 'count'], ['BAG', 'Bag', 'count'], ['SET', 'Set', 'count'],
  ['G', 'Gram', 'mass'], ['KG', 'Kilogram', 'mass'], ['MT', 'Metric tonne', 'mass'], ['QTL', 'Quintal', 'mass'],
  ['MM', 'Millimetre', 'length'], ['CM', 'Centimetre', 'length'], ['M', 'Metre', 'length'], ['KM', 'Kilometre', 'length'], ['RM', 'Running metre', 'length'],
  ['SQM', 'Square metre', 'area'], ['SQFT', 'Square foot', 'area'],
  ['L', 'Litre', 'volume'], ['CUM', 'Cubic metre', 'volume'], ['CUFT', 'Cubic foot', 'volume'],
  ['HR', 'Hour', 'time'], ['DAY', 'Day', 'time'],
];
// "1 from = factor to"
const GENERIC = [
  ['KG', 'G', '1000'], ['MT', 'KG', '1000'], ['QTL', 'KG', '100'],
  ['M', 'MM', '1000'], ['M', 'CM', '100'], ['KM', 'M', '1000'], ['RM', 'M', '1'],
  ['SQM', 'SQFT', '10.7639104167'], ['CUM', 'L', '1000'], ['CUM', 'CUFT', '35.3146667215'],
  ['DAY', 'HR', '24'],
];

/** Insert what is missing; never touches a row an administrator has changed or removed. Returns how many rows were added. */
export function ensureReferenceUnits(db) {
  let added = 0;
  const unit = db.prepare("INSERT OR IGNORE INTO core_uoms (code, name, dimension, created_by, source_type) VALUES (?, ?, ?, 'system', 'reference_seed')");
  for (const [code, name, dimension] of UNITS) added += Number(unit.run(code, name, dimension).changes);
  const conv = db.prepare("INSERT OR IGNORE INTO core_uom_conversions (item_code, from_uom, to_uom, factor, created_by, source_type) VALUES (NULL, ?, ?, ?, 'system', 'reference_seed')");
  for (const [from, to, factor] of GENERIC) added += Number(conv.run(from, to, factor).changes);
  return added;
}

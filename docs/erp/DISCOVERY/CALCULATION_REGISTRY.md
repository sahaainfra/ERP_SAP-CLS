# CALCULATION_REGISTRY

Golden outputs live in `golden/outputs/<id>.json`; compare with `npm run erp:golden`.

| Id | Golden output |
|---|---|
| calc.billing_net_payable | golden/outputs/calc.billing_net_payable.json |
| calc.boq_line_amount | golden/outputs/calc.boq_line_amount.json |
| calc.gst_split | golden/outputs/calc.gst_split.json |
| calc.stock_weighted_average | golden/outputs/calc.stock_weighted_average.json |
| calc.uom_conversions | golden/outputs/calc.uom_conversions.json |
| prog.flag_evaluation_matrix | golden/outputs/prog.flag_evaluation_matrix.json |

Business calculations are formulas in the registry (Administration > Calculations, `src/server/platform/calc/builtins.js`), evaluated by the one engine (part 01.06).

| Formula | Version in code |
|---|---|
| boq.line_amount | 1 |
| tax.gst_split | 1 |
| stock.weighted_average | 1 |
| billing.net_payable | 1 |

Each later part registers its own formulas and golden outputs.

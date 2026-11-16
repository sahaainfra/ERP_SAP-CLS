# Lighthouse, phone (part 166.4, T-02)

lighthouse@13.5.0; mobile, simulated Slow 4G (150 ms round trip, 1.6 Mbps), 4x slower processor, cold cache. Targets: Performance >= 80, LCP <= 3000 ms, CLS <= 0.1.

| Page | Role | Performance | LCP | CLS | FCP | TBT | Transferred | Result |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Home (/home) | PM | 36 | 43380 ms | 0.001 | 40575 ms | 806 ms | 8649 KB | FAIL |
| Field Home (/field) | SE | 22 | 43147 ms | 0.304 | 40571 ms | 702 ms | 8600 KB | FAIL |
| DPR entry (/site/dpr-entry) | SE | 40 | 40953 ms | 0.043 | 40576 ms | 570 ms | 8598 KB | FAIL |
| GRN (/inv/grns) | SK | 29 | 42979 ms | 0.181 | 40571 ms | 732 ms | 8579 KB | FAIL |
| Approvals (/field/approvals) | PM | 35 | 46046 ms | 0.018 | 40870 ms | 859 ms | 8647 KB | FAIL |

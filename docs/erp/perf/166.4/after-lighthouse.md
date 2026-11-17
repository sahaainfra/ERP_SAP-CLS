# Lighthouse, phone (part 166.4, T-02)

lighthouse@13.5.0; mobile, simulated Slow 4G (150 ms round trip, 1.6 Mbps), 4x slower processor, cold cache. Targets: Performance >= 80, LCP <= 3000 ms, CLS <= 0.1.

| Page | Role | Performance | LCP | CLS | FCP | TBT | Transferred | Result |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Home (/home) | PM | 77 | 4304 ms | 0.001 | 2748 ms | 230 ms | 488 KB | FAIL |
| Field Home (/field) | SE | 81 | 3985 ms | 0 | 2880 ms | 128 ms | 485 KB | FAIL |
| DPR entry (/site/dpr-entry) | SE | 78 | 4103 ms | 0 | 2850 ms | 233 ms | 493 KB | FAIL |
| GRN (/inv/grns) | SK | 73 | 4313 ms | 0 | 2915 ms | 304 ms | 510 KB | FAIL |
| Approvals (/field/approvals) | PM | 75 | 4663 ms | 0.001 | 2820 ms | 192 ms | 497 KB | FAIL |

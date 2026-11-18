# Lighthouse, phone (part 166.4, T-02)

lighthouse@13.5.0; mobile, simulated Slow 4G (150 ms round trip, 1.6 Mbps), 4x slower processor, cold cache. Targets: Performance >= 80, LCP <= 3000 ms, CLS <= 0.1.

| Page | Role | Performance | LCP | CLS | FCP | TBT | Transferred | Result |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Home (/home) | PM | 77 | 4304 ms | 0.001 | 2748 ms | 230 ms | 488 KB | FAIL |
| Field Home (/field) | SE | 81 | 3985 ms | 0 | 2880 ms | 128 ms | 485 KB | FAIL |
| DPR entry (/site/dpr-entry) | SE | 78 | 4103 ms | 0 | 2850 ms | 233 ms | 493 KB | FAIL |
| GRN (/inv/grns) | SK | 73 | 4313 ms | 0 | 2915 ms | 304 ms | 510 KB | FAIL |
| Approvals (/field/approvals) | PM | 75 | 4663 ms | 0.001 | 2820 ms | 192 ms | 497 KB | FAIL |

## Re-measured on 2026-11-17 (after the English text split, the drawn boot shell and the Home layout fix)

Same settings, median of 3 (`remeasure-lighthouse.json`). First download 185.1 KB gzip (was 324.8 KB).

| Page | Role | Performance | LCP | CLS | FCP | TBT | Transferred | Result |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Home (/home) | PM | 79 | 3570 ms | 0.001 | 2042 ms | 396 ms | 438 KB | FAIL |
| Field Home (/field) | SE | 87 | 3406 ms | 0 | 2043 ms | 192 ms | 374 KB | FAIL |
| DPR entry (/site/dpr-entry) | SE | 89 | 2765 ms | 0 | 2054 ms | 258 ms | 393 KB | PASS |
| GRN (/inv/grns) | SK | 79 | 3943 ms | 0.089 | 2032 ms | 246 ms | 417 KB | FAIL |
| Approvals (/field/approvals) | PM | 85 | 3845 ms | 0.001 | 2017 ms | 145 ms | 388 KB | FAIL |

DPR entry passes all three targets. Performance is at or above 80 on Field Home, DPR entry and Approvals (79 on Home and GRN). LCP is still above 3 s on four pages; CLS is met on all five.
The run before the Home fix measured Home CLS 0.53: the insight cards grew from their skeleton above the page's own content. They are now drawn last, below it (CLS 0.001).

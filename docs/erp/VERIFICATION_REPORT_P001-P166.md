# 15 — Verification Report: Parts 001–166 (00.01 → 22.09)

| Item | Value |
|---|---|
| Repository | `sahaainfra/ERP_SAP-CLS`, branch `main`, commit `9e680f3` (merge of PR #7, 15 Nov 2026 15:59 IST) |
| Verified on | 15 Nov 2026, Node 24.22, Chrome (Playwright 1.64), Linux |
| Scope | Code built from prompts 001–166; screenshots in `docs/erp/screenshots`; approved mockups in `reference/ERP_UI_Mockups`; user references in `reference/ui-references` |
| Verdict | **Functionally broad and well documented, but not yet a reliable baseline.** One part was never built (07.14), the type check fails, older E2E specs drifted, one permission leak, one visible date bug, and the screens did not match the mockups or work well on phones. All items have a fix: done in UI v3 (this delivery) or assigned to enhancement prompts 166.1–166.8. |

## 1. Completeness against the roadmap

| Check | Result |
|---|---|
| Completion reports `docs/erp/COMPLETION/*.md` | 166 files present (00.01 … 22.09) |
| `PROGRESS.csv` status of steps 1–166 | 165 × *Ready for review*; **1 × Not started: step 068, part 07.14 HR & Workforce Dashboards and Workforce-First Gate** |
| Gates | No gate (G1–G4) has written acceptance evidence; G2 cannot be closed without 07.14 → **166.6** |
| Reviewer column | Empty for all rows: nothing is formally *Accepted* yet |
| Defect register | 662 rows; 135 name parts 23.xx–30.xx as the owner (deferred adapters, e.g. D-655 paid quantity waits for 23.x, D-657 IRN credit note waits for 23.05/23.07, D-658/659 payables wait for 23.03) → per-part list in **166.1 F-08** |

## 2. Quality gates (run on the repository)

| Gate | Result | Action |
|---|---|---|
| `npm run lint` | **Pass** | — |
| `npm run typecheck` | **Fail — 13 errors** in `bill/cert.js`, `bill/cvr.js`, `bill/hub.js`, `bill/ledger.js`, `bill/qsdash.js`, `bill/sub.js`, `bill/vinv.js`, `ctr/securities.js` (string/number arithmetic, wrong helper arity, unknown property) | **166.1 F-01** |
| `vite build` | Pass; **one JS chunk of 7.8 MB (1.69 MB gzip)** — slow first load on site phones | **166.4** |
| Unit tests (`npm test`) on Node 22 | 194 of 361 fail — the server needs Node 24 (`node:crypto` `argon2`) | **166.1 F-06** |
| Unit + API tests on Node 24 (217 files, about 1,450 tests) | **Pass except 2**: `plan-lookahead.test.js` T-01 and FR-02 fail **on a Sunday (IST)** — an extra `PREDECESSOR` constraint; the test derives "this Monday" from today | **166.1 F-09** (fixed-clock tests for every weekday and year end) |
| E2E sample after UI v3 — attendance, client bill, CVR, QS dashboard, GRN, DPR, users, home (`ui-v3-look`) — desktop + mobile | **22 / 22 pass** (plus dashboard and shell specs: failures identical on the original code) | — |
| `e2e/shell.spec.js` | **5 fail** on the original code (menu/registry assertions written for 03.05; later parts added pages) | **166.1 F-02** |
| `e2e/dashboard.spec.js` designer test | **Fail on the original code — a `PM` user can open Dashboard Designer** (`ui.dashboard.manage` is granted only to SYSADM/PCMGR in the templates) | **166.1 F-03** (permission audit) |
| Full E2E suite (716 tests) and visual baseline (≈3,300 images) | Not run end to end here (2-CPU sandbox: about 7 h for the baseline alone). Run on the build machine: `npm run erp:regression`. The visual baseline holds pre-UI-v3 images and must be regenerated and reviewed (D-670). | **166.1 / 166.2 T-05** |

## 3. Defects found in use

| # | Defect | Status |
|---|---|---|
| V-01 | Approval and audit history shows **"Invalid Date"** (every bill and many other documents): `fmtDate` added `T00:00:00Z` to full timestamps. | **Fixed in UI v3** for the four shared helpers (`proc`, `plan`, `inv`, `site` — used by the billing pages); consolidation of 26 other copies → **166.1 F-04** |
| V-02 | KPI figures on 26 pages (control tower, QS dashboard, CVR…) were placed in a **form grid**, so each figure took a full row; the classes `kpi-row`/`kpi-tile` used on 26 pages had **no CSS**. | **Fixed in UI v3** (shared layer); migration to `KpiTile` → **166.2** |
| V-03 | Tables ran off the screen on phones; an old phone rule broke every table (including key/value tables) into unlabeled blocks. | **Fixed in UI v3** (`responsiveTables.js`: labelled cards; small tables stay tables) |
| V-04 | Pages looked unstyled compared with the mockups: blue underlined links, boxed tabs, flat panels, dark menu with no hierarchy. | **Fixed in UI v3** (see §4) |
| V-05 | Tax masters: `GST12`/`GST28` open-ended, no `GST40`; TDS section fallback hard-coded to `'194C'` in `bill/sub.js`. Rules changed on 22 Sep 2025 (GST) and 1 Apr 2026 (Income-tax Act 2025). | **166.8** |
| V-06 | Pay components not classified for the Code on Wages (in force 21 Nov 2025). | **166.8** (S-04), used by 24.x |

## 4. UI v3 delivered with this report (in the repository)

| Area | What changed |
|---|---|
| Shared layer | `src/client/ui-v3.css` loaded after `styles.css`: one look for shell, menu, cards, KPI rows, forms, buttons, tabs, tables, badges, list report, object page, overview cards; dark and high-contrast kept |
| Desktop | Light menu with a blue pill for the current page, white top bar with a rounded search, soft cards, KPI tiles with coloured icons, grey table headers, Fiori list report (filter bar card + "Title (count)" table card), object page header card, overview cards |
| Phone | Navy band behind the title (reference R01), rounded cards, segmented pill tabs, amber full-width main action, white icon bottom bar, 16 px inputs, 44 px targets, tables as labelled cards, hero KPI then 2 per row |
| Home | Greeting banner with date and today's counts, to-do cards with "View all", coloured quick-action tiles, favourites and recent cards (references R02, R05, R13) |
| Text size | S / M / L / XL per device in the user menu (English and Hindi labels) |
| Tests | Existing specs pass on desktop and mobile for the pages checked; a new `e2e/ui-v3-look.spec.js` captures Home and Users on both; visual baseline regenerated for review |

## 5. What prompts 167–228 must inherit

1. Start only after **166.1** (green baseline) and with **166.2** components available; 166.3–166.8 can run in parallel with M23 where they do not touch the same files.
2. Every page in the pattern of `14_UI_V3_DESIGN_AND_MOBILE_STANDARD.md`, with desktop and mobile screenshots.
3. Statutory values as effective-dated masters (GST 2.0 from 22 Sep 2025; e-invoice 30-day IRP window for AATO ≥ ₹10 Cr from 1 Apr 2025; Labour Codes from 21 Nov 2025; Income-tax Act 2025 sections and forms from 1 Apr 2026), each confirmed against the official notification at build time.
4. Close the deferred defects each part owns (`DEFECTS_BY_PART.md`).

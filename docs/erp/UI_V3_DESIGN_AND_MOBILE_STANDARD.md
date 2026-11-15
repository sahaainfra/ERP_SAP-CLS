# 14 — UI v3 Design & Mobile-First Standard (mandatory from part 166.1 onward)

This standard extends `05_GLOBAL_STANDARDS.md` §9 (design system) and replaces any older guidance about page look and phone use where the two disagree. Every development prompt from **166.1** to **228** cites it. A page is not complete until it meets this document on a 360 px phone **and** a 1280 px desktop.

**Why it exists.** Parts 01–166 were built fast and work, but the screens did not look like the approved mockups: KPI figures stacked one per row, tables ran off phone screens, links looked unstyled, every module invented its own class names. Most of the ERP will be used **on phones by site teams** (site engineers, supervisors, storekeepers, HSE officers, QC engineers, foremen). UI v3 fixes that once, in a shared design layer, and this standard keeps every new page consistent with it.

---

## 1. Visual references (in `reference/`)

| Group | Files | Use it for |
|---|---|---|
| Approved mockups | `reference/ERP_UI_Mockups/png/01–15` | Exact colours, tokens, KPI rows, tables, RA bill, GRN, payroll, mobile attendance |
| Phone app style | `ui-references/R01` | Phone pages: navy band behind the title, rounded white cards, pill tabs, amber main action, icon bottom bar |
| Home / launchpad | `R02`, `R05`, `R06`, `R13`, `R20` | Greeting banner, to-do cards, coloured quick-action tiles, insight cards, approvals cards |
| Overview page (dashboards) | `R07`, `R08`, `R09`, `R11`, `R14`, `R15`, `R19` | Card grid: title, subtitle, "n of N", big KPI with unit, chart or list, "View all" |
| Object page (one record) | `R12`, `R16` | Header with title, subtitle, key facts in columns, status in colour, anchor tabs, sections |
| List report | `R17` | Filter bar card, table card with "Title (count)" and toolbar, bold ID + subtitle, status chip, chevron |
| Analytical list page | `R10`, `R18` | Visual filters on top, chart, grouped table with totals |
| Planning / Gantt | `R03`, `R04` | Grid + Gantt split, critical path, tree rows |

The references show **layout and behaviour**, not branding: never copy a vendor logo, name or icon set. Colours always come from the design tokens.

---

## 2. The design layer (already in the code — reuse, never fork)

| File | What it does |
|---|---|
| `src/client/design-tokens.css` | Colour, type, spacing, radius tokens (light, dark, high-contrast; comfortable/compact density). Generated — edit `src/shared/design/design-tokens.json` and run `npm run erp:tokens`. |
| `src/client/ui-v3.css` | **The UI v3 layer**, loaded after `styles.css`. Gives every shared class one look: shell, menu, cards, KPI rows, forms, buttons, tabs, tables, badges, list report, object page, overview cards, home, phone band. |
| `src/client/platform/design/responsiveTables.js` | Turns every simple table (>3 columns, one header row) into labelled cards below 640 px. Opt out with `data-no-cards` (matrices, registers, spreadsheets, Gantt). |
| `src/client/platform/design/textSize.js` | Per-device text size S / M / L / XL (user menu). Scales the type tokens. |
| `src/client/platform/list/ListReport.jsx` | The list report. Use it for every list. |
| `src/client/platform/object/ObjectPage.jsx` | The object page. Use it for every record page. |
| `src/client/platform/dashboard/*` | The overview/widget framework. Use it for every dashboard. |

**Rules**
1. Do not write page-level CSS for things the layer already styles. A new class needs a reason in `docs/erp/DECISIONS.md`.
2. **No hard-coded colours** in JSX (`erp/no-hardcoded-color` lint rule) — use tokens or `var(--ui-c1…c8)` for chart/tile series.
3. KPI figures go in `.kpi-row > .kpi-tile` (label `.kpi-label`, value `.kpi-value`) — **never** inside `form-grid` / `mdm-panel` (that pattern exists in 26 older pages and is being migrated by 166.2).
4. A table that must stay a table on a phone sets `data-no-cards` and is wrapped in `.table-scroll`.
5. Page title is the only `<h1>`; the intro line is the `<p>` right after it (the phone band covers both).

---

## 3. Page patterns (choose one per page; section 7 of each prompt names it)

### 3.1 List report (type *List*, *Worklist*)
- **Filter bar card**: rounded search, saved views, columns, export, status chips (scroll sideways on a phone), "More filters", active-filter chips with "Clear all".
- **Table card**: header `Title (count)`; first column bold (document number, link to the object page); status as `StatusBadge`; numbers right-aligned with Indian grouping; row menu; bulk bar when rows are selected; pager `25/50/100`.
- **Phone**: cards — document number as title, 3–5 key fields, status chip, chevron; the main "New" action as a full-width amber button; pull to refresh.

### 3.2 Object page (type *Object*)
- White header card: title (document number), subtitle (type · project · party), **key facts in columns** (status in colour, amount, dates, owner), main actions top-right (primary = Submit/Approve), "Why are some actions off?".
- Anchor tabs: Details · Lines · Attachments · Approvals · Discussion · History (counts in pills).
- **Phone**: facts 2 per row; tabs become a segmented pill bar that scrolls sideways; actions in a sticky bottom bar (primary amber, full width).

### 3.3 Form / wizard (type *Form*)
- Sections as cards with a short heading; 2 columns ≥ 900 px, 1 column on a phone; required marker; inline errors; live totals card on the right (desktop) or sticky at the bottom (phone); autosave draft badge.
- **Phone**: one field per row, 16 px inputs, numeric keypad for quantities (`inputmode="decimal"`), date pickers native, camera/attachment buttons ≥ 48 px, steps as numbered pills.

### 3.4 Overview page / dashboard (type *Dashboard*)
- Filter bar card (project, period, company) → **card grid** (12-column, cards span 3/4/6): every card has **title, subtitle (unit and period), optional "n of N"**, one big KPI with unit and trend (▲▼ vs previous), then a chart or a short list, and **View all ›** to the list report with the same filters.
- Card kinds: KPI, bar/line/donut chart, top-N list with bars (R09), to-do list, calendar, quick links (R19).
- **Phone**: one column; KPI cards first; charts at least 220 px tall; legends below charts.

### 3.5 Analytical report (type *Report*)
- Parameter panel (filter bar card) → visual filters (R10/R18) → chart → grouped table with sub-totals and grand total → drill-down to records → export XLSX/PDF and schedule.
- **Phone**: chart first, then the table as cards with totals in a sticky footer; export in the "…" menu.

### 3.6 Board (type *Board*), Config, Portal, Mobile
- Board: columns as cards (kanban), drag on desktop, move menu on a phone.
- Config: settings grouped in cards with a description per group; changes through the approval workflow where §07 says so.
- Portal: external users get the same patterns with company branding (25.01) and a simpler menu.
- Mobile: designed for one hand: bottom bar, large targets, offline queue, camera/GPS where useful.

---

## 4. Phone rules (≤ 767 px) — acceptance checklist

| # | Rule |
|---|---|
| M-01 | No horizontal page scroll at 360 px (`noOverflow` helper in every E2E spec). |
| M-02 | Touch targets ≥ 44 × 44 px; the main action ≥ 48 px high and full width. |
| M-03 | Inputs 16 px or larger (no iOS zoom); numeric fields use `inputmode`. |
| M-04 | Lists and tables read as cards (ListReport cards or `responsiveTables.js`). |
| M-05 | KPI rows: first KPI full width (hero), then 2 per row. |
| M-06 | Tabs: segmented pill bar, scroll sideways, the active tab visible. |
| M-07 | Text size XL (user menu) still fits: no clipped labels, no overlapping. |
| M-08 | Works on a slow connection: skeletons, no layout jump, offline queue where the part writes from the field. |
| M-09 | Field roles (SE, CSUP, WSUP, PMSUP, SK, QCE, HSEE, HSEO, CM) reach their daily task in ≤ 2 taps from Home. |
| M-10 | Dark and high-contrast themes keep the same structure. |

## 5. Desktop rules (≥ 1024 px)

| # | Rule |
|---|---|
| D-01 | Light menu with a blue pill for the current page; white top bar; rounded search in the middle. |
| D-02 | Cards: white, 14 px radius, soft shadow, 14–16 px padding; page background `#F4F6FA`. |
| D-03 | KPI tiles in a row (`auto-fill, minmax(210px, 1fr)`), value never broken inside a number. |
| D-04 | Tables: grey header row, bold first column, right-aligned numbers, hover row, sticky header on long lists. |
| D-05 | Numbers: Indian grouping (₹ 12,34,567.00), lakh/crore abbreviations in KPI cards (₹ 2.43 Cr). |
| D-06 | Status colour only with a text label (never colour alone). |

## 6. Evidence required in every completion report

1. Screenshots: `docs/erp/screenshots/<part>/desktop-*.png` and `mobile-*.png` for **every** page of section 7 (the E2E spec writes them).
2. The phone checklist M-01…M-10 ticked per page with the spec line that proves it.
3. `npm run lint`, `npm run typecheck` (**0 errors**), `npm test`, `npm run test:e2e`, `npm run test:visual` (baseline updated **only** for pages this part changed, reviewed in the PR).

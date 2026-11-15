# UI v3 completion: one mobile-first design layer over parts 01–166

Date: 2026-11-15. No feature flag (visual layer and bug fixes only; no business rule changed). Standard: `docs/erp/UI_V3_DESIGN_AND_MOBILE_STANDARD.md`. Verification of parts 01–166: `docs/erp/VERIFICATION_REPORT_P001-P166.md`.

Status: **Ready for review.** Follow-up work is in enhancement prompts 166.1–166.8 (prompt pack v3).

## What was built
- **`src/client/ui-v3.css`** (loaded after `styles.css`): text-size scaling of the type tokens; light menu with a blue pill for the current page; white top bar with a rounded search; soft cards; KPI rows with coloured markers (also for the 26 pages that put KPI figures in form grids); forms with 44 px targets on touch screens and 16 px inputs on phones; buttons; underline tabs (pill tabs on phones); tables with grey headers; Fiori list report (filter bar card + "Title (count)" table card); object page header card; overview cards; home page; phone look with a navy band behind the title, rounded cards, amber main action and a white bottom bar; dark, high-contrast and print kept.
- **`platform/design/responsiveTables.js`**: tables with one header row and more than three columns become labelled cards below 640 px; small, key/value and opted-out tables stay tables (ADR-612).
- **`platform/design/textSize.js`** and a **Text size** control (S/M/L/XL) in the user menu, English and Hindi labels (ADR-613).
- **`ListReport.jsx`**: filter bar wrapper and a "Title (count)" table header.
- **Home (`LaunchpadPage.jsx`)**: greeting banner (India time) with date and today's counts, to-do cards with "View all", coloured quick-action tiles, favourites and recent cards. All test IDs and the "Home" heading kept.
- **Fix D-663**: `fmtDate` in `proc`, `plan`, `inv` and `site` accepts timestamps (approval and audit history showed "Invalid Date").

## Acceptance
- `npm run lint` clean; `vite build` passes.
- Playwright desktop + mobile: attendance, bill-client, bill-cvr, bill-qsdash, inv-grn, site-dpr, users, ui-v3-look — **22/22 pass**; screenshots refreshed in `docs/erp/screenshots/` (new: `ui-v3/`).
- Pre-existing failures, identical on the original code: `shell.spec.js` (5, D-665), `dashboard.spec.js` designer (D-666).
- Unit/API suite on Node 24: all pass except `plan-lookahead.test.js` T-01/FR-02 on Sundays (D-671, not touched by this change).

## Known limitations
- The visual baseline (`e2e/a0-visual.spec.js-snapshots`) still holds pre-UI-v3 images: `npm run test:visual` fails until it is regenerated with `npm run test:visual:update` and reviewed (D-670, part 166.2).
- Pages still render their own headers and KPI markup; the shared `PageHeader`/`KpiTile`/`Card` components come in 166.2.

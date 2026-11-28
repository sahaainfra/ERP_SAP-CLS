# Screen-reader UAT script (PACK-14)

This script is for **people** to run with real assistive technology. Automated checks (axe, the sweeps in
`e2e/tst-a11y-sweep.spec.js` and `e2e/a11y.spec.js`) find what a machine can; they cannot say whether a page makes sense when heard. Every
result below is blank until a tester fills it in. **Do not mark a step passed without running it.** Record the build (commit) and date.

## 1. Set-up

| Setting | Desktop | Phone |
|---|---|---|
| Screen reader | NVDA 2024.x (Windows 11) with Chrome or Edge | TalkBack (Android 13+) with Chrome |
| Second reader (optional) | JAWS 2024 or Narrator | VoiceOver (iOS 17+) with Safari |
| Account | a test company and test users only (no real personal data) | the same |
| Roles | PM (project manager), SE (site engineer), ACCMGR (accounts manager), SYSADM | SE, PM |
| Languages | English, then Hindi, then Telugu (Appearance › Language) | the same |
| Flags | as in the release being tested; note which `ff.*` are on | the same |

Before you start: turn the screen off (NVDA: `Insert+S` to screen-curtain is not built in; use a second monitor off, or TalkBack's "dim screen") so that you rely on speech only.

How to record a step: **P** (passed: you could do it and heard what you needed), **F** (failed: say what you heard or could not do), **B** (blocked: say why). Add the time taken for the journeys.

## 2. Journeys

### J1. Sign in and find the start page (desktop and phone)
| # | Do | You should hear | Result | Notes |
|---|---|---|---|---|
| 1 | Open the sign-in page | the page title, then "Username, email or mobile, edit" | | |
| 2 | Enter a wrong password and sign in | the error, read out without moving to it by hand | | |
| 3 | Sign in correctly | the Home heading (level 1) | | |
| 4 | Press `H` (NVDA) / swipe by headings (TalkBack) | each card's heading in a sensible order | | |
| 5 | Jump to the main landmark (`D` in NVDA; landmarks in TalkBack) | "main" and the page content, not the menu | | |

### J2. Navigation and search
| # | Do | You should hear | Result | Notes |
|---|---|---|---|---|
| 1 | Open the menu (desktop: Tab to it; phone: the bottom navigation "More") | the menu's name and that it is expanded | | |
| 2 | Open "Search or go to" (`Ctrl+K`) and type a project code | the number of results as they change, then the first result | | |
| 3 | Choose a result with Enter | the page heading of the record | | |
| 4 | Use the context switcher (project and site) | the current context, the list of choices, the new context after choosing | | |

### J3. A list (List Report: Sample Material Requests or a module register)
| # | Do | You should hear | Result | Notes |
|---|---|---|---|---|
| 1 | Reach the table | the table's name, row and column counts | | |
| 2 | Move by cell (`Ctrl+Alt+arrows` in NVDA) | column headers read with each cell | | |
| 3 | Apply a quick filter | the new count ("12 requests, page 1 of 1") | | |
| 4 | Select two rows and start a bulk action | "2 selected"; the preview or confirmation, with who may and may not act | | |
| 5 | Phone: the filter sheet | "Filters of …, dialog"; Escape or Done returns to the Filters button | | |

### J4. A form with mistakes (a DPR entry or the sample request form)
| # | Do | You should hear | Result | Notes |
|---|---|---|---|---|
| 1 | Tab through the fields | each label, "required" where it is, and the hint | | |
| 2 | Save with required fields empty | the error summary, then each field's error when you reach it | | |
| 3 | Type an invalid GSTIN or IFSC and leave the field (flag `ff.forms.pack09`) | the problem in the chosen language | | |
| 4 | Move between the DPR steps | the step heading each time (focus moves to it) | | |
| 5 | Leave the page with unsaved changes | the question whether to leave | | |

### J5. Dialogs
| # | Do | You should hear | Result | Notes |
|---|---|---|---|---|
| 1 | Open a confirmation (cancel a request) | the dialog's title and text; focus inside | | |
| 2 | Press Escape | back on the button that opened it | | |
| 3 | A typed confirmation (salary transfer release, `ff.ui.pack11`) | the instruction to type the number; the button is "unavailable" until it is typed | | |

### J6. Approvals (PM approves, desktop and phone)
| # | Do | You should hear | Result | Notes |
|---|---|---|---|---|
| 1 | Open Approvals | the count of items waiting | | |
| 2 | Open an item and approve it with a comment | the decision announced; back on the list with the new count | | |

### J7. Charts and dashboards
| # | Do | You should hear | Result | Notes |
|---|---|---|---|---|
| 1 | Reach a chart (role dashboard or progress) | its summary: what it shows, not only its title (`ff.charts.pack12`) | | |
| 2 | Open "View as table" | the table with every figure | | |

### J8. Languages
Repeat J1 3–5 and J4 1–3 in Hindi and in Telugu. Note any English text read in a Hindi or Telugu screen, and any word the reader mispronounces because it is spelled oddly.

| Language | Result | Notes |
|---|---|---|
| Hindi | | |
| Telugu | | |

## 3. What the automated checks already cover (do not re-test by hand)
- axe WCAG 2.1 A and AA on every registered page at 360 and 1280 px (`e2e/tst-a11y-sweep.spec.js`); serious and critical findings at HEAD are in `pack-reports/PACK-14_REPORT.md`.
- Keyboard and axe on each dialog type (`e2e/pack11-dialogs.spec.js`), the DPR steps (`e2e/pack14-dpr-accessibility.spec.js`).
- Reduced motion: every animation and transition is cut when the system asks for it (`src/client/styles.css`, `prefers-reduced-motion`).

## 4. Sign-off
| Tester | Assistive technology and version | Device and browser | Build (commit) | Date | Overall result |
|---|---|---|---|---|---|
| | | | | | |

# Using the design tokens (PACK-05)

The tokens come from one source, `src/shared/design/design-tokens.json`; `npm run erp:tokens` writes `src/client/design-tokens.css` (and the Tailwind preset). Pages and components use the generated CSS variables, never a raw value. Three checks keep it that way:

| Check | What it stops | Where |
|---|---|---|
| `erp/no-hardcoded-color` (ESLint, error) | a hex, `rgb()` or `hsl()` colour in JS/JSX | `eslint-rules/no-hardcoded-color.js` |
| `tests/design-token-usage.test.js` | a `var(--erp-…)` that no token or stylesheet defines | |
| `tests/design-literals.test.js` (the ratchet) | **more** literal colours or lengths in any client file than `docs/erp/design/literals-baseline.json` allows, or any in a new file | `eslint-rules/design-literals.js`, `scripts/design_literals.mjs` |

The ratchet counts literal colours and px values in stylesheets, and lengths written as values in style objects and strings in JS/JSX (`{ minHeight: 44 }`, `'12px 8px'`). 0 and 1 px (hairlines) do not count. A file may only go down. After a reviewed reduction, lower the baseline with `node scripts/design_literals.mjs --update` and commit it with the change. `node scripts/design_literals.mjs` lists the files with the most literals.

## Which token
| You need | Use | Value (comfortable) |
|---|---|---|
| a touch target (button, select, input on a phone) | `var(--erp-target-min)` | 44 px |
| a large touch target (the main action of a field page) | `var(--erp-target-large)` | 48 px |
| a control or row height that follows the user's density | `var(--erp-control-h)`, `var(--erp-row-h)` | 44 / 48 px (compact 28 / 32) |
| space between things | `var(--erp-space-1)` … `var(--erp-space-11)` | 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px |
| table cell padding | `var(--erp-cell-py)` / `var(--erp-cell-px)` | follows density |
| corner radius | `var(--erp-radius-xs|sm|md|lg|xl|pill)` | 2, 4, 6, 8, 12 px, pill |
| text size | `var(--erp-font-size-caption|body-sm|body|body-lg|title-sm|title|page-title|display|kpi)` or the shorthand `font: var(--erp-type-body)` | 12–32 px (page title and display are fluid) |
| a colour | `var(--erp-color-…)`: text, background, border, status (`-status-<tone>-fg|bg|solid`), chart (`--erp-chart-1…8`) | per theme |

## Do and don't
```jsx
// Don't: values in the page
<button style={{ minHeight: 48, padding: '8px 12px', color: '#1D4F91' }}>Issue</button>
// Do: the tokens (the same sizes today, and they follow the theme and the density)
<button style={{ minHeight: 'var(--erp-target-large)', padding: 'var(--erp-space-3) var(--erp-space-4)', color: 'var(--erp-color-text-link)' }}>Issue</button>
```
```css
/* Don't: a fallback colour behind a token that always exists; it hides a typo in the token name */
.cv-box { stroke: var(--erp-color-status-info-solid, #2563eb); }
/* Do */
.cv-box { stroke: var(--erp-color-status-info-solid); }
```
- A size that is a component's own layout (a 120 px column, a 560 px dialog) is not a spacing token. Leave it as a literal (the ratchet counts it, and that is fine) or give the component a class in `ui-v3.css`.
- Never add a token "to make the count go down". Add one when a value is a design decision used in more than one place, in `design-tokens.json`, and run `npm run erp:tokens`.

## Themes
Light, dark and high-contrast are blocks of `design-tokens.css` selected by `<html data-theme>`. The `design-tokens` regression stage checks every text and background pair: AA in light and dark, AAA in high contrast (138 pairs at PACK-05). Sizes and spacing are the same in every theme; `data-density` (comfortable, compact, cozy, touch) changes control and row heights.

## Status (PACK-05, 2026-11-28)
Literal colours 5 → 1 and literal lengths 2,333 → 1,030 in the client: every `minHeight: 44/48` (1,298) is now a target token, the token fallbacks of `ui-v3.css` are gone, and the spacings of PACK-02's 30 worst pages that equal a token use it. The rest is in the baseline and can only go down.

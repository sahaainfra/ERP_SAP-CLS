import js from '@eslint/js';
import globals from 'globals';
import erp from './eslint-rules/no-hardcoded-color.js';
import noText from './eslint-rules/no-hardcoded-text.js';
import noLocalDate from './eslint-rules/no-local-date-format.js';
import kpiInFormGrid from './eslint-rules/kpi-in-form-grid.js';
import pageHeaderRequired from './eslint-rules/page-header-required.js';

export default [
  { ignores: ['node_modules/**', 'dist/**', '.deploy*/**', 'artifacts/**', 'coverage/**', 'reports/**', 'data/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2025, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }], eqeqeq: ['error', 'always', { null: 'ignore' }] },
  },
  {
    files: ['src/client/**/*.{js,jsx}', 'e2e/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  // part 166.4: the boot guard is a classic browser script served as it is from public/ (it must run where modules failed)
  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
    rules: { 'no-unused-vars': ['error', { caughtErrors: 'none' }] },
  },
  // part 03.01, BR-01: colours in component code come from the design tokens
  {
    files: ['src/client/**/*.{js,jsx}'],
    ignores: ['src/client/platform/design/icon-map.js'],
    plugins: { erp },
    rules: { 'erp/no-hardcoded-color': 'error' },
  },
  // part 166.1 F-04: one date and time format for the whole application
  {
    files: ['src/client/**/*.{js,jsx}'],
    plugins: { dates: noLocalDate },
    rules: { 'dates/no-local-date-format': 'error' },
  },
  // part 166.2, FR-03: key figures are KpiTile/KpiRow, never boxes in the form grid; a page names itself with PageHeader
  {
    files: ['src/client/**/*.jsx'],
    plugins: { ui: { rules: { ...kpiInFormGrid.rules, ...pageHeaderRequired.rules } } },
    rules: { 'ui/kpi-in-form-grid': 'error', 'ui/page-header-required': 'error' },
  },
  {
    files: ['src/client/platform/design/PageHeader.jsx'],
    rules: { 'ui/page-header-required': 'off' },
  },
  // part 03.09, BR-01: the screens moved to the translation catalogue carry no text of their own
  {
    files: [
      'src/client/platform/shell/AppShell.jsx', 'src/client/platform/shell/ShellParts.jsx', 'src/client/platform/shell/CommandPalette.jsx', 'src/client/platform/feedback/states.jsx',
      'src/client/modules/ui/FieldHomePage.jsx', 'src/client/modules/ui/ScannerPage.jsx', 'src/client/modules/ui/FormatPanel.jsx', 'src/client/platform/device/CodeScanner.jsx', 'src/client/platform/device/LocationNotice.jsx',
      'src/client/platform/device/PwaBanners.jsx', 'src/client/platform/device/DeviceMenu.jsx',
    ],
    plugins: { text: { rules: { 'no-hardcoded-text': noText } } },
    rules: { 'text/no-hardcoded-text': 'error' },
  },
];

import js from '@eslint/js';
import globals from 'globals';
import erp from './eslint-rules/no-hardcoded-color.js';
import noText from './eslint-rules/no-hardcoded-text.js';

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
  // part 03.01, BR-01: colours in component code come from the design tokens
  {
    files: ['src/client/**/*.{js,jsx}'],
    ignores: ['src/client/platform/design/icon-map.js'],
    plugins: { erp },
    rules: { 'erp/no-hardcoded-color': 'error' },
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

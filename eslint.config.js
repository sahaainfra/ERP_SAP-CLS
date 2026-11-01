import js from '@eslint/js';
import globals from 'globals';
import erp from './eslint-rules/no-hardcoded-color.js';

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
];

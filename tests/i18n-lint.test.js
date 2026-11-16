import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Linter } from 'eslint';
import noText from '../eslint-rules/no-hardcoded-text.js';
import { CATALOGUE } from '../src/shared/i18n/locales/index.js';

// Part 03.09: BR-01 (no user-visible text in a component) and FR-01 (every key a screen asks for exists, in both languages).
const lint = (code) => new Linter().verify(code, [{ files: ['**/*.jsx'], languageOptions: { ecmaVersion: 2025, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { text: { rules: { 'no-hardcoded-text': noText } } }, rules: { 'text/no-hardcoded-text': 'error' } }], { filename: 'a.jsx' });

test('BR-01 the rule refuses text in JSX, in the attributes people read and in a literal shown as a child, and allows code, symbols and the brand', () => {
  assert.equal(lint('const A = () => <p>Save the form</p>;').length, 1);
  assert.equal(lint('const A = () => <button aria-label="Close menu" />;').length, 1);
  assert.equal(lint('const A = () => <input placeholder="Search" title="Find" />;').length, 2);
  assert.equal(lint("const A = ({ on }) => <p>{on ? 'Online' : 'Offline'}</p>;").length, 2);
  assert.equal(lint('const A = () => <p>{t(\'save\')}</p>;').length, 0);
  assert.equal(lint('const A = () => <p><code>ui.search</code> <kbd>Ctrl</kbd></p>;').length, 0);
  assert.equal(lint('const A = () => <strong>ERP</strong>;').length, 0);
  assert.equal(lint('const A = ({ n }) => <span>{n} / 5 · 12:30 ({n}%)</span>;').length, 0);
  assert.equal(lint('const A = () => <input aria-label={t(\'x\')} className="btn big" />;').length, 0, 'classes and ids are not text');
});

const FILES = {
  'src/client/platform/shell/AppShell.jsx': ['shell'], 'src/client/platform/shell/ShellParts.jsx': ['shell', 'common'], 'src/client/platform/shell/CommandPalette.jsx': ['palette', 'shell', 'common'],
  'src/client/platform/feedback/states.jsx': ['common'], 'src/client/modules/ui/FieldHomePage.jsx': ['field'], 'src/client/modules/ui/ScannerPage.jsx': ['field'], 'src/client/modules/ui/FormatPanel.jsx': ['format'],
  'src/client/platform/device/CodeScanner.jsx': ['field'], 'src/client/platform/device/LocationNotice.jsx': ['field'], 'src/client/platform/device/PwaBanners.jsx': ['field'], 'src/client/platform/device/DeviceMenu.jsx': ['field'],
  'src/client/modules/core/pages/ui.jsx': ['common'], 'src/client/modules/site/DprEntryPage.jsx': ['site', 'field'], 'src/client/platform/device/VoiceNote.jsx': ['field'],
};

test('T-01 FR-01 every text key the field, shell and common screens ask for exists in English and Hindi, and every key of the field area is used', () => {
  const used = new Set();
  for (const [file, namespaces] of Object.entries(FILES)) {
    const src = readFileSync(join(import.meta.dirname, '..', file), 'utf8');
    // `const t = useT('field')` binds t to one area per file; a second binding (`ts`, `tc`) is read the same way
    const bound = Object.fromEntries([...src.matchAll(/const (\w+) = useT\('(\w+)'\)/g)].map((m) => [m[1], m[2]]));
    assert.ok(Object.keys(bound).length > 0, `${file} uses the catalogue`);
    for (const [name, ns] of Object.entries(bound)) {
      assert.ok(namespaces.includes(ns), `${file} reads area ${ns}`);
      for (const m of src.matchAll(new RegExp(`\\b${name}\\(\\s*(?:'([^']+)'|\`([^\`$]+)\`)`, 'g'))) {
        const k = m[1] ?? m[2];
        const base = k.replace(/_(one|other)$/, '');
        const found = [k, `${base}_one`, `${base}_other`].some((x) => CATALOGUE.en[ns]?.[x] !== undefined);
        assert.ok(found, `${file}: ${ns}.${k} is not in the English catalogue`);
        assert.ok([k, `${base}_one`, `${base}_other`].some((x) => CATALOGUE.hi[ns]?.[x] !== undefined), `${file}: ${ns}.${k} has no Hindi`);
        used.add(`${ns}.${base}`);
      }
    }
  }
  // dynamic keys (`theme.${th}`, `style.${...}`, `hour.${...}`) are checked by their prefix
  for (const k of Object.keys(CATALOGUE.en.field)) {
    const base = k.replace(/_(one|other)$/, '');
    assert.ok(used.has(`field.${base}`), `field.${k} is not used by any field screen`);
  }
});

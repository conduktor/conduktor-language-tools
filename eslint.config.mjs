import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import regexp from 'eslint-plugin-regexp';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist/', '**/out/', '**/.vscode-test/', '**/node_modules/', 'extensions/zed/target/']),
  js.configs.recommended,
  // The strictest typescript-eslint offers, with type information.
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  regexp.configs['flat/recommended'],
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // A count reads naturally in a message; an object, undefined or a boolean in a template is still refused.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // `() => doSomething()` is how callbacks are written here; a void value used anywhere else is still refused.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
    },
  },
  {
    // The unit tests (Vitest); the VS Code suite in extensions/vscode/src/test runs on Mocha.
    files: ['packages/*/test/**', 'extensions/vscode/test/**'],
    plugins: { vitest },
    rules: vitest.configs.recommended.rules,
  },
  {
    // A test asserts that a value exists; `!` says so where an expect would add nothing.
    files: ['packages/*/test/**', 'extensions/vscode/test/**', 'extensions/vscode/src/test/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // Build and maintenance scripts: plain JavaScript run by Node, outside any tsconfig.
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly' } },
  },
]);

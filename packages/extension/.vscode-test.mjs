import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/**/*.test.js',
  version: 'stable',
  workspaceFolder: mkdtempSync(join(tmpdir(), 'conduktor-smoke-')),
  launchArgs: ['--disable-extensions'],
  mocha: { ui: 'tdd', timeout: 180_000 },
});

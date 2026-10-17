import { defineConfig } from 'vitest/config';

// The UI tests drive a VS Code window, one at a time: `pnpm test:ui` builds the extension first. Paths are from
// extensions/vscode, where it runs.
export default defineConfig({
  test: {
    include: ['test/ui/**/*.ui.ts'],
    testTimeout: 120_000,
    fileParallelism: false,
  },
});

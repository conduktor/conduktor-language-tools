import { defineConfig } from 'vitest/config';

// Core holds the logic every editor runs; its coverage only goes up. The thresholds sit just under what the suite
// covers: raise them when it covers more.
export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      include: ['src/**'],
      reporter: ['text-summary'],
      thresholds: { lines: 98, branches: 87, functions: 97 },
    },
  },
});

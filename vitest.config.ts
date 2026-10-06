import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** The performance budgets measure wall-clock time, so that file runs on its own, after every other test (group 1). */
const PERFORMANCE_TESTS = 'tests/shared/ingest/performance.test.ts';
// real-browser suites are opt-in (npm run test:browser): they need Playwright + Chromium and a built app
const BROWSER_TESTS = 'tests/**/*.browser.test.{ts,tsx}';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    env: { TZ: 'America/Chicago' },
    restoreMocks: true,
    // Two groups, run one after the other: every test in parallel (0), then the performance budgets alone (1), so they
    // never compete for the CPU with the rest of the suite. Budgets and thresholds are the test's own, unchanged.
    // (include/exclude live in each project: inherited arrays would be merged, not replaced.)
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: [...configDefaults.exclude, BROWSER_TESTS, PERFORMANCE_TESTS],
          sequence: { groupOrder: 0 }
        }
      },
      {
        extends: true,
        test: { name: 'performance', include: [PERFORMANCE_TESTS], exclude: [...configDefaults.exclude, BROWSER_TESTS], sequence: { groupOrder: 1 } }
      }
    ]
  }
});

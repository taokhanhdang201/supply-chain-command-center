import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** Files holding a test with a time limit that a busy machine can pass ("2 MB single token": 5 s; the conformance kit's
 *  "handles the hostile pack": 15 s). They run after the parallel group, one file at a time (group 1). */
const TIMING_TESTS = ['tests/shared/ingest/pipelineLimits.test.ts', 'tests/shared/ingest/conformance.test.ts'];
/** The performance budgets measure wall-clock time, so that file runs on its own, after every other test (group 2). */
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
    // Three groups, run one after the other: every test in parallel (0), then the time-limited files one at a time (1),
    // then the performance budgets alone (2), so none of them competes for the CPU with the rest of the suite. Every
    // check, limit and timeout is the test's own, unchanged: only the schedule differs.
    // (include/exclude live in each project: inherited arrays would be merged, not replaced.)
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: [...configDefaults.exclude, BROWSER_TESTS, PERFORMANCE_TESTS, ...TIMING_TESTS],
          sequence: { groupOrder: 0 }
        }
      },
      {
        extends: true,
        test: { name: 'timing', include: TIMING_TESTS, exclude: [...configDefaults.exclude, BROWSER_TESTS], fileParallelism: false, sequence: { groupOrder: 1 } }
      },
      {
        extends: true,
        test: { name: 'performance', include: [PERFORMANCE_TESTS], exclude: [...configDefaults.exclude, BROWSER_TESTS], sequence: { groupOrder: 2 } }
      }
    ]
  }
});

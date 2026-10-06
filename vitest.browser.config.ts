// Opt-in real-browser tests (`npm run build && npm run test:browser`); see tests/tester/v15.layout.browser.test.ts.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.browser.test.{ts,tsx}'],
    testTimeout: 30000
  }
});

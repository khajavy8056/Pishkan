import { defineConfig } from 'vitest/config';
import base from './vitest.config.js';

// Opt-in acceptance audit. These assertions express the requested behavior,
// not the current behavior. Failures document release blockers; do not skip or
// invert them just to obtain a green report. Uses only the temporary test DB.
export default defineConfig({
  ...base,
  test: { ...base.test, include: ['audit/**/*.acceptance.test.ts'] },
});

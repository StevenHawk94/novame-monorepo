import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure functions, no DOM, no globals. Node is enough.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

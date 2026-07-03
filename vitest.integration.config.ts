import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 240000,
    hookTimeout: 240000,
    reporters: ['default'],
    isolate: true,
  },
});

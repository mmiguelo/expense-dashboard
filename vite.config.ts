import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the build works under https://<user>.github.io/<repo>/
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});

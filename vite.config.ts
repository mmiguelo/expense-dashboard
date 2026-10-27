import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the build works under https://<user>.github.io/<repo>/
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
    // Dates are local; pin the zone so results don't depend on the machine.
    env: { TZ: 'Europe/Lisbon' },
  },
});

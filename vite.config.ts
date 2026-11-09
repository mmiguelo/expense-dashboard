import { runnerImport } from 'vite';
import { defineConfig } from 'vitest/config';
import type * as NotFoundPage from './src/notFoundPage.ts';

export default defineConfig({
  // Relative asset paths, so the build works under https://<user>.github.io/<repo>/
  base: './',
  plugins: [
    {
      // dist/404.html: GitHub Pages shows it for any missing path. Texts from src/i18n.
      name: 'not-found-page',
      apply: 'build',
      async generateBundle() {
        // Loaded through Vite, like the app's own code, rather than imported by the config.
        const { module } = await runnerImport<typeof NotFoundPage>('/src/notFoundPage.ts');
        this.emitFile({ type: 'asset', fileName: '404.html', source: module.renderNotFoundPage() });
      },
    },
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    // Dates are local; pin the zone so results don't depend on the machine.
    env: { TZ: 'Europe/Lisbon' },
  },
});

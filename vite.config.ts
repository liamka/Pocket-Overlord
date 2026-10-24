import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.PAGES_BASE_PATH || '/',
  test: { include: ['tests/**/*.test.ts'] },
  build: {
    target: ['chrome107', 'firefox104', 'safari16'],
    rollupOptions: { input: { game: 'index.html', fonts: 'fonts.html', panelDesigns: 'panel-designs.html' } },
  },
});

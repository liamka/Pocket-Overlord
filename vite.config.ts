import { defineConfig } from 'vitest/config';

export default defineConfig({
  appType: 'mpa',
  base: process.env.PAGES_BASE_PATH || '/',
  test: { include: ['tests/**/*.test.ts'], testTimeout: 15000 },
  build: {
    target: ['chrome107', 'firefox104', 'safari16'],
    rollupOptions: { input: { game: 'index.html' } },
  },
});

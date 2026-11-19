import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Greater London's cinemas, from the listings the site is built with, so that the page
// knows which listings file a visitor needs before it downloads either.
const areas = 'public/data/areas.json';
const london: string[] = existsSync(areas) ? JSON.parse(readFileSync(areas, 'utf8'))['Greater London'] ?? [] : [];

export default defineConfig({
  // Relative paths, so the site works under any GitHub Pages address.
  base: './',
  define: { __LONDON__: JSON.stringify(london) },
  // The browser tests in e2e/ are Playwright's, not Vitest's.
  test: { include: ['src/**/*.test.ts'] },
});

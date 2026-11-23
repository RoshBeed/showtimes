import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/** The commit and branch the site is built from: GitHub Actions says, or else git does. */
function git(args: string): string {
  try { return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
}
const version = {
  sha: process.env.GITHUB_SHA || git('rev-parse HEAD'),
  branch: process.env.GITHUB_REF_NAME || git('rev-parse --abbrev-ref HEAD'),
  built: new Date().toISOString(),
};

// Greater London's cinemas, from the listings the site is built with, so that the page
// knows which listings file a visitor needs before it downloads either.
const areas = 'public/data/areas.json';
const london: string[] = existsSync(areas) ? JSON.parse(readFileSync(areas, 'utf8'))['Greater London'] ?? [] : [];
// The listings documents' names, which change with their contents (scripts/export.ts), so the page
// asks for the listings it was built with, never another build's still in a cache.
const manifest = 'public/data/manifest.json';
const documents = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : { listings: 'listings.json.gz', london: 'london.json.gz' };

export default defineConfig({
  // Relative paths, so the site works under any GitHub Pages address.
  base: './',
  define: { __LONDON__: JSON.stringify(london), __VERSION__: JSON.stringify(version), __DATA__: JSON.stringify(documents) },
  // The browser tests in e2e/ are Playwright's, not Vitest's.
  test: { include: ['src/**/*.test.ts'] },
});

// Writes the listings the site downloads, from each chain's SQLite file:
//   node scripts/export.ts <folder> <chain>.sqlite...
//   listings.json.gz  every cinema
//   london.json.gz    Greater London only, for visitors who tick nothing else
//   areas.json        which cinemas are Greater London's, built into the page
//   badge.json        the README's listings badge (src/badge.ts)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { CHAINS } from '../src/chains/index.ts';
import { listingsBadge } from '../src/badge.ts';
import { exportListings, type Source } from '../src/export.ts';
import type { Titles } from '../src/titles.ts';

const [to, ...files] = process.argv.slice(2);
if (!to || !files.length) {
  console.error('usage: node scripts/export.ts <folder> <chain>.sqlite...');
  process.exit(2);
}
// Each file is named after its chain: odeon.sqlite.
const sources: Source[] = files.map((file) => {
  const chain = CHAINS[basename(file, '.sqlite')];
  if (!chain) throw new Error(`${file}: no chain named ${basename(file, '.sqlite')} in src/chains/`);
  return { chain, sqlite: new DatabaseSync(file, { readOnly: true }) };
});
// Claude's clean titles, kept beside the chains' files (src/titles.ts), and the corrections made to them.
const cleaned = join(dirname(files[0]), 'titles.json');
const titles: Titles = {
  ...(existsSync(cleaned) ? JSON.parse(readFileSync(cleaned, 'utf8')) : {}),
  ...JSON.parse(readFileSync(new URL('../src/titles.overrides.json', import.meta.url), 'utf8')),
};
console.log(existsSync(cleaned) ? `Cleaning titles with ${cleaned}` : `No ${cleaned}: titles stay as the chains wrote them`);
mkdirSync(to, { recursive: true });
const all = exportListings(sources, undefined, titles);
const london = all.cinemas.filter((cinema) => cinema.town === 'Greater London').map((cinema) => cinema.id);
for (const [name, data] of [['listings', all], ['london', exportListings(sources, new Set(london), titles)]] as const) {
  writeFileSync(`${to}/${name}.json.gz`, gzipSync(JSON.stringify(data)));
  console.log(`Wrote ${data.rows.length} showings to ${to}/${name}.json.gz`);
}
writeFileSync(`${to}/areas.json`, JSON.stringify({ 'Greater London': london }));
writeFileSync(`${to}/badge.json`, JSON.stringify(listingsBadge(all.chains)));

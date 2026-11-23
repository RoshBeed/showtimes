// The listings: one JSON document, downloaded once and held in memory.
import { open, type Listings } from './queries';

declare const __DATA__: { listings: string; london: string } | undefined;
/** The names of the listings documents this page was built with (scripts/export.ts's manifest). */
export const DATA = typeof __DATA__ === 'undefined' ? { listings: 'listings.json.gz', london: 'london.json.gz' } : __DATA__;

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  // Some hosts decompress a .gz file on the way; only unpack what is still packed.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function openListings(url: string): Promise<Listings> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The listings could not be downloaded (HTTP ${response.status})`);
  const bytes = await gunzip(new Uint8Array(await response.arrayBuffer()));
  return open(JSON.parse(new TextDecoder().decode(bytes)));
}

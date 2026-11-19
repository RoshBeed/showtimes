// The chains the site is built from, by the name their ingest gives them.
import type { Chain } from './chain';
import { odeon } from './odeon.ts';

export const CHAINS: Record<string, Chain> = Object.fromEntries([odeon].map((chain) => [chain.id, chain]));

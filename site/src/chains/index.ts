// The chains the site is built from, by the name their ingest gives them.
import type { Chain } from './chain';
import { everyman, showcase } from './boxoffice.ts';
import { odeon } from './odeon.ts';
import { picturehouse } from './picturehouse.ts';
import { vue } from './vue.ts';
import { light } from './light.ts';
import { olympic } from './olympic.ts';
import { reel } from './reel.ts';
import { princecharles } from './princecharles.ts';
import { rio } from './rio.ts';
import { actone, lexi, phoenix } from './opus.ts';
import { cineworld, curzon } from './vista.ts';

export const CHAINS: Record<string, Chain> = Object.fromEntries([odeon, everyman, showcase, vue, picturehouse, cineworld, curzon, light, olympic, reel, princecharles, rio, actone, lexi, phoenix].map((chain) => [chain.id, chain]));

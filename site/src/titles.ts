// What Claude made of each title the chains list (ingest/src/showtimes_ingest/titles.py),
// kept as titles.json beside the chains' files on the data release: the film's own name,
// the year the title gives, and what the rest of the title said about the showing, as tags.
// titles.overrides.json, beside this file, corrects any of Claude's decisions.
import type { TagKind } from './tags';

export interface Tag { label: string; kind: TagKind }
export interface Cleaned { title: string; year: number | null; tags: Tag[] }
/** Each raw title as a chain lists it, cleaned. */
export type Titles = Record<string, Cleaned>;

/** Titles that match once case, accents, punctuation and spacing are set aside. */
export const titleKey = (title: string) => title.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '');

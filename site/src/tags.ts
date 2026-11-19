// The kinds of tag a showing has, in the shared vocabulary each chain's export
// maps its own tags to (src/chains/), and the certificates' ages.

export type TagKind = 'Picture' | 'Language' | 'Accessibility' | 'Events' | 'Seating' | 'Pricing';

/** Each tag's kind, as the listings name them; learnt when they are opened. */
const kinds = new Map<string, TagKind>();
export function learnTags(tags: Record<string, TagKind>) {
  for (const [tag, kind] of Object.entries(tags)) kinds.set(tag, kind);
}
export const tagKind = (tag: string): TagKind => kinds.get(tag) ?? 'Events';

/** The tags worth a table column: picture and language. */
export function formats(tags: string[], which: TagKind[] = ['Picture', 'Language']): string {
  return tags.filter((tag) => which.includes(tagKind(tag))).join(', ');
}

/** The youngest age a certificate admits, to sort by: U, PG, 12A, 15, 18.
 *  Null for a film not yet rated, which sorts last. */
export function certificateAge(certificate: string): number | null {
  const [first = ''] = certificate.trim().split(' '); // "PG Ire"
  if (first === 'U' || first === 'G') return 0;
  if (first === 'PG') return 8;
  const age = parseInt(first, 10); // 12A, 15, 15A, 16, 18
  return Number.isNaN(age) ? null : age;
}

// The listings week UK chains keep: the ingest records the Tuesday whose
// Friday-to-Thursday week it holds, and that week ends nine days later.
export function weekFullUntil(state: Map<string, string>): string | null {
  const week = state.get('release_week');
  return week ? new Date(Date.parse(week + 'T00:00:00Z') + 9 * 86400000).toISOString().slice(0, 10) : null;
}

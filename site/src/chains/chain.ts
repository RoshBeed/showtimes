// A cinema chain's half of the export: how its stored record (the SQLite file its
// ingest writes, in the shared schema) reads in the site's shared vocabulary.
// The ingest's half, ingest/src/showtimes_ingest/chains/<id>/, fetches it.
import type { TagKind } from '../tags';

export interface Chain {
  /** As the ingest names it, and the start of every ID it exports: `odeon` → `odeon-155`. */
  id: string;
  /** For people: `ODEON`. */
  name: string;
  /** The page that books a showing, with `{id}` for the showing's own ID. */
  booking: string;
  /** A cinema's name in full, from its stored name: `London West End` → `ODEON London West End`. */
  cinemaName(name: string): string;
  /** A cinema's name without what every one of the chain's shares: `London West End` → `West End`. */
  short(name: string): string;
  /** The town or area a cinema is listed under; `Greater London` for London's. */
  town(cinema: { id: string; name: string; city: string }): string;
  /** A showing's raw tag as people read it, and what kind it is; null leaves it out. */
  tag(raw: string): { label: string; kind: TagKind } | null;
  /** A seat type as people read it: price tiers of one seat are one seat. */
  seat(raw: string): string;
  /** A distributor as people read it: one name for its UK and Irish arms. */
  distributor(raw: string): string;
  /** Whether a showing is a special event (concerts, theatre, screen hire), left out unless asked for. */
  isEvent(showing: { title: string; tags: string[] }): boolean;
  /** The last day whose whole schedule is published, from the chain's stored state; later days are advance bookings. */
  fullUntil(state: Map<string, string>): string | null;
}

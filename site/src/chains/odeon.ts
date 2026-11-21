// ODEON, the first chain. Its tags are its own strings ("IMAX 3D_Web", "ODEON Luxe"),
// its addresses sometimes name a street as the city, and it publishes each
// Friday-to-Thursday week on the Tuesday before.
import type { Chain } from './chain';
import { weekFullUntil } from './week.ts';
import type { TagKind } from '../tags';

// A picture format, or one of ODEON's variants of it: "IMAX 3D_Web", "XL 3D Web", "Laser 3D".
const PICTURE = /^(IMAX|3D|4K|Dolby|Laser|iSense|XL|Infinity Vision)\b/;
const SUBTITLES = new Set(['English (Sub)', 'Open Captioned']);
// Seat types ODEON also lists among a showing's tags; the Seating column covers them.
const SEATS = new Set(['Recliner', 'ODEON Luxe', 'Luxe Suite', 'VIP Bed']);
const ACCESS = new Set(['Wheelchair Accessible', 'Audio Described', 'Autism Friendly', 'Flash Warning', 'Watchword']);
const PRICING = new Set(['Saver', 'Bargain Wednesday']);
const LABELS: Record<string, string> = {
  'English (Sub)': 'English subtitles',
  'Open Captioned': 'Captioned',
};

/** Greater London's ODEONs, among them outer boroughs whose address city is not London. */
export const LONDON = new Set('090 125 153 155 158 200 486 536 555 593 694 695 838 852 858 888 949 963 995'.split(' '));
// Some ODEON addresses use a street, county or postcode as their city.
const PLACES: Record<string, string> = {
  '031': 'Dublin', '033': 'Dublin', '044': 'Dundee', '075': 'Waterford', '076': 'Dublin', '078': 'Dublin',
  '086': 'Exeter', '508': 'Dunfermline', '530': 'Glasgow', '615': 'Glasgow', '750': 'Edinburgh',
  '755': 'Andover', '758': 'Loughborough', '853': 'Northwich', '954': 'Cardiff', '955': 'Manchester',
};

function kind(tag: string): TagKind {
  if (PICTURE.test(tag)) return 'Picture';
  if (tag.endsWith(' (Audio)') || tag === 'Dubbed' || SUBTITLES.has(tag)) return 'Language';
  if (ACCESS.has(tag)) return 'Accessibility';
  if (SEATS.has(tag)) return 'Seating';
  if (PRICING.has(tag) || (/^[£€$]/.test(tag) && /web$/i.test(tag))) return 'Pricing';
  return 'Events'; // anything new ODEON invents shows up here
}

export const odeon: Chain = {
  id: 'odeon',
  name: 'ODEON',
  booking: 'https://www.odeon.co.uk/ticketing/seat-picker/?showtimeId={id}',
  cinemaName: (name) => `ODEON ${name}`,
  short: (name) => name.replace(/^London /, ''),
  town: (cinema) => (LONDON.has(cinema.id) ? 'Greater London' : PLACES[cinema.id] ?? (cinema.city.trim().replace(/\s+/g, ' ') || cinema.name)),
  tag(raw) {
    const tag = raw.trim(); // ODEON's own names sometimes end in a space ("3D - Web ")
    // Without what ODEON adds for its own use: "Hindi (Audio)", "3D - Web", "XL 3D Web".
    return { label: LABELS[tag] ?? tag.replace(/ \(Audio\)$/, '').replace(/[ _-]+web$/i, ''), kind: kind(tag) };
  },
  // ODEON prices one seat type in tiers ("Recliner Saver"); the type is what matters.
  seat: (raw) => raw.trim().replace(/ (Saver|Popular)$/, ''),
  distributor: (raw) => raw.replace(/ IR$/, ''),
  // Event Cinema is ODEON's tag for concerts, theatre and opera. Hiring a screen
  // is listed as a film too, and is no more one than a concert is.
  isEvent: ({ title, tags }) => tags.some((tag) => tag.trim() === 'Event Cinema') || title.startsWith('Screen Hire'),
  fullUntil: weekFullUntil,
};

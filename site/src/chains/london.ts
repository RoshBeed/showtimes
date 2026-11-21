// Whether an address is in Greater London, by its postcode district. Every district
// of E, EC, N, NW, SE, SW, W and WC is; of the outer areas, only the districts
// within the London boroughs (Bromley, Croydon, Bexley, Enfield, Harrow, Redbridge,
// Kingston, Havering, Sutton, Richmond and Hounslow, Hillingdon, Biggin Hill).
const INNER = new Set(['E', 'EC', 'N', 'NW', 'SE', 'SW', 'W', 'WC']);
const OUTER: Record<string, number[]> = {
  BR: [1, 2, 3, 4, 5, 6, 7],
  CR: [0, 2, 4, 5, 7, 8],
  DA: [5, 6, 7, 8, 14, 15, 16, 17, 18],
  EN: [1, 2, 3, 4, 5],
  HA: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  IG: [1, 2, 3, 4, 5, 6, 8, 11],
  KT: [1, 2, 3, 4, 5, 6, 9],
  RM: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  SM: [1, 2, 3, 4, 5, 6],
  TW: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  UB: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  TN: [16],
};

export function inGreaterLondon(postcode: string, city = ''): boolean {
  // Some chain directories explicitly say London while leaving the postcode empty.
  if (/^(greater )?london$/i.test(city.trim())) return true;
  const match = /^([A-Z]{1,2})(\d{1,2})[A-Z]?\b/.exec(postcode.trim().toUpperCase());
  if (!match) return false;
  const [, area, district] = match;
  return INNER.has(area) || (OUTER[area] ?? []).includes(Number(district));
}

import { describe, expect, it } from 'vitest';
import { cineworld, curzon } from './vista.ts';

describe('Vista cinema operators', () => {
  it('groups London postcodes and preserves towns elsewhere', () => {
    for (const chain of [cineworld, curzon]) {
      expect(chain.town({ id: '123', name: 'Feltham', city: 'Middlesex', postcode: 'TW13 7EQ' })).toBe('Greater London');
      expect(chain.town({ id: '123', name: 'Swindon', city: 'Swindon', postcode: 'SN5 7DN' })).toBe('Swindon');
      expect(chain.cinemaName(`${chain.name} Soho`)).toBe(`${chain.name} Soho`);
    }
  });
  it('uses each operator’s booking route and interprets Vista attributes', () => {
    expect(cineworld.booking.replace('{id}', '103-123')).toBe('https://web.cineworld.co.uk/order/showtimes/103-123/seats');
    expect(curzon.booking.replace('{id}', 'SOH1-123')).toBe('https://www.curzon.com/ticketing/seats/?showtimeId=SOH1-123');
    expect(cineworld.tag('IMAX Film')).toEqual({ label: 'IMAX', kind: 'Picture' });
    expect(cineworld.tag('Infinity Vision')?.kind).toBe('Picture');
    expect(cineworld.tag('Recliner')?.kind).toBe('Seating');
    expect(cineworld.tag('Strobe Lighting')?.kind).toBe('Accessibility');
    expect(cineworld.tag('2D Film')).toBeNull();
    expect(curzon.tag('Subtitled')?.kind).toBe('Language');
    expect(cineworld.isEvent({ title: 'Concert', tags: ['Alt Content Recorded'] })).toBe(true);
    expect(cineworld.isEvent({ title: 'Private screening', tags: ['Screen Hire'] })).toBe(true);
  });
});

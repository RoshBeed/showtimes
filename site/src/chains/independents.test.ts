import { expect, test } from 'vitest';
import * as q from '../queries';
import { light } from './light';
import { olympic } from './olympic';
import { reel } from './reel';
import { actone, rio, lexi, phoenix } from './opus';

test('independent cinema tags preserve formats and accessibility without inventing details', () => {
  expect(light.tag('Audio Description')).toEqual({ label: 'Audio Described', kind: 'Accessibility' });
  expect(light.tag('3D')).toEqual({ label: '3D', kind: 'Picture' });
  expect(light.tag('15 Certificate')).toBeNull();
  expect(light.tag('2D')).toBeNull();
  expect(light.isEvent({ title: 'Hamlet', tags: ['Event Cinema'] })).toBe(true);
  expect(light.isEvent({ title: 'A Film', tags: ['Audio Description'] })).toBe(false);
  expect(olympic.tag('Dolby Cinema')).toEqual({ label: 'Dolby Cinema', kind: 'Picture' });
  expect(olympic.tag('Subtitled')).toEqual({ label: 'English subtitles', kind: 'Language' });
  expect(olympic.cinemaName('The Cinema in the Arches')).toBe('The Cinema in the Arches');
  expect(reel.tag('Lounge')).toEqual({ label: 'Lounge', kind: 'Seating' });
  expect(reel.tag('Subtitled')).toEqual({ label: 'English subtitles', kind: 'Language' });
  expect(reel.town({ id: 'borehamwood', name: 'Borehamwood', city: 'Borehamwood' })).toBe('Borehamwood');
  expect(rio.tag('RS')).toEqual({ label: 'Relaxed Screening', kind: 'Accessibility' });
  expect(actone.tag('RS')).toEqual({ label: 'Restoration', kind: 'Picture' });
  expect(lexi.tag('HOH')).toEqual({ label: 'Captioned', kind: 'Language' });
  expect(phoenix.tag('CC')).toEqual({ label: 'Closed Captions', kind: 'Language' });
});

test('booking uses the Light cinema host and the original Olympic ticket URL', () => {
  const db = q.open({
    chains: [light, olympic].map(({ id, name, booking, bookingByCinema }) => ({ id, name, booking, bookingByCinema, ingested: null, fullUntil: null })),
    ingested: null, fullUntil: null, films: [], availability: [], events: [], screens: [], rows: [], values: [], tags: {},
    cinemas: [
      { id: 'light-stockport', chain: 'light', name: 'The Light Stockport', short: 'Stockport', town: 'Stockport', stored: true, address: {} },
      { id: 'olympic-arches', chain: 'olympic', name: 'The Cinema in the Arches', short: 'the Arches', town: 'Greater London', stored: true, address: {} },
    ],
  });
  expect(q.booking(db, { cinemaId: 'light-stockport', id: '145341' })).toBe('https://stockport.thelight.co.uk/#!book/cinema/145341');
  const url = 'https://web2.empire.mycloudcinema.com/#/book/64041/subtitled';
  expect(q.booking(db, { cinemaId: 'olympic-arches', id: '64041/subtitled' })).toBe(url);
});

import { expect, test } from 'vitest';
import * as q from '../queries';
import { picturehouse } from './picturehouse';
import { vue } from './vue';

const read = (chain: typeof vue, raw: string) => chain.tag(raw) && [chain.tag(raw)!.label, chain.tag(raw)!.kind];

test("Vue's typed attributes read by type, its formats and seats by name", () => {
  expect(read(vue, 'Session_Special: Laser')).toEqual(['Laser', 'Picture']);
  expect(read(vue, 'Session: Dolby Atmos')).toEqual(['Dolby Atmos', 'Picture']);
  expect(read(vue, 'Session: Laser 3D')).toEqual(['Laser 3D', 'Picture']); // filed as a session, still a format
  expect(read(vue, 'Session: Ultra Lux and Lux')).toEqual(['Ultra Lux and Lux', 'Seating']);
  expect(read(vue, 'Language: Hindi')).toEqual(['Hindi', 'Language']);
  expect(read(vue, 'Session: Audio Description (AD)')).toEqual(['Audio Described', 'Accessibility']);
  expect(read(vue, 'Movie: Strobe Lighting')).toEqual(['Flash Warning', 'Accessibility']);
  expect(['Language: English', 'Session: Single Seat', 'Movie: Family'].map((raw) => vue.tag(raw))).toEqual([null, null, null]);
  expect(vue.isEvent({ title: 'La Bohème', tags: ['Movie: Big Screen Opera'] })).toBe(true);
  expect(vue.isEvent({ title: 'Jaws', tags: ['Movie: Back on the Big Screen'] })).toBe(false);
  expect(vue.short('London - Finchley Road (02 Centre)')).toBe('Finchley Road');
  expect(vue.town({ id: '10031', name: 'Finchley Road', city: 'London', postcode: '' })).toBe('Greater London');
  expect(vue.distributor('Warner (UK + EIRE)')).toBe('Warner');
});

test("Picturehouse's cut-short codes are named in full", () => {
  expect(read(picturehouse, 'Audio D')).toEqual(['Audio Described', 'Accessibility']);
  expect(read(picturehouse, 'Silver Scr')).toEqual(['Silver Screen', 'Events']);
  expect(read(picturehouse, '35mm')).toEqual(['35mm', 'Picture']);
  expect(['2D', 'ad-trailer', 'Upstairs'].map((raw) => picturehouse.tag(raw))).toEqual([null, null, null]);
  expect(picturehouse.isEvent({ title: 'NT Live', tags: ['LiveSat'] })).toBe(true);
  expect(['Arts', 'Cinema City', 'Picturehouse Central'].map(picturehouse.cinemaName)).toEqual(['Arts Picturehouse', 'Cinema City', 'Picturehouse Central']);
  expect(picturehouse.short('Picturehouse Central')).toBe('Central');
  for (const name of ['Picturehouse Central', 'Crouch End', 'Ealing', 'Finsbury Park', 'Ritzy', 'West Norwood']) {
    expect(picturehouse.town({ id: name, name, city: 'London', postcode: '' })).toBe('Greater London');
  }
  expect(['Picturehouse at FACT Liverpool', 'Arts Picturehouse'].map(picturehouse.short)).toEqual(['FACT Liverpool', 'Arts Picturehouse']);
});

test("a showing is booked on its chain's page, with the chain's own cinema and showing IDs", () => {
  const db = q.open({
    chains: [vue, picturehouse].map(({ id, name, booking }) => ({ id, name, booking, ingested: null, fullUntil: null })),
    ingested: null, fullUntil: null, films: [], availability: [], events: [], screens: [], rows: [], values: [], tags: {},
    cinemas: [
      { id: 'vue-10030', chain: 'vue', name: 'Vue West End', short: 'West End', town: 'Greater London', stored: true, address: {} },
      { id: 'picturehouse-022', chain: 'picturehouse', name: 'Picturehouse Central', short: 'Central', town: 'Greater London', stored: true, address: {} },
    ],
  });
  expect(q.booking(db, { cinemaId: 'vue-10030', id: 'HO00020283/319595' })).toBe('https://www.myvue.com/book-tickets/summary/10030/HO00020283/319595');
  expect(q.booking(db, { cinemaId: 'picturehouse-022', id: '124085' })).toBe('https://web.picturehouses.com/order/showtimes/022-124085/seats');
});

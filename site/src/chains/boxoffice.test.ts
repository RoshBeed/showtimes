import { expect, test } from 'vitest';
import { everyman, readTag, showcase } from './boxoffice';
import { inGreaterLondon } from './london';

test("the boxoffice platform's tag codes read in the site's vocabulary, as ODEON's do", () => {
  const read = (code: string) => readTag(code) && [readTag(code)!.label, readTag(code)!.kind];
  expect(read('Format.Projection.Laser')).toEqual(['Laser', 'Picture']);
  expect(read('Format.Projection.3d')).toEqual(['3D', 'Picture']);
  expect(read('Format.Projection.35mm')).toEqual(['35mm', 'Picture']);
  expect(read('Localization.Language.Hindi')).toEqual(['Hindi', 'Language']);
  expect(read('Showtime.Accessibility.Subtitled')).toEqual(['English subtitles', 'Language']);
  expect(read('Showtime.Accessibility.AutismFriendly')).toEqual(['Autism Friendly', 'Accessibility']);
  expect(read('Showtime.Accessibility.AudioDescription')).toEqual(['Audio Described', 'Accessibility']);
  expect(read('Auditorium.Comfort.Recliners')).toEqual(['Recliner', 'Seating']);
  expect(read('Showtime.Restriction.BabyClub')).toEqual(['Baby Club', 'Events']);
  expect(read('Showtime.Event.QandAEvent')).toEqual(['Q&A', 'Events']);
  // What every showing carries, and the platform's own flags, are left out.
  expect(['Format.Projection.Digital', 'Auditorium.Comfort.ReservedSeating', 'Internal.Data.AlmostSoldOut'].map(readTag)).toEqual([null, null, null]);
});

test('Everyman and Showcase name their cinemas, seats, events and booking pages', () => {
  expect([everyman.cinemaName('Barnet'), everyman.short('Barnet')]).toEqual(['Everyman Barnet', 'Barnet']);
  expect(everyman.town({ id: 'X06SI', name: 'Barnet', city: 'Barnet', postcode: 'EN5 1AB' })).toBe('Greater London');
  expect(showcase.town({ id: 'X06JR', name: 'Bluewater', city: 'Greenhithe', postcode: 'DA9 9SG' })).toBe('Greenhithe');
  expect(['Auditorium.Comfort.Recliners', 'Auditorium.Comfort.ReservedSeating'].map(everyman.seat)).toEqual(['Recliner', null]);
  expect(showcase.isEvent({ title: 'NT Live', tags: ['Showtime.Experience.LiveSatellite'] })).toBe(true);
  expect(showcase.isEvent({ title: 'Wicker', tags: ['Showtime.Event.QandAEvent'] })).toBe(false);
  expect(everyman.booking.replace('{id}', 'b16762fa')).toBe('https://purchase.everymancinema.com/launch/ticketing/b16762fa');
  expect(everyman.fullUntil(new Map([['release_week', '2026-11-17']]))).toBe('2026-11-26');
});

test('Greater London is told by postcode district, outer boroughs included', () => {
  const inside = ['W1U 6TJ', 'EC2M 2PF', 'SE19 2TE', 'EN5 1AB', 'TW8 8GJ', 'KT1 1QP', 'BR6 0TW', 'CR0 1LD', 'HA1 2EX', 'RM1 3ER', 'TN16 3AA', 'ub8 1ln'];
  const outside = ['DA9 9SG', 'EN6 1AB', 'KT10 9RT', 'TW20 9FG', 'WD17 1AA', 'SL9 8PN', 'CR3 5AA', 'BA1 1SS', ''];
  expect(inside.filter((code) => !inGreaterLondon(code))).toEqual([]);
  expect(outside.filter((code) => inGreaterLondon(code))).toEqual([]);
  expect(inGreaterLondon('', 'London')).toBe(true);
  expect(inGreaterLondon('', 'Bath')).toBe(false);
});

import { expect, test } from 'vitest';
import { titleKey } from './titles';

test('case, accents, punctuation and spacing do not keep one clean title apart', () => {
  expect(titleKey('Royal Ballet & Opera: Così Fan Tutte')).toBe(titleKey('ROYAL BALLET & OPERA: Cosi fan tutte'));
  expect(titleKey('Home Alone 2 : Lost in New York')).toBe(titleKey('Home Alone 2: Lost In New York'));
  expect(titleKey('Andrew Lloyd Webber’s Starlight Express')).toBe(titleKey("Andrew Lloyd Webber's Starlight Express"));
  expect(titleKey('Dune: Part Two')).not.toBe(titleKey('Dune: Part Three'));
});

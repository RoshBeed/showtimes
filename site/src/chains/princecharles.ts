import type { Chain } from './chain';
import { weekFullUntil } from './week.ts';

export const princecharles: Chain = {
  id: 'princecharles',
  name: 'Prince Charles Cinema',
  booking: 'https://princecharlescinema.com/prince-charles-cinema/booknow/{id}',
  cinemaName: (name) => name,
  short: () => 'Prince Charles',
  town: () => 'Greater London',
  tag: (raw) => ({ label: /^HOH$/i.test(raw) ? 'Captioned' : /^SUB$/i.test(raw) ? 'Subtitled' : raw, kind: /^(35mm|70mm|3D|4K|IMAX)\b/i.test(raw) ? 'Picture' : /^(HoH|SUB|Subtitled)$/i.test(raw) ? 'Language' : 'Events' }),
  seat: () => null,
  distributor: (raw) => raw,
  isEvent: ({ title }) => /^(National Theatre Live|NT Live|Royal (Ballet|Opera)|RBO|Met Opera)\b/i.test(title),
  fullUntil: weekFullUntil,
};

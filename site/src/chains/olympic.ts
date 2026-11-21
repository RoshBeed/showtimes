import type { Chain } from './chain';
import { weekFullUntil } from './week.ts';

export const olympic: Chain = {
  id: 'olympic',
  name: 'Olympic Studios',
  booking: '',
  bookingByCinema: {
    barnes: 'https://web1.empire.mycloudcinema.com/#/book/{id}',
    powerstation: 'https://web2.empire.mycloudcinema.com/#/book/{id}',
    arches: 'https://web2.empire.mycloudcinema.com/#/book/{id}',
    selfridges: 'https://web3.empire.mycloudcinema.com/#/book/{id}',
  },
  cinemaName: (name) => name,
  short: (name) => name.replace(/^The Cinema (in|at) /i, ''),
  town: () => 'Greater London',
  tag: (raw) => ({ label: raw === 'Subtitled' ? 'English subtitles' : raw, kind: raw === 'Dolby Cinema' ? 'Picture' : raw === 'Subtitled' ? 'Language' : 'Events' }),
  seat: () => null,
  distributor: (raw) => raw,
  isEvent: ({ title }) => /^(National Theatre Live|NT Live|Royal (Ballet|Opera)|RBO|Met Opera)\b/i.test(title),
  fullUntil: weekFullUntil,
};

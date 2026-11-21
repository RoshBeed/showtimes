// Opus codes vary by venue: RS is Relaxed at Rio, Restoration at ActOne.
import type { Chain } from './chain';
import type { TagKind } from '../tags';
import { weekFullUntil } from './week.ts';

function opus(config: { id: string; name: string; site: string; dll: string; tags: Record<string, [string, TagKind]> }): Chain {
  return {
    id: config.id, name: config.name,
    booking: `${config.site}/${config.dll}.dll/Booking?Booking=TSelectItems.waSelectItemsPrompt.TcsWebMenuItem_0.TcsWebTab_0.TcsPerformance_{id}`,
    cinemaName: (name) => name,
    short: () => config.name.replace(/^The /, '').replace(/ Cinema$/, ''),
    town: () => 'Greater London',
    tag: (raw) => {
      const tag = config.tags[raw];
      return tag ? { label: tag[0], kind: tag[1] } : { label: raw, kind: /^(35mm|70mm|3D|4K)$/i.test(raw) ? 'Picture' : 'Events' };
    },
    seat: () => null,
    distributor: (raw) => raw,
    isEvent: ({ title }) => /^(National Theatre Live|NT Live|Royal (Ballet|Opera)|RBO|Met Opera)\b/i.test(title),
    fullUntil: weekFullUntil,
  };
}

export const rio = opus({ id: 'rio', name: 'Rio Cinema', site: 'https://riocinema.org.uk', dll: 'Rio', tags: {
  PP: ['Pink Palace', 'Events'], SP: ['Special Event', 'Events'], CM: ['Classic Matinee', 'Events'],
  QA: ['Q&A / Discussion', 'Events'], FF: ['Family Flicks', 'Events'],
  HoH: ['Hard of Hearing', 'Accessibility'], RS: ['Relaxed Screening', 'Accessibility'],
  CB: ['Carers + Baby', 'Events'], NoAds: ['No Ads or Trailers', 'Events'],
  RF: ['Rio Forever', 'Events'], HC: ["Hackney Children's Film Fest", 'Events'],
} });
export const lexi = opus({ id: 'lexi', name: 'The Lexi Cinema', site: 'https://thelexicinema.co.uk', dll: 'TheLexiCinema', tags: {
  BF: ['Baby-Friendly', 'Events'], HOH: ['Captioned', 'Language'], QA: ['Q&A', 'Events'],
  AS: ['Accessible Screening', 'Accessibility'], BHS: ['Black History Studies', 'Events'],
  TP: ['Talking Pictures', 'Events'], SL: ['Spotlight', 'Events'], PR: ['Preview', 'Events'], AL: ['18 Rated Almodovar', 'Events'],
} });
export const phoenix = opus({ id: 'phoenix', name: 'Phoenix Cinema', site: 'https://www.phoenixcinema.co.uk', dll: 'PhoenixCinemaLondon', tags: {
  CC: ['Closed Captions', 'Language'], QA: ['Q&A', 'Events'], SU: ['Subtitled', 'Language'], NA: ['Phoenix for Nature', 'Events'],
} });
export const actone = opus({ id: 'actone', name: 'ActOne Cinema', site: 'https://actonecinema.co.uk', dll: 'ActOneCinema', tags: {
  CC: ['Captions', 'Language'], AD: ['Audio Described', 'Accessibility'], C1: ['ClassicOne Cinema', 'Events'],
  CB: ['Carers & Babies', 'Events'], SB: ['Subtitled', 'Language'], RS: ['Restoration', 'Picture'],
  FP: ['Footprints', 'Events'], NA: ['No Ads or Trailers', 'Events'], CX: ['Connections', 'Events'],
} });

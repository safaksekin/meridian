import type { ModeDef } from './types';

export const MODES: ModeDef[] = [
  {
    id: 'beeline',
    icon: '🧭',
    name: { en: 'Beeline', tr: 'Düz Çizgi' },
    blurb: { en: 'Walk a straight line around the globe. Which countries do you cross?', tr: 'Dünyada dümdüz yürü. Hangi ülkelerden geçersin?' },
    load: () => import('./beeline/index'),
  },
  {
    id: 'streets',
    icon: '🛣️',
    name: { en: 'Streetprint', tr: 'Sokak İzi' },
    blurb: { en: 'Name the city from its bare street pattern.', tr: 'Şehri çıplak sokak dokusundan bul.' },
    load: () => import('./streets/index'),
  },
  {
    id: 'mental',
    icon: '🧠',
    name: { en: 'Mental Map', tr: 'Zihin Haritası' },
    blurb: { en: 'Place countries on a blank canvas. See how your brain bends the world.', tr: 'Ülkeleri boş tuvale yerleştir. Beynin dünyayı nasıl büküyor, gör.' },
    load: () => import('./mental/index'),
  },
  {
    id: 'headcount',
    icon: '👥',
    name: { en: 'Headcount', tr: 'Nüfus Çemberi' },
    blurb: { en: 'Drop one circle that holds exactly the target population.', tr: 'Hedef nüfusu tam tutturan çemberi bırak.' },
    load: () => import('./headcount/index'),
  },
  {
    id: 'hinterland',
    icon: '🏘️',
    name: { en: 'Hinterland', tr: 'Taşra' },
    blurb: { en: 'Guess the country from the names of its villages.', tr: 'Ülkeyi köy ve kasaba adlarından bul.' },
    load: () => import('./hinterland/index'),
  },
  {
    id: 'tripoint',
    icon: '📍',
    name: { en: 'Tripoint', tr: 'Üçlü Nokta' },
    blurb: { en: 'Three borders meet at one point. Name the three countries.', tr: 'Üç sınır tek noktada buluşuyor. Üç ülkeyi bul.' },
    load: () => import('./tripoint/index'),
  },
];

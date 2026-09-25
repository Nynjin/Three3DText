/** Label text for every renderer, grouped by language, each with the halo colour that marks it. */
export const TextGroups = [
  {
    name: 'French',
    halo: '#f8e1cc',
    texts: [
      'Lyon', 'Bordeaux', 'Toulouse', 'Strasbourg', 'Nantes', 'Grenoble',
      'Montpellier', 'Perpignan', 'Besançon', 'Le Havre', 'Saint-Étienne',
      'Aix-en-Provence', 'Clermont-Ferrand', 'Villeneuve-lès-Avignon',
      'Mont Blanc', 'Tour Eiffel',
      // AV/VA kerning, and the j's negative bearing.
      'AVIGNON', 'Villejuif',
      'Saint-Étienne\nLoire', 'Aix-en-Provence\nBouches-du-Rhône',
      // Astral: outside the Basic Multilingual Plane.
      '𝐁𝐨𝐫𝐝𝐞𝐚𝐮𝐱',
    ],
  },
  {
    name: 'Russian',
    halo: '#d8e4f5',
    texts: ['Москва', 'Казань', 'Новосибирск', 'Владивосток', 'Екатеринбург', 'Санкт-Петербург', 'Нижний Новгород'],
  },
  { name: 'Greek', halo: '#d4efea', texts: ['Αθήνα', 'Πάτρα', 'Ηράκλειο', 'Θεσσαλονίκη'] },
  // Thin strokes: watch the SDF cutoff. '𠀋𠂢' is astral.
  { name: 'Chinese', halo: '#f5d6d6', texts: ['上海', '北京', '广州', '深圳', '成都', '杭州', '𠀋𠂢'] },
  { name: 'Japanese', halo: '#f4dbe8', texts: ['東京', '大阪', '京都', '横浜', '札幌', '名古屋'] },
  { name: 'Korean', halo: '#e2dbf2', texts: ['서울', '부산', '인천', '대전', '광주'] },
  {
    // Letterforms join, including across spaces.
    name: 'Arabic',
    halo: '#dbeed3',
    texts: ['القاهرة', 'بيروت', 'دمشق', 'بغداد', 'الرياض', 'تونس', 'الجزائر', 'الدار البيضاء'],
  },
  { name: 'Hebrew', halo: '#f2ecc9', texts: ['תל אביב', 'ירושלים', 'חיפה', 'נצרת', 'באר שבע'] },
  // RTL and LTR runs in one label.
  { name: 'Bilingual', halo: '#e4e4e4', texts: ['Beirut بيروت', 'Jerusalem ירושלים'] },
  // Joined sequences and skin tones included.
  { name: 'Emoji', halo: '#ffffff', texts: ['🗼', '🏔️', '🏔️🌊', '👨‍👩‍👧', '👍🏽'] },
] as const;

export const TextOptions: readonly string[] = TextGroups.flatMap(g => g.texts);

const HALO_BY_TEXT = new Map<string, string>(TextGroups.flatMap(g => g.texts.map(t => [t, g.halo] as const)));

/** Halo colour of the group `text` belongs to. */
export function haloColorOf(text: string): string {
  return HALO_BY_TEXT.get(text) ?? '#ffffff';
}

export const FrustumCullRate = 0.01;

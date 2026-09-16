/**
 * Label text for every renderer: place names covering each writing system that
 * needs special handling. Kept long because items pick at random and placement
 * favours short labels, so a short list repeats the same few names.
 *
 * 'Villejuif' is left out, its 'j' advance is wrong.
 */
export const TextOptions = [
  // Latin. 'AVIGNON' for AV/VA kerning, the last two for wrapping.
  'Lyon',
  'Bordeaux',
  'Toulouse',
  'Strasbourg',
  'Nantes',
  'Grenoble',
  'Montpellier',
  'Perpignan',
  'Besançon',
  'Le Havre',
  'Saint-Étienne',
  'Aix-en-Provence',
  'AVIGNON',
  'Clermont-Ferrand',
  'Villeneuve-lès-Avignon',

  // Cyrillic.
  'Москва',
  'Казань',
  'Новосибирск',
  'Владивосток',
  'Екатеринбург',
  'Санкт-Петербург',
  'Нижний Новгород',

  // Greek.
  'Αθήνα',
  'Πάτρα',
  'Ηράκλειο',
  'Θεσσαλονίκη',

  // Chinese and Japanese. Thin glyphs, watch for SDF cutoff.
  '上海',
  '北京',
  '广州',
  '深圳',
  '成都',
  '杭州',
  '東京',
  '大阪',
  '京都',
  '横浜',
  '札幌',
  '名古屋',

  // Korean.
  '서울',
  '부산',
  '인천',
  '대전',
  '광주',

  // Arabic. Needs shaping to join letterforms, including across spaces.
  'القاهرة',
  'بيروت',
  'دمشق',
  'بغداد',
  'الرياض',
  'تونس',
  'الجزائر',
  'الدار البيضاء',

  // Hebrew. Needs bidi reordering.
  'תל אביב',
  'ירושלים',
  'חיפה',
  'נצרת',
  'באר שבע',

  // Bilingual: RTL and LTR runs in one label.
  'Beirut بيروت',
  'Jerusalem ירושלים',
] as const;

export const FrustumCullRate = 0.01;

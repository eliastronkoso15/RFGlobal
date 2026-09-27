/**
 * airports.mjs — IATA → { city, country, cc (ISO 3166-1 alpha-2) }
 * Используется как fallback для не-Ryanair рейсов.
 * Ryanair рейсы получают данные прямо из API.
 */
export const AIRPORTS = {
  // ── Greece ──────────────────────────────────────────────────────────────────
  ATH: { city: 'Athens',          country: 'Greece',          cc: 'GR' },
  SKG: { city: 'Thessaloniki',    country: 'Greece',          cc: 'GR' },
  HER: { city: 'Heraklion',       country: 'Greece',          cc: 'GR' },
  RHO: { city: 'Rhodes',          country: 'Greece',          cc: 'GR' },
  CFU: { city: 'Corfu',           country: 'Greece',          cc: 'GR' },
  ZTH: { city: 'Zakynthos',       country: 'Greece',          cc: 'GR' },
  KGS: { city: 'Kos',             country: 'Greece',          cc: 'GR' },
  JMK: { city: 'Mykonos',         country: 'Greece',          cc: 'GR' },
  JSI: { city: 'Skiathos',        country: 'Greece',          cc: 'GR' },
  JTR: { city: 'Santorini',       country: 'Greece',          cc: 'GR' },
  CHQ: { city: 'Chania',          country: 'Greece',          cc: 'GR' },
  SMI: { city: 'Samos',           country: 'Greece',          cc: 'GR' },
  LXS: { city: 'Lesvos',          country: 'Greece',          cc: 'GR' },
  MJT: { city: 'Mytilene',        country: 'Greece',          cc: 'GR' },
  EFL: { city: 'Kefalonia',       country: 'Greece',          cc: 'GR' },
  // ── Albania ─────────────────────────────────────────────────────────────────
  TIA: { city: 'Tirana',          country: 'Albania',         cc: 'AL' },
  // ── Armenia ─────────────────────────────────────────────────────────────────
  EVN: { city: 'Yerevan',         country: 'Armenia',         cc: 'AM' },
  // ── Austria ─────────────────────────────────────────────────────────────────
  VIE: { city: 'Vienna',          country: 'Austria',         cc: 'AT' },
  GRZ: { city: 'Graz',            country: 'Austria',         cc: 'AT' },
  INN: { city: 'Innsbruck',       country: 'Austria',         cc: 'AT' },
  SZG: { city: 'Salzburg',        country: 'Austria',         cc: 'AT' },
  // ── Belgium ─────────────────────────────────────────────────────────────────
  BRU: { city: 'Brussels',        country: 'Belgium',         cc: 'BE' },
  CRL: { city: 'Brussels South',  country: 'Belgium',         cc: 'BE' },
  LGG: { city: 'Liège',           country: 'Belgium',         cc: 'BE' },
  // ── Bosnia ──────────────────────────────────────────────────────────────────
  SJJ: { city: 'Sarajevo',        country: 'Bosnia',          cc: 'BA' },
  // ── Bulgaria ────────────────────────────────────────────────────────────────
  SOF: { city: 'Sofia',           country: 'Bulgaria',        cc: 'BG' },
  VAR: { city: 'Varna',           country: 'Bulgaria',        cc: 'BG' },
  BOJ: { city: 'Burgas',          country: 'Bulgaria',        cc: 'BG' },
  // ── Croatia ─────────────────────────────────────────────────────────────────
  ZAG: { city: 'Zagreb',          country: 'Croatia',         cc: 'HR' },
  SPU: { city: 'Split',           country: 'Croatia',         cc: 'HR' },
  DBV: { city: 'Dubrovnik',       country: 'Croatia',         cc: 'HR' },
  ZAD: { city: 'Zadar',           country: 'Croatia',         cc: 'HR' },
  // ── Cyprus ──────────────────────────────────────────────────────────────────
  LCA: { city: 'Larnaca',         country: 'Cyprus',          cc: 'CY' },
  PFO: { city: 'Paphos',          country: 'Cyprus',          cc: 'CY' },
  // ── Czech Republic ──────────────────────────────────────────────────────────
  PRG: { city: 'Prague',          country: 'Czech Republic',  cc: 'CZ' },
  BRQ: { city: 'Brno',            country: 'Czech Republic',  cc: 'CZ' },
  OSR: { city: 'Ostrava',         country: 'Czech Republic',  cc: 'CZ' },
  // ── Denmark ─────────────────────────────────────────────────────────────────
  CPH: { city: 'Copenhagen',      country: 'Denmark',         cc: 'DK' },
  BLL: { city: 'Billund',         country: 'Denmark',         cc: 'DK' },
  // ── Egypt ───────────────────────────────────────────────────────────────────
  HRG: { city: 'Hurghada',        country: 'Egypt',           cc: 'EG' },
  SSH: { city: 'Sharm el-Sheikh', country: 'Egypt',           cc: 'EG' },
  CAI: { city: 'Cairo',           country: 'Egypt',           cc: 'EG' },
  // ── Finland ─────────────────────────────────────────────────────────────────
  HEL: { city: 'Helsinki',        country: 'Finland',         cc: 'FI' },
  // ── France ──────────────────────────────────────────────────────────────────
  PAR: { city: 'Paris',           country: 'France',          cc: 'FR' }, // Wizz Air city code
  CDG: { city: 'Paris',           country: 'France',          cc: 'FR' },
  ORY: { city: 'Paris Orly',      country: 'France',          cc: 'FR' },
  BVA: { city: 'Paris Beauvais',  country: 'France',          cc: 'FR' }, // Ryanair Paris hub
  MRS: { city: 'Marseille',       country: 'France',          cc: 'FR' },
  NCE: { city: 'Nice',            country: 'France',          cc: 'FR' },
  LYS: { city: 'Lyon',            country: 'France',          cc: 'FR' },
  TLS: { city: 'Toulouse',        country: 'France',          cc: 'FR' },
  BOD: { city: 'Bordeaux',        country: 'France',          cc: 'FR' },
  NTE: { city: 'Nantes',          country: 'France',          cc: 'FR' },
  BSL: { city: 'Basel/Mulhouse',  country: 'France',          cc: 'FR' },
  MPL: { city: 'Montpellier',     country: 'France',          cc: 'FR' },
  BIQ: { city: 'Biarritz',        country: 'France',          cc: 'FR' },
  // ── Georgia ──────────────────────────────────────────────────────────────────
  KUT: { city: 'Kutaisi',         country: 'Georgia',         cc: 'GE' },
  TBS: { city: 'Tbilisi',         country: 'Georgia',         cc: 'GE' },
  // ── Germany ─────────────────────────────────────────────────────────────────
  BER: { city: 'Berlin',          country: 'Germany',         cc: 'DE' },
  MUC: { city: 'Munich',          country: 'Germany',         cc: 'DE' },
  FRA: { city: 'Frankfurt',       country: 'Germany',         cc: 'DE' },
  DUS: { city: 'Düsseldorf',      country: 'Germany',         cc: 'DE' },
  HAM: { city: 'Hamburg',         country: 'Germany',         cc: 'DE' },
  CGN: { city: 'Cologne',         country: 'Germany',         cc: 'DE' },
  STR: { city: 'Stuttgart',       country: 'Germany',         cc: 'DE' },
  NUE: { city: 'Nuremberg',       country: 'Germany',         cc: 'DE' },
  LEJ: { city: 'Leipzig',         country: 'Germany',         cc: 'DE' },
  HHN: { city: 'Frankfurt Hahn',  country: 'Germany',         cc: 'DE' },
  DTM: { city: 'Dortmund',        country: 'Germany',         cc: 'DE' },
  FMM: { city: 'Memmingen',       country: 'Germany',         cc: 'DE' },
  NRN: { city: 'Weeze',           country: 'Germany',         cc: 'DE' }, // Ryanair "Düsseldorf Weeze"
  // ── Hungary ─────────────────────────────────────────────────────────────────
  BUD: { city: 'Budapest',        country: 'Hungary',         cc: 'HU' },
  // ── Ireland ─────────────────────────────────────────────────────────────────
  DUB: { city: 'Dublin',          country: 'Ireland',         cc: 'IE' },
  SNN: { city: 'Shannon',         country: 'Ireland',         cc: 'IE' },
  // ── Israel ──────────────────────────────────────────────────────────────────
  TLV: { city: 'Tel Aviv',        country: 'Israel',          cc: 'IL' },
  // ── Italy ───────────────────────────────────────────────────────────────────
  ROM: { city: 'Rome',            country: 'Italy',           cc: 'IT' }, // Wizz Air city code
  FCO: { city: 'Rome',            country: 'Italy',           cc: 'IT' },
  CIA: { city: 'Rome Ciampino',   country: 'Italy',           cc: 'IT' },
  MIL: { city: 'Milan',           country: 'Italy',           cc: 'IT' }, // Wizz Air city code
  MXP: { city: 'Milan',           country: 'Italy',           cc: 'IT' },
  LIN: { city: 'Milan Linate',    country: 'Italy',           cc: 'IT' },
  BGY: { city: 'Milan Bergamo',   country: 'Italy',           cc: 'IT' },
  VEN: { city: 'Venice',          country: 'Italy',           cc: 'IT' }, // Wizz Air city code
  VCE: { city: 'Venice',          country: 'Italy',           cc: 'IT' },
  TSF: { city: 'Venice Treviso',  country: 'Italy',           cc: 'IT' },
  NAP: { city: 'Naples',          country: 'Italy',           cc: 'IT' },
  PSA: { city: 'Pisa',            country: 'Italy',           cc: 'IT' },
  FLR: { city: 'Florence',        country: 'Italy',           cc: 'IT' },
  BLQ: { city: 'Bologna',         country: 'Italy',           cc: 'IT' },
  TRN: { city: 'Turin',           country: 'Italy',           cc: 'IT' },
  BRI: { city: 'Bari',            country: 'Italy',           cc: 'IT' },
  CTA: { city: 'Catania',         country: 'Italy',           cc: 'IT' },
  PMO: { city: 'Palermo',         country: 'Italy',           cc: 'IT' },
  CAG: { city: 'Cagliari',        country: 'Italy',           cc: 'IT' },
  SUF: { city: 'Lamezia Terme',   country: 'Italy',           cc: 'IT' },
  PSR: { city: 'Pescara',         country: 'Italy',           cc: 'IT' },
  // ── Jordan ──────────────────────────────────────────────────────────────────
  AMM: { city: 'Amman',           country: 'Jordan',          cc: 'JO' },
  // ── Kosovo ──────────────────────────────────────────────────────────────────
  PRN: { city: 'Pristina',        country: 'Kosovo',          cc: 'XK' },
  // ── Latvia ──────────────────────────────────────────────────────────────────
  RIX: { city: 'Riga',            country: 'Latvia',          cc: 'LV' },
  // ── Lithuania ───────────────────────────────────────────────────────────────
  VNO: { city: 'Vilnius',         country: 'Lithuania',       cc: 'LT' },
  KUN: { city: 'Kaunas',          country: 'Lithuania',       cc: 'LT' },
  // ── Luxembourg ──────────────────────────────────────────────────────────────
  LUX: { city: 'Luxembourg',      country: 'Luxembourg',      cc: 'LU' },
  // ── Malta ───────────────────────────────────────────────────────────────────
  MLA: { city: 'Malta',           country: 'Malta',           cc: 'MT' },
  // ── Moldova ─────────────────────────────────────────────────────────────────
  KIV: { city: 'Chișinău',        country: 'Moldova',         cc: 'MD' },
  RMO: { city: 'Chișinău',        country: 'Moldova',         cc: 'MD' }, // Wizz Air uses RMO for Chișinău
  // ── Morocco ─────────────────────────────────────────────────────────────────
  RAK: { city: 'Marrakech',       country: 'Morocco',         cc: 'MA' },
  CMN: { city: 'Casablanca',      country: 'Morocco',         cc: 'MA' },
  AGA: { city: 'Agadir',          country: 'Morocco',         cc: 'MA' },
  FEZ: { city: 'Fez',             country: 'Morocco',         cc: 'MA' },
  // ── Netherlands ─────────────────────────────────────────────────────────────
  AMS: { city: 'Amsterdam',       country: 'Netherlands',     cc: 'NL' },
  EIN: { city: 'Eindhoven',       country: 'Netherlands',     cc: 'NL' },
  RTM: { city: 'Rotterdam',       country: 'Netherlands',     cc: 'NL' },
  // ── North Macedonia ─────────────────────────────────────────────────────────
  SKP: { city: 'Skopje',          country: 'North Macedonia', cc: 'MK' },
  OHD: { city: 'Ohrid',           country: 'North Macedonia', cc: 'MK' },
  // ── Norway ──────────────────────────────────────────────────────────────────
  OSL: { city: 'Oslo',            country: 'Norway',          cc: 'NO' },
  BGO: { city: 'Bergen',          country: 'Norway',          cc: 'NO' },
  // ── Poland ──────────────────────────────────────────────────────────────────
  WAW: { city: 'Warsaw',          country: 'Poland',          cc: 'PL' },
  WMI: { city: 'Warsaw',          country: 'Poland',          cc: 'PL' }, // Warsaw Modlin (Ryanair/Wizz)
  WSW: { city: 'Warsaw',          country: 'Poland',          cc: 'PL' }, // Wizz Air city code for Warsaw
  KRK: { city: 'Kraków',          country: 'Poland',          cc: 'PL' },
  WRO: { city: 'Wrocław',         country: 'Poland',          cc: 'PL' },
  GDN: { city: 'Gdańsk',          country: 'Poland',          cc: 'PL' },
  KTW: { city: 'Katowice',        country: 'Poland',          cc: 'PL' },
  POZ: { city: 'Poznań',          country: 'Poland',          cc: 'PL' },
  // ── Portugal ────────────────────────────────────────────────────────────────
  LIS: { city: 'Lisbon',          country: 'Portugal',        cc: 'PT' },
  OPO: { city: 'Porto',           country: 'Portugal',        cc: 'PT' },
  FAO: { city: 'Faro',            country: 'Portugal',        cc: 'PT' },
  FNC: { city: 'Funchal',         country: 'Portugal',        cc: 'PT' },
  // ── Romania ─────────────────────────────────────────────────────────────────
  OTP: { city: 'Bucharest',       country: 'Romania',         cc: 'RO' },
  BBU: { city: 'Bucharest',       country: 'Romania',         cc: 'RO' }, // Wizz Air old code
  BUH: { city: 'Bucharest',       country: 'Romania',         cc: 'RO' }, // Wizz Air city code
  CLJ: { city: 'Cluj-Napoca',     country: 'Romania',         cc: 'RO' },
  CRA: { city: 'Craiova',         country: 'Romania',         cc: 'RO' },
  IAS: { city: 'Iași',            country: 'Romania',         cc: 'RO' },
  // ── Serbia ──────────────────────────────────────────────────────────────────
  BEG: { city: 'Belgrade',        country: 'Serbia',          cc: 'RS' },
  // ── Slovakia ────────────────────────────────────────────────────────────────
  BTS: { city: 'Bratislava',      country: 'Slovakia',        cc: 'SK' },
  KSC: { city: 'Košice',          country: 'Slovakia',        cc: 'SK' },
  // ── Slovenia ────────────────────────────────────────────────────────────────
  LJU: { city: 'Ljubljana',       country: 'Slovenia',        cc: 'SI' },
  // ── Spain ───────────────────────────────────────────────────────────────────
  MAD: { city: 'Madrid',          country: 'Spain',           cc: 'ES' },
  BCN: { city: 'Barcelona',       country: 'Spain',           cc: 'ES' },
  AGP: { city: 'Málaga',          country: 'Spain',           cc: 'ES' },
  ALC: { city: 'Alicante',        country: 'Spain',           cc: 'ES' },
  PMI: { city: 'Palma',           country: 'Spain',           cc: 'ES' },
  VLC: { city: 'Valencia',        country: 'Spain',           cc: 'ES' },
  SVQ: { city: 'Seville',         country: 'Spain',           cc: 'ES' },
  IBZ: { city: 'Ibiza',           country: 'Spain',           cc: 'ES' },
  GRX: { city: 'Granada',         country: 'Spain',           cc: 'ES' },
  ACE: { city: 'Lanzarote',       country: 'Spain',           cc: 'ES' },
  TFS: { city: 'Tenerife',        country: 'Spain',           cc: 'ES' },
  LPA: { city: 'Gran Canaria',    country: 'Spain',           cc: 'ES' },
  FUE: { city: 'Fuerteventura',   country: 'Spain',           cc: 'ES' },
  SCQ: { city: 'Santiago',        country: 'Spain',           cc: 'ES' },
  BIO: { city: 'Bilbao',          country: 'Spain',           cc: 'ES' },
  // ── Sweden ──────────────────────────────────────────────────────────────────
  ARN: { city: 'Stockholm',       country: 'Sweden',          cc: 'SE' },
  GOT: { city: 'Gothenburg',      country: 'Sweden',          cc: 'SE' },
  MMX: { city: 'Malmö',           country: 'Sweden',          cc: 'SE' },
  // ── Switzerland ─────────────────────────────────────────────────────────────
  ZRH: { city: 'Zurich',          country: 'Switzerland',     cc: 'CH' },
  GVA: { city: 'Geneva',          country: 'Switzerland',     cc: 'CH' },
  // ── Turkey ──────────────────────────────────────────────────────────────────
  IST: { city: 'Istanbul',        country: 'Turkey',          cc: 'TR' },
  SAW: { city: 'Istanbul Sabiha', country: 'Turkey',          cc: 'TR' },
  ESB: { city: 'Ankara',          country: 'Turkey',          cc: 'TR' },
  ADB: { city: 'Izmir',           country: 'Turkey',          cc: 'TR' },
  AYT: { city: 'Antalya',         country: 'Turkey',          cc: 'TR' },
  DLM: { city: 'Dalaman',         country: 'Turkey',          cc: 'TR' },
  BJV: { city: 'Bodrum',          country: 'Turkey',          cc: 'TR' },
  // ── UAE ─────────────────────────────────────────────────────────────────────
  DXB: { city: 'Dubai',           country: 'UAE',             cc: 'AE' },
  AUH: { city: 'Abu Dhabi',       country: 'UAE',             cc: 'AE' },
  // ── UK ──────────────────────────────────────────────────────────────────────
  LON: { city: 'London',          country: 'UK',              cc: 'GB' }, // Wizz Air city code
  LHR: { city: 'London',          country: 'UK',              cc: 'GB' },
  LGW: { city: 'London Gatwick',  country: 'UK',              cc: 'GB' },
  STN: { city: 'London Stansted', country: 'UK',              cc: 'GB' },
  LTN: { city: 'London Luton',    country: 'UK',              cc: 'GB' },
  MAN: { city: 'Manchester',      country: 'UK',              cc: 'GB' },
  BHX: { city: 'Birmingham',      country: 'UK',              cc: 'GB' },
  EDI: { city: 'Edinburgh',       country: 'UK',              cc: 'GB' },
  GLA: { city: 'Glasgow',         country: 'UK',              cc: 'GB' },
  BRS: { city: 'Bristol',         country: 'UK',              cc: 'GB' },
  LPL: { city: 'Liverpool',       country: 'UK',              cc: 'GB' },
  NCL: { city: 'Newcastle',       country: 'UK',              cc: 'GB' },
  // ── Ukraine ─────────────────────────────────────────────────────────────────
  KBP: { city: 'Kyiv',            country: 'Ukraine',         cc: 'UA' },
  LWO: { city: 'Lviv',            country: 'Ukraine',         cc: 'UA' },
};

/**
 * ISO 3166-1 alpha-2 → flag emoji  (e.g. 'MT' → '🇲🇹')
 */
export function flagEmoji(cc) {
  if (!cc || cc.length !== 2) return '';
  return [...cc.toUpperCase()]
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + 127397))
    .join('');
}

/**
 * Вернуть { city, country, cc, flag } для IATA кода.
 * cc — ISO 3166-1 alpha-2 lowercase (e.g. 'it', 'gr') for flag-icons library.
 * Fallback: возвращает пустые строки.
 */
export function airportInfo(iata) {
  const a = AIRPORTS[iata?.toUpperCase()];
  if (!a) return { city: '', country: '', cc: '', flag: '' };
  return { city: a.city, country: a.country, cc: (a.cc || '').toLowerCase(), flag: flagEmoji(a.cc) };
}

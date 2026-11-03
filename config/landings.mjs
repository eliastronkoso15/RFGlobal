/**
 * config/landings.mjs
 *
 * Landing configuration — each landing represents an origin airport.
 * Invariants:
 *   - landingSlug === lowercase(homeAirportIata)
 *   - one landing = one currency (all fares in a landing share it)
 */

export const LANDINGS = [
  {
    landingSlug: 'evn',
    homeAirportIata: 'EVN',
    homeCity: 'Yerevan',
    currency: 'EUR',
    // EVN-specific ceilings (EUR defaults are 100/200/200): 2-4k-km market,
    // "cheap" is structurally pricier here.
    // RT ceilings 250→350 (2026-11-03, owner): at 250 the weekend tab zeroed
    // out — Aegean wk/hol lost 100% of fares for a month, FlyOne weekend died.
    priceCeilings: { one_way: 150, weekend: 350, holiday: 350 },
    enabledProviders: ['wizz_air', 'aegean_air', 'flyone'],
    providerSettings: {
      wizz_air: {
        currency: 'EUR',
        monthsAhead: 2,
        // Routes that consistently return zero fares from EVN — skip to
        // save farechart calls.
        skipRoutes: ['EIN', 'PFO'],
      },
      aegean_air: {
        currency: 'EUR',
        monthsAhead: 2,
      },
      flyone: {
        currency: 'EUR',
        monthsAhead: 2,
        // FlyOne FareView mixes in codeshare/connecting itineraries — keep direct only.
        directOnly: true,
      },
    },
  },

  // Greece — Ryanair (2026-11-03) + SKY express (2026-11-03), both 6 months
  // ahead over plain HTTPS. The other Greek providers (Wizz, Aegean, Google
  // Flights) are collected elsewhere. EUR defaults for price ceilings.
  {
    landingSlug: 'skg',
    homeAirportIata: 'SKG',
    homeCity: 'Thessaloniki',
    currency: 'EUR',
    enabledProviders: ['ryanair_fare_finder', 'sky_express'],
    providerSettings: {
      ryanair_fare_finder: {
        currency: 'EUR',
        maxResultsPerDate: 10,
        monthsAhead: 5,
      },
      sky_express: {
        currency: 'EUR',
        monthsAhead: 5,
      },
    },
  },

  {
    landingSlug: 'ath',
    homeAirportIata: 'ATH',
    homeCity: 'Athens',
    currency: 'EUR',
    enabledProviders: ['ryanair_fare_finder', 'sky_express'],
    providerSettings: {
      ryanair_fare_finder: {
        currency: 'EUR',
        maxResultsPerDate: 10,
        monthsAhead: 5,
      },
      sky_express: {
        currency: 'EUR',
        monthsAhead: 5,
      },
    },
  },

  {
    landingSlug: 'stn',
    homeAirportIata: 'STN',
    homeCity: 'London',
    currency: 'GBP',
    enabledProviders: ['ryanair_fare_finder'],
    providerSettings: {
      ryanair_fare_finder: {
        currency: 'GBP',
        maxResultsPerDate: 10,
        // Current month + 5 = 6 months. Ryanair sells ~8 months ahead (probed
        // 2026-11-03: STN Feb-Jun 2027 all 120-150 fares); plain HTTPS, ~5 min/run.
        monthsAhead: 5,
      },
    },
  },
];

/** Return a landing by its slug, or null if not found. */
export function getLanding(slug) {
  return LANDINGS.find((l) => l.landingSlug === slug) ?? null;
}

/** Return the first landing (default when none specified). */
export function getActiveLanding() {
  return LANDINGS[0];
}

/** Return per-provider settings for a landing, merged with an optional base. */
export function getProviderSettings(landing, providerId, base = {}) {
  return { ...base, ...(landing.providerSettings?.[providerId] ?? {}) };
}

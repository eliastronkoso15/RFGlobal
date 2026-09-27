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
    enabledProviders: ['wizz_air'],
    providerSettings: {
      wizz_air: {
        currency: 'EUR',
        monthsAhead: 2,
        // Routes that consistently return zero fares from EVN — skip to
        // save farechart calls.
        skipRoutes: ['EIN', 'PFO'],
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
        monthsAhead: 2,
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

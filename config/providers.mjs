/**
 * config/providers.mjs
 *
 * Provider registry configuration: global enable flags + per-provider
 * defaults. Landing-specific overrides live in config/landings.mjs
 * (providerSettings) and win over these defaults.
 */

export const PROVIDER_CONFIGS = {
  wizz_air: {
    id: 'wizz_air',
    name: 'Wizz Air',
    type: 'airline_direct',
    priority: 10,
    enabled: true,
    defaults: {
      currency: 'EUR',
      monthsAhead: 2,
    },
  },

  aegean_air: {
    id: 'aegean_air',
    name: 'Aegean Airlines Low Fare Calendar',
    type: 'scraper',
    priority: 4,
    enabled: true,
    defaults: {
      currency: 'EUR',
      monthsAhead: 2,
    },
  },

  flyone: {
    id: 'flyone',
    name: 'FlyOne FareView',
    type: 'scraper',
    priority: 5,
    enabled: true,
    defaults: {
      currency: 'EUR',
      monthsAhead: 2,
    },
  },

  ryanair_fare_finder: {
    id: 'ryanair_fare_finder',
    name: 'Ryanair Fare Finder',
    type: 'airline_direct',
    priority: 10,
    enabled: true,
    defaults: {
      currency: 'EUR',
      maxResultsPerDate: 10,
      monthsAhead: 2,
    },
  },
};

/**
 * providers/base.mjs
 *
 * BaseProvider — abstract base class for all price providers.
 *
 * Subclasses must implement:
 *   collect(landing, options)  → Promise<NormalizedFare[]>
 *
 * The normalize() helper is provided as a utility — subclasses call it
 * inside collect() to transform raw API/scrape data into NormalizedFare objects.
 */

export class BaseProvider {
  /**
   * @param {import('../config/providers.mjs').PROVIDER_CONFIGS[string]} config
   */
  constructor(config) {
    this.id       = config.id;
    this.name     = config.name;
    this.enabled  = config.enabled ?? true;
    this.priority = config.priority ?? 99;
    this.type     = config.type ?? 'api';
  }

  /**
   * Collect fares for the given landing.
   * Must return an array of NormalizedFare objects.
   *
   * @param {import('../config/landings.mjs').LANDINGS[number]} landing
   * @param {object} [options]  per-call overrides
   * @returns {Promise<NormalizedFare[]>}
   */
  // eslint-disable-next-line no-unused-vars
  async collect(landing, options = {}) {
    throw new Error(`Provider "${this.id}" must implement collect(landing, options)`);
  }
}

/**
 * @typedef {object} NormalizedFare
 *
 * Unified fare record format shared across all providers.
 * All providers must produce objects that conform to this shape.
 *
 * @property {string}      provider           Provider id (e.g. 'ryanair_fare_finder')
 * @property {number}      providerPriority   Lower = higher priority
 * @property {string}      providerType       'api' | 'scraper'
 * @property {string}      airline            Airline display name (e.g. 'Ryanair')
 * @property {string}      airlineCode        Airline IATA marketing code (e.g. 'FR', 'W6')
 * @property {string}      originIata         Origin airport IATA (e.g. 'SKG')
 * @property {string}      destinationIata    Destination airport IATA (e.g. 'BUD')
 * @property {string}      destinationName    Human-readable destination name
 * @property {string|null} dateOut            Departure date YYYY-MM-DD
 * @property {string|null} dateIn             Return date YYYY-MM-DD, or null for one-way
 * @property {string}      tripType           'one_way' | 'round_trip'
 * @property {number}      price              Numeric price (EUR)
 * @property {string}      currency           Currency code (e.g. 'EUR')
 * @property {string|null} duration           Human-readable duration (e.g. '1 hr 40 min')
 * @property {string|null} deeplink           Direct booking URL
 * @property {string}      collectedAt        ISO 8601 timestamp of collection
 * @property {string}      snapshotId         Snapshot identifier string
 * @property {string}      landingCode        Landing slug (e.g. 'skg')
 * @property {object}      [rawMeta]          Optional lightweight raw data for debugging
 */

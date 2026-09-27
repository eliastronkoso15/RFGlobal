/**
 * providers/registry.mjs
 *
 * Central registry — import all providers here.
 * To add a new provider: import its singleton and add to REGISTRY.
 */

import { ryanairFareFinderProvider } from './ryanair-fare-finder/index.mjs';
import { wizzAirProvider }           from './wizz-air/index.mjs';

/** All providers in registration order. */
export const REGISTRY = [
  ryanairFareFinderProvider,
  wizzAirProvider,
];

/** Get a provider by id, or null. */
export function getProvider(id) {
  return REGISTRY.find((p) => p.id === id) ?? null;
}

/** Get all enabled providers, sorted by priority asc. */
export function getEnabledProviders() {
  return REGISTRY
    .filter((p) => p.enabled)
    .sort((a, b) => a.priority - b.priority);
}

/**
 * lib/calendar-dump.mjs — persistence side-channel for provider price calendars.
 *
 * Providers already download full daily price calendars (both directions) and
 * discard most of it while cherry-picking "best" fares. For the date-search
 * feature (project docs) they now ALSO accumulate what they saw into
 * `this.lastCalendar` and both collect runners (backend/collect.mjs for GHA,
 * or the server's collect endpoint) call saveProviderCalendar()
 * right after saveSnapshot().
 *
 * Contract for providers:
 *   this.lastCalendar = {
 *     scope:  'all' | '<DEST IATA>',   // per-route for chunked runs (Wizz ATH)
 *     routes: { BUD: { out: { '2026-10-14': {p: 24.99, a: 'FR'} }, in: {...} } }
 *   }
 *
 * Store key: calendar/{providerId}/{landingSlug}/{scope}.json — one file per
 * (provider, landing, scope), overwritten each run. No history: the builder
 * (scripts/build-route-calendar.mjs) merges the latest dump of every provider
 * into route-calendar/{IATA}.json daily.
 *
 * Never throws — a failed calendar dump must not fail the collect run.
 */

import { putJsonObject } from '../snapshots/store.mjs';

/**
 * Accumulate one (destination, direction, date) price point, keeping the
 * cheapest per date. Shared by all providers.
 *
 * @param {object} routes   accumulator: { DEST: { out: {}, in: {} } }
 * @param {string} dest     destination IATA (route is always keyed by dest;
 *                          direction says which leg the price belongs to)
 * @param {'out'|'in'} dir  out = origin→dest, in = dest→origin
 * @param {string} date     'YYYY-MM-DD'
 * @param {number} price    EUR
 * @param {string} airline  IATA airline code, e.g. 'FR'
 */
export function addCalendarPoint(routes, dest, dir, date, price, airline) {
  if (!date || !Number.isFinite(price) || price <= 0) return;
  const route = (routes[dest] ??= { out: {}, in: {} });
  const cur = route[dir][date];
  if (!cur || price < cur.p) {
    route[dir][date] = { p: Math.round(price * 100) / 100, a: airline };
  }
}

/**
 * Persist and clear `provider.lastCalendar`. Called by both collect runners
 * after saveSnapshot(). Resolves to true when a dump was written.
 */
export async function saveProviderCalendar(provider, landing) {
  const cal = provider.lastCalendar;
  provider.lastCalendar = null;
  if (!cal?.routes || Object.keys(cal.routes).length === 0) return false;

  const scope = (cal.scope ?? 'all').toUpperCase() === 'ALL' ? 'all' : cal.scope.toUpperCase();
  const key = `calendar/${provider.id}/${landing.landingSlug}/${scope}.json`;
  try {
    await putJsonObject(key, {
      provider:  provider.id,
      origin:    landing.homeAirportIata,
      scope,
      updatedAt: new Date().toISOString(),
      routes:    cal.routes,
    });
    console.log(`[calendar] saved ${key} (${Object.keys(cal.routes).length} routes)`);
    return true;
  } catch (err) {
    console.warn(`[calendar] dump failed for ${key}: ${err.message}`);
    return false;
  }
}

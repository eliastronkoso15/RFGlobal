/**
 * providers/ryanair-fare-finder/index.mjs
 *
 * Ryanair Fare Finder provider — Provider #2.
 *
 * Collects cheapest one-way Ryanair fares for ALL destinations from a home
 * airport, querying each Friday in the current month + next N months.
 *
 * Data source: services-api.ryanair.com/farfnd/v4/oneWayFares
 *   — same data the Ryanair Fare Finder web page (ryanair.com/fare-finder) uses.
 *
 * Scope (initial):
 *   - One-way only
 *   - Fridays only
 *   - Current month + monthsAhead (default 2) → 3 months total
 *   - Max 10 cheapest results per Friday date
 */

import fetch from 'node-fetch';
import { BaseProvider } from '../base.mjs';
import { PROVIDER_CONFIGS } from '../../config/providers.mjs';
import { addCalendarPoint } from '../../lib/calendar-dump.mjs';

const RY_BASE = 'https://services-api.ryanair.com/farfnd/v4';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-GB,en;q=0.9',
};

// ── Date helpers ─────────────────────────────────────────────────────────────

/** Return YYYY-MM-DD string for a Date object. */
function toDateStr(d) {
  return d.toISOString().substring(0, 10);
}

/**
 * Generate all Fridays (ISO day 5) within a given month.
 * @param {number} year
 * @param {number} month  1-based (1 = January)
 * @returns {string[]}    Array of YYYY-MM-DD strings
 */
function fridaysInMonth(year, month) {
  const fridays = [];
  const d = new Date(year, month - 1, 1); // first day of month
  // Advance to first Friday
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  // Collect all Fridays in this month
  while (d.getMonth() === month - 1) {
    fridays.push(toDateStr(new Date(d)));
    d.setDate(d.getDate() + 7);
  }
  return fridays;
}

/**
 * Return year+month combos for current month + next N months.
 * @param {number} monthsAhead
 * @returns {{ year: number, month: number }[]}
 */
function targetMonths(monthsAhead) {
  const result = [];
  const now = new Date();
  for (let i = 0; i <= monthsAhead; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    result.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return result;
}

/** Generate all Friday dates to query (current + next N months). */
function allFridayDates(monthsAhead) {
  const dates = [];
  for (const { year, month } of targetMonths(monthsAhead)) {
    dates.push(...fridaysInMonth(year, month));
  }
  // Only include dates that are today or in the future
  const today = toDateStr(new Date());
  return dates.filter((d) => d >= today);
}

// ── Provider class ───────────────────────────────────────────────────────────

export class RyanairFareFinderProvider extends BaseProvider {
  constructor(config) {
    super(config);
    const def = config.defaults ?? {};
    this.currency          = def.currency          ?? 'EUR';
    // Per-run currency override from landing providerSettings (set by each
    // collect* entry point, e.g. GBP for the stn landing). Safe as instance
    // state: Lambda handles one request per container, collect.mjs runs one
    // provider×landing per process — no concurrent runs share `this`.
    this._runCurrency      = null;
    this.maxResultsPerDate = def.maxResultsPerDate ?? 10;
    this.monthsAhead       = def.monthsAhead       ?? 2;
  }

  /** Effective currency for the current run (landing override or default). */
  get _currency() {
    return this._runCurrency ?? this.currency;
  }

  /**
   * Fetch all fares for a single departure date (one Friday).
   * Returns up to maxResults cheapest fares, sorted by price asc.
   *
   * @param {string} originIata
   * @param {string} date           YYYY-MM-DD
   * @param {number} maxResults
   * @returns {Promise<object[]>}   Raw Ryanair fare objects
   */
  async _fetchFaresForDate(originIata, date, maxResults) {
    const url =
      `${RY_BASE}/oneWayFares` +
      `?departureAirportIataCode=${originIata.toUpperCase()}` +
      `&outboundDepartureDateFrom=${date}` +
      `&outboundDepartureDateTo=${date}` +
      `&currency=${this._currency}`;

    try {
      const res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.warn(`  [RFF] ${date} HTTP ${res.status}`);
        return [];
      }
      const data = await res.json();
      const fares = data?.fares ?? [];

      // Sort by price asc, keep top N
      return fares
        .filter((f) => f.outbound?.price?.value > 0 && f.outbound?.departureDate)
        .sort((a, b) => a.outbound.price.value - b.outbound.price.value)
        .slice(0, maxResults);
    } catch (err) {
      console.warn(`  [RFF] ${date} error: ${err.message}`);
      return [];
    }
  }

  /**
   * Normalize a single raw Ryanair fare object into a NormalizedFare.
   */
  _normalizeFare(raw, { collectedAt, snapshotId, landingCode }) {
    const ob  = raw.outbound;
    const arr = ob.arrivalAirport ?? {};

    const destinationIata = (arr.iataCode ?? '').toUpperCase();
    const cityCode        = (arr.city?.code ?? arr.city?.iataCode ?? '').toUpperCase();
    const destinationName = arr.city?.name ?? arr.name ?? destinationIata;
    const country         = arr.countryName ?? '';
    const duration        = ob.duration
      ? this._formatDuration(ob.duration)
      : null;

    // Deep-link to Ryanair booking page
    const dateOut = ob.departureDate
      ? ob.departureDate.substring(0, 10)
      : null;
    const deeplink = dateOut
      ? this._buildDeeplink(ob.departureAirport?.iataCode ?? '', destinationIata, dateOut)
      : null;

    return {
      provider:         this.id,
      providerPriority: this.priority,
      providerType:     this.type,
      airline:          'Ryanair',
      airlineCode:      'FR',
      originIata:       (ob.departureAirport?.iataCode ?? '').toUpperCase(),
      destinationIata,
      destinationName,
      destinationCountry: country,
      dateOut,
      dateIn:           null,
      tripType:         'one_way',
      price:            ob.price.value,
      currency:         ob.price.currencyCode ?? this._currency,
      duration,
      deeplink,
      collectedAt,
      snapshotId,
      landingCode,
      rawMeta: {
        fareKey: raw.fareKey ?? null,
      },
    };
  }

  /** Format ISO 8601 duration (PT1H40M) to human string (1 hr 40 min). */
  _formatDuration(iso) {
    const h = iso.match(/(\d+)H/)?.[1];
    const m = iso.match(/(\d+)M/)?.[1];
    const parts = [];
    if (h) parts.push(`${h} hr`);
    if (m) parts.push(`${m} min`);
    return parts.join(' ') || iso;
  }

  /** Build Ryanair one-way booking deep-link. */
  _buildDeeplink(originIata, destIata, dateOut) {
    const O = originIata.toUpperCase();
    const D = destIata.toUpperCase();
    const parts = [
      'adults=1', 'teens=0', 'children=0', 'infants=0',
      `dateOut=${dateOut}`, 'dateIn=',
      'discount=0', 'isReturn=false', 'promoCode=',
      `originIata=${O}`, `destinationIata=${D}`,
      'tpAdults=1', 'tpTeens=0', 'tpChildren=0', 'tpInfants=0',
      `tpStartDate=${dateOut}`, 'tpEndDate=',
      'tpDiscount=0', 'tpPromoCode=',
      `tpOriginIata=${O}`, `tpDestinationIata=${D}`,
    ];
    return `https://www.ryanair.com/gb/en/trip/flights/select?${parts.join('&')}`;
  }

  /** Build Ryanair round-trip booking deep-link. */
  _buildRoundTripDeeplink(originIata, destIata, dateOut, dateIn) {
    const O = originIata.toUpperCase();
    const D = destIata.toUpperCase();
    const parts = [
      'adults=1', 'teens=0', 'children=0', 'infants=0',
      `dateOut=${dateOut}`, `dateIn=${dateIn}`,
      'discount=0', 'isReturn=true', 'promoCode=',
      `originIata=${O}`, `destinationIata=${D}`,
      'tpAdults=1', 'tpTeens=0', 'tpChildren=0', 'tpInfants=0',
      `tpStartDate=${dateOut}`, `tpEndDate=${dateIn}`,
      'tpDiscount=0', 'tpPromoCode=',
      `tpOriginIata=${O}`, `tpDestinationIata=${D}`,
    ];
    return `https://www.ryanair.com/gb/en/trip/flights/select?${parts.join('&')}`;
  }

  // ── Weekend collection ────────────────────────────────────────────────────

  /**
   * Fetch round-trip fares for a specific outbound/inbound date window.
   *
   * Ryanair's `roundTripFares` endpoint returns the **cheapest** pair per
   * destination over the given window — NOT all valid pairs. So:
   *   - Month-wide window → 1 deal per destination per month (used by holiday)
   *   - Single-Friday window → 1 deal per destination per Friday (used by weekend)
   *
   * Discovered 2026-05-24: previously weekend used a month-wide window which
   * lost 75% of Fridays. Narrow per-Friday queries give ~4 entries per
   * destination per month instead of 1.
   *
   * @param {string} originIata
   * @param {string} outFrom       outbound date window start (YYYY-MM-DD)
   * @param {string} outTo         outbound date window end (inclusive)
   * @param {string} inFrom        inbound date window start
   * @param {string} inTo          inbound date window end
   * @param {number} minNights
   * @param {number} maxNights
   * @param {string} [tag]         label for log lines
   * @returns {Promise<object[]>}  Raw Ryanair round-trip fare objects
   */
  async _fetchRoundTripFaresForWindow(originIata, outFrom, outTo, inFrom, inTo, minNights, maxNights, tag = '') {
    const url =
      `${RY_BASE}/roundTripFares` +
      `?departureAirportIataCode=${originIata.toUpperCase()}` +
      `&outboundDepartureDateFrom=${outFrom}&outboundDepartureDateTo=${outTo}` +
      `&inboundDepartureDateFrom=${inFrom}&inboundDepartureDateTo=${inTo}` +
      `&durationFrom=${minNights}&durationTo=${maxNights}` +
      `&currency=${this._currency}`;

    try {
      const res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        console.warn(`  [RFF-RT] ${tag || outFrom} HTTP ${res.status}`);
        return [];
      }
      const data = await res.json();
      return data?.fares ?? [];
    } catch (err) {
      console.warn(`  [RFF-RT] ${tag || outFrom} error: ${err.message}`);
      return [];
    }
  }

  /**
   * Convenience: month-wide window (legacy holiday use-case).
   */
  async _fetchRoundTripFaresForMonth(originIata, yearMonth, minNights, maxNights) {
    const [year, mo] = yearMonth.split('-').map(Number);
    const lastDay    = new Date(year, mo, 0).getDate();
    const dateFrom   = `${yearMonth}-01`;
    const dateTo     = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;
    return this._fetchRoundTripFaresForWindow(
      originIata, dateFrom, dateTo, dateFrom, dateTo, minNights, maxNights, yearMonth,
    );
  }

  /**
   * Returns array of ISO date strings for all Fridays in a given year/month,
   * skipping Fridays that are already in the past (relative to today UTC).
   */
  _fridaysInMonth(year, mo) {
    const out      = [];
    const lastDay  = new Date(year, mo, 0).getDate();
    const todayStr = new Date().toISOString().slice(0, 10);
    for (let d = 1; d <= lastDay; d++) {
      const date = new Date(Date.UTC(year, mo - 1, d));
      if (date.getUTCDay() !== 5) continue;  // 5 = Friday
      const iso = date.toISOString().slice(0, 10);
      if (iso < todayStr) continue;          // skip past Fridays
      out.push(iso);
    }
    return out;
  }

  /**
   * ISO date + N days (kept in UTC).
   */
  _addDaysIso(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Normalize a raw Ryanair round-trip fare into a WeekendPairFare.
   *
   * @param {object} raw
   * @param {{ collectedAt, snapshotId, landingCode }} ctx
   */
  _normalizeWeekendPair(raw, ctx) {
    const ob  = raw.outbound ?? {};
    const ib  = raw.inbound  ?? {};
    const arr = ob.arrivalAirport ?? {};

    const destinationIata = (arr.iataCode ?? '').toUpperCase();
    const destinationName = arr.city?.name ?? arr.name ?? destinationIata;
    const country         = arr.countryName ?? '';
    const originIata      = (ob.departureAirport?.iataCode ?? '').toUpperCase();

    const dateOut = ob.departureDate ? ob.departureDate.substring(0, 10) : null;
    const dateIn  = ib.departureDate ? ib.departureDate.substring(0, 10) : null;

    // Total price from summary; fall back to summing legs
    const totalPrice    = raw.summary?.price?.value ?? 0;
    const outboundPrice = ob.price?.value ?? null;
    const returnPrice   = ib.price?.value ?? null;

    // Use date diff for nights (Ryanair's tripDurationDays counts calendar days
    // including both departure and return day, so Fri→Mon = 4 days ≠ 3 nights).
    const nights = dateOut && dateIn
      ? Math.round((new Date(dateIn) - new Date(dateOut)) / 86400000)
      : (raw.summary?.tripDurationDays ?? null);

    const deeplink = dateOut && dateIn
      ? this._buildRoundTripDeeplink(originIata, destinationIata, dateOut, dateIn)
      : null;

    return {
      provider:           this.id,
      providerPriority:   this.priority,
      providerType:       this.type,
      airline:            'Ryanair',
      airlineCode:        'FR',
      tripType:           'weekend',
      originIata,
      destinationIata,
      destinationName,
      destinationCountry: country,
      dateOut,
      dateIn,
      nights,
      price:              totalPrice,
      outboundPrice,
      returnPrice,
      currency:           ob.price?.currencyCode ?? this._currency,
      deeplink,
      collectedAt:        ctx.collectedAt,
      snapshotId:         ctx.snapshotId,
      landingCode:        ctx.landingCode,
    };
  }

  /**
   * Collect weekend pairs (Fri outbound + Sun/Mon return) for current + next N months.
   * Filters: outbound day = Friday (5), inbound day = Sunday (0) or Monday (1).
   * Uses getUTCDay() to avoid timezone bugs (Thessaloniki is UTC+3).
   *
   * @param {import('../../config/landings.mjs').LANDINGS[number]} landing
   * @param {object}  [options]
   * @param {string}  [options.snapshotId]
   * @param {string}  [options.scheduleType]
   * @returns {Promise<object[]>}  WeekendPairFare[]
   */
  async collectWeekend(landing, options = {}) {
    const origin      = landing.homeAirportIata;
    const settings    = landing.providerSettings?.[this.id] ?? {};
    const months      = settings.monthsAhead ?? this.monthsAhead;
    this._runCurrency = settings.currency ?? null;

    const collectedAt = new Date().toISOString();
    const snapshotId  = options.snapshotId ?? `rff_weekend_${landing.landingSlug}_${Date.now()}`;
    const ctx         = { collectedAt, snapshotId, landingCode: landing.landingSlug };

    const monthList = targetMonths(months);
    console.log(`[RFF-Weekend] Collecting ${origin} — ${monthList.length} months`);

    const allPairs = [];

    // Per-Friday query: Ryanair returns the CHEAPEST pair per destination over
    // the requested window. Month-wide window → 1 entry per destination per
    // month. Per-Friday window → 1 entry per destination per Friday (~4× more
    // data per month). Cost: ~4 API calls per month per landing × 3 months =
    // ~12 calls per collectWeekend. Each ~300ms = ~4 sec wall-clock total.
    for (const { year, month } of monthList) {
      const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
      const fridays   = this._fridaysInMonth(year, month);
      console.log(`  [RFF-Weekend] ${yearMonth}: ${fridays.length} Fridays to query`);

      const monthPairs = [];
      for (const friIso of fridays) {
        // Outbound window: just this Friday. Inbound window: Sun (Fri+2) or
        // Mon (Fri+3). durationFrom=2 durationTo=3 enforces the night count.
        const sunIso = this._addDaysIso(friIso, 2);
        const monIso = this._addDaysIso(friIso, 3);
        const rawFares = await this._fetchRoundTripFaresForWindow(
          origin, friIso, friIso, sunIso, monIso, 2, 3, `${yearMonth}/Fri ${friIso.slice(8)}`,
        );

        // Defensive filter (API already constrained, but verify shape +
        // confirm Fri→Sun/Mon day-of-week).
        const weekendFares = rawFares.filter((fare) => {
          const outDate = fare.outbound?.departureDate;
          const inDate  = fare.inbound?.departureDate;
          const total   = fare.summary?.price?.value;
          if (!outDate || !inDate || !total || total <= 0) return false;
          const outDay = new Date(outDate).getUTCDay();
          const inDay  = new Date(inDate).getUTCDay();
          return outDay === 5 && (inDay === 0 || inDay === 1);
        });

        monthPairs.push(...weekendFares.map((r) => this._normalizeWeekendPair(r, ctx)));
        await new Promise((r) => setTimeout(r, 300));
      }

      console.log(`  [RFF-Weekend] ${yearMonth}: ${monthPairs.length} Fri→Sun/Mon pairs collected`);
      allPairs.push(...monthPairs);

      if (monthPairs.length > 0) {
        const preview = [...monthPairs]
          .sort((a, b) => a.price - b.price)
          .slice(0, 5)
          .map((p) => `${p.destinationIata}:€${Math.round(p.price)}(${p.nights}n)`)
          .join(' ');
        console.log(`  [RFF-Weekend] ${yearMonth}: cheapest → ${preview}`);
      }
    }

    console.log(`[RFF-Weekend] Done — ${allPairs.length} weekend pairs`);
    return allPairs;
  }

  // ── Holiday collection ────────────────────────────────────────────────────

  /**
   * Collect holiday round-trip pairs (any departure day, 5–15 nights) for current + next N months.
   * No day-of-week filter — any departure day qualifies.
   *
   * @param {import('../../config/landings.mjs').LANDINGS[number]} landing
   * @param {object}  [options]
   * @param {string}  [options.snapshotId]
   * @param {string}  [options.scheduleType]
   * @returns {Promise<object[]>}  HolidayPairFare[]
   */
  async collectHoliday(landing, options = {}) {
    const origin    = landing.homeAirportIata;
    const settings  = landing.providerSettings?.[this.id] ?? {};
    const months    = settings.monthsAhead ?? this.monthsAhead;
    this._runCurrency = settings.currency ?? null;

    const collectedAt = new Date().toISOString();
    const snapshotId  = options.snapshotId ?? `rff_holiday_${landing.landingSlug}_${Date.now()}`;
    const ctx         = { collectedAt, snapshotId, landingCode: landing.landingSlug };

    const monthList = targetMonths(months);
    console.log(`[RFF-Holiday] Collecting ${origin} — ${monthList.length} months`);

    const allPairs = [];

    for (const { year, month } of monthList) {
      const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
      // durationFrom=5&durationTo=15: holiday range, any departure day
      const rawFares = await this._fetchRoundTripFaresForMonth(origin, yearMonth, 5, 15);
      console.log(`  [RFF-Holiday] ${yearMonth}: ${rawFares.length} raw round-trip fares`);

      // Accept any departure day — no day-of-week filter
      const validFares = rawFares.filter((fare) => {
        const total = fare.summary?.price?.value;
        return fare.outbound?.departureDate && fare.inbound?.departureDate && total && total > 0;
      });

      console.log(`  [RFF-Holiday] ${yearMonth}: ${validFares.length} valid holiday pairs`);

      const normalized = validFares.map((r) => {
        const pair = this._normalizeWeekendPair(r, ctx);
        pair.tripType = 'holiday';
        return pair;
      });
      allPairs.push(...normalized);

      if (normalized.length > 0) {
        const preview = normalized
          .sort((a, b) => a.price - b.price)
          .slice(0, 5)
          .map((p) => `${p.destinationIata}:€${Math.round(p.price)}(${p.nights}n)`)
          .join(' ');
        console.log(`  [RFF-Holiday] ${yearMonth}: cheapest → ${preview}`);
      }

      await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`[RFF-Holiday] Done — ${allPairs.length} holiday pairs`);
    return allPairs;
  }

  // ── Main collect ───────────────────────────────────────────────────────────

  /**
   * Collect fares for all Fridays across current + next N months.
   * Respects landing-level overrides for maxResultsPerDate and monthsAhead.
   *
   * @param {import('../../config/landings.mjs').LANDINGS[number]} landing
   * @param {object}  [options]
   * @param {string}  [options.snapshotId]
   * @param {string}  [options.scheduleType]  'morning' | 'evening' | 'manual'
   * @returns {Promise<import('../base.mjs').NormalizedFare[]>}
   */
  async collect(landing, options = {}) {
    const origin     = landing.homeAirportIata;
    const settings   = landing.providerSettings?.[this.id] ?? {};
    const maxPerDate = settings.maxResultsPerDate ?? this.maxResultsPerDate;
    const months     = settings.monthsAhead       ?? this.monthsAhead;
    this._runCurrency = settings.currency ?? null;

    const collectedAt = new Date().toISOString();
    const snapshotId  = options.snapshotId ?? `rff_${landing.landingSlug}_${Date.now()}`;
    const ctx         = { collectedAt, snapshotId, landingCode: landing.landingSlug };

    const fridays = allFridayDates(months);
    console.log(`[RFF] Collecting ${origin} — ${fridays.length} Fridays over ${months + 1} months`);
    console.log(`[RFF] Dates: ${fridays.join(', ')}`);

    const allFares = [];
    let totalFetched = 0;

    for (const date of fridays) {
      const rawFares = await this._fetchFaresForDate(origin, date, maxPerDate);
      totalFetched += rawFares.length;
      const normalized = rawFares.map((r) => this._normalizeFare(r, ctx));
      allFares.push(...normalized);

      if (rawFares.length > 0) {
        const prices = normalized.map((f) => `${f.destinationIata}:€${f.price}`).join(' ');
        console.log(`  [RFF] ${date}: ${rawFares.length} fares → ${prices}`);
      } else {
        console.log(`  [RFF] ${date}: no fares`);
      }

      // Small delay to be polite to Ryanair's API
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`[RFF] Done — ${allFares.length} total fares from ${fridays.length} Fridays`);

    // Calendar pass for date-search (project docs): unlike the Friday
    // sampling above, cheapestPerDay returns the full month per route per
    // direction in one plain-HTTPS call. Destinations = whatever this run saw
    // (routes with zero Friday service are invisible here — documented
    // limitation). Never fails the main collect.
    try {
      const dests = [...new Set(allFares.map((f) => f.destinationIata))];
      const calRoutes = {};
      let calls = 0;
      for (const dest of dests) {
        for (const { year, month } of targetMonths(months)) {
          const monthIso = `${year}-${String(month).padStart(2, '0')}-01`;
          for (const dir of ['out', 'in']) {
            const from = dir === 'out' ? origin : dest;
            const to   = dir === 'out' ? dest   : origin;
            const days = await this._fetchCheapestPerDay(from, to, monthIso);
            for (const d of days) addCalendarPoint(calRoutes, dest, dir, d.day, d.price, 'FR');
            calls++;
            await new Promise((r) => setTimeout(r, 200));
          }
        }
      }
      this.lastCalendar = { scope: 'all', routes: calRoutes };
      console.log(`[RFF] Calendar pass — ${dests.length} routes, ${calls} cheapestPerDay calls`);
    } catch (err) {
      console.warn(`[RFF] Calendar pass failed (non-fatal): ${err.message}`);
    }

    return allFares;
  }

  /**
   * Full-month cheapest-per-day calendar for one route + direction.
   * GET /farfnd/v4/oneWayFares/{FROM}/{TO}/cheapestPerDay — probed 2026-09-21,
   * works both directions without auth. Returns [{ day: 'YYYY-MM-DD', price }].
   */
  async _fetchCheapestPerDay(fromIata, toIata, monthIso) {
    const url =
      `${RY_BASE}/oneWayFares/${fromIata.toUpperCase()}/${toIata.toUpperCase()}/cheapestPerDay` +
      `?outboundMonthOfDate=${monthIso}&currency=${this._currency}`;
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        console.warn(`  [RFF] cheapestPerDay ${fromIata}→${toIata} ${monthIso}: HTTP ${res.status}`);
        return [];
      }
      const data = await res.json();
      return (data?.outbound?.fares ?? [])
        .filter((f) => f?.price?.value > 0 && f.day)
        .map((f) => ({ day: f.day, price: f.price.value }));
    } catch (err) {
      console.warn(`  [RFF] cheapestPerDay ${fromIata}→${toIata} ${monthIso}: ${err.message}`);
      return [];
    }
  }
}

// Singleton
export const ryanairFareFinderProvider = new RyanairFareFinderProvider(
  PROVIDER_CONFIGS.ryanair_fare_finder
);

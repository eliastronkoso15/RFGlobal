/**
 * providers/sky-express/index.mjs
 *
 * SKY express (GQ) provider — the airline's own booking-engine API (Sabre
 * ezyCommerce, ex-Radixx "bookSecure"). Plain HTTPS, no browser.
 *
 * Strategy:
 *   1. GET https://flights.skyexpress.gr/en/search — the booking SPA's HTML
 *      carries its runtime config: `apiHost`, `apiKey` (sent as the
 *      Tenant-Identifier header — a public per-airline client id, the same for
 *      every visitor) and `window.version` (X-ClientVersion). Read on every
 *      run instead of hard-coding, so a rotation on their side doesn't break us.
 *   2. POST {apiHost}/api/v1/Availability/SearchLowestFare — the booking form's
 *      "lowest fare" calendar. One call per destination × month returns the
 *      cheapest fare for EVERY day of that month, for both legs:
 *        { passengers:[{code:'ADT',count:1}], currency:'EUR', languageCode,
 *          routes:[{fromAirport, toAirport, departureDate, startDate, endDate},
 *                  {...reverse leg}] }
 *        → routes[i].flights[]: { date, pricePerPassenger, isSoldOut, legs[] }
 *      Only the FIRST month of a startDate..endDate span is priced — later days
 *      come back isSoldOut with price 0 (probe 2026-11-03), so it is one call
 *      per month. The server takes ~13-25 s per call; we run a few in parallel.
 *   3. pricePerPassenger = EUR incl. taxes, 1 adult. legs.length > 1 is a
 *      connection (via ATH) — dropped, direct flights only.
 *
 * One grid fetch per process feeds oneway, weekend and holiday, so
 * `collect.mjs --type all` costs the same as a single type.
 *
 * Booking deeplink — the URL www.skyexpress.gr's own search form builds
 * (buildEzyBookingUrl); `execute=true` runs the search on load:
 *   https://flights.skyexpress.gr/en/search?execute=true&currency=EUR
 *     &routes[0][from]=SKG&routes[0][to]=HER&routes[0][date]=2026-12-03
 *     [&routes[1][from]=HER&routes[1][to]=SKG&routes[1][date]=2026-12-09]
 *     &passengers[0][code]=ADT&passengers[0][count]=1
 */

import { BaseProvider }     from '../base.mjs';
import { PROVIDER_CONFIGS } from '../../config/providers.mjs';
import { addCalendarPoint } from '../../lib/calendar-dump.mjs';
import { airportInfo }      from '../../airports.mjs';

const SEARCH_PAGE = 'https://flights.skyexpress.gr/en/search';
const USER_AGENT  = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/**
 * Direct routes per origin — keys of www.skyexpress.gr's
 * cache.skyexpress.gr/api/get-low-fare-calendar?directOnly=true (2026-11-03).
 * A route without flights in a month comes back empty — harmless, so seasonal
 * routes stay listed year-round.
 */
const DESTINATIONS = {
  SKG: ['ATH', 'CHQ', 'DUS', 'HER', 'JKH', 'JMK', 'LCA', 'MJT', 'PAS', 'RHO', 'SKU', 'SMI'],
  ATH: [
    // Greece
    'AOK', 'AXD', 'CFU', 'CHQ', 'EFL', 'HER', 'JIK', 'JKH', 'JKL', 'JMK', 'JNX', 'JSI',
    'JSY', 'JTR', 'JTY', 'KGS', 'KIT', 'KSO', 'KZI', 'LXS', 'MJT', 'MLO', 'PAS', 'PVK',
    'RHO', 'SKG', 'SMI', 'ZTH',
    // Abroad
    'AMS', 'BCN', 'BER', 'BRU', 'CAI', 'CDG', 'DUS', 'EVN', 'FCO', 'FRA', 'HAM', 'IST',
    'LCA', 'LGW', 'LIS', 'LYS', 'MAD', 'MUC', 'MXP', 'PRG', 'SOF', 'TBS', 'TIA', 'TLV',
    'VIE', 'WAW',
  ],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Current month + `monthsAhead`, plus one trailing month (return legs only). */
function monthsRange(monthsAhead) {
  const now = new Date();
  return Array.from({ length: monthsAhead + 2 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const key = d.toISOString().slice(0, 7);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    return { key, first: `${key}-01`, last, returnsOnly: i === monthsAhead + 1 };
  });
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const round2 = (x) => Math.round(x * 100) / 100;

function buildDeeplink(origin, dest, dateOut, dateIn = null) {
  const p = new URLSearchParams({ execute: 'true', currency: 'EUR' });
  const legs = [[origin, dest, dateOut], ...(dateIn ? [[dest, origin, dateIn]] : [])];
  legs.forEach(([from, to, date], i) => {
    p.set(`routes[${i}][from]`, from);
    p.set(`routes[${i}][to]`, to);
    p.set(`routes[${i}][date]`, date);
  });
  p.set('passengers[0][code]', 'ADT');
  p.set('passengers[0][count]', '1');
  return `${SEARCH_PAGE}?${p.toString()}`;
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// ── SkyExpressProvider ───────────────────────────────────────────────────────

class SkyExpressProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.currency    = config.defaults?.currency    ?? 'EUR';
    this.monthsAhead = config.defaults?.monthsAhead ?? 2;
    this.concurrency = config.defaults?.concurrency ?? 3;
    this.timeoutMs   = config.defaults?.timeoutMs   ?? 90_000;
    /** origin → Promise<grid>; one fetch per process serves all trip types. */
    this._grids = new Map();
  }

  /** Booking SPA runtime config: apiHost, Tenant-Identifier key, client version. */
  async _loadClientConfig() {
    const res = await fetch(SEARCH_PAGE, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`booking page HTTP ${res.status}`);
    const html = await res.text();
    const apiHost = html.match(/"apiHost":"(https:\/\/[^"]+)"/)?.[1];
    const apiKey  = html.match(/"apiKey":"([^"]+)"/)?.[1];
    const version = html.match(/window\.version\s*=\s*'([^']+)'/)?.[1];
    if (!apiHost || !apiKey) throw new Error('booking page: runtimeConfig apiHost/apiKey not found (layout changed?)');
    return { apiHost, apiKey, version };
  }

  /**
   * One SearchLowestFare call: both legs of origin⇄dest for one month.
   * Returns { outbound: Map<date, price>, inbound: Map<date, price> } with
   * direct, bookable days only.
   */
  async _fetchMonth(client, origin, dest, month) {
    const leg = (from, to) => ({ fromAirport: from, toAirport: to, departureDate: month.first, startDate: month.first, endDate: month.last });
    const body = {
      passengers: [{ code: 'ADT', count: 1 }],
      routes: [leg(origin, dest), leg(dest, origin)],
      currency: this.currency,
      fareTypeCategories: null,
      isManageBooking: false,
      languageCode: 'en-us',
    };
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'text/plain',
      'Tenant-Identifier': client.apiKey,
      ...(client.version ? { 'X-ClientVersion': client.version } : {}),
      AppContext: 'ibe',
      Origin: 'https://flights.skyexpress.gr',
      Referer: 'https://flights.skyexpress.gr/',
      'User-Agent': USER_AGENT,
    };

    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${client.apiHost}/api/v1/Availability/SearchLowestFare`, {
          method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`);
          err.fatal = true;   // 4xx: retrying the same request won't help
          throw err;
        }
        const data = await res.json();
        const toMap = (route) => {
          const m = new Map();
          for (const f of route?.flights ?? []) {
            const date  = String(f.date ?? '').slice(0, 10);
            const price = Number(f.pricePerPassenger);
            if (!date.startsWith(month.key) || f.isSoldOut || !(price > 0)) continue;
            if ((f.legs?.length ?? 1) !== 1) continue;   // connection
            if (!m.has(date) || price < m.get(date)) m.set(date, price);
          }
          return m;
        };
        // Match legs by airport, not position, in case the order ever changes.
        const routes = data?.routes ?? [];
        const code = (x) => (typeof x === 'string' ? x : x?.code);
        const out = routes.find((r) => code(r.from) === origin && code(r.to) === dest);
        const inn = routes.find((r) => code(r.from) === dest && code(r.to) === origin);
        return { outbound: toMap(out), inbound: toMap(inn) };
      } catch (err) {
        lastErr = err;
        if (err.fatal || attempt === 3) break;
        await sleep(5_000 * attempt);
      }
    }
    throw lastErr;
  }

  /**
   * Fetch every destination × month for `origin` once per process.
   * grid: Map<dest, Map<monthKey, {outbound, inbound}>>
   */
  _grid(landing) {
    const origin = landing.homeAirportIata;
    if (!this._grids.has(origin)) {
      const p = this._fetchGrid(landing);
      p.catch(() => this._grids.delete(origin));   // let a retry in the same process try again
      this._grids.set(origin, p);
    }
    return this._grids.get(origin);
  }

  async _fetchGrid(landing) {
    const origin = landing.homeAirportIata;
    const dests  = DESTINATIONS[origin] ?? [];
    if (!dests.length) throw new Error(`no SKY express routes configured for ${origin}`);
    const monthsAhead = landing.providerSettings?.[this.id]?.monthsAhead ?? this.monthsAhead;
    const months = monthsRange(monthsAhead);
    const client = await this._loadClientConfig();

    const cells = dests.flatMap((dest) => months.map((month) => ({ dest, month })));
    console.log(`  [sky_express] ${origin}: ${dests.length} destinations × ${months.length} months = ${cells.length} calls, ${this.concurrency} in parallel`);

    const grid = new Map(dests.map((d) => [d, new Map()]));
    const calRoutes = {};
    let failed = 0;
    const t0 = Date.now();

    await pool(cells, this.concurrency, async ({ dest, month }) => {
      try {
        const prices = await this._fetchMonth(client, origin, dest, month);
        grid.get(dest).set(month.key, prices);
        for (const [date, p] of prices.outbound) addCalendarPoint(calRoutes, dest, 'out', date, p, 'GQ');
        for (const [date, p] of prices.inbound)  addCalendarPoint(calRoutes, dest, 'in',  date, p, 'GQ');
        console.log(`  [sky_express] ${origin}⇄${dest} ${month.key}: ${prices.outbound.size} out, ${prices.inbound.size} in`);
      } catch (err) {
        failed++;
        console.error(`  [sky_express] ${origin}⇄${dest} ${month.key}: ${err.message}`);
      }
    });

    console.log(`  [sky_express] ${origin}: grid done in ${Math.round((Date.now() - t0) / 1000)}s, ${failed}/${cells.length} calls failed`);
    // A few failed cells cost a few fares; most of them failing means the API
    // changed or blocks us — fail loudly instead of saving a hollow snapshot.
    if (failed > cells.length / 2) throw new Error(`${failed}/${cells.length} SearchLowestFare calls failed`);

    return { grid, months, calRoutes };
  }

  _normalizeFare(landing, base, dest, fields) {
    const info = airportInfo(dest);
    return {
      provider:           this.id,
      providerPriority:   this.priority,
      providerType:       this.type,
      airline:            'SKY express',
      airlineCode:        'GQ',
      currency:           this.currency,
      duration:           null,
      collectedAt:        base.collectedAt,
      snapshotId:         base.snapshotId,
      landingCode:        landing.landingSlug,
      originIata:         landing.homeAirportIata,
      destinationIata:    dest,
      destinationName:    info.city || dest,
      destinationCountry: info.country || '',
      ...fields,
    };
  }

  /** Shared prologue: grid + calendar side-channel for the collect runner. */
  async _prepare(landing, options) {
    const { grid, months, calRoutes } = await this._grid(landing);
    this.lastCalendar = { scope: 'all', routes: calRoutes };
    return { grid, months, base: { snapshotId: options.snapshotId ?? 'manual', collectedAt: new Date().toISOString() } };
  }

  /** dest's return-leg prices from `fromKey` onwards (covers next-month returns). */
  static _returnsFrom(byMonth, months, fromKey) {
    const all = new Map();
    for (const m of months) {
      if (m.key < fromKey) continue;
      for (const [d, p] of byMonth.get(m.key)?.inbound ?? []) all.set(d, p);
    }
    return all;
  }

  // ── collect (one-way): cheapest day per destination per month ─────────────

  async collect(landing, options = {}) {
    const { grid, months, base } = await this._prepare(landing, options);
    const fares = [];
    for (const [dest, byMonth] of grid) {
      for (const month of months) {
        if (month.returnsOnly) continue;
        let best = null;
        for (const [date, price] of byMonth.get(month.key)?.outbound ?? []) {
          if (!best || price < best.price) best = { date, price };
        }
        if (!best || best.price > 300) continue;
        fares.push(this._normalizeFare(landing, base, dest, {
          dateOut:  best.date,
          dateIn:   null,
          tripType: 'one_way',
          price:    round2(best.price),
          deeplink: buildDeeplink(landing.homeAirportIata, dest, best.date),
        }));
      }
    }
    console.log(`[SkyExpress] ${landing.landingSlug}: ${fares.length} one-way fares`);
    return fares;
  }

  // ── collectWeekend: Friday out, back Sunday (2 nights) or Monday (3) ──────

  async collectWeekend(landing, options = {}) {
    const { grid, months, base } = await this._prepare(landing, options);
    const MAX_LEG = 250;
    const pairs = [];
    for (const [dest, byMonth] of grid) {
      for (const month of months) {
        if (month.returnsOnly) continue;
        const returns = SkyExpressProvider._returnsFrom(byMonth, months, month.key);
        for (const [outDate, outPrice] of byMonth.get(month.key)?.outbound ?? []) {
          if (outPrice > MAX_LEG || new Date(`${outDate}T00:00:00Z`).getUTCDay() !== 5) continue;
          for (const nights of [2, 3]) {
            const retDate = addDays(outDate, nights);
            const retPrice = returns.get(retDate);
            if (!retPrice || retPrice > MAX_LEG) continue;
            pairs.push(this._normalizeFare(landing, base, dest, {
              dateOut:       outDate,
              dateIn:        retDate,
              nights,
              tripType:      'weekend',
              price:         round2(outPrice + retPrice),
              outboundPrice: outPrice,
              returnPrice:   retPrice,
              deeplink:      buildDeeplink(landing.homeAirportIata, dest, outDate, retDate),
            }));
          }
        }
      }
    }
    console.log(`[SkyExpress-Weekend] ${landing.landingSlug}: ${pairs.length} weekend pairs`);
    return pairs;
  }

  // ── collectHoliday: cheapest 5-15 night trip per destination per month ────

  async collectHoliday(landing, options = {}) {
    const { grid, months, base } = await this._prepare(landing, options);
    const MAX_LEG = 300;
    const pairs = [];
    for (const [dest, byMonth] of grid) {
      for (const month of months) {
        if (month.returnsOnly) continue;
        const returns = SkyExpressProvider._returnsFrom(byMonth, months, month.key);
        let best = null;
        for (const [outDate, outPrice] of byMonth.get(month.key)?.outbound ?? []) {
          if (outPrice > MAX_LEG) continue;
          for (let nights = 5; nights <= 15; nights++) {
            const retDate = addDays(outDate, nights);
            const retPrice = returns.get(retDate);
            if (!retPrice || retPrice > MAX_LEG) continue;
            const total = outPrice + retPrice;
            if (!best || total < best.total) best = { outDate, retDate, nights, outPrice, retPrice, total };
          }
        }
        if (!best) continue;
        pairs.push(this._normalizeFare(landing, base, dest, {
          dateOut:       best.outDate,
          dateIn:        best.retDate,
          nights:        best.nights,
          tripType:      'holiday',
          price:         round2(best.total),
          outboundPrice: best.outPrice,
          returnPrice:   best.retPrice,
          deeplink:      buildDeeplink(landing.homeAirportIata, dest, best.outDate, best.retDate),
        }));
      }
    }
    console.log(`[SkyExpress-Holiday] ${landing.landingSlug}: ${pairs.length} holiday pairs`);
    return pairs;
  }
}

export const skyExpressProvider = new SkyExpressProvider(PROVIDER_CONFIGS.sky_express);

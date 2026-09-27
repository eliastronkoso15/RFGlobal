/**
 * providers/flyone/index.mjs
 *
 * FlyOne provider — bookings.flyone.eu FareView API via Playwright.
 *
 * Strategy:
 *   1. Open https://bookings.flyone.eu/FareView in headless Chromium.
 *      The page makes API calls to api2.flyone.eu on load — intercept the first
 *      request to capture the dynamic Bearer token (short-lived JWT).
 *   2. Close browser, use native fetch with captured token for all fare calls.
 *   3. Key endpoint:
 *        POST https://api2.flyone.eu/api/search/get-route-fare
 *        Body: { token, origin, travelDate, currencyCode }
 *        Response: { destinationFares: [{ destination, price, depDate, connType, currencyCode }] }
 *      One call returns the cheapest upcoming fare for ALL destinations from origin.
 *      Window is ~7–14 days from travelDate. Iterate weekly to cover full range.
 *   4. connType=0 → direct flight; connType=1 → connection.
 *      By default only direct flights are collected (directOnly: true).
 *
 * Weekend / Holiday return fares:
 *   FlyOne's API is origin-based (returns all destinations for a given origin).
 *   For round-trips: also query with origin=DEST to get EVN return fare.
 *   The return query is batched by destination to minimise calls.
 *
 * Booking deeplink:
 *   https://bookings.flyone.eu/?origin=EVN&destination=MXP
 *     &departureDate=2026-04-26&adults=1&tripType=OW
 */

import { BaseProvider }    from '../base.mjs';
import { PROVIDER_CONFIGS } from '../../config/providers.mjs';

const FARE_VIEW_URL = 'https://bookings.flyone.eu/FareView';
const API_URL       = 'https://api2.flyone.eu/api/search/get-route-fare';
const BOOK_URL      = 'https://bookings.flyone.eu/';

// ── Curated destination map for EVN (Yerevan) ────────────────────────────────
// Source: api2.flyone.eu /api/Routes/get-routes — EVN arrCodes as of 2026-04.
// Russian airports excluded (sanctions / booking restrictions from EU cards).
// Add/remove as FlyOne updates its network.
const DESTINATIONS_EVN = {
  // Europe — Western
  MXP: { city: 'Milan',             country: 'IT' },
  BGY: { city: 'Bergamo',           country: 'IT' },
  FCO: { city: 'Rome',              country: 'IT' },
  CDG: { city: 'Paris',             country: 'FR' },
  NCE: { city: 'Nice',              country: 'FR' },
  BCN: { city: 'Barcelona',         country: 'ES' },
  ALC: { city: 'Alicante',          country: 'ES' },
  AMS: { city: 'Amsterdam',         country: 'NL' },
  BRU: { city: 'Brussels',          country: 'BE' },
  VIE: { city: 'Vienna',            country: 'AT' },
  CGN: { city: 'Cologne',           country: 'DE' },
  // Europe — South / Balkans
  TIV: { city: 'Tivat',             country: 'ME' },
  SKG: { city: 'Thessaloniki',      country: 'GR' },
  HER: { city: 'Heraklion',         country: 'GR' },
  TIA: { city: 'Tirana',            country: 'AL' },
  RMO: { city: 'Chișinău',          country: 'MD' },
  // Middle East / Near East
  TLV: { city: 'Tel Aviv',          country: 'IL' },
  LCA: { city: 'Larnaca',           country: 'CY' },
  PFO: { city: 'Paphos',            country: 'CY' },
  SSH: { city: 'Sharm el-Sheikh',   country: 'EG' },
  HRG: { city: 'Hurghada',          country: 'EG' },
  DBB: { city: 'Marsa Matrouh',     country: 'EG' },
  MCT: { city: 'Muscat',            country: 'OM' },
  // Caucasus / Central Asia
  TBS: { city: 'Tbilisi',           country: 'GE' },
  BUS: { city: 'Batumi',            country: 'GE' },
  ALA: { city: 'Almaty',            country: 'KZ' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Generate travelDate strings (YYYY-MM-DD) stepping by `stepDays` from
 * today through today + (monthsAhead × 30) days.
 */
function travelDates(monthsAhead = 2, stepDays = 7) {
  const dates = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endMs = today.getTime() + monthsAhead * 30 * 24 * 60 * 60 * 1000;
  for (let ms = today.getTime(); ms <= endMs; ms += stepDays * 24 * 60 * 60 * 1000) {
    dates.push(new Date(ms).toISOString().substring(0, 10));
  }
  return dates;
}

/** Build a booking deeplink for FlyOne. */
function buildDeeplink(origin, dest, depDate, retDate = null) {
  const type = retDate ? 'RT' : 'OW';
  let url = `${BOOK_URL}?origin=${origin}&destination=${dest}`
          + `&departureDate=${depDate}&adults=1&tripType=${type}`;
  if (retDate) url += `&returnDate=${retDate}`;
  return url;
}

/** ISO date string → day-of-week (0=Sun, 1=Mon, …, 5=Fri, 6=Sat) */
function dayOfWeek(dateStr) {
  return new Date(dateStr).getUTCDay();
}

// ── FlyOneProvider ────────────────────────────────────────────────────────────

class FlyOneProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.currency   = config.defaults?.currency   ?? 'EUR';
    this.monthsAhead = config.defaults?.monthsAhead ?? 2;
    this.headless   = config.defaults?.headless   ?? true;
    this.directOnly = config.defaults?.directOnly ?? true;
  }

  /** Launch headless Chromium. */
  async _getBrowserContext() {
    let chromium;
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      throw new Error(
        'playwright not installed. Run: cd backend && npm install playwright && npx playwright install chromium',
      );
    }

    const browser = await chromium.launch({
      headless: this.headless !== false,
      args: [
        ...(this.headless !== false ? ['--headless=new'] : []),
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1400,900',
      ],
    });

    const context = await browser.newContext({
      userAgent:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport:   { width: 1400, height: 900 },
      locale:     'en-US',
      timezoneId: 'Europe/London',
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    return { browser, context };
  }

  /**
   * Load FareView page and intercept the Bearer token from the first
   * api2.flyone.eu request. Returns the token string.
   */
  async _captureToken(context) {
    const page = await context.newPage();
    let token = null;

    // Abort heavy resources we don't need
    await page.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(t)) return route.abort();
      return route.continue();
    });

    // Intercept the Authorization header from api2.flyone.eu
    page.on('request', (req) => {
      if (token) return;
      if (!req.url().includes('api2.flyone.eu')) return;
      const auth = req.headers()['authorization'];
      if (auth?.startsWith('Bearer ')) {
        token = auth.slice(7).trim();
      }
    });

    console.log(`  [flyone] Loading FareView to capture token…`);
    try {
      await page.goto(FARE_VIEW_URL, { waitUntil: 'networkidle', timeout: 60000 });
    } catch (err) {
      if (!err.message.includes('Timeout')) throw err;
      console.warn('  [flyone] Page load timeout — continuing');
    }

    // Brief wait for token to appear
    if (!token) {
      await page.waitForTimeout(3000);
    }

    await page.close();

    if (!token) {
      throw new Error('FlyOne: failed to capture Bearer token from FareView page');
    }
    console.log(`  [flyone] Token captured (length: ${token.length})`);
    return token;
  }

  /**
   * Call get-route-fare API for a single origin + travelDate.
   * Returns array of { destination, price, depDate, connType }.
   */
  async _fetchFares(token, origin, travelDate) {
    const body = JSON.stringify({
      token,
      origin,
      travelDate,
      currencyCode: this.currency,
    });

    const res = await fetch(API_URL, {
      method:  'POST',
      headers: {
        'Authorization':  `Bearer ${token}`,
        'Content-Type':   'application/json',
        'Accept':         'application/json',
      },
      body,
    });

    if (!res.ok) {
      console.warn(`  [flyone] get-route-fare ${origin} ${travelDate}: HTTP ${res.status}`);
      return [];
    }

    const json = await res.json();
    if (!json?.result?.isSuccess) {
      console.warn(`  [flyone] get-route-fare ${origin} ${travelDate}: API error — ${JSON.stringify(json?.result?.msgs)}`);
      return [];
    }

    return json.destinationFares ?? [];
  }

  /**
   * Collect all fare data for an origin over the full date range.
   * Returns Map<destIata, Array<{depDate, price, connType}>> — all windows aggregated.
   */
  async _collectOriginFares(token, origin) {
    const dates = travelDates(this.monthsAhead, 7);
    console.log(`  [flyone] ${origin}: querying ${dates.length} travelDate windows…`);

    /** @type {Map<string, Array<{depDate:string, price:number, connType:number}>>} */
    const byDest = new Map();

    for (const travelDate of dates) {
      try {
        const fares = await this._fetchFares(token, origin, travelDate);
        let count = 0;
        for (const f of fares) {
          if (!f.destination || !f.depDate || !f.price) continue;
          if (this.directOnly && f.connType !== 0) continue;

          if (!byDest.has(f.destination)) byDest.set(f.destination, []);
          const arr = byDest.get(f.destination);

          // Only add if this depDate isn't already present (or update with cheaper)
          const existing = arr.find((x) => x.depDate === f.depDate);
          if (!existing) {
            arr.push({ depDate: f.depDate, price: Number(f.price), connType: f.connType });
            count++;
          } else if (Number(f.price) < existing.price) {
            existing.price = Number(f.price);
          }
        }
        if (count > 0) {
          console.log(`  [flyone] ${origin} travelDate=${travelDate}: ${count} new fare points`);
        }
      } catch (err) {
        console.error(`  [flyone] ${origin} travelDate=${travelDate}: ${err.message}`);
      }
      await sleep(150); // ~6 req/s — stay polite
    }

    return byDest;
  }

  /** Build a NormalizedFare record. */
  _normalize(base, extras) {
    return {
      provider:           this.id,
      providerPriority:   this.priority,
      providerType:       this.type,
      airline:            'FlyOne',
      airlineCode:        '5F',
      currency:           this.currency,
      duration:           null,
      collectedAt:        base.collectedAt,
      snapshotId:         base.snapshotId,
      landingCode:        base.landingCode,
      originIata:         base.origin,
      destinationIata:    extras.dest,
      destinationName:    DESTINATIONS_EVN[extras.dest]?.city    ?? extras.dest,
      destinationCountry: DESTINATIONS_EVN[extras.dest]?.country ?? '',
      ...extras.fields,
    };
  }

  // ── collect() — one-way ───────────────────────────────────────────────────

  async collect(landing, options = {}) {
    const { snapshotId = 'manual' } = options;
    const origin      = landing.homeAirportIata;
    const collectedAt = new Date().toISOString();

    console.log(`\n[FlyOneProvider] collect() — origin: ${origin}`);

    const { browser, context } = await this._getBrowserContext();
    const fares = [];

    try {
      const token  = await this._captureToken(context);
      const byDest = await this._collectOriginFares(token, origin);

      // For each destination: pick the cheapest fare across all windows
      for (const [dest, points] of byDest) {
        if (!DESTINATIONS_EVN[dest]) continue; // skip unknown / irrelevant
        if (points.length === 0) continue;

        // Best = cheapest price overall
        const best = points.reduce((a, b) => (b.price < a.price ? b : a));
        fares.push(this._normalize(
          { origin, collectedAt, snapshotId, landingCode: landing.landingSlug },
          {
            dest,
            fields: {
              dateOut:  best.depDate,
              dateIn:   null,
              tripType: 'one_way',
              price:    Math.round(best.price * 100) / 100,
              deeplink: buildDeeplink(origin, dest, best.depDate),
            },
          }
        ));
      }
    } finally {
      await browser.close();
    }

    console.log(`[FlyOneProvider] done — ${fares.length} one-way fares`);
    return fares;
  }

  // ── collectWeekend() — Fri out / Sun or Mon return ────────────────────────

  async collectWeekend(landing, options = {}) {
    const { snapshotId = 'manual' } = options;
    const origin      = landing.homeAirportIata;
    const collectedAt = new Date().toISOString();

    console.log(`\n[FlyOneProvider] collectWeekend() — origin: ${origin}`);

    const { browser, context } = await this._getBrowserContext();
    const pairs = [];

    try {
      const token = await this._captureToken(context);

      // 1. Collect outbound fares from origin
      const outboundByDest = await this._collectOriginFares(token, origin);

      // 2. For each destination that has outbound Friday fares,
      //    collect return fares (dest → origin direction)
      const destWithFridays = [];
      for (const [dest, points] of outboundByDest) {
        if (!DESTINATIONS_EVN[dest]) continue;
        const fridays = points.filter((p) => dayOfWeek(p.depDate) === 5);
        if (fridays.length > 0) destWithFridays.push(dest);
      }

      console.log(`  [flyone] Fetching return fares for ${destWithFridays.length} destinations with Friday departures`);

      // Return fares: each dest is the origin, our origin is the destination
      const returnByDest = new Map(); // dest → [{depDate, price}] (return = from dest back to origin)
      for (const dest of destWithFridays) {
        try {
          const returnFares = await this._collectOriginFares(token, dest);
          const toOrigin = returnFares.get(origin) ?? [];
          if (toOrigin.length > 0) returnByDest.set(dest, toOrigin);
        } catch (err) {
          console.error(`  [flyone] return fares ${dest}: ${err.message}`);
        }
        await sleep(200);
      }

      // 3. Build Fri–Sun/Mon pairs
      const MAX_LEG = 250;
      for (const [dest, outPoints] of outboundByDest) {
        if (!DESTINATIONS_EVN[dest]) continue;
        const retPoints = returnByDest.get(dest) ?? [];
        if (retPoints.length === 0) continue;

        const retMap = new Map(retPoints.map((p) => [p.depDate, p.price]));

        for (const out of outPoints) {
          if (dayOfWeek(out.depDate) !== 5) continue; // Fridays only
          if (out.price > MAX_LEG) continue;

          for (const nights of [2, 3]) { // Sun (2) or Mon (3)
            const retDate = new Date(out.depDate);
            retDate.setUTCDate(retDate.getUTCDate() + nights);
            const retStr = retDate.toISOString().substring(0, 10);
            const retPrice = retMap.get(retStr);
            if (!retPrice || retPrice > MAX_LEG) continue;

            const total = out.price + retPrice;
            pairs.push(this._normalize(
              { origin, collectedAt, snapshotId, landingCode: landing.landingSlug },
              {
                dest,
                fields: {
                  dateOut:       out.depDate,
                  dateIn:        retStr,
                  nights,
                  tripType:      'weekend',
                  price:         Math.round(total * 100) / 100,
                  outboundPrice: out.price,
                  returnPrice:   retPrice,
                  deeplink:      buildDeeplink(origin, dest, out.depDate, retStr),
                },
              }
            ));
          }
        }
      }
    } finally {
      await browser.close();
    }

    console.log(`[FlyOneProvider] done — ${pairs.length} weekend pairs`);
    return pairs;
  }

  // ── collectHoliday() — any day, 5–15 nights ──────────────────────────────

  async collectHoliday(landing, options = {}) {
    const { snapshotId = 'manual' } = options;
    const origin      = landing.homeAirportIata;
    const collectedAt = new Date().toISOString();

    console.log(`\n[FlyOneProvider] collectHoliday() — origin: ${origin}`);

    const { browser, context } = await this._getBrowserContext();
    const pairs = [];

    try {
      const token = await this._captureToken(context);

      // Collect outbound fares
      const outboundByDest = await this._collectOriginFares(token, origin);

      // Collect return fares for all known destinations
      const knownDests = [...outboundByDest.keys()].filter((d) => DESTINATIONS_EVN[d]);
      console.log(`  [flyone] Fetching return fares for ${knownDests.length} destinations`);

      const returnByDest = new Map();
      for (const dest of knownDests) {
        try {
          const returnFares = await this._collectOriginFares(token, dest);
          const toOrigin = returnFares.get(origin) ?? [];
          if (toOrigin.length > 0) returnByDest.set(dest, toOrigin);
        } catch (err) {
          console.error(`  [flyone] return fares ${dest}: ${err.message}`);
        }
        await sleep(200);
      }

      // Build pairs: best total price for any 5–15 night combination per destination
      const MAX_LEG = 350;
      for (const [dest, outPoints] of outboundByDest) {
        if (!DESTINATIONS_EVN[dest]) continue;
        const retPoints = returnByDest.get(dest) ?? [];
        if (retPoints.length === 0) continue;

        const retMap = new Map(retPoints.map((p) => [p.depDate, p.price]));

        let best = null;
        for (const out of outPoints) {
          if (out.price > MAX_LEG) continue;
          const outDate = new Date(out.depDate);

          for (let nights = 5; nights <= 15; nights++) {
            const retDate = new Date(outDate);
            retDate.setUTCDate(retDate.getUTCDate() + nights);
            const retStr = retDate.toISOString().substring(0, 10);
            const retPrice = retMap.get(retStr);
            if (!retPrice || retPrice > MAX_LEG) continue;

            const total = out.price + retPrice;
            if (!best || total < best.total) {
              best = { total, out, retStr, retPrice, nights };
            }
          }
        }

        if (best) {
          pairs.push(this._normalize(
            { origin, collectedAt, snapshotId, landingCode: landing.landingSlug },
            {
              dest,
              fields: {
                dateOut:       best.out.depDate,
                dateIn:        best.retStr,
                nights:        best.nights,
                tripType:      'holiday',
                price:         Math.round(best.total * 100) / 100,
                outboundPrice: best.out.price,
                returnPrice:   best.retPrice,
                deeplink:      buildDeeplink(origin, dest, best.out.depDate, best.retStr),
              },
            }
          ));
        }
      }
    } finally {
      await browser.close();
    }

    console.log(`[FlyOneProvider] done — ${pairs.length} holiday pairs`);
    return pairs;
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const flyOneProvider = new FlyOneProvider({
  ...PROVIDER_CONFIGS.flyone,
});

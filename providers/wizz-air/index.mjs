/**
 * providers/wizz-air/index.mjs
 *
 * Wizz Air provider — uses the farechart API via Playwright browser session.
 *
 * Strategy:
 *   1. Open one booking page in headless Chromium to establish session cookies
 *   2. Detect current API version from network requests (e.g. "28.6.0")
 *   3. Call /Api/asset/map to discover all routes from origin
 *   4. For each route × each month: call /Api/asset/farechart (POST)
 *      - dayInterval=9, 3 center dates per month (8th, 18th, 28th) → full coverage
 *   5. Extract cheapest price per route per month with exact departure date
 *
 * Why not SmartSearchCheapFlightsV2?
 *   It returns max 4 globally-cheapest results across all months. No month filtering.
 *   Farechart returns per-date prices for a specific route, which is what we need.
 *
 * Why not direct HTTP fetch?
 *   be.wizzair.com is behind CloudFront bot detection. The farechart endpoint
 *   requires session cookies established by a real browser page load.
 *
 * Booking deeplink (one-way):
 *   https://www.wizzair.com/en-gb/booking/select-flight/{ORIGIN}/{DEST}/{DATE}/null/1/0/0/null
 */

import { BaseProvider } from '../base.mjs';
import { PROVIDER_CONFIGS } from '../../config/providers.mjs';
import { AIRPORTS } from '../../airports.mjs';
import { addCalendarPoint } from '../../lib/calendar-dump.mjs';

const WZ_BASE = 'https://www.wizzair.com';

// ── Date helpers ──────────────────────────────────────────────────────────────

function monthsRange(monthsAhead = 2) {
  const months = [];
  const now = new Date();
  for (let i = 0; i <= monthsAhead; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

/**
 * 3 center dates per month for farechart calls.
 * Default: 8th, 18th, 28th — but skip any center that is before today,
 * because the API rejects past center dates with InvalidDate.
 * For the current month, if all 3 centers are past, use today as a center.
 */
function monthCenters(yearMonth) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Two centers cover a full month with dayInterval=9:
  //   10th → window days 1–19
  //   22nd → window days 13–30 (overlap is fine, deduped by date)
  // Avoids the 28th center which frequently triggers 503 rate limiting
  // (Wizz Air throttles harder on near-end-of-month dates that aren't fully open yet).
  const candidates = [`${yearMonth}-10`, `${yearMonth}-22`];
  const valid = candidates.filter((c) => new Date(c) >= today);
  if (valid.length === 0) {
    // All centers are in the past — use today if it's still in this month
    const todayStr = today.toISOString().substring(0, 10);
    if (todayStr.startsWith(yearMonth)) return [todayStr];
    return []; // entire month is in the past
  }
  return valid;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Currency conversion ──────────────────────────────────────────────────────
// Farechart returns prices in the local currency of the departure airport.
// EVN → USD, PRG → CZK, BRI/LCA → EUR, etc.
// We normalize everything to EUR for consistent display and comparison.

const TO_EUR = {
  EUR: 1,
  USD: 0.92,
  GBP: 1.16,
  CZK: 0.040,
  PLN: 0.23,
  RON: 0.20,
  HUF: 0.0025,
  BGN: 0.51,
  SEK: 0.088,
  NOK: 0.086,
  DKK: 0.134,
  CHF: 1.05,
  TRY: 0.027,
  GEL: 0.34,
  AMD: 0.0023,  // Armenian Dram
  ILS: 0.25,
  AED: 0.25,
  BAM: 0.51,
  RSD: 0.0085,
  MKD: 0.016,
  ALL: 0.0094,
  MDL: 0.052,
};

function toEur(amount, currency) {
  if (!currency || currency === 'EUR') return amount;
  const rate = TO_EUR[currency];
  if (!rate) {
    console.warn(`  [wizz] Unknown currency ${currency}, treating as EUR`);
    return amount;
  }
  return Math.round(amount * rate * 100) / 100;
}

// ── WizzAirProvider ───────────────────────────────────────────────────────────

class WizzAirProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.currency    = config.defaults?.currency    ?? 'EUR';
    this.monthsAhead = config.defaults?.monthsAhead ?? 2;
    this.headless    = config.defaults?.headless    ?? true;
  }

  async _getBrowserContext() {
    // Dual-mode Chromium init:
    //   - Lambda runtime → @sparticuz/chromium (compact Lambda-tuned binary
    //     wired through playwright-core). Verified working against Wizz Air
    //     in POC 2026-05-24 (no Akamai block, ~5 sec cold start).
    //   - Local dev / GH Actions → full playwright package with its bundled
    //     Chromium (installed once via `npx playwright install chromium`).
    //     Same code path as before this refactor.
    const isLambda = process.env.LAMBDA_ENV === 'true';

    let chromium, executablePath, launchArgs;
    if (isLambda) {
      try {
        const sparticuz = (await import('@sparticuz/chromium')).default;
        ({ chromium } = await import('playwright-core'));
        executablePath = await sparticuz.executablePath();
        launchArgs     = sparticuz.args;  // Lambda-required flags (no-sandbox, etc.)
      } catch (err) {
        throw new Error(`Failed to load @sparticuz/chromium in Lambda: ${err.message}`);
      }
    } else {
      try {
        ({ chromium } = await import('playwright'));
      } catch {
        throw new Error(
          'playwright not installed. Run: cd backend && npm install playwright && npx playwright install chromium'
        );
      }
      executablePath = undefined;  // playwright will pick bundled binary
      launchArgs     = [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ];
    }

    const browser = await chromium.launch({
      headless:       this.headless,
      executablePath,
      args:           launchArgs,
    });

    const context = await browser.newContext({
      userAgent:  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport:   { width: 1280, height: 800 },
      locale:     'en-GB',
      timezoneId: 'Europe/Athens',
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver',  { get: () => undefined });
      Object.defineProperty(navigator, 'languages',  { get: () => ['en-GB', 'en'] });
      Object.defineProperty(navigator, 'plugins',    { get: () => [1, 2, 3, 4, 5] });
    });

    return { browser, context };
  }

  _buildDeeplink(originIata, destIata, dateOut) {
    return `${WZ_BASE}/en-gb/booking/select-flight/${originIata}/${destIata}/${dateOut}/null/1/0/0/null`;
  }

  /**
   * Synthesize a destination record from an IATA code without hitting the map
   * API. Used by per-route chunked collects (ATH) to skip _discoverRoutes —
   * we already know the IATA up front, so the discovery round-trip is pure
   * overhead. City/country fall back to AIRPORTS table (backend/airports.mjs).
   */
  _synthesizeDestination(iata) {
    const code = String(iata).toUpperCase();
    const info = AIRPORTS[code];
    return {
      iata:        code,
      cityName:    info?.city    || code,
      countryName: info?.country || '',
    };
  }

  /**
   * Open a booking page to establish session cookies and detect API version.
   * Returns { page, apiVersion }.
   */
  async _establishSession(context, originIata, destIata) {
    const page = await context.newPage();

    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type)) return route.abort();
      return route.continue();
    });

    // Detect API version from network requests
    let apiVersion = null;
    page.on('request', (req) => {
      if (!apiVersion) {
        const match = req.url().match(/be\.wizzair\.com\/([\d.]+)\/Api\//);
        if (match) apiVersion = match[1];
      }
    });

    const bookingUrl = `${WZ_BASE}/en-gb/booking/select-flight/${originIata}/${destIata}/2026-05-15/null/1/0/0/null`;
    console.log(`  [wizz] Establishing session: ${bookingUrl}`);
    try {
      await page.goto(bookingUrl, { waitUntil: 'load', timeout: 90000 });
    } catch (err) {
      if (!err.message.includes('Timeout')) throw err;
      console.warn('  [wizz] Page load timeout — continuing with partial session');
    }
    await page.waitForTimeout(3000);

    if (!apiVersion) apiVersion = '28.6.0'; // fallback
    console.log(`  [wizz] API version detected: ${apiVersion}`);

    return { page, apiVersion };
  }

  /**
   * Discover all Wizz Air routes from an origin airport via the map API.
   * @returns {string[]} Array of destination IATA codes
   */
  /**
   * Discover all Wizz Air routes from an origin airport via the map API.
   * @returns {{ iata: string, cityName: string, countryName: string }[]}
   */
  async _discoverRoutes(page, apiVersion, originIata) {
    const routes = await page.evaluate(async ({ apiVersion, originIata }) => {
      const res = await fetch(`https://be.wizzair.com/${apiVersion}/Api/asset/map?languageCode=en-gb`);
      if (!res.ok) return { error: `map API ${res.status}` };
      const data = await res.json();
      const city = data.cities?.find(c => c.iata === originIata);
      if (!city) return { error: `${originIata} not found in map` };

      // Build IATA → city info lookup, and detect city-level "meta" codes.
      // Wizz Air map returns both city codes (LON, PAR, ROM, MIL, BUH, VEN)
      // and airport codes (LTN, BVA, FCO, MXP, OTP, VCE) as separate connections.
      // City codes have names like "Paris (All Airports)" or "Bucharest Any".
      // Farechart returns the same data for both, so skip city codes to save API calls.
      const cityMap = {};
      const metaCodes = new Set(); // city-level codes like PAR, ROM, LON...
      for (const c of data.cities || []) {
        const name = (c.shortName || '').trim();
        cityMap[c.iata] = {
          cityName: name || c.iata,
          countryName: (c.countryName || '').trim(),
        };
        if (name.includes('(All Airports)') || name.endsWith('Any')) {
          metaCodes.add(c.iata);
        }
      }

      const filtered = [];
      const skipped = [];
      for (const c of city.connections) {
        if (metaCodes.has(c.iata)) {
          skipped.push(c.iata);
          continue;
        }
        filtered.push({
          iata: c.iata,
          cityName: cityMap[c.iata]?.cityName || c.iata,
          countryName: cityMap[c.iata]?.countryName || '',
        });
      }

      return {
        connections: filtered,
        skipped,
        cityName: city.shortName,
      };
    }, { apiVersion, originIata });

    if (routes.error) {
      console.warn(`  [wizz] Route discovery failed: ${routes.error}`);
      return [];
    }

    if (routes.skipped.length > 0) {
      console.log(`  [wizz] Skipped city codes (dupes): ${routes.skipped.join(', ')}`);
    }
    console.log(`  [wizz] ${routes.cityName} (${originIata}): ${routes.connections.length} routes — ${routes.connections.map(c => c.iata).join(', ')}`);
    return routes.connections;
  }

  /**
   * Call farechart for one route + one center date.
   * Returns array of { date, price } for dates with price > 0.
   *
   * Two-phase strategy (PR adding SPA-navigation 2026-05-25):
   *
   *   First call on a given page → `page.goto(url)` (~25-30 sec on Lambda
   *     including TLS, HTML, Angular bootstrap, Kasada challenge, analytics).
   *     Establishes the session + Kasada token.
   *
   *   All subsequent calls on the same page → `history.pushState` + popstate
   *     dispatch (~1-3 sec). Angular re-routes WITHOUT a full page reload,
   *     fires a fresh farechart against be.wizzair.com using the still-valid
   *     Kasada interceptor.
   *
   * Why this works: Wizz is an Angular SPA. The Kasada token + axios
   * interceptors are bound to the page's JS context. Full goto throws away
   * that context every time; pushState keeps it. POC measured 8.9× speedup
   * locally (1.7 sec vs 7.9 sec), ~30× extrapolated to Lambda where goto is
   * dominated by network + Kasada handshake (~30 sec) and SPA-nav is bound
   * only by Angular re-render + farechart API roundtrip (~2-3 sec).
   *
   * Fallback: if pushState returns no farechart within timeout, retry with
   * goto. Covers the case where Wizz's Angular router caches the destination
   * and doesn't refire the API (rare, seen on LCA in POC).
   *
   * Page state is tracked via `page._wizzSessionLive` set after the first
   * successful goto. Once true, all subsequent calls take the SPA path.
   *
   * Older Kasada bypass context: be.wizzair.com requires `x-kpsdk-*` +
   * `x-requestverificationtoken` headers that ONLY Wizz's own axios
   * interceptor mints client-side. We never call the API directly — we let
   * the page do it and intercept the response via `page.waitForResponse`.
   *
   * `apiVersion` arg kept for signature compat (used elsewhere — see
   * `_discoverRoutes`) but no longer needed here.
   */
  async _callFarechart(page, _apiVersion, originIata, destIata, centerDate) {
    const dateStr  = String(centerDate).slice(0, 10);
    const pathOnly = `/en-gb/booking/select-flight/${originIata}/${destIata}/${dateStr}/null/1/0/0/null`;
    const fullUrl  = `${WZ_BASE}${pathOnly}`;

    // Decide method: first call ever on this page → goto; rest → SPA-nav.
    const sessionLive = page._wizzSessionLive === true;

    for (let attempt = 0; attempt < 2; attempt++) {
      // Retry forces goto: pushState may have hit Angular's same-URL cache
      // or the session may have expired. Goto refreshes Kasada token too.
      const useSPA  = sessionLive && attempt === 0;
      const timeout = useSPA ? 12_000 : 25_000;

      // Set up response interceptor BEFORE triggering navigation.
      const responsePromise = page.waitForResponse(
        (r) => r.url().includes('/Api/asset/farechart') && r.request().method() === 'POST',
        { timeout },
      ).catch(() => null);

      try {
        if (useSPA) {
          await page.evaluate((u) => {
            history.pushState({}, '', u);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }, pathOnly);
        } else {
          await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        }
      } catch (err) {
        // Wizz's load event sometimes never fires due to analytics. The
        // farechart fires earlier — our responsePromise already captures it.
        if (!err.message.includes('Timeout')) throw err;
      }

      const resp = await responsePromise;
      if (!resp) {
        if (attempt === 0) {
          const why = useSPA ? 'SPA-nav missed farechart, retrying via goto' : 'No farechart response, retrying';
          console.log(`  [wizz] ${why} on ${originIata}→${destIata} ${dateStr}...`);
          await sleep(1500);
          continue;
        }
        console.warn(`  [wizz] ${originIata}→${destIata} ${dateStr}: no response after retries`);
        return [];
      }

      const status = resp.status();
      if (status === 429 || status === 503) {
        const wait = (attempt + 1) * 5000; // 5s, then 10s
        console.log(`  [wizz] Rate-limited (${status}) on ${originIata}→${destIata} ${dateStr}, waiting ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }
      if (status !== 200) {
        console.warn(`  [wizz] ${originIata}→${destIata} ${dateStr}: HTTP ${status}`);
        return [];
      }

      // First successful response — flip the flag so future calls use SPA.
      // Also gets set on the goto retry path: a successful goto refreshes
      // the Kasada token and we want subsequent calls to ride it via SPA.
      page._wizzSessionLive = true;

      let json;
      try { json = await resp.json(); }
      catch { return []; }

      const rawPrices = (json.outboundFlights || [])
        .filter((f) => f.price?.amount > 0 && f.priceType === 'price')
        .map((f) => ({
          date:     f.date?.substring(0, 10),
          price:    f.price.amount,
          currency: f.price.currencyCode || 'EUR',
        }));

      // Convert all prices to EUR (farechart returns local currency of
      // the departure airport — e.g. CHF for SKG→BSL, HUF for SKG→BUD).
      return rawPrices.map((p) => ({
        ...p,
        price:            toEur(p.price, p.currency),
        originalPrice:    p.price,
        originalCurrency: p.currency,
        currency:         'EUR',
      }));
    }
    return [];
  }

  /**
   * Get cheapest fare for a route in a specific month using 3 farechart calls.
   * Returns { date, price, currency } or null if no flights.
   */
  async _cheapestForMonth(page, apiVersion, originIata, destIata, yearMonth) {
    const centers = monthCenters(yearMonth);
    const allPrices = [];

    for (const center of centers) {
      const prices = await this._callFarechart(page, apiVersion, originIata, destIata, center);
      // Only keep prices in the target month
      allPrices.push(...prices.filter(p => p.date?.startsWith(yearMonth)));
      if (centers.length > 1) await sleep(500); // throttle between centers
    }

    if (allPrices.length === 0) return null;

    // Deduplicate by date (overlapping windows), keep cheapest per date
    const byDate = new Map();
    for (const p of allPrices) {
      if (!byDate.has(p.date) || p.price < byDate.get(p.date).price) {
        byDate.set(p.date, p);
      }
    }

    // Return the overall cheapest
    let cheapest = null;
    for (const p of byDate.values()) {
      if (!cheapest || p.price < cheapest.price) cheapest = p;
    }
    return cheapest;
  }

  _normalizeFare(raw, { originIata, collectedAt, snapshotId, landingCode }) {
    const deeplink = this._buildDeeplink(originIata, raw.destIata, raw.dateOut);
    return {
      provider:           this.id,
      providerPriority:   this.priority,
      providerType:       this.type,
      airline:            'Wizz Air',
      airlineCode:        'W6',
      originIata,
      destinationIata:    raw.destIata,
      destinationName:    raw.cityName || '',
      destinationCountry: raw.countryName || '',
      dateOut:            raw.dateOut,
      dateIn:             null,
      tripType:           'one_way',
      price:              raw.price,
      currency:           raw.currency || this.currency,
      duration:           null,
      deeplink,
      collectedAt,
      snapshotId,
      landingCode,
    };
  }

  /**
   * Collect cheapest one-way Wizz Air fares for all destinations from origin.
   *
   * Flow:
   *   1. Launch browser, open booking page (session + API version)
   *   2. Discover routes via map API
   *   3. For each route × month: farechart → cheapest price with exact date
   *   4. Normalize and return
   */
  async collect(landing, options = {}) {
    const { snapshotId = 'manual', route = null } = options;
    const origin   = landing.homeAirportIata;
    const months   = monthsRange(this.monthsAhead);
    const collectedAt = new Date().toISOString();
    const skipRoutes  = new Set(
      (landing.providerSettings?.wizz_air?.skipRoutes ?? []).map(s => s.toUpperCase())
    );

    console.log(`\n[WizzAirProvider] collect() — origin: ${origin}${route ? `, single route: ${route}` : ''}, months: ${months.join(', ')}`);

    const { browser, context } = await this._getBrowserContext();
    const allFares = [];

    try {
      // Step 1: Establish session. For per-route chunked runs we pass the
      // target route as the bootstrap dest so the warm-up booking page is
      // already relevant (cheaper Kasada token mint than an unrelated dest).
      const bootstrapDest = route ? String(route).toUpperCase() : 'BUD';
      const { page, apiVersion } = await this._establishSession(context, origin, bootstrapDest);

      // Step 2: Resolve destinations — single route (chunked) or full discovery.
      let destinations;
      if (route) {
        destinations = [this._synthesizeDestination(route)];
      } else {
        destinations = await this._discoverRoutes(page, apiVersion, origin);
        if (skipRoutes.size > 0) {
          const before = destinations.length;
          destinations = destinations.filter(d => !skipRoutes.has(d.iata));
          if (destinations.length < before) {
            console.log(`  [wizz] Skipped ${before - destinations.length} route(s) per skipRoutes config: ${[...skipRoutes].join(', ')}`);
          }
        }
      }
      if (destinations.length === 0) {
        console.warn(`  [wizz] No routes found for ${origin}`);
        return [];
      }

      // Step 3: Farechart per route × month (with throttling to avoid rate limits)
      for (let ri = 0; ri < destinations.length; ri++) {
        const dest = destinations[ri];
        if (ri > 0) await sleep(1500); // 1.5s between routes
        for (const yearMonth of months) {
          try {
            const cheapest = await this._cheapestForMonth(page, apiVersion, origin, dest.iata, yearMonth);
            if (cheapest && cheapest.price <= 200) {
              const fare = this._normalizeFare(
                { destIata: dest.iata, cityName: dest.cityName, countryName: dest.countryName, dateOut: cheapest.date, price: cheapest.price, currency: 'EUR' },
                { originIata: origin, collectedAt, snapshotId, landingCode: landing.landingSlug }
              );
              allFares.push(fare);
              console.log(`  [wizz] ${origin}→${dest.iata} ${yearMonth}: €${cheapest.price} (${cheapest.date})`);
            } else if (cheapest && cheapest.price > 200) {
              console.log(`  [wizz] ${origin}→${dest.iata} ${yearMonth}: €${cheapest.price} — skipped (>€200)`);
            } else {
              console.log(`  [wizz] ${origin}→${dest.iata} ${yearMonth}: no flights`);
            }
          } catch (err) {
            console.error(`  [wizz] ${origin}→${dest.iata} ${yearMonth}: error — ${err.message}`);
          }
        }
      }

      await page.close();
    } finally {
      await browser.close();
    }

    console.log(`[WizzAirProvider] collect() done — ${allFares.length} fares total`);
    return allFares;
  }

  /**
   * Get ALL prices for a route in a month (not just cheapest).
   * Returns Map<date, { date, price, currency }>.
   */
  async _allPricesForMonth(page, apiVersion, originIata, destIata, yearMonth) {
    const centers = monthCenters(yearMonth);
    const byDate = new Map();

    for (const center of centers) {
      const prices = await this._callFarechart(page, apiVersion, originIata, destIata, center);
      for (const p of prices) {
        if (p.date?.startsWith(yearMonth)) {
          if (!byDate.has(p.date) || p.price < byDate.get(p.date).price) {
            byDate.set(p.date, p);
          }
        }
      }
      if (centers.length > 1) await sleep(500);
    }
    return byDate;
  }

  /**
   * Collect weekend (Fri→Sun/Mon) round-trip pairs via farechart.
   *
   * Strategy:
   *   1. For each route × month, get ALL outbound prices (origin→dest)
   *   2. Also get ALL return prices (dest→origin) for the same month
   *   3. Match Friday outbound with Sunday (2 nights) or Monday (3 nights) return
   *   4. Sum prices, keep cheapest pair per destination per month
   */
  async collectWeekend(landing, options = {}) {
    const { snapshotId = 'manual', route = null } = options;
    const origin = landing.homeAirportIata;
    const months = monthsRange(this.monthsAhead);
    const collectedAt = new Date().toISOString();
    const skipRoutes  = new Set(
      (landing.providerSettings?.wizz_air?.skipRoutes ?? []).map(s => s.toUpperCase())
    );

    console.log(`\n[WizzAir-Weekend] collectWeekend() — origin: ${origin}${route ? `, single route: ${route}` : ''}, months: ${months.join(', ')}`);

    const { browser, context } = await this._getBrowserContext();
    const allPairs = [];
    // Full daily calendars seen during this run — persisted by the collect
    // runner via saveProviderCalendar().
    const calRoutes = {};

    try {
      const bootstrapDest = route ? String(route).toUpperCase() : 'BUD';
      const { page, apiVersion } = await this._establishSession(context, origin, bootstrapDest);
      let destinations;
      if (route) {
        destinations = [this._synthesizeDestination(route)];
      } else {
        destinations = await this._discoverRoutes(page, apiVersion, origin);
        if (skipRoutes.size > 0) {
          const before = destinations.length;
          destinations = destinations.filter(d => !skipRoutes.has(d.iata));
          if (destinations.length < before) {
            console.log(`  [wizz-wknd] Skipped ${before - destinations.length} route(s) per skipRoutes config`);
          }
        }
      }
      if (destinations.length === 0) return [];

      for (let ri = 0; ri < destinations.length; ri++) {
        const dest = destinations[ri];
        if (ri > 0) await sleep(2000); // 2s between routes (weekend does more calls per route)
        for (const yearMonth of months) {
          try {
            // Get outbound prices (origin→dest)
            const outbound = await this._allPricesForMonth(page, apiVersion, origin, dest.iata, yearMonth);
            if (outbound.size === 0) {
              console.log(`  [wizz-wknd] ${origin}→${dest.iata} ${yearMonth}: no outbound`);
              continue;
            }

            // Get return prices (dest→origin) — same month + a few days into next
            const returnPrices = await this._allPricesForMonth(page, apiVersion, dest.iata, origin, yearMonth);
            // Also check start of next month (for Fri 28+ → Mon 1+)
            const [y, m] = yearMonth.split('-').map(Number);
            const nextMonth = m === 12
              ? `${y + 1}-01`
              : `${y}-${String(m + 1).padStart(2, '0')}`;
            const returnNextMonth = await this._allPricesForMonth(page, apiVersion, dest.iata, origin, nextMonth);
            for (const [k, v] of returnNextMonth) returnPrices.set(k, v);

            // Accumulate the raw calendars before pairing throws data away.
            for (const [d, f] of outbound)     addCalendarPoint(calRoutes, dest.iata, 'out', d, f.price, 'W6');
            for (const [d, f] of returnPrices) addCalendarPoint(calRoutes, dest.iata, 'in',  d, f.price, 'W6');

            // Match Friday outbound with Sunday (2n) or Monday (3n) return
            const pairs = [];
            for (const [outDate, outFare] of outbound) {
              const outDay = new Date(outDate).getUTCDay();
              if (outDay !== 5) continue; // Friday only

              // Check Sunday return (2 nights)
              const sun = new Date(outDate);
              sun.setDate(sun.getDate() + 2);
              const sunStr = sun.toISOString().substring(0, 10);
              const sunReturn = returnPrices.get(sunStr);

              // Check Monday return (3 nights)
              const mon = new Date(outDate);
              mon.setDate(mon.getDate() + 3);
              const monStr = mon.toISOString().substring(0, 10);
              const monReturn = returnPrices.get(monStr);

              const MAX_LEG_EUR = 200; // skip if either leg > €200

              if (sunReturn && outFare.price <= MAX_LEG_EUR && sunReturn.price <= MAX_LEG_EUR) {
                pairs.push({
                  dateOut: outDate, dateIn: sunStr, nights: 2,
                  outPrice: outFare.price, retPrice: sunReturn.price,
                  total: outFare.price + sunReturn.price,
                  currency: 'EUR',
                });
              }
              if (monReturn && outFare.price <= MAX_LEG_EUR && monReturn.price <= MAX_LEG_EUR) {
                pairs.push({
                  dateOut: outDate, dateIn: monStr, nights: 3,
                  outPrice: outFare.price, retPrice: monReturn.price,
                  total: outFare.price + monReturn.price,
                  currency: 'EUR',
                });
              }
            }

            if (pairs.length === 0) {
              console.log(`  [wizz-wknd] ${origin}→${dest.iata} ${yearMonth}: no Fri→Sun/Mon pairs`);
              continue;
            }

            // Keep all pairs (dedup happens at API layer)
            for (const pair of pairs) {
              const deeplink = `${WZ_BASE}/en-gb/booking/select-flight/${origin}/${dest.iata}/${pair.dateOut}/${pair.dateIn}/1/0/0/null`;
              allPairs.push({
                provider:           this.id,
                providerPriority:   this.priority,
                providerType:       this.type,
                airline:            'Wizz Air',
                airlineCode:        'W6',
                tripType:           'weekend',
                originIata:         origin,
                destinationIata:    dest.iata,
                destinationName:    dest.cityName || '',
                destinationCountry: dest.countryName || '',
                dateOut:            pair.dateOut,
                dateIn:             pair.dateIn,
                nights:             pair.nights,
                price:              Math.round(pair.total * 100) / 100,
                outboundPrice:      pair.outPrice,
                returnPrice:        pair.retPrice,
                currency:           pair.currency || this.currency,
                deeplink,
                collectedAt,
                snapshotId,
                landingCode:        landing.landingSlug,
              });
            }

            const cheapest = pairs.sort((a, b) => a.total - b.total)[0];
            console.log(`  [wizz-wknd] ${origin}→${dest.iata} ${yearMonth}: ${pairs.length} pairs, cheapest €${Math.round(cheapest.total)}(${cheapest.nights}n)`);

          } catch (err) {
            console.error(`  [wizz-wknd] ${origin}→${dest.iata} ${yearMonth}: error — ${err.message}`);
          }
        }
      }

      await page.close();
    } finally {
      await browser.close();
    }

    this.lastCalendar = { scope: route ? String(route).toUpperCase() : 'all', routes: calRoutes };

    console.log(`[WizzAir-Weekend] done — ${allPairs.length} weekend pairs total`);
    return allPairs;
  }

  /**
   * Collect holiday round-trip pairs (any departure day, 5–15 nights) via farechart.
   *
   * Strategy:
   *   1. For each route × month, get ALL outbound prices (origin→dest)
   *   2. Get ALL return prices (dest→origin) for same month + next month
   *   3. For each outbound date, find cheapest return 5–15 days later
   *   4. Keep cheapest pair per destination per month
   */
  async collectHoliday(landing, options = {}) {
    const { snapshotId = 'manual', route = null } = options;
    const origin = landing.homeAirportIata;
    const months = monthsRange(this.monthsAhead);
    const collectedAt = new Date().toISOString();
    const skipRoutes  = new Set(
      (landing.providerSettings?.wizz_air?.skipRoutes ?? []).map(s => s.toUpperCase())
    );

    console.log(`\n[WizzAir-Holiday] collectHoliday() — origin: ${origin}${route ? `, single route: ${route}` : ''}, months: ${months.join(', ')}`);

    const { browser, context } = await this._getBrowserContext();
    const allPairs = [];

    // Return price cache: avoids re-fetching dest→origin for the same month when it
    // appears as both "current month" and "next month" across consecutive outbound months.
    // Key: `${destIata}-${originIata}-${yearMonth}` → Map<date, fare>
    const returnCache = new Map();

    const getCachedReturn = async (destIata, yearMonth) => {
      const key = `${destIata}-${origin}-${yearMonth}`;
      if (returnCache.has(key)) return returnCache.get(key);
      const prices = await this._allPricesForMonth(page, apiVersion, destIata, origin, yearMonth);
      returnCache.set(key, prices);
      return prices;
    };

    let page, apiVersion;

    try {
      const bootstrapDest = route ? String(route).toUpperCase() : 'BUD';
      ({ page, apiVersion } = await this._establishSession(context, origin, bootstrapDest));
      let destinations;
      if (route) {
        destinations = [this._synthesizeDestination(route)];
      } else {
        destinations = await this._discoverRoutes(page, apiVersion, origin);
        if (skipRoutes.size > 0) {
          const before = destinations.length;
          destinations = destinations.filter(d => !skipRoutes.has(d.iata));
          if (destinations.length < before) {
            console.log(`  [wizz-hol] Skipped ${before - destinations.length} route(s) per skipRoutes config: ${[...skipRoutes].join(', ')}`);
          }
        }
      }
      if (destinations.length === 0) return [];

      for (let ri = 0; ri < destinations.length; ri++) {
        const dest = destinations[ri];
        if (ri > 0) await sleep(2000); // 2s between routes

        for (const yearMonth of months) {
          try {
            // Outbound prices: origin → dest
            const outbound = await this._allPricesForMonth(page, apiVersion, origin, dest.iata, yearMonth);
            if (outbound.size === 0) {
              console.log(`  [wizz-hol] ${origin}→${dest.iata} ${yearMonth}: no outbound`);
              continue;
            }

            // Return prices: dest → origin (same month + next month covers all 5–15 night windows)
            // Uses cache to avoid re-fetching months already queried for adjacent outbound windows.
            const [y, m] = yearMonth.split('-').map(Number);
            const nextMonthStr = m === 12
              ? `${y + 1}-01`
              : `${y}-${String(m + 1).padStart(2, '0')}`;

            const returnSame = await getCachedReturn(dest.iata, yearMonth);
            const returnNext = await getCachedReturn(dest.iata, nextMonthStr);
            const returnPrices = new Map([...returnSame, ...returnNext]);

            // Find cheapest pair: any outbound day, return 5–15 days later
            let bestPair = null;
            const MAX_LEG = 300;

            for (const [outDate, outFare] of outbound) {
              if (outFare.price > MAX_LEG) continue;
              const outDateObj = new Date(outDate);

              for (let nights = 5; nights <= 15; nights++) {
                const retDate = new Date(outDateObj);
                retDate.setDate(retDate.getDate() + nights);
                const retStr  = retDate.toISOString().substring(0, 10);
                const retFare = returnPrices.get(retStr);
                if (!retFare || retFare.price > MAX_LEG) continue;

                const total = outFare.price + retFare.price;
                if (!bestPair || total < bestPair.total) {
                  bestPair = {
                    dateOut:  outDate,
                    dateIn:   retStr,
                    nights,
                    outPrice: outFare.price,
                    retPrice: retFare.price,
                    total,
                    currency: 'EUR',
                  };
                }
              }
            }

            if (!bestPair) {
              console.log(`  [wizz-hol] ${origin}→${dest.iata} ${yearMonth}: no 5–15 night pairs`);
              continue;
            }

            const deeplink = `${WZ_BASE}/en-gb/booking/select-flight/${origin}/${dest.iata}/${bestPair.dateOut}/${bestPair.dateIn}/1/0/0/null`;
            allPairs.push({
              provider:           this.id,
              providerPriority:   this.priority,
              providerType:       this.type,
              airline:            'Wizz Air',
              airlineCode:        'W6',
              tripType:           'holiday',
              originIata:         origin,
              destinationIata:    dest.iata,
              destinationName:    dest.cityName || '',
              destinationCountry: dest.countryName || '',
              dateOut:            bestPair.dateOut,
              dateIn:             bestPair.dateIn,
              nights:             bestPair.nights,
              price:              Math.round(bestPair.total * 100) / 100,
              outboundPrice:      bestPair.outPrice,
              returnPrice:        bestPair.retPrice,
              currency:           bestPair.currency,
              deeplink,
              collectedAt,
              snapshotId,
              landingCode:        landing.landingSlug,
            });

            console.log(`  [wizz-hol] ${origin}→${dest.iata} ${yearMonth}: €${Math.round(bestPair.total)}(${bestPair.nights}n) ${bestPair.dateOut}→${bestPair.dateIn}`);

          } catch (err) {
            console.error(`  [wizz-hol] ${origin}→${dest.iata} ${yearMonth}: error — ${err.message}`);
          }
        }
      }

      await page.close();
    } finally {
      await browser.close();
    }

    console.log(`[WizzAir-Holiday] done — ${allPairs.length} holiday pairs total`);
    return allPairs;
  }
}

export const wizzAirProvider = new WizzAirProvider(PROVIDER_CONFIGS.wizz_air);

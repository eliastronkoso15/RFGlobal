/**
 * providers/aegean-air/index.mjs
 *
 * Aegean Airlines provider — Low Fare Calendar JSON endpoints via Playwright.
 *
 * Strategy:
 *   1. Open https://en.aegeanair.com/flight-deals/low-fare-calendar/ in headless
 *      Chromium so Akamai Bot Manager can complete its JS challenge and seed
 *      the `_abck` cookie in the browser context.
 *   2. Reuse that context to call two pure-JSON GET endpoints from
 *      page.evaluate(fetch(...)) — cookies are attached automatically:
 *
 *      A) /en/sys/LowFareCalendar/CalendarResults
 *         ?TravelType=R&AirportFrom=SKG&AirportTo=ATH
 *         → returns cheapest price per month (10 months ahead) for both legs
 *
 *      B) /en/sys/lowfares/RouteLowFares/
 *         ?DepartureAirport=SKG&ArrivalAirport=ATH&TripType=RT
 *         &DepartureDate=2026-4&ReturnDate=2026-4&Type=Fares
 *         → per-day prices: { Outbound:[{Date, Price}], Inbound:[...] }
 *           Date format: "\"/Date(<epochMs>)/\""  (yes, double-quoted)
 *
 * One call to (B) per destination × month covers oneway, weekend and holiday
 * modes, because it includes BOTH outbound and return daily prices.
 *
 * Booking deeplink:
 *   https://en.aegeanair.com/flight-deals/low-fare-calendar/
 *     ?type=R&dep=SKG&arr=ATH&dd=YYYY-MM-DD&rd=YYYY-MM-DD
 *   (this sets the form state; user clicks through to the IBE)
 */

import { BaseProvider } from '../base.mjs';
import { PROVIDER_CONFIGS } from '../../config/providers.mjs';
import { addCalendarPoint } from '../../lib/calendar-dump.mjs';

const BASE_URL     = 'https://en.aegeanair.com';
const CALENDAR_URL = `${BASE_URL}/flight-deals/low-fare-calendar/`;

/**
 * Curated destination lists per origin airport.
 * Stale/non-existent routes return no fares — harmless.
 * Add new routes here when Aegean publishes new timetables.
 */
const DESTINATIONS = {

  // ── SKG (Thessaloniki) ────────────────────────────────────────────────────
  SKG: {
    // Domestic
    ATH: { city: 'Athens',       country: 'GR' },
    HER: { city: 'Heraklion',    country: 'GR' },
    CHQ: { city: 'Chania',       country: 'GR' },
    RHO: { city: 'Rhodes',       country: 'GR' },
    JMK: { city: 'Mykonos',      country: 'GR' },
    JTR: { city: 'Santorini',    country: 'GR' },
    CFU: { city: 'Corfu',        country: 'GR' },
    KGS: { city: 'Kos',          country: 'GR' },
    ZTH: { city: 'Zakynthos',    country: 'GR' },
    JSI: { city: 'Skiathos',     country: 'GR' },
    SMI: { city: 'Samos',        country: 'GR' },
    EFL: { city: 'Kefalonia',    country: 'GR' },
    LXS: { city: 'Lemnos',       country: 'GR' },
    MJT: { city: 'Mytilene',     country: 'GR' },
    // International
    LHR: { city: 'London',       country: 'GB' },
    CDG: { city: 'Paris',        country: 'FR' },
    FRA: { city: 'Frankfurt',    country: 'DE' },
    MUC: { city: 'Munich',       country: 'DE' },
    BER: { city: 'Berlin',       country: 'DE' },
    DUS: { city: 'Düsseldorf',   country: 'DE' },
    STR: { city: 'Stuttgart',    country: 'DE' },
    VIE: { city: 'Vienna',       country: 'AT' },
    ZRH: { city: 'Zurich',       country: 'CH' },
    BRU: { city: 'Brussels',     country: 'BE' },
    AMS: { city: 'Amsterdam',    country: 'NL' },
    MXP: { city: 'Milan',        country: 'IT' },
    FCO: { city: 'Rome',         country: 'IT' },
    BCN: { city: 'Barcelona',    country: 'ES' },
    MAD: { city: 'Madrid',       country: 'ES' },
    IST: { city: 'Istanbul',     country: 'TR' },
    TLV: { city: 'Tel Aviv',     country: 'IL' },
    LCA: { city: 'Larnaca',      country: 'CY' },
    SOF: { city: 'Sofia',        country: 'BG' },
    BEG: { city: 'Belgrade',     country: 'RS' },
    PRG: { city: 'Prague',       country: 'CZ' },
  },

  // ── ATH (Athens) ───────────────────────────────────────────────────────────
  // Athens = Aegean's primary hub. Largest network of any origin — superset
  // of SKG + most major European capitals + Middle East / North Africa.
  // Curated 2026-06-01 from Aegean's published destinations (Wikipedia list
  // cross-checked against ATH summer 2026 timetable). Seasonal routes
  // included — Aegean's API returns empty for non-operating periods, which
  // is harmless and silently skipped by the collector.
  ATH: {
    // ── Domestic (Greek islands + mainland) ──────────────────────────
    SKG: { city: 'Thessaloniki', country: 'GR' },
    HER: { city: 'Heraklion',    country: 'GR' },
    CHQ: { city: 'Chania',       country: 'GR' },
    JTR: { city: 'Santorini',    country: 'GR' },
    RHO: { city: 'Rhodes',       country: 'GR' },
    JMK: { city: 'Mykonos',      country: 'GR' },
    KGS: { city: 'Kos',          country: 'GR' },
    CFU: { city: 'Corfu',        country: 'GR' },
    ZTH: { city: 'Zakynthos',    country: 'GR' },
    JSI: { city: 'Skiathos',     country: 'GR' },
    SMI: { city: 'Samos',        country: 'GR' },
    EFL: { city: 'Kefalonia',    country: 'GR' },
    LXS: { city: 'Lemnos',       country: 'GR' },
    MJT: { city: 'Mytilini',     country: 'GR' },
    JKH: { city: 'Chios',        country: 'GR' },
    KVA: { city: 'Kavala',       country: 'GR' },
    AXD: { city: 'Alexandroupoli', country: 'GR' },
    IOA: { city: 'Ioannina',     country: 'GR' },
    KLX: { city: 'Kalamata',     country: 'GR' },
    PVK: { city: 'Preveza',      country: 'GR' },
    JKL: { city: 'Kalymnos',     country: 'GR' },
    KZS: { city: 'Kastellorizo', country: 'GR' },
    AOK: { city: 'Karpathos',    country: 'GR' },
    JTY: { city: 'Astypalea',    country: 'GR' },
    KSO: { city: 'Kastoria',     country: 'GR' },
    PAS: { city: 'Paros',        country: 'GR' },
    JNX: { city: 'Naxos',        country: 'GR' },
    JSY: { city: 'Syros',        country: 'GR' },
    MLO: { city: 'Milos',        country: 'GR' },
    // ── International — Western Europe ─────────────────────────────────
    LHR: { city: 'London',       country: 'GB' },
    MAN: { city: 'Manchester',   country: 'GB' },
    CDG: { city: 'Paris',        country: 'FR' },
    FRA: { city: 'Frankfurt',    country: 'DE' },
    MUC: { city: 'Munich',       country: 'DE' },
    BER: { city: 'Berlin',       country: 'DE' },
    DUS: { city: 'Düsseldorf',   country: 'DE' },
    STR: { city: 'Stuttgart',    country: 'DE' },
    HAM: { city: 'Hamburg',      country: 'DE' },
    CGN: { city: 'Cologne',      country: 'DE' },
    VIE: { city: 'Vienna',       country: 'AT' },
    ZRH: { city: 'Zurich',       country: 'CH' },
    GVA: { city: 'Geneva',       country: 'CH' },
    BRU: { city: 'Brussels',     country: 'BE' },
    AMS: { city: 'Amsterdam',    country: 'NL' },
    MXP: { city: 'Milan',        country: 'IT' },
    FCO: { city: 'Rome',         country: 'IT' },
    NAP: { city: 'Naples',       country: 'IT' },
    BLQ: { city: 'Bologna',      country: 'IT' },
    VCE: { city: 'Venice',       country: 'IT' },
    BCN: { city: 'Barcelona',    country: 'ES' },
    MAD: { city: 'Madrid',       country: 'ES' },
    LIS: { city: 'Lisbon',       country: 'PT' },
    DUB: { city: 'Dublin',       country: 'IE' },
    // ── International — Nordics & CEE ──────────────────────────────────
    ARN: { city: 'Stockholm',    country: 'SE' },
    CPH: { city: 'Copenhagen',   country: 'DK' },
    HEL: { city: 'Helsinki',     country: 'FI' },
    PRG: { city: 'Prague',       country: 'CZ' },
    BUD: { city: 'Budapest',     country: 'HU' },
    WAW: { city: 'Warsaw',       country: 'PL' },
    OTP: { city: 'Bucharest',    country: 'RO' },
    SOF: { city: 'Sofia',        country: 'BG' },
    BEG: { city: 'Belgrade',     country: 'RS' },
    TIA: { city: 'Tirana',       country: 'AL' },
    // ── International — Eastern Med, Middle East, North Africa ─────────
    IST: { city: 'Istanbul',     country: 'TR' },
    TLV: { city: 'Tel Aviv',     country: 'IL' },
    LCA: { city: 'Larnaca',      country: 'CY' },
    PFO: { city: 'Paphos',       country: 'CY' },
    BEY: { city: 'Beirut',       country: 'LB' },
    AMM: { city: 'Amman',        country: 'JO' },
    CAI: { city: 'Cairo',        country: 'EG' },
    DXB: { city: 'Dubai',        country: 'AE' },
  },

  // ── EVN (Yerevan) ─────────────────────────────────────────────────────────
  // Aegean serves EVN primarily via ATH hub + select European direct routes.
  // Stale entries are harmless — API returns empty, silently skipped.
  EVN: {
    ATH: { city: 'Athens',       country: 'GR' },
    LCA: { city: 'Larnaca',      country: 'CY' },
    CDG: { city: 'Paris',        country: 'FR' },
    FRA: { city: 'Frankfurt',    country: 'DE' },
    MUC: { city: 'Munich',       country: 'DE' },
    VIE: { city: 'Vienna',       country: 'AT' },
    ZRH: { city: 'Zurich',       country: 'CH' },
    AMS: { city: 'Amsterdam',    country: 'NL' },
    MXP: { city: 'Milan',        country: 'IT' },
    FCO: { city: 'Rome',         country: 'IT' },
    IST: { city: 'Istanbul',     country: 'TR' },
    TLV: { city: 'Tel Aviv',     country: 'IL' },
  },

};

/** Returns destinations map for a given origin IATA. Falls back to empty object. */
function getDestinations(originIata) {
  return DESTINATIONS[originIata] ?? {};
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function monthsRange(monthsAhead = 2) {
  const months = [];
  const now = new Date();
  for (let i = 0; i <= monthsAhead; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push({
      key:  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      api:  `${d.getFullYear()}-${d.getMonth() + 1}`, // Aegean wants no zero-pad
    });
  }
  return months;
}

/**
 * Parse Aegean's weird .NET date: "\"/Date(1776816000000)/\""
 * Returns YYYY-MM-DD or null.
 */
function parseNetDate(val) {
  if (!val) return null;
  const m = String(val).match(/Date\((-?\d+)\)/);
  if (!m) return null;
  const ms = Number(m[1]);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().substring(0, 10);
}

function buildDeeplink(origin, dest, dateOut, dateIn = null) {
  const type = dateIn ? 'R' : 'O';
  let url = `${CALENDAR_URL}?type=${type}&dep=${origin}&arr=${dest}&dd=${dateOut}`;
  if (dateIn) url += `&rd=${dateIn}`;
  return url;
}

// ── AegeanAirProvider ────────────────────────────────────────────────────────

class AegeanAirProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.currency    = config.defaults?.currency    ?? 'EUR';
    this.monthsAhead = config.defaults?.monthsAhead ?? 2;
    this.headless    = config.defaults?.headless    ?? true;
  }

  /** Launch Chromium with bot-resistant fingerprint. */
  async _getBrowserContext() {
    let chromium;
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      throw new Error(
        'playwright not installed. Run: cd backend && npm install playwright && npx playwright install chromium'
      );
    }

    // Akamai Bot Manager is sensitive to the classic headless fingerprint, so
    // we pile on evasion init scripts. Use --headless=new via args instead of
    // the deprecated 'chrome-headless-shell' that Playwright runs by default.
    const useNewHeadless = this.headless !== false;

    const browser = await chromium.launch({
      headless: this.headless !== false,
      args: [
        ...(useNewHeadless ? ['--headless=new'] : []),
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1400,900',
        '--lang=en-GB',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });

    const context = await browser.newContext({
      userAgent:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport:   { width: 1400, height: 900 },
      locale:     'en-GB',
      timezoneId: 'Europe/Athens',
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      javaScriptEnabled: true,
      extraHTTPHeaders: {
        'accept-language': 'en-GB,en;q=0.9',
        'sec-ch-ua':       '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
        'sec-ch-ua-mobile':   '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
    });

    // Comprehensive Akamai/Cloudflare/DataDome evasion set.
    await context.addInitScript(() => {
      // 1. navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // 2. languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en', 'en-US'] });
      // 3. plugins — fake PDF viewer (real Chrome has 3+)
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'PDF Viewer',           filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer',    filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chromium PDF Viewer',  filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Microsoft Edge PDF',   filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'WebKit built-in PDF',  filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        ],
      });
      // 4. mimeTypes
      Object.defineProperty(navigator, 'mimeTypes', {
        get: () => [{ type: 'application/pdf' }, { type: 'text/pdf' }],
      });
      // 5. hardwareConcurrency + deviceMemory
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(navigator, 'deviceMemory',        { get: () => 8 });
      // 6. Chrome runtime shim
      window.chrome = window.chrome || {
        runtime: {},
        app:     { isInstalled: false, InstallState: {}, RunningState: {} },
        csi:     () => {},
        loadTimes: () => ({}),
      };
      // 7. Permissions.query spoof (notifications)
      const origQuery = window.navigator.permissions?.query;
      if (origQuery) {
        window.navigator.permissions.query = (p) =>
          p?.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission, onchange: null })
            : origQuery(p);
      }
      // 8. WebGL vendor/renderer
      const origGetParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (p) {
        if (p === 37445) return 'Intel Inc.';            // UNMASKED_VENDOR_WEBGL
        if (p === 37446) return 'Intel Iris OpenGL';     // UNMASKED_RENDERER_WEBGL
        return origGetParameter.apply(this, [p]);
      };
      // 9. Remove the notorious "headless" strings just in case
      Object.defineProperty(navigator, 'userAgent', {
        get: () => navigator.userAgent.replace(/HeadlessChrome/i, 'Chrome'),
      });
    });

    return { browser, context };
  }

  /**
   * Open the Low Fare Calendar page so Akamai Bot Manager can pass its JS
   * challenge and set the `_abck` / `bm_sz` cookies. Returns the page which is
   * then reused to fetch() the JSON endpoints (cookies are applied automatically).
   */
  async _establishSession(context) {
    const page = await context.newPage();

    // Kill heavy resources we don't need — saves bandwidth & speeds things up.
    // Still allow scripts so Akamai can execute its sensor.
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type)) return route.abort();
      return route.continue();
    });

    console.log(`  [aegean] Establishing session: ${CALENDAR_URL}`);
    try {
      await page.goto(CALENDAR_URL, { waitUntil: 'load', timeout: 90000 });
    } catch (err) {
      if (!err.message.includes('Timeout')) throw err;
      console.warn('  [aegean] Page load timeout — continuing with partial session');
    }
    // Let Akamai finish its sensor handshake
    await page.waitForTimeout(4000);

    const title = await page.title();
    if (/access denied|reference #|forbidden/i.test(title)) {
      throw new Error(`Aegean blocked by Akamai — page title: "${title}"`);
    }
    console.log(`  [aegean] Session ready — title: "${title}"`);

    return page;
  }

  /**
   * Fetch per-day prices for a specific route × month.
   * Runs inside the browser, so cookies/UA/fingerprint match the tab.
   * Returns { outbound: Map<date,price>, inbound: Map<date,price> }.
   */
  async _fetchMonthPrices(page, origin, dest, yearMonth /* e.g. "2026-4" */) {
    const url = `${BASE_URL}/en/sys/lowfares/RouteLowFares/`
              + `?DepartureAirport=${origin}`
              + `&ArrivalAirport=${dest}`
              + `&TripType=RT`
              + `&DepartureDate=${yearMonth}`
              + `&ReturnDate=${yearMonth}`
              + `&SelectedDepartureDate=`
              + `&SelectedReturnDate=`
              + `&Type=Fares`;

    const raw = await page.evaluate(async (fetchUrl) => {
      try {
        const res = await fetch(fetchUrl, {
          method:  'GET',
          headers: { 'accept': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
          credentials: 'include',
        });
        if (!res.ok) return { _error: `HTTP ${res.status}` };
        return await res.json();
      } catch (e) {
        return { _error: e.message };
      }
    }, url);

    if (raw?._error) {
      console.warn(`  [aegean] ${origin}→${dest} ${yearMonth}: ${raw._error}`);
      return { outbound: new Map(), inbound: new Map() };
    }

    const toMap = (arr) => {
      const m = new Map();
      for (const row of arr ?? []) {
        const date  = parseNetDate(row.Date);
        const price = Number(row.Price);
        if (!date || !Number.isFinite(price) || price <= 0) continue;
        // Keep cheapest per date (defensive — API typically already cheapest)
        if (!m.has(date) || price < m.get(date).price) {
          m.set(date, { date, price, class: row.Class || 'Economy' });
        }
      }
      return m;
    };

    const result = {
      outbound: toMap(raw.Outbound),
      inbound:  toMap(raw.Inbound),
    };

    // Side-channel: accumulate the full per-day calendar for date-search
    // (project docs). Single choke point — every collect type calls
    // _fetchMonthPrices, so this covers oneway/weekend/holiday runs alike.
    // The collect runner persists this.lastCalendar after the run.
    this._calRoutes ??= {};
    for (const { date, price } of result.outbound.values()) addCalendarPoint(this._calRoutes, dest, 'out', date, price, 'A3');
    for (const { date, price } of result.inbound.values())  addCalendarPoint(this._calRoutes, dest, 'in',  date, price, 'A3');
    this.lastCalendar = { scope: 'all', routes: this._calRoutes };

    return result;
  }

  /** Iterate destinations (curated list for this origin) × months and fetch once per cell. */
  async _collectAllCells(page, origin, months) {
    const destinations = Object.keys(getDestinations(origin));
    console.log(`  [aegean] ${origin}: ${destinations.length} destinations × ${months.length} months`);

    /** @type {Map<string, Map<string, {outbound:Map, inbound:Map}>>} dest → month → prices */
    const grid = new Map();

    for (let i = 0; i < destinations.length; i++) {
      const dest = destinations[i];
      if (i > 0) await sleep(200); // throttle: ~5 req/s

      const byMonth = new Map();
      grid.set(dest, byMonth);

      for (const month of months) {
        try {
          const prices = await this._fetchMonthPrices(page, origin, dest, month.api);
          if (prices.outbound.size > 0 || prices.inbound.size > 0) {
            byMonth.set(month.key, prices);
            console.log(`  [aegean] ${origin}→${dest} ${month.key}: ${prices.outbound.size} out, ${prices.inbound.size} in`);
          } else {
            console.log(`  [aegean] ${origin}→${dest} ${month.key}: no flights`);
          }
          await sleep(100); // gap between months of same route
        } catch (err) {
          console.error(`  [aegean] ${origin}→${dest} ${month.key}: ${err.message}`);
        }
      }
    }
    return grid;
  }

  _normalizeFare(base, extras) {
    const destMap = getDestinations(base.origin);
    return {
      provider:           this.id,
      providerPriority:   this.priority,
      providerType:       this.type,
      airline:            'Aegean Airlines',
      airlineCode:        'A3',
      currency:           this.currency,
      duration:           null,
      collectedAt:        base.collectedAt,
      snapshotId:         base.snapshotId,
      landingCode:        base.landingCode,
      originIata:         base.origin,
      destinationIata:    extras.dest,
      destinationName:    destMap[extras.dest]?.city    ?? extras.dest,
      destinationCountry: destMap[extras.dest]?.country ?? '',
      ...extras.fields,
    };
  }

  // ── collect (one-way) ──────────────────────────────────────────────────────

  async collect(landing, options = {}) {
    const { snapshotId = 'manual' } = options;
    const origin = landing.homeAirportIata;
    const months = monthsRange(this.monthsAhead);
    const collectedAt = new Date().toISOString();

    console.log(`\n[AegeanAirProvider] collect() — origin: ${origin}, months: ${months.map(m => m.key).join(', ')}`);

    const { browser, context } = await this._getBrowserContext();
    const fares = [];

    try {
      const page = await this._establishSession(context);
      const grid = await this._collectAllCells(page, origin, months);

      for (const [dest, byMonth] of grid) {
        for (const [monthKey, { outbound }] of byMonth) {
          // Pick cheapest outbound day in the month
          let best = null;
          for (const p of outbound.values()) {
            if (!best || p.price < best.price) best = p;
          }
          if (!best || best.price > 300) continue;

          fares.push(this._normalizeFare(
            { origin, collectedAt, snapshotId, landingCode: landing.landingSlug },
            {
              dest,
              fields: {
                dateOut:   best.date,
                dateIn:    null,
                tripType:  'one_way',
                price:     Math.round(best.price * 100) / 100,
                deeplink:  buildDeeplink(origin, dest, best.date),
              },
            }
          ));
        }
      }

      await page.close();
    } finally {
      await browser.close();
    }

    console.log(`[AegeanAirProvider] done — ${fares.length} one-way fares`);
    return fares;
  }

  // ── collectWeekend (Fri → Sun/Mon) ─────────────────────────────────────────

  async collectWeekend(landing, options = {}) {
    const { snapshotId = 'manual' } = options;
    const origin = landing.homeAirportIata;
    const months = monthsRange(this.monthsAhead);
    const collectedAt = new Date().toISOString();

    console.log(`\n[AegeanAir-Weekend] origin: ${origin}`);

    const { browser, context } = await this._getBrowserContext();
    const pairs = [];

    try {
      const page = await this._establishSession(context);
      const grid = await this._collectAllCells(page, origin, months);

      // We need next-month returns for Fri 28+ → Mon next-month. Pull one extra month.
      // (Already covered for destinations whose next month is in `months`, but add
      // a guard by fetching the month *after* the last one, on demand.)
      for (const [dest, byMonth] of grid) {
        for (const month of months) {
          const cell = byMonth.get(month.key);
          if (!cell) continue;

          // Build a combined return-price map (this month + next month outbound-side,
          // which we already have if next is inside `months`).
          const returnPrices = new Map(cell.inbound);
          const nextIdx = months.findIndex(m => m.key === month.key) + 1;
          const nextCell = nextIdx < months.length ? byMonth.get(months[nextIdx].key) : null;
          if (nextCell) {
            for (const [d, v] of nextCell.inbound) returnPrices.set(d, v);
          }

          const MAX_LEG = 250;
          for (const [outDate, outFare] of cell.outbound) {
            if (outFare.price > MAX_LEG) continue;
            const day = new Date(outDate).getUTCDay();
            if (day !== 5) continue; // Fridays only

            for (const nights of [2, 3]) {
              const ret = new Date(outDate);
              ret.setUTCDate(ret.getUTCDate() + nights);
              const retStr = ret.toISOString().substring(0, 10);
              const retFare = returnPrices.get(retStr);
              if (!retFare || retFare.price > MAX_LEG) continue;

              const total = outFare.price + retFare.price;
              pairs.push(this._normalizeFare(
                { origin, collectedAt, snapshotId, landingCode: landing.landingSlug },
                {
                  dest,
                  fields: {
                    dateOut:       outDate,
                    dateIn:        retStr,
                    nights,
                    tripType:      'weekend',
                    price:         Math.round(total * 100) / 100,
                    outboundPrice: outFare.price,
                    returnPrice:   retFare.price,
                    deeplink:      buildDeeplink(origin, dest, outDate, retStr),
                  },
                }
              ));
            }
          }
        }
      }

      await page.close();
    } finally {
      await browser.close();
    }

    console.log(`[AegeanAir-Weekend] done — ${pairs.length} weekend pairs`);
    return pairs;
  }

  // ── collectHoliday (any day, 5–15 nights) ──────────────────────────────────

  async collectHoliday(landing, options = {}) {
    const { snapshotId = 'manual' } = options;
    const origin = landing.homeAirportIata;
    const months = monthsRange(this.monthsAhead);
    const collectedAt = new Date().toISOString();

    console.log(`\n[AegeanAir-Holiday] origin: ${origin}`);

    const { browser, context } = await this._getBrowserContext();
    const pairs = [];

    try {
      const page = await this._establishSession(context);
      const grid = await this._collectAllCells(page, origin, months);

      // For holidays we need return dates up to 15 nights past end of month —
      // fetch an extra trailing month for each destination just for returns.
      const extraMonthApi = (() => {
        const last = months[months.length - 1].key.split('-').map(Number);
        const y = last[0], m = last[1];
        const ny = m === 12 ? y + 1 : y;
        const nm = m === 12 ? 1 : m + 1;
        return { key: `${ny}-${String(nm).padStart(2, '0')}`, api: `${ny}-${nm}` };
      })();

      for (const [dest, byMonth] of grid) {
        // Pull one extra month of return-side prices
        let extraReturns = new Map();
        try {
          const extra = await this._fetchMonthPrices(page, origin, dest, extraMonthApi.api);
          extraReturns = extra.inbound;
          await sleep(100);
        } catch {}

        for (const month of months) {
          const cell = byMonth.get(month.key);
          if (!cell) continue;

          // Build return-price lookup covering this month + next month + trailing extra
          const returnPrices = new Map(cell.inbound);
          const nextIdx = months.findIndex(m => m.key === month.key) + 1;
          const nextCell = nextIdx < months.length ? byMonth.get(months[nextIdx].key) : null;
          if (nextCell) for (const [d, v] of nextCell.inbound) returnPrices.set(d, v);
          for (const [d, v] of extraReturns) returnPrices.set(d, v);

          const MAX_LEG = 300;
          let best = null;

          for (const [outDate, outFare] of cell.outbound) {
            if (outFare.price > MAX_LEG) continue;
            const outObj = new Date(outDate);
            for (let nights = 5; nights <= 15; nights++) {
              const ret = new Date(outObj);
              ret.setUTCDate(ret.getUTCDate() + nights);
              const retStr = ret.toISOString().substring(0, 10);
              const retFare = returnPrices.get(retStr);
              if (!retFare || retFare.price > MAX_LEG) continue;
              const total = outFare.price + retFare.price;
              if (!best || total < best.total) {
                best = {
                  dateOut: outDate, dateIn: retStr, nights,
                  outPrice: outFare.price, retPrice: retFare.price, total,
                };
              }
            }
          }

          if (!best) continue;
          pairs.push(this._normalizeFare(
            { origin, collectedAt, snapshotId, landingCode: landing.landingSlug },
            {
              dest,
              fields: {
                dateOut:       best.dateOut,
                dateIn:        best.dateIn,
                nights:        best.nights,
                tripType:      'holiday',
                price:         Math.round(best.total * 100) / 100,
                outboundPrice: best.outPrice,
                returnPrice:   best.retPrice,
                deeplink:      buildDeeplink(origin, dest, best.dateOut, best.dateIn),
              },
            }
          ));
        }
      }

      await page.close();
    } finally {
      await browser.close();
    }

    console.log(`[AegeanAir-Holiday] done — ${pairs.length} holiday pairs`);
    return pairs;
  }
}

export const aegeanAirProvider = new AegeanAirProvider(PROVIDER_CONFIGS.aegean_air);

# fare-calendar-collectors

Collectors for low-cost-carrier **public fare calendars** — the same data the
airlines' own "cheap flights" / fare-finder pages show. Fares are normalized
to a common schema, filtered by price ceilings, and written as dated JSON
snapshots to local disk or any S3 bucket.

## Providers

| Provider | Source | Runtime |
|---|---|---|
| `wizz_air` | Wizz Air farechart (map + farechart endpoints, read via response interception) | Playwright Chromium |
| `ryanair_fare_finder` | Ryanair fare-finder API (`services-api.ryanair.com/farfnd/v4`) | plain HTTPS |

## Landings

A *landing* is an origin airport (see `config/landings.mjs`). Currently:
`evn` (Yerevan, EUR) and `stn` (London Stansted, GBP). Invariants:
`landingSlug === lowercase(homeAirportIata)`; one landing = one currency.

## Quickstart (local, zero config)

```bash
npm ci
npx playwright install chromium        # only needed for wizz_air
DATA_ROOT=./data/price-snapshots node collect.mjs \
  --provider ryanair_fare_finder --landing stn --type oneway
```

Snapshots land in `./data/price-snapshots/{provider}/{landing}/…` plus a
`latest.json` pointer. Set `SNAPSHOT_BUCKET` (+ AWS credentials) to write to
S3 instead — see `.env.example`.

## Output schema

Each snapshot is `{ meta, fares }`. `meta` carries provider/landing/type/
currency/timestamps; each fare is a `NormalizedFare` (documented in
`providers/base.mjs`): origin, destination, dates, price, currency, airline,
booking deeplink. Price ceilings (per currency, see `snapshots/store.mjs`)
drop fares above the "cheap flights" threshold at collect time.

## Scheduling

GitHub Actions workflows in `.github/workflows/` run the collectors daily
(see each file's header for cadence and phasing). `keep-alive.yml` prevents
GitHub's 60-day cron auto-disable.

## Responsible use

This project reads publicly visible fare-calendar data at low request rates
(one pass per route per day, delays between calls) for personal/research
use. It does not buy tickets, does not access accounts, and does not collect
personal data. Respect the airlines' terms of service; keep request rates
low; do not use this for commercial fare redistribution.

## License

MIT

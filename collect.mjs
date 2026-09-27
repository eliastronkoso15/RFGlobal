#!/usr/bin/env node
/**
 * collect.mjs — Manual / scheduled collection runner.
 *
 * Usage:
 *   node collect.mjs                                          # all enabled providers, all landings (one-way)
 *   node collect.mjs --provider ryanair_fare_finder           # specific provider
 *   node collect.mjs --landing skg                            # specific landing
 *   node collect.mjs --provider ryanair_fare_finder --landing skg
 *   node collect.mjs --schedule morning                       # tag snapshot as morning run
 *   node collect.mjs --schedule evening                       # tag snapshot as evening run
 *   node collect.mjs --type weekend                           # collect weekend pairs (Fri→Sun/Mon)
 *   node collect.mjs --type weekend --landing skg             # weekend for specific landing
 *   node collect.mjs --type holiday                           # collect holiday pairs (any day, 5–15 nights)
 *   node collect.mjs --type holiday --landing skg             # holiday for specific landing
 *
 * This script is also called by the scheduler inside index.mjs.
 * You can wire it into system cron or any scheduler (e.g. GitHub Actions).
 *
 * Example crontab entries:
 *   0 9  * * * cd /app && node backend/collect.mjs --schedule morning            >> /var/log/collect.log 2>&1
 *   0 9  * * * cd /app && node backend/collect.mjs --schedule morning --type weekend >> /var/log/collect.log 2>&1
 *   0 18 * * * cd /app && node backend/collect.mjs --schedule evening            >> /var/log/collect.log 2>&1
 *   0 18 * * * cd /app && node backend/collect.mjs --schedule evening --type weekend >> /var/log/collect.log 2>&1
 */

import 'dotenv/config';
import { LANDINGS, getLanding } from './config/landings.mjs';
import { getProvider, getEnabledProviders } from './providers/registry.mjs';
import { saveSnapshot } from './snapshots/store.mjs';
import { saveProviderCalendar } from './lib/calendar-dump.mjs';
import { notify, msgCompleted, msgFailed } from './lib/telegram.mjs';

// COLLECT_NOTIFY=off silences the per-collect Telegram messages (success AND
// failure). Set by the GHA collector workflows (Aegean, easyJet): visibility
// there comes from the 09:45 daily summary (freshness ❌ on a missed run) and
// the workflow-level failure notification step, so per-(landing × type)
// messages are pure noise — 6+/day per provider. Lambda collects never sent
// per-collect messages.
const PER_COLLECT_NOTIFY = (process.env.COLLECT_NOTIFY ?? 'on') !== 'off';

// ── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { provider: null, landing: null, schedule: 'manual', type: 'oneway' }; // type: 'oneway' | 'weekend' | 'holiday'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider') result.provider = args[++i];
    if (args[i] === '--landing')  result.landing  = args[++i];
    if (args[i] === '--schedule') result.schedule = args[++i];
    if (args[i] === '--type')     result.type     = args[++i]; // 'oneway' | 'weekend' | 'holiday' | 'all'
  }
  return result;
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function runProvider(provider, landing, scheduleType, collectType = 'oneway') {
  const now        = new Date();
  const dateStr    = now.toISOString().substring(0, 10);
  const isWeekend  = collectType === 'weekend';
  const isHoliday  = collectType === 'holiday';
  const tripType   = isHoliday ? 'holiday' : (isWeekend ? 'weekend' : 'one_way');

  // Snapshot directory names per type and provider
  let snapshotProviderId;
  if (isHoliday) {
    snapshotProviderId = provider.id === 'ryanair_fare_finder' ? 'rff_holiday' : `${provider.id}_holiday`;
  } else if (isWeekend) {
    snapshotProviderId = provider.id === 'ryanair_fare_finder' ? 'rff_weekend' : `${provider.id}_weekend`;
  } else {
    snapshotProviderId = provider.id;
  }

  const snapshotId = `${snapshotProviderId}_${landing.landingSlug}_${dateStr}_${scheduleType}`;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Provider  : ${provider.name} (${provider.id})`);
  console.log(`Type      : ${collectType}`);
  console.log(`Landing   : ${landing.homeAirportIata} / ${landing.landingSlug}`);
  console.log(`Schedule  : ${scheduleType}`);
  console.log(`SnapshotId: ${snapshotId}`);
  console.log(`${'─'.repeat(60)}`);

  const meta = {
    snapshotId,
    providerId:   snapshotProviderId,
    collectedAt:  now.toISOString(),
    scheduleType,
    originIata:   landing.homeAirportIata,
    landingId:    landing.landingSlug,
    dateStr,
    tripType,
    // Selects the currency-specific price ceiling in saveSnapshot (GBP for stn).
    currency:     landing.providerSettings?.[provider.id]?.currency ?? landing.currency ?? 'EUR',
    recordCount:  0,
    status:       'failed',
  };

  try {
    const fares = isHoliday
      ? await provider.collectHoliday(landing, { snapshotId, scheduleType })
      : isWeekend
      ? await provider.collectWeekend(landing, { snapshotId, scheduleType })
      : await provider.collect(landing, { snapshotId, scheduleType });

    // Note: global price-ceiling filter (€100 oneway / €200 RT) is applied
    // inside saveSnapshot() — see backend/snapshots/store.mjs. Centralised
    // there so every caller of saveSnapshot() inherits it.

    meta.recordCount = fares.length;
    meta.status      = fares.length > 0 ? 'success' : 'partial';

    await saveSnapshot(meta, fares);

    // Side-channel: persist the full price calendar the provider saw during
    // this run (date-search feature). No-op unless provider.lastCalendar set.
    await saveProviderCalendar(provider, landing);

    const label      = isWeekend ? 'weekend pairs' : 'fares';
    const durationMs = Date.now() - now.getTime();

    console.log(`\n✅ ${snapshotProviderId} / ${landing.landingSlug}: ${fares.length} ${label} saved (${scheduleType})`);

    // Top-3 cheapest fares for the Telegram notification
    const topFares = [...fares]
      .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
      .slice(0, 3)
      .map(f => ({ destination: f.destinationIata ?? f.destination ?? '?', price: Math.round(f.price ?? 0) }));

    if (PER_COLLECT_NOTIFY) {
      await notify(msgCompleted({
        provider:    provider.id,
        landing:     landing.landingSlug,
        collectType,
        schedule:    scheduleType,
        recordCount: fares.length,
        durationMs,
        topFares,
      }));
    }

    return { ok: true, fares };

  } catch (err) {
    console.error(`\n❌ ${snapshotProviderId} / ${landing.landingSlug}: ${err.message}`);
    await saveSnapshot({ ...meta, status: 'failed', error: err.message }, []);

    if (PER_COLLECT_NOTIFY) {
      await notify(msgFailed({
        provider:    provider.id,
        landing:     landing.landingSlug,
        collectType,
        schedule:    scheduleType,
        durationMs:  Date.now() - now.getTime(),
        error:       err.message,
      }));
    }

    return { ok: false, error: err.message };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { provider: providerId, landing: landingSlug, schedule, type: collectType } = parseArgs();

  const providers = providerId
    ? [getProvider(providerId)].filter(Boolean)
    : getEnabledProviders();

  const landings = landingSlug
    ? [getLanding(landingSlug)].filter(Boolean)
    : LANDINGS.filter((l) =>
        l.enabledProviders.some((pid) => providers.find((p) => p.id === pid))
      );

  if (!providers.length) {
    console.error('No providers found / enabled for the given filter.');
    process.exit(1);
  }
  if (!landings.length) {
    console.error('No landings found for the given filter.');
    process.exit(1);
  }

  console.log(`\n🚀 RunawayFly price collector — ${schedule} run (type: ${collectType})`);
  console.log(`   Providers : ${providers.map((p) => p.id).join(', ')}`);
  console.log(`   Landings  : ${landings.map((l) => l.landingSlug).join(', ')}`);

  let exitCode = 0;

  // '--type all' runs every trip type sequentially in ONE process, so
  // providers with a per-process page cache (easyJet) fetch each source
  // page once and reuse it across oneway/weekend/holiday. Each type still
  // gets its own snapshot, exactly as three separate invocations would.
  const collectTypes = collectType === 'all' ? ['oneway', 'weekend', 'holiday'] : [collectType];

  for (const landing of landings) {
    for (const provider of providers) {
      // Skip if landing hasn't opted into this provider
      if (!landing.enabledProviders.includes(provider.id)) {
        console.log(`\n⏭ Skipping ${provider.id} — not enabled for ${landing.landingSlug}`);
        continue;
      }
      for (const oneType of collectTypes) {
        const result = await runProvider(provider, landing, schedule, oneType);
        if (!result.ok) exitCode = 1;
      }
    }
  }

  console.log('\n✔ Collection run complete');
  process.exit(exitCode);
}

main();

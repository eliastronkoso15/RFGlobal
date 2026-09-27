/**
 * snapshots/store.mjs
 *
 * Dual-backend snapshot store:
 *   - SNAPSHOT_BUCKET env set  → S3  (Lambda / prod)
 *   - SNAPSHOT_BUCKET not set  → local filesystem (dev)
 *
 * S3 key layout mirrors the filesystem layout:
 *   {providerId}/{landingSlug}/{YYYY-MM-DD}/{filename}.json
 *   {providerId}/{landingSlug}/latest.json
 *
 * All public functions are async.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const SNAPSHOT_BUCKET = process.env.SNAPSHOT_BUCKET ?? null;
const DATA_ROOT       = process.env.DATA_ROOT
  ?? path.resolve(__dirname, '../../data/price-snapshots');

const USE_S3 = !!SNAPSHOT_BUCKET;

if (USE_S3) {
  console.log(`[store] S3 backend: s3://${SNAPSHOT_BUCKET}`);
} else {
  console.log(`[store] Filesystem backend: ${DATA_ROOT}`);
}

// ── S3 client (lazy init) ─────────────────────────────────────────────────────

let _s3 = null;
async function getS3() {
  if (!_s3) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    _s3 = new S3Client({ region: process.env.AWS_REGION ?? 'eu-central-1' });
  }
  return _s3;
}

async function s3Get(key) {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = await getS3();
  try {
    const resp   = await s3.send(new GetObjectCommand({ Bucket: SNAPSHOT_BUCKET, Key: key }));
    const chunks = [];
    for await (const chunk of resp.Body) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

/**
 * @param {string} key         S3 object key
 * @param {object} data        JSON-serializable body
 * @param {object} [opts]
 * @param {string} [opts.tagging] Optional S3 Tagging string like
 *                                "retention=dated&other=value". When set, the
 *                                object is written with these tags — used by
 *                                the S3 lifecycle rule to distinguish
 *                                dated snapshots (auto-expire) from pointer
 *                                files like `latest.json` (never expire).
 *                                See deploy/04-setup-snapshot-lifecycle.sh.
 */
async function s3Put(key, data, opts = {}) {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = await getS3();
  await s3.send(new PutObjectCommand({
    Bucket:      SNAPSHOT_BUCKET,
    Key:         key,
    Body:        JSON.stringify(data, null, 2),
    ContentType: 'application/json',
    ...(opts.tagging ? { Tagging: opts.tagging } : {}),
  }));
}

async function s3Exists(key) {
  const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = await getS3();
  try {
    await s3.send(new HeadObjectCommand({ Bucket: SNAPSHOT_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function s3List(prefix) {
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const s3 = await getS3();
  const items = [];
  let token;
  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket:            SNAPSHOT_BUCKET,
      Prefix:            prefix,
      ContinuationToken: token,
    }));
    for (const obj of resp.Contents ?? []) items.push(obj.Key);
    token = resp.NextContinuationToken;
  } while (token);
  return items;
}

// ── Filename helpers ──────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().substring(0, 10);
}

function snapshotFilename(scheduleType, ts) {
  const d     = ts ? new Date(ts) : new Date();
  const stamp = d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
  return `${scheduleType ?? 'manual'}-${stamp}.json`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Global price ceilings — dropped at save time so EVERY caller (collect.mjs
 * runner, server endpoints, scheduled jobs, GitHub Actions workflows)
 * inherits the cap. Single source of truth.
 *
 * Determined by `meta.tripType`:
 *   • one_way:  ≤ €100   (covers UK / W-EU economy headroom)
 *   • weekend:  ≤ €200   (= €100 each leg of the RT)
 *   • holiday:  ≤ €200   (symmetric with weekend — both are round-trips)
 *
 * Fares with missing / NaN price pass through (downstream merge handles
 * them). Only fares we KNOW exceed the ceiling are dropped.
 *
 * Rationale + history in project docs → "Cheap-first by backend
 * cap + count pagination".
 */
// Keyed by currency since the stn (London) landing collects in GBP. Caps are
// compared against the fare's raw numeric price, so each currency needs its
// own set — GBP values ≈ the EUR caps at current FX. Missing/unknown currency
// falls back to EUR, preserving pre-2026-09 behavior for every caller that
// doesn't set meta.currency.
const PRICE_CEILINGS = {
  EUR: { one_way: 100, weekend: 200, holiday: 200 },
  GBP: { one_way: 90,  weekend: 180, holiday: 180 },
};

function applyPriceCeiling(meta, fares) {
  const byCurrency = PRICE_CEILINGS[meta?.currency] ?? PRICE_CEILINGS.EUR;
  // Per-landing override (landing.priceCeilings, carried in meta): EVN runs
  // €150/€250 — 2-4k-km routes make the intra-EU €100 bar unrealistically
  // strict there (owner decision 2026-09-28; Aegean EVN network min is €141).
  const ceil = meta?.priceCeilings?.[meta?.tripType] ?? byCurrency[meta?.tripType];
  if (!Number.isFinite(ceil)) return fares;   // unknown tripType — leave as-is
  const kept = fares.filter((f) => {
    const p = Number(f?.price);
    return !Number.isFinite(p) || p <= ceil;
  });
  const dropped = fares.length - kept.length;
  if (dropped > 0) {
    console.log(`[store] price-cap (€${ceil}/${meta.tripType}) dropped ${dropped} fares (kept ${kept.length})`);
  }
  return kept;
}

/**
 * Save a snapshot.
 * @param {object}   meta
 * @param {object[]} fares
 */
export async function saveSnapshot(meta, fares) {
  // Apply the global price ceiling FIRST — keeps the cap-exceed fares out of
  // both the dated file AND the latest.json record count.
  fares = applyPriceCeiling(meta, fares);

  const dateStr  = meta.dateStr ?? todayStr();
  const filename = snapshotFilename(meta.scheduleType, meta.collectedAt);
  const relPath  = `${dateStr}/${filename}`;           // e.g. "2026-04-21/evening-…Z.json"
  const baseKey  = `${meta.providerId}/${meta.landingId}`;

  // Update meta.recordCount to reflect the post-filter count, so the latest
  // pointer + summary aggregator see the truth (not the pre-filter total).
  meta = { ...meta, recordCount: fares.length };

  const payload = { meta, fares };

  // Update the latest.json pointer for any non-failed run — including
  // `partial` (collect completed but returned 0 fares). A successful zero is
  // legitimate information ("this route exists but had no qualifying flights
  // today"), not a missing snapshot, and the summary aggregator counts
  // missing pointers as ❌. Only `failed` (exception thrown mid-collect) is
  // treated as "did not run" and skips the pointer update — that way real
  // failures still surface in the summary instead of silently overwriting
  // yesterday's good data with empty.
  const shouldWritePointer = meta.status !== 'failed';

  if (USE_S3) {
    const fileKey = `${baseKey}/${relPath}`;
    // Tag dated snapshot files with `retention=dated` — the S3 lifecycle
    // rule (see deploy/04-setup-snapshot-lifecycle.sh) filters by this
    // tag to auto-expire dated snapshots after 45 days. `latest.json`
    // and price-index/*.json are written WITHOUT this tag and therefore
    // never expire. The 45-day window is a safety buffer above the
    // 14-day catch-up threshold in build-price-index.mjs.
    await s3Put(fileKey, payload, { tagging: 'retention=dated' });
    console.log(`[store] S3 saved ${fares.length} fares → ${fileKey}`);

    if (shouldWritePointer) {
      const pointer = {
        snapshotId:   meta.snapshotId,
        providerId:   meta.providerId,
        landingId:    meta.landingId,
        collectedAt:  meta.collectedAt,
        scheduleType: meta.scheduleType,
        recordCount:  fares.length,
        filePath:     relPath,
      };
      // Note: NO tagging on latest.json — pointer files must survive
      // the lifecycle rule's dated-snapshot expiration.
      await s3Put(`${baseKey}/latest.json`, pointer);
      console.log(`[store] S3 updated latest pointer → ${baseKey}/latest.json (status=${meta.status}, recordCount=${fares.length})`);
    }
  } else {
    // Filesystem
    const dir      = path.join(DATA_ROOT, meta.providerId, meta.landingId, dateStr);
    const filepath = path.join(dir, filename);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf-8');
    console.log(`[store] Saved ${fares.length} fares → ${filepath}`);

    if (shouldWritePointer) {
      const pointer = {
        snapshotId:   meta.snapshotId,
        providerId:   meta.providerId,
        landingId:    meta.landingId,
        collectedAt:  meta.collectedAt,
        scheduleType: meta.scheduleType,
        recordCount:  fares.length,
        filePath:     relPath,
      };
      const ptrPath = path.join(DATA_ROOT, meta.providerId, meta.landingId, 'latest.json');
      fs.writeFileSync(ptrPath, JSON.stringify(pointer, null, 2), 'utf-8');
      console.log(`[store] Updated latest pointer (status=${meta.status}, recordCount=${fares.length})`);
    }
  }
}

/**
 * Load the latest successful snapshot for a provider + landing.
 * Returns { meta, fares } or null.
 */
export async function loadLatestSnapshot(providerId, landingSlug) {
  const baseKey = `${providerId}/${landingSlug}`;

  if (USE_S3) {
    const pointer = await s3Get(`${baseKey}/latest.json`);
    if (!pointer) {
      console.warn(`[store] No latest pointer in S3: ${baseKey}/latest.json`);
      return null;
    }
    const data = await s3Get(`${baseKey}/${pointer.filePath}`);
    if (!data) {
      console.warn(`[store] S3 pointer exists but file missing: ${baseKey}/${pointer.filePath}`);
      return null;
    }
    console.log(`[store] S3 loaded ${data.fares?.length ?? 0} fares from ${baseKey}/${pointer.filePath}`);
    return data;
  } else {
    // Filesystem
    const ptrPath = path.join(DATA_ROOT, providerId, landingSlug, 'latest.json');
    if (!fs.existsSync(ptrPath)) {
      console.warn(`[store] No latest pointer: ${providerId}/${landingSlug}`);
      return null;
    }
    const pointer  = JSON.parse(fs.readFileSync(ptrPath, 'utf-8'));
    const filepath = path.join(DATA_ROOT, providerId, landingSlug, pointer.filePath);
    if (!fs.existsSync(filepath)) {
      console.warn(`[store] Pointer exists but file missing: ${filepath}`);
      return null;
    }
    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    console.log(`[store] Loaded ${data.fares?.length ?? 0} fares from ${filepath}`);
    return data;
  }
}

/**
 * Load JUST the latest.json pointer (no snapshot file). Use when the
 * caller only needs metadata (recordCount, collectedAt, scheduleType)
 * and not the actual fares — cuts S3 reads in half for that case.
 *
 * Returns the pointer object or null.
 */
export async function loadLatestPointer(providerId, landingSlug) {
  const baseKey = `${providerId}/${landingSlug}`;
  if (USE_S3) {
    return s3Get(`${baseKey}/latest.json`);
  }
  const ptrPath = path.join(DATA_ROOT, providerId, landingSlug, 'latest.json');
  if (!fs.existsSync(ptrPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(ptrPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Load latest snapshots for multiple providers. Fault-isolated.
 */
export async function loadAllLatestSnapshots(providerIds, landingSlug) {
  return Promise.all(
    providerIds.map(async (providerId) => {
      try {
        const snapshot = await loadLatestSnapshot(providerId, landingSlug);
        return { providerId, snapshot };
      } catch (err) {
        console.warn(`[store] loadAll ${providerId}/${landingSlug}: ${err.message}`);
        return { providerId, snapshot: null };
      }
    })
  );
}

/**
 * Check if a snapshot already exists for today + scheduleType.
 */
export async function todaySnapshotExists(providerId, landingSlug, scheduleType) {
  const filename = snapshotFilename(scheduleType);
  const relPath  = `${todayStr()}/${filename}`;

  if (USE_S3) {
    return s3Exists(`${providerId}/${landingSlug}/${relPath}`);
  } else {
    return fs.existsSync(path.join(DATA_ROOT, providerId, landingSlug, relPath));
  }
}

/**
 * Read a JSON object at an arbitrary store key (S3 key or filesystem
 * relative path under DATA_ROOT). Returns parsed JSON or null on 404.
 *
 * Used by the price-history pipeline to read/write `price-index/{IATA}.json`
 * outside the snapshot tree.
 */
export async function getJsonObject(key) {
  if (USE_S3) {
    return s3Get(key);
  }
  const fp = path.join(DATA_ROOT, key);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

export async function putJsonObject(key, data) {
  if (USE_S3) {
    return s3Put(key, data);
  }
  const fp = path.join(DATA_ROOT, key);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * List every key under an arbitrary store prefix (S3 paginated / fs walk).
 * Used by the route-calendar builder to discover `calendar/{provider}/...`
 * dumps without knowing the provider list up front.
 *
 * @param {string} prefix  e.g. 'calendar/'
 * @returns {Promise<string[]>} full store keys
 */
export async function listKeysByPrefix(prefix) {
  if (USE_S3) {
    return s3List(prefix);
  }
  const root = path.join(DATA_ROOT, prefix);
  if (!fs.existsSync(root)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fp);
      else out.push(path.relative(DATA_ROOT, fp));
    }
  };
  walk(root);
  return out;
}

/**
 * List snapshot file keys for one (provider, landing) filtered by date range.
 * Date filter is inclusive on both ends, compared against the `YYYY-MM-DD`
 * segment in the key path. Excludes the `latest.json` pointer.
 *
 * @param {string} providerId
 * @param {string} landingSlug
 * @param {string} fromDate  'YYYY-MM-DD' inclusive
 * @param {string} toDate    'YYYY-MM-DD' inclusive
 * @returns {Promise<Array<{key: string, dateStr: string}>>}
 */
export async function listSnapshotKeysInRange(providerId, landingSlug, fromDate, toDate) {
  if (USE_S3) {
    const prefix = `${providerId}/${landingSlug}/`;
    const keys = await s3List(prefix);
    const out = [];
    for (const key of keys) {
      const m = key.match(/\/(\d{4}-\d{2}-\d{2})\//);
      if (!m) continue;
      const dateStr = m[1];
      if (dateStr < fromDate || dateStr > toDate) continue;
      if (key.endsWith('/latest.json')) continue;
      out.push({ key, dateStr });
    }
    return out;
  }
  const providerDir = path.join(DATA_ROOT, providerId, landingSlug);
  if (!fs.existsSync(providerDir)) return [];
  const out = [];
  for (const dateStr of fs.readdirSync(providerDir)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    if (dateStr < fromDate || dateStr > toDate) continue;
    const dateDir = path.join(providerDir, dateStr);
    for (const filename of fs.readdirSync(dateDir).filter(f => f.endsWith('.json'))) {
      const key = `${providerId}/${landingSlug}/${dateStr}/${filename}`;
      out.push({ key, dateStr });
    }
  }
  return out;
}

/**
 * Load a snapshot file by its store key. Returns parsed { meta, fares } or null.
 * Counterpart to listSnapshotKeysInRange — same key format.
 */
export async function loadSnapshotByKey(key) {
  if (USE_S3) {
    return s3Get(key);
  }
  const fp = path.join(DATA_ROOT, key);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

/**
 * List all snapshots for a provider + landing (newest first).
 * Returns array of { dateStr, filename, filePath, meta }.
 */
export async function listSnapshots(providerId, landingSlug) {
  if (USE_S3) {
    const prefix = `${providerId}/${landingSlug}/`;
    const keys   = await s3List(prefix);
    const dated  = keys
      .filter(k => /\/\d{4}-\d{2}-\d{2}\//.test(k))
      .sort()
      .reverse();

    const results = [];
    for (const key of dated) {
      const parts    = key.replace(prefix, '').split('/');
      const dateStr  = parts[0];
      const filename = parts[1];
      try {
        const data = await s3Get(key);
        results.push({ dateStr, filename, filePath: key, meta: data?.meta ?? null });
      } catch {
        results.push({ dateStr, filename, filePath: key, meta: null });
      }
    }
    return results;
  } else {
    const providerDir = path.join(DATA_ROOT, providerId, landingSlug);
    if (!fs.existsSync(providerDir)) return [];

    const snapshots = [];
    const dateDirs  = fs.readdirSync(providerDir)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort().reverse();

    for (const dateStr of dateDirs) {
      const dateDir = path.join(providerDir, dateStr);
      for (const filename of fs.readdirSync(dateDir).filter(f => f.endsWith('.json'))) {
        const filePath = path.join(dateDir, filename);
        try {
          const { meta } = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          snapshots.push({ dateStr, filename, filePath, meta });
        } catch {
          snapshots.push({ dateStr, filename, filePath, meta: null });
        }
      }
    }
    return snapshots;
  }
}

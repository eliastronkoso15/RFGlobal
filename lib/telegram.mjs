/**
 * telegram.mjs — минимальный Telegram-нотификатор.
 *
 * Использование:
 *   import { notify } from './lib/telegram.mjs';
 *   await notify('✅ текст сообщения');
 *
 * Переменные окружения:
 *   TELEGRAM_BOT_TOKEN  — токен бота (обязателен для отправки)
 *   TELEGRAM_CHAT_ID    — ID канала/группы (обязателен для отправки)
 *
 * Если переменные не заданы — no-op, ошибок не бросает.
 * Retry: 3 попытки с задержками 2s / 5s.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? null;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID   ?? null;
const API       = 'https://api.telegram.org';

/**
 * Низкоуровневый вызов Bot API с retry. Возвращает true при успехе,
 * false после исчерпания попыток. Никогда не бросает.
 */
async function callApi(method, payload) {
  if (!BOT_TOKEN) return false;

  const delays = [0, 2000, 5000];
  for (const delay of delays) {
    if (delay) await sleep(delay);
    try {
      const resp = await fetch(`${API}/bot${BOT_TOKEN}/${method}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(10_000),
      });
      const json = await resp.json();
      if (json.ok) return true; // success
      console.warn(`[telegram] API error (${method}): ${json.description}`);
    } catch (err) {
      console.warn(`[telegram] Send failed (${method}): ${err?.message ?? err}`);
    }
  }
  return false;
}

/**
 * Отправить HTML-сообщение в мониторинг-чат (TELEGRAM_CHAT_ID).
 * Всегда резолвится (никогда не бросает).
 */
export async function notify(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  await callApi('sendMessage', {
    chat_id:                  CHAT_ID,
    text,
    parse_mode:               'HTML',
    disable_web_page_preview: true,
  });
}

/**
 * Отправить HTML-сообщение в произвольный chat/канал.
 * @returns {Promise<boolean>} успех отправки — вызывающий решает,
 *          фиксировать ли результат в state.
 */
export async function sendMessageTo(chatId, text, { disablePreview = true } = {}) {
  if (!chatId) return false;
  return callApi('sendMessage', {
    chat_id:                  chatId,
    text,
    parse_mode:               'HTML',
    disable_web_page_preview: disablePreview,
  });
}

/**
 * Отправить фото (по публичному URL) с HTML-caption в произвольный chat/канал.
 * Telegram сам скачивает URL — нам не нужно ни хранить, ни проксировать файл.
 * Caption лимит 1024 символа — за этим следит вызывающий.
 * @returns {Promise<boolean>} успех отправки.
 */
export async function sendPhotoTo(chatId, photoUrl, caption) {
  if (!chatId) return false;
  return callApi('sendPhoto', {
    chat_id:    chatId,
    photo:      photoUrl,
    caption,
    parse_mode: 'HTML',
  });
}

// ── Форматирование ────────────────────────────────────────────────────────────

const PROVIDER_LABEL = {
  wizz_air:            'Wizz Air',
  aegean_air:          'Aegean',
  ryanair_fare_finder: 'Ryanair',
};

const TYPE_LABEL = {
  oneway:  'one-way',
  weekend: 'weekend',
  holiday: 'holiday',
};

function dur(ms) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m}m ${s}s` : `${m}m`;
}

function header(provider, landing, collectType) {
  const p = PROVIDER_LABEL[provider] ?? provider;
  const t = TYPE_LABEL[collectType]  ?? collectType;
  return `${p} · ${landing.toUpperCase()} · ${t}`;
}

/**
 * Формирует сообщение об успешном / частичном завершении.
 * @param {{ provider, landing, collectType, schedule, recordCount, durationMs, topFares? }} opts
 */
export function msgCompleted({ provider, landing, collectType, schedule, recordCount, durationMs, topFares }) {
  const emoji = recordCount > 0 ? '✅' : '⚠️';
  const label = recordCount > 0 ? 'Сбор завершён' : 'Нет данных';
  const sched = schedule === 'manual' ? 'manual' : schedule;

  const lines = [
    `${emoji} <b>${label}</b> · ${sched}`,
    header(provider, landing, collectType),
    `📦 ${recordCount} фарес · ⏱ ${dur(durationMs)}`,
  ];

  if (topFares?.length) {
    const top = topFares.slice(0, 3).map(f => `${f.destination} €${f.price}`).join(' · ');
    lines.push(`💰 ${top}`);
  }

  return lines.join('\n');
}

/**
 * Формирует сообщение об ошибке.
 */
export function msgFailed({ provider, landing, collectType, schedule, durationMs, error }) {
  const sched = schedule === 'manual' ? 'manual' : schedule;
  const errText = String(error ?? 'Unknown error').substring(0, 120);
  return [
    `❌ <b>Сбор упал</b> · ${sched}`,
    header(provider, landing, collectType),
    `⏱ ${dur(durationMs)}`,
    `<code>${errText}</code>`,
  ].join('\n');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 防災警報推播：輪詢 NCDR 民生示警公開資料（免金鑰 JSON Atom feed），
// 偵測「新出現、有意義」的官方警報（颱風/地震/豪雨/淹水/土石流/高溫/強風），
// 依訂閱者語言推播（AI 翻譯；失敗仍推中文原文＋提示，絕不漏發）。
// 排程比照 rateAlert.js／tutor.js：自我排程 setTimeout + ticking 防重入 + 持久化 state。
const store = require('../store');
const lang = require('../lang');
const { client } = require('../line');
const ai = require('../ai');
const { config } = require('../config');

const FEED_URL = 'https://alerts.ncdr.nat.gov.tw/JSONAtomFeed.ashx';
const SUB_FILE = 'alertSub.json'; // [{ userId }]（訂閱名單，比照 tutor.json）
const STATE_FILE = 'alert-state.json'; // { bootstrapped, seenIds: { "<id>": <updatedEpochMs> } }
const TICK_MS = config.disasterAlertTickMs; // 5 分鐘（DESIGN §5；可用 ALERT_TICK_MS 覆寫）
const FETCH_TIMEOUT_MS = 8000; // 同 fuelPrice.js
const STATE_CAP = 3000; // seenIds 上限（DESIGN §5）

// 翻譯用的語言名對照（給 ai.ask 的 prompt 用；比照 morning.js WEATHER_LANG_NAME）
const LANG_NAME = {
  vi: '越南語',
  en: '英文',
  ja: '日文',
  th: '泰文',
  id: '印尼文',
};

// 類別白名單 → 內部 severity（DESIGN §3 過濾規則；雷雨預設關，實測最洗版）
const PUSH_CATEGORIES = {
  '地震': 'high',
  '颱風': 'high',
  '海嘯': 'high',
  '豪雨': 'high',
  '大雨': 'high',
  '降雨': 'high',
  '淹水': 'high',
  '土石流': 'high',
  '高溫': 'med',
  '強風': 'med',
  // '雷雨' 預設關（optIn，v1 不推；洗版來源，實測 27 筆／半天）
};

// 類別 emoji 對照（DESIGN §2.3；查無用 ⚠️）
const CATEGORY_EMOJI = {
  '地震': '🌏',
  '颱風': '🌀',
  '海嘯': '🌊',
  '豪雨': '🌧',
  '大雨': '🌧',
  '降雨': '🌧',
  '淹水': '🌊',
  '土石流': '⛰',
  '雷雨': '⛈',
  '高溫': '🌡',
  '強風': '💨',
};

// ── state ─────────────────────────────────────────────────────────────
function loadState() {
  const s = store.load(STATE_FILE);
  return Array.isArray(s) || !s ? { bootstrapped: false, seenIds: {} } : {
    bootstrapped: !!s.bootstrapped,
    seenIds: s.seenIds && typeof s.seenIds === 'object' ? s.seenIds : {},
  };
}
function saveState(state) {
  store.save(STATE_FILE, state);
}

// ── 訂閱名單 ──────────────────────────────────────────────────────────
function loadSubs() {
  const s = store.load(SUB_FILE);
  return Array.isArray(s) ? s : [];
}

/**
 * 訂閱（冪等）。
 * @param {string} userId
 * @param {string} [code] 語言碼
 * @returns {string}
 */
function subscribe(userId, code = 'zh-TW') {
  const list = loadSubs().filter((s) => s.userId !== userId);
  list.push({ userId });
  store.save(SUB_FILE, list);
  return lang.alertOn(code);
}

/**
 * 退訂（冪等；本來就沒訂閱回「沒有訂閱」句）。
 * @param {string} userId
 * @param {string} [code] 語言碼
 * @returns {string}
 */
function unsubscribe(userId, code = 'zh-TW') {
  const before = loadSubs();
  const after = before.filter((s) => s.userId !== userId);
  store.save(SUB_FILE, after);
  return before.length === after.length ? lang.alertOffNone(code) : lang.alertOff(code);
}

function list() {
  return loadSubs();
}

// ── 中文時間字串（"2026/7/7 下午 03:59:00"）→ epoch ms；解析失敗回 NaN ──
function parseZhTime(s) {
  if (typeof s !== 'string') return NaN;
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(上午|下午)\s*(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return NaN;
  const [, y, mo, d, ampm, h, mi, se] = m;
  let hour = Number(h) % 12;
  if (ampm === '下午') hour += 12;
  // 台北時間（+08:00）
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${mi}:${se}+08:00`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? NaN : t;
}

// area 擷取（顯示用，非邏輯）：常見「影響範圍:…」樣式；抓不到回 ''
function extractArea(summary) {
  const m = String(summary || '').match(/影響範圍[:：]([^。\n]+)/);
  return m ? m[1].trim() : '';
}

/**
 * 純函式：把 NCDR feed（JSON 字串或已 parse 物件）解析成正規化陣列。
 * 任何壞輸入 → 回 []，絕不 throw（比照 fuelPrice.js parsePrices 的防禦性）。
 * @param {string|object} raw
 * @returns {Array<object>}
 */
function parseAlerts(raw) {
  let feed = raw;
  if (typeof raw === 'string') {
    try {
      feed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!feed || typeof feed !== 'object') return [];

  let entries = feed.entry;
  if (!Array.isArray(entries)) {
    if (entries && typeof entries === 'object') entries = [entries];
    else return [];
  }

  const out = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const id = e.id;
    const summaryText = e.summary && e.summary['#text'];
    if (!id || !summaryText) continue; // 缺 id 或缺 summary → 跳過

    const category = (e.category && e.category['@term']) || '';
    const msgType = e.msgType;
    const status = e.status;

    // 過濾（DESIGN §3）：status===Actual ∧ msgType===Alert ∧ category ∈ 白名單
    if (status !== 'Actual') continue;
    if (msgType !== 'Alert') continue;
    const severity = PUSH_CATEGORIES[category];
    if (!severity) continue;

    out.push({
      id,
      category,
      agency: (e.author && e.author.name) || '',
      title: e.title || '',
      summary: summaryText,
      msgType,
      status,
      severity,
      area: extractArea(summaryText),
      effective: e.effective || '',
      expires: e.expires || '',
      updated: e.updated || '',
    });
  }
  return out;
}

/**
 * 抓取 NCDR feed 並解析（AbortController 8 秒逾時）。失敗回 null。
 * @returns {Promise<Array<object>|null>}
 */
async function fetchAlerts() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(FEED_URL, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    return module.exports.parseAlerts(data); // 透過 module 物件呼叫，讓測試替換生效
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 對每筆候選警報判斷是否為「新」（id 不在 seenIds 內）。
 * @param {Array<object>} alerts
 * @param {{seenIds:object}} state
 * @returns {Array<object>}
 */
function decideNew(alerts, state) {
  const seen = (state && state.seenIds) || {};
  return alerts.filter((a) => !(a.id in seen));
}

/** 把當下所有候選 id 全部標記為已見（首次啟用不回補用）。 */
function markAllSeen(alerts, state) {
  const seenIds = { ...(state.seenIds || {}) };
  for (const a of alerts) {
    seenIds[a.id] = parseZhTime(a.updated) || Date.parse(a.updated) || Date.now();
  }
  return { ...state, bootstrapped: true, seenIds };
}

/** 把單筆警報 id 標記為已見（updated 轉 epoch ms；解析失敗退回 Date.now）。 */
function markSeen(alert, state) {
  const seenIds = { ...(state.seenIds || {}) };
  const t = Date.parse(alert.updated);
  seenIds[alert.id] = Number.isNaN(t) ? Date.now() : t;
  return { ...state, seenIds };
}

/**
 * state 修剪（DESIGN §5）：先依 expires 過期（early than now-24h）砍，
 * 若仍超過 STATE_CAP，依 updated 時間戳保留最新 STATE_CAP 筆。
 * @param {{bootstrapped:boolean, seenIds:object}} state
 * @param {Array<object>} [aliveAlerts] 目前這輪候選（供以 expires 過期判斷；可省略）
 */
function pruneState(state, aliveAlerts) {
  const seenIds = { ...(state.seenIds || {}) };
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;

  // 建立 id → expires 的對照（只有這輪候選才有 expires 資訊）
  const expiresById = {};
  if (Array.isArray(aliveAlerts)) {
    for (const a of aliveAlerts) {
      if (a && a.id) expiresById[a.id] = a.expires;
    }
  }

  for (const id of Object.keys(seenIds)) {
    const exp = expiresById[id];
    if (exp) {
      const t = parseZhTime(exp);
      if (!Number.isNaN(t) && t < cutoff) {
        delete seenIds[id];
      }
    }
  }

  // 硬上限：依 updated 時間戳保留最新 STATE_CAP 筆
  const keys = Object.keys(seenIds);
  if (keys.length > STATE_CAP) {
    keys.sort((a, b) => (seenIds[a] || 0) - (seenIds[b] || 0)); // 舊到新
    const toDrop = keys.length - STATE_CAP;
    for (let i = 0; i < toDrop; i++) delete seenIds[keys[i]];
  }

  return { ...state, seenIds };
}

// ── 推播＋翻譯 ────────────────────────────────────────────────────────

/** 組裝翻譯 prompt（DESIGN §4）。 */
function buildTranslatePrompt(langName, summary) {
  const system =
    `把以下台灣官方防災警報完整翻譯成${langName}，保留數字、地名、時間與 emoji，語氣簡潔明確，只輸出翻譯結果，不要加註解`;
  return { system, user: summary };
}

/**
 * 依語言取得警報內文（zh-TW 直用原文；其他語言呼叫 ai.ask 翻譯，
 * 失敗回中文原文＋失敗提示，絕不漏發）。單輪內同語言快取一次（cache 由呼叫端傳入）。
 * @param {object} alert
 * @param {string} code
 * @param {Map<string,string>} cache 單輪內 lang → body 快取
 * @returns {Promise<string>}
 */
async function translatedBody(alert, code, cache) {
  if (code === 'zh-TW') return alert.summary;
  if (cache.has(code)) return cache.get(code);

  const langName = LANG_NAME[code] || '英文';
  const { system, user } = buildTranslatePrompt(langName, alert.summary);
  let translated = '';
  try {
    translated = await ai.ask(system, user);
  } catch {
    translated = '';
  }
  // 安全優先：翻譯為空或純空白都視為失敗，改推原始中文＋提示，絕不推出空白警報。
  const body = translated && translated.trim()
    ? translated
    : lang.alertTranslateFail(code) + '\n' + alert.summary;
  cache.set(code, body);
  return body;
}

/** 對所有訂閱者推播單筆新警報（依各自語言，失敗不影響其他人）。 */
async function pushAlert(alert) {
  const subs = loadSubs();
  if (subs.length === 0) return;
  const cache = new Map(); // 單輪內同語言快取一次
  for (const sub of subs) {
    let code = 'zh-TW';
    try {
      code = (await lang.resolve(sub.userId)) || 'zh-TW';
    } catch {
      code = 'zh-TW';
    }
    const body = await translatedBody(alert, code, cache);
    const text = lang.alertPush(code, alert, body);
    await client
      .pushMessage({ to: sub.userId, messages: [{ type: 'text', text: text.slice(0, 5000) }] })
      .catch(() => {});
  }
}

// ── 排程 ──────────────────────────────────────────────────────────────
let ticking = false;
async function tick() {
  if (ticking) return; // 防重入
  ticking = true;
  try {
    const alerts = await module.exports.fetchAlerts();
    if (alerts === null) return; // 輪詢失敗：該輪跳過，不寫 state、不 bootstrap（DESIGN §3）

    let state = loadState();

    if (!state.bootstrapped) {
      // 首次成功輪詢：全部標記已見，完全不推播（PRD §F2 不回補）
      state = markAllSeen(alerts, state);
      state = pruneState(state, alerts);
      saveState(state);
      return;
    }

    const fresh = decideNew(alerts, state);
    for (const a of fresh) {
      // 先推播給所有訂閱者、再把該 id 寫入 seenIds（DESIGN §3「安全優先」順序）
      await pushAlert(a);
      state = markSeen(a, state);
      saveState(state);
    }
    state = pruneState(state, alerts);
    saveState(state);
  } catch (e) {
    console.error('防災警報排程錯誤：', e.message);
  } finally {
    ticking = false;
    setTimeout(tick, TICK_MS); // 前一輪完成後才排下一輪
  }
}

function start() {
  setTimeout(tick, TICK_MS);
  console.log(`🌀 防災警報推播排程已啟動（每 ${Math.round(TICK_MS / 60000)} 分鐘）`);
}

module.exports = {
  parseAlerts,
  fetchAlerts,
  subscribe,
  unsubscribe,
  list,
  start,
  tick,
  _internal: { loadState, saveState, decideNew, markAllSeen, pruneState, PUSH_CATEGORIES, CATEGORY_EMOJI, parseZhTime },
};

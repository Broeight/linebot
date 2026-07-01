// 台鐵火車時刻查詢服務：使用交通部 PTX v3 開放端點（免金鑰）。
//   端點：https://ptx.transportdata.tw/MOTC/v3/Rail/TRA/DailyTrainTimetable/OD/{起站}/to/{迄站}/{YYYY-MM-DD}
//   站到站當日時刻，僅查「今天、現在時間之後」的剩餘班次；不做跨日查詢。
//   逾時 6 秒、記憶體快取 30 分鐘（key = 起站-迄站-日期）。
//
// 對外匯出：lookup、nextTrain、usage（中文指令用）
//           getTraTrainSummary（AI 工具用，回英文）
//           normalizeStation、filterAndSort、duration、STATIONS（供離線測試）

const store = require('../store');

// ── 常數（單一真實來源）────────────────────────────────────────────────
const OD_BASE = 'https://ptx.transportdata.tw/MOTC/v3/Rail/TRA/DailyTrainTimetable/OD';
const SOURCE = '台鐵 TRA（交通部 PTX）';
const CACHE_TTL_MS = 30 * 60 * 1000;   // 30 分鐘
const FETCH_TIMEOUT_MS = 6000;         // 6 秒
const MAX_RESULTS = 5;                  // 「台鐵」指令列出前 5 筆

// ── 車站對照（單一真實來源，供 handler、AI 工具、顯示共用）────────────────
// 正規站名（一律用俗寫「台」字版當 key）→ StationID（字串，保留前導零）
const STATIONS = {
  '基隆': '0900', '台北': '1000', '板橋': '1020', '桃園': '1080', '新竹': '1210',
  '台中': '3300', '嘉義': '4080', '台南': '4220', '高雄': '4400',
  '台東': '6000', '花蓮': '7000',
};

// 別名／簡稱 → 正規站名（key）。正體「臺」由 normalizeStation 統一轉「台」，故此處收「非臺/台」類簡稱
const STATION_ALIAS = {
  '北車': '台北', '台北車站': '台北', '高雄車站': '高雄', '高火': '高雄',
};

// ── 記憶體快取（以 `起站-迄站-日期` 為 key）────────────────────────────
const cache = {};

// ── 內部函式：站名正規化 ─────────────────────────────────────────────

/**
 * 把使用者輸入（中文站名，含正體「臺」／俗寫「台」／常見別名）正規化為 { name, id }。
 * 找不到回 null（由上層輸出「站名無法辨識」訊息）。
 * @param {string} input
 * @returns {{name:string, id:string}|null}
 */
function normalizeStation(input) {
  if (!input) return null;
  let t = input.trim();
  if (!t) return null;

  // 正體「臺」→ 俗寫「台」，正體／俗寫互通
  t = t.replace(/臺/g, '台');
  // 去除結尾贅字「站」「車站」
  t = t.replace(/(車站|站)$/, '');

  // 先查別名表（含未去除贅字的原字串，避免「台北車站」被去尾字後查不到別名）
  const aliasKey = input.trim().replace(/臺/g, '台');
  let name = STATION_ALIAS[aliasKey] || STATION_ALIAS[t] || t;

  if (!STATIONS[name]) return null;

  return { name, id: STATIONS[name] };
}

// ── 內部函式：資料抓取 + 快取 ─────────────────────────────────────────

/**
 * 抓取起訖站當日全部班次（未過濾時間、未排序），有 6 秒逾時與 30 分鐘快取。
 * @param {string} fromId 起站 StationID
 * @param {string} toId   迄站 StationID
 * @param {string} date   'YYYY-MM-DD'
 * @returns {Promise<{ok:true, trains:Array}|{ok:false}>}
 */
async function fetchOdTrains(fromId, toId, date) {
  const cacheKey = `${fromId}-${toId}-${date}`;
  const now = Date.now();
  if (cache[cacheKey] && now - cache[cacheKey].ts < CACHE_TTL_MS) {
    return { ok: true, trains: cache[cacheKey].trains };
  }

  // AbortController 逾時
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const url = `${OD_BASE}/${fromId}/to/${toId}/${date}?%24format=JSON`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false };

    const data = await res.json();
    if (!Array.isArray(data.TrainTimetables)) return { ok: false };

    const trains = data.TrainTimetables.map((t) => {
      const stops = t.StopTimes || [];
      const first = stops[0] || {};
      const last = stops[stops.length - 1] || {};
      return {
        trainNo: t.TrainInfo && t.TrainInfo.TrainNo,
        typeZh: t.TrainInfo && t.TrainInfo.TrainTypeName && t.TrainInfo.TrainTypeName.Zh_tw,
        typeEn: t.TrainInfo && t.TrainInfo.TrainTypeName && t.TrainInfo.TrainTypeName.En,
        departure: first.DepartureTime,
        arrival: last.ArrivalTime,
        suspended: !!(t.TrainInfo && t.TrainInfo.SuspendedFlag === 1),
      };
    });

    cache[cacheKey] = { trains, ts: now };

    return { ok: true, trains };
  } catch (_e) {
    // 逾時（AbortError）、連線失敗、JSON 解析失敗都視為取不到
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

// ── 內部函式：過濾排序 + 行駛時間（純函式，可測）────────────────────────

/**
 * 過濾掉停駛與已發車的班次，依發車時間升冪排序，取前 limit 筆。
 * @param {Array} trains  fetchOdTrains 回傳的精簡陣列
 * @param {string} nowHm  現在時間 'HH:mm'
 * @param {number} limit  最多取幾筆
 * @returns {Array}
 */
function filterAndSort(trains, nowHm, limit) {
  return trains
    .filter((t) => !t.suspended && t.departure && t.arrival && t.departure >= nowHm)
    .sort((a, b) => (a.departure < b.departure ? -1 : a.departure > b.departure ? 1 : 0))
    .slice(0, limit);
}

/**
 * 計算行駛時間，回傳「H小時M分」字串。跨午夜（arr < dep）視為 +24h。
 * @param {string} dep 'HH:mm'
 * @param {string} arr 'HH:mm'
 * @returns {string}
 */
function duration(dep, arr) {
  const [dh, dm] = dep.split(':').map(Number);
  const [ah, am] = arr.split(':').map(Number);
  let mins = (ah * 60 + am) - (dh * 60 + dm);
  if (mins < 0) mins += 24 * 60; // 跨午夜
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}小時${m}分`;
}

/**
 * 計算行駛時間，回傳英文摘要用的「HhMm」字串（供 getTraTrainSummary 使用）。
 * @param {string} dep 'HH:mm'
 * @param {string} arr 'HH:mm'
 * @returns {string}
 */
function durationEn(dep, arr) {
  const [dh, dm] = dep.split(':').map(Number);
  const [ah, am] = arr.split(':').map(Number);
  let mins = (ah * 60 + am) - (dh * 60 + dm);
  if (mins < 0) mins += 24 * 60;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h${m}m`;
}

/**
 * 把「到」「往」等連接詞換成空白，再以空白切出起、迄兩個站名 token。
 * @param {string} argText
 * @returns {string[]} 最多兩個 token
 */
function splitStations(argText) {
  return argText
    .replace(/到|往/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// ── 對外函式：中文指令用 ─────────────────────────────────────────────

/**
 * 解析「台鐵 起 迄」的參數字串，查詢並回傳已格式化的中文回覆（最多 5 筆）。
 * @param {string} argText 指令關鍵字後的字串，如 "台北 台中"
 * @returns {Promise<string>}
 */
async function lookup(argText) {
  if (!argText || !argText.trim()) {
    return '格式：台鐵 台北 台中';
  }

  const tokens = splitStations(argText);
  if (tokens.length < 2) {
    return '格式：台鐵 台北 台中';
  }

  const [fromToken, toToken] = tokens;
  const from = normalizeStation(fromToken);
  const to = normalizeStation(toToken);

  if (!from) {
    return `站名無法辨識：「${fromToken}」，請輸入明確的車站名稱`;
  }
  if (!to) {
    return `站名無法辨識：「${toToken}」，請輸入明確的車站名稱`;
  }

  const today = store.taipei();

  let result;
  try {
    result = await fetchOdTrains(from.id, to.id, today.date);
  } catch (_e) {
    return '目前無法取得台鐵時刻，請稍後再試 🙏';
  }

  if (!result.ok) {
    return '目前無法取得台鐵時刻，請稍後再試 🙏';
  }

  const trains = filterAndSort(result.trains, today.hm, MAX_RESULTS);
  const mmdd = `${today.date.slice(5, 7)}/${today.date.slice(8, 10)}`;

  if (trains.length === 0) {
    return `🚆 台鐵 ${from.name} → ${to.name}（${mmdd}）\n今日已無班次`;
  }

  const lines = trains.map(
    (t) => `・${t.trainNo}次 ${t.typeZh}　${t.departure}→${t.arrival}（${duration(t.departure, t.arrival)}）`
  );

  return (
    `🚆 台鐵 ${from.name} → ${to.name}（${mmdd}）\n` +
    `現在 ${today.hm} 之後的班次：\n\n` +
    lines.join('\n') + '\n\n' +
    `資料來源：${SOURCE}`
  );
}

/**
 * 解析「下一班 起到迄」的參數字串，查詢並回傳只含 1 筆的中文回覆。
 * @param {string} argText 指令關鍵字後的字串，如 "台北到花蓮" 或 "台北 花蓮"
 * @returns {Promise<string>}
 */
async function nextTrain(argText) {
  if (!argText || !argText.trim()) {
    return '格式：下一班 台北到花蓮';
  }

  const tokens = splitStations(argText);
  if (tokens.length < 2) {
    return '格式：下一班 台北到花蓮';
  }

  const [fromToken, toToken] = tokens;
  const from = normalizeStation(fromToken);
  const to = normalizeStation(toToken);

  if (!from) {
    return `站名無法辨識：「${fromToken}」，請輸入明確的車站名稱`;
  }
  if (!to) {
    return `站名無法辨識：「${toToken}」，請輸入明確的車站名稱`;
  }

  const today = store.taipei();

  let result;
  try {
    result = await fetchOdTrains(from.id, to.id, today.date);
  } catch (_e) {
    return '目前無法取得台鐵時刻，請稍後再試 🙏';
  }

  if (!result.ok) {
    return '目前無法取得台鐵時刻，請稍後再試 🙏';
  }

  const trains = filterAndSort(result.trains, today.hm, 1);

  if (trains.length === 0) {
    return `🚆 下一班 ${from.name} → ${to.name}\n今日已無班次`;
  }

  const t = trains[0];
  return (
    `🚆 下一班 ${from.name} → ${to.name}\n` +
    `・${t.trainNo}次 ${t.typeZh}　${t.departure} 發車，${t.arrival} 抵達（${duration(t.departure, t.arrival)}）\n\n` +
    `資料來源：${SOURCE}`
  );
}

/**
 * 台鐵時刻查詢使用說明子選單（同步）。
 * @returns {string}
 */
function usage() {
  return (
    '🚆 台鐵時刻查詢可以這樣問：\n' +
    '・台鐵 台北 台中（近期班次，最多 5 筆）\n' +
    '・下一班 台北到花蓮（只看最近一班）\n' +
    '支援主要幹線車站；僅查今天、當下時間之後的班次。'
  );
}

// ── 對外函式：AI 工具用（回英文摘要）──────────────────────────────────

/**
 * 查詢台鐵起訖站班次，回傳英文純文字摘要供 AI 工具呼叫後讓模型用使用者語言改寫。
 * 取不到資料時回 null；站名無法辨識或今日已無班次時回英文字串（讓模型轉述）。
 * @param {{from:string, to:string, nextOnly?:boolean}} opts
 * @returns {Promise<string|null>}
 */
async function getTraTrainSummary({ from, to, nextOnly }) {
  const fromSt = normalizeStation(from);
  const toSt = normalizeStation(to);

  if (!fromSt || !toSt) {
    const bad = !fromSt ? from : to;
    return `Station not recognized: "${bad}". Please give a valid TRA station name (e.g. Taipei, Taichung, Hualien).`;
  }

  const today = store.taipei();

  let result;
  try {
    result = await fetchOdTrains(fromSt.id, toSt.id, today.date);
  } catch (_e) {
    return null;
  }

  if (!result.ok) return null;

  const limit = nextOnly ? 1 : MAX_RESULTS;
  const trains = filterAndSort(result.trains, today.hm, limit);

  if (trains.length === 0) {
    return `No remaining TRA trains today from ${fromSt.name} to ${toSt.name}.`;
  }

  if (nextOnly) {
    const t = trains[0];
    return (
      `Next TRA train from ${fromSt.name} to ${toSt.name} today: ` +
      `No.${t.trainNo} ${t.typeEn}, departs ${t.departure}, arrives ${t.arrival} (${durationEn(t.departure, t.arrival)}).\n` +
      `Source: Taiwan Railway (TRA) via MOTC PTX.`
    );
  }

  const parts = trains.map(
    (t) => `No.${t.trainNo} ${t.typeEn} ${t.departure}->${t.arrival} (${durationEn(t.departure, t.arrival)})`
  );

  return (
    `TRA trains from ${fromSt.name} to ${toSt.name} today (${today.date}), departing after ${today.hm}:\n` +
    parts.join('; ') + '.\n' +
    `Source: Taiwan Railway (TRA) via MOTC PTX.`
  );
}

// ── 匯出 ──────────────────────────────────────────────────────────────
module.exports = {
  // 中文指令用
  lookup,
  nextTrain,
  usage,
  // AI 工具用
  getTraTrainSummary,
  // 供離線測試（純函式／表）
  normalizeStation,
  filterAndSort,
  duration,
  STATIONS,
};

// 台鐵火車時刻查詢服務：使用交通部 PTX v3 開放端點（免金鑰）。
//   端點：https://ptx.transportdata.tw/MOTC/v3/Rail/TRA/DailyTrainTimetable/OD/{起站}/to/{迄站}/{YYYY-MM-DD}
//   站到站當日時刻，僅查「今天、現在時間之後」的剩餘班次；不做跨日查詢。
//   逾時 6 秒、記憶體快取 30 分鐘（key = 起站-迄站-日期）。
//
// 對外匯出：lookup、nextTrain、usage（中文指令用）
//           getTraTrainSummary（AI 工具用，回英文）
//           suggestStations（模糊比對相近站名，供選單流程用）
//           getTraTrainByIds（以站碼直接查時刻，供 pending 完成查詢用，回中文字串）
//           normalizeStation、fetchStations、VN_ALIAS、toAscii、filterAndSort、duration、STATIONS（供離線測試）

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

// 全台鐵車站清單來源（免金鑰），供辨識所有車站的中／英文名
const STATION_URL = 'https://ptx.transportdata.tw/MOTC/v3/Rail/TRA/Station?%24format=JSON';
const STATIONS_TTL_MS = 24 * 60 * 60 * 1000; // 車站清單快取 24 小時

// 主要車站的越南語（漢越音）別名 → 中文站名（去聲調、小寫、Đ→d 後比對）
const VN_ALIAS = {
  'dai bac': '台北', 'tan truc': '新竹', 'trung lich': '中壢', 'trung ly': '中壢',
  'dao vien': '桃園', 'dai trung': '台中', 'dai nam': '台南', 'cao hung': '高雄',
  'hoa lien': '花蓮', 'dai dong': '台東', 'ban kieu': '板橋', 'co long': '基隆',
  'gia nghia': '嘉義', 'chuong hoa': '彰化', 'nghi lan': '宜蘭', 'tan doanh': '新營',
  'dau luc': '斗六', 'bao nguyen': '豐原', 'truc nam': '竹南', 'tan phong': '新豐',
  'trung li': '中壢', // 使用者常把 Trung Lịch 打成 trung lì → 去聲調成 trung li
  'co hung': '高雄',  // cao hung 的口語變體
};

// 去空白版索引（模組載入時建立一次），供 normalizeStation 容忍「trunglich」等無空白拼法
const VN_ALIAS_NOSPACE = {};
for (const k of Object.keys(VN_ALIAS)) VN_ALIAS_NOSPACE[k.replace(/\s+/g, '')] = VN_ALIAS[k];

// ── 記憶體快取 ─────────────────────────────────────────────────────────
const cache = {};                              // OD 班次：key = `起-迄-日期`
let stationsCache = { ts: 0, zh: null, en: null }; // 車站清單

// 去除越南語聲調並小寫（Đ/đ → d）
function toAscii(s) {
  return String(s).toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// 把台北時間日期字串加一天，回傳 'YYYY-MM-DD'
function addOneDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  d.setTime(d.getTime() + 24 * 60 * 60 * 1000);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
}

// 抓全台鐵車站清單，建中文名／英文名 → { name, id } 對照（快取 24h）。抓不到回 null。
async function fetchStations() {
  if (stationsCache.zh && Date.now() - stationsCache.ts < STATIONS_TTL_MS) return stationsCache;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(STATION_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data.Stations) ? data.Stations : [];
    const zh = {};
    const en = {};
    for (const s of list) {
      const id = s.StationID;
      const nameZh = s.StationName && s.StationName.Zh_tw;
      const nameEn = s.StationName && s.StationName.En;
      if (!id || !nameZh) continue;
      // 一律用俗寫「台」字版當顯示名（與 STATIONS 表、App 其他地方一致；PTX 官方寫「臺北」）
      const nameZhShort = nameZh.replace(/臺/g, '台');
      zh[nameZhShort] = { name: nameZhShort, id };
      if (nameEn) en[nameEn.toLowerCase()] = { name: nameZhShort, id };
    }
    if (Object.keys(zh).length) stationsCache = { ts: Date.now(), zh, en };
    return stationsCache.zh ? stationsCache : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── 內部函式：站名正規化 ─────────────────────────────────────────────

/**
 * 把使用者輸入的站名正規化為 { name, id }。支援：中文全名（臺／台互通）、常見別名、
 * 越南語漢越音（如 Tân Trúc→新竹）、英文名（如 Hsinchu/Zhongli）。找不到回 null。
 * @param {string} input
 * @returns {Promise<{name:string, id:string}|null>}
 */
async function normalizeStation(input) {
  if (!input) return null;
  const aliasKey = String(input).trim().replace(/臺/g, '台');
  if (!aliasKey) return null;
  const t = aliasKey.replace(/(車站|站)$/, '').trim();

  // 依序決定候選中文站名：越南語別名（直查）→ 越南語別名（去空白後備）→ 中文簡稱別名 → 原字串（當中文全名）
  const candidateZh =
    VN_ALIAS[toAscii(t)] ||
    VN_ALIAS_NOSPACE[toAscii(t).replace(/\s+/g, '')] ||
    STATION_ALIAS[aliasKey] ||
    STATION_ALIAS[t] ||
    t;

  const maps = await fetchStations();
  if (maps) {
    if (maps.zh[candidateZh]) return maps.zh[candidateZh]; // 中文（含全部 245 站）
    if (maps.en[t.toLowerCase()]) return maps.en[t.toLowerCase()]; // 英文名
  }
  // 抓不到清單時的備援（內建主要站）
  if (STATIONS[candidateZh]) return { name: candidateZh, id: STATIONS[candidateZh] };
  return null;
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
  const from = await normalizeStation(fromToken);
  const to = await normalizeStation(toToken);

  if (!from) {
    return `站名無法辨識:「${fromToken}」，請輸入明確的車站名稱（中文或英文皆可）`;
  }
  if (!to) {
    return `站名無法辨識:「${toToken}」，請輸入明確的車站名稱（中文或英文皆可）`;
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
  const from = await normalizeStation(fromToken);
  const to = await normalizeStation(toToken);

  if (!from) {
    return `站名無法辨識:「${fromToken}」，請輸入明確的車站名稱（中文或英文皆可）`;
  }
  if (!to) {
    return `站名無法辨識:「${toToken}」，請輸入明確的車站名稱（中文或英文皆可）`;
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
async function getTraTrainSummary({ from, to, nextOnly, day }) {
  const fromSt = await normalizeStation(from);
  const toSt = await normalizeStation(to);

  if (!fromSt || !toSt) {
    const bad = !fromSt ? from : to;
    return `Station not recognized: "${bad}". Ask the user for a valid Taiwan Railway station name (Chinese or English, e.g. 台北/Taipei, 中壢/Zhongli).`;
  }

  const t0 = store.taipei();
  const isTomorrow = day === 'tomorrow';
  const date = isTomorrow ? addOneDay(t0.date) : t0.date;
  const fromHm = isTomorrow ? '00:00' : t0.hm; // 明天→整天班次；今天→現在之後
  const whenEn = isTomorrow ? 'tomorrow' : 'today';

  let result;
  try {
    result = await fetchOdTrains(fromSt.id, toSt.id, date);
  } catch (_e) {
    return null;
  }

  if (!result.ok) return null;

  const limit = nextOnly ? 1 : MAX_RESULTS;
  const trains = filterAndSort(result.trains, fromHm, limit);

  if (trains.length === 0) {
    return `No TRA trains ${whenEn} from ${fromSt.name} to ${toSt.name}.`;
  }

  if (nextOnly) {
    const t = trains[0];
    return (
      `Next TRA train ${whenEn} from ${fromSt.name} to ${toSt.name}: ` +
      `No.${t.trainNo} ${t.typeEn}, departs ${t.departure}, arrives ${t.arrival} (${durationEn(t.departure, t.arrival)}).\n` +
      `Source: Taiwan Railway (TRA) via MOTC PTX.`
    );
  }

  const parts = trains.map(
    (t) => `No.${t.trainNo} ${t.typeEn} ${t.departure}->${t.arrival} (${durationEn(t.departure, t.arrival)})`
  );

  return (
    `TRA trains ${whenEn} (${date}) from ${fromSt.name} to ${toSt.name}:\n` +
    parts.join('; ') + '.\n' +
    `Source: Taiwan Railway (TRA) via MOTC PTX.`
  );
}

// ── 對外函式：相近站名選單流程用 ────────────────────────────────────────

/**
 * 標準 Levenshtein 編輯距離（DP），字串長度都很短，成本可忽略。私有純函式。
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function lev(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // 刪除
        dp[i][j - 1] + 1,      // 新增
        dp[i - 1][j - 1] + cost // 取代
      );
    }
  }
  return dp[m][n];
}

/**
 * 對單一表面字串 surf 與正規化 query q 計分（0–100，越高越像）。私有純函式。
 * @param {string} q
 * @param {string} surf
 * @returns {number}
 */
function scoreSurface(q, surf) {
  if (!surf) return 0;
  if (q === surf) return 100; // 完全相等（正常會被 normalizeStation 先攔截，仍保留以防萬一）
  const shorter = Math.min(q.length, surf.length);
  if ((surf.startsWith(q) || q.startsWith(surf)) && shorter >= 2) {
    return 90 - Math.abs(q.length - surf.length);
  }
  if (q.length >= 3 && (surf.includes(q) || q.includes(surf))) {
    return 75;
  }
  const d = lev(q, surf);
  const maxLen = Math.max(q.length, surf.length) || 1;
  const sim = 1 - d / maxLen;
  if (sim >= 0.5) return 50 + Math.round(sim * 40);
  return 0;
}

// VN_ALIAS 反查表（值＝中文站名 → 別名 key 陣列），模組載入時建立一次，供 suggestStations 用
const VN_ALIAS_REVERSE = {};
for (const [aliasKey, zhName] of Object.entries(VN_ALIAS)) {
  if (!VN_ALIAS_REVERSE[zhName]) VN_ALIAS_REVERSE[zhName] = [];
  VN_ALIAS_REVERSE[zhName].push(aliasKey);
}

/**
 * 模糊比對相近的真實車站，供「站名無法精準辨識」時給使用者選。
 * 呼叫端應先跑 normalizeStation，精準命中就不要呼叫本函式（PRD 驗收 §1）。
 * @param {string} token 使用者說/打的單一站名片段（走音、不完整、拼音、中英越皆可能）
 * @param {number} [max=5] 最多回傳幾筆
 * @returns {Promise<Array<{name:string, id:string}>>}
 */
async function suggestStations(token, max = 5) {
  if (!token || !String(token).trim()) return [];
  const aliasKey = String(token).trim().replace(/臺/g, '台');
  const t = aliasKey.replace(/(車站|站)$/, '').trim();
  if (!t) return [];
  const q = toAscii(t).replace(/\s+/g, '');
  if (!q) return [];

  const maps = await fetchStations();
  // 表面字串集合：id → { name, surfaces: Set<string> }
  const stationSurfaces = new Map();

  function addSurface(name, id, surf) {
    if (!name || !id || !surf) return;
    let entry = stationSurfaces.get(id);
    if (!entry) {
      entry = { name, surfaces: new Set() };
      stationSurfaces.set(id, entry);
    }
    entry.surfaces.add(surf);
  }

  if (maps) {
    // 中文站名
    for (const [zhName, info] of Object.entries(maps.zh)) {
      addSurface(zhName, info.id, toAscii(zhName).replace(/\s+/g, ''));
    }
    // 英文站名
    for (const [enName, info] of Object.entries(maps.en)) {
      addSurface(info.name, info.id, enName.replace(/\s+/g, ''));
    }
    // 越南語漢越音別名（反查掛到對應中文站）
    for (const [zhName, aliases] of Object.entries(VN_ALIAS_REVERSE)) {
      const info = maps.zh[zhName];
      if (!info) continue;
      for (const alias of aliases) addSurface(zhName, info.id, toAscii(alias).replace(/\s+/g, ''));
    }
  } else {
    // 抓不到清單時退回內建 STATIONS 主要站
    for (const [zhName, id] of Object.entries(STATIONS)) {
      addSurface(zhName, id, toAscii(zhName).replace(/\s+/g, ''));
    }
    for (const [zhName, aliases] of Object.entries(VN_ALIAS_REVERSE)) {
      const id = STATIONS[zhName];
      if (!id) continue;
      for (const alias of aliases) addSurface(zhName, id, toAscii(alias).replace(/\s+/g, ''));
    }
  }

  const results = [];
  for (const [id, entry] of stationSurfaces.entries()) {
    let best = 0;
    for (const surf of entry.surfaces) {
      const s = scoreSurface(q, surf);
      if (s > best) best = s;
    }
    if (best > 0) results.push({ name: entry.name, id, score: best });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.name.length !== b.name.length) return a.name.length - b.name.length;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  return results.slice(0, max).map((r) => ({ name: r.name, id: r.id }));
}

/**
 * 以站碼（非站名）直接查詢起訖站班次，回傳已格式化的中文字串（同 lookup／nextTrain 風格）。
 * 供 pending 選站完成後直接用站碼查詢，避免再走一次 normalizeStation。
 * @param {{fromId:string, toId:string, fromName:string, toName:string, nextOnly?:boolean, day?:string}} opts
 * @returns {Promise<string>}
 */
async function getTraTrainByIds({ fromId, toId, fromName, toName, nextOnly, day }) {
  const t0 = store.taipei();
  const isTomorrow = day === 'tomorrow';
  const date = isTomorrow ? addOneDay(t0.date) : t0.date;
  const fromHm = isTomorrow ? '00:00' : t0.hm; // 明天→整天班次；今天→現在之後
  const mmdd = `${date.slice(5, 7)}/${date.slice(8, 10)}`;
  const whenZh = isTomorrow ? '明天' : '今天';

  let result;
  try {
    result = await fetchOdTrains(fromId, toId, date);
  } catch (_e) {
    return '目前無法取得台鐵時刻，請稍後再試 🙏';
  }

  if (!result.ok) {
    return '目前無法取得台鐵時刻，請稍後再試 🙏';
  }

  const limit = nextOnly ? 1 : MAX_RESULTS;
  const trains = filterAndSort(result.trains, fromHm, limit);

  if (nextOnly) {
    if (trains.length === 0) {
      return `🚆 下一班 ${fromName} → ${toName}\n${whenZh}已無班次`;
    }
    const t = trains[0];
    return (
      `🚆 下一班 ${fromName} → ${toName}（${mmdd}）\n` +
      `・${t.trainNo}次 ${t.typeZh}　${t.departure} 發車，${t.arrival} 抵達（${duration(t.departure, t.arrival)}）\n\n` +
      `資料來源：${SOURCE}`
    );
  }

  if (trains.length === 0) {
    return `🚆 台鐵 ${fromName} → ${toName}（${mmdd}）\n${whenZh}已無班次`;
  }

  const lines = trains.map(
    (t) => `・${t.trainNo}次 ${t.typeZh}　${t.departure}→${t.arrival}（${duration(t.departure, t.arrival)}）`
  );

  return (
    `🚆 台鐵 ${fromName} → ${toName}（${mmdd}）\n` +
    `${whenZh} ${fromHm} 之後的班次：\n\n` +
    lines.join('\n') + '\n\n' +
    `資料來源：${SOURCE}`
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
  // 相近站名選單流程用
  suggestStations,
  getTraTrainByIds,
  // 供離線測試（純函式／表）
  normalizeStation,
  fetchStations,
  VN_ALIAS,
  toAscii,
  filterAndSort,
  duration,
  STATIONS,
};

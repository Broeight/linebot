// 加油站查詢服務：使用台灣中油開放資料 JSON 端點（免金鑰）。
//   端點：https://vipmbr.cpc.com.tw/openData/getStationInfo
//   （資料集 data.gov.tw #6065「台灣中油公司加油站服務資訊」，WGS84 座標，可直接 haversine。）
//   全台 1,971 筆站點資料，快取 24 小時；逾時 6 秒；失敗時優先使用舊快取（stale-first）。
//
// 對外匯出：findNearest、formatList、haversineKm（查詢＋純函式）、
//   noteLocation、getLocation（per-user 最近位置，PRD F6）、
//   setPending、consumePending（AI 路徑覆寫機制，仿 traChoice）、
//   slimStations、fullAddress（純函式，供離線測試）、MAX_RESULTS、LOCATION_TTL_MS。
//
// 隱私：使用者座標只存在本檔的記憶體 Map（lastLocation），永不 store.save、永不進對話記憶。

// ── 常數（單一真實來源，仿 fuelPrice.js 風格）──────────────────────────
const ENDPOINT = 'https://vipmbr.cpc.com.tw/openData/getStationInfo';
const SOURCE = '台灣中油';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 站點清單快取 24 小時（仿 traTrain fetchStations）
const FETCH_TIMEOUT_MS = 6000; // 6 秒 AbortController（同 traTrain）
const MAX_RESULTS = 5; // 最多回 5 站（PRD F3）
const LOCATION_TTL_MS = 30 * 60 * 1000; // lastLocation 保留 30 分鐘（PRD F6）
const PENDING_TTL_MS = 3 * 60 * 1000; // pending 覆寫旗標 TTL（同 traChoice）

// ── 模組級快取（整份站點清單）────────────────────────────────────────
let cache = { ts: 0, list: null };

// ── per-user 最近位置（記憶體、TTL 30 分，PRD F6）───────────────────
const lastLocation = new Map(); // userId → { lat, lon, ts }

// ── per-user pending 覆寫狀態（AI 路徑，仿 traChoice）────────────────
const pending = new Map(); // userId → { kind: 'ask' } | { kind: 'result', list } （+ ts, fresh）

/**
 * 純函式：組合完整地址（依實測邊界案例定的規則）。
 * @param {object} r 原始站點紀錄（中文欄位）
 * @returns {string}
 */
function fullAddress(r) {
  const addr = String(r['地址'] || '').trim(); // trim 會去掉實測見到的全形尾空白
  const norm = addr.replace(/臺/g, '台'); // 實測有 1 筆地址用「臺南市」
  const city = String(r['縣市'] || '').trim();
  const dist = String(r['鄉鎮區'] || '').trim();
  if (city && norm.includes(city)) return addr; // 實測 4 筆地址已含縣市 → 原樣
  if (dist && norm.includes(dist)) return city + addr; // 實測 3 筆已含鄉鎮區 → 只補縣市
  return city + dist + addr; // 其餘 1,964 筆 → 縣市+鄉鎮區+地址
}

/**
 * 純函式：把中油原始站點陣列瘦身、過濾成 { name, addr, lat, lon } 陣列。
 * 過濾規則：只留營業中（'1'）、座標必須是台灣範圍內的 number。
 * @param {Array<object>} rawArray
 * @returns {Array<{name:string, addr:string, lat:number, lon:number}>}
 */
function slimStations(rawArray) {
  if (!Array.isArray(rawArray)) return [];
  const out = [];
  for (const r of rawArray) {
    if (!r || r['營業中'] !== '1') continue;
    const lat = r['緯度'];
    const lon = r['經度'];
    if (
      typeof lat !== 'number' ||
      typeof lon !== 'number' ||
      !(lat > 20 && lat < 27) ||
      !(lon > 117 && lon < 123)
    ) {
      continue;
    }
    out.push({
      name: String(r['站名']).trim(),
      addr: fullAddress(r),
      lat,
      lon,
    });
  }
  return out;
}

/**
 * 抓取中油站點清單（24h 快取＋6s 逾時＋stale 備援）。
 * 成功回瘦身後的陣列；完全無可用資料（含快取）時回 null。
 * @returns {Promise<Array|null>}
 */
async function fetchStationList() {
  const now = Date.now();
  if (cache.list && now - cache.ts < CACHE_TTL_MS) {
    return cache.list;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const raw = await res.json();
    const list = slimStations(raw);
    if (!Array.isArray(raw) || list.length === 0) throw new Error('empty or invalid data');

    cache = { ts: now, list };
    return list;
  } catch (_e) {
    // 失敗路徑：有舊快取（即使過期）→ 用舊的；否則回 null
    if (cache.list) return cache.list;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 純函式：Haversine 公式算兩點距離（公里）。
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} 距離（公里）
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * 找出離指定座標最近的加油站（依距離升冪，最多 max 筆）。
 * 垃圾座標或資料源失敗時回 null（由上層輸出容錯訊息，不 crash）。
 * @param {number} lat
 * @param {number} lon
 * @param {number} [max]
 * @returns {Promise<Array<{name:string, addr:string, lat:number, lon:number, km:number}>|null>}
 */
async function findNearest(lat, lon, max = MAX_RESULTS) {
  if (
    typeof lat !== 'number' ||
    typeof lon !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return null;
  }

  const list = await fetchStationList();
  if (!list) return null;

  const withDist = list
    .map((s) => ({ ...s, km: haversineKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.km - b.km);

  return withDist.slice(0, Math.min(max, MAX_RESULTS));
}

/**
 * 純函式：把 findNearest 的結果陣列格式化成不含標題的條列字串。
 * @param {Array<{name:string, addr:string, lat:number, lon:number, km:number}>} list
 * @returns {string}
 */
function formatList(list) {
  return list
    .map((s, i) => {
      const distText =
        s.km < 1 ? `${Math.round(s.km * 1000)} 公尺` : `${s.km.toFixed(1)} 公里`;
      const mapUrl = `https://www.google.com/maps?q=${s.lat.toFixed(6)},${s.lon.toFixed(6)}`;
      return (
        `${i + 1}. ${s.name}（${distText}）\n` +
        `   ${s.addr}\n` +
        `   ${mapUrl}`
      );
    })
    .join('\n');
}

/**
 * 記錄使用者最近分享的位置（僅記憶體，PRD F6）。
 * @param {string} userId
 * @param {number} lat
 * @param {number} lon
 */
function noteLocation(userId, lat, lon) {
  lastLocation.set(userId, { lat, lon, ts: Date.now() });
}

/**
 * 讀取使用者最近分享的位置（含 TTL 惰性過期，30 分鐘）。
 * @param {string} userId
 * @returns {{lat:number, lon:number, ts:number}|null}
 */
function getLocation(userId) {
  const p = lastLocation.get(userId);
  if (!p) return null;
  if (Date.now() - p.ts > LOCATION_TTL_MS) {
    lastLocation.delete(userId);
    return null;
  }
  return p;
}

/**
 * 記錄一筆 pending 覆寫狀態（AI 路徑用，一次性消費）。
 * @param {string} userId
 * @param {{kind:'ask'}|{kind:'result', list:Array}} record
 */
function setPending(userId, record) {
  record.ts = Date.now();
  record.fresh = true;
  pending.set(userId, record);
}

/**
 * 一次性消費該使用者的 pending（含 TTL 惰性過期）；沒有或已過期回 null。
 * @param {string} userId
 * @returns {object|null}
 */
function consumePending(userId) {
  const p = pending.get(userId);
  if (!p) return null;
  if (Date.now() - p.ts > PENDING_TTL_MS) {
    pending.delete(userId);
    return null;
  }
  if (!p.fresh) return null;
  p.fresh = false;
  pending.delete(userId); // 用完即清（不需要事後 matchCandidate，直接刪）
  return p;
}

// ── 匯出 ──────────────────────────────────────────────────────────────
module.exports = {
  findNearest,
  formatList,
  haversineKm, // 查詢＋純函式
  noteLocation,
  getLocation, // lastLocation（F6）
  setPending,
  consumePending, // AI 路徑覆寫機制
  slimStations,
  fullAddress, // 純函式（離線測試用）
  MAX_RESULTS,
  LOCATION_TTL_MS,
};

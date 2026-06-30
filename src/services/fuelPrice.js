// 油價查詢服務：使用台灣中油官方 WebService 端點（免金鑰）。
//   端點：https://vipmbr.cpc.com.tw/CPCSTN/ListPriceWebService.asmx/getCPCMainProdListPrice
//   回傳 XML，以純字串／正則解析（比照 invoice.js 手法，不引入 XML 套件）。
//   資料每週一 08:00 更新，快取 4 小時；逾時 8 秒。
//
// 對外匯出：lookup（中文指令用）、usage（使用說明）、getFuelPriceSummary（AI 工具用）、PRODUCTS

// ── 常數（單一真實來源）────────────────────────────────────────────────
const ENDPOINT =
  'https://vipmbr.cpc.com.tw/CPCSTN/ListPriceWebService.asmx/getCPCMainProdListPrice';
const SOURCE          = '台灣中油';
const CACHE_TTL_MS    = 4 * 60 * 60 * 1000;  // 4 小時
const FETCH_TIMEOUT_MS = 8000;                // 8 秒（PRD §4.1）

// ── 油品對應表（單一真實來源）────────────────────────────────────────
// key  = 內部代碼；cpcName = 來源 XML 的「產品名稱」欄位（精確比對，避免誤抓工業油品）
const PRODUCTS = {
  UNLEADED_92:  { cpcName: '92無鉛汽油', labelZh: '92 無鉛汽油', labelEn: 'Unleaded 92',  order: 1 },
  UNLEADED_95:  { cpcName: '95無鉛汽油', labelZh: '95 無鉛汽油', labelEn: 'Unleaded 95',  order: 2 },
  UNLEADED_98:  { cpcName: '98無鉛汽油', labelZh: '98 無鉛汽油', labelEn: 'Unleaded 98',  order: 3 },
  SUPER_DIESEL: { cpcName: '超級柴油',   labelZh: '超級柴油',    labelEn: 'Super Diesel', order: 4 },
};

// 使用者輸入別稱／號數 → 內部代碼（供 handler 與 AI 工具共用，呼應 PRD §5.1）
const ALIAS = {
  '92':     'UNLEADED_92',
  '92無鉛': 'UNLEADED_92',
  '九二':   'UNLEADED_92',
  '95':     'UNLEADED_95',
  '95無鉛': 'UNLEADED_95',
  '九五':   'UNLEADED_95',
  '98':     'UNLEADED_98',
  '98無鉛': 'UNLEADED_98',
  '九八':   'UNLEADED_98',
  '柴油':   'SUPER_DIESEL',
  '超柴':   'SUPER_DIESEL',
  '超級柴油': 'SUPER_DIESEL',
};

// ── 記憶體快取（整包四油品為單一 key）──────────────────────────────────
let cache = { data: null, ts: 0 };

// ── 內部輔助函式 ──────────────────────────────────────────────────────

/**
 * 把使用者輸入（中文別稱 / 號數 / 內部代碼）正規化為內部代碼。
 * 找不到回 null（由上層輸出「不支援油品」訊息，對應 AC-12）。
 * @param {string|undefined} input
 * @returns {string|null}
 */
function normalizeProduct(input) {
  if (!input) return null;
  const t = input.trim();
  // 直接是內部代碼（AI 工具給的）
  if (PRODUCTS[t]) return t;
  // 中文別稱
  if (ALIAS[t]) return ALIAS[t];
  return null;
}

/**
 * 純函式：把中油 XML 字串解析成四個目標油品的 Map。
 * 只取 PRODUCTS 裡精確命中 cpcName 的筆，排除工業油品（海運柴油、燃料油等）。
 * 可供離線 fixture 測試（不依賴 fetch）。
 *
 * @param {string} xmlText  XML 全文字串
 * @returns {{ prices: Object, effectiveDate: string }|null}
 *   prices: { UNLEADED_92: number, ... }  effectiveDate: 'YYYY-MM-DD'
 *   解析不到任何目標油品時回 null。
 */
function parsePrices(xmlText) {
  // 切出所有 <tbTable …>…</tbTable> 區塊
  const blocks = xmlText.match(/<tbTable[^>]*>[\s\S]*?<\/tbTable>/g) || [];

  const prices = {};
  let effectiveDate = '';

  // 建立 cpcName → 內部代碼 的反向查找
  const cpcNameToCode = {};
  for (const [code, meta] of Object.entries(PRODUCTS)) {
    cpcNameToCode[meta.cpcName] = code;
  }

  for (const block of blocks) {
    // 取「產品名稱」欄位（精確比對，不做模糊比對）
    const nameMatch = block.match(/<產品名稱>([\s\S]*?)<\/產品名稱>/);
    if (!nameMatch) continue;
    const cpcName = nameMatch[1].trim();

    const code = cpcNameToCode[cpcName];
    if (!code) continue;  // 不在白名單（工業油品等）→ 跳過

    // 取「參考牌價」
    const priceMatch = block.match(/<參考牌價>([\s\S]*?)<\/參考牌價>/);
    if (!priceMatch) continue;
    const price = Number(priceMatch[1].trim());
    if (isNaN(price) || price <= 0) continue;

    // 取「牌價生效時間」，取前 10 字為 YYYY-MM-DD
    const dateMatch = block.match(/<牌價生效時間>([\s\S]*?)<\/牌價生效時間>/);
    if (!dateMatch) continue;
    const dateStr = dateMatch[1].trim().slice(0, 10);

    prices[code] = parseFloat(price.toFixed(1));

    // 取汽油類生效日（四項通常相同，以 UNLEADED_92 為準；保險起見取第一個遇到的）
    if (!effectiveDate && dateStr.length === 10) {
      effectiveDate = dateStr;
    }
  }

  // 至少要取到一個目標油品才算成功（嚴格驗證）
  if (Object.keys(prices).length === 0) return null;

  return { prices, effectiveDate };
}

/**
 * 抓取中油 XML 並解析，有快取（4h）與 AbortController 逾時（8s）。
 * 成功回 { ok:true, prices, effectiveDate, source }；失敗回 { ok:false }。
 * @returns {Promise<{ok:boolean, prices?:Object, effectiveDate?:string, source?:string}>}
 */
async function fetchPrices() {
  // 快取命中
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_TTL_MS) {
    return { ok: true, ...cache.data, source: SOURCE };
  }

  // AbortController 逾時
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT, { signal: controller.signal });
    if (!res.ok) return { ok: false };

    const xml = await res.text();
    const parsed = parsePrices(xml);
    if (!parsed) return { ok: false };

    // 存快取
    cache = { data: parsed, ts: now };

    return { ok: true, ...parsed, source: SOURCE };
  } catch (_e) {
    // AbortError（逾時）、連線失敗等一律視為取不到
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

// ── 對外函式 ──────────────────────────────────────────────────────────

/**
 * 查詢油價並回傳已格式化的中文字串（供 handler.js 指令路由）。
 * 無參數 → 回全部四種；有參數 → 先正規化，找不到回不支援訊息（AC-12）。
 * 取不到資料 → 回友善訊息（AC-09 / AC-11）。
 *
 * @param {string} [product]  油品別稱／號數／內部代碼（選填）
 * @returns {Promise<string>}
 */
async function lookup(product) {
  // 有傳參數時先正規化
  let code = null;
  if (product) {
    code = normalizeProduct(product);
    if (!code) {
      return '不支援的油品，請輸入 92／95／98／柴油';
    }
  }

  let result;
  try {
    result = await fetchPrices();
  } catch (_e) {
    return '目前無法取得油價資料，請稍後再試 🙏';
  }

  if (!result.ok) {
    return '目前無法取得油價資料，請稍後再試 🙏';
  }

  const { prices, effectiveDate } = result;

  // 單一油品回覆（對應 PRD §5.4）
  if (code) {
    const meta = PRODUCTS[code];
    const price = prices[code];
    if (price === undefined) {
      return '目前無法取得油價資料，請稍後再試 🙏';
    }
    return (
      `⛽ ${meta.labelZh}：${price.toFixed(1)} 元/公升\n` +
      `生效日：${effectiveDate}（週一）\n\n` +
      `資料來源：${SOURCE}（每週一調整）`
    );
  }

  // 全部四種回覆（依 order 排序）
  const sorted = Object.entries(PRODUCTS).sort(([, a], [, b]) => a.order - b.order);
  const lines = sorted
    .map(([c, meta]) => {
      const p = prices[c];
      if (p === undefined) return null;
      // 超級柴油顯示名較短，補空白對齊（仿 DESIGN 樣式）
      const pad = meta.labelZh.length < 6 ? '　' : '';
      return `・${meta.labelZh}${pad}　${p.toFixed(1)} 元/公升`;
    })
    .filter(Boolean);

  return (
    `⛽ ${SOURCE}本週油價\n` +
    `生效日：${effectiveDate}（週一）\n\n` +
    lines.join('\n') + '\n\n' +
    `資料來源：${SOURCE}（每週一調整）`
  );
}

/**
 * 油價查詢使用說明子選單（同步，對應 AC-05）。
 * @returns {string}
 */
function usage() {
  return (
    '⛽ 油價查詢可以這樣問：\n' +
    '・油價（查全部四種）\n' +
    '・92油價 / 95油價 / 98油價 / 柴油油價\n' +
    '・今天油價 / 本週油價\n' +
    `資料來源：${SOURCE}（每週一調整）`
  );
}

/**
 * 查詢油價並回傳英文純文字摘要（供 AI 工具呼叫後讓模型用使用者語言改寫）。
 * 取不到資料時回 null；油品不支援時回英文字串（讓模型轉述）。
 *
 * @param {string} [product]  油品代碼（選填，AI 工具給的內部代碼或別稱）
 * @returns {Promise<string|null>}
 */
async function getFuelPriceSummary(product) {
  // 有傳 product 時先正規化
  let code = null;
  if (product) {
    code = normalizeProduct(product);
    if (!code) {
      return `Unsupported product. Available: Unleaded 92/95/98, Super Diesel.`;
    }
  }

  let result;
  try {
    result = await fetchPrices();
  } catch (_e) {
    return null;
  }

  if (!result.ok) return null;

  const { prices, effectiveDate } = result;

  // 單一油品摘要
  if (code) {
    const meta = PRODUCTS[code];
    const price = prices[code];
    if (price === undefined) return null;
    return (
      `Taiwan CPC fuel price effective ${effectiveDate}: ${meta.labelEn} ${price.toFixed(1)} NTD/L.\n` +
      `Source: Taiwan CPC (updated weekly on Monday). Reference prices only.`
    );
  }

  // 全部四種摘要（依 order 排序）
  const sorted = Object.entries(PRODUCTS).sort(([, a], [, b]) => a.order - b.order);
  const parts = sorted
    .map(([c, meta]) => {
      const p = prices[c];
      return p !== undefined ? `${meta.labelEn}: ${p.toFixed(1)} NTD/L` : null;
    })
    .filter(Boolean);

  return (
    `Taiwan CPC fuel prices effective ${effectiveDate}:\n` +
    parts.join('; ') + '.\n' +
    `Source: Taiwan CPC (updated weekly on Monday). Reference prices only.`
  );
}

// ── 匯出 ──────────────────────────────────────────────────────────────
module.exports = { lookup, usage, getFuelPriceSummary, PRODUCTS };

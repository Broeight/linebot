// 匯率查詢服務：使用 ExchangeRate-API 開放端點（免金鑰、含 VND）。
//   端點：https://open.er-api.com/v6/latest/{BASE}
//   每日更新一次，屬「參考匯率」而非即時報價。
//
// 對外匯出：lookup（中文指令用）、getExchangeSummary（AI 工具用）、
//           CURRENCY_NAMES（中文名稱映射）、SUPPORTED（支援代碼列表）

// ── 幣別表（單一真實來源）────────────────────────────────────────────
// 支援的幣別代碼（固定 7 種，不動態新增）
const SUPPORTED = ['TWD', 'VND', 'USD', 'JPY', 'CNY', 'EUR', 'KRW'];

// 中文幣別名稱 → 三碼代碼
const CURRENCY_NAMES = {
  台幣: 'TWD',
  新台幣: 'TWD',
  越南盾: 'VND',
  越幣: 'VND',
  美元: 'USD',
  美金: 'USD',
  日圓: 'JPY',
  日幣: 'JPY',
  人民幣: 'CNY',
  歐元: 'EUR',
  韓圓: 'KRW',
  韓幣: 'KRW',
};

// 代碼 → 中文顯示名（用於美化回覆）
const CURRENCY_LABEL = {
  TWD: '新台幣',
  VND: '越南盾',
  USD: '美元',
  JPY: '日圓',
  CNY: '人民幣',
  EUR: '歐元',
  KRW: '韓圓',
};

// ── 記憶體快取（以 base 幣別為 key，TTL 30 分鐘）──────────────────────
const cache = {};
const CACHE_TTL_MS = 30 * 60 * 1000;

// ── 內部函式 ──────────────────────────────────────────────────────────

/**
 * 把使用者輸入（中文名稱或代碼）正規化為三碼代碼。
 * 找不到回 null（由上層輸出「不支援幣別」訊息）。
 * @param {string} input
 * @returns {string|null}
 */
function normalizeCurrency(input) {
  if (!input) return null;
  const trimmed = input.trim();
  // 1. 先比中文名稱映射
  if (CURRENCY_NAMES[trimmed]) return CURRENCY_NAMES[trimmed];
  // 2. 再比大小寫不敏感的代碼（呼應 PRD 6.6）
  const upper = trimmed.toUpperCase();
  if (SUPPORTED.includes(upper)) return upper;
  return null;
}

/**
 * 從 open.er-api.com 抓取匯率，有 5 秒逾時。
 * 記憶體快取 30 分鐘以減少外部請求。
 * @param {string} from 已正規化的代碼
 * @param {string} to   已正規化的代碼
 * @returns {Promise<{ok:true,rate:number,updated:string,source:string}|{ok:false}>}
 */
async function getRate(from, to) {
  // 檢查快取
  const cacheKey = from;
  const now = Date.now();
  if (cache[cacheKey] && now - cache[cacheKey].ts < CACHE_TTL_MS) {
    const cachedRates = cache[cacheKey].rates;
    if (typeof cachedRates[to] === 'number') {
      return {
        ok: true,
        rate: cachedRates[to],
        updated: cache[cacheKey].updated,
        source: 'ExchangeRate-API',
      };
    }
  }

  // 5 秒逾時
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const url = `https://open.er-api.com/v6/latest/${from}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false };

    const data = await res.json();
    if (data.result !== 'success') return { ok: false };
    if (typeof data.rates[to] !== 'number') return { ok: false };

    // 更新時間：取 UTC 日期字串（YYYY-MM-DD）
    const updatedRaw = data.time_last_update_utc || '';
    const updated = updatedRaw ? new Date(updatedRaw).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

    // 存快取（整包 rates 都存，方便後續同一 base 的查詢）
    cache[cacheKey] = { rates: data.rates, updated, ts: now };

    return { ok: true, rate: data.rates[to], updated, source: 'ExchangeRate-API' };
  } catch (_e) {
    // 逾時（AbortError）或其他網路錯誤都視為「取不到匯率」
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 格式化匯率數字：大數字（>= 100）保留 1 位小數；小數字（< 1）保留最多 6 位有效位。
 * @param {number} rate
 * @returns {string}
 */
function formatRate(rate) {
  if (rate >= 100) return rate.toFixed(1);
  if (rate >= 1) return parseFloat(rate.toFixed(4)).toString();
  // 小於 1 時，取最多 6 位有效位
  return parseFloat(rate.toPrecision(6)).toString();
}

/**
 * 格式化金額（加千分位）。
 * @param {number} n
 * @returns {string}
 */
function formatAmount(n) {
  return n.toLocaleString('en-US');
}

// ── 對外函式 ──────────────────────────────────────────────────────────

/**
 * 解析使用者輸入的參數字串，查詢匯率並回傳已格式化的中文回覆（供 handler.js 指令路由）。
 * 支援格式：
 *   "TWD VND"、"台幣 越南盾"、"USD"（預設對 TWD）
 *   "5000 台幣換越南盾"、"5000 TWD VND"、"換算 5000 TWD VND"
 * @param {string} argText 指令關鍵字後的字串（或帶金額的整句）
 * @returns {Promise<string>}
 */
async function lookup(argText) {
  if (!argText || !argText.trim()) {
    return '格式：匯率 TWD VND，或「5000 台幣換越南盾」';
  }

  // ── 解析 amount、from、to ──────────────────────────────────────────
  let amount = null;
  let fromCode = null;
  let toCode = null;

  // 先嘗試抽出開頭的數字（含千分位逗號）
  const amountMatch = argText.match(/^([\d,]+)\s*(.*)/);
  let rest = argText.trim();
  if (amountMatch) {
    const rawNum = amountMatch[1].replace(/,/g, '');
    const parsed = parseFloat(rawNum);
    if (!isNaN(parsed)) {
      amount = parsed;
      rest = amountMatch[2].trim();
    }
  }

  // 用「空白」或「換」字切詞，逐 token 嘗試解析幣別
  // 先把「換」當分隔字元替換成空白再切
  const tokens = rest.replace(/換/g, ' ').split(/\s+/).filter(Boolean);

  const currencies = [];
  for (const token of tokens) {
    const code = normalizeCurrency(token);
    if (code) currencies.push(code);
    // 非幣別 token（如「換」殘留）就略過
  }

  if (currencies.length === 0) {
    return '格式：匯率 TWD VND，或「5000 台幣換越南盾」\n支援：TWD VND USD JPY CNY EUR KRW';
  }

  if (currencies.length === 1) {
    // 只給一個幣別 X → 查「1 X = ? TWD」（PRD AC-03：預設基準 TWD）
    fromCode = currencies[0];
    toCode = 'TWD';
    // 若 X 本身就是 TWD，換為 USD（避免 TWD→TWD 無意義）
    if (fromCode === 'TWD') {
      toCode = 'USD';
    }
  } else {
    fromCode = currencies[0];
    toCode = currencies[1];
  }

  // 防呆：找不到有效幣別名稱時給出不支援訊息
  // （normalizeCurrency 已處理，但保留以下針對「原始輸入無法識別」的額外提示）
  const supported = SUPPORTED.join(' ');

  // 額外：如果 rest 裡有不可識別的 token，提示不支援
  const unknownTokens = tokens.filter((t) => !normalizeCurrency(t) && t.length > 0);
  if (unknownTokens.length > 0 && currencies.length < 2) {
    return (
      `不支援的幣別「${unknownTokens[0]}」\n` +
      `目前支援：${supported}`
    );
  }

  // ── 查詢匯率 ──────────────────────────────────────────────────────
  const result = await getRate(fromCode, toCode);
  if (!result.ok) {
    return '目前無法取得匯率，請稍後再試 🙏';
  }

  const { rate, updated, source } = result;
  const rateStr = formatRate(rate);

  let msg =
    `💱 匯率查詢\n` +
    `${fromCode} → ${toCode}\n` +
    `1 ${fromCode} = ${rateStr} ${toCode}`;

  if (amount !== null) {
    const converted = amount * rate;
    const amtFmt = formatAmount(amount);
    // 換算結果：整數幣別（VND、JPY、KRW）四捨五入；其他保留 2 位小數
    const needRound = ['VND', 'JPY', 'KRW'].includes(toCode);
    const convertedFmt = needRound
      ? formatAmount(Math.round(converted))
      : formatAmount(parseFloat(converted.toFixed(2)));
    msg += `\n\n💡 換算：${amtFmt} ${fromCode} ≈ ${convertedFmt} ${toCode}`;
  }

  msg +=
    `\n\n資料來源：${source}（每日更新）\n` +
    `更新時間：${updated}\n` +
    `以上為參考匯率，實際依各銀行為準。`;

  return msg;
}

/**
 * 查詢匯率並回傳英文純文字摘要（供 AI 工具呼叫後讓模型用使用者語言改寫）。
 * 取不到匯率時回 null；幣別不支援時回英文錯誤字串。
 * @param {string} from  來源幣別代碼（模型可能給小寫）
 * @param {string} to    目標幣別代碼
 * @param {number} [amount] 選填：要換算的金額
 * @returns {Promise<string|null>}
 */
async function getExchangeSummary(from, to, amount) {
  const fromCode = normalizeCurrency(from);
  const toCode = normalizeCurrency(to);

  if (!fromCode || !toCode) {
    const bad = !fromCode ? from : to;
    return `Unsupported currency "${bad}". Supported: ${SUPPORTED.join(', ')}.`;
  }

  const result = await getRate(fromCode, toCode);
  if (!result.ok) return null;

  const { rate, updated, source } = result;
  const rateStr = formatRate(rate);

  let summary = `1 ${fromCode} = ${rateStr} ${toCode}.`;

  if (typeof amount === 'number' && !isNaN(amount)) {
    const converted = amount * rate;
    const needRound = ['VND', 'JPY', 'KRW'].includes(toCode);
    const convertedFmt = needRound
      ? formatAmount(Math.round(converted))
      : formatAmount(parseFloat(converted.toFixed(2)));
    summary += ` Amount: ${formatAmount(amount)} ${fromCode} = ${convertedFmt} ${toCode}.`;
  }

  summary += ` Source: ${source} (daily). Updated: ${updated}. Reference rate only; actual bank rates may vary.`;

  return summary;
}

module.exports = { lookup, getExchangeSummary, CURRENCY_NAMES, SUPPORTED };

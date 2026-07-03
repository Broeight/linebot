// 聯網搜尋服務：主用 Groq 內建聯網模型（groq/compound-mini，同一把 GROQ_API_KEY），
// 失敗（413/429/逾時/斷網）時後備 DuckDuckGo Lite 免金鑰端點，都失敗回 null。
// 詳細實測依據見 docs/loop/web-search/DESIGN.md。
const Groq = require('groq-sdk');
const { config } = require('../config');

const groq = new Groq({ apiKey: config.groq.apiKey });

// ── 常數（單一真實來源）────────────────────────────────────────────────
const COMPOUND_MODEL      = 'groq/compound-mini';
const COMPOUND_TIMEOUT_MS = 10000;  // PRD F2：8–10s，取 10s
const DDG_ENDPOINT        = 'https://lite.duckduckgo.com/lite/?q=';
const DDG_TIMEOUT_MS      = 8000;
const CACHE_TTL_MS        = 10 * 60 * 1000;  // 10 分鐘
const CACHE_MAX           = 50;              // 上限 50 條，防 RAM 無限長
const MAX_RESULT_CHARS    = 2000;            // 回給模型的摘要上限（保護外層模型 context/TPM）
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// 強制 compound 一定去搜（實測：不強制時它會用內建知識答、甚至以知識截止為由拒答）
const SEARCH_SYSTEM =
  'You are a web search assistant. You MUST use your web search tool for EVERY query ' +
  'before answering. Never answer from memory alone and never refuse because of a ' +
  'knowledge cutoff — search instead. Summarize what the search results say, concisely ' +
  '(under 120 words), in the same language as the query. End with 2-3 source lines in ' +
  'the format "- title — URL".';

// 測試計數（驗收 1 用）：各路徑實際執行次數
const stats = { compound: 0, ddg: 0, cacheHits: 0 };

// ── 快取（Map，插入序 = 淘汰序）──────────────────────────────────────
const cache = new Map(); // key → { text, ts }

function cacheKey(query) {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

// 常見 HTML 實體解碼（只處理 DDG lite 頁面會出現的五種，不引入套件）
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
}

/**
 * 主用：呼叫 Groq 內建聯網模型（groq/compound-mini）搜尋並摘要。
 * 任何錯誤（413/429/逾時/斷網）都不重試，直接回 null，交由後備路徑處理。
 * @param {string} query
 * @returns {Promise<string|null>}
 */
async function searchViaCompound(query) {
  try {
    const resp = await groq.chat.completions.create(
      {
        model: COMPOUND_MODEL,
        max_tokens: 600,
        temperature: 0.3,
        messages: [
          { role: 'system', content: SEARCH_SYSTEM },
          { role: 'user', content: 'Search the web and answer: ' + query },
        ],
      },
      { timeout: COMPOUND_TIMEOUT_MS, maxRetries: 0 } // maxRetries:0 必須（DESIGN §1.4）
    );

    const msg = resp.choices?.[0]?.message;
    let text = (msg?.content || '').trim();
    if (!text) return null;

    // 補來源：模型沒把 URL 寫進內文時，從 executed_tools 的搜尋結果補上前 3 筆
    if (!/https?:\/\//.test(text)) {
      const results = msg?.executed_tools?.[0]?.search_results?.results || [];
      for (const r of results.slice(0, 3)) {
        if (r?.url) text += `\n- ${r.title || r.url} — ${r.url}`;
      }
    }

    return text;
  } catch (e) {
    console.error('webSearch compound 失敗：', e.status || '', e.message);
    return null; // 不在這層重試，交由呼叫端走後備
  }
}

/**
 * 後備：DuckDuckGo Lite（免金鑰）擷取搜尋結果，組成純文字摘要。
 * 解析不到結果（含被擋回 anomaly 頁）或任何例外一律回 null。
 * @param {string} query
 * @returns {Promise<string|null>}
 */
async function searchViaDdg(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DDG_TIMEOUT_MS);

  try {
    const res = await fetch(DDG_ENDPOINT + encodeURIComponent(query), {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const body = await res.text();

    const anchors = [...body.matchAll(/<a[^>]*href="([^"]*uddg=[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    const snippets = [...body.matchAll(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g)].map(
      (m) => decodeEntities(m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    );

    const items = [];
    for (const a of anchors) {
      const uddgMatch = a[1].match(/uddg=([^&]+)/);
      if (!uddgMatch) continue;
      const url = decodeURIComponent(uddgMatch[1]);
      const title = decodeEntities(a[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
      if (!title || !url) continue;
      items.push({ title, url });
      if (items.length >= 5) break;
    }

    if (items.length === 0) return null;

    const lines = [`Web search results for "${query}" (source: DuckDuckGo):`];
    items.forEach((item, i) => {
      lines.push(`${i + 1}. ${item.title}`);
      lines.push(`   ${item.url}`);
      const snippet = snippets[i];
      if (snippet) lines.push(`   ${snippet.slice(0, 150)}`);
    });

    return lines.join('\n');
  } catch (e) {
    console.error('webSearch DDG 失敗：', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 對外函式：搜尋並回傳純文字摘要（含來源網址）。
 * 主用 compound → 失敗後備 DDG → 都失敗回 null。快取相同 query 10 分鐘。絕不 throw。
 * @param {string} query
 * @returns {Promise<string|null>}
 */
async function search(query) {
  try {
    if (!query || !String(query).trim()) return null;
    const q = String(query).trim();

    const key = cacheKey(q);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
      stats.cacheHits++;
      return hit.text;
    }

    stats.compound++;
    let text = await searchViaCompound(q);
    if (!text) {
      stats.ddg++;
      text = await searchViaDdg(q);
    }
    if (!text) return null; // 失敗不寫快取（下一則訊息可再試）

    text = text.slice(0, MAX_RESULT_CHARS);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // 淘汰最舊
    cache.set(key, { text, ts: Date.now() });
    return text;
  } catch (_e) {
    return null; // 雙保險：search() 對外永不 throw
  }
}

module.exports = { search, stats };

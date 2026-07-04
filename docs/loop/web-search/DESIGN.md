# 技術設計：AI 回答前先上網收集資料（web-search）（DESIGN）

**版本** v1.0 | **日期** 2026-07-03 | **作者** 軟體架構師（RD#1）
**對應 PRD** `docs/loop/web-search/PRD.md`
**分支** `feat/web-grounded-answers`

---

## ✅ 需要金鑰：否（沿用 GROQ_API_KEY）

搜尋來源採用 **Groq 內建聯網模型 `groq/compound-mini`（主用）+ DuckDuckGo Lite 免金鑰端點（後備）**。
主用路徑走既有的 `GROQ_API_KEY`（免費方案實測可用）；後備路徑完全免金鑰。
本案**不新增任何 API 金鑰、環境變數、npm 套件**。

---

## 1. 實測結果（2026-07-03，架構師以 .env 真金鑰 + `node` 實測，非文件抄錄）

### 1.1 候選 A：Groq 聯網模型 — ✔ 免費方案可用，但有「重內容查詢必 413」的坑

**`groq.models.list()` 實測**：本帳號（免費方案）模型清單包含 **`groq/compound`** 與 **`groq/compound-mini`**
（無 compound-beta / compound-beta-mini 舊名）。兩者都接受呼叫、都支援 system prompt。

**實際回應形狀**（`choices[0].message`，重點欄位）：

```
message = {
  role: 'assistant',
  content: '…答案文字（受指示時會附「- 標題 — URL」來源行）…',
  reasoning: '…內部推理文字（很長，不用）…',
  executed_tools: [
    {
      type: 'search',
      arguments: '{"query": "Giá vàng hôm nay ở Việt Nam"}',
      output: 'Title: …\nURL: …\nContent: …',       // 原始搜尋輸出（字串）
      search_results: {
        results: [ { title: '…', url: 'https://…', content: '…', score: 0.88 }, … ]  // 7–10 筆
      }
    }
  ]
}
```

- **答案文字**在 `message.content`；**引用來源**在 `message.executed_tools[i].search_results.results[]`
  的 `title`/`url`（groq-sdk 1.3.0 的 `.d.ts` 亦定義此形狀：`resources/chat/completions.d.ts` 的
  `ChatCompletionMessage.ExecutedTool`）。
- **不是每次都會搜尋**：不強制時，compound-mini 對「台積電哪年成立」直接用內建知識答（`executed_tools` 為空、1.6s）；
  對「2026年7月 台灣 最近有什麼大新聞？」甚至**拒答說知識截止 2024/06 而不去搜**。
  → **必須用 system 指示強制搜尋**（見 §3.1 的 `SEARCH_SYSTEM`，實測有效）。

**延遲實測（成功案例）**：

| 查詢 | 有搜尋？ | 延遲 | total_tokens |
|---|---|---|---|
| 今天日期＋台灣新聞（英文） | ✔ 1 次 search | 5,957 ms | 3,613 |
| 台積電哪年成立（中文） | ✘（用知識答） | 1,585 ms | 808 |
| Giá vàng hôm nay ở Việt Nam（越南語） | ✔ | 7,138 ms | 7,433 |
| 普拿疼和布洛芬可以一起吃嗎（中文，強制搜尋） | ✔ | 6,961 ms | 7,665 |
| When was TSMC founded?（`groq/compound` 全量版） | ✔ | 5,385 ms | 10,089 |

→ **有搜尋時約 5.4–7.1 秒**；設計逾時取 **10 秒**。

**免費方案限流（回應標頭實測）**：

- `x-ratelimit-limit-requests = 250`，且 `x-ratelimit-reset-requests` 每打一次增加 5m45.6s（= 86400s ÷ 250）
  → **每個 compound 模型各 250 次／天**（compound 與 compound-mini 各自獨立計數）。家庭用量綽綽有餘。
- `x-ratelimit-limit-tokens = 70000`（compound 層）。**但底層模型另有自己的 TPM**：實測連兩次搜尋間隔 <1 分鐘時
  回 **429**，錯誤訊息點名 `openai/gpt-oss-120b` TPM 上限 8000（compound-mini 內部用它作答）。
  → 同一分鐘內連續搜尋會 429，必須有後備與快取。

**⚠ 關鍵坑：deterministic 413 `request_too_large`**。
「2026年7月 台灣 最近有什麼大新聞？」這類**搜尋結果內容很肥**的查詢，compound-mini **5 連測全部 413**
（3.6–9.7s 後失敗）；`groq/compound` 全量版同樣 413；加 `compound_custom.tools.enabled_tools=['web_search']`
（禁用內部瀏覽工具）**也無效**。原因：Groq 把搜到的內容塞進底層模型的 prompt，免費方案底層模型的
最大請求量（約 8k tokens 級）被撐爆。**這正是 PRD 驗收 3 的旗艦題型** → 必須有候選 B 當後備。

### 1.2 候選 B：DuckDuckGo 免金鑰端點 — ✔ Lite 版可用（採用為後備）

| 端點 | 實測結果 |
|---|---|
| `https://lite.duckduckgo.com/lite/?q=…` | **✔ 採用**。200、0.7–1.3s、每次 10 筆。中文查詢 OK（「2026年7月 台灣 新聞」回中央社/三立/TVBS 等即時新聞）。頁內**所有** `<a>` 都是結果連結（實測恰 10 個 anchor = 10 筆結果），href 形如 `//duckduckgo.com/l/?uddg=<URL編碼後的真實網址>&rut=…`，摘要在 `class='result-snippet'` 的 `<td>` 內 |
| `https://html.duckduckgo.com/html/?q=…` | ✔ 也可用（結果在 `class="result__a"`），但頁面較肥（35KB vs 23KB），**不採用**（只留 lite 一條路，維持簡單） |
| `https://api.duckduckgo.com/?q=…&format=json`（Instant Answer） | **✘ 無用**。連 `q=Taiwan` 都回空 Abstract、空 RelatedTopics（1,252 bytes 空殼）。一般查詢覆蓋率為零，**不納入**任何 fallback |

風險（無法在本機驗證）：Render 資料中心 IP 可能被 DDG 擋（回 anomaly/challenge 頁）。
→ 解析不到結果一律回 null，不影響主用路徑（compound 走 Groq API，任何 IP 都通）。

### 1.3 端到端模擬（外層 `llama-3.3-70b-versatile` + 本設計的工具定義與提示詞，真實呼叫）

| 使用者輸入 | web_search 呼叫數 | 結果 |
|---|---|---|
| 2026年7月 台灣 最近有什麼大新聞？ | **1** | 根據搜尋摘要作答＋「來源：cna.com.tw、money.udn.com、udn.com」 |
| Tháng 7/2026 Đài Loan có tin gì lớn không? | **1** | 以越南語作答＋來源行 |
| 你好 | **0** | 正常打招呼 |
| 講個笑話 | **0** | 正常說笑話 |
| 翻譯成越南語：謝謝你的幫忙 | **0** | 直接翻譯 |

注意：兩題新聞題的工具呼叫**都是走 `tool_use_failed` 400 的救回路徑**成功的
（模型吐 `<function=web_search{...}` 格式錯誤 → `ai.js` 既有的 `parseFailedToolCalls` 救回）。
**既有救回機制不可動**，它是 web_search 實際可用的前提之一。

### 1.4 groq-sdk（1.3.0）請求選項驗證

`node_modules/groq-sdk/internal/request-options.d.ts` 的 `RequestOptions` 明確含：
`timeout?: number`（毫秒）、`maxRetries?: number`（**預設 2**）、`signal?: AbortSignal`。
用法：`groq.chat.completions.create(body, { timeout: 10000, maxRetries: 0 })`。

**必須傳 `maxRetries: 0`**：SDK 預設對 429／連線逾時自動重試 2 次（429 還會遵守 retry-after 等待），
會把單次搜尋拖到 30 秒以上；我們自己有後備鏈，不要 SDK 重試。413/400 SDK 不重試（實測 3.6–9.7s 直接回錯）。

---

## 2. 架構決策

**主用 `groq/compound-mini` → 失敗（413/429/逾時/任何錯誤）→ 後備 DuckDuckGo Lite → 都失敗 → null（fallback chain，不 fail-to-null-only）**

理由（對照 PRD F1 的評估軸）：

1. **Render 可達性**：compound 走 Groq 官方 API，IP 無關，已在 production 驗證同把金鑰可用——當主用最穩。
   DDG 從 Render 的可達性無法在本機驗證，只適合當後備（掛了也只是少一層）。
2. **零新增金鑰**：兩者皆零金鑰新增，符合 PRD 目標 3。
3. **新鮮度／品質**：compound 搜尋＋閱讀＋摘要一次完成、附真實來源 URL；DDG 只有標題＋摘要片段，
   但外層模型（llama-3.3-70b）足以據此作答（§1.3 已驗證：canned digest 也能引用出正確來源行）。
4. **延遲**：compound 成功 5–7s；旗艦新聞題會固定走「compound 413（3–10s）→ DDG（約 1s）」共 5–11s，
   加最後一輪模型作答仍在 LINE reply token 有效期（約 1 分鐘）內，可接受。
5. **兩條路徑失效模式互補**：compound 的 413/429 由 DDG 補；DDG 若被 Render IP 擋，多數查詢仍由 compound 服務。
6. 為何不用 `groq/compound`（全量版）：同樣 413、單次 token 用量更高（10k），無額外好處。

不選 Tavily 等需註冊方案（PRD 定位為最後手段，現況用不到）。

---

## 3. 檔案變更清單（coder 照抄，不要再自行決策）

### 3.1 新增 `src/services/webSearch.js`

對外匯出：`search(query)` → `Promise<string|null>`；`stats`（測試計數用）。**絕不 throw。**
比照 `fuelPrice.js` house style（常數區、內部函式、對外函式、模組尾 exports、繁中註解）。

```js
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
```

**內部函式 1：`searchViaCompound(query)` → string|null**

- 呼叫：

  ```js
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
    { timeout: COMPOUND_TIMEOUT_MS, maxRetries: 0 }   // maxRetries:0 必須（§1.4）
  );
  ```

- 取 `resp.choices?.[0]?.message`；`text = (msg?.content || '').trim()`；空 → 回 null。
- **補來源**：若 `!/https?:\/\//.test(text)`（模型沒把 URL 寫進內文），從
  `msg.executed_tools?.[]?.search_results?.results` 收集前 3 筆有 `url` 的，
  逐筆 append `\n- ${title || url} — ${url}`。
- `try/catch` 包全部：任何錯誤（413/429/逾時/斷網）→ `console.error('webSearch compound 失敗：', e.status || '', e.message)` 一行後回 null。**不要在這層重試。**

**內部函式 2：`searchViaDdg(query)` → string|null**

- `AbortController` + `setTimeout(DDG_TIMEOUT_MS)` 逾時（比照 `fuelPrice.js` `fetchPrices` 寫法，`finally clearTimeout`）。
- `fetch(DDG_ENDPOINT + encodeURIComponent(query), { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' }, signal })`。
- `!res.ok` → null；`body = await res.text()`。
- 解析（實測驗證過的正則，照抄）：

  ```js
  const anchors = [...body.matchAll(/<a[^>]*href="([^"]*uddg=[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...body.matchAll(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g)]
    .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()));
  ```

- 每筆：`uddg=([^&]+)` 抓出真實網址 → `decodeURIComponent`；標題 = anchor 內文去標籤＋`decodeEntities`。
  `decodeEntities` 為模組內小函式，只處理常見五種：`&amp;→&`、`&lt;→<`、`&gt;→>`、`&quot;→"`、`&#x27;/&#39;→'`。
- 取**前 5 筆**（title 與 url 皆非空才收），組成：

  ```
  Web search results for "<query>" (source: DuckDuckGo):
  1. <title>
     <url>
     <snippet，截 150 字>
  2. …
  ```

- 0 筆（含被擋回 anomaly 頁）→ null；任何例外 → `console.error` 一行後 null。

**對外函式：`search(query)`**

```js
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
    if (!text) return null;   // 失敗不寫快取（下一則訊息可再試）

    text = text.slice(0, MAX_RESULT_CHARS);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // 淘汰最舊
    cache.set(key, { text, ts: Date.now() });
    return text;
  } catch (_e) {
    return null;   // 雙保險：search() 對外永不 throw
  }
}

module.exports = { search, stats };
```

### 3.2 `src/tools.js`

**(a) 頂部 import**（放在 `gasStation` 之後）：

```js
const webSearch = require('./services/webSearch'); // 注意：整包引入、不可解構，測試需 monkeypatch webSearch.search
```

**（重要）不可寫成 `const { search } = require(...)`**——驗收 2/5 要用
`webSearch.search = async () => null` monkeypatch，解構會斷開引用。

**(b) `defs` 陣列末尾追加**（文字照抄，何時用/何時不用的措辭已於 §1.3 實測驗證）：

```js
{
  type: 'function',
  function: {
    name: 'web_search',
    description:
      '上網搜尋最新資訊並取得帶來源網址的摘要。當使用者詢問新聞、時事、最近發生的事、' +
      '價格行情、產品資訊、人物、醫藥資訊，或你不確定、可能已過時的事實時，先呼叫此工具再回答。' +
      '不要用於：閒聊、打招呼、創意寫作、翻譯，以及已有專屬工具的查詢' +
      '（天氣、台鐵、匯率、油價、台灣假日、加油站、發票對獎、提醒、記帳）。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜尋關鍵字或問題，直接用使用者原話的語言即可。' },
      },
      required: ['query'],
    },
  },
},
```

**(c) `run()` 的 switch 追加 case**（放在 `find_gas_station` 之後、`default` 之前）：

```js
case 'web_search': {
  const s = await webSearch.search(a.query);
  return s || 'search unavailable, answer from your knowledge and say so';
}
```

null 時回的字串**照抄 PRD 原文**（含 "unavailable"，滿足驗收 2）。

**(d) `timeContext()`**：在回傳字串末尾（`find_gas_station` 句之後）追加一句（照抄，已實測）：

```js
'若使用者用任何語言（含越南語）詢問新聞、時事、價格、產品、人物、醫藥，' +
  '或其他需要最新資訊、需要查證的事實問題，先呼叫 web_search 工具搜尋再回答；' +
  '閒聊、翻譯、創意內容不要搜尋。'
```

### 3.3 `src/ai.js` — SYSTEM_PROMPT 追加（其餘一字不動）

在「- 你有工具可用（…）」那一條**之後**、「- 回覆要簡潔扼要…」**之前**，插入三條（照抄，措辭已於 §1.3 實測驗證）：

```
- 遇到事實性、時效性的問題（新聞、時事、價格、產品、人物、醫藥、你不確定或可能已過時的知識），先呼叫 web_search 工具搜尋，再根據搜尋結果回答，答案以搜尋結果為準。
- 用搜尋結果回答時，在回覆最後用一行標註來源網域（例如「來源：cna.com.tw、reuters.com」），不要輸出完整網址。
- 搜尋結果的語言與使用者不同時，仍用使用者的語言回答。閒聊、打招呼、翻譯、創意寫作不需要搜尋。
```

既有規則（語言跟隨、簡潔、工具優先、誠實）全部保留；`chat()`／`complete()`／
`parseFailedToolCalls`／fallbackText 容錯**一行都不改**（§1.3：救回路徑是 web_search 可用的前提）。

### 3.4 `src/handler.js` — 每則訊息最多 1 次搜尋（決策：加計數器，不只靠 4 輪上限）

理由：底層 TPM 8000 實測「同分鐘第二次搜尋」高機率 429 白燒延遲與額度；`parallel_tool_calls:false`
下 4 輪上限理論上仍可燒 4 次。計數器天然以「每則訊息」為界（closure 每則重建），4 輪迴圈本身不動。

把第 324–329 行的 `ai.chat` 呼叫改成：

```js
let webSearchCalls = 0; // 每則訊息最多 1 次聯網搜尋（省額度、控延遲）
const reply = await ai.chat(history, {
  tools: tools.defs,
  runTool: (name, args) => {
    if (name === 'web_search' && ++webSearchCalls > 1) {
      return Promise.resolve(
        'Web search already used for this message; answer with the information you already have.'
      );
    }
    return tools.run(userId, name, args);
  },
  systemExtra: tools.timeContext(),
  fallbackText: lang.chatFallback(fallbackCode),
});
```

（其餘 handler 邏輯、關鍵字路由、traChoice/gasStation pending 覆寫皆不動。）

### 3.5 不改的檔案

`src/config.js`（零新環境變數）、`src/services/*` 既有服務、`package.json`（零新套件）。

---

## 4. 延遲／額度 guardrails 與降級契約

| 防線 | 規格 |
|---|---|
| 每則訊息搜尋上限 | **1 次**（§3.4 計數器；第 2 次起回英文提示句，模型用已有資訊作答） |
| 工具迴圈 | 沿用既有 4 輪上限，不動 |
| 快取 | 同 query（trim＋壓空白＋小寫）10 分鐘內直接回快取；只快取成功結果；上限 50 條 |
| 逾時 | compound 10s（`{ timeout: 10000, maxRetries: 0 }`）；DDG 8s（AbortController）。最壞情況 compound 10s + DDG 8s ≈ 18s，加最後一輪作答仍遠在 LINE reply token 期限內 |
| SDK 重試 | **一律 `maxRetries: 0`**，否則 429 會被 SDK 自動等待重試拖爆延遲 |
| 摘要長度 | 回給模型的字串截 2000 字，保護外層模型 context/額度 |
| 額度 | compound-mini 250 次/天（實測），家庭用量安全；429/413 → 自動走 DDG（0 額度） |

**降級契約（驗收 5 的保證鏈）**：
`searchViaCompound` 錯誤→null → `searchViaDdg` 錯誤→null → `search()` 回 null（永不 throw）
→ `tools.run` 回 `'search unavailable, answer from your knowledge and say so'`
→ 模型據此用內建知識作答並註明可能不是最新 → 即使連外層 Groq 都掛，`ai.chat` 既有 catch 回 `fallbackText`。
**任何一層失敗都不會讓聊天崩潰。**

---

## 5. 測試策略（tester 對照 PRD 驗收 1–6）

repo 無測試框架：一律用獨立 node 腳本（放 scratchpad 或 `docs/loop/web-search/` 下臨時檔，跑完記入 TEST.md），
從 repo root 執行（`require('./src/...')`）。**工具呼叫計數法**：包住 runTool（與 §3.4 同構）：

```js
let calls = 0;
const countingRunTool = (name, args) => {
  if (name === 'web_search') calls++;
  return tools.run('test-uid', name, args);
};
```

| 驗收 | 測法（具體步驟） |
|---|---|
| **1. 搜尋服務** | (a) `require('./src/services/webSearch').search('台積電 是哪一年成立')` → 斷言非空字串且 `/https?:\/\//` 命中。(b) **快取**：同 query 連呼 2 次 → 斷言 `stats.cacheHits === 1` 且兩次回傳相同、`stats.compound` 沒 +2。(c) **斷網模擬**：**新開 node process，在 `require` 之前**先 `global.fetch = () => Promise.reject(new Error('offline'))`（groq-sdk 與 DDG 都用 global fetch；SDK 在 client 建構時捕捉 fetch，所以 stub 必須在 require 前）→ `await search('任何字')` 斷言 `=== null` 且不丟例外 |
| **2. 工具接線** | (a) `tools.run('test-uid','web_search','{"query":"台積電 是哪一年成立"}')` → 非空摘要。(b) `const webSearch = require('./src/services/webSearch'); webSearch.search = async () => null;` 再跑同一呼叫 → 斷言回傳含 `'unavailable'`（§3.2(a) 的整包引入保證 monkeypatch 生效） |
| **3. 端到端（真 Groq）** | 用 `ai.chat([{role:'user',content:Q}], { tools: tools.defs, runTool: countingRunTool, systemExtra: tools.timeContext() })`。Q1 =「2026年7月 台灣 最近有什麼大新聞？」→ 斷言 `calls === 1` 且回覆非空（§1.3 已實測此題穩定觸發；此題走 compound-413→DDG 後備路徑，順便驗證 fallback chain）。Q2（越南語）= `Tháng 7/2026 Đài Loan có tin gì lớn không?` → `calls === 1` 且回覆含越南語變音字元（`/[ăâđêôơưạảấầẩẫậ]/i` 之類抽樣即可）。溫度 0.7 有隨機性：單題失敗允許重跑 1 次再判 FAIL |
| **4. 不誤觸** | 同 countingRunTool 逐題跑「你好」「講個笑話」「翻譯成越南語：謝謝你的幫忙」→ 每題斷言 `calls === 0`（§1.3 已實測全 0）。「天氣 台北市」：呼叫 `handler.handleText(uid,'天氣 台北市')` 前先 monkeypatch `ai.chat = () => { throw new Error('AI 不應被呼叫') }` → 斷言仍回天氣文字（關鍵字路由在 AI 之前，handler.js L145 vs L321） |
| **5. 容錯** | `webSearch.search = async () => null` 後跑驗收 3 的 Q1 → 斷言回覆非空、無例外、不是 fallback 錯誤句（模型應說明查不到最新資訊並用知識回答） |
| **6. 語法／回歸** | `node --check` 逐一跑 4 個變更檔（webSearch.js / tools.js / ai.js / handler.js）；再抽測既有功能不回歸：`tools.run('uid','get_fuel_price','{}')` 回非空、「天氣 台北市」路由正常（同上）、`ai.ask('回答 OK','test')` 正常 |

**額度提醒**：驗收 3/5 的真呼叫彼此間隔 ≥30 秒（避開底層 8000 TPM 撞 429 干擾判定）。

---

## 6. 風險與緩解

| 風險 | 影響 | 緩解 |
|---|---|---|
| compound 模型改名／下架（曾發生 compound-beta → groq/compound） | 主用路徑全掛 | 錯誤→null→DDG 後備仍可搜；model id 集中在 `COMPOUND_MODEL` 常數一處，改名只動一行 |
| 免費層 429（底層 gpt-oss-120b TPM 8000，實測同分鐘連兩搜必中） | 單次搜尋失敗 | `maxRetries:0` 快速失敗→DDG；快取 10 分鐘；每訊息 1 次上限 |
| 413 `request_too_large`（實測新聞類查詢 deterministic 觸發） | compound 對重內容查詢必敗 | 這是設計 DDG 後備的主因；DDG 對同題實測回 10 筆新鮮結果 |
| DDG 擋 Render 資料中心 IP（本機無法驗證，上線後才知道） | 後備路徑失效 | 只影響「compound 也失敗」的交集；屆時工具回 unavailable 句，聊天不崩；上線後用驗收 3 的 Q1 實測一次即可確認 |
| DDG lite 改版（markup 變動） | 後備解析回 0 筆→null | 解析已容錯（0 筆→null）；正則寬鬆（不綁死屬性順序）；風險記錄於服務註解 |
| Render 冷啟動＋搜尋延遲疊加（免費方案休眠喚醒 30s+ 級） | 首則訊息回覆慢 | 搜尋逾時已封頂（10s+8s）；LINE reply token 約 1 分鐘，實測預算內；不做額外處理 |
| 模型過度觸發搜尋（燒額度） | 延遲、額度浪費 | 工具 description 明列「不要用於」清單＋SYSTEM_PROMPT 排除句＋timeContext 排除句（三層，§1.3 實測閒聊/翻譯 0 誤觸）；每訊息 1 次上限兜底 |
| 引用品質：compound 偶有低質來源（實測 medicine 題引到 Reddit）；越南語題摘要偶混中文 | 答案品質 | SYSTEM_PROMPT 要求模型「以搜尋結果為準＋只標網域」；外層模型會用使用者語言重寫（§1.3 越南語題已驗證）；不追加複雜過濾（PRD 範圍外） |
| `tool_use_failed` 依賴：新聞題實測靠 `parseFailedToolCalls` 救回 | 若該機制被改壞，搜尋觸發率大降 | DESIGN 明文禁止改動 ai.js 既有容錯（§3.3）；reviewer 檢查點 |

---

## 7. Coder 交付清單（依序）

1. 新增 `src/services/webSearch.js`（§3.1，含 `stats` 匯出）。
2. `src/tools.js`：import（整包、不解構）＋ def ＋ run case ＋ timeContext 句（§3.2）。
3. `src/ai.js`：SYSTEM_PROMPT 插三條（§3.3），其餘不動。
4. `src/handler.js`：runTool closure 加 1 次上限計數器（§3.4）。
5. `node --check` 全部四檔。

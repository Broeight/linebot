# 技術設計：匯率查詢功能（DESIGN）

**版本** v1.0 | **日期** 2026-06-29 | **作者** 軟體架構師（RD#1）
**對應 PRD** `docs/loop/exchange-rate/PRD.md` v1.0

---

## 〇、一句話總結

新增一支查詢類服務 `src/services/exchangeRate.js`，採用 **免金鑰、含 VND** 的 `open.er-api.com`（ExchangeRate-API 開放端點）。
中文關鍵字指令走 `handler.js` 路由（格式化中文回覆）；自然語句（含越南語）走 `tools.js` 的新 AI 工具 `get_exchange_rate`（回英文摘要交給模型改寫語言）。本功能**不需要存任何資料**（store.js 不動）。

---

## 一、關鍵技術決策

### 1.1 API 選用：`open.er-api.com`（覆蓋 PRD 的首選 Frankfurter）

PRD 標記 Frankfurter 雖免金鑰但**不含 VND**，而 VND 是本功能最核心幣別。權衡後採用：

- **API**：ExchangeRate-API 的開放端點（Open Access，免註冊、免 API key）
- **端點**：`https://open.er-api.com/v6/latest/{BASE}`
  - 例：`https://open.er-api.com/v6/latest/TWD`
- **回傳 JSON 形狀**：
  ```json
  {
    "result": "success",
    "base_code": "TWD",
    "time_last_update_utc": "Sun, 29 Jun 2026 00:00:01 +0000",
    "rates": { "USD": 0.031, "VND": 787.5, "JPY": 4.9, "...": "..." }
  }
  ```
- **取任兩幣別匯率的方式**：以 `from` 幣別為 base 抓 `/latest/{from}`，再從 `rates[to]` 取得「1 from = rates[to] to」。
  - 一次請求即拿到 base 對所有幣別的匯率，**不需要橋接（不需經 USD 轉換）**，精度與來源一致。
- **資料新鮮度**：每日更新一次（`time_last_update_utc` 為準），屬「參考匯率」而非即時報價（呼應 PRD 6.3）。

> **取捨**：放棄 Frankfurter 是因為 VND 缺口無法接受；放棄「需金鑰的 ExchangeRate-API v6 付費端點」與「exchangerate.host」是為了維持本專案「免金鑰、零設定」的一貫風格（weather/Open-Meteo、invoice/財政部 RSS 都無金鑰）。`open.er-api.com` 同時滿足「免金鑰 + 含 VND」兩個硬條件。

### 1.2 逾時處理：`AbortController` + 5 秒

現有服務（weather、invoice）皆直接 `await fetch(url)` 未設逾時。PRD 6.4 明確要求 timeout 5 秒，故本服務需自帶逾時機制：以 `AbortController` 搭配 `setTimeout(() => controller.abort(), 5000)`，將 `signal` 傳入 `fetch`，並在 `finally` 清掉 timer。逾時 / 連線失敗 / 非 200 / `result !== 'success'` 一律視為「取不到匯率」。

### 1.3 快取（選用、低風險）

匯率每日才更新一次，可選擇性加「以 base 為 key、TTL 30 分鐘」的記憶體快取（仿 invoice.js 的 `cache` 寫法）以減少外部請求。**非必要**，但建議實作，對 AC-09（連續查詢不報錯）有幫助。若不做也可通過（免費端點無嚴格頻率限制）。

---

## 二、受影響檔案清單

| 檔案 | 動作 | 內容 |
|---|---|---|
| `src/services/exchangeRate.js` | **新增** | 匯率服務：幣別映射、抓取、格式化中文回覆、英文摘要 |
| `src/handler.js` | **修改** | 新增匯率指令路由（3 條正則）＋ 更新 `helpText()` 加入匯率條目 |
| `src/tools.js` | **修改** | 新增 `get_exchange_rate` 工具 schema、`run()` 分支、`timeContext()` 提示補匯率 |
| `README.md` | **修改** | 功能清單與「專案結構」補一行匯率服務 |
| `src/lang.js` | **不改（預設）** | 多語言交給模型；英文摘要已足夠。詳見 §5.3 |
| `src/store.js` | **不改** | 本功能不存資料 |

---

## 三、模組與函式介面：`src/services/exchangeRate.js`

採 CommonJS，與既有服務一致。對外 `module.exports` 三個函式 + 一個常數表（供 handler 重用映射）。

### 3.1 幣別表與名稱映射（單一真實來源，放在本檔頂部）

幣別名稱映射集中在本服務，**handler 透過 require 重用**，避免兩處各寫一份。

- `SUPPORTED`：支援的代碼集合（陣列或 Set），固定 7 種：`TWD, VND, USD, JPY, CNY, EUR, KRW`（呼應 PRD「不做超過 7 種」）。
- `CURRENCY_NAMES`：中文名 → 代碼 的對照物件。至少涵蓋 PRD 表：
  - 台幣 / 新台幣 → `TWD`
  - 越南盾 / 越幣 → `VND`
  - 美元 / 美金 → `USD`
  - 日圓 / 日幣 → `JPY`
  - 人民幣 → `CNY`
  - 歐元 → `EUR`
  - 韓圓 / 韓幣 → `KRW`
- `CURRENCY_LABEL`（選用）：代碼 → 中文顯示名（如 `TWD` → `新台幣`），用於美化回覆。

**內部函式 `normalizeCurrency(input) -> code | null`**（不需匯出）：
1. `trim()` 後若命中 `CURRENCY_NAMES`（中文名）→ 回對應代碼；
2. 否則 `toUpperCase()`（呼應 PRD 6.6 大小寫）後，若 ∈ `SUPPORTED` → 回該代碼；
3. 都不中 → 回 `null`（交由呼叫端產生「不支援幣別」訊息）。

### 3.2 `async getRate(from, to) -> { ok, rate, updated, source } | { ok:false, error }`（內部核心，可不匯出）

最底層抓取函式，給下面兩個對外函式共用：

- **輸入**：已正規化的代碼 `from`、`to`（皆 ∈ `SUPPORTED`）。
- **流程**：抓 `https://open.er-api.com/v6/latest/{from}`（5 秒逾時）→ 驗 `result === 'success'` 且 `rates[to]` 為數字。
- **回傳（成功）**：`{ ok: true, rate: <number>, updated: <YYYY-MM-DD>, source: 'ExchangeRate-API' }`
  - `updated` 由 `time_last_update_utc` 轉成日期字串（可只取日期；簡單做法取 UTC 日期即可）。
- **回傳（失敗）**：`{ ok: false }`（逾時、連線錯、格式錯都歸此類，由上層轉成友善訊息）。

### 3.3 `async lookup(argText) -> string`（給 handler 中文指令用，回「已格式化的中文字串」）

對應 weather.js 的 `getWeather(city)`：直接吃使用者參數字串、回可直接傳給 LINE 的中文訊息。

- **簽章**：`lookup(argText: string): Promise<string>`
  - `argText` 為指令關鍵字後的整段內容，例如 `"TWD VND"`、`"台幣 越南盾"`、`"USD"`、`"5000 台幣換越南盾"`、`"5000 TWD VND"`。
- **解析職責（在本函式內）**：抽出 `amount?`（數字，允許千分位逗號 `[\d,]+`）、`from`、`to`。
  - 三種輸入歸一化規則：
    - 兩個幣別 token → `from` `to`，無金額。
    - 一個幣別 token → `to` 該幣別、`from` 預設 **TWD**（PRD AC-03：`匯率 USD` = USD↔TWD，預設基準 TWD）。
      - 註：為符合 AC-03「顯示 USD → TWD」，當僅給一個幣別 X 時，視為查「1 X = ? TWD」，即 `from=X, to=TWD`。
    - 含金額 + 兩幣別（`5000 台幣換越南盾` / `5000 TWD VND`）→ 解析出 `amount=5000, from, to`。
  - 幣別 token 解析：先用空白／「換」字切詞，逐 token 丟 `normalizeCurrency`。
- **驗證與錯誤**（皆回中文字串，不丟例外 → 對應 AC-06）：
  - 缺幣別 / 解析不到兩個有效幣別 → 回用法提示（例：`格式：匯率 TWD VND，或「5000 台幣換越南盾」`）。
  - 任一幣別 `normalizeCurrency` 回 null → 回 `不支援的幣別「XXX」，目前支援：TWD VND USD JPY CNY EUR KRW`。
- **成功輸出格式**（對應 PRD 4.3）：
  ```
  💱 匯率查詢
  TWD → VND
  1 TWD = 787.5 VND

  💡 換算：5,000 TWD ≈ 3,937,500 VND      ← 無金額時省略此段

  資料來源：ExchangeRate-API（每日更新）
  更新時間：2026-06-29
  以上為參考匯率，實際依各銀行為準。       ← 免責（PRD 6.5）
  ```
  - 數字格式化：用 `toLocaleString('en-US')` 或等效加千分位；匯率本身保留合理小數（建議：`>=100` 取 1 位、`<1` 取最多 4～6 位有效位，避免顯示 `0` 或過長）。
- **失敗（`getRate` 回 ok:false）**：回 `目前無法取得匯率，請稍後再試 🙏`（對應 AC-07）。

### 3.4 `async getExchangeSummary(from, to, amount?) -> string | null`（給 AI 工具用，回「英文摘要」）

對應 weather.js 的 `getForecastSummary()`：回**英文純文字**，讓模型用使用者語言改寫（PRD 4.2）。

- **簽章**：`getExchangeSummary(from: string, to: string, amount?: number): Promise<string | null>`
  - `from` / `to` 由模型給的代碼，函式內仍須跑 `normalizeCurrency`（模型可能給小寫或中文）。
- **行為**：
  - 任一幣別不支援 → 回英文錯誤字串，例如：`Unsupported currency. Supported: TWD, VND, USD, JPY, CNY, EUR, KRW.`（讓模型用對方語言轉達；不回 null 以利模型有話可說）。
  - 取不到匯率 → 回 `null`（與 weather 慣例一致；tools.run 會補一句 fallback 英文）。
  - 成功 → 英文摘要，**含 PRD 4.2 範例所有要素**：
    ```
    1 TWD = 787.5 VND. Amount: 5000 TWD = 3,937,500 VND. Source: ExchangeRate-API (daily). Updated: 2026-06-29.
    ```
    - 無 `amount` 時省略 `Amount: ...` 句。
    - 結尾可加 `Reference rate only; actual bank rates may vary.` 供模型轉述免責。

> **注意**：來源名稱在摘要寫 `ExchangeRate-API`（與實際採用一致），不要沿用 PRD 範例字面的「Frankfurter」，避免誤導使用者。

### 3.5 匯出

```
module.exports = { lookup, getExchangeSummary, CURRENCY_NAMES, SUPPORTED };
```
（`CURRENCY_NAMES` / `SUPPORTED` 匯出供測試與潛在重用；handler 主要用 `lookup`。）

---

## 四、`handler.js` 路由設計

### 4.1 import

於檔案上方既有 services require 區塊加入：
`const exchangeRate = require('./services/exchangeRate');`

### 4.2 路由位置與順序（**關鍵：避免與現有指令衝突**）

放在 **「翻譯」與「發票對獎」之間**（即現有第 92–101 行附近，`translateMatch` 之後、`invoiceMatch` 之前）。理由：

- 匯率三條正則皆以 `匯率` / `換算` / `數字+幣別+換` 開頭，與現有任何指令前綴（提醒、天氣、翻譯、對獎、記帳…）皆不重疊。
- 但「帶金額」那條（`/^[\d,]+.../`）為求保險須放在「記帳」之前——記帳是 `^記帳\s+`，不以數字開頭，實際不衝突；仍建議集中放在翻譯後，維持可讀性。
- 必須放在**最後的 AI fallback（第 147+ 行）之前**，否則自然語句以外的關鍵字指令會被 AI 接走。

### 4.3 三條正則（依序比對；全部用同一個 `exchangeRate.lookup` 處理）

```
// ── 匯率 ─────────────────────────────────────────────
// 1) 關鍵字：匯率 / exchange rate（後接幣別，1 或 2 個）
const rateMatch = trimmed.match(/^(?:匯率|exchange\s*rate)\s+(.+)$/i);
if (rateMatch) return exchangeRate.lookup(rateMatch[1].trim());

// 2) 換算 + 內容（可含金額）
const convMatch = trimmed.match(/^換算\s+(.+)$/);
if (convMatch) return exchangeRate.lookup(convMatch[1].trim());

// 3) 「<金額> <幣別> 換 <幣別>」一句話格式
//    例：5000 台幣換越南盾 / 1,000 TWD 換 VND
const amtConvMatch = trimmed.match(
  /^[\d,]+\s*(?:台幣|新台幣|越南盾|越幣|美元|美金|日圓|日幣|人民幣|歐元|韓圓|韓幣|TWD|VND|USD|JPY|CNY|EUR|KRW)\s*換\s*.+$/i
);
if (amtConvMatch) return exchangeRate.lookup(trimmed);  // 整句交給 lookup 解析
```

說明：
- 第 1、2 條把「關鍵字後內容」傳入 `lookup`；第 3 條沒有關鍵字前綴，故把**整句** `trimmed` 傳入，由 `lookup` 自己抽金額與幣別。
- `lookup` 內的解析需同時容忍「TWD VND」「台幣 越南盾」「台幣換越南盾」等寫法（以幣別 token + 可選「換」字切詞），三條正則只負責「路由觸發」，真正解析集中在服務層。

### 4.4 `helpText()` 更新（對應 AC-10）

在現有 help 字串中（建議緊接「💰 記帳」那行後）插入一行：
```
'💱 匯率：「匯率 台幣 越南盾」「5000 台幣換越南盾」\n' +
```

---

## 五、`tools.js` AI 工具設計

### 5.1 import

頂部加：`const { getExchangeSummary } = require('./services/exchangeRate');`

### 5.2 工具定義（加入 `defs` 陣列）

```
{
  type: 'function',
  function: {
    name: 'get_exchange_rate',
    description:
      '查詢兩種貨幣的參考匯率，可選擇換算金額。當使用者用任何語言（尤其越南語）'
      + '詢問匯率、兌換比、或「X 元換多少」時呼叫。幣別用三碼代碼。',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '來源幣別代碼，如 "TWD"、"VND"、"USD"。' },
        to:   { type: 'string', description: '目標幣別代碼，如 "VND"、"TWD"。' },
        amount: { type: 'number', description: '（選填）要換算的來源幣別金額。' },
      },
      required: ['from', 'to'],
    },
  },
},
```

### 5.3 `run()` 新分支

於 `switch (name)` 內加入：
```
case 'get_exchange_rate':
  return (
    (await getExchangeSummary(a.from, a.to, a.amount))
    || `Cannot fetch exchange rate for ${a.from} to ${a.to} right now.`
  );
```
- 與 `get_weather` 同模式：服務回 null 時補一句英文 fallback；外層既有 `try/catch` 已能攔例外回 `Tool failed: ...`。

### 5.4 `timeContext()` 微調

在現有指示句尾把「查天氣」擴充為「查天氣、查匯率」，提示模型遇到匯率/換算問題就呼叫 `get_exchange_rate`，並用對方語言回覆。這對 AC-05（越南語）的觸發率有幫助。

### 5.5 為何 `lang.js` 不需改

多語言回覆已由「工具回英文摘要 → 模型用使用者語言改寫」的既有機制處理（與 weather 相同）。`lang.js` 只管系統訊息 / 前綴 / 偵測，與匯率輸出無關，故**預設不動**。唯一可選的小改：在 `optionsText` 等無關。結論：本功能不碰 `lang.js`。

---

## 六、端到端流程

### 6.1 中文指令路徑
```
使用者「匯率 台幣 越南盾」
 → handler 正則命中 → exchangeRate.lookup("台幣 越南盾")
 → 解析 from=TWD, to=VND（中文映射）
 → getRate → fetch open.er-api.com/v6/latest/TWD（5s 逾時）
 → rates.VND → 格式化中文回覆 → 回 LINE
```

### 6.2 AI 工具路徑（越南語）
```
使用者「tỷ giá TWD VND hôm nay」
 → 非指令 → 進 AI fallback → 模型依 timeContext 呼叫 get_exchange_rate{from:"TWD",to:"VND"}
 → tools.run → getExchangeSummary → 英文摘要
 → 模型用越南語改寫 → 回 LINE
```

---

## 七、錯誤與逾時處理（彙整）

| 情境 | 中文指令（lookup） | AI 工具（getExchangeSummary） |
|---|---|---|
| 缺/解析不到幣別 | 回用法提示 | 模型會追問或自行澄清（required 已限制） |
| 不支援幣別（AC-06） | `不支援的幣別「ZZZ」，目前支援：…` | 英文 `Unsupported currency...` 字串，模型轉述 |
| API 逾時（>5s）/ 連線失敗 / 非 success（AC-07） | `目前無法取得匯率，請稍後再試 🙏` | 回 `null` → run() 補英文 fallback |
| 例外（throw） | `lookup` 內 try/catch 兜底回友善訊息 | tools.run 外層 try/catch 回 `Tool failed:` |

**逾時實作要點**：`AbortController` + `setTimeout(…,5000)`，`fetch(url,{signal})`，`finally` 清 timer。abort 觸發的 reject 視為「取不到匯率」。所有外部呼叫不可讓 process 崩潰。

---

## 八、測試策略（對應 PRD 10 條驗收條件）

### 8.1 可離線測（不碰真實 API）— 建議用 mock / 注入

針對「解析、映射、格式化、錯誤分支」可在不連網下驗證。做法：對 `exchangeRate.js` 的抓取層以 stub 取代（或用可注入的 `fetch`/全域 `fetch` mock），餵固定 JSON。

| AC | 測法（離線） |
|---|---|
| AC-02 | `lookup("台幣 越南盾")` 與 `lookup("TWD VND")` 解析出相同 from/to；驗證中文映射 |
| AC-03 | `lookup("USD")` 解析為 from=USD,to=TWD（預設基準）；輸出含 USD 與 TWD |
| AC-04 | mock rate=787.5，`lookup("5000 台幣換越南盾")` 輸出含 `3,937,500`（誤差 ±0.1%）；驗千分位格式 |
| AC-06 | `lookup("匯率 TWD ZZZ"→"TWD ZZZ")` 回「不支援」字串、不丟例外 |
| AC-07 | mock fetch reject / 逾時 / `result:"error"` → 回「目前無法取得匯率…」、不崩潰 |
| AC-10 | 斷言 `helpText()` 字串含「匯率」 |
| 大小寫(6.6) | `lookup("twd vnd")` 正常運作 |

### 8.2 需碰真實 API（線上煙霧測試）

| AC | 測法（線上） |
|---|---|
| AC-01 | 真打 `匯率 TWD VND`，回覆含「1 TWD = …VND」與資料來源；數值落在合理範圍（VND 約 700–900／TWD） |
| AC-05 | 在真實 LINE/對話流程送越南語問句，確認模型呼叫工具且**以越南語**回覆、含匯率數字 |
| AC-08 | `匯率 JPY TWD` → 數值落在約 0.18–0.30 TWD/JPY 合理區間 |
| AC-09 | 同一人 10 秒內連查 3 次（如 TWD VND、USD、JPY TWD）皆正常、無頻率錯誤 |

### 8.3 測試環境備註
- 專案目前無測試框架（package.json 未見 test 設定）。最低標準可寫一支 `node` 腳本/手動清單跑 8.1；若要正式化建議導入 Jest 並把 `fetch` 抽成可注入，但**非本期必須**。
- AC-05 屬整合測試，需有可用的 Groq 金鑰與 LINE 測試帳號；測試員若無 LINE 環境，可退而直接呼叫 `tools.run(userId,'get_exchange_rate',JSON.stringify({from:'TWD',to:'VND'}))` 驗英文摘要，再人工確認模型改寫語言一節由對話端覆蓋。

---

## 九、風險與取捨

1. **資料非即時**：open.er-api.com 每日更新一次。回覆已標「參考匯率／更新時間／依各銀行為準」緩解（PRD 6.3/6.5）。不得宣稱「即時」。
2. **第三方可用性**：免費開放端點無 SLA，可能偶發 5xx 或變更回傳格式。以 5 秒逾時 + 嚴格驗證（`result==='success'` 且 `rates[to]` 為數字）+ 友善錯誤兜底降低衝擊。若來源長期不穩，未來可再加備援來源（本期不做）。
3. **與 PRD 範例字面差異**：PRD 文案範例寫「Frankfurter」「787.5」，本設計改採 ExchangeRate-API。已在 §3.3/§3.4 要求回覆與摘要中標示實際來源名稱，避免誤導。數值會依當日真實匯率變動，測試以「合理區間」而非固定值驗證。
4. **無快取時的請求量**：家庭用量極小，免費端點足夠（AC-09）。建議加 30 分鐘記憶體快取作為保險，但非阻斷項。
5. **解析歧義**：自然語句格式多樣（「5000台幣換越南盾」無空白）。解析集中在服務層，以「幣別 token + 可選『換』字」為主、金額抓 `[\d,]+`；難以解析時回用法提示而非猜測，避免給錯數字。

---

## 十、實作檢核清單（給工程師 RD#2）

- [ ] 新增 `src/services/exchangeRate.js`：`SUPPORTED`、`CURRENCY_NAMES`、`normalizeCurrency`、`getRate`（5s 逾時）、`lookup`、`getExchangeSummary`，並 `module.exports`。
- [ ] `handler.js`：require 服務、在翻譯與對獎之間加 3 條正則路由、更新 `helpText()`。
- [ ] `tools.js`：require、加 `get_exchange_rate` 到 `defs`、`run()` 加 case、`timeContext()` 補「查匯率」。
- [ ] `README.md`：功能清單 + 專案結構各補一行。
- [ ] 自測 8.1 離線項 + 8.2 線上煙霧（至少 AC-01、AC-04、AC-08）。

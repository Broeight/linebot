# 技術設計：油價查詢（台灣中油）（DESIGN）

**版本** v1.0 | **日期** 2026-06-30 | **作者** 軟體架構師（RD#1）
**對應 PRD** `docs/loop/fuel-price/PRD.md` v1.0

---

## 〇、一句話總結

新增查詢類服務 `src/services/fuelPrice.js`，採用 **台灣中油官方、免金鑰** 的 `ListPriceWebService` 端點（回 XML，用純字串／正則解析，與 `invoice.js` 解析財政部 RSS 同手法）。中文關鍵字指令走 `handler.js` 路由（格式化中文回覆）；自然語句（含越南語）走 `tools.js` 新 AI 工具 `get_fuel_price`（回英文摘要交給模型改寫語言）。本功能**不存任何資料**（`store.js` 不動）。

---

## 一、資料來源（已實打驗證 ✅）

### 1.1 選定端點

| 項目 | 內容 |
|---|---|
| **來源** | 台灣中油 CPC（官方） |
| **端點** | `https://vipmbr.cpc.com.tw/CPCSTN/ListPriceWebService.asmx/getCPCMainProdListPrice` |
| **HTTP 方法** | **GET**（無參數、免金鑰、免註冊、免任何 header） |
| **回傳格式** | `text/xml; charset=utf-8`（ASP.NET DataSet diffgram，**非 JSON**） |
| **資料新鮮度** | 中油浮動油價每週一 08:00 調整；本端點回傳的汽油牌價 `牌價生效時間` 即為當週週一 |

> **驗證紀錄（2026-06-30，台北）**：對端點實打 GET 兩次皆 `HTTP 200`，回應約 10.4 KB、`total_time` ≈ 0.16s。並用 Node.js `fetch().text()` + 正則（與 `invoice.js` 相同手法）成功解析出下列四項油品，與 PRD §5.1 對應表完全吻合：

```
UNLEADED_98 | 98無鉛汽油 | 33.9 NTD/L | eff 2026-06-29
UNLEADED_95 | 95無鉛汽油 | 31.9 NTD/L | eff 2026-06-29
UNLEADED_92 | 92無鉛汽油 | 30.4 NTD/L | eff 2026-06-29
SUPER_DIESEL | 超級柴油   | 29.5 NTD/L | eff 2026-06-29
```

（生效日 `2026-06-29` 正是當週週一，符合 PRD「每週一調整」與 §4.1 `effective_date` 取當週週一的期望。）

### 1.2 回傳 XML 結構（實際樣本，節錄一筆）

整份 XML 是一個 `DataSet`，內含 schema 區塊（`xs:schema`，可忽略）與資料區塊 `diffgr:diffgram`。每一筆油品是一個 `<tbTable diffgr:id="tbTableN" ...>` 元素，**子節點為中文標籤、純文字值（無 CDATA）**：

```xml
<tbTable diffgr:id="tbTable1" msdata:rowOrder="0">
  <型別名稱>汽柴油零售</型別名稱>
  <產品編號>113F 1209800</產品編號>
  <產品名稱>98無鉛汽油</產品名稱>
  <包裝>散裝</包裝>
  <銷售對象>一般自用客戶 </銷售對象>
  <交貨地點>加油站等</交貨地點>
  <計價單位>元/ 公升</計價單位>
  <參考牌價>33.9000</參考牌價>
  <營業稅>5%</營業稅>
  <貨物稅>內含</貨物稅>
  <牌價生效時間>2026-06-29T00:00:00+08:00</牌價生效時間>
  <備註 />
</tbTable>
```

### 1.3 要解析的欄位（load-bearing 字串）

| XML 標籤 | 用途 | 範例值 |
|---|---|---|
| `產品名稱` | 比對油品（見 §1.4） | `98無鉛汽油` |
| `參考牌價` | 牌價（每公升），`Number()` 後 `toFixed(1)` | `33.9000` → `33.9` |
| `牌價生效時間` | 生效日，取前 10 字 `slice(0,10)` 即 `YYYY-MM-DD` | `2026-06-29T00:00:00+08:00` → `2026-06-29` |

### 1.4 油品名稱對應（來源字串 → 內部代碼 → 顯示名）

整份回應共 **13 筆**（含我們不需要的「酒精汽油」「海運輕柴油」「低硫燃料油」等工業／船用油品）。**只取下列四筆**，其餘忽略：

| 來源 `產品名稱`（精確比對） | 內部代碼 | 中文顯示名 | 英文摘要名 |
|---|---|---|---|
| `92無鉛汽油` | `UNLEADED_92` | `92 無鉛汽油` | `Unleaded 92` |
| `95無鉛汽油` | `UNLEADED_95` | `95 無鉛汽油` | `Unleaded 95` |
| `98無鉛汽油` | `UNLEADED_98` | `98 無鉛汽油` | `Unleaded 98` |
| `超級柴油` | `SUPER_DIESEL` | `超級柴油` | `Super Diesel` |

> **重要**：`超級柴油` 必須**精確比對**，不可用「含『柴油』」的模糊比對，否則會誤抓到 `海運輕柴油 / 海運重柴油 / 低硫高流動點燃料油` 等工業油品（其價格是「元/公秉」、數值上萬，不是零售公升價）。同理汽油用 `92/95/98無鉛汽油` 三個完整字串比對，避免抓到 `酒精汽油`。

### 1.5 取捨與替代方案說明

- **為何選此端點**：唯一同時滿足「官方來源 + 免金鑰 + 一次拿到 92/95/98/超級柴油現價 + 生效日」者，且維持本專案「免金鑰、零設定」的一貫風格（weather/Open-Meteo、invoice/財政部 RSS、holiday/TaiwanCalendar、exchangeRate/open.er-api 皆無金鑰）。
- **未採用 data.gov.tw 中油 dataset**：政府開放平台上的中油油價資料多為「歷史每日油價 CSV」或需 datastore 查詢字串，欄位／更新節奏不如官方 WebService 直接，且部分 dataset 已停更，穩定性不如本端點。
- **本案無「卡關」**：端點已實打可用，不需使用者決策、不需改用需註冊 API。

---

## 二、關鍵技術決策

### 2.1 XML 解析：純字串／正則（比照 `invoice.js`，不引入套件）

專案**無 XML 套件**（`package.json` 僅 `@line/bot-sdk`、`dotenv`、`express`、`groq-sdk`），且既有 `invoice.js` 已示範「`fetch().text()` 後用正則切 `<item>…</item>`」的解析法。本服務沿用相同手法：

1. `const xml = await res.text();`
2. `const blocks = xml.match(/<tbTable[^>]*>[\s\S]*?<\/tbTable>/g) || [];`（切出每筆）
3. 每塊用 `block.match(/<產品名稱>([\s\S]*?)<\/產品名稱>/)` 取值，餘同。

> 已在 Node.js 環境實測：上述正則對真實回應正確切出 13 塊、精準取出四項目標油品與其價格／生效日。中文標籤名在 JS 正則字面中可直接使用（檔案為 UTF-8）。

### 2.2 逾時處理：`AbortController` + 8 秒（PRD §4.1）

PRD 明定逾時上限 8 秒（比 exchangeRate/holiday 的 5 秒寬，因中油站台偶有較慢）。以 `AbortController` + `setTimeout(() => controller.abort(), 8000)`，`fetch(url, { signal })`，`finally` 清 timer。逾時／連線失敗／非 200／解析不到任何目標油品 → 一律視為「取不到」，回友善訊息（對應 AC-09、AC-11）。

### 2.3 快取：記憶體、TTL 4 小時（PRD §4.1、AC-10）

資料每週一才更新，快取可長。以**整包四油品結果為單一 key**（資料無參數，全站共用一份）做記憶體快取，`CACHE_TTL_MS = 4 * 60 * 60 * 1000`。仿 `holiday.js`／`exchangeRate.js` 的 `cache` 物件寫法。命中即不對外 fetch（對應 AC-10：第二次查詢不發請求）。

> **建議**（非阻斷）：可仿 `holiday.js` 加「負快取」——抓失敗時也記一個短 TTL（如 30 分鐘）的 miss，避免來源掛掉時每次查詢都打一次。本期可選做。

---

## 三、受影響檔案清單

| 檔案 | 動作 | 內容 |
|---|---|---|
| `src/services/fuelPrice.js` | **新增** | 油價服務：油品對應表、抓取＋XML 解析（8s 逾時、4h 快取）、`lookup`、`usage`、`getFuelPriceSummary` |
| `src/handler.js` | **修改** | require 服務；於「匯率之後、發票對獎之前」加油價路由（3 條正則）；`helpText()` 加一行 |
| `src/tools.js` | **修改** | require `getFuelPriceSummary`；`defs` 加 `get_fuel_price`；`run()` 加 case；`timeContext()` 補油價提示 |
| `README.md` | **修改** | 功能清單與「專案結構」各補一行油價服務 |
| `src/store.js` | **不改** | 本功能不存資料（僅可選用 `store.taipei()` 取今日日期，無寫入） |
| `src/lang.js` | **不改** | 多語言交給模型；英文摘要已足夠（同 exchangeRate/holiday 慣例） |

---

## 四、模組與函式介面：`src/services/fuelPrice.js`

採 CommonJS，與既有服務一致。

### 4.1 常數（檔頂，單一真實來源）

```
const ENDPOINT = 'https://vipmbr.cpc.com.tw/CPCSTN/ListPriceWebService.asmx/getCPCMainProdListPrice';
const SOURCE = '台灣中油';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;   // 4 小時
const FETCH_TIMEOUT_MS = 8000;             // 8 秒（PRD §4.1）
```

油品對應表（**單一真實來源**，供解析、指令正規化、顯示共用）：

```
// 內部代碼 → { 來源產品名稱（精確比對）, 中文顯示名, 英文摘要名, 顯示排序 }
const PRODUCTS = {
  UNLEADED_92:  { cpcName: '92無鉛汽油', labelZh: '92 無鉛汽油', labelEn: 'Unleaded 92',  order: 1 },
  UNLEADED_95:  { cpcName: '95無鉛汽油', labelZh: '95 無鉛汽油', labelEn: 'Unleaded 95',  order: 2 },
  UNLEADED_98:  { cpcName: '98無鉛汽油', labelZh: '98 無鉛汽油', labelEn: 'Unleaded 98',  order: 3 },
  SUPER_DIESEL: { cpcName: '超級柴油',   labelZh: '超級柴油',    labelEn: 'Super Diesel', order: 4 },
};
```

使用者輸入 → 內部代碼（供 handler 與 AI 工具共用，呼應 PRD §5.1）：

```
// 中文別稱／號數 → 內部代碼
const ALIAS = {
  '92': 'UNLEADED_92', '92無鉛': 'UNLEADED_92', '九二': 'UNLEADED_92',
  '95': 'UNLEADED_95', '95無鉛': 'UNLEADED_95', '九五': 'UNLEADED_95',
  '98': 'UNLEADED_98', '98無鉛': 'UNLEADED_98', '九八': 'UNLEADED_98',
  '柴油': 'SUPER_DIESEL', '超柴': 'SUPER_DIESEL', '超級柴油': 'SUPER_DIESEL',
};
```

**內部 `normalizeProduct(input) -> code | null`**（不需匯出）：`trim()` 後查 `ALIAS`；也允許直接傳內部代碼（`UNLEADED_92` 等，供 AI 工具）；都不中回 `null`（由上層輸出「不支援的油品」訊息，對應 AC-12）。

### 4.2 `async fetchPrices() -> { ok, prices, effectiveDate } | { ok:false }`（內部核心，可不匯出）

最底層抓取＋解析，給下面兩個對外函式共用。

- **流程**：先查快取（命中且未過期直接回）→ 否則 `fetch(ENDPOINT, { signal })`（8s 逾時）→ `res.text()` → 正則切 `tbTable` → 逐塊取 `產品名稱`，只收 `PRODUCTS` 中精確命中的四項 → 取 `參考牌價`（`Number(...).toFixed(1)`）與 `牌價生效時間`（`slice(0,10)`）。
- **成功回傳**：
  ```
  {
    ok: true,
    prices: { UNLEADED_92: 30.4, UNLEADED_95: 31.9, UNLEADED_98: 33.9, SUPER_DIESEL: 29.5 },
    effectiveDate: '2026-06-29',   // 取汽油類的牌價生效時間（當週週一）
    source: '台灣中油',
  }
  ```
  - `effectiveDate` 取四項汽油／柴油裡的 `牌價生效時間`（四項一致時取其一即可；保險作法取 92/95/98 任一）。
- **失敗回傳**：`{ ok: false }`（逾時、連線錯、非 200、解析不到四項任何一項都歸此類）。
- **快取**：成功後存 `{ data, ts: Date.now() }`，下次 4 小時內命中直接回（對應 AC-10）。

### 4.3 `async lookup(product?) -> string`（給 handler 中文指令用，回已格式化中文字串）

- **簽章**：`lookup(product?: string): Promise<string>`
  - 無參數（或空）→ 回全部四種。
  - 有參數 → 先 `normalizeProduct`；得 `null` → 回「不支援的油品」訊息（AC-12）：
    `不支援的油品，請輸入 92／95／98／柴油`
- **流程**：`fetchPrices()` → `ok:false` 時回 `目前無法取得油價資料，請稍後再試 🙏`（AC-09／AC-11）。
- **成功輸出（全部四種，對應 PRD §5.4）**：依 `order` 排序
  ```
  ⛽ 台灣中油本週油價
  生效日：2026-06-29（週一）

  ・92 無鉛汽油　30.4 元/公升
  ・95 無鉛汽油　31.9 元/公升
  ・98 無鉛汽油　33.9 元/公升
  ・超級柴油　　29.5 元/公升

  資料來源：台灣中油（每週一調整）
  ```
- **成功輸出（單一油品，對應 PRD §5.4）**：
  ```
  ⛽ 95 無鉛汽油：31.9 元/公升
  生效日：2026-06-29（週一）

  資料來源：台灣中油（每週一調整）
  ```
- **「（週一）」標註**：`effectiveDate` 已是週一（中油浮動油價特性），可直接固定加「（週一）」；亦可用 `store` 風格的工具由日期推算星期再標，但本案來源保證為週一，固定字串即可，**簡單為上**。
- **小數格式**：一律 `toFixed(1)`（PRD §7.2「顯示小數點後 1 位」）。

### 4.4 `usage() -> string`（同步，使用說明子選單，對應 AC-05）

仿 `holiday.usage()`，回固定中文字串：
```
⛽ 油價查詢可以這樣問：
・油價（查全部四種）
・92油價 / 95油價 / 98油價 / 柴油油價
・今天油價 / 本週油價
資料來源：台灣中油（每週一調整）
```

### 4.5 `async getFuelPriceSummary(product?) -> string | null`（給 AI 工具用，回英文摘要）

對應 weather/exchangeRate 慣例：回**英文純文字**，讓模型用使用者語言改寫（PRD §4.2、§5.5）。

- **簽章**：`getFuelPriceSummary(product?: string): Promise<string | null>`
  - `product` 由模型給（內部代碼，如 `UNLEADED_95`）；函式內仍跑 `normalizeProduct`（容忍別稱／空值）。
- **行為**：
  - 取不到資料（`fetchPrices` 回 ok:false）→ 回 `null`（`tools.run` 會補英文 fallback）。
  - `product` 給了但無法識別 → 回英文字串（讓模型轉述），例如：
    `Unsupported product. Available: Unleaded 92/95/98, Super Diesel.`
  - 成功、**無 product**（回全部，對應 PRD §5.5 範例）：
    ```
    Taiwan CPC fuel prices effective 2026-06-29:
    Unleaded 92: 30.4 NTD/L; Unleaded 95: 31.9 NTD/L; Unleaded 98: 33.9 NTD/L; Super Diesel: 29.5 NTD/L.
    Source: Taiwan CPC (updated weekly on Monday). Reference prices only.
    ```
  - 成功、**單一 product**（對應 US-05／AC-07）：
    ```
    Taiwan CPC fuel price effective 2026-06-29: Super Diesel 29.5 NTD/L.
    Source: Taiwan CPC (updated weekly on Monday). Reference prices only.
    ```

### 4.6 匯出

```
module.exports = { lookup, usage, getFuelPriceSummary, PRODUCTS };
```
（`PRODUCTS` 匯出供測試與潛在重用；handler 主要用 `lookup`／`usage`，tools 用 `getFuelPriceSummary`。）

---

## 五、`handler.js` 路由設計

### 5.1 import

於檔案上方既有 services require 區塊（`exchangeRate`／`holiday` 附近）加入：
`const fuelPrice = require('./services/fuelPrice');`

### 5.2 路由位置與順序（**關鍵：避免衝突、放對位置**）

PRD §5.2 指定「在匯率之後、發票對獎之前」。對照現有 `handler.js`：匯率區塊結束於第 116 行（`amtConvMatch`），放假區塊在 118–143 行，發票對獎在 145–149 行。

**放置點**：**放假／連假區塊之後、發票對獎之前**（即現有第 143 行 `holiday.usage()` 之後、第 145 行 `invoiceMatch` 之前）。這仍落在 PRD 要求的「匯率之後、發票之前」範圍內，且不破壞放假區塊的內聚。

- **必須在最後 AI fallback（現第 196 行 `conversation.append` / `ai.chat`）之前**，否則中文關鍵字指令會被 AI 接走（呼應 PRD「在 AI fallback 前」）。
- **不衝突確認**：油價三條正則都以「油價」結尾或為「油價／今天油價／…／油價查詢」固定詞，與既有任何指令前綴（提醒、天氣、翻譯、匯率、放假、對獎、記帳…）皆不重疊。特別注意：發票路由是 `/^(?:對獎|發票)\s*(.*)$/`，與油價不衝突；放假路由皆為「放假/連假/N月假日」字樣，亦不含「油價」。

### 5.3 三條正則（依序比對）

```
// ── 油價（台灣中油）─────────────────────────────────────
// 1) 油價查詢 → 使用說明子選單（須在「全部油價」之前比對，避免被別的規則吃掉）
if (/^油價查詢$/.test(trimmed)) {
  return fuelPrice.usage();
}
// 2) 單一油品：92/95/98/柴油…（+可選「無鉛」）油價
const fuelOneMatch = trimmed.match(/^(92|95|98|超柴|柴油|超級柴油|九二|九五|九八)無?鉛?\s*油價$/);
if (fuelOneMatch) {
  return fuelPrice.lookup(fuelOneMatch[1]);
}
// 3) 全部四種：油價 / 今天油價 / 本週油價 / 這週油價 / 當週油價
if (/^(?:油價|今天油價|本週油價|這週油價|當週油價)$/.test(trimmed)) {
  return fuelPrice.lookup();
}
```

說明（**比對順序很重要**）：
- 先比 `油價查詢`（最特定），再比「單一油品油價」，最後才比「裸『油價』等全包詞」。若把「全部油價」那條放前面，因為它是 `^…$` 完全比對，其實不會吃到「95油價」（不同字串），但仍建議由特定到一般排列以策安全。
- 第 2 條把擷取群組（號數／柴油別稱字串，如 `95`、`柴油`）原樣傳給 `lookup`，由服務層 `normalizeProduct` 轉成內部代碼。PRD §5.2 的原始正則 `[無鉛]?` 是字元類筆誤（只會選擇性吃單一「無」或「鉛」字），本設計改為 `無?鉛?` 以正確涵蓋「95無鉛油價」寫法。
- `lookup()` 無參數即回全部四種（對應 AC-01／AC-04）。

### 5.4 `helpText()` 更新

在現有 help 字串中（建議緊接「📅 放假」那行後、「🌐 翻譯」之前）插入一行：
```
'⛽ 油價：「油價」「95油價」「柴油油價」\n' +
```

---

## 六、`tools.js` AI 工具設計

### 6.1 import

頂部加：`const { getFuelPriceSummary } = require('./services/fuelPrice');`

### 6.2 工具定義（加入 `defs` 陣列，對應 PRD §5.3）

```
{
  type: 'function',
  function: {
    name: 'get_fuel_price',
    description:
      '查詢台灣中油當週油價牌價。當使用者用任何語言（尤其越南語）詢問台灣油價、'
      + '汽油價格、柴油多少錢時呼叫。',
    parameters: {
      type: 'object',
      properties: {
        product: {
          type: 'string',
          enum: ['UNLEADED_92', 'UNLEADED_95', 'UNLEADED_98', 'SUPER_DIESEL'],
          description: '油品代碼；不填則回傳全部四種。'
            + ' xăng 92→UNLEADED_92、xăng 95→UNLEADED_95、xăng 98→UNLEADED_98、'
            + 'dầu diesel/dầu DO→SUPER_DIESEL。',
        },
      },
      // product 為選填（PRD §5.3）→ 不放進 required
    },
  },
},
```

> 用 `enum` 限制 `product` 取值，幫助模型只給合法代碼；description 內附越南語常見詞對應（呼應 PRD §5.1）以提升 US-04／US-05 觸發品質。

### 6.3 `run()` 新分支

於 `switch (name)` 內加入：
```
case 'get_fuel_price':
  return (
    (await getFuelPriceSummary(a.product))
    || 'Cannot fetch Taiwan CPC fuel price right now.'
  );
```
- 與 `get_weather`／`get_exchange_rate` 同模式：服務回 `null` 時補英文 fallback；外層既有 `try/catch` 已能攔例外回 `Tool failed: …`。
- `a.product` 為 `undefined` 時即查全部（`getFuelPriceSummary` 內 `normalizeProduct(undefined)` → 視為全部）。

### 6.4 `timeContext()` 更新（對應 PRD §5.6）

在現有指示句把列舉的工具情境補入「查油價」，並加一句明確指示：
> 「若使用者用任何語言詢問台灣油價、汽油、柴油，就呼叫 get_fuel_price 工具。」

例如把現有句尾「…查匯率或查台灣放假/連假，就呼叫對應工具…」擴充為「…查匯率、查台灣放假/連假或查台灣油價（汽油／柴油），就呼叫對應工具…」。

---

## 七、端到端流程

### 7.1 中文指令路徑（AC-01～05、AC-12）
```
使用者「95油價」
 → handler 第 2 條正則命中 → fuelPrice.lookup("95")
 → normalizeProduct("95") = UNLEADED_95
 → fetchPrices()（快取未命中時 fetch CPC，8s 逾時）→ 解析 XML
 → 取 UNLEADED_95 = 31.9、effectiveDate=2026-06-29
 → 格式化單一油品中文回覆 → 回 LINE
```

### 7.2 AI 工具路徑（越南語，US-04／US-05、AC-06／AC-07）
```
使用者「giá dầu diesel」
 → 非指令 → AI fallback → 模型依 timeContext 呼叫 get_fuel_price{product:"SUPER_DIESEL"}
 → tools.run → getFuelPriceSummary("SUPER_DIESEL") → 英文摘要
 → 模型用越南語改寫 → 回 LINE
```

### 7.3 語音路徑（AC-08）
```
語音「九五汽油多少」→ ai.transcribe → 文字
 → handleText：若轉出「95油價」類字串走 7.1；
   否則（自然句）走 7.2 由 AI 工具處理 → 皆回 95 油價
```
> 語音轉文字結果不保證精確等於指令字串；故 AC-08 主要靠 AI 工具路徑兜底（自然語句），中文關鍵字路由為輔。

---

## 八、錯誤與逾時處理（彙整）

| 情境 | 中文指令（lookup） | AI 工具（getFuelPriceSummary） |
|---|---|---|
| 不支援油品（AC-12，如「87油價」） | `不支援的油品，請輸入 92／95／98／柴油` | 英文 `Unsupported product. Available: …`，模型轉述 |
| 來源逾時（>8s）／連線失敗／非 200／解析不到（AC-09／AC-11） | `目前無法取得油價資料，請稍後再試 🙏` | 回 `null` → `run()` 補英文 fallback |
| 例外（throw） | `lookup` 內 `try/catch` 兜底回友善訊息 | `tools.run` 外層 `try/catch` 回 `Tool failed:` |

**逾時實作要點**：`AbortController` + `setTimeout(…, 8000)`，`fetch(url, { signal })`，`finally` 清 timer。abort 觸發的 reject 視為「取不到」。所有外部呼叫不可讓 process 崩潰（呼應 AC-11 不 hang）。

---

## 九、測試策略（對應 PRD §6 的 12 條 AC）

> 專案目前無正式測試框架（`package.json` 無 test 設定），既有慣例是寫獨立 `node` 腳本放 `tests/`（見 holiday 的 TEST.md）。建議把 `fetchPrices` 的「XML 解析」抽成可單獨測的純函式（例如內部 `parsePrices(xmlString)`），用**離線 fixture**（把本設計 §1.2 的真實 XML 存成測試樣本）餵入，即可不連網覆蓋大多數 AC。

### 9.1 可離線測（不碰真實來源）— 用 fixture / mock

| AC | 測法（離線） |
|---|---|
| AC-01 | `parsePrices(fixtureXml)` 得四油品；`lookup()`（mock `fetchPrices` 成功）輸出含四種油品名、數字、生效日、「台灣中油」字樣 |
| AC-02 | `lookup("95")` 輸出只含「95 無鉛汽油」與其價格，不含其他三種 |
| AC-03 | `lookup("柴油")` 輸出只含「超級柴油」 |
| AC-04 | `lookup()` 與 `lookup("今天油價"→ handler 走無參數)` 等價：四種全含（驗 handler 正則把「今天油價」導向 `lookup()`） |
| AC-05 | `usage()` 不丟例外、列出可查油品關鍵字（92/95/98/柴油） |
| AC-09 | mock `fetch` reject／非 200／回空 XML → `lookup()` 回「目前無法取得油價資料…」、不崩潰 |
| AC-11 | mock `fetch` 永不 resolve + 假時鐘／或直接讓 signal abort → `lookup()` 在逾時後回 AC-09 訊息、不 hang（可用較短逾時注入驗證機制） |
| AC-12 | `lookup("87")`／`lookup("87油價"→handler 不命中→ AI fallback)`：服務層 `lookup("87")` 回「不支援的油品…」；並驗 handler 正則對「87油價」不誤觸（不在號數白名單，落入 AI fallback 屬預期） |
| 解析健壯性 | `parsePrices` 對「超級柴油」精確比對，**不**誤抓「海運輕柴油／低硫燃料油」等工業油品（用完整 13 筆 fixture 驗證只取 4 筆） |
| helpText | 斷言 `helpText()` 含「油價」 |
| tool 定義 | `defs` 含 `get_fuel_price`、`product` 為選填（不在 required）、enum 四值 |
| timeContext | `timeContext()` 字串含「油價」 |

### 9.2 需碰真實來源（線上煙霧測試）

| AC | 測法（線上） |
|---|---|
| AC-01/02/03 | 真打端點：`lookup()` 含四種；`lookup("95")` 只含 95；`lookup("柴油")` 只含超級柴油。價格落在合理區間（無鉛汽油約 25–40、柴油約 24–35 元/公升） |
| AC-06 | 在真實對話流程送越南語「giá xăng hôm nay」，確認模型呼叫 `get_fuel_price`（無 product）且**以越南語**回覆、含四種油價與生效日 |
| AC-07 | 越南語「giá dầu diesel」→ 模型呼叫 `get_fuel_price{product:"SUPER_DIESEL"}`、越南語回覆只含柴油 |
| AC-08 | 真實語音「九五汽油多少」→ transcribe → 觸發 95 油價（指令路由或 AI 工具皆可）、回覆含 95 無鉛汽油價格 |
| AC-10 | 連續兩次 `lookup()`（4 小時內），以 log／spy 斷言第二次**未**對外發 fetch（快取命中） |

### 9.3 測試環境備註
- AC-06/07/08 屬整合測試，需 Groq 金鑰與（語音）LINE 測試帳號。無 LINE 環境時，測試員可退而直接呼叫 `tools.run(userId, 'get_fuel_price', JSON.stringify({product:'SUPER_DIESEL'}))` 驗英文摘要，模型改寫語言一節由對話端人工覆蓋（與 holiday/exchangeRate 測試慣例相同）。
- 離線 fixture 建議直接保存本設計 §1.2 的真實回應全文（13 筆），確保「只取 4 筆、精確比對」的解析行為被覆蓋。

---

## 十、風險與取捨

1. **資料非即時、每週一更新**：回覆已標「生效日」與「每週一調整」緩解（PRD §7.1）。週一 08:00 後若快取仍是上週價，最多延遲 4 小時（TTL），可接受；不得宣稱「即時」。
2. **官方站台可用性 / 版面或欄位改名**：免費端點無 SLA。以 8 秒逾時 + 嚴格驗證（解析不到四項即視為失敗）+ 友善錯誤兜底降低衝擊。若中油改 XML 結構（標籤改名）會導致解析不到 → 回 AC-09 訊息而非崩潰；屬可接受的「優雅降級」。長期可加備援來源（本期不做，呼應 PRD §7.1）。
3. **油品命名誤抓**：來源含 13 筆，多筆名稱含「柴油／燃料油」。已要求**精確比對**四個完整字串並用 fixture 測試防呆（§1.4、§9.1）。
4. **ASMX 對 HTTP 方法的處理**：實測 `GET` 正常回 200；`HEAD` 會 302 轉到錯誤頁（ASMX 特性），實作只用 `GET`，不要用 HEAD 探活。
5. **編碼**：回應為 UTF-8，`res.text()` 取得即正確；JS 正則字面可直接寫中文標籤（檔案 UTF-8）。已實測無亂碼問題。
6. **與 PRD 範例字面差異**：PRD §5.5 英文摘要範例的數值（28.3／29.8…）為示意；實際以當週真實牌價為準（本設計實測為 30.4／31.9／33.9／29.5）。測試以「合理區間」而非固定值驗證。

---

## 十一、實作檢核清單（給工程師 RD#2）

- [ ] 新增 `src/services/fuelPrice.js`：常數（ENDPOINT/SOURCE/TTL/逾時）、`PRODUCTS`、`ALIAS`、`normalizeProduct`、`parsePrices`（純函式，可測）、`fetchPrices`（8s 逾時 + 4h 快取）、`lookup`、`usage`、`getFuelPriceSummary`，並 `module.exports`。
- [ ] `handler.js`：require 服務；在放假區塊之後、發票對獎之前加 3 條正則路由（順序：油價查詢 → 單一油品 → 全部）；`helpText()` 加「⛽ 油價…」一行。
- [ ] `tools.js`：require `getFuelPriceSummary`；`defs` 加 `get_fuel_price`（product 選填、enum 四值）；`run()` 加 case；`timeContext()` 補「查油價」提示。
- [ ] `README.md`：功能清單 + 專案結構各補一行油價服務（仿匯率／放假兩行）。
- [ ] 自測 §9.1 離線項（含「只取 4 筆」防呆）+ §9.2 線上煙霧（至少 AC-01、AC-02、AC-03、AC-10）。

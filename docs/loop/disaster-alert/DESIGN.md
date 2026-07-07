# DESIGN — 🌀 防災警報推播（颱風／地震／豪雨等，越南語優先）

> RD#1（架構師）技術設計。對應 `PRD.md`。資料源以**真實 fetch 實測**驗證（見 §1）。
> 唯讀既有原始碼；本文只描述「要改哪些檔、介面、資料結構、測試」，不含實作碼。

---

## 1. 資料源決策（實測驗證）

### 需要金鑰：**否** ✅

**主來源（Primary，免金鑰）：NCDR 民生示警公開資料平台 — 即時防災資訊 JSON**

```
GET https://alerts.ncdr.nat.gov.tw/JSONAtomFeed.ashx
```

實測結果（2026-07-07 實跑，本機 Node 22 global `fetch`）：

| 項目 | 實測值 |
|---|---|
| HTTP 狀態 | `200` |
| Content-Type | `application/json; charset=utf-8` |
| 需授權 header / token | **不需要**（無 Authorization、無 API key、無瀏覽器 header 要求） |
| 大小 | 約 **540 KB**（552,730 bytes） |
| 延遲 | 約 **425 ms** |
| 更新頻率 | 秒級即時（feed `updated` 與最新 entry 時間戳一致；氣象署特報數分鐘一筆） |
| 反爬 | 僅回一個 `Set-Cookie`（非必要，不帶也照回 200） |
| 當下 entry 數 | **944 筆**（聚合多機關現行有效警示） |

> ⚠️ **舊端點已失效**：`RSS.aspx`／`Api.aspx`／`ProtectiveEvent.aspx` 現在全部 302/200 轉址到 SPA `https://alerts.ncdr.nat.gov.tw/web/`，**不要用**。可用的機器介面只有 `JSONAtomFeed.ashx`（JSON）與各 entry 連出的 `.cap`（XML）。另有 `/api/<name>` REST（實測無效名稱回 `{"success":false,"messsage":"無效的介面名稱"}`，本專案用不到）。

**Feed 頂層結構**（ATOM 風格的 JSON）：

```json
{
  "id": "https://alerts.ncdr.nat.gov.tw/Json.aspx",
  "title": "NCDR_CAP-即時防災資訊(Json)",
  "updated": "2026-07-07T21:18:00+08:00",
  "author": { "name": "NCDR" },
  "link": { "@rel": "self", "@href": "https://alerts.ncdr.nat.gov.tw/JSONAtomFeed.ashx" },
  "entry": [ /* … 944 筆 … */ ]
}
```

**單一 entry 的真實樣本**（實測直接複製，未杜撰）— 一筆「雷雨」特報：

```json
{
  "id": "cwa.gov.tw_thunderstorm_20260707155908_000",
  "title": "雷雨",
  "updated": "2026-07-07T16:00:14+08:00",
  "author": { "name": "中央氣象署" },
  "link": {
    "@rel": "alternate",
    "@href": "https://alerts.ncdr.nat.gov.tw/Capstorage/CWA/2026/thunderstorm/cwa.gov.tw_thunderstorm_20260707155908_000.cap"
  },
  "summary": {
    "@type": "html",
    "#text": "115年07月07日15時59分氣象署發布大雷雨即時訊息，持續時間至16時59分；有短延時強降雨發生，並伴隨較強陣風、閃電落雷，請慎防溪(河)水暴漲、低能見度、雷擊"
  },
  "category": { "@term": "雷雨" },
  "status": "Actual",
  "msgType": "Alert",
  "effective": "2026/7/7 下午 03:59:00",
  "expires": "2026/7/7 下午 04:59:00"
}
```

**每筆 entry 的欄位穩定性**（實測 944 筆，每欄都 944/944 存在）：
`id, title, updated, author, link, summary, category, status, msgType, effective, expires`。

**關鍵：欄位對照與我們要抽的值**

| 我們的欄位 | 來源路徑 | 說明 / 實測值 |
|---|---|---|
| `id` | `entry.id` | 唯一鍵，但**非全域唯一**（見下方去重段） |
| `category` | `entry.category["@term"]` | 事件類別中文，如 `地震`／`雷雨`／`高溫`／`淹水`／`降雨` |
| `agency` | `entry.author.name` | 發布機關，如 `中央氣象署`／`水利署`／`台灣自來水公司` |
| `title` | `entry.title` | 短標題（多與 category 同字） |
| `summary` | `entry.summary["#text"]` | **完整中文警報全文**，可直接推播（見樣本），不必再抓 `.cap` |
| `msgType` | `entry.msgType` | `Alert`（首發）／`Update`（更新）／`Cancel`（解除） |
| `status` | `entry.status` | 實測全部 `Actual`（保險起見過濾非 Actual） |
| `effective` | `entry.effective` | 生效時間，格式 `"2026/7/7 下午 05:03:00"`（中文上午/下午，非 ISO） |
| `expires` | `entry.expires` | 失效時間，同上格式 |
| `updated` | `entry.updated` | ISO8601+08:00，供次要去重比對 |
| `capUrl` | `entry.link["@href"]` | 指向 `.cap` XML（本設計**不需**逐筆抓，見下） |

> **結論：`summary["#text"]` 已是可直接推播的完整中文句**（含機關、時間、影響範圍、注意事項），因此 v1 **不逐筆抓 `.cap`**（省流量、省時間、少一個失敗點）。`.cap` 僅作為「未來若要 CAP `<severity>` 精確分級」的備援（見 §7 風險與 §附錄）。

**類別 × 機關頻率（實測 944 筆）** — 決定過濾門檻的依據：

```
類別 category.@term        機關 author.name
 538 停水                   536 台灣自來水公司   ← 洗版來源，過濾
 233 水庫放流               283 水利署           ← 多為例行洩洪，過濾
  48 淹水                    93 中央氣象署
  33 高溫                    24 內政部消防署
  27 雷雨                     2 交通部公路局
  24 火災                     2 臺北自來水事業處
  23 降雨（=豪大雨特報）      2 海洋保育署
   9 強風                     1 國家通訊傳播委員會
   2 道路封閉                 1 臺鐵公司
   2 海洋污染
   2 淹水感測
   1 市話通訊中斷
   1 地震
   1 鐵路事故
```

---

### 備援來源（Fallback，需**免費**授權碼）：CWA 開放資料

實測（同日）：

```
GET https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0033-001            → 401
GET https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0033-001?Authorization=DEMO → 401
body: "401 Forbidden: Authorization key is not correct."
```

- **需要**免費授權碼：`?Authorization=<token>`（token 形如 `CWA-XXXXXXXX-...`）。
- 取得方式（寫進使用者說明，本次**不註冊**）：到 `https://opendata.cwa.gov.tw/` →「加入會員」（免費）→ 登入後「取得授權碼」複製一組 token → 填進 Render 環境變數 `CWA_TOKEN`。
- 資料集：`W-C0033-001`（天氣特報）、`E-A0015-001`／`E-A0016-001`（地震報告），回 JSON（`records.*`）。
- **只有在 §7「Render IP 被 NCDR 擋」風險成真時才啟用**（config 開關 `CWA_TOKEN`，見 §config）。v1 預設走 NCDR 免金鑰。

> **一句話決策：採 NCDR `JSONAtomFeed.ashx`（免金鑰）為主；CWA token 為可選備援。** 唯一未能從本機驗證的是「Render 資料中心 IP 是否被 NCDR 阻擋」——本機（住宅/一般 IP）可達；此為部署後才測得的 caveat，見 §7。

---

## 2. 逐檔變更計畫（File-by-file）

### 2.1 新檔 `src/services/disasterAlert.js`（核心）

比照 `rateAlert.js`／`tutor.js`／`morning.js`：自我排程 `setTimeout` + `ticking` 防重入 + 持久化 state + 逐訂閱者依語言推播。**唯讀既有檔、只新增本檔**。

匯出（供 handler、index、測試用）：

```
module.exports = {
  parseAlerts,      // 純函式 (rawJsonText|object) → 正規化陣列（§3）
  fetchAlerts,      // 抓 NCDR feed（AbortController 8s）→ parseAlerts；失敗回 null
  subscribe,        // (userId, code) → 確認句（lang.alertOn）
  unsubscribe,      // (userId, code) → 確認句（lang.alertOff / alertOffNone）
  list,             // 讀訂閱名單
  start,            // 啟動輪詢排程
  tick,             // 單輪（供測試；不 .start()）
  _internal: { loadState, saveState, decideNew, markAllSeen, pruneState, PUSH_CATEGORIES },
};
```

內部常數（單一真實來源）：

```
FEED_URL   = 'https://alerts.ncdr.nat.gov.tw/JSONAtomFeed.ashx'
SUB_FILE   = 'alertSub.json'      // [{ userId }]  訂閱名單（比照 tutor.json）
STATE_FILE = 'alert-state.json'   // { seenIds: { "<id>": <updatedTsEpochMs> }, bootstrapped: true }
TICK_MS    = 5 * 60 * 1000        // 5 分鐘（見 §5 理由）
FETCH_TIMEOUT_MS = 8000           // 同 fuelPrice.js
STATE_CAP  = 3000                 // seenIds 上限（見 §5 修剪）
```

- **語言解析**：`lang.resolve(userId)`，`try/catch` 失敗回 `'zh-TW'`（比照 rateAlert.js 第 62–67 行）。
- **推播**：`client.pushMessage({ to, messages:[{ type:'text', text }] })`，個別 `.catch(() => {})`，一人失敗不影響其他人（比照 tutor.js `sendAll`）。
- **翻譯**：`ai.ask(...)`；失敗政策見 §4。
- **模組物件呼叫**：`fetchAlerts` 內部呼叫 `parseAlerts`、tick 內呼叫 `fetchAlerts`，測試以 stub 覆寫（比照 rateAlert.js 對 `exchangeRate.getRate` 的註解手法——**透過 module 物件呼叫，而非解構**，讓測試替換生效）。

### 2.2 `src/handler.js`（新增指令路由）

在「每日中文小老師」區塊（第 424–429 行）**附近**新增，比照其 `trimmed === '開啟學中文' || /^hoc tieng trung$/.test(asciiTrimmed)` 錨定寫法：

```
// ── 防災警報推播 ──────────────────────────────────
if (trimmed === '開啟警報' || /^bat canh bao$/.test(asciiTrimmed)) {
  return disasterAlert.subscribe(userId, await lang.resolve(userId));
}
if (trimmed === '關閉警報' || /^tat canh bao$/.test(asciiTrimmed)) {
  return disasterAlert.unsubscribe(userId, await lang.resolve(userId));
}
```

- 檔頭 `require('./services/disasterAlert')`（比照既有 service require）。
- `asciiTrimmed` 已於第 338 行由 `toAscii(trimmed)` 產生，直接沿用（`bật cảnh báo`→`bat canh bao`、`tắt cảnh báo`→`tat canh bao`，聲調已去除）。
- **錨定**：全字 `^...$` 精準比對，避免「警報」二字出現在閒聊中誤觸（比照 `^tet$` 的全訊息比對註解）。
- 放在 AI／food 等泛用路由**之前**（確定性指令優先，PRD F3「不加 AI 工具」）。

### 2.3 `src/lang.js`（新增語系字串 + getter + 匯出）

新增下列 table（六語，`ja/th/id`→`en` 回落，未知→`zh-TW`，比照既有每個 getter 的三元回落樣式）與對應 getter，並加進 `module.exports`：

| 常數 | getter | 用途 |
|---|---|---|
| `ALERT_ON` | `alertOn(code)` | `🌀 已開啟防災警報推播。有新的官方警報會即時通知你。\n關閉請輸入「關閉警報」。`（vi：`tắt cảnh báo`） |
| `ALERT_OFF` | `alertOff(code)` | 已關閉確認 |
| `ALERT_OFF_NONE` | `alertOffNone(code)` | 「你目前沒有開啟警報推播」 |
| `ALERT_TRANSLATE_FAIL` | `alertTranslateFail(code)` | 翻譯失敗前綴一行（§4），如 vi：`⚠️ (Dịch tự động thất bại, dưới đây là bản gốc tiếng Trung)` |
| — | `alertPush(code, a, translatedBody)` | **推播組裝器**：把類別 emoji＋標題＋機關＋時間＋內文組成一則（見下） |

`alertPush(code, alert, body)` 組裝規則（`body` 已是該語言譯文，或中文原文＋失敗前綴）：

```
{categoryEmoji} {localizedCategoryLabel}
{body}
🕒 {alert.effective} ~ {alert.expires}   ← 直接用 feed 原字串（中文時間格式亦可讀）
📢 {alert.agency}
```

- `categoryEmoji`：`地震🌐→🌏`、`颱風→🌀`、`豪雨/大雨/降雨→🌧`、`淹水→🌊`、`土石流→⛰`、`雷雨→⛈`、`高溫→🌡`、`強風→💨`、其他→`⚠️`。（表放 lang.js，單一真實來源。）
- `localizedCategoryLabel`：類別的六語顯示名（小對照表；查無用中文 category 原字）。
- **helpMenu**：在 `HELP_MENU` 的 zh/vi/en 三段各加一行（比照既有 tutor 行）：
  - zh：`🌀 防災警報：「開啟警報」｜關閉：「關閉警報」（颱風/地震/豪雨即時通知）`
  - vi：`🌀 Cảnh báo thiên tai: 「開啟警報」/「bật cảnh báo」｜tắt: 「關閉警報」/「tắt cảnh báo」`
  - en：`🌀 Disaster alerts: 「開啟警報」/「bật cảnh báo」｜off: 「關閉警報」`

### 2.4 `src/config.js`

```
disasterAlertTickMs: Number(process.env.ALERT_TICK_MS) || 5 * 60 * 1000, // 選填：輪詢間隔
cwa: { token: process.env.CWA_TOKEN || '' },  // 選填：僅備援來源用；不設＝走 NCDR
```

（不加進 `assertConfig` 必填檢查——皆為選填，維持「免金鑰優先」傳統。）

### 2.5 `src/index.js`

在 `listen` callback 內、`tutor.start();` 之後加一行（比照第 95–98 行）：

```
const disasterAlert = require('./services/disasterAlert'); // 檔頭 require
...
disasterAlert.start(); // 啟動防災警報輪詢排程
```

### 2.6 `src/store.js`

`KNOWN_KEYS` 陣列（第 13–17 行）加入兩個新檔（開機雲端還原用）：

```
'alertSub.json', 'alert-state.json',
```

---

## 3. `parseAlerts` 規格（純函式，精確）

**簽名**：`parseAlerts(raw) → Array<NormalizedAlert>`
`raw` 可為 JSON 字串或已 parse 物件（測試方便）。**任何壞輸入 → 回 `[]`，絕不 throw**（比照 fuelPrice.js `parsePrices` 的防禦性）。

**步驟**：
1. 若 `raw` 是字串 → `try { JSON.parse } catch { return [] }`。
2. 取 `feed.entry`；非陣列時：若為單一物件包成 `[entry]`，否則 `return []`。（feed 只剩 1 筆時 NCDR 可能回物件而非陣列——防禦。）
3. 逐筆映射到 NormalizedAlert，缺 `id` 或缺 `summary["#text"]` 的筆 → 跳過。
4. **過濾**（見下）不符者剔除。
5. 回傳存活筆陣列。

**NormalizedAlert 形狀**（PRD 驗收 1 要求 `{id, category, severity, title, area, effective, ...}`）：

```
{
  id,          // entry.id
  category,    // entry.category["@term"]
  agency,      // entry.author.name
  title,       // entry.title
  summary,     // entry.summary["#text"]  ← 推播正文來源
  msgType,     // 'Alert' | 'Update' | 'Cancel'
  status,      // 'Actual'
  severity,    // 由 category 對映的內部分級（'high'|'med'），feed 無此欄→我們推導（見下）
  area,        // 從 summary 擷取的「影響範圍」字串（若無→''；不影響邏輯，只供顯示）
  effective,   // entry.effective（原字串）
  expires,     // entry.expires（原字串）
  updated,     // entry.updated（ISO；供次要去重）
  dedupeKey,   // 見 §去重
}
```

> `severity`：feed **本身無** CAP severity 欄位（實測 944 筆 top-level 皆無 `severity`）。CAP `<severity>Severe</severity>` 只在 `.cap` XML 裡（實測可手解析，見附錄）。v1 **不抓 .cap**，改用「**類別即分級**」：`PUSH_CATEGORIES` 表把每個要推的類別標成內部 `high/med`，寫進 `severity` 欄。

### 過濾規則（嚴重度／類別）— 附實測理由

**只有同時滿足下列三條件的 entry 才是「可推候選」：**

1. **`status === 'Actual'`**（實測全部 Actual；防禦性保留）。
2. **`msgType === 'Alert'`**（**首發**）。
   → **排除 `Update` 與 `Cancel`**。實測：同一「高溫」特報一個下午被重發 5 次（`...1707`,`...1705`,`...1449`,`...1335`,`...1144` 皆 `Update`，只有 07:33 那筆是 `Alert`）。若不濾 `Update`，每次重發都是新 id → 洗版。濾 `Cancel`（解除通知，如「解除大雨特報」）避免推「沒事了」的低價值訊息。
   → **代價**：極少數「升級版」更新不會二次推。對家庭安全場景，「首發即推」已足夠且更不擾民；PRD §F2 也允許「同 id 升級版本可再推」為選配，v1 先不做（見 §7）。
3. **`category` ∈ `PUSH_CATEGORIES`**（白名單）：

| category | 內部 severity | 推？ | 實測理由 |
|---|---|---|---|
| `地震` | high | ✅ | 顯著有感地震報告（實測 summary 含規模/震度） |
| `颱風` | high | ✅ | 颱風警報（本季無樣本；CWA 類別命名，季內必現） |
| `海嘯` | high | ✅ | 罕見但最高優先 |
| `豪雨`／`大雨`／`降雨` | high | ✅ | 豪大雨特報（實測 `降雨` = 大雨特報，summary 明確） |
| `淹水` | high | ✅ | 淹水警戒（水利署） |
| `土石流` | high | ✅ | 土石流警戒（本季無樣本；季內必現） |
| `高溫` | med | ✅ | 極端高溫特報（實測含橙/黃燈號、38 度） |
| `強風` | med | ✅ | 陸上強風特報 |
| `雷雨` | med | ⚠️**預設關** | **實測 27 筆／半天**「大雷雨即時訊息」，最洗版。PRD §範圍 F1 明點「大雷雨即時訊息(低)」要濾。**v1 預設不推**，留在表中並標 `optIn:true`，之後要開再開。 |
| `停水`／`水庫放流`／`火災`／`道路封閉`／`海洋污染`／`市話通訊中斷`／`鐵路事故`… | — | ❌ | 非全國性天災、或例行/在地事件（停水 538 筆、水庫放流 233 筆＝最大宗噪音）。全部**不在白名單即不推**。 |

> **實測驗證**：套用「白名單類別 ∧ `msgType==='Alert'` ∧ `status==='Actual'`」後，944 筆 → **58 筆**（雷雨 27／淹水 16／高溫 7／降雨 6／地震 1／強風 1）。再把 `雷雨` 預設關 → **31 筆**。且這是「當下所有現行警示」的存量；實際每 5 分鐘輪詢只會看到**增量**（多數輪為 0 筆新警報）。

`area` 擷取（顯示用，非邏輯）：`summary` 內常含「影響範圍:…」或「(縣市鄉鎮)」。以寬鬆 regex 抓 `影響範圍[:：]([^。\n]+)`；抓不到就 `area=''`。**不因 area 為空而丟棄警報**（安全優先）。

### 去重（dedupe key、new vs seen、首次不回補）

**state 檔 `alert-state.json` 形狀**：

```
{ "bootstrapped": true, "seenIds": { "<entry.id>": <entry.updated 轉 epoch ms>, ... } }
```

- **dedupeKey = `entry.id`**（PRD 驗收 2 要求「同 id 不重推、新 id recognized as new」）。
  - 實測：`id` **非全域唯一**（944 筆僅 691 unique——同一警示的多 `.cap`／多分區可能共用 id）。因此 `seenIds` 用 **id → updated 時間戳** 的 map：同 id 重見即命中 seen，不重推；符合 PRD。
- **「新 vs 已見」判定**（`decideNew(alerts, state)`）：對每筆候選 `a`，若 `state.seenIds[a.id]` **不存在** → 視為新；否則 → 已見略過。
- **首次啟用不回補（no-backfill）— 精確語意**：
  - 開機後 state 為空（`bootstrapped` 未設 / `seenIds` 空）時的**第一次成功輪詢**：把當下**所有候選 id 全部寫入 `seenIds`**（`markAllSeen`），設 `bootstrapped=true`，**且完全不推播**（PRD §F2 首次啟用不灌舊警報；驗收 3）。
  - 之後每輪：只推 `seenIds` 中**不存在**的 id；推完（不論翻譯/推播成敗）即寫入 `seenIds`（先標記再處理，比照 tutor/morning「先標記再發」防重複——但見下方順序注意）。
  - **失敗輪不得污染 state**：`fetchAlerts` 回 `null`（500/逾時/斷網）→ 該輪 `return`，**不寫 state、不 bootstrap**（驗收 6）。故 bootstrap 只在**第一次成功**發生，不會因首輪失敗就誤標。
  - **訂閱時機無關**：state 是全域的（bot 一開機就 bootstrap），與個別使用者何時 `開啟警報` 無關。使用者訂閱後，只會收到「他訂閱時點之後、bot 新偵測到」的警報——這正是 PRD「啟用後新出現才推」的家庭直覺。

> **標記順序（重要，避免漏發 vs 重發的取捨）**：對每筆新警報，**先推播給所有訂閱者、再把該 id 寫入 seenIds**。理由：安全警報**寧可極端邊界重發一次，也不能漏發**（與 rateAlert「先發後清」精神一致）。重入已由 `ticking` guard 擋住；跨輪之間單筆推播即使 crash，下輪會重推該 id（可接受：安全訊息重一次 > 漏一次）。若團隊更在意零重複，可改「先加入 seenIds 再推」，但本設計選擇**安全優先**。

---

## 4. 翻譯與安全政策

**每筆新警報、對每位訂閱者**（依 `lang.resolve` 語言）：

- `code === 'zh-TW'` → 直接用中文 `summary`（不呼叫 AI）。
- 其他語言 → 呼叫 `ai.ask` 翻譯：

  ```
  system: `把以下台灣官方防災警報完整翻譯成${langName}，保留數字、地名、時間與 emoji，語氣簡潔明確，只輸出翻譯結果，不要加註解`
  user:   alert.summary
  ```
  `langName` 用既有 `WEATHER_LANG_NAME` 風格對照（vi=越南語、en=英文、ja=日文、th=泰文、id=印尼文）。

- **失敗政策（絕不漏發）**：`ai.ask` 依合約失敗時回 `''`（見 `ai.js` 第 143–146 行，never-throws）。
  - 若回空字串 → **推「中文原文 `summary`」＋開頭一行 `lang.alertTranslateFail(code)`**（該語言的「(自動翻譯失敗，以下為原文)」）。
  - **永不因翻譯失敗而略過該警報**（PRD §目標 3、驗收 4）。

- **配額註記**：Groq 免費額度。翻譯**只在「有新警報」時發生**（多數輪 0 次呼叫），且每筆新警報 × 非中文訂閱者數。以家庭 3–6 人、警報一天數則計，日呼叫量遠低於既有 tutor/morning，配額無虞。可再省：**同一則警報、同一語言只翻一次**，快取結果供多位同語言訂閱者共用（`Map<lang, translatedText>`，單輪內；比照 tutor.js「同一份課程內容、逐人只換語言包裝」精神）。

---

## 5. 輪詢頻率、state 成長與修剪

- **輪詢間隔 `TICK_MS = 5 分鐘`**（可用 `ALERT_TICK_MS` 覆寫）。理由：
  - feed 免金鑰、540 KB、425 ms，5 分鐘一次＝一天 288 次、約 155 MB/日，對 NCDR 與 Render 皆輕量、有禮貌。
  - **安全 vs 及時的權衡**：地震報告在震後 1–3 分鐘發布；5 分鐘輪詢最差延遲 5 分鐘，對「避難/掌握」情境可接受（家庭非專業防救災）。要更即時可調 3 分鐘；不建議 <2 分鐘（無收益、增負載）。颱風/豪雨特報以小時計，5 分鐘綽綽有餘。
- **自我排程**：`setTimeout(tick, TICK_MS)`（前一輪 `finally` 才排下一輪），`ticking` 防重入（比照 rateAlert.js）。
- **state 成長控制**（`seenIds` 無限成長風險，PRD 驗收/風險要求）：`pruneState(state)` 在每輪寫檔前執行——
  1. **依 `expires` 過期修剪**：把 `expires` 已過（解析中文時間 `YYYY/M/D 上午|下午 h:mm:ss` → epoch；早於 `now - 24h`）的 id 移除。過期警報不會再出現在 feed，其 id 無再比對價值。
  2. **硬上限**：若 `seenIds` 仍 > `STATE_CAP`（3000），依 `updated` 時間戳保留最新 3000 筆、砍最舊。
  - 修剪只砍「已過期/最舊」，不影響現行有效警報的去重正確性。實測現行存量 944 筆、unique 691，3000 上限有充足餘裕（即便颱風天暴增）。

---

## 6. 測試策略（對應 PRD 驗收 1–7；一律用本機 mock feed，不真連）

**共通規範**（PRD §驗收 7）：測試**不 require `index.js`、不呼叫 `.start()`**；結尾 `process.exit(0)`；**測試前備份 `data/`、測後還原**（stub `store` 或用臨時檔）；`node --check` 全過；不回歸既有功能。

**mock feed**：把 §1 的真實 JSON 樣本（雷雨/地震/高溫/降雨/淹水各數筆＋停水/水庫放流噪音筆＋一筆 `msgType:'Cancel'` 解除筆）存成 fixture 常數。用 `node http.createServer` 起本機 server 回這份 JSON；另備一條路徑回 `500` 供失敗測試。`fetchAlerts` 的 URL 以 `_internal` 或環境變數注入 mock。`ai.ask`／`client.pushMessage` 以 stub 覆寫（module 物件替換，比照 rateAlert 註解手法）。

| # | 對應驗收 | 測項 | 預期 |
|---|---|---|---|
| T1 | 1 | `parseAlerts(mock)` 純函式 | 回正規化陣列；含「降雨(大雨特報)」「大雷雨即時訊息」的混合樣本 → 只留白名單且 `雷雨` 依預設關被濾；壞 JSON/空字串 → `[]` 不 throw |
| T2 | 3 | **首次啟用不回補** | state 空 + feed 3 筆候選 → 第一輪 `markAllSeen`，**推播 0 次**、`seenIds` 記 3 筆、`bootstrapped=true` |
| T3 | 2 | **去重** | 承 T2，同一 feed 連跑第二輪 → **0 筆新**、推播 0 次；state 不變 |
| T4 | 2/3 | **新 id 出現才推** | 承 T3，feed 加入第 4 筆新 id → 只推該 1 筆；`seenIds` 變 4 筆 |
| T5 | 4 | **推播＋翻譯** | 1 vi 訂閱者 + stub `ai.ask` 回越南語 → 收到越南語譯文（`alertPush` 格式正確） |
| T6 | 4 | **翻譯失敗不漏發** | stub `ai.ask` 回 `''` → 推**中文原文 + `alertTranslateFail(vi)` 前綴**（絕不略過） |
| T7 | 4 | **未訂閱者不收** | 0 訂閱者 → 有新警報但推播 0 次；不呼叫 ai.ask |
| T8 | 5 | **訂閱指令** | `subscribe('u','vi')`→回 vi 確認句＋寫入 `alertSub.json`；`unsubscribe` 移除並回 vi 關閉句；未訂閱者 `unsubscribe`→回 `alertOffNone` |
| T9 | 6 | **排程失敗容錯** | mock 回 500 / 逾時 → 該輪跳過：不推、**不寫 state、不 bootstrap**、不 crash；下一輪換成 200 → 正常 bootstrap/推播 |
| T10 | 6 | **防重入** | 手動並發呼叫兩次 `tick` → 第二次因 `ticking` 立即返回，不重複推 |
| T11 | 1 | **嚴重度/類別過濾（混合樣本）** | 樣本含 `停水`/`水庫放流`/`Cancel解除`/`Update重發` → 全數被濾；只留 `Alert` + 白名單 |
| T12 | 5 | **越南語直達指令** | `handler` 收 `bật cảnh báo`/`tắt cảnh báo`（→`bat canh bao`/`tat canh bao`）→ 正確路由到 subscribe/unsubscribe |
| T13 | 7 | **KNOWN_KEYS 完整** | 斷言 `store._internal.KNOWN_KEYS` 含 `alertSub.json`、`alert-state.json` |

---

## 7. 風險與緩解

| 風險 | 影響 | 緩解 |
|---|---|---|
| **Render 資料中心 IP 被 NCDR 阻擋**（本機可達，雲端未知——**唯一未能實測**） | 主來源全失效 | ①`fetchAlerts` 失敗只是「該輪跳過」，不 crash（已設計）。②備援：`CWA_TOKEN` 環境變數 → 切到 CWA 開放資料（§1 已документ endpoint/auth/JSON 形狀）。config 開關；使用者照 §1 指引免費註冊。③部署後首日觀察 log「連不上 NCDR」頻率決定是否切換。 |
| **feed 格式改版**（欄位/端點變動；舊 `.aspx` 已證實會被廢） | 解析失敗 | `parseAlerts` 防禦性（缺欄跳過、壞 JSON 回 `[]`），最差是「沒推」而非 crash；log 記錄異常。以 category/msgType 白名單為準，抗欄位新增。 |
| **警報洗版**（雷雨 27 筆/半天、停水 538 筆） | 家人被疲勞轟炸、退訂 | 白名單類別 + `msgType==='Alert'` 首發過濾（實測 944→31）；`雷雨` 預設關。門檻集中在 `PUSH_CATEGORIES` 單表，易調。 |
| **翻譯成本/失敗**（Groq 免費額度） | 額度耗盡或空翻譯 | 只在有新警報時翻、同語言單輪快取一次、翻譯失敗回中文原文＋提示（安全不漏發）。日呼叫量遠低於 tutor/morning。 |
| **漏掉真緊急事件**（輪詢間隔太長） | 地震/避難延遲 | 5 分鐘間隔（最差延遲 5 分）；可用 `ALERT_TICK_MS` 下修至 3 分。地震報告本身震後數分鐘才發，端到端仍在可接受窗內。 |
| **state 檔無限成長**（seenIds） | 檔案膨脹、雲端同步變慢 | `pruneState`：依 `expires` 過期砍 + 硬上限 3000（§5）。 |
| **「首發即推、不推 Update 升級版」** | 極少數警報升級（如颱風海警→陸警）不會二次推 | v1 取捨（避免洗版 > 抓每次升級）。若未來要補：可在 dedupe 改為 `id` + `msgType` 皆比對，或抓 `.cap` 讀 `<severity>` 升級才重推（附錄提供解析法）。 |

---

## 附錄：`.cap` XML 手解析（備援，v1 不用）

實測 `.cap`（`Content-Type: application/xml`，約 18 KB）內含 CAP 1.2 標準欄位，可用 **fuelPrice.js 同款字串/正則**（無 XML 套件）擷取。實測某「高溫」`.cap`：

```
<event>高溫</event>          → 'High Temperature'
<severity>Severe</severity>  → CAP 分級 Extreme/Severe/Moderate/Minor
<urgency>Future</urgency>
<certainty>Likely</certainty>
<areaDesc>臺南市楠西區</areaDesc>  （多筆，實測 58 個 areaDesc）
```

擷取法（與 `fuelPrice.js parsePrices` 同風格）：

```
const pick = (xml, tag) => (xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`)) || [])[1] || null;
const areas = [...xml.matchAll(/<areaDesc>([\s\S]*?)<\/areaDesc>/g)].map(m => m[1].trim());
```

> 若日後要「用 CAP `<severity>` 精確分級」或「升級才重推」，即以此逐筆抓 `entry.link["@href"]`（`.cap`）並手解析——但代價是每筆多一次 fetch、多一個失敗點，故 v1 以「類別即分級 + summary 直推」為準，不抓 `.cap`。

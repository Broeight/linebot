# 技術設計：查詢離自己最近的加油站（gas-station）（DESIGN）

**版本** v1.0 | **日期** 2026-07-02 | **作者** 軟體架構師（RD#1）
**對應 PRD** `docs/loop/gas-station/PRD.md`
**分支** `feat/nearest-gas-station`

---

## ✅ 需要金鑰：否

資料來源採用**台灣中油開放資料 JSON 端點**（政府資料開放平臺資料集 #6065「台灣中油公司加油站服務資訊」，
資料提供者為台灣中油），**免金鑰、免特殊 header、免瀏覽器偽裝**，與既有 `fuelPrice.js`
**同一台主機**（`vipmbr.cpc.com.tw`），該主機已在本專案 production 環境驗證可達。
本案**不新增任何 API 金鑰、環境變數、npm 套件**。

### 資料來源實測結果（2026-07-02，架構師以 `node -e` + 原生 fetch 實測）

#### ✔ 採用：候選 A — 台灣中油加油站開放資料（JSON）

**coder 必須使用的 URL（唯一資料端點）：**

```
https://vipmbr.cpc.com.tw/openData/getStationInfo
```

（資料集頁面：https://data.gov.tw/dataset/6065 ；同資料另有 XML 版
`https://vipmbr.cpc.com.tw/CPCSTN/STNWebService.asmx/getStationInfo_XML`，本案不用，JSON 版直接可 `res.json()`。）

實測數據（真實請求，非文件抄錄）：

| 項目 | 實測值 |
|---|---|
| HTTP 狀態 / Content-Type | `200` / `application/json; charset=utf-8` |
| 請求方式 | 純 `fetch(URL)`，**無任何 header、無金鑰** |
| 回應大小 | **1,111,988 bytes（約 1.1 MB）** |
| 耗時 | 約 1.0 秒 |
| 筆數 | **1,971 筆**（頂層即為 JSON 陣列） |
| 座標系 | **WGS84**（`緯度` 21.94–26.16、`經度` 118.24–121.99，含金門/馬祖離島；**不是 TWD97**，TWD97 TM2 會是數十萬公尺級的數值。**免轉換，直接 haversine**） |
| 座標型別 | 全部 1,971 筆皆為 `number`（無字串、無空值、無 0，座標異常筆數實測 = 0） |
| 欄位 | `站代號, 類別, 站名, 縣市, 鄉鎮區, 地址, 電話, 服務中心, 營業中, 國道高速公路, 無鉛92, 無鉛95, 無鉛98, 酒精汽油, 煤油, 超柴, 會員卡, 刷卡自助, 自助柴油站, 電子發票, 悠遊卡, 一卡通, HappyCash, 經度, 緯度, 營業時間, 洗車類別, etag申裝儲值時間, 保養間時間` |

**真實樣本紀錄（原樣貼上，欄位名以此為準，全部是中文欄位名）：**

```json
{
  "站代號": "AA6212A03",
  "類別": "加盟站",
  "站名": "台東",
  "縣市": "台東縣",
  "鄉鎮區": "台東市",
  "地址": "豐谷里15鄰中華路二段515號",
  "電話": "(089)343542",
  "服務中心": "D611C",
  "營業中": "1",
  "國道高速公路": 0,
  "無鉛92": 1,
  "無鉛95": 1,
  "無鉛98": 0,
  "酒精汽油": 0,
  "煤油": 0,
  "超柴": 1,
  "會員卡": 1,
  "刷卡自助": 1,
  "自助柴油站": 0,
  "電子發票": 1,
  "悠遊卡": 0,
  "一卡通": 0,
  "HappyCash": 0,
  "經度": 121.1318,
  "緯度": 22.7411,
  "營業時間": "06:30-21:30",
  "洗車類別": "",
  "etag申裝儲值時間": "",
  "保養間時間": ""
}
```

實測資料品質備註（coder 依此寫防禦）：

- **`營業中` 只有兩種值：`'1'`（1,961 筆）與 `'3'`（10 筆，推測為暫停營業）→ 只保留 `營業中 === '1'`**。
- **`地址` 大多不含縣市**：實測 1,971 筆中只有 4 筆地址已含縣市、3 筆已含鄉鎮區（但無縣市，其中一筆用「臺南市」正體臺）。
  完整地址須自行組合，規則見 §三 3.2 `fullAddress`。
- 少數地址尾端有全形空白（`String.prototype.trim()` 可去除）、少數地址含括號附註（如「(國假、日公休…)」），照原樣顯示即可。
- 以台北車站（25.0478, 121.5170）實測最近 5 站：`林森北路站 0.73km → 吉林路站 1.38km → 新生北路站 1.49km →
  民權西路站 1.69km → 桂林路站 1.71km`，結果合理；haversine 台北車站↔高雄車站實測 **294.9 km**（已知值 ≈297±3，通過）。

#### ✘ 不用：候選 B — OpenStreetMap Overpass API（附實測失敗證據）

實測（POST `https://overpass-api.de/api/interpreter`，body `data=[out:json][timeout:8];node(around:5000,25.0478,121.5170)[amenity=fuel];out 20;`）：

1. **無 User-Agent** → `HTTP 406 Not Acceptable`（Apache 直接擋）。
2. **加 User-Agent 重試** → `HTTP 504 Gateway Timeout`（8.5 秒後）。
3. **改打鏡像 `overpass.kumi.systems`** → 一樣 `HTTP 504`，且耗時 **82 秒**才回。

結論：Overpass 是共享的公益服務，有嚴格流量管制與不穩定的回應時間，三次實測**零成功**；
即使成功，OSM 的站名/地址 tag 品質參差（很多站沒有 `addr:*`）。**不採用，也不做為 runtime 備援**
（備援一個比主源更不可靠的來源沒有意義）。

#### 備援聲明（fallback statement）

- 主源失敗（逾時/非 200/解析失敗）時：**若記憶體中還有過期舊快取 → 直接用舊快取**
  （加油站站點資料變動極慢，過期一天仍堪用）；**完全無快取 → 回使用者語言的「目前查不到，請稍後再試」**（見 §八）。
- 不接任何需金鑰服務（Google Places 等，PRD 範圍外）。

覆蓋度取捨：本資料只含中油體系（直營＋加盟）1,971 站，不含台亞/福懋/全國等民營品牌（全台總數約 2,500）。
可接受：中油是全台密度最高、離島也有的網絡，「離我最近的中油站」對家人加油場景已足夠；
資料品質（官方中文站名、地址、營業時間、座標零異常）遠勝 OSM。

---

## 〇、一句話總結

新增 `src/services/gasStation.js`：開機後首次查詢時抓中油 1,971 站 JSON（24h 記憶體快取、6s 逾時、瘦身成
`{name, addr, lat, lon}` 陣列約 300KB），以純函式 `haversineKm` 排序取最近 ≤5 站回格式化文字。
`handler.replyForEvent` 新增 `message.type === 'location'` 路由（原本回 null）；中文關鍵字「加油站」與
AI 工具 `find_gas_station` 都能引導出「請分享位置」多語言提示＋ **LINE Quick Reply `location` 按鈕**。
AI 路徑完全仿 PR #2 的 `traChoice.consumeFresh` 模式：工具在 `gasStation` 內建立 pending（`ask` 或 `result` 兩種），
handler 在 AI fallback 之後 `consumePending` 一次性覆寫模型輸出——**單一確定性機制，不依賴模型排按鈕或轉抄 URL**。
使用者位置只放記憶體（30 分鐘 TTL），不落地、不進對話記憶。`index.js` 不用改（管線已支援 `{text, quickReply}`）。

---

## 一、受影響檔案清單（file-by-file change list）

| 檔案 | 動作 | 為什麼／改什麼 |
|---|---|---|
| `src/services/gasStation.js` | **新增** | 全部核心邏輯：站點資料 fetch＋24h 快取＋瘦身（`fetchStationList`／純函式 `slimStations`、`fullAddress`）；純函式 `haversineKm`；`findNearest(lat,lon,max=5)`；純函式 `formatList(list)`；per-user `lastLocation` 記憶體存放（TTL 30 分，**PRD F6 決定：做**，見 §三 3.5）；per-user pending 覆寫機制（`setPending`／`consumePending`，仿 traChoice，見 §三 3.6）。 |
| `src/handler.js` | **修改** | (a) `replyForEvent` 新增 `msg.type === 'location'` 分支 → 新函式 `handleLocation(userId, msg)`；(b) `handleText` 新增「加油站」關鍵字路由（在台鐵路由之後、發票之前）；(c) AI fallback 之後、`traChoice.consumeFresh` 區塊**之後**，新增 `gasStation.consumePending` 覆寫區塊；(d) 新增小工具 `locationQuickReply(code)`；(e) `helpText()` 加一行加油站說明；(f) 匯出 `handleLocation`（供測試）。 |
| `src/tools.js` | **修改** | 新增工具定義 `find_gas_station`（無必填參數）；`run()` 新增 case：`lastLocation` 未過期 → 直接查並 `setPending({kind:'result', list})`；否則 `setPending({kind:'ask'})`，兩者都回帶標記英文字串給模型；`timeContext()` 加一句指示。 |
| `src/lang.js` | **修改** | 新增四張六語表與 getter：`shareLocationPrompt(code)`、`shareLocationLabel(code)`、`gasStationHeader(code)`、`gasStationFail(code)`（字串已在 §七寫死，coder 照抄）。 |
| `src/index.js` | **不改** | 已驗證：`handleEvent` 已正規化 `string \| {text, quickReply}`、空字串守門、5000 字 emoji-safe 截斷、`quickReply` 掛訊息物件（`index.js` 第 41–57 行）。location 事件的 `event.type === 'message'`，會正常進 `replyForEvent`。**零改動**。 |
| `src/store.js`／`src/config.js`／`.env.example`／`data/*` | **不改** | 免金鑰；位置與站點快取都不落地。 |

---

## 二、LINE 介面契約（兩個方向的精確形狀）

### 2.1 出：Quick Reply「傳送位置」按鈕（恰 1 顆）

`handler.js` 新增小工具（仿既有 `buildQuickReply`）：

```js
function locationQuickReply(code) {
  return {
    items: [
      {
        type: 'action',
        action: { type: 'location', label: lang.shareLocationLabel(code).slice(0, 20) },
      },
    ],
  };
}
```

- `action.type: 'location'`：使用者點了會**直接開 LINE 的位置分享畫面**；此 action **沒有 `text` 欄位**（與 `message` action 不同）。
- `label`：多語言（§七），**≤20 字**（LINE 硬限制），一律 `slice(0, 20)` 防禦。
- 恰好 **1 顆**（PRD 驗收 §4：「恰含一顆 `action.type==='location'` 的按鈕」）。
- 已知限制：location action **只在手機版 LINE 有效**，桌機版不顯示／不可用——PRD 可接受（家人都用手機），
  且提示句已教「＋ → 位置資訊」的手動路徑當替代。

### 2.2 入：LINE location 訊息事件形狀

webhook 送來的事件（`event.type === 'message'`）：

```js
event.message = {
  id: '...',
  type: 'location',
  title: '...',      // 選填（使用者選了地標才有）
  address: '...',    // 選填
  latitude: 25.0478, // Number
  longitude: 121.5170, // Number
}
```

`replyForEvent` 現況第 331–334 行對 location 回 `null`。改為（新分支插在 image 之後、`return null` 之前）：

```js
if (msg.type === 'location') return handleLocation(userId, msg);
```

---

## 三、`src/services/gasStation.js` 規格

### 3.1 常數（單一真實來源，仿 fuelPrice.js 風格）

```js
const ENDPOINT = 'https://vipmbr.cpc.com.tw/openData/getStationInfo';
const SOURCE = '台灣中油';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;   // 站點清單快取 24 小時（仿 traTrain fetchStations）
const FETCH_TIMEOUT_MS = 6000;              // 6 秒 AbortController（同 traTrain）
const MAX_RESULTS = 5;                      // 最多回 5 站（PRD F3）
const LOCATION_TTL_MS = 30 * 60 * 1000;     // lastLocation 保留 30 分鐘（PRD F6）
const PENDING_TTL_MS = 3 * 60 * 1000;       // pending 覆寫旗標 TTL（同 traChoice）
```

### 3.2 資料抓取＋快取＋瘦身

模組級快取：`let cache = { ts: 0, list: null };`

**`slimStations(rawArray)`（純函式、匯出、可離線 fixture 測試）**：

- 過濾：`r['營業中'] === '1'`；座標守門 `typeof r['緯度'] === 'number' && typeof r['經度'] === 'number'
  && r['緯度'] > 20 && r['緯度'] < 27 && r['經度'] > 117 && r['經度'] < 123`（台灣含離島實測範圍 21.94–26.16 / 118.24–121.99）。
- 映射成瘦身紀錄：`{ name: String(r['站名']).trim(), addr: fullAddress(r), lat: r['緯度'], lon: r['經度'] }`。
- 1,971 筆瘦身後常駐記憶體約 **300 KB**（原始 1.1 MB 解析後即丟棄），可接受。

**`fullAddress(r)`（純函式、匯出）**——依實測邊界案例定的組合規則：

```js
function fullAddress(r) {
  const addr = String(r['地址'] || '').trim();          // trim 會去掉實測見到的全形尾空白
  const norm = addr.replace(/臺/g, '台');               // 實測有 1 筆地址用「臺南市」
  const city = String(r['縣市'] || '').trim();
  const dist = String(r['鄉鎮區'] || '').trim();
  if (city && norm.includes(city)) return addr;          // 實測 4 筆地址已含縣市 → 原樣
  if (dist && norm.includes(dist)) return city + addr;   // 實測 3 筆已含鄉鎮區 → 只補縣市
  return city + dist + addr;                             // 其餘 1,964 筆 → 縣市+鄉鎮區+地址
}
```

**`fetchStationList()`（內部 async）**：

1. 快取未過期 → 回 `cache.list`。
2. `AbortController` 6 秒逾時，`fetch(ENDPOINT, { signal })`；`!res.ok` → 走失敗路徑。
3. `const raw = await res.json();` 非陣列或 `slimStations(raw)` 為空 → 失敗路徑。
4. 成功 → `cache = { ts: Date.now(), list };` 回 `list`。
5. **失敗路徑**：`catch`/非 200 一律——**若 `cache.list` 存在（即使過期）→ 回舊快取**；否則回 `null`。
   （站點資料變動極慢，stale 一天仍堪用；此為對 fuelPrice 模式的小幅強化，PRD 驗收 §6 容錯。）

### 3.3 `haversineKm(lat1, lon1, lat2, lon2)`（純函式、匯出）

```js
const R = 6371; // km
const rad = (d) => d * Math.PI / 180;
const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
const h = Math.sin(dLat / 2) ** 2 +
          Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
return 2 * R * Math.asin(Math.sqrt(h));
```

實測：`haversineKm(25.0478, 121.5170, 22.6394, 120.3025)` = **294.9 km**（PRD 驗收 §1 已知值 ≈297±3，通過）。

### 3.4 `findNearest(lat, lon, max = MAX_RESULTS)`（async、匯出）

1. **垃圾座標守門**：`typeof lat/lon !== 'number'`、`!Number.isFinite`、`lat < -90 || lat > 90`、
   `lon < -180 || lon > 180` → 回 `null`（上層回 fail 訊息，不 crash）。
2. `const list = await fetchStationList();` 為 `null` → 回 `null`。
3. `list.map(s => ({ ...s, km: haversineKm(lat, lon, s.lat, s.lon) }))`，依 `km` 升冪排序，`slice(0, Math.min(max, MAX_RESULTS))`。
   （1,971 筆全排序 O(n log n)，毫秒級，不需空間索引。）
4. 回 `Array<{name, addr, lat, lon, km}>`（一定 ≥1 筆，因為清單非空、無距離上限——使用者在國外時會回很遠的站，無害）。

### 3.5 per-user 最近位置（PRD F6 —— 決定：**做**）

理由：只需一個 Map ＋ TTL 惰性過期（約 15 行，與 traChoice 同款模式），卻讓 (a) AI 工具能「已分享過位置就直接回結果」、
(b) 30 分鐘內再打「加油站」不用重新分享——體驗提升大、複雜度極低，做。

```js
const lastLocation = new Map(); // userId → { lat, lon, ts }

function noteLocation(userId, lat, lon) { lastLocation.set(userId, { lat, lon, ts: Date.now() }); }
function getLocation(userId) {
  const p = lastLocation.get(userId);
  if (!p) return null;
  if (Date.now() - p.ts > LOCATION_TTL_MS) { lastLocation.delete(userId); return null; }
  return p; // { lat, lon, ts }
}
```

隱私：**只在這個 Map**，永不 `store.save`、永不進 `conversation`（§九）。

### 3.6 pending 覆寫機制（AI 路徑的**唯一**確定性機制——決策說明）

**為什麼不用「handler 檢查工具回傳的標記字串」**：`ai.chat` 在內部執行工具，handler 只拿得到模型最終文字，
看不到工具回傳值——這正是 PR #2 採 `consumeFresh` 旗標而非字串檢查的原因。**本案沿用同一模式**，
且擴充成兩種 kind，讓「需要位置」與「已有結果」共用一個機制（結果不經模型轉抄 → URL 不會被改壞）：

```js
const pending = new Map(); // userId → { kind: 'ask' } | { kind: 'result', list } （+ ts, fresh）

function setPending(userId, record) {
  record.ts = Date.now();
  record.fresh = true;
  pending.set(userId, record);
}
function consumePending(userId) {   // 一次性：回 record 或 null
  const p = pending.get(userId);
  if (!p) return null;
  if (Date.now() - p.ts > PENDING_TTL_MS) { pending.delete(userId); return null; }
  if (!p.fresh) return null;
  p.fresh = false;
  pending.delete(userId);           // 用完即清（與 traChoice 不同：本案不需要事後 matchCandidate，直接刪）
  return p;
}
```

### 3.7 `formatList(list)`（純函式、匯出）——輸出格式規格

輸入 `findNearest` 的結果陣列，輸出**不含標題**的條列字串（標題由 handler 用 `lang.gasStationHeader(code)` 加，
達成「標題多語言、站名地址中文原文」——PRD F5）：

- 每筆三行：
  ```
  {序號}. {name}（{距離}）
     {addr}
     https://www.google.com/maps?q={lat},{lon}
  ```
- **距離**：`km < 1` → ``${Math.round(km * 1000)} 公尺``；否則 → `` `${km.toFixed(1)} 公里` ``（PRD「公尺/公里」）。
- **URL**：`lat`/`lon` 各取 `toFixed(6)`（原始資料最多 13 位小數，6 位＝約 0.1m 精度足夠）。
  **裸 URL、自成一行、不加任何括號或 markdown**——LINE 會自動轉可點連結，點了會開 Google Maps 並可一鍵導航。
- 筆與筆之間以 `\n` 相接（每筆內部已含換行）；第二、三行前置 3 個半形空白縮排。
- 長度概算：5 筆 × 約 90 字 ≈ 450 字，加標題遠低於 5000 字上限（`index.js` 截斷是最後保險）。

**完整回覆範例（zh-TW，真實資料）：**

```
⛽ 離你最近的加油站：

1. 林森北路站（730 公尺）
   台北市中正區林森北路11號
   https://www.google.com/maps?q=25.045833,121.523889
2. 吉林路站（1.4 公里）
   台北市中山區吉林路31號
   https://www.google.com/maps?q=25.050833,121.530278
```

### 3.8 匯出

```js
module.exports = {
  findNearest, formatList, haversineKm,          // 查詢＋純函式
  noteLocation, getLocation,                     // lastLocation（F6）
  setPending, consumePending,                    // AI 路徑覆寫機制
  slimStations, fullAddress,                     // 純函式（離線測試用）
  MAX_RESULTS, LOCATION_TTL_MS,
};
```

---

## 四、`src/handler.js` 變更

### 4.1 `handleLocation(userId, msg)`（新函式）

```js
async function handleLocation(userId, msg) {
  const { latitude, longitude } = msg;
  const code = await lang.resolve(userId);
  gasStation.noteLocation(userId, latitude, longitude);      // 只進記憶體（30 分 TTL）
  const list = await gasStation.findNearest(latitude, longitude);
  if (!list || list.length === 0) return lang.gasStationFail(code);
  return lang.gasStationHeader(code) + '\n\n' + gasStation.formatList(list);
}
```

- 垃圾座標由 `findNearest` 守門（回 `null` → fail 訊息），handler 不重複驗證。
- **不呼叫 `conversation.append`**（隱私：位置與結果都不進對話記憶，見 §九）。
- 回純字串 → `index.js` 走既有字串路徑。

### 4.2 關鍵字路由（`handleText`，插在「台鐵」區塊之後、「發票對獎」之前）

```js
// ── 加油站（找最近的）───────────────────────────────────
if (/^(?:最近的?加油站|附近的?加油站|加油站|哪裡加油|找加油站)$/.test(trimmed)) {
  const code = await lang.resolve(userId);
  const loc = gasStation.getLocation(userId);
  if (loc) {                                              // 30 分鐘內分享過位置 → 直接查（F6）
    const list = await gasStation.findNearest(loc.lat, loc.lon);
    if (!list || list.length === 0) return lang.gasStationFail(code);
    return lang.gasStationHeader(code) + '\n\n' + gasStation.formatList(list);
  }
  return { text: lang.shareLocationPrompt(code), quickReply: locationQuickReply(code) };
}
```

- 位置在既有路由順序中安全：無前綴衝突（「油價」規則要求結尾是「油價」，不會吃掉「加油站」；
  反之「加油站」正則是全字串錨定，不會吃掉「95油價」）。
- 語音說「加油站」→ 既有 `handleAudio` → `handleText` 同路由；`{text, quickReply}` 已可穿透語音前綴
  （`handler.js` 第 297–300 行，PR #2 已上線），**不用改**。

### 4.3 AI fallback 之後的覆寫（緊接在既有 `traChoice.consumeFresh` 區塊**之後**）

```js
// 本回合剛因 find_gas_station 建立 pending → 覆寫模型文字（確定性輸出）
const gasPending = gasStation.consumePending(userId);
if (gasPending) {
  const code = await lang.resolve(userId);
  if (gasPending.kind === 'ask') {
    return { text: lang.shareLocationPrompt(code), quickReply: locationQuickReply(code) };
  }
  // kind === 'result'：清單由 handler 直接組，URL 不經模型轉抄
  return lang.gasStationHeader(code) + '\n\n' + gasStation.formatList(gasPending.list);
}
return reply;
```

- 與 traChoice 區塊互斥（一回合只會有一個工具建立 pending），先後順序不影響正確性；放後面讓既有碼零改動。
- 模型那句話（brief ack）已 `conversation.append` 進記憶——內容只有「請分享位置」或「已找到，清單如下」的語意，
  **不含座標與站名清單**（隱私 OK）。

### 4.4 `locationQuickReply(code)` 小工具

形狀見 §2.1，放在既有 `buildQuickReply` 旁邊。

### 4.5 `helpText()` 加一行

在「⛽ 油價」之後加：`'⛽ 加油站：「加油站」→ 分享位置找最近的\n' +`。

### 4.6 匯出

`module.exports = { handleText, handleAudio, handleImage, handleLocation, replyForEvent };`

---

## 五、`src/tools.js` 變更

### 5.1 工具定義（加進 `defs` 陣列）

```js
{
  type: 'function',
  function: {
    name: 'find_gas_station',
    description:
      '尋找離使用者「目前位置」最近的加油站（台灣）。當使用者用任何語言（尤其越南語）' +
      '詢問加油站、最近的加油站、哪裡可以加油（gas station / trạm xăng / ガソリンスタンド / ปั๊มน้ำมัน / SPBU）時呼叫。' +
      '不需要參數；系統會使用使用者最近分享的位置，或自動引導使用者分享位置。',
    parameters: { type: 'object', properties: {} },
  },
},
```

### 5.2 `run()` 新 case

```js
case 'find_gas_station': {
  const loc = gasStation.getLocation(userId);
  if (loc) {
    const list = await gasStation.findNearest(loc.lat, loc.lon);
    if (list && list.length) {
      gasStation.setPending(userId, { kind: 'result', list });
      return (
        'GAS_STATIONS_FOUND: The nearest gas stations were found using the location the user shared recently. ' +
        'A formatted list (names, distances, addresses, map links) will be shown to the user directly. ' +
        'Reply briefly that you found them; do NOT invent station names or links.'
      );
    }
    return 'Cannot fetch gas station data right now. Tell the user to try again later.';
  }
  gasStation.setPending(userId, { kind: 'ask' });
  return (
    'NEEDS_LOCATION: Asked the user to share their current location. ' +
    'A "share location" button will be shown automatically. ' +
    'Reply briefly asking them to share their location; do NOT guess where they are.'
  );
}
```

（`require` 於檔頭加 `const gasStation = require('./services/gasStation');`。）

### 5.3 `timeContext()` 加一句

在既有台鐵那句之後追加：
`'若使用者用任何語言（含越南語）詢問加油站、最近的加油站、哪裡加油，就呼叫 find_gas_station 工具，不要自己編加油站名稱或地址。'`

---

## 六、`src/index.js` —— 驗證不需改動

- location 事件 `event.type === 'message'` → 進 `handler.replyForEvent`（新分支處理）。
- 回傳字串（位置查詢結果）與 `{text, quickReply}`（引導按鈕）兩型別，`handleEvent` 第 44–53 行已完整支援：
  正規化 → 空字串守門 → `Array.from` 5000 字截斷 → `quickReply` 掛訊息物件。**零改動**（PRD 依 PR #2 管線）。

---

## 七、`src/lang.js` 新增六語表（coder 照抄字串）

```js
// 「請分享位置」提示句（加油站引導用）
const SHARE_LOCATION_PROMPT = {
  'zh-TW': '請分享你目前的位置，我幫你找最近的加油站。點下方按鈕，或用聊天室的「＋」→「位置資訊」。',
  vi: 'Hãy chia sẻ vị trí hiện tại của bạn để mình tìm trạm xăng gần nhất. Bấm nút bên dưới, hoặc dùng「+」→「Vị trí」trong khung chat.',
  en: 'Please share your current location so I can find the nearest gas station. Tap the button below, or use "+" → "Location" in the chat.',
  ja: '現在地を共有してください。一番近いガソリンスタンドを探します。下のボタンを押すか、チャットの「＋」→「位置情報」から送れます。',
  th: 'กรุณาแชร์ตำแหน่งปัจจุบันของคุณ ฉันจะหาปั๊มน้ำมันที่ใกล้ที่สุดให้ กดปุ่มด้านล่าง หรือใช้ "+" → "ตำแหน่ง" ในแชท',
  id: 'Silakan bagikan lokasi Anda saat ini agar saya bisa mencari SPBU terdekat. Ketuk tombol di bawah, atau gunakan "+" → "Lokasi" di chat.',
};

// 「傳送位置」按鈕 label（≤20 字，LINE 硬限制）
const SHARE_LOCATION_LABEL = {
  'zh-TW': '📍 傳送位置',
  vi: '📍 Gửi vị trí',
  en: '📍 Send location',
  ja: '📍 位置を送る',
  th: '📍 ส่งตำแหน่ง',
  id: '📍 Kirim lokasi',
};

// 加油站結果標題列
const GAS_STATION_HEADER = {
  'zh-TW': '⛽ 離你最近的加油站：',
  vi: '⛽ Trạm xăng gần bạn nhất:',
  en: '⛽ Nearest gas stations:',
  ja: '⛽ 一番近いガソリンスタンド：',
  th: '⛽ ปั๊มน้ำมันที่ใกล้ที่สุด:',
  id: '⛽ SPBU terdekat:',
};

// 加油站資料取不到
const GAS_STATION_FAIL = {
  'zh-TW': '目前查不到加油站資料，請稍後再試 🙏',
  vi: 'Hiện không tra được dữ liệu trạm xăng, vui lòng thử lại sau 🙏',
  en: 'Cannot fetch gas station data right now, please try again later 🙏',
  ja: '現在ガソリンスタンド情報を取得できません。しばらくしてからもう一度お試しください 🙏',
  th: 'ขณะนี้ไม่สามารถดึงข้อมูลปั๊มน้ำมันได้ กรุณาลองใหม่ภายหลัง 🙏',
  id: 'Saat ini tidak bisa mengambil data SPBU, silakan coba lagi nanti 🙏',
};
```

Getter（仿 `chooseStationPrompt`，皆 fallback `'zh-TW'`）並匯出：
`shareLocationPrompt(code)`、`shareLocationLabel(code)`、`gasStationHeader(code)`、`gasStationFail(code)`。

---

## 八、錯誤處理

| 情境 | 行為 |
|---|---|
| fetch 逾時（6s AbortController）/ 非 200 / JSON 解析失敗 | `fetchStationList` 失敗路徑：有舊快取（即使過期）→ 用舊的；無 → `findNearest` 回 `null` → 直接路徑回 `lang.gasStationFail(code)`；AI 路徑回英文 fail 字串讓模型用使用者語言轉述。**永不 throw 到 handler 之外、不 crash**（PRD 驗收 §6）。 |
| 垃圾座標（非 number、NaN、超界） | `findNearest` 開頭守門回 `null` → fail 訊息。 |
| 使用者不點按鈕/不分享位置 | 什麼都不會壞：pending `ask` 3 分鐘 TTL 惰性過期；quickReply 按鈕本來就會在使用者送出下一則訊息後消失（LINE 行為）。 |
| `ai.chat` 在工具設 pending 後 throw | pending 殘留，最壞情況是 3 分鐘內下一則訊息被覆寫成「請分享位置」一次（TTL＋consume 即刪限制影響範圍）；與 traChoice 同款既有接受風險。 |
| 伺服器重啟 | 三個 Map（站點快取／lastLocation／pending）清空，首次查詢重抓、使用者重新分享位置即可（PRD 隱私設計的自然結果）。 |

---

## 九、隱私

- 經緯度**只存在** `gasStation.js` 的 `lastLocation` Map（RAM、TTL 30 分、重啟即消失）。
- **永不** `store.save`（不寫 `data/*.json`）、**永不**寫 log。
- **不進對話記憶**：`handleLocation` 與關鍵字直接路徑都不 `conversation.append`；
  AI 路徑進記憶的只有模型的一句 brief ack（不含座標、不含站名清單——清單由 handler 覆寫直出）。
- LINE 訊息中的 `title`/`address`（使用者選的地標名）除了讀 `latitude`/`longitude` 外一律不使用、不儲存。

---

## 十、測試策略（對應 PRD 驗收條件 1–7；獨立 node 腳本放 `tests/`，仿既有慣例）

### 10.1 驗收 §1：haversine 純函式（離線）

- `haversineKm(25.0478, 121.5170, 22.6394, 120.3025)` ∈ [294, 300]（架構師實測 294.9）。
- 同點 → 0；短距離已知對（台北車站↔林森北路站實測 0.73 km）誤差 <1%。

### 10.2 驗收 §2：最近站查詢（線上）

- `await findNearest(25.0478, 121.5170)` → 長度 ≥1 且 ≤5；`km` 升冪（逐對斷言 `a.km <= b.km`）；
  每筆 `name` 非空、`addr` 非空。
- `formatList(list)`（離線可測，餵假陣列）→ 每筆含 `https://www.google.com/maps?q=` 且 URL 內含經緯度數字；
  `km=0.73` → 顯示 `730 公尺`；`km=1.38` → 顯示 `1.4 公里`。
- `slimStations`／`fullAddress` 離線 fixture：用 §一 的真實樣本＋三筆邊界案例
  （地址含縣市／含鄉鎮區＋臺字／一般）斷言組合結果；`營業中:'3'` 被濾掉；座標字串或超界被濾掉。

### 10.3 驗收 §3：location 訊息路由（線上，經 `replyForEvent`）

- 假事件 `{ type:'message', source:{userId:'test-u'}, message:{ type:'location', id:'x', latitude:25.0478, longitude:121.5170 } }`
  → `replyForEvent` 回**非空字串**、含 `https://www.google.com/maps?q=`。
- 回歸：`{type:'message', message:{type:'text', text:'油價查詢'}}` 仍回字串；sticker/video 事件仍回 `null`。

### 10.4 驗收 §4：引導提示（離線＋單元）

- `handleText('test-u2', '加油站')`（無 lastLocation）→ 回物件：`quickReply.items.length === 1`、
  `items[0].action.type === 'location'`、`items[0].action.label` 非空且長度 ≤20、`text` 非空。
- AI 路徑允許工具層直測＋覆寫邏輯單測（PRD 明訂真 AI 不穩可替代）：
  1. `await tools.run('test-u3', 'find_gas_station', '{}')`（無位置）→ 回字串以 `NEEDS_LOCATION` 開頭；
  2. `gasStation.consumePending('test-u3')` → `{ kind:'ask', ... }`；再呼叫一次 → `null`（一次性）。
  3. `gasStation.noteLocation('test-u4', 25.0478, 121.5170)` 後 `tools.run('test-u4', 'find_gas_station', '{}')`
     → 回 `GAS_STATIONS_FOUND` 開頭；`consumePending('test-u4')` → `{ kind:'result', list }` 且 `list.length ≥1`。
- lastLocation TTL：`noteLocation` 後把內部 `ts` 撥回 31 分鐘前（或匯出的 `LOCATION_TTL_MS` 加假時間）→ `getLocation` 回 `null`。

### 10.5 驗收 §5：多語言（離線）

- 對 `['zh-TW','vi','en','ja','th','id']` 逐一斷言 `shareLocationPrompt`／`shareLocationLabel`／
  `gasStationHeader`／`gasStationFail` 皆非空字串；`vi` 版含 `'vị trí'` 或 `'trạm xăng'`；未知 code fallback zh-TW。

### 10.6 驗收 §6：失敗容錯（離線）

- 暫時把 `global.fetch` 換成 `() => Promise.reject(new Error('down'))`（測完還原），且快取為空
  → `findNearest(25, 121.5)` 回 `null`（不 throw）；`handleLocation` 據此回 fail 字串。
- `findNearest('abc', null)`／`findNearest(999, 999)` → `null`。

### 10.7 驗收 §7：語法與回歸

- `node --check` 清單：`src/services/gasStation.js`、`src/handler.js`、`src/tools.js`、`src/lang.js`
  （`src/index.js` 未改，仍列入 check 保險）。
- 回歸煙霧：`油價`、`台鐵 台北 台中`、`天氣 台北市`、一般聊天各跑一次不炸。

---

## 十一、風險與邊界（risks / edge cases）

1. **記憶體占用**：原始 JSON 1.1 MB 僅在解析瞬間存在；常駐為瘦身陣列約 300 KB＋兩個小 Map——遠低於疑慮門檻。
2. **座標系**：實測確認 WGS84（見 §一），無 TWD97 轉換需求；`slimStations` 的座標範圍守門可攔未來資料異常。
3. **覆蓋度**：只有中油體系 1,971 站（無台亞/福懋等民營站）。取捨已述（§一）；未來若要補民營站再評估能源署全量資料集，本版不做。
4. **Overpass**：已用三次真實請求證明不可靠（406/504/504-82s），本版完全不碰；若未來中油端點停用，備援方向是能源署/data.gov.tw 的全量加油站資料集（屆時需再實測），寫在此處供後人參考。
5. **quickReply location 按鈕僅手機有效**：桌機版 LINE 沒有此按鈕。可接受（PRD 場景是「在外面想加油」＝手機）；提示句已教「＋ → 位置資訊」替代路徑。
6. **使用者拒絕/忽略分享位置**：無任何狀態卡住；pending 3 分鐘過期，之後再問重新引導。
7. **群組聊天**：`event.source.userId` 在群組事件也存在（既有功能同樣依賴它），lastLocation 以 userId 為 key，不會混人；位置訊息在群組較少見，行為與 1:1 相同。
8. **使用者在國外傳位置**：仍會回台灣最近的站（可能數百公里）；顯示距離誠實呈現，無害，不特別處理。
9. **資料更新頻率**：中油資料不定期更新，站點增減極慢；24h 快取＋stale 備援綽綽有餘。
10. **`營業中='3'` 語意未有官方文件**：實測僅 10 筆；本案保守排除（寧可少列一站，不推薦可能停業的站）。
11. **與既有關鍵字互搶**：關鍵字正則全字串錨定（§4.2），與「油價」「台鐵」等規則實測無交集；
    pending 覆寫只在「本回合剛建立」時觸發一次（consume 即刪），不影響後續訊息。

---

## 十二、實作檢核清單（給工程師 RD#2）

- [ ] 新增 `src/services/gasStation.js`：常數（§3.1）、`slimStations`＋`fullAddress`（§3.2，含 `營業中==='1'` 過濾與座標守門）、`fetchStationList`（24h 快取＋6s 逾時＋stale 備援）、`haversineKm`（§3.3）、`findNearest`（§3.4，含垃圾座標守門）、`formatList`（§3.7，公尺/公里規則＋`toFixed(6)` 裸 URL）、`noteLocation`/`getLocation`（§3.5）、`setPending`/`consumePending`（§3.6），依 §3.8 匯出。
- [ ] `src/handler.js`：`require gasStation`；新增 `handleLocation`（§4.1，不進 conversation）；`handleText` 加關鍵字路由（§4.2，位置：台鐵之後、發票之前）；AI fallback 後加 `consumePending` 覆寫（§4.3，放在 traChoice 區塊之後）；新增 `locationQuickReply`（§2.1）；`helpText` 加一行；`replyForEvent` 加 location 分支（§2.2）；匯出 `handleLocation`。
- [ ] `src/tools.js`：`defs` 加 `find_gas_station`（§5.1，`parameters` 無必填）；`run()` 加 case（§5.2）；`timeContext()` 加一句（§5.3）。
- [ ] `src/lang.js`：加四張表（§七字串照抄）＋四個 getter＋匯出。
- [ ] **不改** `src/index.js`、`src/store.js`、`src/config.js`、`.env.example`。
- [ ] 自測 §十各項；`node --check` 全變更檔。

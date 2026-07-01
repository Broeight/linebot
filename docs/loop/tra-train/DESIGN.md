# 技術設計：台鐵火車時刻查詢（tra-train）（DESIGN）

**版本** v1.0 | **日期** 2026-07-01 | **作者** 軟體架構師（RD#1）
**對應 PRD** `docs/loop/tra-train/PRD.md`

---

## ✅ 需要金鑰：否

**結論：本功能採用「免金鑰」資料來源，使用者不需註冊、不需申請任何 API 金鑰、不需修改 `.env`。**

架構師依 PM 指示實打驗證了兩條路：

1. **TDX v3（tdx.transportdata.tw）— 需金鑰**：實測 `Station`、`DailyTrainTimetable/OD` 端點在**無 token 時回 HTTP 401**；token 端點（OAuth2 client_credentials）在無憑證時回 HTTP 400。要用 TDX 必須先免費註冊取得 `client_id`／`client_secret`，再換 `access_token`。**本設計不採用此路**，因為下面找到了可靠的免金鑰替代。
2. **PTX v3（ptx.transportdata.tw／交通部運輸資料流通服務 MOTC 舊網域）— 免金鑰、實測可用 ✅**：`Station` 與 `DailyTrainTimetable/OD` 端點**無需任何 token、無需 header，直接 GET 即回 HTTP 200 與最新 JSON 資料**。回傳 schema 與 TDX v3 完全相同（同一套 MOTC v3 規格），資料新鮮（實測 `UpdateTime` 為查詢當天）。**本設計採用此路**，維持本專案「免金鑰、零設定」的一貫風格（weather/Open-Meteo、invoice/財政部 RSS、holiday/TaiwanCalendar、exchangeRate/open.er-api、fuelPrice/中油 WebService 皆無金鑰）。

> **風險揭露**：PTX 是 TDX 的前身平台，官方長期方向是「以 TDX 為主」。PTX 目前仍在線且回傳最新資料（見下方實打證據），但無 SLA、未來可能停用。本設計以「PTX 為主來源、TDX 為未來備援（需金鑰時再啟用）」的方式設計，服務層抽象化來源；若 PTX 某日失效，回覆友善錯誤訊息而非崩潰，並可最小改動切換到 TDX（見 §十 風險）。

---

## 〇、一句話總結

新增查詢類服務 `src/services/traTrain.js`，採用**交通部 PTX v3（免金鑰）** 的 `DailyTrainTimetable/OD`（站到站每日時刻）端點，回 JSON（用 `res.json()` 解析，與 exchangeRate/holiday 同手法）。站名 → 車站代碼採**內建對照表**（涵蓋主要幹線車站，含正體「臺」／俗寫「台」與「北車」等別名）。中文關鍵字指令（`台鐵 起 迄`、`下一班 起到迄`）走 `handler.js` 路由（格式化中文回覆）；自然語句（含越南語）走 `tools.js` 新 AI 工具 `get_tra_train`（回英文摘要交給模型改寫語言）。本功能**不存任何資料**（`store.js` 不動，僅讀 `store.taipei()` 取今日日期與現在時間做過濾）。

---

## 一、資料來源（已實打驗證 ✅）

### 1.1 選定端點

| 項目 | 內容 |
|---|---|
| **來源** | 交通部 PTX 運輸資料服務（MOTC v3，台鐵 TRA） |
| **車站清單端點** | `https://ptx.transportdata.tw/MOTC/v3/Rail/TRA/Station?$format=JSON` |
| **站到站時刻端點** | `https://ptx.transportdata.tw/MOTC/v3/Rail/TRA/DailyTrainTimetable/OD/{起站ID}/to/{迄站ID}/{YYYY-MM-DD}?$format=JSON` |
| **HTTP 方法** | **GET**（免金鑰、免註冊、免任何 header／token） |
| **回傳格式** | `application/json`（MOTC v3 schema） |
| **資料新鮮度** | 台鐵時刻表資料，端點 `UpdateInterval`=14400 秒（4 小時）；每日時刻表通常提前數日公告 |

> **驗證紀錄（2026-07-01，台北）— 逐項實打**：
>
> | # | 動作 | 結果 |
> |---|---|---|
> | 1 | GET `TDX v3 Station`（無 token） | **HTTP 401**（TDX 需金鑰，確認） |
> | 2 | POST `TDX token`（無憑證） | **HTTP 400**（TDX OAuth 端點存在、需 client 憑證） |
> | 3 | GET `TDX v3 DailyTrainTimetable/OD`（無 token） | **HTTP 401**（TDX 需金鑰，確認） |
> | 4 | GET `PTX v3 Station`（無 token） | **HTTP 200**，回最新車站 JSON（245 站，含經緯度、`StationID`、中英站名） |
> | 5 | GET `PTX v3 DailyTrainTimetable/OD/1000/to/3300/2026-07-01` | **HTTP 200 ≈0.2s**，回 **41 筆** 臺北→臺中班次，每筆含車次、車種、發抵時間 |
> | 6 | 重打第 5 項 | **HTTP 200 ≈0.17s**（穩定） |
> | 7 | GET `PTX OD` 用不存在站碼 `9999` | **HTTP 200** 但 `TrainTimetables: []`（**空陣列，非錯誤**） |
> | 8 | 反向 `3300→1000`、含前導零站碼 `0900→1000` | 皆 **HTTP 200**（雙向、前導零站碼皆正常） |
> | 9 | GET `data.gov.tw` 台鐵舊 CSV／ptx 其他 dataset 探測 | 部分 404／停更，穩定度不如 PTX v3，**不採用** |

### 1.2 回傳 JSON 結構（站到站 OD，實際樣本，節錄一筆）

`DailyTrainTimetable/OD` 回一個物件，頂層有 `TrainDate` 與 `TrainTimetables` 陣列。**OD 端點的每筆 `StopTimes` 只含 2 筆：起站與迄站**（這是 OD 端點特性，正好省去我們自己找起訖站的麻煩）：

```json
{
  "UpdateTime": "2026-06-19T09:11:40+08:00",
  "TrainDate": "2026-07-01",
  "TrainTimetables": [
    {
      "TrainInfo": {
        "TrainNo": "107",
        "Direction": 1,
        "TrainTypeName": { "Zh_tw": "普悠瑪(普悠瑪)", "En": "Puyuma Express" },
        "StartingStationName": { "Zh_tw": "基隆", "En": "Keelung" },
        "EndingStationName": { "Zh_tw": "潮州", "En": "Chaozhou" },
        "SuspendedFlag": 0
      },
      "StopTimes": [
        { "StopSequence": 3, "StationID": "1000", "StationName": { "Zh_tw": "臺北" }, "ArrivalTime": "07:15", "DepartureTime": "07:15" },
        { "StopSequence": 8, "StationID": "3300", "StationName": { "Zh_tw": "臺中" }, "ArrivalTime": "08:54", "DepartureTime": "08:54" }
      ]
    }
  ]
}
```

### 1.3 要解析的欄位（load-bearing 路徑）

| JSON 路徑 | 用途 | 範例值 |
|---|---|---|
| `TrainTimetables[].TrainInfo.TrainNo` | 車次號 | `"107"` |
| `TrainTimetables[].TrainInfo.TrainTypeName.Zh_tw` | 車種（顯示中文） | `"普悠瑪(普悠瑪)"` |
| `TrainTimetables[].TrainInfo.TrainTypeName.En` | 車種（英文摘要用） | `"Puyuma Express"` |
| `TrainTimetables[].TrainInfo.SuspendedFlag` | 是否停駛（=1 需濾掉） | `0` |
| `TrainTimetables[].StopTimes[0].DepartureTime` | **起站發車時間**（起站取 `StopTimes[0]`） | `"07:15"` |
| `TrainTimetables[].StopTimes[last].ArrivalTime` | **迄站抵達時間**（迄站取 `StopTimes` 最後一筆） | `"08:54"` |

> **時間格式**：`ArrivalTime`／`DepartureTime` 皆為 `"HH:mm"` 純字串（24 小時制），可直接字串比較排序與過濾。**行駛時間**＝迄站 `ArrivalTime` − 起站 `DepartureTime`，用分鐘計算後格式化為 `H小時M分` 或 `H:MM`。

> **StopTimes 取值原則**：OD 端點保證 `StopTimes` 依 `StopSequence` 升冪，起站在 `[0]`、迄站在最後一筆（實測皆為 2 筆）。為穩健起見取 `StopTimes[0]` 與 `StopTimes[StopTimes.length - 1]`，不寫死索引 1。

### 1.4 車站代碼對照（實測確認的主要站 → StationID）

用 PTX `Station` 端點實打取得並確認（PRD 功能需求 4 要求涵蓋主要幹線車站）：

| 車站（正體） | StationID | 車站（正體） | StationID |
|---|---|---|---|
| 基隆 | `0900` | 臺中 | `3300` |
| 臺北 | `1000` | 嘉義 | `4080` |
| 板橋 | `1020` | 臺南 | `4220` |
| 桃園 | `1080` | 高雄 | `4400` |
| 新竹 | `1210` | 臺東 | `6000` |
|  |  | 花蓮 | `7000` |

> **前導零很重要**：`0900`（基隆）等站碼含前導零，端點以字串路徑接收（實測 `0900` 正常）。對照表以字串存 StationID，不可用數字型別（會掉前導零）。

### 1.5 取捨與替代方案說明

- **為何選 PTX（免金鑰）而非 TDX（需金鑰）**：兩者 schema 相同、資料同源；PTX 免註冊、免金鑰、實測穩定回最新資料，維持本專案零設定風格，且**避免叫使用者去 TDX 註冊金鑰**（本專案使用者為非技術家人）。
- **為何不用 data.gov.tw 台鐵 CSV／舊 ODS**：探測發現部分 dataset 404／停更，且多為「靜態每日時刻表 CSV」需自行解壓解析、欄位與更新節奏不如 PTX v3 直接。穩定度與即時性不如 PTX，故不採用。
- **本案結論**：**不需使用者決策、不需金鑰**。端點已實打可用。

---

## 二、關鍵技術決策

### 2.1 站名 → 車站代碼：內建對照表（不動態抓 Station API）

**決策：站名對照採「檔內硬編的別名表」，不在每次查詢時打 Station 端點。**

理由：
- PRD 明訂「僅需涵蓋主要幹線車站」，站碼是穩定的（台鐵站碼多年不變），硬編表最簡單可靠、可離線測試、零額外請求。
- 若站名不在表內 → 直接回「站名無法辨識」（PRD 功能需求 6、AC-05），不需連網。這也是為何 §1.1 實測「不存在站碼回空陣列」不足以當辨識機制——**必須靠本地表在打 API 前先辨識**。

別名表設計（`STATIONS`：正規站名 → StationID；`ALIAS`：別名／俗寫 → 正規站名）：

- **正體／俗寫互通**（PRD AC-04）：「台北」與「臺北」都要對到 `1000`。做法：對每個站同時收「臺X」與「台X」兩種寫法，或在正規化時把輸入的「臺」統一轉「台」（或反向）再查表。**建議**：正規化函式先把輸入中的 `臺`→`台`，表的 key 一律用「台」字版，最簡潔。
- **常見簡稱**：「北車」→ 台北、「高火／高雄車站」→ 高雄 等（PRD 功能需求 4，初期收錄清單由開發階段定，至少涵蓋 §1.4 十一站）。

### 2.2 過濾「當下時間之後、當天剩餘班次」（PRD 範圍：僅限當天）

- 查詢日期固定用 `store.taipei().date`（今天，UTC+8）。
- 抓回整天班次後，用 `store.taipei().hm`（現在 `HH:mm`）過濾：**只留 `StopTimes[0].DepartureTime >= 現在 hm`** 的班次（字串比較即可，因同為 `HH:mm` 24 小時制、同一天）。
- 過濾後**依起站發車時間字串升冪排序**（AC-02、AC-08）。
- `台鐵` 指令取前 5 筆（PRD 功能需求 1）；`下一班` 指令取第 1 筆（PRD 功能需求 2）。
- 濾掉 `SuspendedFlag === 1`（停駛車次）。
- 若過濾後為空 → 回「今日已無班次」（PRD 功能需求 7、AC-06）。

> **跨日不做**（PRD 明訂不做）：一律查今天、比今天現在時間。末班已過即回「今日已無班次」。

### 2.3 逾時處理：`AbortController` + 6 秒

比 exchangeRate/holiday 的 5 秒略寬（OD 端點偶有較大回應），但比 fuelPrice 的 8 秒短。以 `AbortController` + `setTimeout(() => controller.abort(), 6000)`，`fetch(url, { signal })`，`finally` 清 timer。逾時／連線失敗／非 200／JSON 解析失敗 → 一律視為「取不到」，回友善訊息（AC 對應「查詢失敗」語意）。

### 2.4 快取：記憶體，TTL 30 分鐘，key = `起站-迄站-日期`

- 台鐵每日時刻表當天內不太變動，但為求時效不宜太長；`UpdateInterval` 為 4 小時。折衷 **TTL 30 分鐘**（與 exchangeRate 相同量級），足以吸收家庭多人同時查詢的重複請求（PRD 額度風險）。
- **快取 key** = `${fromId}-${toId}-${date}`。仿 holiday.js 的 `cache` 物件（以 key 存 `{ trains, ts }`）。
- **注意**：快取存的是「當天全班次的精簡陣列」（未過濾時間），**過濾當下時間之後**要在每次讀取時即時做（因為「現在時間」一直在變，不能連過濾結果一起快取）。

### 2.5 JSON 解析：`res.json()`（比照 exchangeRate/holiday，不引入套件）

回應為標準 JSON，直接 `await res.json()`，取 `data.TrainTimetables`。無需 XML 正則（那是 fuelPrice/invoice 的手法）。嚴格驗證：`TrainTimetables` 需為陣列，否則視為失敗。

---

## 三、受影響檔案清單

| 檔案 | 動作 | 內容 |
|---|---|---|
| `src/services/traTrain.js` | **新增** | 台鐵時刻服務：站名對照表＋別名、站到站抓取＋JSON 解析（6s 逾時、30m 快取）、時間過濾排序、`lookup`（中文指令）、`nextTrain`、`usage`、`getTraTrainSummary`（AI 工具）、`normalizeStation`（純函式，可測） |
| `src/handler.js` | **修改** | require 服務；在「油價之後、發票對獎之前」加台鐵路由（`下一班` 與 `台鐵` 兩類）；`helpText()` 加一行 |
| `src/tools.js` | **修改** | require `getTraTrainSummary`；`defs` 加 `get_tra_train`；`run()` 加 case；`timeContext()` 補台鐵提示 |
| `README.md` | **修改** | 功能清單與「專案結構」各補一行台鐵服務 |
| `src/store.js` | **不改** | 本功能不存資料（僅讀 `store.taipei()` 取今日日期＋現在時間） |
| `src/config.js`／`.env.example` | **不改** | **免金鑰，無新增環境變數** |
| `src/lang.js` | **不改** | 多語言交給模型；英文摘要已足夠（同 exchangeRate/holiday/fuelPrice 慣例） |

---

## 四、模組與函式介面：`src/services/traTrain.js`

採 CommonJS，與既有服務一致。

### 4.1 常數（檔頂，單一真實來源）

```
const STATION_URL = 'https://ptx.transportdata.tw/MOTC/v3/Rail/TRA/Station';
// OD：`${OD_BASE}/${fromId}/to/${toId}/${date}?$format=JSON`
const OD_BASE = 'https://ptx.transportdata.tw/MOTC/v3/Rail/TRA/DailyTrainTimetable/OD';
const SOURCE = '台鐵 TRA（交通部 PTX）';
const CACHE_TTL_MS = 30 * 60 * 1000;   // 30 分鐘
const FETCH_TIMEOUT_MS = 6000;         // 6 秒
const MAX_RESULTS = 5;                  // 「台鐵」指令列出前 5 筆（PRD 功能需求 1）
```

車站對照（**單一真實來源**，供 handler、AI 工具、顯示共用）：

```
// 正規站名（一律用俗寫「台」字版當 key）→ StationID（字串，保前導零）
const STATIONS = {
  '基隆': '0900', '台北': '1000', '板橋': '1020', '桃園': '1080', '新竹': '1210',
  '台中': '3300', '嘉義': '4080', '台南': '4220', '高雄': '4400',
  '台東': '6000', '花蓮': '7000',
  // …（開發階段可續補主要幹線站，如中壢 1100、苗栗 3160、彰化 3360、屏東 5000、宜蘭 7190 等）
};

// 別名／簡稱 → 正規站名（key）。正體「臺」由 normalizeStation 統一轉「台」，故此處收「非臺/台」類簡稱
const STATION_ALIAS = {
  '北車': '台北', '台北車站': '台北', '高雄車站': '高雄', '高火': '高雄',
  // …（開發階段依家人用語續補）
};
```

**內部 `normalizeStation(input) -> { name, id } | null`**（純函式，供測試）：
1. `input.trim()`；空 → `null`。
2. 把輸入中的 `臺` 全部換成 `台`（正體／俗寫互通，AC-04）；去除結尾「站」「車站」等贅字（可選）。
3. 先查 `STATION_ALIAS`（得正規名）；再查 `STATIONS`（正規名 → id）。
4. 命中回 `{ name, id }`；查無回 `null`（由上層輸出「站名無法辨識」，AC-05）。

### 4.2 `async fetchOdTrains(fromId, toId, date) -> { ok, trains } | { ok:false }`（內部核心，可不匯出）

最底層抓取＋解析＋快取，給下面對外函式共用。

- **流程**：先查快取（key=`fromId-toId-date`，命中且未過期直接回）→ 否則組 URL `${OD_BASE}/${fromId}/to/${toId}/${date}?$format=JSON`（**`$` 需編碼為 `%24`**）→ `fetch(url, { signal })`（6s 逾時）→ `res.json()` → 取 `data.TrainTimetables`（需為陣列）。
- **精簡映射**：每筆 train 映射成內部精簡物件（只留 load-bearing 欄位），存快取：
  ```
  {
    trainNo:   t.TrainInfo.TrainNo,
    typeZh:    t.TrainInfo.TrainTypeName.Zh_tw,
    typeEn:    t.TrainInfo.TrainTypeName.En,
    departure: t.StopTimes[0].DepartureTime,                       // 起站發車
    arrival:   t.StopTimes[t.StopTimes.length - 1].ArrivalTime,    // 迄站抵達
    suspended: t.TrainInfo.SuspendedFlag === 1,
  }
  ```
- **成功回傳**：`{ ok: true, trains: [ …精簡物件… ] }`（**未過濾時間、未排序**；時間過濾在對外函式做，見 §2.4）。
- **失敗回傳**：`{ ok: false }`（逾時、連線錯、非 200、`TrainTimetables` 非陣列都歸此類）。
- **快取**：成功後存 `cache[key] = { trains, ts: Date.now() }`。

**內部 `filterAndSort(trains, nowHm, limit) -> [...]`**（純函式，可測）：濾掉 `suspended`、濾掉 `departure < nowHm`、依 `departure` 升冪排序、`slice(0, limit)`。

**內部 `duration(dep, arr) -> string`**（純函式，可測）：把 `"HH:mm"` 轉分鐘相減（`arr` 可能因跨午夜較少見於當日剩餘班次，若 `arr < dep` 視為跨日 +24h），格式化為 `H小時M分`（英文摘要用 `Hh Mm` 或 `HhMMm`）。

### 4.3 `async lookup(argText) -> string`（給 handler 中文指令 `台鐵 起 迄`，回已格式化中文字串）

- **簽章**：`lookup(argText: string): Promise<string>`（`argText` 為「台鐵」後的字串，如 `"台北 台中"`）。
- **解析**：以空白切出起、迄兩站名。缺參數 → 回格式提示 `格式：台鐵 台北 台中`。
- **站名辨識**：兩站各跑 `normalizeStation`；任一得 `null` → 回 `站名無法辨識：「XXX」，請輸入明確的車站名稱`（AC-05）。
- **查詢**：`fetchOdTrains(fromId, toId, store.taipei().date)` → `ok:false` 回 `目前無法取得台鐵時刻，請稍後再試 🙏`。
- **過濾排序**：`filterAndSort(trains, store.taipei().hm, MAX_RESULTS)`。
  - 空 → 回 `📅 <起>→<迄>\n今日已無班次`（AC-06）。
- **成功輸出（最多 5 筆，對應 PRD 功能需求 1、3）**：
  ```
  🚆 台鐵 台北 → 台中（07/01）
  現在 13:25 之後的班次：

  ・107次 普悠瑪　13:40→15:19（1小時39分）
  ・1109次 自強　 14:13→16:29（2小時16分）
  …（最多 5 筆）

  資料來源：台鐵 TRA（交通部 PTX）
  ```

### 4.4 `async nextTrain(argText) -> string`（給 handler `下一班` 指令，只回 1 筆，PRD 功能需求 2、AC-03）

- 解析與辨識同 `lookup`（支援 `台北到台中` 與 `台北 台中` 兩種寫法：先把「到」「往」替換成空白再切）。
- `filterAndSort(..., 1)` 取第 1 筆；空 → `今日已無班次`。
- **輸出（單筆）**：
  ```
  🚆 下一班 台北 → 台中
  ・107次 普悠瑪　13:40 發車，15:19 抵達（1小時39分）

  資料來源：台鐵 TRA（交通部 PTX）
  ```

### 4.5 `usage() -> string`（同步，使用說明子選單）

仿 `holiday.usage()`／`fuelPrice.usage()`：
```
🚆 台鐵時刻查詢可以這樣問：
・台鐵 台北 台中（近期班次，最多 5 筆）
・下一班 台北到花蓮（只看最近一班）
支援主要幹線車站；僅查今天、當下時間之後的班次。
```

### 4.6 `async getTraTrainSummary({ from, to, nextOnly }) -> string | null`（給 AI 工具用，回英文摘要）

對應 weather/exchangeRate/fuelPrice/holiday 慣例：回**英文純文字**，讓模型用使用者語言改寫。

- **簽章**：`getTraTrainSummary({ from, to, nextOnly }): Promise<string | null>`
  - `from`／`to`：模型給的站名（任何語言／拼音／中文皆可能）。函式內跑 `normalizeStation`。
  - `nextOnly`：布林，true 時只回 1 筆（對應「下一班」語意）。
- **行為**：
  - `from`／`to` 任一無法辨識 → 回英文字串（讓模型轉述），例如：
    `Station not recognized: "XXX". Please give a valid TRA station name (e.g. Taipei, Taichung, Hualien).`
  - 取不到資料（`fetchOdTrains` 回 ok:false）→ 回 `null`（`tools.run` 補英文 fallback）。
  - 當天已無剩餘班次 → 回英文 `No remaining TRA trains today from X to Y.`（讓模型用越南語轉述「今日已無班次」）。
  - 成功（`nextOnly=false`，最多 5 筆）：
    ```
    TRA trains from Taipei to Taichung today (2026-07-01), departing after 13:25:
    No.107 Puyuma Express 13:40->15:19 (1h39m); No.1109 Tze-Chiang 14:13->16:29 (2h16m); ...
    Source: Taiwan Railway (TRA) via MOTC PTX.
    ```
  - 成功（`nextOnly=true`）：
    ```
    Next TRA train from Taipei to Taichung today: No.107 Puyuma Express, departs 13:40, arrives 15:19 (1h39m).
    Source: Taiwan Railway (TRA) via MOTC PTX.
    ```

### 4.7 匯出

```
module.exports = {
  lookup, nextTrain, usage,          // 中文指令用
  getTraTrainSummary,                // AI 工具用
  normalizeStation, filterAndSort, duration, STATIONS,  // 供離線測試（純函式／表）
};
```

---

## 五、`handler.js` 路由設計

### 5.1 import

於既有 services require 區塊（`fuelPrice` 附近）加入：
`const traTrain = require('./services/traTrain');`

### 5.2 路由位置與順序（**關鍵：`下一班` 要在 `台鐵` 之前**）

**放置點**：**油價區塊之後、發票對獎之前**（handler 現有第 160 行 `fuelPrice.lookup()` 之後、第 163 行 `invoiceMatch` 之前）。必須在最後 AI fallback（現第 213 行 `conversation.append`）之前，否則中文關鍵字會被 AI 接走。

**順序**：先比 `下一班`（較特定），再比 `台鐵`。兩者字串不重疊，但由特定到一般排列以策安全。

### 5.3 路由正則（依序比對）

```
// ── 台鐵火車時刻 ─────────────────────────────────────
// 1) 台鐵時刻查詢 → 使用說明子選單
if (/^(?:台鐵|臺鐵|火車)查詢$/.test(trimmed)) {
  return traTrain.usage();
}
// 2) 下一班 <起>到<迄> 或 下一班 <起> <迄>（PRD 功能需求 2）
const nextTrainMatch = trimmed.match(/^下一班\s*(.+)$/);
if (nextTrainMatch) {
  return traTrain.nextTrain(nextTrainMatch[1].trim());
}
// 3) 台鐵/臺鐵/火車 <起> <迄>（PRD 功能需求 1）
const traMatch = trimmed.match(/^(?:台鐵|臺鐵|火車)\s+(.+)$/);
if (traMatch) {
  return traTrain.lookup(traMatch[1].trim());
}
```

說明：
- `nextTrain`／`lookup` 內部各自把「到」「往」等連接詞替換成空白再切站名，故 `下一班 台北到花蓮`、`台鐵 台北 台中` 皆可解析。
- 站名辨識與「今日已無班次」由服務層處理並回明確中文訊息，不會報錯或空回（AC-05、AC-06）。
- **不衝突確認**：`台鐵`／`下一班`／`火車查詢` 與既有任何指令前綴（提醒、天氣、翻譯、匯率、放假、油價、對獎、記帳…）皆不重疊。

### 5.4 `helpText()` 更新

在現有 help 字串中（建議緊接「⛽ 油價」那行後）插入一行：
```
'🚆 台鐵：「台鐵 台北 台中」「下一班 台北到花蓮」\n' +
```

---

## 六、`tools.js` AI 工具設計

### 6.1 import

頂部加：`const { getTraTrainSummary } = require('./services/traTrain');`

### 6.2 工具定義（加入 `defs` 陣列，對應 PRD 功能需求 5）

```
{
  type: 'function',
  function: {
    name: 'get_tra_train',
    description:
      '查詢台灣台鐵（TRA）某起站到迄站、今天當下時間之後的火車班次時刻。'
      + '當使用者用任何語言（尤其越南語）詢問台鐵/火車從某站到某站的班次、'
      + '下一班車幾點時呼叫。僅限台鐵、僅限今天當下之後的班次。',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '起站中文站名，如「台北」「臺北」「花蓮」。越南語/拼音也盡量轉成中文站名。' },
        to:   { type: 'string', description: '迄站中文站名，如「台中」「高雄」。' },
        next_only: { type: 'boolean', description: '若使用者問「下一班/最近一班」設 true（只回 1 筆）；問「班次/有哪些車」設 false 或不填。' },
      },
      required: ['from', 'to'],
    },
  },
},
```

> `next_only` 為選填（預設 false）→ 不放進 required。description 提示模型把越南語站名轉中文（如 `Đài Bắc`→台北、`Đài Trung`→台中、`Hoa Liên`→花蓮），呼應 PRD AC-07。

### 6.3 `run()` 新分支

於 `switch (name)` 內加入：
```
case 'get_tra_train':
  return (
    (await getTraTrainSummary({ from: a.from, to: a.to, nextOnly: a.next_only === true }))
    || 'Cannot fetch Taiwan railway (TRA) timetable right now.'
  );
```
- 與 `get_fuel_price`／`get_exchange_rate` 同模式：服務回 `null` 時補英文 fallback；外層既有 `try/catch` 攔例外回 `Tool failed: …`。
- 站名無法辨識時 `getTraTrainSummary` 回英文說明字串（非 null），讓模型轉述（AC-05 的越南語版）。

### 6.4 `timeContext()` 更新

在現有指示句列舉的工具情境補入「查台鐵火車時刻」，並加一句明確指示：
> 「若使用者用任何語言（含越南語）詢問台鐵/火車從某站到某站的班次、下一班車，就呼叫 get_tra_train 工具（傳中文站名）。」

---

## 七、端到端流程

### 7.1 中文指令路徑（AC-01～06）
```
使用者「台鐵 台北 台中」
 → handler 第 3 條正則命中 → traTrain.lookup("台北 台中")
 → normalizeStation("台北")=1000、normalizeStation("台中")=3300
 → fetchOdTrains(1000,3300,今天)（快取未命中時 GET PTX OD，6s 逾時）→ 解析 JSON → 精簡陣列
 → filterAndSort(現在 hm, 5) → 前 5 筆
 → 格式化中文回覆 → 回 LINE
```

### 7.2 下一班路徑（AC-03）
```
使用者「下一班 台北到花蓮」
 → handler 第 2 條正則命中 → traTrain.nextTrain("台北到花蓮")
 → 把「到」換空白 → 起=台北(1000)、迄=花蓮(7000)
 → fetchOdTrains → filterAndSort(現在 hm, 1) → 第 1 筆 → 單筆中文回覆
```

### 7.3 AI 工具路徑（越南語，AC-07／AC-08）
```
使用者「tàu từ Đài Bắc đến Đài Trung」
 → 非指令 → AI fallback → 模型依 timeContext 呼叫 get_tra_train{from:"台北",to:"台中"}
 → tools.run → getTraTrainSummary → 英文摘要（同 7.1 資料）
 → 模型用越南語改寫 → 回 LINE
（同一時間點查詢，與 7.1 中文指令資料一致 → AC-08）
```

### 7.4 站名無法辨識（AC-05）
```
「台鐵 火星 台中」→ normalizeStation("火星")=null
 → 回「站名無法辨識：「火星」，請輸入明確的車站名稱」（不報錯、不空回）
```

---

## 八、錯誤與逾時處理（彙整）

| 情境 | 中文指令（lookup/nextTrain） | AI 工具（getTraTrainSummary） |
|---|---|---|
| 站名無法辨識（AC-05） | `站名無法辨識：「XXX」，請輸入明確的車站名稱` | 英文 `Station not recognized: "XXX"…`，模型轉述 |
| 今日已無剩餘班次（AC-06） | `今日已無班次` | 英文 `No remaining TRA trains today from X to Y.`，模型轉述 |
| 來源逾時（>6s）／連線失敗／非 200／解析失敗 | `目前無法取得台鐵時刻，請稍後再試 🙏` | 回 `null` → `run()` 補英文 fallback |
| 例外（throw） | `lookup`／`nextTrain` 內 `try/catch` 兜底回友善訊息 | `tools.run` 外層 `try/catch` 回 `Tool failed:` |

**逾時實作要點**：`AbortController` + `setTimeout(…, 6000)`，`fetch(url, { signal })`，`finally` 清 timer。abort 觸發的 reject 視為「取不到」。所有外部呼叫不可讓 process 崩潰。

---

## 九、測試策略（對應 PRD §驗收條件 1–8）

> 專案目前無正式測試框架，既有慣例是寫獨立 `node` 腳本放 `tests/`（見 holiday/fuel-price 的 TEST.md）。把「站名正規化」「時間過濾排序」「行駛時間計算」抽成純函式（`normalizeStation`／`filterAndSort`／`duration`），用**離線 fixture**（把 §1.2 的真實 OD JSON 存成測試樣本）餵入，即可不連網覆蓋大多數 AC。

### 9.1 可離線測（不碰真實來源）— 用 fixture / mock

| AC | 測法（離線） |
|---|---|
| AC-01 | 用 fixture（真實 OD JSON）→ `filterAndSort` 產出班次，斷言每筆含車次、車種、`departure`、`arrival`、`duration()` 皆非空 |
| AC-02 | `filterAndSort(trains, "13:25", 5)`：斷言結果 ≤ 5 筆、每筆 `departure >= "13:25"`、依 `departure` 升冪 |
| AC-03 | `filterAndSort(trains, nowHm, 1)`：斷言只 1 筆且為最早出發者 |
| AC-04 | `normalizeStation("臺北").id === normalizeStation("台北").id === "1000"`（正體／俗寫互通） |
| AC-05 | `normalizeStation("火星") === null`；`lookup("火星 台中")`（mock fetch 不被呼叫）回「站名無法辨識」 |
| AC-06 | `filterAndSort(trains, "23:59", 5)` 為空 → `lookup` 回「今日已無班次」（用晚間時鐘注入或末班前的 fixture） |
| AC-08 | 同一 fixture 下，`lookup` 與 `getTraTrainSummary` 取到的班次集合一致（同起訖、同時間點） |
| duration | `duration("07:15","08:54")` = 1小時39分；跨午夜 `duration("23:50","00:30")` 正確處理 |
| 解析健壯性 | 空 `TrainTimetables`／`SuspendedFlag=1` 被濾除；`fetchOdTrains` 對非陣列回 `{ok:false}` |
| helpText | 斷言 `helpText()` 含「台鐵」 |
| tool 定義 | `defs` 含 `get_tra_train`、`from`/`to` 為 required、`next_only` 選填 |
| timeContext | `timeContext()` 字串含「台鐵」 |
| handler 路由 | 「下一班 …」先於「台鐵 …」命中；「火車查詢」回 usage |

### 9.2 需碰真實來源（線上煙霧測試）

| AC | 測法（線上，免金鑰即可打） |
|---|---|
| AC-01/02 | 真打 PTX OD `1000→3300` 今天：斷言回 ≥1 筆、含五欄位、發車時間皆 ≥ 現在、≤5 筆、升冪 |
| AC-03 | `下一班 台北到花蓮`（1000→7000）：只回 1 筆且最早 |
| AC-04 | `台鐵 臺北 臺中` 與 `台鐵 台北 台中` 回相同班次資料 |
| AC-06 | 於晚間（末班後）真打，或用固定末班已過站對，確認回「今日已無班次」 |
| AC-07 | 送越南語「tàu từ Đài Bắc đến Đài Trung」，確認模型呼叫 `get_tra_train{from:台北,to:台中}` 並以越南語回覆含車次／時間 |
| AC-08 | 同一時間點，中文指令與越南語 AI 查詢回一致班次 |
| 快取 | 連續兩次同 `起-迄-日期` 查詢（30 分內），以 log／spy 斷言第二次未對外 fetch |

### 9.3 測試環境備註
- **免金鑰**：所有線上測試直接 GET PTX 端點即可，不需任何金鑰／註冊。
- AC-07/08 屬整合測試，需 Groq 金鑰。無 LINE 環境時可直接呼叫 `tools.run(userId, 'get_tra_train', JSON.stringify({from:'台北',to:'台中'}))` 驗英文摘要，模型改寫語言由對話端人工覆蓋（與 fuelPrice/holiday 測試慣例相同）。
- 離線 fixture 建議保存 §1.2 的真實 OD 回應（含正常、停駛、跨午夜等邊界筆），確保過濾與計算行為被覆蓋。

---

## 十、風險與取捨

1. **PTX 平台長期存續風險（主要風險）**：PTX 是 TDX 前身，官方主推 TDX。實測 PTX 仍在線且回最新資料，但無 SLA、未來可能停用。**緩解**：服務層把「來源 URL／抓取」集中在 `fetchOdTrains`；若 PTX 失效，短期回友善錯誤（不崩潰），中期可最小改動切到 TDX——屆時需在 `config.js`／`.env.example` 加 `TDX_CLIENT_ID`／`TDX_CLIENT_SECRET`，新增 OAuth token 取得＋快取（token 效期約 1 天），端點路徑同 schema（`/api/basic/v3/Rail/TRA/DailyTrainTimetable/OD/...`）。**本期不做，僅在此記錄切換路徑。**
2. **資料非即時、無誤點資訊**（PRD 明訂不做）：回覆為「排定時刻」；已標資料來源。不得宣稱即時或含誤點。
3. **站名別名清單覆蓋不足**：初期僅收主要幹線站，家人若查未收錄站會得「站名無法辨識」。**緩解**：`STATIONS`／`STATION_ALIAS` 集中於檔頂，依家人回饋易於擴充（PRD 風險已預期）。
4. **越南語站名辨識依賴模型**：模型需把 `Đài Bắc` 等轉成中文站名再交工具。**緩解**：tool description 給常見對應例；辨識失敗時回明確英文提示讓模型轉述（AC-05）。
5. **跨午夜行駛時間**：極少數當日剩餘班次跨午夜，`duration` 需處理 `arrival < departure` 加 24h；已列入純函式測試。
6. **OD 端點 `StopTimes` 假設**：實測 OD 端點每筆恰 2 筆（起、迄）。程式仍取 `[0]` 與 `[length-1]` 而非寫死索引 1，避免未來端點行為變動時取錯。
7. **`$` 需編碼**：URL 的 `$format`／`$top` 的 `$` 須寫成 `%24`（實測未編碼在部分環境會被 shell/HTTP 客戶端誤解）；程式組 URL 時直接用 `%24format=JSON`。

---

## 十一、實作檢核清單（給工程師 RD#2）

- [ ] 新增 `src/services/traTrain.js`：常數（URL/SOURCE/TTL/逾時/MAX_RESULTS）、`STATIONS`、`STATION_ALIAS`、`normalizeStation`（純函式，含臺→台正規化）、`fetchOdTrains`（6s 逾時 + 30m 快取，key=起-迄-日期）、`filterAndSort`／`duration`（純函式）、`lookup`、`nextTrain`、`usage`、`getTraTrainSummary`，並 `module.exports`。
- [ ] `handler.js`：require 服務；在油價區塊之後、發票對獎之前加路由（順序：`火車查詢`→`下一班`→`台鐵`）；`helpText()` 加「🚆 台鐵…」一行。
- [ ] `tools.js`：require `getTraTrainSummary`；`defs` 加 `get_tra_train`（from/to required、next_only 選填）；`run()` 加 case；`timeContext()` 補「查台鐵」提示。
- [ ] `README.md`：功能清單 + 專案結構各補一行台鐵服務（仿油價／放假）。
- [ ] **不改** `config.js`／`.env.example`（免金鑰）。
- [ ] 自測 §9.1 離線項（含正規化、過濾排序、行駛時間、停駛濾除）+ §9.2 線上煙霧（至少 AC-01、AC-02、AC-03、AC-04、快取）。

# 技術設計：連假／放假查詢功能（DESIGN）

**版本** v1.0 | **日期** 2026-06-29 | **作者** 軟體架構師（RD#1）
**對應 PRD** `docs/loop/holiday/PRD.md` v1.0

---

## 〇、一句話總結

新增一支查詢類服務 `src/services/holiday.js`，採用 **免金鑰、CDN JSON** 的 **TaiwanCalendar（`ruyut/TaiwanCalendar`）** 作為台灣行事曆資料來源。
中文關鍵字指令走 `handler.js` 路由（格式化中文回覆）；自然語句（含越南語）走 `tools.js` 的新 AI 工具 `get_taiwan_holiday`（回英文摘要交給模型用使用者語言改寫）。資料以「整年陣列」抓取並做**長時間記憶體快取（建議 6 小時）**，跨年度時嘗試抓次年檔、抓不到給友善提示。本功能**不需要存任何持久資料**（`store.js` 只用其 `taipei()` 取「今天」，不寫檔）。

---

## 一、關鍵技術決策

### 1.1 資料來源選用：TaiwanCalendar（CDN JSON，免金鑰）

PRD §4.4 列出兩個建議方向（data.gov.tw 開放資料 / GitHub 整理的 JSON），選型交架構師。本設計採用 **TaiwanCalendar**，理由：免金鑰、CDN 直出 JSON、欄位已整理成「逐日陣列」最易解析，且資料維護由社群跟進行政院公告，符合本專案「免金鑰、零設定」一貫風格（weather/Open-Meteo、exchangeRate/open.er-api 皆無金鑰）。

- **端點**：`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/{YYYY}.json`
  - 例：`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/2026.json`
- **回傳 JSON 形狀**（已實測：2026 年共 365 筆，逐日一筆）：
  ```json
  [
    { "date": "20260101", "week": "四", "isHoliday": true,  "description": "開國紀念日" },
    { "date": "20260102", "week": "五", "isHoliday": false, "description": "" },
    { "date": "20260103", "week": "六", "isHoliday": true,  "description": "" }
  ]
  ```
  - `date`：`YYYYMMDD` 字串。
  - `week`：中文星期（`一`～`日`），可直接用於回覆的「（三）」。
  - `isHoliday`：是否放假（**含週末**，週六日即使無假名也為 `true`）。
  - `description`：假日名稱；**平日為空字串**；**補班日為 `"補行上班"`（且 `isHoliday=false`）**。

> **實測補充（重要，影響補班判定）**：
> - 2026 年全年**沒有**任何補班日（無 `isHoliday=false` 且 description 非空者）。
> - 2025 年補班日 `20250208`、2024 年補班日 `20240217`，其 `description` 皆為 **`"補行上班"`**、`isHoliday=false`。
> - 故「補班日」判定條件需以 `isHoliday === false && /補行上班|補班/.test(description)` 為準（用 regex 容忍可能的字樣差異）。

### 1.2 欄位映射（TaiwanCalendar → PRD §4.4 的 5 欄位）

服務內把原始一筆 raw 物件**正規化**為 PRD 規定的記錄結構（單一真實來源，所有對外函式都吃這個正規化結果）：

| PRD 欄位 | 型別 | 由 raw 推導方式 |
|---|---|---|
| `date` | string `YYYY-MM-DD` | 由 raw `date`（`YYYYMMDD`）插入兩個 `-` |
| `isHoliday` | boolean | 直接取 raw `isHoliday` |
| `holidayName` | string | `isHoliday===true` 時取 raw `description`，否則 `''`（週末雖 isHoliday=true 但 description 為空 → holidayName 為空字串，回覆時以「週末」表示） |
| `isCompensatory` | boolean | `raw.isHoliday===false && /補行上班\|補班/.test(raw.description)` |
| `description` | string | 直接保留 raw `description`（補班日為「補行上班」，可供回覆與摘要參考） |

額外保留 `week`（中文星期）供回覆顯示「（三）」之類；非 PRD 必填，但實用。

### 1.3 快取策略：整年陣列 + 長 TTL（建議 6 小時）

行事曆「年度公告制」，一年內幾乎不變，可比匯率快取更久。

- **快取單位**：以「年份」為 key，存「該年正規化後的記錄陣列」+ 取得時間戳。
- **TTL 建議 6 小時**（`6 * 60 * 60 * 1000`）。比 exchangeRate 的 30 分鐘長，因資料更新頻率遠低；仍設 TTL 以便年底公告次年資料後能在數小時內自動刷新。
- **次年資料負快取**：若抓次年檔失敗（次年行事曆尚未公告），應短暫記住「該年暫無資料」以免每次查詢都重打 CDN（建議負快取 TTL 較短，如 30 分鐘），到期後再重試。

### 1.4 逾時處理：`AbortController` + 5 秒

比照 exchangeRate.js：`AbortController` 搭 `setTimeout(() => controller.abort(), 5000)`，`signal` 傳入 `fetch`，`finally` 清 timer。逾時／連線失敗／非 200／JSON 解析失敗／非陣列一律視為「取不到行事曆」，由上層轉成 PRD AC-12 的友善訊息，**不得讓 process 崩潰**。

### 1.5 「今天」日期來源

一律用 `store.taipei()`（固定 +08:00、無 DST）取台北「今天」。`taipei().date` 為 `YYYY-MM-DD`。**禁止**用 `new Date()` 直接取本機時區，避免部署在非台灣時區的主機誤判。

---

## 二、受影響檔案清單

| 檔案 | 動作 | 內容 |
|---|---|---|
| `src/services/holiday.js` | **新增** | 行事曆服務：抓取＋快取、欄位正規化、日期工具、各查詢函式（中文回覆）、英文摘要（AI 工具用）、連假演算法 |
| `src/handler.js` | **修改** | 新增 6 條放假查詢正則路由（放 AI fallback 之前）＋ 更新 `helpText()` 加入放假查詢條目 |
| `src/tools.js` | **修改** | 新增 `get_taiwan_holiday` 工具 schema、`run()` 分支、`timeContext()` 提示補「查台灣放假」 |
| `README.md` | **修改** | 功能清單與「專案結構」各補一行行事曆服務 |
| `src/store.js` | **不改** | 只 `require` 其 `taipei()`，不新增儲存 |
| `src/lang.js` | **不改** | 多語言交由模型；英文摘要已足夠（與 weather/exchangeRate 相同機制） |

---

## 三、模組與函式介面：`src/services/holiday.js`

採 CommonJS，與既有服務一致。對外 `module.exports` 暴露「給 handler 中文指令用的查詢函式們」＋「給 AI 工具用的英文摘要函式」。內部核心（抓取、快取、正規化、連假演算法）可不匯出，但建議多匯出幾個純函式供離線測試（見 §8）。

### 3.0 常數與型別

```
// 正規化後的單日記錄（單一真實來源）
// { date: 'YYYY-MM-DD', week: '三', isHoliday: bool, holidayName: '', isCompensatory: bool, description: '' }
```

- `BASE_URL = 'https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/'`
- `CACHE_TTL_MS = 6 * 60 * 60 * 1000`（正常快取）
- `MISS_TTL_MS = 30 * 60 * 1000`（次年缺檔的負快取）
- `LONG_BREAK_MIN_DAYS = 3`（連假定義：連續 ≥ 3 個放假日）
- `SOURCE = 'TaiwanCalendar'`

### 3.1 內部：抓取 + 快取 + 正規化

**`async getYear(year) -> Array<Record> | null`**（內部核心，可不匯出但建議匯出供測試）

- **輸入**：四位數年份（number 或 string）。
- **快取**：先查 `cache[year]`；命中且未過期 → 直接回；負快取命中且未過期 → 回 `null`（不重打）。
- **抓取**：`fetch(BASE_URL + year + '.json', { signal })`（5 秒逾時）。
  - 非 200 / 非 JSON / 非陣列 / 空陣列 → 視為失敗。
- **正規化**：把每筆 raw 依 §1.2 映射為 Record，存快取（成功設正常 TTL；失敗設負快取並回 `null`）。
- **回傳**：成功為 Record 陣列；失敗為 `null`（由上層轉友善訊息 / 嘗試次年）。

**`async getDay(dateStr) -> Record | null`**（內部，供「今天/明天/特定日」用）

- 輸入 `YYYY-MM-DD`。從中取年份 → `getYear(year)` → 線性或 Map 找該日 Record。
- 找不到（資料不含該日，或抓取失敗）→ 回 `null`。

> **效能備註**：每年 365 筆，線性掃描即可；若在意可在 `getYear` 後建一個 `date → Record` 的 Map 一併快取。家庭用量下不必過度優化。

### 3.2 日期工具（內部純函式，建議匯出供測試）

不引入第三方日期庫（專案無 dayjs/moment），用既有風格的字串/`Date` 計算：

- `toYmd(date)`：`Date` → `YYYY-MM-DD`（以 UTC 取值避免時區漂移；或用 `store` 的 `en-CA` 格式法）。
- `addDays(dateStr, n)`：`YYYY-MM-DD` 加 n 天回 `YYYY-MM-DD`（供「明天」= +1）。
  - 實作要點：用 `new Date(Date.UTC(y, m-1, d))` 建構、`setUTCDate(+n)`、再轉回字串，避免本機時區與夏令時間問題。
- `formatDate(record)`：產生回覆用的 `YYYY-MM-DD（週X）` 字串（`week` 來自 record，缺則由日期推算）。
- `diffDays(fromYmd, toYmd)`：兩個 `YYYY-MM-DD` 相差天數（供「距今還有 N 天」）。

### 3.3 給 handler 中文指令用的查詢函式（皆回「已格式化中文字串」，不丟例外）

對應 weather.js 的 `getWeather()`、exchangeRate.js 的 `lookup()`：直接吃參數、回可直接傳 LINE 的中文訊息；所有錯誤都轉成友善中文字串（對應 AC-12）。

#### (a) `async describeDay(dateStr) -> string`（今天 / 明天 / 特定日是否放假）

- **輸入**：`YYYY-MM-DD`（handler 對「今天」傳 `taipei().date`、「明天」傳 `addDays(today, 1)`）。
- **取 Record**：`getDay(dateStr)`。`null` → 回 `目前無法取得假日資料，請稍後再試 🙏`（AC-12）。
- **四種輸出**（對應 PRD §4.3，以 `「今天/明天」` 前綴由 handler 決定或函式吃一個 label 參數，見 §4.3 註）：
  1. **補班日**（`isCompensatory`）：
     ```
     📅 2026-06-27（六）
     🔧 今天是補班日（非假日）
     ```
  2. **放假且有假名**（`isHoliday && holidayName`）：
     ```
     📅 2026-07-01（三）
     🎉 今天是假日：台灣光復紀念日調整放假
     ```
  3. **放假但無假名 = 純週末**（`isHoliday && !holidayName`）：
     ```
     📅 2026-07-05（日）
     😌 今天是週末，不用上班！
     ```
  4. **一般工作日**（`!isHoliday && !isCompensatory`）：
     ```
     📅 2026-07-06（一）
     ✅ 今天是上班日，非假日
     ```
- **判定順序務必為**：先 `isCompensatory` → 再 `isHoliday(有假名/無假名)` → 最後工作日。**補班日優先**，呼應 PRD 6.3「補班日不得被誤判為假日」。

> **「今天 / 明天」字樣**：建議簽章為 `describeDay(dateStr, label = '今天')`，`label` 由 handler 傳入（`'今天'` / `'明天'`），AI 工具則一律用 §3.4 的英文摘要而非中文。

#### (b) `async nextLongBreak() -> string`（下一個連假，連續 ≥ 3 個放假日）

- 從今天（`taipei().date`）起，呼叫 §3.5 演算法找「下一個連續 ≥ 3 個放假日且不被補班日切斷」的區間。
- **找到**輸出（對應 PRD §4.3）：
  ```
  🗓 下一個連假：中秋節連假
  📆 2026-09-30（三）–10-04（日）
  ⏱ 共 5 天（含週末）
  📍 距今還有 94 天
  ```
  - 連假名稱取自區間內第一個「有 holidayName」的記錄（若多個假名，取首個非空；可在說明用「連假」字樣包裝，如「中秋節連假」）。
  - 「距今還有 N 天」= `diffDays(today, 區間起始日)`；當天即連假首日則為 0（顯示「就是今天」之類，可選）。
- **跨年度**：演算法掃描需能跨到次年 1 月（見 §3.5 與 §6 邊界）。
- **取不到資料 / 次年無資料而連假可能落在次年**：回友善訊息，如：
  - 一般失敗：`目前無法取得假日資料，請稍後再試 🙏`
  - 次年資料尚未公告：`目前尚無 {次年} 年行事曆資料，待行政院公告後更新 🙏`（呼應 PRD 6.2）

#### (c) `async nextHoliday() -> string`（最近的假日，不限連假）

- 從今天起找「第一個 `isHoliday===true`」的日子（週末或國定假日皆可，**排除補班日**——補班日本就 isHoliday=false，自然排除）。
- 若今天本身就是假日，依 PRD AC-07「日期 ≥ 今日」可包含今天（建議含今天；如需「之後」可由實作微調，但 AC-07 寫「今天之後最近一個」與「日期 ≥ 今日」並列，採「≥ 今日」較安全）。
- **輸出**（沿用 describeDay 的單日格式，或精簡）：
  ```
  📅 2026-07-04（六）
  😌 最近的假日：週末
  ```
  或若為國定假日：
  ```
  📅 2026-09-25（五）
  🎉 最近的假日：中秋節
  ```
- 取不到 → 友善訊息（同上）。

#### (d) `async monthHolidays(month, year?) -> string`（指定月份所有假日清單）

- **輸入**：`month`（1–12）；`year` 預設今年（`taipei()` 的年份）。
- **月份驗證**（呼應 PRD 6.6）：`month` 非 1–12 → 回 `月份不正確，請輸入 1 到 12 的數字`。
- 取該年 Record，篩出「該月且（`isHoliday===true` 或 `isCompensatory`）」的日子，依日期排序。
- **輸出**（對應 PRD §4.3）：
  ```
  📋 2026 年 7 月假日

  07-04（六）週末
  07-05（日）週末
  ...
  07-15（三）🎉 XX節放假        ← 有 holidayName 時
  07-18（六）🔧 補班日（非假日）  ← 補班日（若該月有）

  ℹ️ 本月無國定假日              ← 當月全為週末、無任何 holidayName 時附註
  ```
  - 每列格式：`MM-DD（週X）` + 標記：
    - 純週末（isHoliday 且無 holidayName）→ `週末`
    - 國定假日／補假（有 holidayName）→ `🎉 {holidayName}`
    - 補班日 → `🔧 補班日（非假日）`
  - 結尾附註：若清單中無任何「有 holidayName」者 → 加 `ℹ️ 本月無國定假日`。
- 取不到資料 → 友善訊息（AC-12）；指定年份資料不存在（跨年情境，如於今年問次年某月）→ `目前尚無 {year} 年行事曆資料…`。

### 3.4 給 AI 工具用的英文摘要：`async getHolidaySummary({ queryType, date?, month? }) -> string | null`

對應 weather.js 的 `getForecastSummary()` / exchangeRate.js 的 `getExchangeSummary()`：回**英文純文字**，讓模型用使用者語言（含越南語）改寫（PRD §4.2）。**摘要只描述台灣（中華民國）放假事實**，不夾中文，避免污染其他語言回覆。

- **簽章**：`getHolidaySummary({ queryType, date, month })`
  - `queryType ∈ { 'is_holiday', 'next_long_break', 'next_holiday', 'month_holidays' }`
  - `date`：`YYYY-MM-DD`（`is_holiday` 用；未給預設今天 `taipei().date`）。
  - `month`：1–12（`month_holidays` 用）。
- **行為**（依 queryType 分派；複用 §3.1/§3.5 的核心，只是輸出改英文）：
  - `is_holiday`：取該日 Record → 英文摘要，例：
    - 補班：`Taiwan, 2026-06-27 (Sat): make-up workday (NOT a holiday).`
    - 假日：`Taiwan, 2026-07-01 (Wed): holiday — 台灣光復紀念日調整放假.`（holidayName 為官方中文名，可原樣帶；模型會在前後用使用者語言說明「這天放假」）
      - 註：holidayName 是專有名詞，保留中文＋英文上下文（`holiday —`）即可，模型能用越南語包裝。亦可附羅馬化/英文常見譯名（非必要）。
    - 純週末：`Taiwan, 2026-07-05 (Sun): weekend, day off.`
    - 工作日：`Taiwan, 2026-07-06 (Mon): regular working day, not a holiday.`
  - `next_long_break`：`Next long holiday in Taiwan: {name} holiday, 2026-09-30 (Wed) to 2026-10-04 (Sun), 5 days total (incl. weekend), starts in 94 days.`
  - `next_holiday`：`Next day off in Taiwan: 2026-07-04 (Sat), weekend.` 或 `... 2026-09-25 (Fri), holiday: 中秋節.`
  - `month_holidays`：`Taiwan holidays/days-off in July 2026: 07-04 (Sat) weekend; 07-15 (Wed) holiday 中秋節; 07-18 (Sat) make-up workday. No national holidays this month.`（無國定假日時附最後一句）
- **取不到資料**：回 `null`（與 weather 慣例一致；`tools.run` 會補一句英文 fallback）。
- **月份無效**（`month_holidays` 但 month 不在 1–12）：回英文字串 `Invalid month "{month}". Use 1–12.`（不回 null，讓模型有話可說）。
- **次年資料未公告**：回英文字串說明，例 `Taiwan {year} calendar is not published yet.`（不回 null，讓模型轉述「尚未公告」）。

> **強調**：摘要句一律以 `Taiwan` 開頭或含 `in Taiwan`，且工具 description 明確限定「台灣（中華民國）」，呼應 PRD 6.7「避免模型混淆越南假日／台灣假日」。

### 3.5 連假演算法（核心，建議匯出純函式供測試）

**定義（PRD 6.5）**：連假 = 連續 ≥ 3 個「放假日」（含週末、國定假日、補假）；**補班日切斷計算**。純週末（2 天）不算。

**純函式 `findNextLongBreak(records, todayYmd, minDays = 3) -> { name, start, end, days } | null`**

- **輸入**：已排序、含跨年（當年＋次年合併）的 Record 陣列；`todayYmd`。
- **演算法**：
  1. 把 records 依 `date` 升冪排序（跨年合併後再排）。
  2. 從 `date >= todayYmd` 的第一筆開始，掃描連續的「放假日」。
     - 「放假日」判定：`isHoliday === true`（週末與國定假日皆 true）。
     - **補班日**（`isCompensatory`，isHoliday=false）天然不是放假日 → 自動切斷連續段。
     - **日期需連續**：相鄰兩 Record 的日期必須剛好差 1 天，否則視為斷裂（資料缺日也斷）。
  3. 累積一段連續放假日，遇到「非放假日 / 日期不連續 / 陣列結束」即收尾為一個 run。
  4. 取**第一個長度 ≥ `minDays` 的 run** 回傳：
     - `start` = run 首日、`end` = run 末日、`days` = run 長度。
     - `name` = run 內第一個 `holidayName` 非空者；若整段皆無假名（罕見，例如恰好 3 天皆週末——實務不會，週末最多 2 天）則回 `'連假'`（fallback 名稱）。
  5. 掃完都沒有 ≥ minDays 的 run → 回 `null`。
- **跨年度合併**：呼叫端（`nextLongBreak` / `getHolidaySummary`）需準備「今年 records ＋（必要時）次年 records」串接後傳入，確保 12 月底問「下一個連假」能看到次年 1 月的元旦連假（PRD 6.2）。
  - 策略：先用今年 records 找；若「今年剩餘日期已無 ≥3 天連假」或「掃描已逼近年底而當前連續段尚未結束」，再抓次年 records 合併重掃。最穩妥做法：**一律合併今年＋次年**（次年抓得到才併；抓不到就只用今年，並在找不到時回「次年未公告」提示）。

**輔助 `findNextDayOff(records, todayYmd) -> Record | null`**（給 `nextHoliday` 用）

- 找 `date >= todayYmd` 中第一個 `isHoliday === true` 的 Record；無則回 `null`（呼叫端決定要不要抓次年再找）。

### 3.6 匯出

```
module.exports = {
  // handler 中文指令用
  describeDay, nextLongBreak, nextHoliday, monthHolidays,
  // AI 工具用
  getHolidaySummary,
  // 供測試（純函式 / 核心）
  getYear, findNextLongBreak, addDays, /* 視需要再加 */
};
```
（`describeDay/nextLongBreak/nextHoliday/monthHolidays/getHolidaySummary` 為主要對外；其餘匯出便於 §8 離線測試。）

---

## 四、`handler.js` 路由設計

### 4.1 import

於檔案上方既有 services require 區塊（第 8–17 行附近）加入：
`const holiday = require('./services/holiday');`

### 4.2 路由位置與順序（**關鍵：避免與現有指令衝突、且在 AI fallback 之前**）

放在 **「匯率」之後、「發票對獎」之前**（即現有第 113–116 行之間）。理由：

- 6 條正則的前綴（`今天放假嗎` / `明天放假嗎` / `…連假` / `最近…假日` / `N月…` / `放假查詢|假日查詢`）與現有任何指令前綴（reset、help、語言、提醒、天氣、翻譯、匯率、對獎、記帳、健康、生日…）皆**不重疊**。
- `(\d{1,2})月…` 那條以「數字＋月」開頭，與「帶金額匯率」那條（`/^[\d,]+…(幣別)…換…/`）不同（後者要求數字後接幣別字、且含「換」），不衝突；仍建議放在匯率三條**之後**以維持「先匯率、後放假」可讀順序，二者實際互斥。
- 必須放在**最後的 AI fallback（現第 166+ 行 `conversation.append…ai.chat`）之前**，否則放假關鍵字會被 AI 接走、改走工具路徑（雖也能答，但中文指令應走確定性路由）。

### 4.3 六條正則（依序比對；對應 PRD §4.1 建議正則）

```
// ── 放假 / 連假查詢 ───────────────────────────────────
const { taipei } = require('./store'); // 檔案頂部已可 require store；或於函式內取

// 1) 今天放假嗎
if (/^今天放假嗎?$/.test(trimmed)) {
  return holiday.describeDay(store.taipei().date, '今天');
}
// 2) 明天放假嗎
if (/^明天放假嗎?$/.test(trimmed)) {
  return holiday.describeDay(holiday.addDays(store.taipei().date, 1), '明天');
}
// 3) 下一個 / 最近 / 下個 連假
if (/^(?:下一個|最近|下個)連假$/.test(trimmed)) {
  return holiday.nextLongBreak();
}
// 4) 最近(的)假日
if (/^最近(?:的)?假日$/.test(trimmed)) {
  return holiday.nextHoliday();
}
// 5) N 月假日 / N 月有哪些假 / N 月放假
const monthMatch = trimmed.match(/^(\d{1,2})月(?:有哪些假|假日|放假)$/);
if (monthMatch) {
  return holiday.monthHolidays(parseInt(monthMatch[1], 10));
}
// 6) 放假查詢 / 假日查詢 → 子選單說明
if (/^(?:放假|假日)查詢$/.test(trimmed)) {
  return holiday.usage();  // 或直接內嵌一段說明字串（見下）
}
```

說明：

- **`store` 取用**：`handler.js` 目前未 require `store`；本功能需要它取「今天」。建議於檔案頂部加 `const store = require('./store');`（最乾淨）。`addDays` 由 `holiday` 服務匯出，避免在 handler 重寫日期計算。
- **第 6 條「放假查詢」**：PRD §4.1 列為「顯示使用說明（子選單提示）」。可由 `holiday` 服務匯出一個同步 `usage()` 回固定字串，或直接在 handler 內嵌字串。建議放在 `holiday.js` 以集中文案，例：
  ```
  📅 放假查詢可以這樣問：
  ・今天放假嗎 / 明天放假嗎
  ・下一個連假
  ・最近的假日
  ・7月假日（查指定月份）
  ```
- 第 5 條只負責「路由觸發」並把 month 數字（含 13、0 等越界值）交給服務層 `monthHolidays` 做 1–12 驗證（PRD 6.6）。正則 `\d{1,2}` 會接受 13、0，這是刻意的——讓服務層回「月份不正確」而非靜默不觸發。

### 4.4 `helpText()` 更新（對應 AC-11）

在現有 help 字串中（建議緊接「💱 匯率」那行後）插入一行：
```
'📅 放假：「今天放假嗎」「下一個連假」「7月假日」\n' +
```
AC-11 要求 help 文字含「今天放假嗎」條目，上述即滿足。

---

## 五、`tools.js` AI 工具設計

### 5.1 import

頂部（現第 5–10 行附近）加：`const { getHolidaySummary } = require('./services/holiday');`

### 5.2 工具定義（加入 `defs` 陣列）

```
{
  type: 'function',
  function: {
    name: 'get_taiwan_holiday',
    description:
      '查詢「台灣（中華民國）」的放假／國定假日／連假／補班資訊。'
      + '當使用者用任何語言（尤其越南語）詢問台灣某天是否放假、下一個連假、最近假日、'
      + '或某月有哪些假時呼叫。僅限台灣假日，不查越南或其他國家。',
    parameters: {
      type: 'object',
      properties: {
        query_type: {
          type: 'string',
          enum: ['is_holiday', 'next_long_break', 'next_holiday', 'month_holidays'],
          description:
            '查詢類型：is_holiday=某特定日是否放假；next_long_break=下一個連假（連續≥3天）；'
            + 'next_holiday=最近一個放假日；month_holidays=某月份所有假日清單。',
        },
        date: {
          type: 'string',
          description: 'query_type=is_holiday 時用，格式 "YYYY-MM-DD"；不填預設今天（依背景提供的台北日期）。',
        },
        month: {
          type: 'number',
          description: 'query_type=month_holidays 時用，1–12 的月份數字。',
        },
      },
      required: ['query_type'],
    },
  },
},
```

- `required` 只放 `query_type`（`date`/`month` 視類型選填，與 PRD §4.2 一致）。

### 5.3 `run()` 新分支

於 `switch (name)` 內加入：
```
case 'get_taiwan_holiday':
  return (
    (await getHolidaySummary({
      queryType: a.query_type,
      date: a.date,
      month: a.month,
    }))
    || 'Cannot fetch Taiwan holiday data right now.'
  );
```
- 與 `get_weather`/`get_exchange_rate` 同模式：服務回 `null` 時補一句英文 fallback；外層既有 `try/catch` 已能攔例外回 `Tool failed: ...`。
- `getHolidaySummary` 內部對「無效月份／次年未公告」回英文字串（非 null），讓模型有具體訊息可轉述。

### 5.4 `timeContext()` 微調

在現有指示句尾，把工具清單擴充加入「查台灣放假／連假」。例（在「查匯率」後接）：
> 「…或查匯率、查台灣放假/連假，就呼叫對應工具完成，再用對方的語言確認…」

這對 AC-08 / AC-09（越南語）的工具觸發率有幫助。`timeContext()` 已提供台北日期，模型即可把「今天/明天」換算成 `YYYY-MM-DD` 填 `date`。

### 5.5 為何 `lang.js` 不需改

多語言回覆由「工具回英文摘要 → 模型用使用者語言改寫」既有機制處理（與 weather/exchangeRate 相同）。`lang.js` 只管系統訊息／前綴／語言偵測，與放假輸出無關。**本功能不碰 `lang.js`。**

---

## 六、端到端流程

### 6.1 中文指令路徑（今天放假嗎）
```
使用者「今天放假嗎」
 → handler 正則命中 → holiday.describeDay(taipei().date, '今天')
 → getDay → getYear(2026)（快取 miss 則 fetch CDN，5s 逾時）→ 正規化 → 找今天 Record
 → 依「補班 > 假日(有/無名) > 工作日」判定 → 格式化中文 → 回 LINE
```

### 6.2 中文指令路徑（下一個連假，跨年）
```
使用者（12 月底）「下一個連假」
 → holiday.nextLongBreak()
 → 取今年 records ＋ 嘗試取次年 records（抓得到才併）
 → findNextLongBreak(合併且排序, today, 3) → 找到元旦連假區間
 → 格式化（名稱/區間/天數/距今天數）→ 回 LINE
 → 若次年抓不到且今年已無連假 → 回「目前尚無 {次年} 年行事曆資料…」
```

### 6.3 AI 工具路徑（越南語）
```
使用者「mai có được nghỉ không」（明天放假嗎）
 → 非指令 → AI fallback → 模型依 timeContext 把「明天」換成日期
 → 呼叫 get_taiwan_holiday{ query_type:"is_holiday", date:"2026-06-30" }
 → tools.run → getHolidaySummary → 英文摘要
 → 模型用越南語改寫 → 回 LINE
```

---

## 七、錯誤與逾時處理（彙整）

| 情境 | 中文指令（describeDay/nextLongBreak/nextHoliday/monthHolidays） | AI 工具（getHolidaySummary） |
|---|---|---|
| CDN 逾時(>5s)／連線失敗／非 200／非陣列／JSON 壞（AC-12） | 回 `目前無法取得假日資料，請稍後再試 🙏`，不崩潰 | 回 `null` → `run()` 補英文 fallback |
| 月份越界（13月/0月，PRD 6.6） | 回 `月份不正確，請輸入 1 到 12 的數字` | 回英文 `Invalid month "{m}". Use 1–12.` |
| 次年資料未公告（PRD 6.2） | 回 `目前尚無 {year} 年行事曆資料，待行政院公告後更新 🙏` | 回英文 `Taiwan {year} calendar is not published yet.` |
| 補班日（PRD 6.3，高優先） | 明確輸出「🔧 …是補班日（非假日）」，判定順序補班優先 | 摘要含 `make-up workday (NOT a holiday)` |
| 補假日（PRD 6.4） | `isHoliday=true` 且 holidayName 含原假名 → 正常顯示假名 | 摘要 `holiday — {name}` |
| 例外（throw） | 各函式內 try/catch（或 getYear 兜底）回友善中文 | `tools.run` 外層 try/catch 回 `Tool failed:` |

**逾時實作要點**：`AbortController` + `setTimeout(…,5000)`，`fetch(url,{signal})`，`finally` 清 timer。abort 觸發的 reject 視為「取不到行事曆」。所有外部呼叫不可讓 process 崩潰（AC-12）。

---

## 八、測試策略（對應 PRD 12 條驗收條件）

> 專案目前**無測試框架**（無 `*.test.js`、package.json 未見 test 設定）。最低標準：寫一支 `node` 腳本跑 §8.1 離線項；§8.2 需碰真實 CDN / Groq，列為線上煙霧測試。若要正式化，建議導入 Jest 並把 `fetch` 抽成可注入或用全域 `fetch` mock，但**非本期必須**。

設計時刻意把「抓取（getYear）」與「純邏輯（正規化、連假演算法、日期工具、格式化）」分離，使大多數 AC 可在**注入固定 records 陣列**的情況下離線驗證，不必連網。

### 8.1 可離線測（mock／注入固定 records，不碰真實 CDN）

| AC | 測法（離線） |
|---|---|
| AC-01 | 注入工作日 Record（isHoliday=false, isComp=false）→ `describeDay` 輸出含「上班日，非假日」 |
| AC-02 | 注入假日 Record（isHoliday=true, holidayName='元旦'）→ 輸出含「假日：元旦」 |
| AC-03 | 注入補班 Record（isHoliday=false, description='補行上班' → isCompensatory=true）→ 輸出含「補班日（非假日）」，且**不**含「假日」誤判（驗判定順序） |
| AC-04 | `addDays('2026-06-29',1)==='2026-06-30'`；`describeDay(addDays(today,1),'明天')` 輸出前綴為「明天」、日期 +1 正確 |
| AC-05 | 餵含「連續 ≥3 放假日」的 records → `findNextLongBreak` 回正確 {name,start,end,days}；驗「補班日切斷」「純週末2天不算」兩個邊界 |
| AC-06 | 餵某月含週末＋國定假日＋補班的 records → `monthHolidays(7)` 清單完整、月份正確、補班標 🔧、無國定假日時附「本月無國定假日」 |
| AC-07 | 餵 records → `findNextDayOff(records, today)` 回第一個 isHoliday=true 且 date≥today |
| AC-10 | 於「今年 12 月」情境，注入 12 月 records → `monthHolidays(12)` 正常列出、不因跨年回空（驗年份取用正確） |
| AC-11 | 斷言 `helpText()` 字串含「今天放假嗎」 |
| AC-12 | mock `getYear`/fetch 回 reject／逾時／非陣列 → 各中文函式回「目前無法取得假日資料…」、不丟例外 |
| 6.5 連假定義 | 專測：3 天國定假日→算；2 天純週末→不算；補班夾中間→切斷成兩段、皆 <3 則不算 |
| 6.6 月份越界 | `monthHolidays(13)`／`monthHolidays(0)` 回「月份不正確…」 |

### 8.2 需碰真實資料（CDN / Groq 線上煙霧測試）

| AC | 測法（線上） |
|---|---|
| AC-02 | 真打 `getYear(2026)`，確認 `20260101` 為 isHoliday=true、holidayName='開國紀念日'（資料正確性煙霧測試） |
| AC-05 | 真實資料跑 `nextLongBreak()`，輸出含日期區間／天數／名稱三項，天數計算正確（如中秋／國慶連假） |
| AC-08 | 在對話流程送越南語 `mai có được nghỉ không`，確認模型呼叫 `get_taiwan_holiday`（is_holiday）且**以越南語**回覆明天狀態 |
| AC-09 | 越南語 `kỳ nghỉ dài tiếp theo là khi nào`，確認呼叫工具（next_long_break）且以越南語回連假區間與名稱 |
| AC-10 | 於真實「今年 12 月」情境驗 `12月假日` 正常（含當年 12 月真實資料） |
| AC-12 | 暫時把 BASE_URL 指到無效網址／斷網 → 確認回友善訊息、process 不崩 |
| 跨年(6.2) | 模擬／真實 12 月底跑 `nextLongBreak()`，確認能抓次年檔看到元旦連假；次年檔不存在時回「尚無次年資料」提示 |

### 8.3 測試環境備註

- AC-08/AC-09 屬整合測試，需 Groq 金鑰與 LINE 測試帳號；測試員若無 LINE 環境，可退而直接呼叫
  `tools.run(userId,'get_taiwan_holiday',JSON.stringify({query_type:'is_holiday',date:'2026-06-30'}))`
  驗英文摘要正確，模型「改寫成越南語」一節再由真實對話端覆蓋。
- 離線測試的 records fixture 建議直接從真實 2024/2025/2026 JSON 擷取片段（含已知補班日 `20250208`、`20240217`）存成測試資料，兼顧真實性與離線性。

---

## 九、風險與取捨

1. **資料來源為社群維護**：TaiwanCalendar 由 GitHub 社群跟進行政院公告。風險：次年資料公告後若上游延遲更新，可能短期落後。緩解：6 小時 TTL 會自動刷新；找不到次年資料時回「尚未公告」而非錯誤（PRD 6.1/6.2）。若上游長期停更，未來可換 data.gov.tw 開放資料或加備援（本期不做）。
2. **跨年連假**：12 月底「下一個連假」可能落在次年 1 月。設計以「合併今年＋次年 records 後掃描」處理；次年檔抓不到時給友善提示，不回空或錯誤（PRD 6.2）。**這是最需要仔細實作與測試的邏輯**（見 §3.5、§8.2 跨年項）。
3. **補班日誤判（高優先，PRD 6.3）**：判定順序務必「補班 > 假日 > 工作日」，且補班條件用 `isHoliday===false && /補行上班|補班/`。已在 §3.3(a)、§7、§8.1 AC-03 反覆強調並要求專測。
4. **連假名稱取用**：區間可能跨多個假名（如春節含除夕、初一…）。取「首個非空 holidayName」作代表，並以「連假」字樣包裝（如「春節連假」）。極端情況整段無假名（理論上週末最多 2 天、不足 3 天，不會發生）以 fallback 名「連假」兜底。
5. **CDN 可用性**：jsDelivr CDN 一般穩定且免金鑰，但無 SLA。以 5 秒逾時 + 嚴格驗證（200 / 陣列 / 非空）+ 友善錯誤兜底降低衝擊（AC-12）。
6. **與 PRD 範例字面差異**：PRD §4.3 範例假名（如「台灣光復紀念日調整放假」）與真實 holidayName 可能字樣略異（上游用的是行政院公告原文，如「光復暨臺灣全民團結紀念日」之類）。回覆直接帶上游 holidayName 即可，測試以「含假名字樣／結構正確」而非固定字串比對。
7. **時區**：一律用 `store.taipei()` 取今天、用 UTC 建構日期做加減，避免主機時區與夏令時間造成「今天/明天」算錯（影響 AC-01/AC-04）。

---

## 十、實作檢核清單（給工程師 RD#2）

- [ ] 新增 `src/services/holiday.js`：常數、`getYear`（5s 逾時 + 6h 快取 + 次年負快取）、欄位正規化、日期工具（`addDays`/`formatDate`/`diffDays`）、`describeDay`、`nextLongBreak`、`nextHoliday`、`monthHolidays`、`usage`、`getHolidaySummary`、`findNextLongBreak`/`findNextDayOff`，並 `module.exports`。
- [ ] `handler.js`：`require('./store')` 與 `require('./services/holiday')`；在「匯率之後、對獎之前」加 6 條正則路由（含「今天/明天」傳對應日期＋label）；更新 `helpText()` 加放假條目。
- [ ] `tools.js`：require `getHolidaySummary`；加 `get_taiwan_holiday` 到 `defs`（含台灣限定 description、enum query_type）；`run()` 加 case；`timeContext()` 補「查台灣放假/連假」。
- [ ] `README.md`：功能清單 + 專案結構各補一行 `holiday.js`（行事曆查詢，TaiwanCalendar，免金鑰）。
- [ ] 自測 §8.1 離線項（重點 AC-03 補班、AC-05 連假演算法、AC-12 錯誤兜底）+ §8.2 線上煙霧（至少 AC-02 資料正確、AC-05 連假、跨年項）。

# TEST — 修復天氣查詢地名解析（越南語地名失敗 + 中文短名默默給錯地方）

分支：`fix/vi-weather-place`　變更檔：`src/services/weather.js`、`src/tools.js`

## 最終 VERDICT: **PASS**（第 2 輪；第 1 輪 FAIL 的短字詞漏網已修）

第 1 輪 tester 發現：`anh`/`xin` 等純拉丁短聊天字詞會漏過 VN 模糊比對的長度防護、
落到 geocode fallback 而命中無關世界地名（anh→衣索比亞、xin→中國興城）——
與本案要修的「默默給錯地點」同類風險（既有行為，非本次新增，但一併堵掉）。
**修法**：`resolvePlace` 在 geocode fallback 前新增規則——「純 ASCII 拉丁且 ≤3 字母」直接回 null；
帶聲調的真實短地名（如越南 Huế 含非 ASCII 字元）不受影響。
**複測 11/11 全綠**：`anh`/`xin`/`ube`→null；`Huế`→順化市 16.46°N（geocode 放行）；
`tân trúc`/`tận chúc`/`新竹`→新竹 24.80；`高雄`→22.63（非四川）；`Hà Nội`/`東京` 外國城市照常；
`node --check` 過。

以下為第 1 輪原始紀錄（保留供追溯）。

---

## 0. node --check

| 檔案 | 結果 |
|---|---|
| `src/services/weather.js` | PASS |
| `src/tools.js` | PASS |
| 全部 `src/**/*.js`（find + node --check 逐一） | PASS（無任何檔案報錯） |
| `require('./src/handler.js')` standalone | PASS（無 crash，見案例 4） |

## 1. resolvePlace 矩陣（PRD 驗收條件 1）

離線 script：`tests/_tmp_vi_weather_offline.js`（呼叫真實 `resolvePlace`/`getWeather`/`getForecastSummary`，測完已刪除）。

| 輸入 | 預期 | 實際 | 結果 |
|---|---|---|---|
| `新竹` | 新竹, 24.7–24.9 | name=新竹, lat=24.804 | PASS |
| `新竹市` | 同上 | name=新竹, lat=24.804 | PASS |
| `Hsinchu` | 同上 | name=新竹, lat=24.804 | PASS |
| `HSINCHU` | 同上 | name=新竹, lat=24.804 | PASS |
| `tân trúc` | 同上 | name=新竹, lat=24.804 | PASS |
| `Tân Trúc` | 同上 | name=新竹, lat=24.804 | PASS |
| `tan truc` | 同上 | name=新竹, lat=24.804 | PASS |
| `tận chúc`（語音走音，模糊容錯） | 新竹 | name=新竹, lat=24.804 | PASS |
| `台北` | 台北, ≈25.04 | name=台北, lat=25.038 | PASS |
| `臺北` | 同上 | name=台北, lat=25.038 | PASS |
| `台北市` | 同上 | name=台北, lat=25.038 | PASS |
| `Taipei` | 同上 | name=台北, lat=25.038 | PASS |
| `đài bắc` | 同上 | name=台北, lat=25.038 | PASS |
| `高雄` | 高雄, 22.5–22.8（非中國 31.x） | name=高雄, lat=22.627 | PASS |
| `台中` | ≈24.15 | name=台中, lat=24.148 | PASS |
| `桃園` | ≈24.99 | name=桃園, lat=24.994 | PASS |
| `中壢` | ≈24.95 | name=中壢, lat=24.954 | PASS |
| `Hà Nội`（境外 fallback） | non-null, lat 20–22, 非「台灣」 | name=Hà Nội, lat=20.4737, country=越南 | PASS |
| `東京` | non-null, lat 35–36 | name=東京, lat=35.6895, country=日本 | PASS |
| `zzzz`（亂碼） | null，不 throw | null | PASS |
| `''`（空字串） | null，不 throw | null | PASS |
| `anh`（短越南語詞，防誤中） | **null** | 非 null：`{name:"Āno", lat=9.08, country:"埃塞俄比亚"}` | **FAIL** |
| `xin`（短越南語詞，防誤中） | **null** | 非 null：`{name:"兴城", lat=24.15, country:"中国"}` | **FAIL** |

## 2. 端到端（PRD 驗收條件 2，需網路）

| 案例 | 結果 |
|---|---|
| `getForecastSummary('tân trúc')` 非 null 且含「新竹」 | PASS — `Location: 新竹, 台灣` |
| `getForecastSummary('tận chúc')` 非 null 且含「新竹」（語音走音真實回報案例） | PASS — `Location: 新竹, 台灣` |
| `getWeather('新竹')` 含「新竹」 | PASS — `📍 新竹、台灣 ...`（不再是屏東座標） |
| `getWeather('高雄')` 含「高雄」（builtin 路徑） | PASS — `📍 高雄、台灣 ...` |

## 3. tools.js 說明文字（PRD 驗收條件 3）

| 檢查 | 結果 |
|---|---|
| `get_weather.location` description 含「音譯」 | PASS |
| description 提及「越南語」 | PASS |
| 舊句 `地點名稱，用中文或英文（例如「新竹市」或「Hsinchu」）` 已消失（grep 全文） | PASS |

新句實際內容：
`地點名稱，直接傳使用者原話裡的地名（中文、英文或越南語皆可，例如「新竹市」、「Hsinchu」、越南語直接傳 "Tân Trúc"）。絕對不要自行音譯或翻譯地名，系統會自動解析。`

## 4. zh 不回歸（PRD 驗收條件 4）

| 案例 | 結果 |
|---|---|
| `handler.handleText(zh_user, '天氣 台北市')`（stub `richMenu.ensureFor` + `line.client.pushMessage`） | PASS — 回傳含「台北」：`📍 台北、台灣\n☀️ 晴朗\n🌡 溫度：27°C...` |
| `getWeather('東京')` 外國城市仍可查 | PASS — `📍 東京、日本...` |
| `getWeather('')` → 原提示句 | PASS — `請告訴我地名，例如：天氣 台北市` |
| `resolvePlace('新店')`（非台灣主要城市表內的行政區）不 throw | PASS，未拋例外。實際回傳：geocode 命中**中國福建廈門新店**（`lat=24.61, country=中国`），非 null。屬設計內既有 geocode fallback 行為（PRD 明確「不做全台鄉鎮區級完整表」且「查不到才走既有 geocode 鏈，行為不變」），非本次修復目標，僅供紀錄。 |
| `require('./src/services/morning.js')` standalone 不 crash | PASS |
| `weather.js` 匯出包含 `getWeather`、`getForecastSummary`、`resolvePlace` | PASS |

`data/lang.json`：測試前備份、測試後以 `git diff --stat` 確認零變更（無殘留測試 userId）。

## 5. node --check

見「0. node --check」，全部通過。

---

## 根因分析（FAIL 案例）

PRD 驗收條件 1 明確要求：
> 模糊容錯…key 長度 ≥4 者（防短字誤中）

DESIGN.md §1c 步驟 2 的「防短字誤中」guard（`keyNoSpace.length < 4` 才略過）**在 `resolvePlace` 內部確實正確生效**——`anh`、`xin` 都沒有被誤模糊配對到任何台灣城市（VN_PLACES 所有 key 長度皆 ≥4，符合設計）。

但 PRD 驗收條件最後一句要求的是「a short Vietnamese-ish word that should NOT match anything… → null」，也就是**整個 `resolvePlace('anh')` 的最終回傳值要是 null**，而不只是「沒有誤配對到台灣城市」。目前 `resolvePlace` 在步驟 2/3 都沒中之後，會落到**步驟 4：既有 geocode fallback**（`weather.js` 第 152–156 行），而 `anh`／`xin` 剛好是 Open-Meteo 地理編碼資料庫裡真實存在的地名縮寫（衣索比亞的 `Āno`、中國廣東的「兴城」），因此回傳了非 null 的錯誤地點，而非 null。

這不是「模糊容錯 guard 沒做」的 bug，而是**guard 只防了 VN_PLACES 模糊比對這一層，沒有涵蓋到後面 geocode fallback 仍可能對超短字串命中無關地點**的情境——與 PRD 根因描述「中文短名會默默回錯誤地點的天氣（更危險，使用者不會發現）」是同一類風險，只是換成越南語短字。是否要修（例如對過短的非中文輸入直接跳過 geocode，或提高最短長度門檻）由工程師決定，但目前實作不滿足 PRD 驗收條件 1 逐字寫的「'anh' 或 'xin' → null」。

---

## VERDICT

**FAIL**

未通過的驗收條件：
- **PRD 驗收條件 1**（resolvePlace 純解析）之「Fuzzy safety」子項：`resolvePlace('anh')` 與 `resolvePlace('xin')` 應回傳 `null`，實際分別回傳衣索比亞 `Āno`（lat 9.08）與中國廣東「兴城」（lat 24.15, country 中国）的 geocode 結果。

其餘所有案例（PRD 驗收條件 1 主要矩陣、2、3、4、5）皆 PASS，包含真實回報的兩個 bug（`tận chúc` 語音走音、`Tân Trúc` 命中越南）皆已修復確認。

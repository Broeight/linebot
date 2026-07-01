# TEST — tra-train-fix

VERDICT: **PASS**（第 2 輪；第 1 輪 FAIL 的「台北→臺北」迴歸已修）

## 更新（第 2 輪，修迴歸後複測）
第 1 輪 tester 抓到一個**分支既有迴歸**：`fetchStations()` 只把 `臺→台` 用在 map 的 key，
value 的 `.name` 仍存 PTX 原始「臺北」，導致所有台北相關輸入回傳「臺北」而非慣用「台北」。
已依 tester 建議修正（`fetchStations()` 內 `name` 也做臺→台正規化）。
複測 16 個站名案例 + 端到端全部 PASS：

| 類別 | 第1輪 | 第2輪（修後） |
|---|---|---|
| 新竹/中壢/高雄 越南語與變體（10 例） | PASS | PASS |
| 台北相關（`Đài Bắc`/`dai bac`/`台北`/`臺北`/`北車`/`台北車站`，6 例） | **FAIL→臺北** | **PASS→台北** |
| E2E `tân trúc→trung lì`（明天） | PASS | PASS |
| `node --check` 兩檔 | PASS | PASS |

以下為第 1 輪原始紀錄（保留供追溯）。

---

VERDICT（第 1 輪）: FAIL

## 環境
- 分支：`fix/tra-train-multilingual-stations`
- 測試方式：純 Node 腳本（`node _ttfix_test.js`，測完已刪除），直接呼叫真實函式，需連網（PTX API），實測時網路正常、無 flake。

## node --check
| 檔案 | 結果 |
|---|---|
| `src/tools.js` | PASS |
| `src/services/traTrain.js` | PASS |
| 其餘 `src/**/*.js`（掃描） | PASS（無語法錯誤） |

## Test 1 — normalizeStation

| 輸入 | 期望 | 實際 | 結果 |
|---|---|---|---|
| `Tân Trúc` | 新竹 | 新竹 (1210) | PASS |
| `tân trúc` | 新竹 | 新竹 (1210) | PASS |
| `tan truc` | 新竹 | 新竹 (1210) | PASS |
| `Trung Lịch` | 中壢 | 中壢 (1100) | PASS |
| `trung lich` | 中壢 | 中壢 (1100) | PASS |
| `trung ly` | 中壢 | 中壢 (1100) | PASS |
| `trung lì` | 中壢 | 中壢 (1100) | PASS |
| `trung li` | 中壢 | 中壢 (1100) | PASS |
| `Đài Bắc` | 台北 | **臺北** (1000) | **FAIL** |
| `dai bac` | 台北 | **臺北** (1000) | **FAIL** |
| `Cao Hùng` | 高雄 | 高雄 (4400) | PASS |
| `台北`（回歸） | 台北 | **臺北** (1000) | **FAIL** |
| `臺北`（回歸） | 台北 | **臺北** (1000) | **FAIL** |
| `Hsinchu`（回歸） | 新竹 | 新竹 (1210) | PASS |
| `北車`（回歸） | 台北 | **臺北** (1000) | **FAIL** |
| `台北車站`（回歸） | 台北 | **臺北** (1000) | **FAIL** |

## Test 2 — tools.js 提示語不再強制中文

| 檢查項 | 結果 |
|---|---|
| `src/tools.js` 不含 `'傳中文站名'` | PASS |
| `src/tools.js` 不含 `'優先用中文站名'` | PASS |
| `timeContext()` 回傳字串不含 `'傳中文站名'` | PASS |

## Test 3 — 端到端（真實回報情境）

呼叫：`getTraTrainSummary({ from: 'tân trúc', to: 'trung lì', day: 'tomorrow' })`

實際回傳字串：
```
TRA trains tomorrow (2026-07-02) from 新竹 to 中壢:
No.1112 Local Train 04:59->05:45 (0h46m); No.1122 Local Train 05:29->06:15 (0h46m); No.272 Tze-Chiang Express 05:52->06:29 (0h37m); No.1128 Local Train 05:57->06:44 (0h47m); No.1132 Local Train 06:18->07:03 (0h45m).
Source: Taiwan Railway (TRA) via MOTC PTX.
```

| 檢查項 | 結果 |
|---|---|
| 回傳非 null 字串 | PASS |
| 不含 `'Station not recognized'` | PASS |
| 符合預期格式（班次列表/無班次/下一班訊息） | PASS |
| 訊息中同時出現「新竹」「中壢」 | PASS |

Test 3（本次 bug report 的核心情境：越南語站名不再被 AI 自行音譯猜錯漢字，工具正確解析出新竹→中壢並查到班次）**完全通過**。

## FAIL 明細（需工程師修）

**驗收條件 #1 的「台北」相關案例全部失敗**（`Đài Bắc`、`dai bac`、`台北`、`臺北`、`北車`、`台北車站` 六個 case），且明確違反 PRD 中寫明的「不回歸」要求：
> 中文原樣 `台北`、英文 `Hsinchu`、簡稱 `北車` 仍照舊可辨識（不回歸）

**現象**：所有應解析為「台北」的輸入，`normalizeStation()` 都回傳 `{"name":"臺北", ...}`（正體「臺」），而非 PRD 要求、也是專案慣用俗寫的「台北」。其餘站名（新竹、中壢、高雄）不受影響，只有台北受影響。

**根因（比對 `git diff main...HEAD -- src/services/traTrain.js` 確認為本分支新引入的迴歸）**：
- 舊版 `normalizeStation` 純查內建 `STATIONS` 表（key 為「台北」），回傳一定是「台北」。
- 新版改為優先呼叫 `fetchStations()` 抓 PTX 官方車站清單，並用該清單的 `StationName.Zh_tw` 當作回傳的 `.name`：
  ```js
  zh[nameZh.replace(/臺/g, '台')] = { name: nameZh, id };
  ```
  這行只把**查表用的 key**做了臺→台正規化（`nameZh.replace(/臺/g,'台')` 只用在 `zh[...]` 的 key），但**存進 value 的 `name` 欄位仍是 PTX 原始的 `nameZh`**（未做臺→台轉換）。PTX 官方對台北站的 `Zh_tw` 就是「臺北」，於是 `normalizeStation('台北')` 查到 `maps.zh['台北']` 命中，但回傳的物件是 `{ name: '臺北', id: '1000' }`。
  - 因為現在測試環境能連上 PTX（`fetchStations()` 成功），不會走到內建 `STATIONS` 備援（那裡的 key 才是正確的「台北」），所以規避了原本可能救回來的 fallback。

**建議修法**（僅供參考，交給工程師决定）：在 `fetchStations()` 組 `zh`/`en` map 時，`value.name` 也要做 `nameZh.replace(/臺/g, '台')`，讓官方回傳的正體字一律轉俗寫，例如：
```js
const nameZhShort = nameZh.replace(/臺/g, '台');
zh[nameZhShort] = { name: nameZhShort, id };
if (nameEn) en[nameEn.toLowerCase()] = { name: nameZhShort, id };
```
（若擔心影響其他仍需保留正體的場景，至少要讓「台北」這類常見俗寫站名回傳一致，符合 PRD 不回歸要求。）

## 已清理
- 測試腳本 `F:\Linebot\_ttfix_test.js` 已於測試結束後刪除。
- 未寫入 `data/`、未建立假 userId 資料、未修改任何 `src/` 原始碼。

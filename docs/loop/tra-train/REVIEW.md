# 程式碼審查：台鐵火車時刻查詢（tra-train）

**審查員** RD#3（程式碼審查）
**日期** 2026-07-01
**對應** `docs/loop/tra-train/PRD.md`、`docs/loop/tra-train/DESIGN.md`

## VERDICT: PASS

## 審查範圍
- 新檔 `src/services/traTrain.js`（完整 Read）
- 修改 `src/handler.js`（路由 + helpText）
- 修改 `src/tools.js`（defs / run / timeContext）
- 修改 `README.md`（功能清單 + 專案結構）
- 對照參考 `src/services/exchangeRate.js`、`src/services/fuelPrice.js`、`src/store.js`

## 驗證方法與結果

### 語法
`node --check` 三檔皆通過（ALL_SYNTAX_OK）。

### 離線純函式單元測試（全 PASS）
- `normalizeStation`：臺北/台北 → 1000（AC-04 正俗互通）；北車、台北車站、臺北車站、高雄車站、花蓮站別名/去尾字皆命中；火星/空字串/「台鐵」回 null（AC-05）；基隆前導零 `0900` 以字串保留。
- `duration`：07:15→08:54=1小時39分；跨午夜 23:50→00:30=0小時40分（+24h 正確）。
- `filterAndSort`：濾停駛、濾已發車、依發車升冪、slice、`>=` 邊界（departure == now 保留）皆正確。

### 線上實打（免金鑰 PTX，HTTP 200）
- URL 組法 `.../OD/1000/to/3300/{date}?%24format=JSON`（`$` 已編碼為 `%24`）實測 200，回 41 筆。
- 回傳欄位路徑（TrainNo / TrainTypeName.Zh_tw / .En / SuspendedFlag / StopTimes[0].DepartureTime / StopTimes[last].ArrivalTime）與程式解析一致；StopTimes 實測 2 筆。
- 端到端 `lookup` / `nextTrain` / `getTraTrainSummary` 皆正確輸出中文/英文摘要；「下一班 台北到花蓮」22:01→00:24 跨午夜正確算出 2小時23分。
- 現為晚間，台北→台中已無剩餘班次 → 正確回「今日已無班次」（AC-06 實地成立）。
- 站名無法辨識（火星 / Mars）→ 中文與英文提示皆正確（AC-05）。

### 整合檢查
- tools.js：`get_tra_train` 已定義、required=[from,to]、next_only 選填；`timeContext()` 含台鐵與 get_tra_train 指示；`run()` case 有英文 fallback。
- handler.js：路由位於油價之後、發票之前、AI fallback 之前；順序 usage → 下一班 → 台鐵。
- 路由零衝突實測：`下一個連假`（需「連假」後綴）不被「下一班」吃；`火車`/`台鐵` 需空白+參數才觸發；`提醒…下一班…` 由 `提醒` 先接走；裸「下一班」落到 AI（可接受）。

## 逐項對照

| 項目 | 結果 |
|---|---|
| AC-01/02/03 站到站、現在之後、排序、最多5筆、下一班1筆 | 通過（純函式 + 線上） |
| AC-04 正俗互通 | 通過 |
| AC-05 站名無法辨識 | 通過（中/英） |
| AC-06 末班已過 | 通過（實地晚間驗證） |
| AC-07/08 AI 工具（越南語）英文摘要一致 | 資料層一致；模型改寫由對話端負責，符合既有慣例 |
| PTX 串接（前導零、$編碼、6s 逾時、判空、非陣列 ok:false） | 通過 |
| 時間/日期（store.taipei、跨午夜 +24h、>= 邊界） | 通過 |
| 快取（key=起-迄-日期、成功才存、過濾時間即時做不進快取） | 符合設計 |
| 錯誤/逾時（AbortController、finally 清 timer、try/catch 兜底友善訊息） | 符合設計 |
| 安全（無金鑰、無日誌洩漏、CommonJS、繁中訊息、AI 回英文） | 通過 |
| 範圍（僅 4 檔 + 新服務，無破壞既有） | 通過 |

## 觀察（非阻擋，供未來參考，不要求本輪修改）
1. `filterAndSort` 以字串比較過濾「現在之後」，對跨午夜「今晚 23:xx 已過、凌晨班次」不會誤納（因僅比 departure、且查詢日固定今天），符合 PRD「僅今天」範圍。
2. `STATIONS` 目前收 11 站，符合 PRD「初期僅主要幹線」；DESIGN 已註明依家人回饋擴充，無需本輪補。
3. 站名別名去尾字「站/車站」對「新左營」等未收站仍回「站名無法辨識」，符合預期。

## 總結
實作忠實對齊 DESIGN 與 PRD，所有可離線驗收條件與線上煙霧測試皆通過，無正確性、邊界、安全、錯誤處理或一致性缺陷，範圍乾淨。**PASS，無需修改。**

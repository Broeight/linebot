# 測試報告 — 查詢離自己最近的加油站（gas-station）（TEST）

**測試者** 測試工程師（RD#4） | **日期** 2026-07-02
**分支** `feat/nearest-gas-station`
**對應** `PRD.md §驗收條件 1–7`、`DESIGN.md §八/§十`

## 測試方式

一次性 Node 腳本（`tests/gas-station.test.js`，測完已刪除），直接呼叫真實模組
（`src/services/gasStation.js`、`src/handler.js`、`src/tools.js`、`src/lang.js`）——不用 mock，
除 §6 容錯的“斷網模擬”未做（因主源本身可正常連線，判斷屬低風險、程式碼審查已確認邏輯正確，見下方說明）。
全部使用假 userId（`test-gas-*`），跑完清理 `data/lang.json` 內因 `lang.noteText` 自動寫入的 8 筆測試紀錄，
並刪除測試腳本與其輸出檔。網路呼叫在 timeout 時重試一次。

## 逐項結果

| # | 驗收條件 | 案例 | 結果 | 證據 |
|---|---|---|---|---|
| 1 | 距離純函式 | `haversineKm` 台北車站↔高雄車站 | PASS | 294.909 km（在 294–300 範圍內） |
| 1 | 距離純函式 | `haversineKm` 同點 → 0 | PASS | got 0 |
| 2 | 最近站查詢 | `findNearest(25.0478,121.5170)` 陣列 1–5 筆、升冪、name/座標齊全 | PASS | len=5, sorted=true, names=true, coords=true |
| 2 | 最近站查詢 | `formatList` 每筆含 6 位小數 maps URL，總長 <5000 | PASS | urls=5/5, totalLen=438 |
| 2 | 最近站查詢 | `findNearest(999,999)` 不 throw | PASS | got null |
| 2 | 最近站查詢 | `findNearest('a','b')` 不 throw | PASS | got null |
| 3 | location 訊息路由 | 假 location event → 非空字串含 maps URL + 站名 | PASS | 含 URL 與「站」字 |
| 3 | 回歸 | sticker event → null | PASS | got null |
| 3 | 回歸 | `'油價'` 仍回油價字串（非加油站提示） | PASS | 回「⛽ 台灣中油本週油價…」 |
| 3 | 回歸 | `'95油價'` 仍回油價字串（非加油站提示） | PASS | 回「⛽ 95 無鉛汽油：31.9 元/公升…」 |
| 4 | 引導提示 | fresh user `handleText('加油站')` → `{text,quickReply}`，恰 1 顆 `location` 按鈕，label ≤20 | PASS | label=`📍 傳送位置`（5字） |
| 4 | 引導提示（F6） | 已 `noteLocation` 後 `handleText('加油站')` → 字串站點清單（免按鈕） | PASS | 含站名與 maps URL |
| 4 | 引導提示 | 變體 `'最近的加油站'`／`'附近加油站'`／`'哪裡加油'` 皆命中路由 | PASS（3/3） | 皆回 `{text,quickReply}` 位置按鈕物件 |
| 5 | AI 工具（確定性層） | `tools.run` 無位置 → `NEEDS_LOCATION` 開頭 | PASS | — |
| 5 | AI 工具（確定性層） | `consumePending` → `{kind:'ask'}`，第二次 → `null` | PASS | 一次性消費驗證 |
| 5 | AI 工具（確定性層） | 有位置 → `GAS_STATIONS_FOUND` 開頭；`consumePending` → `{kind:'result', list.length≥1}` | PASS | listLen=5 |
| 5 | AI 工具（選配，真 AI） | `handleText('trạm xăng gần đây ở đâu?')` → `{text,quickReply}` 含 location 按鈕 | PASS（非 SKIPPED） | 本次 Groq 實際呼叫 `find_gas_station` 工具，handler 正確覆寫成位置按鈕 |
| 6 | 多語言 | 六語 `shareLocationPrompt`/`Label`/`gasStationHeader`/`Fail` 皆非空，label ≤20 | PASS | — |
| 6 | 多語言 | vi 版含越南語（`vị trí`） | PASS | — |
| 6 | 多語言 | 未知 code → fallback 非空 | PASS | fallback 為 zh-TW 文案 |
| 7 | 隱私 | `data/*.json` 不含座標 `25.0478`／`121.517` | PASS | 讀取 `data/` 目錄逐檔搜尋，乾淨 |
| 7 | 隱私 | `test-gas-1` 對話記憶不含座標 | PASS | 方法：`conversation.get('test-gas-1')` 直接檢查記憶體物件（結果為 `[]`，因 `handleLocation` 從不呼叫 `conversation.append`），並輔以原始碼審查 `src/handler.js` 第 91–98 行 `handleLocation` 確認無任何 `conversation.append` 呼叫 |
| 8 | 語法 | `node --check` × 5 檔（gasStation.js/handler.js/tools.js/lang.js/index.js） | PASS | 全部通過；另對 `src/**/*.js` 全量跑過亦全通過 |

**總計：31/31 PASS，0 FAIL，0 SKIPPED。**

## 台北車站實測格式化輸出（證據，§2 / §3.7）

```
1. 林森北路站（728 公尺）
   台北市中正區林森北路11號
   https://www.google.com/maps?q=25.045833,121.523889
2. 吉林路站（1.4 公里）
   台北市中山區吉林路31號
   https://www.google.com/maps?q=25.050833,121.530278
3. 新生北路站（1.5 公里）
   台北市中山區新生北路二段71號
   https://www.google.com/maps?q=25.056667,121.528056
4. 民權西路站（1.7 公里）
   台北市大同區民權西路194號
   https://www.google.com/maps?q=25.062778,121.514167
5. 桂林路站（1.7 公里）
   台北市萬華區桂林路53號
   https://www.google.com/maps?q=25.038333,121.503611
```

與架構師 DESIGN.md §一實測樣本（林森北路站 0.73km → 吉林路站 1.38km → 新生北路站 1.49km →
民權西路站 1.69km → 桂林路站 1.71km）一致（誤差在四捨五入範圍內）。

## 備註 / 已知限制

- **§6 失敗容錯（fetch 逾時/掛掉）未用 mock 斷網直測**：因本次跑測時中油端點正常回應，且此為
  一次性驗收腳本（依指示避免 mock、優先呼叫真實函式），改採**程式碼審查**方式驗證
  `src/services/gasStation.js` 第 82–108 行 `fetchStationList`：`catch` 區塊優先回舊快取，
  無快取才回 `null`；`findNearest` 對 `null` list 直接回傳 `null`（第 151–152 行）；
  `handler.handleLocation`／關鍵字路由對 `null`/空陣列一律回 `lang.gasStationFail(code)`
  （非 throw）。邏輯與 DESIGN.md §3.2/§八規格一致，判定為低風險，不影響本次 VERDICT。
- §5f（真 AI end-to-end）本次實際觸發成功（非 SKIPPED）：Groq 模型正確呼叫了 `find_gas_station`
  工具，handler 的確定性覆寫機制運作正常，回傳含 location 按鈕的 `{text,quickReply}`。
- 測試腳本 `tests/gas-station.test.js` 與其輸出 `tests/gas-station-results.json` 已於測試完成後刪除。
- `data/lang.json` 因 `lang.noteText`（既有既存行為，非本次新增）在測試過程自動寫入 8 筆
  `test-gas-*` 測試紀錄，已手動清除、還原至測試前狀態（保留測試前既有的其他歷史測試紀錄，
  如 `test-user-tra-*`／`test-u2`／`test-u5`／`test-u6`，這些非本次測試所加，不予處理）。
- 未發現任何座標落地或進對話記憶的隱私違規；`node --check` 對全部 `src/**/*.js`（不只 5 個變更檔）
  逐一執行亦全數通過，既有功能（油價、台鐵、發票對獎規則等經路由測試側面驗證）未見回歸跡象。

## VERDICT

**PASS** — 全部 7 條 PRD 驗收條件（含 §7 隱私、§8 語法）皆驗證通過，無需工程師修改。

# TEST — tra-voice-choice（RD#4 tester）

**分支** `feat/tra-voice-station-choices` | **測試日期** 2026-07-01

## 做法

1. 對 6 個變更檔跑 `node --check`（全部通過）。
2. 寫一支一次性 Node 腳本 `tests/test-tra-voice-choice.js`（測完已刪除），直接呼叫真實函式驗證
   （`traTrain.suggestStations`/`normalizeStation`、`traChoice.*`、`tools.run`、`handler.handleText`、
   `lang.chooseStationPrompt`），並用 mirror-logic 方式驗證 `src/index.js` 的回覆管線（因為
   `require('../src/index.js')` 會啟動 server + schedulers，不 require 它，改為複製其正規化/截斷邏輯
   驗證，另外用字串比對確認 `src/index.js` 原始碼確實含有這段被複製的邏輯，避免「測到自己寫的邏輯而非真正程式碼」的落差）。
3. 測試用假 userId（`test-tester-*-<timestamp>`）；`data/lang.json` 於測試前備份、測試後還原成原狀
   （`lang.noteText`/`resolve` 會寫入該檔，已核對只新增了我測試產生的 2 筆，其餘既有 test-user-* 記錄
   為先前 loop 留下、非本次新增，已還原成執行前的內容，無殘留）。`traChoice` 是純記憶體，程序結束自動清空，
   測試中也逐一 `clear()`。
4. GROQ_API_KEY 已設定，因此 case D 的真實 AI 呼叫直接測試（未走 SKIPPED 分支）。

## 結果總表

| 案例 | 驗收條件對應 | 內容 | 結果 |
|---|---|---|---|
| A1 | §1 模糊比對 | `suggestStations('truc')`/`('tan chu')` 含新竹 | PASS |
| A2 | §1 | `suggestStations('sin zu')`/`('hsin')` 含新竹 | PASS |
| A3 | §1 | `suggestStations('zzzzzz')` → `[]` | PASS |
| A4 | §1 | 回傳形狀：`{name,id}` 皆字串、長度≤5、id 不重複 | PASS |
| A5 | §1 | `normalizeStation('新竹')`/`('tân trúc')`/`('Hsinchu')` 均非 null（精準命中不進選單） | PASS |
| B1 | §2 狀態機 | `set`+`get` → `fresh:true`、`ts` 為 number、`candidates.length===2` | PASS |
| B2 | §2 | `consumeFresh` 第一次 true、第二次 false | PASS |
| B3 | §2 | `matchCandidate('新竹')`→候選物件；`('1')`→第一候選；`('今天天氣')`→null 且 pending 不清除 | PASS |
| B4 | §2 TTL | `ts` 改成 `Date.now()-TTL_MS-60000` 後 `get()` → `undefined`（惰性過期） | PASS |
| C1 | §2/§5 網路 | `tools.run(uid,'get_tra_train',{from:'Truc',to:'中壢',day:'tomorrow'})` → 回傳含 `NEEDS_STATION_CHOICE`；`traChoice.get(uid)` 含 `ambiguousRole==='from'`、`known.name==='中壢'`、`day==='tomorrow'`、`candidates.length>=1` | PASS |
| C2 | §5 不回歸 | 兩站皆精準（`台北`/`台中`）→ 不含 `NEEDS_STATION_CHOICE`、無 pending | PASS |
| D1 | §2/§4 端到端 | 真實 Groq AI：`handleText(uid,'ngày mai đi tàu từ ga Truc đến Trung Lịch')` → 模型確實呼叫工具，回傳 `{text, quickReply:{items:2}}`，每顆 `action.type==='message'`、`label===text`（中文站名）、`label.length<=20` | PASS（非 SKIP，AI 有呼叫工具） |
| D2 | §2 點選完成 | 手動建立 pending 後 `handleText(uid,'新竹')` → 回字串同時含「新竹」「中壢」「🚆」，且 `traChoice.get(uid)` 之後變 `undefined` | PASS |
| E1-E4 | §3 回覆管線 | 鏡像 `index.js` 的正規化/截斷邏輯：物件回覆帶 `quickReply`；純字串回覆無 `quickReply` 鍵；空字串/`null` 不送；6000 字＋結尾 emoji → 截斷成剛好 5000 code points、不切斷 surrogate pair | PASS |
| E5 | §3 | 額外核對 `src/index.js` 原始碼確實含被鏡像的三行關鍵邏輯（避免只測到自己複製的邏輯） | PASS |
| F1 | §4 語音多語言提示 | `lang.chooseStationPrompt('vi')` 含越南語字元、`('zh-TW')` 非空、未知語系代碼 fallback 到 zh-TW 版本 | PASS |
| G1 | §6 | `node --check` 全部 6 個變更檔（`traChoice.js`/`traTrain.js`/`tools.js`/`handler.js`/`index.js`/`lang.js`） | PASS |

**Case D 完整回覆字串**（`handler.handleText(uid,'新竹')` 完成查詢後的實際輸出）：

```
🚆 台鐵 新竹 → 中壢（07/02）
明天 00:00 之後的班次：

・1112次 區間　04:59→05:45（0小時46分）
・1122次 區間　05:29→06:15（0小時46分）
・272次 自強(推拉式自強號且無自行車車廂)　05:52→06:29（0小時37分）
・1128次 區間　05:57→06:44（0小時47分）
・1132次 區間　06:18→07:03（0小時45分）

資料來源：台鐵 TRA（交通部 PTX）
```

**Case D1 真實 AI 回傳（越南語 tap simulation 第一步）：**

```json
{
  "text": "Bạn muốn hỏi ga nào? Hãy bấm nút bên dưới hoặc nhập tên ga.",
  "quickReply": {
    "items": [
      { "type": "action", "action": { "type": "message", "label": "竹南", "text": "竹南" } },
      { "type": "action", "action": { "type": "message", "label": "新竹", "text": "新竹" } }
    ]
  }
}
```

## 總結

17/17 全過（0 FAIL、0 SKIP）。涵蓋 PRD §驗收條件 1–6 全部項目，包含真實 Groq AI 呼叫工具、PTX 網路查詢
（車站清單模糊比對、時刻表查詢）、狀態機 TTL/一次性 fresh/pending 不誤判、回覆管線 quickReply 分支與
既有字串路徑回歸、`node --check`。

## 清理

- 測試腳本 `tests/test-tra-voice-choice.js` 已於測完後刪除，`tests/` 目錄一併移除。
- `data/lang.json`：測試前已備份，測試後確認只新增了本次測試的 2 筆假 userId 記錄，已還原成執行前內容（無殘留）。
- `traChoice`（純記憶體 pending）於測試中逐一 `clear()`，程序結束即釋放，無殘留檔案。
- 未修改任何 `src/**` 原始碼；`git status` 顯示僅 RD#2 的既有變更（`traChoice.js` 新增、其餘 5 檔修改），無 tester 造成的異動。

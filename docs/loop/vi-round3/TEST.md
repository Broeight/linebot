# TEST — 越南語無障礙第 3 輪（早安推播本地化＋首次歡迎＋台鐵車種翻譯）

RD#4（測試）驗證報告。分支 `feat/vi-round3`。未修改任何 `src/**` 檔案，未 commit。

## 做法

1. `node --check` 全部 4 個變更檔（`src/lang.js`、`src/services/morning.js`、`src/handler.js`、
   `src/services/traTrain.js`）。
2. 寫一支純 Node 測試腳本 `tests/test-vi-round3.js`（測完已刪除），直接呼叫真實函式
   （`morning.subscribe/unsubscribe/sendAll`、`handler.handleText`、`traTrain.getTraTrainByIds`），
   monkeypatch：
   - `require('./src/line').client.pushMessage` → 收集陣列（**全程未真的推送給任何真實 LINE userId**）
   - `require('./src/services/richMenu').ensureFor` → no-op（避免 LINE API 副作用）
   - `require('./src/services/weather').getWeather` → 固定回傳字串（早安推播案例用；case 6 台鐵不受影響）
   - `require('./src/ai').ask` → 計數／回固定字串／丟例外（依案例切換）
   - `require('./src/services/birthday').todays` → 回固定假資料（僅 case 2 生日行測試）
3. `data/lang.json` 測前備份、測後用 `diff` 驗證**逐位元組還原**；`data/morning.json`
   測前不存在，測後刪除（用假 userId，如 `test-r3-*`，不影響正式資料）。
4. Case 6（車種翻譯）依指示使用**一次真實**網路查詢（PTX，`getTraTrainByIds` ×3 次呼叫，同一起訖站
   `新竹→中壢`，`day:'tomorrow'` 避免受「現在時間之後」邊界影響）。

## 逐條結果

| # | 驗收條件（PRD） | 測項 | 結果 |
|---|---|---|---|
| 1 | zh 訂閱者逐字不回歸 | 1a subscribe 確認字串逐位元組相同；1b/1c 問候語 ∈ 現有 3 句；1d 天氣段原樣；1e `ai.ask` 呼叫次數 0；1f/1g unsubscribe 兩種情境字串逐位元組相同 | PASS（7/7） |
| 2 | vi 訂閱者本地化 | 2a 有推播；2b 問候語 ∈ vi 3 句；2c 天氣段含 AI 回傳值；2d `ai.ask` 恰呼叫 1 次；2e/2f 生日行含 `sinh nhật` 與姓名 | PASS（6/6） |
| 3 | 翻譯容錯 | 3a `ai.ask` 丟例外 → 訊息仍組成並推播、天氣段回退原中文；3b `ai.ask` 回空字串 → 同樣回退 | PASS（2/2） |
| 4 | vi 開關 + 中文不回歸 | 4a `bật tin sáng` → vi 確認含 "bản tin"；4b `morning.json` 寫入該使用者；4c `tắt bản tin sáng` → vi 關閉字串；4d 中文「開啟早安 高雄市」逐位元組相同；4e 中文「關閉早安」逐位元組相同 | PASS（5/5） |
| 5 | onboarding | 5a `tỷ giá`（vi 且確定性路由，未觸發 AI）正常處理；5b 恰 1 次 push；5c 內容含 `trợ giúp` 與 `👇`；5d `lang.json` 寫入 `welcomed:true`；5e 第二則 vi 訊息（`giá xăng`）不再推播；5f 旗標在後續訊息仍保持 `true`；5g zh 使用者（`油價`）從不推播 | PASS（7/7） |
| 6 | 車種翻譯 | 6a `code:'vi'` 班次行含英文車種（`Local Train`/`Tze-Chiang Express`）；6b 不傳 `code` 維持中文車種（區間/自強）；6c `nextOnly:true` + `code:'vi'` 同樣英文 | PASS（3/3，真實 PTX 查詢） |
| 7 | node --check + 廣泛回歸 | 7a 4 檔皆語法通過；7b `require(handler)` 未 crash；7c 中文「台鐵 台北 台中」回字串；7d 中文「選單」回 zh 選單；7e vi 使用者「trợ giúp」回 vi 選單 | PASS（5/5） |

**總計：35/35 PASS。**

## 證據摘錄

vi 早安推播訊息範例（stub 天氣＝`天氣RAW`、stub `ai.ask`→`TRANSLATED_WEATHER`）：
```
Chào buổi sáng ~ chúc bạn một ngày tuyệt vời ☀️

TRANSLATED_WEATHER
```

vi 首次歡迎 push 內容（`test-r3-onb`，經 `tỷ giá` 觸發）：
```
Chào bạn! 👋 Mình là trợ lý gia đình.
Bạn có thể nói chuyện với mình bằng tiếng Việt — nhắn chữ hoặc gửi tin nhắn thoại đều được.
Gõ "trợ giúp" để xem tất cả chức năng (giờ tàu, trạm xăng, tỷ giá, thời tiết...).
Bạn cũng có thể bấm menu ở cuối màn hình 👇
```

台鐵車種翻譯（真實 PTX 查詢，新竹→中壢，明天）：
- `code:'vi'`：`1112次 Local Train`、`272次 Tze-Chiang Express` …（英文車種＋越南語行駛時間 `0 giờ 46 phút`）
- 不傳 `code`：`1112次 區間`、`272次 自強(推拉式自強號且無自行車車廂)` …（逐字中文，與現況一致）

## 過程中發現且已排除的假陽性（非程式碼問題）

第一次跑測試時 case 1d／3a／3b 出現 FAIL：實際上是測試腳本本身的 bug——`morning.js`
用 `const { getWeather } = require('./weather')` 在載入當下解構賦值，若測試腳本在
`morning.js` **已經 require 之後**才去改寫 `weatherMod.getWeather`，該賦值不會反映到
`morning.js` 內部已綁定的區域變數，導致早安推播打了真的 Open-Meteo API（天氣文字非固定
字串，斷言失敗）。修正做法：把 `weather.js` 的 stub（用一層可變的中介函式）搬到
`require('./services/morning')` **之前**執行。修正後重跑，全部 35 項皆通過，與原始碼行為
無關。

## 清理

- `data/lang.json`：測後以 `diff` 驗證與測前備份逐位元組相同（已還原）。
- `data/morning.json`：測前不存在 → 測後已刪除。
- `tests/test-vi-round3.js`：已刪除（該次性腳本，測前 `tests/` 目錄本就不存在，已一併移除空目錄）。
- `git status --porcelain`：僅剩 4 個原始變更檔（`src/handler.js`、`src/lang.js`、
  `src/services/morning.js`、`src/services/traTrain.js`）與 `docs/loop/vi-round3/`（含本檔），
  無其他殘留。

## VERDICT

PASS — PRD 驗收條件 1–7 全數通過，未回歸既有中文行為，未真的推播訊息給任何真實 LINE 使用者。

# TEST — 提醒週期補完（每週／每月）＋ 刪除單筆提醒

> RD#4（獨立測試工程師）驗證報告，對應 `docs/loop/recurring-reminder/PRD.md` 驗收條件 1–11。
> 測試方式：離線單元/整合驗證，直接呼叫 `src/services/reminder.js`、`src/tools.js`、`src/handler.js` 的真實函式，
> 不 `require index.js`、不呼叫 `.start()`、`client.pushMessage`／其他 LINE API／`ai.askJSON` 皆 stub，
> 不花費 Groq 額度、不發送真實 LINE 訊息。測試腳本放在系統暫存目錄，未留在 repo。

**總結：89 項檢查，全部通過（89 PASS / 0 FAIL）。VERDICT = PASS。**

## 0. `node --check`（驗收 10 的一部分）

```
node --check src/services/reminder.js   → OK
node --check src/tools.js               → OK
node --check src/handler.js             → OK
```

## 1. 逐條驗收結果

| # | 驗收條件 | 結果 | 備註 |
|---|---|---|---|
| 1 | weekly 觸發（正確星期+時刻恰一次／同日不重推／隔日不觸發／下週再觸發） | **PASS** | 見下方樣本 |
| 2 | monthly 觸發（含短月 clamp 全邊界：5號一般月、31→2/28、30→2/28、31→4/30、3月28號不誤觸、跨月再觸發） | **PASS** | 全 6 個邊界情境皆通過 |
| 3 | 刪除單筆（編號刪除、99超範圍、abc非數字、裸字全刪不回歸、water tag 排除） | **PASS** | 含 `reminder.js` 直呼與 `handler.handleText()` 全鏈路整合兩層驗證 |
| 4 | once/daily 逐字不回歸（`add`/`list`/`clear`/`addParsed`/喝水提醒/拍照文件提醒/`set_reminder`） | **PASS** | 與 `git show HEAD:src/services/reminder.js` 舊版逐字比對，全部相同 |
| 5 | `tick()` 併發模式不回歸（防重入、reload-before-save 依 id 套用） | **PASS** | 見下方樣本 |
| 6 | AI 工具 `set_reminder` weekly/monthly happy path | **PASS** | 回覆含 `every Wednesday 19:00`／`every month on day 5` |
| 7 | `parse()`（askJSON）weekly/monthly 解析＋時刻缺漏預設 09:00 | **PASS** | stub askJSON 驗證 `add()` 分支 |
| 8 | 時區正確（Asia/Taipei 固定 +08:00，非伺服器本地時區） | **PASS** | 原始碼靜態檢查 + 公式獨立驗算（2026 非閏年、2月28天等） |
| 9 | 「提醒清單」四型別（once/daily/weekly/monthly）顯示清楚可分辨 | **PASS** | 見下方樣本；一項文件用字備註見 §3 |
| 10 | `store.js` 不變、`reminders.json` 在 `KNOWN_KEYS` 內 | **PASS** | `git diff HEAD -- src/store.js` 輸出為空 |
| 11 | 測試方法鐵律（不 require index.js／不呼叫 .start()／process.exit(0)／stub pushMessage／備份還原 data） | **PASS** | 全遵守，見 §4 |

## 2. 關鍵輸出樣本

### AC1 weekly 觸發矩陣
```
[PASS] AC1-a 正確星期三19:00觸發恰一次  :: pushCalls=1
[PASS] AC1-a2 觸發後 lastFired=當日日期  :: 2026-07-22
[PASS] AC1-b 同一天內多次 tick 不重推  :: pushCalls=1
[PASS] AC1-c 隔天(週四)同一時刻不觸發  :: pushCalls=1
[PASS] AC1-d 跨到下週三同一時刻再次觸發  :: pushCalls=2
[PASS] AC1-d2 lastFired 更新為新週三日期  :: 2026-07-29
```

### AC2 monthly 短月 clamp 邊界（全 6 情境）
```
31號遇2月：2/27不誤觸發 → pushCalls=0；2/28觸發恰一次 → pushCalls=1；同天重複tick不重推 → pushCalls=1
30號遇2月：2/28觸發恰一次 → pushCalls=1
31號遇4月：4/29不誤觸發 → pushCalls=0；4/30觸發恰一次 → pushCalls=1
3月(31天，dayOfMonth=31)：3/28不誤觸發 → pushCalls=0；3/31觸發恰一次 → pushCalls=1
跨月再觸發：2月底觸發一次(pushCalls=1) → 3/31再觸發(pushCalls=2)，lastFired 更新為 2026-03-31
```

### AC3 刪除單筆（含 handler.js 全鏈路整合，`client.pushMessage`/`getProfile`/rich menu API 皆 stub）
```
提醒清單（3筆，不含 water tag）:
⏰ 你的提醒：
1. 2026/8/4 上午11:22:30｜事項1
2. 每天 08:00｜事項2
3. 每週三 19:00｜事項3
💧 喝水提醒：開啟中

刪除提醒 2 → 🗑 已刪除提醒：每天 08:00｜事項2（其餘2筆與 water tag、其他使用者不受影響）
刪除提醒 99 → 找不到編號 99 的提醒，請先輸入「提醒清單」確認編號。（筆數不變、不當機）
刪除提醒 abc → 請輸入「刪除提醒 編號」，例如「刪除提醒 2」。先輸入「提醒清單」可看編號。（筆數不變、不當機）
刪除提醒（裸字）→ 🗑 已清除你所有的提醒。（＝clear()，逐字與「清除提醒」「提醒清除」相同，不回歸）

handler.handleText() 全鏈路（真實路由，非直呼 service）：
「提醒清單」→ 2筆；「刪除提醒 1」→ 🗑 已刪除提醒：...｜H事項1；
「刪除提醒 99」/「刪除提醒 abc」→ 錯誤提示不當機；「刪除提醒」→ 全清空。
```

### AC4 once/daily 逐字不回歸（節錄，old=HEAD版／new=工作區版）
```
add() once : old="✅ 好的，01-01 09:30 我會提醒你：「回診」" new="✅ 好的，01-01 09:30 我會提醒你：「回診」"
add() daily: old="✅ 好的，每天 08:00 我會提醒你：「吃藥」" new="✅ 好的，每天 08:00 我會提醒你：「吃藥」"
list() once+daily 混合、含 water tag、空清單、clear()、addParsed() once/daily/失敗案例、
addDailyPreset()（喝水）存檔結構、handler「開啟/關閉喝水提醒」回覆、
tools.run set_reminder once/daily 回給模型文字 → 全部逐字相同（9 組比對皆 PASS）。
```

### AC5 tick() 併發不回歸
```
[PASS] AC5-reentrancy 同步呼叫兩次 tick，第二次遇防重入旗標略過，只推播一次  :: concPushCount=1
[PASS] AC5-insert-kept 收尾後檔案含「併發期間插入的新提醒」  :: ["conc1","insertedMidTick"]
[PASS] AC5-lastFired-kept 收尾後原weekly筆已標記lastFired=當日(reload-before-save，未被覆蓋)
```
驗證方式：`push` stub 第一次被呼叫時，在推播進行中直接對 `reminders.json` 插入一筆新提醒（模擬 webhook 併發新增），
`tick()` 收尾後的存檔同時保留了「新插入筆」與「已標記 `lastFired` 的原筆」，證明 reload-before-save／依 id 套用機制未被破壞。

### AC6 AI 工具 weekly/monthly happy path
```
set_reminder weekly → "Reminder saved (every Wednesday 19:00): 倒垃圾"
set_reminder monthly（未給 time）→ "Reminder saved (every month on day 5, 09:00): 繳房租"（驗證未指定時刻預設09:00）
```

### AC7 parse() weekly/monthly（stub askJSON）
```
「提醒我 每週三晚上7點 倒垃圾」→ ✅ 好的，每週三 19:00 我會提醒你：「倒垃圾」（weekday=3, time='19:00'）
「提醒 每月5號 繳房租」（askJSON 回傳未含 time）→ ✅ 好的，每月5號 09:00 我會提醒你：「繳房租」（dayOfMonth=5, time缺漏→'09:00'）
```
說明：「週三/星期三/禮拜三→wednesday」屬 AI prompt 層級的自然語言翻譯，本輪未實際呼叫 Groq 驗證（依指示避免消耗額度），
改以靜態核實 `parse()` system prompt 確實明講此規則、且 `toWeekdayNum()` 對輸出的英文字串正確轉換（结构驗證）。

### AC8 時區正確性
```
獨立驗算：2026 % 4 = 2 → 非閏年 → 2月應為28天
公式交叉驗證：Date.UTC(2026,2,0).getUTCDate()=28；Date.UTC(2026,4,0).getUTCDate()=30；Date.UTC(2026,7,0).getUTCDate()=31
原始碼靜態檢查：weekday 用固定 `T12:00:00+08:00` + `getUTCDay()`；daysInMonth 用 `Date.UTC(...).getUTCDate()`，
均非伺服器本地時區建構 → 確認符合「Asia/Taipei 固定 +08:00」規則。
```

### AC9 提醒清單四型別
```
⏰ 你的提醒：
1. 2026/7/25 下午3:00:00｜回診
2. 每天 08:00｜吃藥
3. 每週三 19:00｜倒垃圾
4. 每月5號 09:00｜繳房租
```

## 3. 一項文件用字備註（非回歸、非阻塞）

PRD F6 範例文字寫「既有 once 顯示風格為『MM-DD HH:mm』」，但實測 `list()`／`describeWhen()` 的 once 分支
（新舊版皆同，逐字比對於 AC4 通過）實際輸出是 `new Date(r.fireAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})`
產生的完整日期時間字串（例如 `2026/7/25 下午3:00:00`），並非 `MM-DD HH:mm`。這是**既有、未受本輪修改影響**的行為
（AC4 逐字比對已確認新舊版完全相同），只是 PRD 描述用例與實際實作字面不同，不影響 AC9「四型別彼此可分辨、
風格與既有 once/daily 一致」的實質要求（確實一致，因為就是同一段未改動的程式碼）。不算本輪缺陷，僅供文件校對參考。

## 4. 測試方法鐵律遵守情形（驗收 11）

- 未 `require index.js`；只 require `src/line.js`／`src/ai.js`／`src/store.js`／`src/services/reminder.js`／
  `src/tools.js`／`src/handler.js`（皆非 index.js，且 `handler.js` 只定義函式、未觸發任何 `.start()`）。
- 未呼叫任何服務的 `.start()`（`reminder.start()` 全程未呼叫，只用測試注入縫 `tick(now, nowMs)`）。
- `client.pushMessage`、`client.getProfile`、`client.getRichMenuList`、`client.linkRichMenuIdToUser`、
  `client.unlinkRichMenuIdFromUser` 全部 stub（後三者是因為 `handler.handleText()` 內部會 fire-and-forget
  觸發 rich menu／語言解析流程，為避免任何真實 LINE API 呼叫一併 stub，非僅最低要求的 `pushMessage`）。
- `ai.askJSON` 全程 stub，未消耗任何 Groq 額度。
- `data/reminders.json`：測試前確認**原本不存在**（`ls data/` 核實），故各測試階段皆直接寫入／清空，
  測試結束於 `finally` 區塊還原（因原本不存在 → 刪除新建檔），並於腳本輸出印出
  `data/reminders.json 已還原（existedBefore=false）`；`git status --short` 於測後核實 `data/` 目錄無殘留。
- 逐字比對（AC4）使用 `git show HEAD:src/services/reminder.js` 取得修改前版本，寫入系統暫存目錄
  （非 repo 內）並將其 `require('../ai')` 等相對路徑改寫成絕對路徑後載入，與工作區新版共用同一個
  `store`/`line`/`ai` 單例，確保兩者操作同一份可控資料。
- 測試腳本本體與所有暫存檔（含轉寫後的舊版 `reminder.js`）皆存於系統暫存目錄
  （`C:\Users\...\Temp\claude\F--Linebot\...\scratchpad\`），未留在 repo；`git status --short` 核實
  repo 內僅原本三個已修改檔（`src/handler.js`、`src/services/reminder.js`、`src/tools.js`）與
  新增的 `docs/loop/recurring-reminder/`，無其他測試殘留檔案。

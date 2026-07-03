# TEST — 家庭群組翻譯橋（vi ↔ zh）

RD#4（測試）驗證報告。分支 `feat/group-translate`。全部離線測試，未呼叫真實 LINE / Groq API。

## 最終 VERDICT: **PASS**（第 2 輪；第 1 輪 FAIL 的「例外冒進群組」已修）

第 1 輪 tester 抓到：`translateFor()` 沒包 try/catch，若 `ai.ask` 丟例外會一路冒到
`index.js`，把通用錯誤訊息**實際送進群組**（PRD 明文禁止的洗版）。
**修法（雙層保險）**：
1. `groupTranslate.translateFor()` 包 try/catch，任何失敗回 `''`（呼叫端自然靜默）。
2. `handler.replyForEvent` 群組分支加 `.catch(() => null)` 兜底——群組處理無論發生什麼錯一律靜默。
**複測 5/5 全綠**：ai.ask 丟例外 → null（原 FAIL 案例）；回空 → null；正常翻譯照常；
AI 壞掉時「翻譯關／翻譯開」開關仍可用；`node --check` 過。

以下為第 1 輪原始紀錄（含 11 組邊界案例，除上述缺口外全數 PASS，保留供追溯）。

---

## 做法

1. `node --check` 對 3 個變更檔（`src/services/groupTranslate.js`、`src/handler.js`、`src/lang.js`）— 皆通過。
2. 寫一支暫時的 Node 測試腳本（`tests/group-translate.test.js`，跑完已刪除），透過 `require.cache` 攔截 stub 掉
   `src/ai.js`（`ask`/`transcribe`/`chat`/`vision`）、`src/line.js`（`getContentBuffer`/`client.pushMessage`）、
   `src/services/richMenu.js`（`ensureFor`），並 monkeypatch `conversation.append`、`lang.noteText` 當呼叫次數計數器，
   再直接呼叫 `handler.replyForEvent` / `handler.handleText` 用假造 LINE event 驗證。
3. `gasStation.findNearest` 用 stub 取代（避免打中油開放資料 API）；`fuelPrice.lookup()`／氣象署天氣查詢維持原樣呼叫真實免金鑰公開端點（非付費、非額度限制服務，僅驗證不 crash 且不誤入 ai.chat 路徑）。
4. 測試資料：`data/groupTranslate.json`（測試建立，跑完已刪除）；`data/lang.json`（測前備份、測後以 `finally` 完整還原原內容，共 13 筆既有測試殘留資料，還原後比對筆數一致）。

## PRD 驗收條件對照表（1–7）

| # | 驗收條件 | 結果 | 證據 |
|---|---|---|---|
| 1a | vi 群組訊息「Con đã ăn cơm chưa?」→ 含 🌐 + stub 中文譯文；ai.ask 收到 prompt 指明翻成繁中、只輸出譯文 | PASS | `reply="🌐 中文譯文:Con đã ăn cơm chưa?"`；`aiCalls.ask[0].sys` 含「繁體中文」與「只輸出譯文」 |
| 1b | zh 群組訊息「吃飯了嗎？」→ 含 🌐 + stub 越南語譯文 | PASS | `reply="🌐 ban dich tieng viet"`；prompt 含 `Vietnamese` |
| 1c | en「hello」／emoji「😂」／單字「好」→ null | PASS | 三案例皆回 `null`，`ai.ask` 皆 0 次呼叫 |
| 2a | 「翻譯關」→ 中越雙語確認；之後 vi 訊息 → null | PASS | 確認字串含「翻譯開」與「bật dịch」；關閉後翻譯回 `null`，`ai.ask` 0 次 |
| 2b | 「bật dịch」→ 恢復翻譯 | PASS | 恢復後 vi 訊息重新回 `🌐 ...` |
| 2c | 狀態寫入 `data/groupTranslate.json`，測後清理 | PASS | 檔案內容為 `{groupId:{enabled:boolean}}` 物件（非陣列）；測後已刪除 |
| 3 | join 事件 → 中越雙語簡介，含「翻譯關」與「tắt dịch」字樣 | PASS | 兩字樣皆存在於回覆字串 |
| 4a | 群組語音（stub transcribe 回 vi 文字）→ `🎙「原文」`＋`🌐 譯文` | PASS | `reply` 含 `🎙「Con đã ăn cơm chưa?」` 與 `🌐 你吃飯了嗎？`；`getContentBuffer` 收到正確 messageId |
| 4b | transcribe 回空 → null | PASS | `reply === null` |
| 5a | 一對一「天氣 台北市」關鍵字路由不變、不進 ai.chat | PASS | 回傳非空字串/物件，`aiCalls.chat.length === 0` |
| 5b | 一對一「trợ giúp」→ vi 選單 | PASS | 回覆含 `Xin chào` |
| 5c | 一對一一般聊天走 AI（ai.chat） | PASS | `ai.chat` 被呼叫 1 次，回傳值即 stub 值 |
| 5d | 群組訊息不進 conversation 記憶（`conversation.get` 為空） | PASS | 傳一則 vi 翻譯 + 一則「翻譯關」後 `conversation.get('u-noconv')` 仍為 `[]`；`conversation.append` 呼叫 0 次；`lang.noteText` 呼叫 0 次（群組零副作用） |
| 6a | ai.ask 回空字串 → 群組回 null 不洗版 | PASS | `reply === null` |
| 6b | ai.ask **丟例外** → 群組回 null、不 crash | **FAIL** | 見下方「發現的問題」 |
| 7 | `node --check` 全變更檔 | PASS | 3 檔皆 `node --check` 通過（無輸出即成功） |

## 發現的問題（AC6-ai-throw 為何 FAIL）

**驗收條件 6 原文**：「ai.ask 失敗（stub 丟例外/回空）→ 群組回 null 不洗版、不 crash。」

`回空` 的情境（AC6-ai-empty）通過。但 `丟例外` 的情境實測結果如下：

- `src/services/groupTranslate.js` 的 `translateFor()` 直接 `return await ai.ask(sys, text);`，**沒有 try/catch**。
- 若 `ai.ask` 拋出例外（stub 模擬；理論上真實 `ai.js` 內部已有 try/catch 幾乎不會發生，但這是防禦性設計的缺口，且測試腳本要求必須驗證此路徑），例外會沿著
  `translateFor` → `handleGroupText` → `handler.replyForEvent` 一路往外冒，`handleGroupText` **沒有把它接住**。
- 追蹤到 `src/index.js` 的 `handleEvent()`：外層確實有 `try { await handler.replyForEvent(event) } catch (err) { ... }`，
  所以 process 不會真的 crash（符合「不 crash」半句）。
- **但**該 `catch` 區塊會呼叫 `lang.genericError(...)` 並用 `lineClient.replyMessage` **把錯誤訊息實際送進該群組**
  （例如「抱歉，發生了一點問題，請稍後再試 🙏」），這正是 PRD §F2／驗收條件 6 明文禁止的「絕不在群組裡吐錯誤訊息洗版」。

**實測輸出**（測試腳本內直接呼叫 `handler.replyForEvent`，模擬 ai.ask 丟例外）：
```
threw = true   // Promise rejection 從 handleGroupText 一路冒出到呼叫端
```
若接上真正的 `index.js handleEvent`（未在本次測試重跑，因為那條路徑會呼叫真實 `lineClient.replyMessage`，
基於「不呼叫真實 LINE API」原則未執行，但程式碼路徑追蹤如上，邏輯上可 100% 確定會送出通用錯誤訊息到群組）。

**建議修法**（給工程師參考，不代替修）：在 `groupTranslate.js` 的 `translateFor()` 內包一層 try/catch，
失敗一律 `return ''`（沿用函式既有的「失敗回空字串」約定），讓 `handleGroupText`/`handleGroupAudio` 既有的
`translated && translated.trim() ? ... : null` 判斷自然吃下這個情況，維持群組零錯誤訊息的承諾。

## 額外邊界案例（獨立探索，非 PRD 逐條列出但屬合理延伸）

| # | 案例 | 結果 | 備註 |
|---|---|---|---|
| EDGE1 | `room` 型別來源（`{type:'room', roomId:'r1', userId:'u'}`）文字「Con chào mẹ」→ 翻譯；toggle 用 `roomId` 當 state key | PASS | 翻譯正常回 `🌐 ...`；`data/groupTranslate.json` 內確實以 `r1` 為 key |
| EDGE2 | State isolation：`g1-iso` 關閉翻譯，`g2-iso` 仍正常翻譯 | PASS | per-group 狀態正確隔離，非全域開關 |
| EDGE3 | Toggle echo 安全性：「我覺得翻譯關掉比較好」內含「翻譯關」但非精確匹配 | PASS | 未誤觸發關閉，`ai.ask` 被呼叫 1 次，正常走 zh→vi 翻譯（anchored regex `^翻譯關$` 生效） |
| EDGE4 | 混寫「媽媽 ơi con nhớ mẹ」（CJK＋越南語） | PASS | 不為 null、不 crash；實測方向判定為 **vi→zh**（`lang.detect` 先比對越南語特徵字元，命中即回 `vi`，符合 DESIGN 註記的「vi-priority」預期） |
| EDGE5 | 1500+ 字中文長訊息 | PASS | 完整原文（未截斷）傳給 `ai.ask`，回覆正常帶 🌐，無 crash |
| EDGE6 | URL-only「https://example.com/abc」→ null；URL+短字「https://x.com 好」→ null | PASS | `isSubstantial` 正確濾掉 URL 後剩餘字元數 |
| EDGE7 | `text=''` 或 `'   '` → null 不 throw | PASS | 皆正常回 null |
| EDGE8 | join 事件 source type 為 `room` | PASS | 仍回中越雙語簡介 |
| EDGE9a | 一對一「油價」→ `⛽` 開頭字串，不進 ai.chat | PASS | 走 `fuelPrice.lookup()`（真實免金鑰公開端點），未 crash |
| EDGE9b | 一對一「翻譯 越南語 你好」→ 走 1-1 `translate()`（`ai.ask`），非群組橋 | PASS | `ai.ask` 呼叫 1 次，`ai.chat` 0 次 |
| EDGE9c | 一對一位置訊息 → 走 `gasStation` handler（stub `findNearest`） | PASS | `findNearest` 被呼叫 1 次，回覆含 stub 站名 |
| EDGE9d | `handleText('你好')` 精確呼叫 stub `ai.chat` 恰 1 次 | PASS | 確認呼叫次數 |
| EDGE10 | `data/groupTranslate.json` 不存在時 `isEnabled('never-seen')` | PASS | 回傳 `true`（`store.load` 對不存在檔案回 `[]`，`groupTranslate.js` 的 `loadState()` 正確把非物件/陣列 coerce 成 `{}`，`isEnabled` 預設開） |
| EDGE11 | `node --check` 三檔 + `require handler` standalone | PASS | 全部順利載入、無語法/載入期錯誤 |

## VERDICT 依據

7 條 PRD 驗收條件中，6 條完全通過；**驗收條件 6 的「ai.ask 丟例外」子案例 FAIL**（群組會收到通用錯誤訊息，違反
「絕不在群組裡吐錯誤訊息洗版」的明文要求）。額外 11 組邊界案例全數 PASS，未發現其他缺陷。

## 清理確認

- `data/groupTranslate.json`：測試過程建立，`finally` 區塊已刪除（測後 `ls` 確認不存在）。
- `data/lang.json`：測前備份原內容（13 筆既有測試殘留紀錄），測後以 `finally` 完整寫回，內容筆數與寫回後一致。
- `tests/group-translate.test.js`：測試腳本已刪除；`tests/` 目錄因跑完後已空，一併移除。
- `git status --short` 測後僅剩預期變更：`src/handler.js`、`src/lang.js`（modified）、
  `src/services/groupTranslate.js`（新檔，untracked）、`docs/loop/group-translate/`（本輪文件），
  無殘留測試檔或測試資料。

# TEST — 越南語無障礙第 1 輪（vi-friction）

## 最終 VERDICT: **PASS**（第 2 輪；第 1 輪 FAIL 的 ai.chat fallback 已修）

第 1 輪 tester 發現：`ai.chat()` 只在「回應成功但內容為空」時才會用到 `fallbackText`；
Groq 真正掛掉（401/429/5xx/逾時）時例外直接往外拋，設計的 fallback 機制是死碼。
**修法**（`src/ai.js`）：把 `chat()` 主體（complete + 工具迴圈 + return）整段包進 try/catch，
任何失敗回 `fallbackText || 原中文句`，與 ask/askJSON/transcribe/vision 的既有容錯模式一致。
**複測**（壞 API Key 模擬全掛）：
- `chat(..., {fallbackText:'VI_FALLBACK_SENTENCE'})` → 回該句、不拋例外 ✅
- `chat(...)`（不傳參數）→ 回原中文句（相容性）✅
- `node --check src/ai.js` ✅

以下為第 1 輪原始紀錄（保留供追溯）。

---

- 分支：`feat/vi-friction-fix`（未 commit，工作目錄 diff）
- 測試方式：`node --check` 全變更檔 + 一支臨時 Node 腳本（`tests/test-vi-friction.js`，測完已刪除）直接呼叫真實模組（`lang.js`／`ai.js`／`handler.js`／`traTrain.js`／`gasStation.js`）。無正式測試框架。
- 假資料：`data/lang.json` 暫時新增 `test-vf-1`（vi）／`test-vf-2`（zh-TW）／`test-vf-3`（vi，臨時單元測試），測後已清除並以 diff 確認與測前內容完全相同。
- 網路：traTrain（PTX，新竹↔中壢即時查詢）與 ai.chat（Groq，1 次刻意打錯 API Key 驗證失敗路徑）皆有連線，用量極小。

## 0. `node --check` 全變更檔（驗收條件 8）

```
node --check src/lang.js
node --check src/ai.js
node --check src/index.js
node --check src/handler.js
node --check src/services/traTrain.js
node --check src/services/gasStation.js
```
結果：**全部通過，無語法錯誤**。另外 `require('src/handler.js')` standalone 不 crash（驗證所有 require 鏈完整）。

## 逐案結果

| # | 驗收條件 | 結果 | 證據 |
|---|---|---|---|
| 1 | 六語表完整（7 個 getter × 6 語言非空；vi 含越南語字元；未知碼 'xx' 回落） | **PASS** | `genericError/chatFallback/audioFetchFail/audioUnclear/imageFetchFail/imageUnclear/helpMenu` 對 zh-TW/vi/en/ja/th/id 皆非空字串；vi 版皆含越南語聲調字元；`code='xx'` 皆回落非空（helpMenu 回落 zh-TW，其餘同）。 |
| 2a | zh-TW helpText() 舊版 vs `lang.helpMenu('zh-TW')` 逐字相同 | **PASS** | 從 `git show HEAD:src/handler.js` 取出舊 `helpText()` 全文，與新 `lang.helpMenu('zh-TW')` 字串比對，完全相等。 |
| 2b | 6 句寫死中文（語音/圖片抓取失敗、聽不清/看不懂、總 catch、chat fallback）vs 新 lang zh-TW getter 逐字相同 | **PASS** | 6 句全部逐字相同，含 emoji。 |
| 2c | `getTraTrainByIds` 不傳 code（新竹→中壢，today）與現況格式一致 | **PASS** | 起首 `🚆`、含「小時」單位、標題格式 `🚆 台鐵 X → Y（MM/DD）` 與舊版逐字相同結構（`lookup()` 同款輸出）。實際輸出：`🚆 台鐵 新竹 → 中壢（07/02）\n今天 21:39 之後的班次：\n\n・2046次 區間快　21:52→22:28（0小時36分）...` |
| 3a | ai.js `chat()` 回傳運算式含 `fallbackText \|\|` 於中文字面值之前 | **PASS**（原始碼比對） | `src/ai.js:114`：`return msg?.content?.trim() \|\| fallbackText \|\| '抱歉，我現在無法回覆，請稍後再試。';` |
| 3b | 模擬 Groq 全掛 → `ai.chat({fallbackText})` 回自訂 fallback | **FAIL（功能性）** | 見下方「發現的問題」。 |
| 3c | 無 fallbackText 呼叫 `ai.chat()`，Groq 失敗時回舊中文句（相容性） | **FAIL（功能性，與 3b 同根因）** | 見下方。 |
| 4a | `getTraTrainByIds({code:'vi'})` 含 `giờ`/`phút` 或無班次句 | **PASS** | `🚆 台鐵 新竹 → 中壢（07/02）\nhôm nay 21:39 之後的班次：\n\n・2046次 區間快　21:52→22:28（0 giờ 36 phút）...` |
| 4b | `code:'en'` 含 `/\dh\d+m/` 或 `No more trains` | **PASS** | `...21:52→22:28（0h36m）...` |
| 4c | `code:'ja'`（回落 en 風格）同上 | **PASS** | 輸出與 en 相同風格（`0h36m` 等），標題 `today` 標籤（ja 落 en） |
| 5a | vi 使用者 `handleText('trợ giúp')` → 越南語選單 | **PASS** | 首行 `👋 Xin chào! Mình có thể giúp bạn:`，內含 `💡 Bạn có thể nói chuyện...`（後續行含「Trạm xăng gần nhất」等關鍵字，符合 DESIGN vi 選單全文） |
| 5b | vi 使用者 `handleText('giá xăng')` → 中油油價字串（非 AI 路徑） | **PASS** | 108ms 內回覆（確定性路由，非 AI）：`⛽ 台灣中油本週油價\n生效日：2026-06-29（週一）\n\n・92 無鉛汽油　30.4 元/公升...` |
| 5c | vi 使用者 `handleText('tỷ giá')` → 含 TWD/VND | **PASS** | `💱 匯率查詢\nTWD → VND\n1 TWD = 822.1 VND...` |
| 5d | vi 使用者 `handleText('tỷ giá USD TWD')` 參數透傳 | **PASS** | `💱 匯率查詢\nUSD → TWD\n1 USD = 31.9157 TWD...` |
| 5e | zh 使用者 `handleText('選單')` byte-equal `lang.helpMenu('zh-TW')` | **PASS** | 完全相等 |
| 5f | zh 使用者 `handleText('menu')` → 該使用者語言選單（zh） | **PASS** | 回傳內容 === `lang.helpMenu('zh-TW')`，非空 |
| 5g | 回歸：`'油價'` 仍走油價路由 | **PASS** | 正常回中油油價字串 |
| 5h | 回歸：`'對獎 12345678'` 仍走發票對獎路由 | **PASS** | `🧾 115年 03~04月 對獎\n你的號碼：12345678...` |
| 5i | 回歸：`'台鐵 台北 台中'` 仍走台鐵路由 | **PASS** | `🚆 台鐵 台北 → 台中（07/02）\n今日已無班次`（當下無班次，格式與現況相同） |
| 6 | `formatList` 距離單位不含「公尺/公里」 | **PASS** | `km:0.728` → `728 m`；`km:1.4` → `1.4 km`（規則：`<1km` 四捨五入成 m，否則 `X.Y km`），輸出不含「公尺」「公里」 |
| 7 | index.js catch 本地化（原始碼檢視） | **PASS** | `require('./lang')` 存在；catch 區塊呼叫 `lang.genericError(...)`，且外層包 `try { ... } catch {}`，預設值為原中文句 `'抱歉，發生了一點問題，請稍後再試 🙏'`（未解析出語言或 resolve 失敗時的保底）。 |
| 8 | `node --check` × 6 檔 | **PASS** | 見上方「0.」 |

## 發現的問題（3b／3c FAIL 根因，建議修正）

**現象**：刻意把 `GROQ_API_KEY` 設成無效值，讓 Groq API 呼叫失敗（HTTP 401 `invalid_api_key`），
分別測試：
1. `ai.chat(history, { fallbackText: 'VI_FALLBACK_TEST_XYZ' })` → **直接 reject**（丟出 `401 {"error":{"message":"Invalid API Key",...}}`），並未回傳 `'VI_FALLBACK_TEST_XYZ'`。
2. 同樣情境但不傳 `fallbackText` → 也是直接 **reject**，並未回傳舊中文句 `'抱歉，我現在無法回覆，請稍後再試。'`。
3. 進一步端到端驗證 `handler.handleText('test-vf-3', '越南語句子')`（vi 使用者，同樣壞 API Key）→ **同樣 THROW**，訊息一路丟到呼叫端未被 `handler.js` 接住。

**根因**（`src/ai.js:83-96` `complete()` 內部）：
```js
async function complete() {
  try {
    return await groq.chat.completions.create({ ...base, messages, ...withTools });
  } catch (e) {
    if (!(withTools.tools && toolUseFailed(e))) throw e;   // ← 非 tool_use_failed 一律 rethrow
    ...
  }
}
```
`complete()` 只在錯誤是「帶工具且為 `tool_use_failed`（400）」時才內部處理／重試；**其餘所有錯誤**
（例如本測試的 401 invalid key、真實的網路逾時、429 rate limit、5xx 等 Groq 全掛情境）**都會直接
`throw`，沒有被 `chat()` 函式的任何 `try/catch` 包住**。因此 `src/ai.js:114` 那行
`return msg?.content?.trim() || fallbackText || '...'` 的 fallback 邏輯**只有在 Groq 回 HTTP 200 但
`message.content` 為空字串時才會被執行到**，並不會在「Groq 全掛」（連線失敗/驗證失敗/逾時）時觸發——
這正是 PRD 驗收條件 3 明確要驗的情境（"模擬 Groq 全掛...handler 對 lang=vi 的使用者回越南語 fallback"）。

**影響範圍與嚴重度**：
- `handler.js` 呼叫 `ai.chat(...)`（`src/handler.js:304`）外層也沒有 `try/catch`，所以例外會一路往上
  丟到 `index.js` 的 `handleEvent` 總 catch，最終由 `lang.genericError(code)` 回覆（不是設計文件描述的
  `lang.chatFallback(code)`）。**站在「使用者仍然收到看得懂的越南語訊息」這個 PRD 最上層目標
  （F1 #1「她再也不會收到看不懂的訊息」）來說，結果依然達成**（實測 `lang.genericError('vi')` =
  `Xin lỗi, đã xảy ra lỗi. Vui lòng thử lại sau 🙏`），所以**不是使用者可見的回歸/破功**。
- 但這代表 **PRD §F1 表格 #1（`ai.js:114` 的 fallback）與 §驗收條件 3 所描述的機制實際上是死碼路徑**：
  只有在極罕見的「Groq 回 200 但內容空字串」時才會生效，一般認知中的「Groq 全掛」（超時、429、5xx、
  金鑰失效等）完全繞過它，改用完全不同的 `genericError` 文案與路徑。這與 DESIGN.md §2、§測試策略 3
  的設計意圖不符，屬於**功能性缺陷（隱藏的 dead code + 文件與實作不一致）**，建議修正方向：
  在 `handler.js` 呼叫 `ai.chat(...)` 處加 `try/catch`，`catch` 時回傳 `lang.chatFallback(fallbackCode)`
  （或在 `ai.js` 的 `chat()` 內把 `complete()` 的呼叫也包進最外層 try/catch，失敗時回傳
  `fallbackText || 中文預設句`），讓 §F1 表格 #1 與 §驗收條件 3 真正對得上。

## 清理確認
- `data/lang.json`：已移除所有 `test-vf-*` 項目，與測試前備份（`diff`）逐位元組相同。
- `F:\Linebot\tests\test-vi-friction.js`：測試完成後已刪除，`tests/` 目錄已移除（原本不存在）。
- 未修改任何 `src/**` 原始碼（僅讀取）。

## VERDICT

**FAIL** — 驗收條件 1、2、4、5、6、7、8 全數通過；驗收條件 **3（ai.chat fallback）功能性未達成**：
`ai.chat()` 在 Groq 呼叫本身失敗（非 `tool_use_failed` 的例外，如逾時/429/5xx/金鑰失效等「全掛」情境）
時會直接向外拋出例外，`fallbackText`／預設中文句都不會被使用；`handler.js` 也未在呼叫處攔截，例外會
一路傳到 `index.js` 總 catch，改用 `lang.genericError` 而非設計描述的 `lang.chatFallback`。使用者最終
仍會收到越南語訊息（因為 `genericError` 也已本地化），但 §F1 #1／§驗收條件 3 所指定的機制本身未生效，
需要工程師修正（建議：`handler.js` 呼叫 `ai.chat` 處加 try/catch 回退 `lang.chatFallback`，或
`ai.js` 的 `chat()` 把整體呼叫包進 try/catch 回傳 `fallbackText`）。

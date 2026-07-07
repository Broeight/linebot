# TEST — 🌀 防災警報推播（RD#4 獨立驗證）

## 最終 VERDICT: **PASS**（第 2 輪；第 1 輪抓到的翻譯空白外漏已修）
第 1 輪 RD#4（46 案 45 過）抓到一個**安全關鍵** bug：`translatedBody()` 用 `translated ? …` 判斷，
`ai.ask` 回傳純空白（如 `'   '`）時 truthy 通過，會把空白當警報內容推出去——違反 PRD §驗收4
「翻譯失敗仍須推原文、絕不漏發」。**修法**：改為 `translated && translated.trim() ? … : 中文＋失敗提示`。
**端到端複測全綠**：空白／空／throw 三種失敗都推「原始中文＋越南語失敗提示」（非空白）、
正常翻譯照走、首輪不回補、恰一次推播。

以下為第 1 輪原始紀錄（除該案外 45 案全 PASS，保留供追溯）。

---

對應 `PRD.md` §驗收 1–7、`DESIGN.md` §6 測試策略。全程離線：自建 mock NCDR HTTP server
（`node http`，200/500 兩種模式）+ 對 `store.load/save`、`client.pushMessage`、`ai.ask`、
`lang.resolve` 做 module-object stub（比照 `rateAlert.js` 手法，不解構、直接替換 module 屬性）。
**未呼叫任何真實 LINE push API / 真實 NCDR feed。** 測試腳本、mock server 皆放在 scratchpad，
測完已刪除；未在 repo 留下任何檔案；未 `require index.js`、未呼叫任何 `.start()`；
每支腳本結尾 `process.exit(0)`（有失敗案例時為非 0，供 CI 判斷）。

## 前置檢查

- `node --check` 對 6 個變更檔全過：`src/services/disasterAlert.js`、`src/handler.js`、
  `src/lang.js`、`src/config.js`、`src/index.js`、`src/store.js` — **PASS**。
- `data/` 測前備份到 scratchpad、測後 `diff -r` 驗證 byte-identical — **PASS**（測試全程用
  `store.load/save` 的記憶體 sandbox，從未寫入真實 `data/`；`alertSub.json`／`alert-state.json`
  從未出現在真實 `data/` 目錄）。
- `require('./src/handler.js')`、`require('./src/services/disasterAlert.js')` 單獨 require 皆不
  crash、不觸發任何排程 — **PASS**。

## 結果總表（46 案例）

**45 PASS / 1 FAIL**

| # | 對應驗收 | 案例 | 結果 |
|---|---|---|---|
| T1a–T1l | 1 | `parseAlerts` 純函式：混合樣本過濾、壞輸入防禦（壞JSON/null/undefined/非陣列/entry非陣列/entry=null/字串raw/單一物件entry） | PASS（12/12）|
| T2 | 3 | 首次啟用不回補：state 空 + 3 筆候選 → 推播 0 次、`seenIds` 記 3 筆、`bootstrapped=true` | PASS |
| T3 | 2 | 去重：同批 feed 第二輪 → 0 新警報、推播 0 次、state 不變 | PASS |
| T4 | 2/3 | 新 id 出現才推：加入第 4 筆 → 只推 1 筆，`seenIds` 變 4 筆 | PASS |
| T-newer | 2/3（探索） | a1 重新出現但 `updated` 更新 → 依 DESIGN §3「id 存在即已見」語意，**不**重推 | PASS（行為符合 DESIGN 書面定義，見下方「發現與備註」）|
| T5 | 4 | 推播＋翻譯：vi 訂閱者收到越南語譯文，`alertPush` 格式正確 | PASS |
| T6a | 4 | 翻譯失敗（`ai.ask` 回 `''`）不漏發：中文原文＋失敗提示 | PASS |
| **T6b** | 4（安全關鍵） | **`ai.ask` 直接 THROW**（非依合約回空字串）→ 警報仍推播、不 crash | **PASS** |
| **T6c** | 4（安全關鍵） | **`ai.ask` 回傳純空白字串 `'   '`** → 應視為翻譯失敗走中文 fallback | **FAIL（見下）** |
| T7 | 4 | 未訂閱者不收：0 訂閱者 → 推播 0 次、不呼叫 `ai.ask` | PASS |
| M6 | 4（安全關鍵） | 多訂閱者隔離：vi/zh/en/一位 `lang.resolve` throw → 其餘 3 位皆收到（throw 者 fallback 中文），zh-TW 不浪費 `ai.ask` | PASS |
| M6b | 4（配額） | 同語言快取：2 位 vi 訂閱者只呼叫 1 次 `ai.ask` | PASS |
| D1 | 2（去重） | `parseAlerts` 對非全域唯一 id（同 id 不同 updated）兩筆都保留在候選陣列 | PASS |
| D2 | 2（去重） | `tick` 對重複 id feed：`seenIds` 為 id→updated map，不 crash | PASS |
| T9a | 6 | 輪詢失敗（`fetchAlerts`→null）→ 不推播、不寫 state、不 crash | PASS |
| T9b | 3/6（交叉） | 首輪失敗後、下一輪成功 → first-enable-no-backfill 仍適用（不因先失敗一次而誤判） | PASS |
| T9c | 6 | 已 bootstrapped 後某輪失敗 → state 不被污染，下一輪恢復正常判斷 | PASS |
| T10 | 6 | tick 防重入：同步呼叫兩次 → 第二次不重複 fetch/push | PASS |
| T8a–T8d | 5 | subscribe 冪等、unsubscribe 移除、未訂閱者 unsubscribe → OffNone | PASS（4/4）|
| T12a–T12c | 5 | handler 路由：中文「開啟警報」／越南語 ascii `bat canh bao`／`tat canh bao` | PASS（3/3）|
| T12d | 5（探索） | 非錨定 `bật cảnh báo giúp tôi`（前後夾字）不誤觸 | PASS |
| T12e | 5 | 中文「警報」單獨兩字不誤觸（原始碼為全字 `===` 比對，靜態確認） | PASS |
| R1/R2 | 7（回歸） | 「開啟學中文」／「開啟早安」指令不受影響 | PASS（2/2）|
| T13 | 7 | `store._internal.KNOWN_KEYS` 含 `alertSub.json`、`alert-state.json` | PASS |
| P1–P3 | 6（state 成長） | `pruneState`：過期砍除／硬上限 3000 依 updated 保留最新／不誤刪仍有效 id | PASS（3/3）|
| H1/H2 | 6（HTTP 層） | `fetchAlerts` 對自建 mock server：200 正確解析／500 回 `null` 不 throw | PASS（2/2）|

## FAIL 詳情（唯一失敗案例）

### T6c — `ai.ask` 回傳純空白字串 `'   '` 未被視為翻譯失敗

**驗收依據**：PRD 驗收 4「ai.ask 失敗 → 推原始中文＋失敗提示（不得漏發）」；DESIGN §4「若回空字串 →
推中文原文＋失敗前綴」。`ai.js` 的 `ask()` 合約是「失敗回 `''`」，但 `disasterAlert.js` 對
`ai.ask` 回傳值的判斷是：

```js
const body = translated
  ? translated
  : lang.alertTranslateFail(code) + '\n' + alert.summary;
```

`translated` 若是 `'   '`（純空白，非空字串）→ JS 的 `'   '` 是 truthy → 被當成「有效譯文」直接
推出去，**沒有 `.trim()` 判斷**。

**測試方式**：stub `ai.ask` 回傳 `'   '`（3 個空白字元），訂閱者語言設為 `vi`，觸發一則新警報。

**實際輸出**（真實走過 `tick()` → `pushAlert()` → `client.pushMessage` 攔截值）：
```
🌡 Nắng nóng
   
🕒 2026/7/7 下午 03:59:00 ~ 2026/7/7 下午 04:59:00
📢 中央氣象署
```
第二行（本應是警報內文）只有 3 個空白字元 — 使用者實質上收到一則「看不出內容」的警報推播，
未落回中文原文、也沒有失敗提示。

**為什麼算安全問題**：雖然 `ai.js` 目前的 `ask()` 實作內部有 `.trim()`（`completion.choices?.[0]?.
message?.content?.trim() || ''`），理論上正常情況不會產生純空白的「成功」回傳；但 Groq 回應內容
理論上可能是空白/换行構成的低品質輸出而未經該層 trim 攔下（例如模型只回傳空白或不可見字元、或
未來 `ask()` 實作變動），`disasterAlert.js` 這一層對「假性成功、實質空白」沒有防禦，會讓警報訊息
實質上等同漏發但系統邏輯上又不會走 T9 类失敗路徑重試——最危險的組合。

**建議修法**（供工程師參考，未動原始碼）：`translatedBody()` 判斷式改用
`translated && translated.trim() ? translated : (失敗 fallback)`，與 DESIGN §4「回空字串」的精神
一致地延伸到「回空白」。

## 探索性發現（非 FAIL，供記錄）

- **T-newer（同 id、`updated` 變新是否重推）**：DESIGN §3「新 vs 已見」判定明文為
  `state.seenIds[a.id]` **不存在** → 新；否則已見略過——沒有比較 `updated` 差異的邏輯。
  程式碼 `decideNew()` 完全照此實作（`!(a.id in seen)`）。測試證實：a1 以更新過的 `updated`
  重新出現時**不會**被重推。此為 DESIGN §7 風險表已明列的已知取捨（「首發即推、不推 Update
  升級版」），**行為與書面設計一致，非缺陷**，但值得在 PR 說明中再次確認架構師與工程師都認知此
  取捨（同 id 即使升級也不二次通知）。
- **M6（`lang.resolve` throw 時的 fallback）**：`pushAlert()` 對每位訂閱者的 `lang.resolve` 呼叫有
  各自 `try/catch`，失敗時 `code` 退回 `'zh-TW'`，該訂閱者仍會收到（中文原文）推播，不會被跳過。
  驗證：4 位訂閱者（vi/zh/en/一位 resolve throw）全數收到，`ai.ask` 恰呼叫 2 次（vi、en 各一次；
  zh-TW 與 fallback 至 zh-TW 者都不呼叫 AI）——符合 DESIGN §4「`code==='zh-TW'` 不呼叫 AI」與
  §4 配額註記的單輪快取設計。
- **H1/H2（mock HTTP 層）**：透過暫時覆寫 `global.fetch` 導向本機 mock server（因 `FEED_URL` 為
  `disasterAlert.js` 內部常數、無環境變數注入口），驗證 `fetchAlerts()` 對 200 能正確解析、對 500
  回 `null` 不 throw。未測 AbortController 8 秒逾時的即時性（mock `hang` 模式已備妥但為避免拖慢
  測試執行時間，本輪未觸發；`fetchAlerts` 的 `catch` 區塊本身涵蓋 abort 例外，邏輯上與 500 分支
  共用同一條「回 null」路徑，風險低）。

## 清理

- 測試腳本（`run.js`／`mockFeedServer.js`／`fixtures.js`）、mock server 全部建立於 scratchpad，
  執行完畢後已刪除，repo 內未留下任何測試檔案（`git status` 確認）。
- mock HTTP server 執行完畢後已 `close()`（含 `closeAllConnections()`），無殘留監聽埠。
- `data/` 測前備份、測後 `diff -r` 確認與備份 byte-identical（實際上測試從未寫入真實
  `data/`，`store.load/save` 全程被 stub 成記憶體 sandbox）。
- 未 `require index.js`、未呼叫任何 `.start()`、未呼叫真實 LINE push API、未連真實 NCDR feed。

## VERDICT

**VERDICT: FAIL**

45/46 案例通過；1 個安全關鍵案例（T6c）失敗——`ai.ask` 回傳純空白字串時，`disasterAlert.js` 的
`translatedBody()` 未做 `.trim()` 判斷，會把空白內容當成「翻譯成功」直接推播，導致使用者收到
一則沒有實質警報內容的訊息（違反 PRD「警報絕不因翻譯失敗而漏發」的精神——這是漏發的變種：
形式上發了，但內容是空的）。其餘 6 條驗收條件（含 F1 解析器、去重、首次啟用不回補、訂閱指令、
排程防重入/容錯、`store.js` KNOWN_KEYS、既有功能回歸）全部通過。建議工程師在 `translatedBody()`
補上 `translated && translated.trim()` 判斷後即可視為通過。

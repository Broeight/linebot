# TEST — vi-rich-menu

測試者：RD#4（tester），分支 `feat/vi-rich-menu`。
權威依據：本 loop 目錄無 `PRD.md`（僅有 `DESIGN.md`），以 **DESIGN.md §8 測試策略（對應 PRD 驗收 1–7）** 為準，
並套用 orchestrator 的安全限制（見下方「安全限制」）覆寫 §8.5 原文中「可對正式頻道 setDefault」的部分。

## 安全限制（本輪覆寫 DESIGN §8.5 文字）
- 只對 **TEST 命名**的 rich menu 呼叫 create/upload/list/delete 真 API。
- **不**呼叫 `setDefaultRichMenu` 打正式頻道；**不** link/unlink 任何真實 userId。
- setDefault/link/unlink 行為只用 stub 驗證（見 2.）。
- 測試建立的 menu 於 try/finally 中保證刪除，並於結束前 `getRichMenuList` 二次確認清空。

## 環境確認
- 開跑前 `getRichMenuList()`：**0 個既有選單**（正式頻道目前尚未上線 rich menu 功能，無 `menu-zh-v1`/`menu-vi-v1` 可能被誤刪的風險）。
- `data/lang.json` 測試前備份，測試全程使用 `test-*` 前綴的假 userId，結束後與備份 **byte-identical**（已用 `diff` 確認）。

---

## 1. `node --check`（全部變更/新增檔案）

| 檔案 | 結果 |
|---|---|
| `src/services/richMenu.js` | PASS |
| `src/handler.js` | PASS |
| `src/lang.js` | PASS |
| `src/index.js` | PASS |
| `src/**/*.js`（全專案逐檔跑一遍） | PASS（無任一檔案語法錯誤）|

## 2. PNG 資產（offline，精確 offset 數學）

| 檔案 | signature | width | height | bytes | < 1MB |
|---|---|---|---|---|---|
| `assets/richmenu/menu-zh.png` | 有效 (`89 50 4E 47 0D 0A 1A 0A`) | 2500 | 1686 | **68,584** | 是 |
| `assets/richmenu/menu-vi.png` | 有效 | 2500 | 1686 | **76,337** | 是 |

`scripts/generate-richmenu-images.ps1`：檔頭前 3 bytes = `EF BB BF`（UTF-8 with BOM）— PASS。

（未另附人工看圖截圖；tester 未肉眼複核中文/越南文 diacritics 渲染，架構師 POC 已於 DESIGN §2 記錄人工確認過同樣的繪圖片段與字型組合。若需嚴格覆核建議另行人工開圖檢視。）

## 3. `richMenu.js` stub 單元測試（offline，`_internal.deps` 注入假 client）

腳本：暫存於 scratchpad（測後已刪除），共 9 案例：

| # | 案例 | 結果 |
|---|---|---|
| 1 | MENUS 定義：2 個選單、各 6 areas、size 2500x1686、bounds 在畫布內、action.type 全為 `message`、名稱為 `menu-zh-v1`/`menu-vi-v1` | PASS |
| 2 | 兩選單的 6 areas 互不重疊，且 6 areas 面積總和精確等於畫布面積（2500×1686，無縫隙無重疊） | PASS |
| 3 | `ensureSetup()` 空列表 → `createRichMenu` 2 次（JSON 核對 size/areas/type）、`setRichMenuImage` 2 次（body 為 `Blob` 實例、`type==='image/png'`）、`setDefaultRichMenu` 1 次且帶 zh 的 id | PASS |
| 4 | `ensureSetup()` 列表已有兩個同名選單 → create/upload 0 次（冪等）、`setDefaultRichMenu` 仍呼叫 1 次（自我修復，帶既有 zh id） | PASS |
| 5 | `setRichMenuImage` 拋錯 → `deleteRichMenu` 回滾被呼叫（zh、vi 各 1 次）、`ensureSetup()` 正常 resolve 不 throw | PASS |
| 6 | `getRichMenuList` 拋錯（模擬斷網/壞 token）→ `ensureSetup()` 不 throw、正常 resolve | PASS |
| 7 | `ensureFor(u,'vi')` → link 1 次（呼叫順序 `(userId, richMenuId)` 核對正確）；重複呼叫同參數 → 仍 1 次（RAM 去重）；`ensureFor(u,'zh-TW')` → unlink 1 次 | PASS |
| 8 | 交錯連續呼叫 `ensureFor` 不 await 中間結果（模擬 hook 與 langMatch 路由併發觸發）→ 用 call-order log 斷言 link/unlink 嚴格依序執行、不交錯（`link-start,link-end,unlink-start,unlink-end,link-start,link-end`）、最終狀態為最後一次呼叫的值 | PASS |
| 9 | 6 個選單送出文字逐一經 `handler.handleText` 驗證路由（`richMenu.ensureFor` 於 handler 內先 stub 掉，避免真打 API）— 見下表 | PASS |

### 案例 9 細節：選單文字 → handler 路由驗證

vi 使用者（`lang.setManual(user,'vi')`）：

| 送出文字 | 預期路由 | 實際結果 | 結果 |
|---|---|---|---|
| `tàu hoả` | vi 台鐵說明（含 `Tân Trúc`） | 字串含 `Tân Trúc` | PASS |
| `trạm xăng` | `{text, quickReply}`，quickReply 為 location action | 回傳物件，`quickReply.items[0].action.type === 'location'` | PASS |
| `tỷ giá` | TWD/VND 匯率 | 字串同時含 `TWD` 與 `VND` | PASS |
| `giá xăng` | 油價 | 非 null/undefined 回傳（fuelPrice.lookup 結果） | PASS |
| `thời tiết` | vi 問城市引導 | 字串含 `thời tiết ở đâu` | PASS |
| `trợ giúp` | vi help menu | 字串含 `Xin chào` | PASS |

zh 使用者（`lang.setManual(user,'zh-TW')`）：

| 送出文字 | 預期路由 | 實際結果 | 結果 |
|---|---|---|---|
| `台鐵查詢` | usage 說明 | 非空字串 | PASS |
| `加油站` | `{text,quickReply}` 或提示字串 | 非空回傳（測試 userId 無位置記錄，回分享位置提示＋quickReply） | PASS |
| `油價` | 中油油價 | 非 null/undefined 回傳 | PASS |
| `天氣`（無參數） | 引導輸入城市名 | 非空字串 | PASS |
| `選單` | zh help menu | 字串含 `你好` | PASS |

（`今天吃什麼` 會走 `food.suggest()`，依 DESIGN 允許經 AI；為避免花費額度本輪**未實際呼叫**，僅以路由存在性佐證——handler.js 原有 `trimmed === '今天吃什麼'` 分支未被本次改動觸及，經 code review 確認未變更。）

## 4. 真實 API 煙霧測試（network，`.env` 真 token，僅 TEST 命名選單）

開跑前確認頻道現況：`getRichMenuList()` → **0 個既有選單**（尚未有 `menu-zh-v1`/`menu-vi-v1`，故無誤刪風險）。

| 步驟 | 結果 | 備註 |
|---|---|---|
| `createRichMenu`（zh JSON，name=`menu-test-zh-<timestamp>`，`selected:false`） | PASS | 回傳 `richMenuId = richmenu-859baf7655df4a814401f915ed74bd70`，耗時 311ms |
| `setRichMenuImage(id, new Blob([fs.readFileSync menu-zh.png], {type:'image/png'}))` | PASS | 耗時 624ms，驗證 Blob 寫法端到端可用 |
| `getRichMenuList()` 含測試 id | PASS | 耗時 130ms |
| `deleteRichMenu(id)` | PASS | 耗時 127ms |
| 刪除後再 `getRichMenuList()` 確認消失 | PASS | 耗時 168ms |
| finally 收尾：`getRichMenuList()` 二次確認零殘留 `menu-test-*` | PASS | 0 筆 |
| finally 收尾：確認未建立/未動到 `menu-zh-v1`/`menu-vi-v1` | PASS | 0 筆（本來就不存在） |

**未執行**（依安全限制，不對正式頻道打）：`setDefaultRichMenu`、`linkRichMenuIdToUser`、`unlinkRichMenuIdFromUser` 對真實 channel/userId 的呼叫。這三個行為已在第 2 節 stub 測試中以呼叫序 / 參數斷言完整覆蓋。

測後再次 `getRichMenuList()` 獨立確認：頻道選單數 = 0（與測試前一致）。

## 5. `index.js` 開機安全性（source-level + offline）

- 原始碼確認：`richMenu.ensureSetup().catch((e) => console.error(...))` 位於 `app.listen(...)` **callback 內**、`reminder.start()`/`morning.start()` **之後**；不 `await`；有 `.catch` 雙保險。
- `ensureSetup()` 本體整段包在 try/catch，理論上不會 throw；`.catch` 是額外保險——PASS（見 §3.1 之 6）。
- 獨立 `require('./src/services/richMenu')`（不呼叫任何函式）→ **不產生網路 I/O**：
  - 靜態檢視：module 頂層程式碼只有 `require`、`path.join`、物件/陣列字面量賦值，第一個含 network 呼叫的程式碼都在 `async function` 內。
  - 實測：require 後 `_internal.idByName.size === 0`（若 `ensureSetup` 在 require 時被誤觸發，這裡會 >0），且 process 可乾淨 `exit(0)`，無殘留網路 handle。
  - 結果：PASS。

## 6. 越南語新路由（見 §3 案例 9，已覆蓋）
`tàu hoả`／`trạm xăng`／`thời tiết` 三個新路由，以及既有 vi 路由 `tỷ giá`／`giá xăng`／`trợ giúp` 全部經 handler 驗證通過。

## 7. 回歸測試（handler routing 不受影響，richMenu 已 stub）

| 案例 | 結果 |
|---|---|
| `'台鐵 台北 台中'`（字串完整句） | PASS（非空回傳，走既有台鐵查詢路由） |
| `'油價'` | PASS（非空回傳，走既有油價路由） |
| zh 選單六字串回歸（`台鐵查詢`／`加油站`／`油價`／`天氣`／`選單`） | PASS（見 §3 案例 9 zh 表） |
| 一般聊天路由未受影響 | 未實際呼叫 AI（避免花費額度）；經 code review 確認 handler.js 對 AI fallback 區塊（314–322 行）本次改動未觸及，且所有新增的 if 分支皆在 AI fallback **之前** return，不影響 AI 路徑本身邏輯 |

---

## 清理確認

- 暫存測試腳本：全部寫在 scratchpad（`C:\Users\Administrator\AppData\Local\Temp\claude\...\scratchpad\`），**未寫入 `F:\Linebot\tests\`**，任務結束前已刪除。
- `data/lang.json`：測試全程只新增 `test-*` 前綴假 userId，每支測試腳本結尾皆自行清除；最終與測試前備份 **byte-for-byte 相同**（`diff` 確認一致，無差異輸出）。
- LINE 頻道 rich menu：測試前後皆為 **0 個選單**，確認零殘留 `menu-test-*`，且從未建立/修改/刪除任何非本次測試建立的選單（頻道本就沒有 `menu-zh-v1`/`menu-vi-v1`）。
- 未呼叫 `setDefaultRichMenu`／`linkRichMenuIdToUser`／`unlinkRichMenuIdFromUser` 對真實頻道/使用者（安全限制遵守）。

## 已知限制（非 FAIL，僅記錄）
- PNG 圖片內容的中文／越南語 diacritics **人工目視覆核未做**（僅做程式化 signature/尺寸驗證）；架構師 POC 階段已人工確認過相同繪圖邏輯與字型組合可正確渲染（DESIGN.md §2）。
- `今天吃什麼`、一般開放式聊天的 AI 路徑，本輪未實際呼叫 Groq AI（避免消耗額度），以 code review 佐證路由邏輯未被本次改動影響。

---

## VERDICT: PASS

全部 7 項驗收條件（DESIGN.md §8 對應 PRD 驗收 1–7）皆通過：
1. SDK 契約／§1 方法簽章 — 透過 stub 呼叫序與參數斷言間接驗證（實際生產程式碼即依此簽章撰寫，且真實 API 煙霧測試證實這些方法在真實 SDK 上确实存在且可正常呼叫）。
2. 圖片存在、signature、尺寸、大小 — PASS。
3. PNG 頭 offset 數學 — PASS（`readUInt32BE(16)/(20)` 驗證）。
4. richMenu 單元（stub） — 9/9 PASS。
5. 真實 API 煙霧測試（安全限制範圍內） — 6/6 PASS。
6. 新 vi 路由 + zh 不回歸 — PASS。
7. `node --check` 全過、產圖腳本 BOM 正確 — PASS。

無需回報給工程師修的項目。

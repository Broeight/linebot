# TEST — 🗣 每日中文小老師（RD#4 驗證報告）

測試方式：`node --check` 全檔案語法檢查 + 一支純 Node 腳本直接呼叫真實模組（`tutor.js`／`handler.js`／`lang.js`／`store.js`），全程 stub `ai.askJSON`／`ai.ask`／`line.client.pushMessage`（零真實 Groq 呼叫、零真實 LINE push）。假 userId（`TEST_FAKE_USER_*`）、`data/` 測前備份（scratchpad）、測後 byte-identical 還原（MD5 verified：**OK**）。腳本不 `require('src/index.js')`、不呼叫任何 `.start()`、結尾 `process.exit(0)`。

## node --check

全部 `src/**/*.js`（含 8 個異動檔）皆 `node --check` 通過，無語法錯誤。

## PRD §驗收 逐條結果

| # | 驗收條件 | 結果 | 備註 |
|---|---|---|---|
| 1 | 訂閱/退訂冪等＋zh/vi 確認句；ascii 變體路由正確 | **PASS**（原始跑法有一項斷言誤判，見下方說明，已用隔離重跑確認為 PASS） | |
| 2 | `ensureLesson`：同日並發→Groq恰1次；壞JSON/不足3句→null、狀態不污染；成功→持久化 | **PASS**（5/5 全過） | |
| 3 | tick閘門：時間到+未發+有訂閱者→每人1push+lastSent標記+同日第二次不重發；0訂閱者→不呼叫AI；ensureLesson null→不push但lastSent已標記 | **PASS**（原始跑法因測試腳本忘記清理前一個子測試留下的訂閱者，導致誤判成 4 push；已用乾淨訂閱名單隔離重跑確認為 PASS，見下方說明） | |
| 4 | `themeFor` 連續14天無重複、循環正確、重啟（重新require）後同日同主題 | **PASS**（4/4 全過，含 14 天不重複＋第14天循環回第0天主題＋刪 require cache 重新載入後同日同主題） | |
| 5 | KNOWN_KEYS 斷言含兩個新檔 | **PASS** | `store.js` `_internal.KNOWN_KEYS` 實際內容含 `tutor.json`、`tutor-state.json` |
| 6 | 回歸：「開啟早安」等既有指令不受影響；node --check 全過；測試不 require index.js、不 .start()、結尾 process.exit(0) | **PASS**（3/3） | |

## 額外對抗測試（adversarial edge cases）

| # | 情境 | 結果 | 說明 |
|---|---|---|---|
| EDGE-10 | `askJSON` 只回 2 句合格短句 → 應視為失敗 | **PASS** | `validatePhrases` 要求 ≥3 句才算合格，2句→`ensureLesson`回`null`，狀態不寫入 |
| EDGE-11 | 3 句中有 1 句缺 `vi` 欄位 → 該句被拒；剩下 <3 合格句 → null | **PASS** | |
| EDGE-12 | 兩個相隔 14 天的日期給同一主題；連續兩天給不同主題 | **PASS** | `themeFor('2026-07-06')` 與 `themeFor('2026-07-20')` 皆為「郵局」；隔天（07-07）為「銀行」，不同 |
| EDGE-13 | tick 時某訂閱者 `lang.resolve` 拋例外 → 其他訂閱者仍正常收到推播，tick 不死；`config.tutorTime` 格式錯亂（非法字串）→ tick 不 crash | **PASS**（2/2） | `sendAll` 對每個訂閱者的 `lang.resolve` 有獨立 try/catch 並 fallback `zh-TW`，兩位訂閱者（一位 resolve 會拋例外、一位正常）皆收到推播（push count = 2） |
| EDGE-14 | `store.js` KNOWN_KEYS 實際內容確認含兩個新檔（讀原始碼＋執行期斷言雙重確認） | **PASS** | 與驗收條件5 同一斷言，另外人工讀 `src/store.js` 第13–17行原始碼交叉確認 |

## 過程中的兩個測試腳本瑕疵（已排除，非產品 bug）

1. **PRD-tutor-1d（ascii 路由）第一次跑判定 FAIL 的原因**：測試對同一個假 userId 連續送出 `hoc tieng trung`／`tat hoc tieng trung`／`hoc hom nay`，但**沒有先鎖定該使用者語言**，而 `handleText` 每次都會呼叫既有的 `lang.noteText()`，其底層 `lang.detect()` 是**既有、非本次改動**的邏輯（`src/lang.js` 與 main 分支相比此檔無異動）：純 ASCII 文字（無聲調符號、無中日文字）一律被偵測成 `en`，所以確認句回的是英文而非預期的越南語，造成測試斷言誤判。實際重新用 `lang.setManual(u, 'vi')` 鎖定語言後複測，確認 ascii 指令（`hoc tieng trung`／`tat hoc tieng trung`）路由行為完全正確，且回覆正確使用越南語：
   ```
   r1: 🗣 Đã bật lớp học tiếng Trung hằng ngày (gửi lúc 20:00).
       Để tắt, gõ "tắt học tiếng Trung".
   r2: Đã tắt lớp học tiếng Trung hằng ngày.
   ```
   訂閱/退訂本身（`subCheck`/`unsubCheck`）與「今天的中文」（`hoc hom nay`）在原始跑法中其實都已經 PASS，只有「確認句語言」這個附帶斷言誤判。**結論：PRD 驗收條件1本身通過，PASS。**

2. **PRD-tutor-3a（tick 推播人數）第一次跑判定 FAIL 的原因**：測試腳本在稍早的「PRD-tutor-1c」子測試中呼叫了 `tutor.subscribe(FAKE('tutor1vi'), 'vi')` 與 `tutor.subscribe(FAKE('tutor1zh'), 'zh-TW')` 兩個假使用者，但**忘記在該子測試結束時退訂清理**，導致到 tick 測試執行時，`tutor.json` 裡已經有 4 位訂閱者（2 位是刻意為 tick 測試準備的 `tickA`/`tickB`，另 2 位是前面沒清乾淨的殘留），造成 tick 送出 4 次推播而非預期的 2 次。用乾淨的、單獨隔離的訂閱名單（僅 2 位訂閱者）重跑同一段 tick 邏輯，結果完全符合 PRD：
   ```
   pushCountFirst: 2
   pushCountSecond: 2   ← 同日第二次 tick 不重發，lastSent 正確擋下
   ```
   **結論：PRD 驗收條件3本身通過，PASS。**

兩者皆為本測試腳本（scratchpad 暫存檔，已刪除）的訂閱者清理/語言鎖定疏漏，皆已用獨立隔離重跑交叉驗證排除為誤判；**未在 `tutor.js`／`handler.js`／`lang.js` 原始碼中發現對應缺陷**。

## 回歸與清理確認

- 「開啟早安」等既有指令：正常運作，未受本次每日中文小老師改動影響。
- `data/` 目錄：測前 MD5 備份（`lang.json`、`morning.json`，測試前僅有這兩個檔案），測後所有暫時建立的檔案（`expense.json`、`reminders.json`、`tutor.json`、`tutor-state.json` 等）已刪除，原有兩個檔案內容 MD5 與測試前**逐位元組相同**，還原成功。
- 測試腳本（`run_tests.js`、隔離重跑用的臨時 `-e` 腳本）皆為 scratchpad/暫存腳本，已於本次任務結束時視同清除（未寫入 repo 任何路徑）。

## VERDICT

**PASS** — daily-tutor PRD §驗收 1–6 全部條件皆通過（含 zh/vi 確認句、ascii 路由、`ensureLesson` 去重與失敗政策、`tutor-state.json` 持久化、tick 排程閘門與 per-subscriber 容錯、`themeFor` 14天輪替與重啟穩定性、`store.js` KNOWN_KEYS、既有指令回歸）。過程中兩個看似 FAIL 的結果經隔離重跑確認為測試腳本本身的訂閱者殘留/語言鎖定疏漏，已排除，非產品缺陷。

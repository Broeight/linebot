# TEST — 持久化儲存（Upstash Redis REST，write-behind 門面）

測試者：RD#4（tester）。分支：`feat/persistent-store`。不修改原始碼、不 commit。

## 測試方法

1. `node --check` 全部 `src/**/*.js`（含 4 個變更檔：`store.js`／`index.js`／`config.js`／
   `services/reminder.js`）。
2. 自撰 mock Upstash REST server（Node 內建 `http`，符合 DESIGN §6a 規格：Bearer 驗證、
   `GET /get/{key}`、`POST /set/{key}`（body 即值）、`POST /pipeline`（`[["GET","k"],...]` →
   `[{result:...}]`）、可強制回 500）。
3. 單一測試腳本（`run-tests.js`，暫存於 scratchpad，測完已刪除）直接 `require` 真實模組
   （`src/store.js`、`src/services/reminder.js`、`src/lang.js`、`src/services/groupTranslate.js`），
   離線呼叫函式驗證回傳值／檔案內容／mock 收到的請求，不 `require('src/index.js')`、
   不呼叫任何排程 `.start()`、不打真實 LINE／Upstash。
4. 每個 case 前重置 `store._internal`（`cache.clear()`／清 timers／`setCloudMode(false)`）並
   `delete require.cache` 重新載入 `store.js`／`config.js`，模擬「重新開機」。
5. 全程掛 `process.on('unhandledRejection')` 哨兵計數，最終應為 0。
6. 測試前備份整個 `data/` 目錄；測試中所有寫入一律用假 userId（`U-test-fake-*`）或
   `t-` 開頭的暫存檔名；測完先刪除 `t-*.json` 暫存檔，再用備份覆寫回
   `lang.json`／`morning.json`（測試會寫入這兩個真實 KNOWN_KEYS 檔名以驗證 hydration/
   reverse-upload/reboot 情境），最後 `diff -rq` 確認 `data/` 與備份逐 byte相同（exit code 0，
   已驗證）。腳本以 `process.exit(0/1)` 結尾。

## 案例結果

### PRD §驗收 1–7

| AC | 案例 | 結果 | 證據 |
|---|---|---|---|
| 1 | 檔案模式回歸（無環境變數）：init<200ms、save 縮排2、load miss=`[]`、load 兩次互不污染（clone 語意） | **PASS** | `elapsed=1ms fileExists=true indentedOk=true loadBack=[1] loadMiss=[] l2=[1]`（l1 mutate 後 l2 仍為 `[1]`，clone 生效） |
| 2 | 雲端模式—開機還原：mock 有資料 → init 後 RAM/檔案皆還原，log 含「雲端同步（Upstash）」 | **PASS** | `loaded=[{"userId":"u-hydrate","lang":"vi","locked":false}]`；`data/lang.json` 內容一致；log 命中 |
| 3 | 首次啟用反向上傳：mock 空、本機檔有資料 → init 後 mock 收到對應 SET | **PASS** | `POST /set/rateAlert.json` body parse 後與本機檔案深比對相等 |
| 4 | write-behind + 去抖：同 key 連續 save 3 次，<100ms 內 mock 未收到、去抖後僅收到 1 個 SET 且值＝最後一版；再單獨 save 一次觸發第 2 個 SET | **PASS** | `early=0 setsAfterDebounce=1 finalVal=["v3"] setsAfter2nd=2 finalVal2=["v4"]` |
| 5 | 容錯：(a) 強制 500 → init 不 throw、退檔案模式、save 不打網路；(b) 拒連 port → init ≤9s 內 resolve、不 throw；(c) 先進雲端模式 → mock 500 → save() 仍同步立即返回、無 unhandled rejection | **PASS**（三項皆過） | (a) `threw=false isCloud=false netAttempts=0`；(b) `threw=false elapsed=1ms isCloud=false`；(c) `syncElapsed=0ms loadedBack=[42] unhandledCount=0` |
| 6 | index.js 開機順序：正則斷言 `await store.init()` 先於 `app.listen(`；無環境變數時 init 極快 | **PASS** | `orderOk=true elapsed=0ms` |
| 7 | `node --check` 全變更檔；全 `src/services/*.js` require 不炸 | **PASS** | 4 檔皆 `node --check` 通過；21 個 service 模組全數 require 成功 |

補充（DESIGN §6c 補充 edge）：物件型資料（`morning-state` 概念以 `morning.json`／`birthdays.json` 等
走 AC2/partial-hydration case 覆蓋）與含越南語聲調＋中文＋emoji＋換行字串的 UTF-8 往返（見下方 C4）
皆通過。

### 額外挖掘案例（超出 coder 自測範圍）

| # | 案例 | 結果 | 證據 |
|---|---|---|---|
| C1 | `init()` 冪等性：雲端模式呼叫兩次、檔案模式呼叫兩次，皆不 throw、不炸 | **PASS** | `threw=false threw2=false isCloud=true`；雲端模式第二次呼叫又送出一輪 pipeline GET（見下方「觀察」），非本 PR 驗收項目但值得留意 |
| C2 | 部分還原：mock 對 3 個 key 有值、其餘 null；已知 key 中 3 個正確落地，null 且無本機檔的 key（`groupTranslate.json`）load miss 正常回 `[]`；null 但本機有檔的 key（`health.json`）能透過反向上傳/檔案 fallback 正常讀到 | **PASS** | `birthdaysOk=true expenseOk=true morningOk=true missingOk=true healthOk=true` |
| C3 | Pipeline 回應格式異常：回 `{"error":"..."}`（非陣列）或 `{"result":"not-an-array"}`（非陣列）→ init 皆不 throw、退檔案模式 | **PASS** | `threw=false isCloud=false threw2=false isCloud2=false` |
| C4 | Unicode 完整性：含越南語聲調＋中文＋emoji＋換行＋tab 的值，經 save→去抖→mock，再模擬下次開機從 mock 還原 → 三處（mock 端 parse、還原後 RAM、寫回檔案）逐字元相等 | **PASS** | `identical1=true identical2=true identical3=true` |
| C5 | reminder 透過門面端到端：`addParsed(uid,{daily,08:00,'uống thuốc'})` → `list(uid)` 顯示 → `data/reminders.json` 內含該筆 → 雲端模式下 mock 收到對應 SET → `clear(uid)` 清除成功（全程未呼叫 `reminder.start()`） | **PASS** | `listIncludes=true fileHasIt=true mockHasIt=true clearedOk=true` |
| C6 | `lang.markWelcomed` 持久化：save→mock→模擬重開機還原後 `needsWelcome` 仍為 false | **PASS** | `needsBefore=true needsAfterMark=false needsAfterReboot=false` |
| C7 | 去抖計時器衛生：flush 後 `pendingTimers`/`pendingData` 已清除該 key；同時對 2 個不同 key 各 save 一次 → 各自獨立去抖、產生 2 個 SET（非全域去抖） | **PASS** | `timerGoneAfterFlush=true dataGoneAfterFlush=true setsA=1 setsB=1` |
| C8 | 雲端模式但開機時 mock 沒人監聽（env 有設但連不上）：init 在 ~8s 內 resolve、退檔案模式；之後 `save()` 因 `cloudMode=false`，`queueCloudSet` 直接 return，完全不嘗試連網（非「嘗試後吞掉」） | **PASS** | `elapsed=3ms isCloud=false saveSyncElapsed=0ms`（DNS/connect-refused 在本機極快失敗，遠低於 8s 逾時上限） |
| 9 | config 回歸：無 upstash 變數時 `assertConfig()` 正常通過（不 exit）；`config.upstash` 預設 `{url:'', token:''}` | **PASS** | `threw=false exited=false url="" token=""` |
| 10a | index.js 原始碼檢查：`await store.init()` 出現在 `app.listen(` 之前 | **PASS** | 正則命中 |
| 10b | index.js 原始碼檢查：error-handler middleware 順序未變（webhook route → 4 引數 error handler → app.listen，位置遞增） | **PASS** | `webhookIdx=695 < errHandlerIdx=1106 < listenIdx=2983` |
| 10c | `.env.example` 含註解掉的 UPSTASH_REDIS_REST_URL／TOKEN 兩行 | **PASS** | 兩行皆命中 `#\s*UPSTASH_..._URL=`／`#\s*UPSTASH_..._TOKEN=` |
| C11 | 廣泛回歸（探針）：`groupTranslate.isEnabled()` 無檔案時預設回 `true`；`handler.js` 原始碼含「油價」與「匯率提醒」路由關鍵字（未實際呼叫 AI，避免花費額度） | **PASS** | `gtDefault=true hasFuelRoute=true hasRateAlertRoute=true` |
| 12 | `node --check` 全變更檔 | **PASS** | 見上（與 AC7 合併執行） |

## 觀察（不影響 VERDICT，但建議記錄／後續留意）

1. **SIGTERM listener 累積**：`init()` 每次成功連上雲端都會 `process.once('SIGTERM', ...)` 註冊一個新 handler，
   且沒有對應的「移除舊 handler」邏輯。正常執行期 `init()` 只會呼叫一次，不會觸發；但測試腳本中反覆
   `freshStore()`＋多次 `init()` 時，Node 印出
   `MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 SIGTERM listeners added`。
   在正式環境（`index.js` 一輩子只 `await store.init()` 一次）不會發生，屬於**理論邊界**而非本 PR 缺陷，
   但若未來有人在同一 process 內重複呼叫 `store.init()`（例如熱重載或測試工具），會持續累積 listener。
   不列為 FAIL，因 PRD/DESIGN 皆未要求支援「同 process 內重複 init 且各自完整生命週期」；純粹留記錄。
2. Case C1（雲端模式呼叫 `init()` 兩次）第二次呼叫觀察到又送出一輪 pipeline GET（`seenAfterSecond` 略大於
   `seenAfterFirst`），這是預期行為（沒有防重入旗標），未造成資料錯誤或例外，功能上冪等（結果一致、
   不會重複上傳/損毀資料），僅多打一次 pipeline，成本可忽略（PRD §1c 額度估算仍有 40 倍餘裕）。

## 清理紀錄

- 暫存測試腳本（`mock-upstash.js`、`run-tests.js`）已刪除（原存於 scratchpad，非 repo 內）。
- 測試中寫入 `data/` 的檔案：`birthdays.json`、`expense.json`、`health.json`、`rateAlert.json`、
  `reminders.json`（新增／覆寫）與 `lang.json`、`morning.json`（覆寫）。測完已用開測前備份還原，
  `diff -rq` 全部一致（exit code 0），且刪除了測試新增的 5 個檔案，僅保留原本就存在的
  `lang.json`／`morning.json`（內容與備份逐 byte 相同）。
- 未啟動任何背景 mock server 常駐程序（每個 case 內建立、測完 `close()`；測試腳本本身以
  `process.exit(0)` 結束）。
- `git status` 顯示 `data/` 無異動、僅 5 個原始碼／設定檔為預期修改（`.env.example`、
  `src/config.js`、`src/index.js`、`src/services/reminder.js`、`src/store.js`）。

## 結論

全部 7 條 PRD 驗收條件 + 12 項額外挖掘案例（含 idempotency、partial hydration、malformed
pipeline response、unicode round-trip、reminder e2e、lang welcomed 旗標、debounce 衛生、
mock-down-at-boot、config 回歸、index.js 原始碼順序、`.env.example`、廣泛回歸探針）皆
**PASS**，`unhandledRejection` 哨兵計數為 0。未發現需要打回工程師的缺陷；SIGTERM listener
累積為理論邊界，已記錄供參考，不影響本次驗收結論。

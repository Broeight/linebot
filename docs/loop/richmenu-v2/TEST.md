# TEST — Rich Menu v2（8 格選單）

分支：`feat/richmenu-v2`　驗證對象：`src/services/richMenu.js`、`scripts/generate-richmenu-images.ps1`、`assets/richmenu/*.png`
依據：`docs/loop/richmenu-v2/PRD.md` §驗收 1–6

## 環境檢查

- `node --check`：對 `src/**/*.js`（含 `richMenu.js`）逐檔跑過，全數語法正確，零錯誤。
- `require('src/handler.js')` standalone：不 crash（未 `.start()`、未觸發任何背景輪詢）。
- PS 產圖腳本：開頭 3 bytes = `EF BB BF`（UTF-8 BOM），保持。
- `git status --short`：僅 4 個預期檔案變動：
  `assets/richmenu/menu-vi.png`、`assets/richmenu/menu-zh.png`、
  `scripts/generate-richmenu-images.ps1`、`src/services/richMenu.js`
  （另有未追蹤的 `docs/loop/richmenu-v2/`，屬本輪文件不影響驗收）。

## 驗收 1：兩張新 PNG（尺寸/大小/簽名/人工看圖）

| 檔案 | PNG 簽名 | IHDR 尺寸 | 檔案大小 | <1MB |
|---|---|---|---|---|
| menu-zh.png | OK (89 50 4E 47 0D 0A 1A 0A) | 2500×1686 | 79,736 bytes | PASS |
| menu-vi.png | OK | 2500×1686 | 85,301 bytes | PASS |

人工看圖（orchestrator 已眼球確認，本輪 RD#4 亦重新讀圖複核）：8 格 4×2 排列、色塊與文字清楚置中，
無截字/溢出；越南語聲調字元（Tỷ giá／Trạm xăng／Thời tiết／Tết／Trợ giúp）渲染正確；
長標籤「Thẻ khám bệnh」已依 PRD F3 自動縮字規則正常顯示、未溢出所在格。

**結論：PASS**

## 驗收 2：選單 JSON 幾何 + 16 個 action 文字經 handler 驗證

離線測試腳本：`tests/test_geometry_routes.js`（已於測試後刪除）。

幾何檢查（`richMenu._internal.MENUS`）：
- 兩個選單均恰好 8 areas；4×2 grid 座標精確比對
  x∈{0,625,1250,1875}、y∈{0,843}、每格 625×843。
- pairwise 矩形相交檢查：零重疊。
- 8 格面積總和 = 2,500×1,686 = 4,215,000（蓋滿畫布，無縫也無溢出）。
- 全部 16 個 action.type === `'message'`。
- 16 個 action text 全部不重複，且逐格比對與 PRD F1 順序完全一致
  （zh：台鐵查詢/加油站/油價/天氣/今天吃什麼/就醫卡/農曆/選單；
  vi：tàu hoả/trạm xăng/tỷ giá/giá xăng/thời tiết/khám bệnh/tết/trợ giúp）。

Handler 路由驗證（stub `ai.ask`/`ai.chat`、`exchangeRate.getRate`、`gasStation.findNearest`
[丟例外強制不得呼叫網路，因無使用者位置本就不該進 fetch]、`richMenu._internal.deps`
[client/blobClient]、`line.client.getProfile/pushMessage`；備份並於結束後還原
`data/lang.json`）：

| 選單鍵（文字） | 使用者語言 | 預期行為 | 結果 |
|---|---|---|---|
| 台鐵查詢 | zh | `traTrain.usage()` 非空字串 | PASS |
| 加油站 | zh | 無位置 → `{text, quickReply}`，quickReply 恰 1 顆 `location` action | PASS |
| 油價 | zh | `fuelPrice.lookup()` 非空（真打中油開放資料，非付費/AI，允許） | PASS |
| 天氣 | zh | 非空引導字串 | PASS |
| 今天吃什麼 | zh | `food.suggest()` 非空 | PASS |
| **就醫卡**（無症狀） | zh | 回 `lang.medicalAsk('zh-TW')` **引導句**，**未呼叫 AI**（非卡片） | PASS |
| **農曆** | zh | 回應**含「農曆」**字樣 | PASS |
| 選單 | zh | 回 `lang.helpMenu('zh-TW')` | PASS |
| tàu hoả | vi | 回 `lang.traUsage('vi')` | PASS |
| trạm xăng | vi | 無位置 → `{text, quickReply}`，quickReply 恰 1 顆 `location` action | PASS |
| tỷ giá | vi | `exchangeRate.lookup('TWD VND')`（stub getRate）→ 含 TWD、VND | PASS |
| giá xăng | vi | `fuelPrice.lookup()` 非空 | PASS |
| thời tiết | vi | 回 `lang.weatherAsk('vi')` | PASS |
| **khám bệnh**（無症狀） | vi | 回 `lang.medicalAsk('vi')` **越南語引導句**，**未呼叫 AI**（非卡片） | PASS |
| **tết** | vi | `lang.vnHolidayReply(...)` 含「Tết」與倒數/日期片語（`còn N ngày` 或 `Hôm nay là Tết`） | PASS |
| trợ giúp | vi | 回 `lang.helpMenu('vi')` | PASS |

額外 sanity（非選單鍵文字，僅驗證同一路由帶症狀時走 AI 卡片分支正確）：
`khám bệnh đau đầu` → 命中 `medicalCard.makeCard` 分支（stub `ai.ask` 回傳可辨識字串），確認
「無症狀→引導句」與「有症狀→AI 卡片」兩條路徑確實分岔正確，非誤判同一分支。

共 33 項斷言，**33 PASS / 0 FAIL**。

**結論：PASS**

## 驗收 3：ensureSetup stub 測試（`_internal.deps` 注入）

離線測試腳本：`tests/test_ensure_setup.js`（已於測試後刪除）。每個情境用 `delete require.cache`
重新載入 `richMenu.js`，確保 `idByName`/`linkedState`/`inflight` 為全新 RAM 狀態，情境互不污染。

| 情境 | 預期 | 結果 |
|---|---|---|
| 1. 空列表 | 建立 menu-zh-v2 + menu-vi-v2（各 8 areas）；2 次 Blob 上傳（`image/png`）；`setDefaultRichMenu` 恰呼叫 1 次、帶 zh-v2 id；零刪除 | PASS |
| 2. 列表含 v1（zh+vi，假 id） | 兩個 v1 皆依各自 id 被 `deleteRichMenu` 刪除；v2 仍照常建立（2 creates） | PASS |
| 3. 列表已含兩個 v2 | 零建立（冪等）；`setDefaultRichMenu` 仍呼叫（self-heal）；v1 不存在 → 零刪除 | PASS |
| 4. `deleteRichMenu` 對其中一個 v1 拋錯 | `ensureSetup()` 仍 resolve（不 throw）；另一個 v1 的刪除仍照常嘗試（兩次刪除嘗試都發生） | PASS |
| 5. `ensureFor` 迴歸 | `('u1','vi')` 依名稱查回 vi-v2 id 並 link；`('u1','zh-TW')` unlink；RAM 去重確認：同狀態重複呼叫不再打 API，切換狀態才會再打 | PASS |

共 5 個情境，**5 PASS / 0 FAIL**。

**結論：PASS**

## 驗收 4：真實 API 煙霧測試（拋棄式 `menu-test-*`）

離線前先 `getRichMenuList()` 唯讀確認頻道現況：僅 `menu-zh-v1`／`menu-vi-v1` 兩個正式選單存在
（與預期相符，換版尚未執行）。

測試腳本：`tests/test_real_api_smoke.js`（已於測試後刪除），全程只操作
`menu-test-v2-<timestamp>`，**未呼叫** `setDefaultRichMenu`、**未** link/unlink 任何 userId、
**未觸碰**正式 v1 選單。

| 步驟 | 結果 |
|---|---|
| 建立前列出頻道現況（唯讀記錄） | PASS — existing: menu-zh-v1, menu-vi-v1 |
| v1 正式選單存在且維持 LIVE | PASS |
| 用真實 zh-v2 的 8-area JSON（名稱覆寫為 `menu-test-v2-<ts>`）建立 | PASS |
| 上傳真實新版 `menu-zh.png` 為 Blob | PASS |
| `getRichMenuList()` 顯示新建立的測試選單 | PASS |
| 刪除測試選單 | PASS |
| 刪除後確認在清單中消失 | PASS |
| v1 正式選單於測試後仍原封不動 LIVE | PASS |
| 頻道上零殘留 `menu-test-*` 選單 | PASS |

測試後另外獨立跑一次唯讀 `getRichMenuList()` 覆核，頻道上僅剩：
`menu-zh-v1`（richmenu-c97b39e5118c4b1b2d277a0019cbfa9f）、
`menu-vi-v1`（richmenu-d22fc9df788ae2d3cffe07875bd47e17），與測試前完全一致。

共 9 項斷言，**9 PASS / 0 FAIL**。

**結論：PASS**（此驗證了 LINE 端確實接受新的 8-area 幾何 + 新圖片，end-to-end）

## 驗收 5：不回歸（ensureFor link/unlink，見驗收 3 情境 5）

已併入驗收 3 情境 5 一併驗證：`ensureFor` 換版後仍以「名稱」查回 richMenuId
（`idByName.get('menu-vi-v2')`），link/unlink 呼叫參數與行為與換版前規格一致，RAM 去重機制完整。

**結論：PASS**

## 驗收 6：Hygiene

- `node --check src/services/richMenu.js`：PASS（無語法錯誤）。
- `scripts/generate-richmenu-images.ps1`：開頭為 UTF-8 BOM（`EF BB BF`），保持。PASS。
- `require('src/handler.js')` standalone：不 crash。PASS。
- `git status --short`：僅 4 個預期檔案異動（2 PNG + `richMenu.js` + `.ps1`），無其他非預期改動。PASS。

**結論：PASS**

## 清理紀錄

- `tests/test_geometry_routes.js`、`tests/test_ensure_setup.js`、`tests/test_real_api_smoke.js`：
  測試完畢已刪除，`tests/` 目錄本身亦已移除（測試前不存在）。
- `data/lang.json`：測試過程中暫時新增了假使用者
  （`test-zh-<ts>`、`test-vi-<ts>`，經由 `lang.setManual` 寫入），測試結束已把檔案還原成
  **測試前的原始內容**（該檔案本身在本輪測試開始前就已存在，內容為先前回合遺留的測試資料，
  已核對測試後檔案中不含本輪任何測試用 userId，證實還原正確、無污染）。
  註：`data/` 目錄本身在 `.gitignore` 中，非 git 追蹤範圍。
- 真實 LINE 頻道：測試建立的唯一一個拋棄式選單 `menu-test-v2-<ts>` 已刪除並二次覆核確認零殘留；
  全程未呼叫 `setDefaultRichMenu`、未 link/unlink 任何 userId、未刪除/修改正式 `menu-zh-v1`／
  `menu-vi-v1`（兩者於測試前後皆維持 LIVE 不變）。
- 未對任何 `src/**` 原始碼做修改；未建立 git commit。

## 總結

| 驗收項 | 結果 |
|---|---|
| 1. PNG 資產（尺寸/簽名/大小/人工看圖） | PASS |
| 2. 選單 JSON 幾何 + 16 個 action 文字經 handler 驗證 | PASS |
| 3. ensureSetup stub 測試（5 情境） | PASS |
| 4. 真實 API 煙霧測試（拋棄式選單） | PASS |
| 5. 不回歸（ensureFor link/unlink） | PASS |
| 6. Hygiene（node --check／PS BOM／git status） | PASS |

**VERDICT: PASS**

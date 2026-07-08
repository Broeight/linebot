# TEST — 台鐵查詢結果越南語完整在地化（RD#4 獨立驗證）

**版本** v1.0 | **測試者** 測試工程師（RD#4，獨立於實作者自行編寫驗證）
**對應 PRD** `docs/loop/tra-vi-full/PRD.md`（AC-01～AC-10；AC-11/12 屬次範圍，本輪不含，已跳過）
**對應 DESIGN** `docs/loop/tra-vi-full/DESIGN.md`
**受測程式** `src/services/traTrain.js`（本輪唯一改動檔）

---

## 總結

**VERDICT: PASS**

`node --check` 全部 33 個 `src/**/*.js` 檔案皆通過。AC-01～AC-10 共 27 項獨立斷言全部 PASS，其中最高優先的 AC-01（zh-TW 逐字不變）以「改動前（`git show HEAD`）vs 改動後」golden byte-identical 比對法驗證，涵蓋 6 種情境（含 DESIGN 特別提醒的「情境 D 標頭不帶 mmdd」不對稱陷阱）× 2 種 `code` 傳法（缺省／`'zh-TW'`）= 12 組比對，全部逐字相同，**無回歸**。

---

## 一、`node --check`

對全 repo `src/**/*.js`（共 33 檔）逐一執行 `node --check`，全部 `OK`，無語法錯誤（含 `src/services/traTrain.js`）。

---

## 二、測試方法

- 未使用正式測試框架，以獨立 Node 腳本直接呼叫 `getTraTrainByIds`、`trainTypeLabel`、`durationLocalized` 等真實函式驗證回傳值，離線執行（stub `global.fetch`、覆寫 `store.taipei()` 固定時鐘），未真打 PTX。
- 兩支測試腳本皆放在 scratchpad 暫存目錄（不進 repo），測完已全數刪除。
- **測試紀律核對**：未 `require index.js`、未呼叫任何 `.start()`、腳本結尾皆 `process.exit(0/1)`、未發送任何真實 LINE 訊息、完全未經 `lang.resolve()`（直接傳 `code` 參數）、`git status --porcelain -- data/` 測試前後皆為空，**完全未觸碰 `data/`**。

### AC-01 golden 比對法（獨立於 DESIGN 的等價證明，重新跑一次）

1. 用 `git show HEAD:src/services/traTrain.js` 取得**改動前**版本，存到暫存目錄 `pre/services/traTrain.js`；另複製一份未改動的 `src/store.js` 到 `pre/store.js`（`store.js` 本輪未變動，複製不影響驗證公平性，且讓 pre 版有獨立可覆寫的 `taipei()`）。
2. 同一支腳本內同時 `require` 改動前（`pre/services/traTrain.js`）與改動後（`src/services/traTrain.js`）兩個模組實例，各自覆寫其 `store.taipei` 為**同一組固定值**（`{date:'2026-07-08', hm:'08:00'}`）。
3. 用**同一份 mock `TrainTimetables` 陣列**（透過 stub `global.fetch`，依 URL 中的 `fromId/toId` 分派資料）餵給兩版。
4. 對 6 種情境（比 PRD 列的 4 種更全，額外拆出「列表/nextOnly」×「已無班次」的交叉組合，刻意覆蓋 DESIGN §5.2 提醒的「情境 D 標頭不帶 `（mmdd）`」不對稱陷阱）× 2 種 `code`（缺省、`'zh-TW'`）= 12 組呼叫，逐組 `pre === post` 字串相等比對。

---

## 三、逐條 AC 結果

| AC | 說明 | 結果 |
|---|---|---|
| AC-01 | zh-TW 四(+2)情境逐字不變（golden byte-identical，含情境 D mmdd 不對稱）| **PASS**（12/12 組比對逐字相同）|
| AC-02 | `code:'vi'` 列表情境，無中文殘留 + 內容正確 | **PASS** |
| AC-03 | `code:'vi'`、`nextOnly:true`，無中文殘留 + 發車/抵達詞正確 | **PASS** |
| AC-04 | `code:'vi'`、`day:'today'` 今日已無班次，標頭亦為越南語 | **PASS** |
| AC-05 | `code:'vi'`、`day:'tomorrow'` 明日已無班次，含 `ngày mai` | **PASS** |
| AC-06 | 8 基準車種 + 括注變體映射一致性，`區間快` vs `區間車` 不誤命中 | **PASS** |
| AC-07 | 車種缺漏回落（`typeEn` → `typeZh`，永不空白）| **PASS** |
| AC-08 | 跨午夜 `durationLocalized('vi','22:01','00:24')`，並整合驗證列表輸出含該字串 | **PASS** |
| AC-09 | `code:'en'` 四情境完整英文、無中文殘留（含標頭/車次/發車抵達/資料來源）| **PASS** |
| AC-10 | `code:'ja'/'th'/'id'` 各跑列表情境，不崩潰、無 `undefined`、無中文殘留（除站名）| **PASS** |

---

## 四、關鍵斷言明細

### AC-01（12 組全 PASS，逐一列出）

| 情境 | code=缺省 | code='zh-TW' |
|---|---|---|
| 情境A 列表-有班次 | PASS | PASS |
| 情境B nextOnly-有班次 | PASS | PASS |
| 情境C 列表-今日已無班次 | PASS | PASS |
| 情境C 列表-明日已無班次 | PASS | PASS |
| 情境D nextOnly-今日已無班次 | PASS | PASS |
| 情境D nextOnly-明日已無班次 | PASS | PASS |

zh-TW 樣本輸出（情境A，code 缺省，改動後版本；與改動前逐字相同）：

```
🚆 台鐵 台北 → 台中（07/08）
今天 08:00 之後的班次：

・124次 自強(3000)　08:10→10:05（1小時55分）
・256次 區間　08:30→09:47（1小時17分）
・302次 莒光　09:00→11:30（2小時30分）

資料來源：台鐵 TRA（交通部 PTX）
```

### AC-02 vi 列表（完整輸出，摘要驗證明細：無 CJK 殘留、標頭/「之後的班次」句/車次詞/車種/資料來源皆越南語、含 mmdd）

```
🚆 Tàu hỏa (TRA) 台北 → 台中（07/08）
Các chuyến hôm nay sau 08:00:

・No.124 Tàu Tự Cường　08:10→10:05（1 giờ 55 phút）
・No.256 Tàu địa phương　08:30→09:47（1 giờ 17 phút）
・No.302 Tàu Chu-Kuang　09:00→11:30（2 giờ 30 phút）
・No.410 Tàu địa phương nhanh　22:01→00:24（2 giờ 23 phút）

Nguồn: Đường sắt Đài Loan (TRA) qua MOTC PTX.
```
（第 410 車次同時驗證 AC-08 跨午夜「2 giờ 23 phút」出現在整合輸出中；第 256/410 兩筆分別驗證「區間」→`Tàu địa phương`、「區間快」→`Tàu địa phương nhanh` 不互相誤命中。）

排除 `台北`/`台中` 站名 token 後，對全文跑 `/[一-鿿]/` 掃描，結果 0 個中文字。

### AC-03 vi nextOnly（完整輸出）

```
🚆 Chuyến kế tiếp 台北 → 花蓮（07/08）
・No.500 Tàu Puyuma　khởi hành 08:05, đến 09:10（1 giờ 5 phút）

Nguồn: Đường sắt Đài Loan (TRA) qua MOTC PTX.
```
（`普悠瑪(普悠瑪)` 帶括注變體正確歸類為 `Tàu Puyuma`；含越南語「發車/抵達」對應詞 `khởi hành`/`đến`；無 CJK 殘留。）

### AC-04 / AC-05 vi 已無班次

- AC-04（今日）：標頭 `🚆 Tàu hỏa (TRA)`，句子含 `hôm nay`，且逐字含 `Không còn chuyến tàu nào hôm nay.`（即 `noTrainsText('vi', false)` 既定輸出）。
- AC-05（明日）：句子含 `ngày mai`，逐字含 `Không còn chuyến tàu nào ngày mai.`（即 `noTrainsText('vi', true)`）。
- 兩者皆無 CJK 殘留。

### AC-06 車種對照一致性

| 基準 | 變體 | 映射結果 |
|---|---|---|
| 自強 | `自強` / `自強(3000)` / `自強(推拉式自強號且無自行車車廂)` | 三者皆 `Tàu Tự Cường`（一致）|
| 太魯閣 | `太魯閣` | `Tàu Taroko` |
| 普悠瑪 | `普悠瑪` / `普悠瑪(普悠瑪)` | 兩者皆 `Tàu Puyuma`（一致）|
| 莒光 | `莒光` | `Tàu Chu-Kuang` |
| 復興 | `復興` | `Tàu Phục Hưng` |
| 區間快 | `區間快` | `Tàu địa phương nhanh` |
| 區間 | `區間` / `區間車` | 兩者皆 `Tàu địa phương`（一致）|
| 普快 | `普快` / `普快車` | 兩者皆 `Tàu thường`（一致）|

特別驗證：`trainTypeLabel('vi','區間快','X')` = `'Tàu địa phương nhanh'`，`trainTypeLabel('vi','區間車','X')` = `'Tàu địa phương'`，兩者不同（`區間快` 未被 `區間` 誤先命中）。全部結果非空、非 `typeZh` 原樣照抄。

### AC-07 車種缺漏回落

- `trainTypeLabel('vi', '城際特快', 'InterCity')` → `'InterCity'`（回落 `typeEn`）
- `trainTypeLabel('vi', '城際特快', '')` → `'城際特快'`（回落 `typeZh`，非空、非 `undefined`）

### AC-08 跨午夜

- `durationLocalized('vi', '22:01', '00:24')` === `'2 giờ 23 phút'`（PASS）
- 整合驗證：AC-02 列表輸出中第 410 車次確實含 `2 giờ 23 phút` 字串。

### AC-09 en 四情境（完整列表輸出）

```
🚆 TRA 台北 → 台中（07/08）
Trains today after 08:00:

・No.124 Tze-Chiang Limited Express　08:10→10:05（1h55m）
・No.256 Local　08:30→09:47（1h17m）
・No.302 Chu-Kuang Express　09:00→11:30（2h30m）
・No.410 Local (Fast)　22:01→00:24（2h23m）

Source: Taiwan Railway (TRA) via MOTC PTX.
```

nextOnly：標頭 `🚆 Next train`，含 `departs 08:05, arrives 09:10`。
今日/明日已無班次：標頭皆為 `🚆 TRA`，句子分別為 `No more trains today.` / `No more trains tomorrow.`。四情境排除站名後皆無 CJK 殘留（本輪確認實作者已採用 PRD §3.1 建議，將 en 一併補成完整英文，非僅回歸不變）。

### AC-10 ja/th/id 回落

三語言各跑一次列表情境（同 AC-02 之 mock 資料），皆：不崩潰、輸出不含 `undefined`、排除站名後無 CJK 殘留（皆自然落到與 `en` 相同分支，標頭 `🚆 TRA`、車種英文）。

---

## 五、清理確認

- 暫存測試腳本（`ac01_golden.test.js`、`ac02_10.test.js`）與暫存的改動前模組副本（`pre/services/traTrain.js`、`pre/store.js`）均已從 scratchpad 刪除。
- 測試全程未寫入、未修改任何 `data/*.json`；`git status --porcelain -- data/` 測試前後皆為空輸出，無需還原步驟。
- 未修改 repo 內任何檔案（僅讀取 `src/services/traTrain.js` 與 `src/store.js` 供離線 require）。

---

## 六、結論

zh-TW 逐字不變（AC-01，最高優先回歸紅線）通過獨立 golden byte-identical 比對，**無任何字元差異**。vi/en 完整在地化、車種對照與回落、跨午夜行駛時間、ja/th/id 優雅回落等其餘 9 條驗收條件亦全數通過獨立驗證。

**最終判定：全 PASS，無需修改。**

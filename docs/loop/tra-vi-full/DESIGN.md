# DESIGN — 台鐵查詢結果越南語完整在地化（去除中文夾雜）

**版本** v1.0 | **日期** 2026-07-08 | **作者** 軟體架構師（RD#1）
**對應 PRD** `docs/loop/tra-vi-full/PRD.md`（本輪僅做 §3.1 主範圍）

> **次範圍延後聲明**：PRD §3.2（讓 AI 工具路徑 A `get_tra_train` → `getTraTrainSummary` 也走決定性格式器）**本輪明確不做**——本設計不動 `src/tools.js` 的 `get_tra_train` 契約、不動 `getTraTrainSummary`、不動任何 AI 呼叫路徑。Coder 請勿觸碰 tools.js。

---

## ✅ 需要金鑰：否

沿用既有 PTX 免金鑰端點與既有 LINE token；無新增外部 API、無新增環境變數、無新增相依套件。本輪不呼叫模型，零額外 Groq token 消耗。

---

## 〇、一句話總結

只改 `src/services/traTrain.js` 一個檔：把 `getTraTrainByIds` 內「不受 `code` 影響、寫死中文」的字串（列表標頭、下一班標頭、「之後的班次」句、車次計次詞、發車/抵達、資料來源行、車種名）全部改成「一律 by code 查表」，並新增純函式 `trainTypeLabel(code, typeZh, typeEn)` 做車種在地化（含帶括注變體的正規化與三層回落）。zh-TW 分支逐字不變、`code:'vi'` 變成完整越南語、`code:'en'` 順帶補成完整英文、ja/th/id 依既有 en 回落自然拿到英文。`SOURCE` 常數不動；handler.js 呼叫端因簽名不變、不需修改。

---

## 一、受影響檔案清單

| 檔案 | 動作 | 內容 |
|---|---|---|
| `src/services/traTrain.js` | **修改** | ①在既有 `WHEN_LABEL`/`NO_TRAINS` 小表區塊（約 62–94 行）後續加新在地化表：`HEADER_LIST`、`HEADER_NEXT`、`AFTER_LINE`、`NEXT_SEG`、`TRAIN_NO`、`SOURCE_LINE`、`TRAIN_TYPE_VI`。②新增純函式 `trainTypeLabel(code, typeZh, typeEn)` 與小的取值輔助 `pick(table, code)`。③重寫 `getTraTrainByIds`（約 610–667 行）的組字段落，改成三語同一路徑。④`module.exports` 增匯出 `trainTypeLabel`、`durationLocalized`（供離線測試純函式）。 |
| `src/handler.js` | **不改** | 唯一呼叫處在第 148 行 `traTrain.getTraTrainByIds({ ... code })`，函式**簽名與回傳型別（`Promise<string>`）皆不變**，不需修改。已實測確認：`src/handler.js:148` 是全 repo 唯一實際呼叫點（`tools.js:13` 只是 import、從未呼叫，屬未用 import，本輪不清理以縮小改動面）。 |
| `src/tools.js` | **不改** | 次範圍延後；`get_tra_train` / `getTraTrainSummary` 契約維持原狀。 |
| `src/lang.js` | **不改** | 本輪在地化字串放 `traTrain.js` 檔內小表（延續既有 `WHEN_LABEL`/`NO_TRAINS`/`durationLocalized` 的「本檔內表」慣例），不外擴到 `lang.js`。 |
| `src/store.js` | **不改** | `getTraTrainByIds` 無狀態，僅讀 `store.taipei()`，不寫 `data/*.json`。 |

> **決策：新字串放在 `traTrain.js` 檔內小表，而非 `lang.js`。** 理由：這些字串是 `getTraTrainByIds` 專屬的時刻表組字片語，且既有的同類字串（`WHEN_LABEL`/`NO_TRAINS`/`durationLocalized`）本來就放在本檔內；沿用同一慣例讓「時刻表在地化」單一真實來源集中在一處，回落規則（`table[code] || table.en`）也與既有函式一致，coder 不需跨檔追邏輯。

---

## 二、SOURCE 常數處理（不可改）

`SOURCE = '台鐵 TRA（交通部 PTX）'`（第 16 行）**維持不動**——`lookup()`（第 341 行）與 `nextTrain()`（第 394 行）中文指令路徑仍在用它，本輪不受影響。

`getTraTrainByIds` 不再直接內插 `SOURCE`，改為查 `SOURCE_LINE[code]`：
- zh-TW 分支的值以「反向引用 `SOURCE`」寫出，確保 zh-TW 輸出逐字不變、同時 `SOURCE` 本身零改動：`` `資料來源：${SOURCE}` ``。
- vi/en 各自組出**獨立的資料來源整行字串**（不沿用 `SOURCE` 的顯示字面）。en 沿用 `getTraTrainSummary` 既有措辭 `Source: Taiwan Railway (TRA) via MOTC PTX.`。

---

## 三、在地化字串表（延續既有「本檔小表 + by code 查表 + 回落 en」風格）

新增於既有 `durationLocalized`（第 94 行）之後。取值一律走輔助函式 `pick`（等同既有 `WHEN_LABEL[code] || WHEN_LABEL.en` 的回落規則）：

```js
// 依 code 取表值，未知語言回落 en（與既有 whenLabel/noTrainsText 回落規則一致）
function pick(table, code) {
  return table[code] || table.en;
}
```

### 3.1 純字串表

```js
// 列表標頭（列表模式：有班次／已無班次皆用）
const HEADER_LIST = {
  'zh-TW': '🚆 台鐵',
  vi:      '🚆 Tàu hỏa (TRA)',
  en:      '🚆 TRA',
};

// 下一班標頭（nextOnly 模式：有班次／已無班次皆用）
const HEADER_NEXT = {
  'zh-TW': '🚆 下一班',
  vi:      '🚆 Chuyến kế tiếp',
  en:      '🚆 Next train',
};

// 資料來源整行（zh-TW 反向引用 SOURCE 常數 → 逐字不變、SOURCE 零改動）
const SOURCE_LINE = {
  'zh-TW': `資料來源：${SOURCE}`,
  vi:      'Nguồn: Đường sắt Đài Loan (TRA) qua MOTC PTX.',
  en:      'Source: Taiwan Railway (TRA) via MOTC PTX.',
};
```

### 3.2 片語模板表（值為函式，與既有 `NO_TRAINS` 風格一致，因各語言語序不同）

```js
// 「之後的班次」整行；when 由 whenLabel(code, isTomorrow) 傳入、time = fromHm
const AFTER_LINE = {
  'zh-TW': (when, time) => `${when} ${time} 之後的班次：`,
  vi:      (when, time) => `Các chuyến ${when} sau ${time}:`,
  en:      (when, time) => `Trains ${when} after ${time}:`,
};

// nextOnly 有班次時的「發車/抵達」時間段
const NEXT_SEG = {
  'zh-TW': (dep, arr) => `${dep} 發車，${arr} 抵達`,
  vi:      (dep, arr) => `khởi hành ${dep}, đến ${arr}`,
  en:      (dep, arr) => `departs ${dep}, arrives ${arr}`,
};

// 車次計次詞
const TRAIN_NO = {
  'zh-TW': (no) => `${no}次`,
  vi:      (no) => `No.${no}`,
  en:      (no) => `No.${no}`,
};
```

> **zh-TW 逐字對齊檢查（逐項核對現況）**：
> - `HEADER_LIST['zh-TW']` = `'🚆 台鐵'` ← 現況第 650/662 行字面。
> - `HEADER_NEXT['zh-TW']` = `'🚆 下一班'` ← 現況第 636/642 行字面。
> - `AFTER_LINE['zh-TW'](when, time)` = `` `${when} ${time} 之後的班次：` `` ← 現況第 663 行 `` `${whenText} ${fromHm} 之後的班次：` `` （`whenText` 在 zh-TW = `whenZh`，見 §五）。
> - `NEXT_SEG['zh-TW'](dep, arr)` = `` `${dep} 發車，${arr} 抵達` `` ← 現況第 643 行（全形逗號「，」保留）。
> - `TRAIN_NO['zh-TW'](no)` = `` `${no}次` `` ← 現況第 643/656 行 `${t.trainNo}次`。
> - `SOURCE_LINE['zh-TW']` = `` `資料來源：${SOURCE}` `` ← 現況第 644/665 行。
> - 「已無班次」句沿用既有 `noTrainsText(code, isTomorrow)`，不新增（見 §五對 zh-TW 等價性的證明）。

### 3.3 越南語用字備註

vi 措辭為 PM 草案的收斂版（§四），**未鎖死逐字字面**，未來可請越南語母語者微調；驗收只鎖「同一基準車種永遠映射到同一個非中文、非空白的越南語字串」。全形括號／全形空格／`・`／`🚆` 等**非中文**，各語言沿用現有排版，不在「不得含中文」檢查範圍。

---

## 四、車種對照函式 `trainTypeLabel(code, typeZh, typeEn)`

### 4.1 簽章與回傳

```
trainTypeLabel(code: string, typeZh: string, typeEn: string): string
```
- 純函式、無副作用、可離線測試（匯出）。
- 永不回傳 `undefined`；只要 `typeZh` 或 `typeEn` 任一有值即非空（PTX 實務上 `typeZh` 恆有值）。

### 4.2 越南語對照表（簡潔標籤，專有名保留 + 視需要短括注）

以「有序陣列」實作，**更具體的關鍵字排在更一般的關鍵字之前**（關鍵：`區間快` 必須排在 `區間` 之前，否則 `區間快` 會被 `區間` 先命中）：

```js
// [基準關鍵字, 越南語標籤]；順序即優先序（具體 → 一般）
const TRAIN_TYPE_VI = [
  ['太魯閣', 'Tàu Taroko'],
  ['普悠瑪', 'Tàu Puyuma'],
  ['自強',   'Tàu Tự Cường'],
  ['莒光',   'Tàu Chu-Kuang'],
  ['復興',   'Tàu Phục Hưng'],
  ['區間快', 'Tàu địa phương nhanh'],
  ['區間',   'Tàu địa phương'],
  ['普快',   'Tàu thường'],
];
```

> 相對 PRD §4.2 草案，刻意把冗長的說明性括注收斂（時刻表一次列 5 筆，標籤過長會雜亂）：專有名（Tự Cường / Taroko / Puyuma / Chu-Kuang / Phục Hưng）保留，其餘用一個短形容詞（nhanh＝快、địa phương＝區間/地方、thường＝普通）。**最終用字交 coder 落實、可請母語者微調**。

### 4.3 正規化演算法（處理帶括注變體）

**一句話**：先取「第一個括號（半形 `(` 或全形 `（`）之前的主詞」作基準，去頭尾空白，再用「基準字串 `includes` 關鍵字」比對有序表；比不到就依序回落。

逐步：
1. `s = String(typeZh || '').trim()`。
2. **正規化基準**：`base = s.split(/[(（]/)[0].trim()`。取第一個左括號（半形/全形皆切）之前的字。
   - `'自強(3000)'` → `'自強'`
   - `'自強(推拉式自強號且無自行車車廂)'` → `'自強'`
   - `'普悠瑪(普悠瑪)'` → `'普悠瑪'`
   - `'區間車'`（無括號） → `'區間車'`
   - `'普快車'` → `'普快車'`
   - **邊界一：多層括注** `'自強((3000))'` → 切第一個括號前 → `'自強'`。
   - **邊界二：純括注／空字串** `'(3000)'` → `split` 得 `['', '3000)']` → `base = ''`（空 → 不會命中任何關鍵字 → 進回落）。
3. **查表**：`base` 非空時，依序走 `TRAIN_TYPE_VI`，第一個滿足 `base.includes(keyword)` 者即命中。
   - 用 `includes` 而非「完全相等」：讓 `'區間車'`（含「區間」）、`'普快車'`（含「普快」）也能歸類。
   - 具體先於一般的排序保證 `'區間快'` 命中 `Tàu địa phương nhanh`、`'區間車'` 命中 `Tàu địa phương`。
   - **邊界三：未知車種**（如虛構「城際特快」）→ 全表皆不 `includes` → 命中失敗 → 進回落。
4. **三層回落（依 `code` 決定基底語言）**：
   - `code === 'zh-TW'`：直接回 `typeZh`（維持現況：現行 zh-TW 用 `t.typeZh`，逐字不變）。
   - `code === 'vi'`：命中 → 回越南語標籤；否則回 `typeEn || typeZh`（先英文、再中文，永不空白）。
   - 其餘（`en`/`ja`/`th`/`id`/未知）：回 `typeEn || typeZh`（英文為主，回落中文）。

> 回落次序精確對應 PRD §4.2「1 對照 → 2 typeEn → 3 typeZh、永不空白／undefined」，且僅 vi 分支才查越南語表（en 等語言直接用 `typeEn`）。

### 4.4 與現況等價性（zh-TW 不變）

現況 zh-TW 車種取值為 `t.typeZh`（第 640/655 行）。`trainTypeLabel('zh-TW', t.typeZh, t.typeEn)` 直接回 `t.typeZh` → 完全等價。

---

## 五、重構 `getTraTrainByIds` 組字邏輯

### 5.1 核心改法：消除 `lc === 'zh-TW' ? A : B` 二分，一律 by code 查表

保留函式頂部不變的部分（第 610–631 行）：`lc = code || 'zh-TW'`、`store.taipei()`、`isTomorrow`/`date`/`fromHm`/`mmdd`、`fetchOdTrains` 抓取與 `ok:false` 的中文錯誤字串（`'目前無法取得台鐵時刻，請稍後再試 🙏'`——此為既有行為，**本輪不在地化**，維持現況）、`filterAndSort`。

移除：區域變數 `whenZh`（第 617 行，改為統一走 `whenLabel(lc, isTomorrow)`）。

`when`（今天/明天字樣）一律用既有 `whenLabel(lc, isTomorrow)`：
- **等價性證明**：`whenLabel('zh-TW', false)` = `WHEN_LABEL['zh-TW'].today` = `'今天'` = 現況 `whenZh`；tomorrow 同理 `'明天'`。故以 `whenLabel(lc, …)` 取代現況 `whenZh` 與 `whenText` 的 zh-TW 分支，zh-TW 輸出逐字不變。

「已無班次」句一律用既有 `noTrainsText(lc, isTomorrow)`：
- **等價性證明**：現況 zh-TW 用 `` `${whenZh}已無班次` ``；`noTrainsText('zh-TW', false)` = `NO_TRAINS['zh-TW']('今天')` = `'今天已無班次'`，與 `` `${whenZh}已無班次` `` 逐字相同。故兩分支可合一。

### 5.2 四種輸出情境的組字模板（三語共用同一路徑）

先算每筆班次行（列表模式與 nextOnly 模式的車種/車次用同一組 helper）：

```
typeName  = trainTypeLabel(lc, t.typeZh, t.typeEn)
noLabel   = pick(TRAIN_NO, lc)(t.trainNo)
dur       = durationLocalized(lc, t.departure, t.arrival)   // 既有函式，不改
```

**情境 A：列表模式、有班次**（對應現況第 654–666 行）

```
`${pick(HEADER_LIST, lc)} ${fromName} → ${toName}（${mmdd}）\n` +
`${pick(AFTER_LINE, lc)(whenLabel(lc, isTomorrow), fromHm)}\n\n` +
lines.join('\n') + '\n\n' +
pick(SOURCE_LINE, lc)
```
其中每筆 `line`：
```
`・${noLabel} ${typeName}　${t.departure}→${t.arrival}（${dur}）`
```
- zh-TW 代入後 = `` `・${t.trainNo}次 ${t.typeZh}　${t.departure}→${t.arrival}（${duration(...)})` `` → 與現況第 656 行逐字相同（全形空格「　」、全形括號、`→` 保留）。

**情境 B：nextOnly 模式、有班次**（對應現況第 641–645 行；**標頭含 `（${mmdd}）`**）

```
`${pick(HEADER_NEXT, lc)} ${fromName} → ${toName}（${mmdd}）\n` +
`・${noLabel} ${typeName}　${pick(NEXT_SEG, lc)(t.departure, t.arrival)}（${dur}）\n\n` +
pick(SOURCE_LINE, lc)
```
- zh-TW 代入後 = `` `🚆 下一班 … （${mmdd}）\n・${t.trainNo}次 ${t.typeZh}　${dep} 發車，${arr} 抵達（${dur}）\n\n資料來源：${SOURCE}` `` → 與現況逐字相同。

**情境 C：列表模式、今日/明日已無班次**（對應現況第 648–652 行；**標頭含 `（${mmdd}）`**）

```
`${pick(HEADER_LIST, lc)} ${fromName} → ${toName}（${mmdd}）\n` +
noTrainsText(lc, isTomorrow)
```
- zh-TW 代入後 = `` `🚆 台鐵 … （${mmdd}）\n今天已無班次` `` → 與現況逐字相同。

**情境 D：nextOnly 模式、今日/明日已無班次**（對應現況第 634–638 行；**標頭不含 `（${mmdd}）`**——刻意保留現況差異）

```
`${pick(HEADER_NEXT, lc)} ${fromName} → ${toName}\n` +
noTrainsText(lc, isTomorrow)
```
- zh-TW 代入後 = `` `🚆 下一班 …\n今天已無班次` `` → 與現況逐字相同。

> **易踩雷點（給 coder）**：唯獨情境 D 的標頭**不帶 `（${mmdd}）`**，其餘三種都帶。這是現況既有的不對稱，務必原樣保留，否則 AC-01 逐字比對會失敗。

### 5.3 站名維持中文（明確排除翻譯與別名）

`fromName`/`toName` 直接內插，**不翻譯、不加越南語別名附註**（PRD §4.3、§3.3 決策）。nice-to-have 的「Đài Bắc (台北)」式別名本輪**不做**——coder 請勿自作主張加註，以免超出驗收範圍並增加畫面雜訊。

---

## 六、匯出調整

`module.exports`（第 670–688 行）**新增兩個純函式供離線測試**，其餘不動：

```
trainTypeLabel,      // 車種對照（AC-06/AC-07 直接測）
durationLocalized,   // 行駛時間在地化（AC-08 直接測；目前未匯出）
```

（`getTraTrainByIds` 已在匯出清單；不新增其他 API。）

---

## 七、端到端流程（路徑 B，不變）

```
使用者用越南語問台鐵 → 系統跳「您是指哪一站？」→ 使用者點按鈕選站
 → handler.js:137 traChoice.matchCandidate 命中
 → handler.js:147 code = await lang.resolve(userId)   // 得 'vi'
 → handler.js:148 traTrain.getTraTrainByIds({ fromId, toId, fromName, toName, nextOnly, day, code:'vi' })
 → fetchOdTrains（快取/PTX）→ filterAndSort
 → 依 code 走情境 A/B/C/D 組字（全部 by code 查表）→ 回完整越南語字串 → LINE
```
路由、狀態機、pending 攔截、快取/逾時/排序/最多 5 筆/跨午夜計算**皆不變**。

---

## 八、測試策略（對應 AC-01～AC-10；AC-11/12 屬次範圍，本輪不含）

### 8.1 測試紀律（本專案鐵律）

- 不 `require index.js`、不呼叫 `.start()`、腳本結尾 `process.exit(0)`。
- 不發真實 LINE 訊息。
- **完全不碰 `data/`**：測試一律**直接傳 `code` 參數**給 `getTraTrainByIds`，不經 `lang.resolve()`，故不觸發 `data/lang.json`。
- 全部變更檔案 `node --check` 通過。

### 8.2 離線化手法（不真打 PTX、不碰 data/）

`getTraTrainByIds` 內部呼叫全域 `fetch` 與 `store.taipei()`。測試前置：

1. **固定時鐘**：`const store = require('../src/store'); store.taipei = () => ({ date: '2026-07-08', hm: '08:00' });`（`traTrain` 與測試共用同一 `store` 單例，覆寫 `taipei` 即生效；避免真實時間影響過濾，也不碰 data/）。
2. **stub `global.fetch`**：回一個 `{ ok: true, json: async () => ({ TrainTimetables: [...] }) }` 的假 Response，`TrainTimetables` 用自建 mock 班次陣列（含 §八各 AC 所需車種與時間）。發車時間設 `>= '08:00'`（如 `'08:30'`、`'22:01'`）確保通過 `filterAndSort`；「已無班次」情境則給空陣列或發車時間 `< '08:00'`。
3. 每個 case 用**不同 `fromId`/`toId`** 避免 30 分鐘記憶體快取互相污染（快取 key = `起-迄-日期`）。
4. **可完全繞過 fetch 的部分**：`trainTypeLabel`、`durationLocalized` 是純函式，直接呼叫即可（AC-06/07/08 主驗證走這條，最穩定）。

### 8.3 AC-01 zh-TW 逐字不變（最高優先，設計層保證 + 測試層驗證）

**設計層保證**：§三與§五已逐項證明每個 zh-TW 表值／模板代入後等於現況字面（含全形空格「　」、全形逗號「，」、全形括號「（）」、`→`、`次`、`資料來源：${SOURCE}`、情境 D 不帶 mmdd 的不對稱）。

**測試層驗證（golden string 比對法）**：
1. **改動前**：先 `git stash` 或在乾淨工作區用**現版** `traTrain.js` 跑一支腳本，對四種情境（列表有班次／nextOnly 有班次／今日已無班次／明日已無班次）各以 `code` 缺省與 `code:'zh-TW'` 兩種呼叫，把輸出字串存成 golden（可 `JSON.stringify` 後寫入 scratchpad，或直接 console 貼進測試常數）。
2. **改動後**：同一組 mock 與同一固定時鐘再跑一次，對每個情境 `assert(output === golden)`（byte-identical，一個字元都不能差）。
3. 兩次都必須用**相同 mock 班次陣列與相同 `store.taipei()` 覆寫值**，否則比對不公平。

### 8.4 逐條 AC 對照

| AC | 情境 | 測法（離線） |
|---|---|---|
| AC-01 | zh-TW 四情境逐字不變 | 見 §8.3 golden 比對；`code` 缺省與 `'zh-TW'` 兩路都要比 |
| AC-02 | `code:'vi'` 列表（≤5 筆）| 斷言含 vi 標頭、vi「之後的班次」句、每筆非中文車次詞（`No.`/`Số`）、vi 車種、`→` 時間段、vi 行駛時間（`X giờ Y phút`）、vi 資料來源行；**無中文殘留掃描**見 §8.5 |
| AC-03 | `code:'vi'`、`nextOnly:true`、1 筆 | 斷言 vi 下一班標頭、vi「發車/抵達」對應詞（`khởi hành`/`đến`）；無中文殘留掃描 |
| AC-04 | `code:'vi'`、`day:'today'`、無班次 | 斷言標頭亦為 vi（`🚆 Tàu hỏa (TRA)`），且含 `noTrainsText('vi', false)` 既定輸出（`Không còn chuyến tàu nào hôm nay.`）；無中文殘留掃描 |
| AC-05 | `code:'vi'`、`day:'tomorrow'`、無班次 | 同 AC-04，含 `ngày mai`（`noTrainsText('vi', true)`）；無中文殘留掃描 |
| AC-06 | 車種對照一致性 | 直接呼叫 `trainTypeLabel('vi', typeZh, typeEn)`：涵蓋 8 個基準（自強/太魯閣/普悠瑪/莒光/復興/區間快/區間/普快）＋至少 2 組變體（`'自強(3000)'` vs `'自強(推拉式自強號且無自行車車廂)'`、`'普悠瑪'` vs `'普悠瑪(普悠瑪)'`）→ 斷言同基準所有變體回相同字串、非空、非 `typeZh` 原樣 |
| AC-07 | 車種缺漏回落 | `trainTypeLabel('vi', '城際特快', 'InterCity')` → `'InterCity'`（回落 typeEn）；`trainTypeLabel('vi', '城際特快', '')`（或不給 typeEn）→ `'城際特快'`（回落 typeZh）；兩者皆非空、非 undefined |
| AC-08 | 跨午夜行駛時間 | `durationLocalized('vi', '22:01', '00:24') === '2 giờ 23 phút'`；並可整段組字驗證該筆班次行含此字串 |
| AC-09 | `code:'en'` 四情境 | 跑與 AC-02 相同的「無中文殘留」規則（採用 §3.1 建議修正）：標頭、車次詞（`No.`）、發車抵達（`departs`/`arrives`）、資料來源（`Source: Taiwan Railway (TRA) via MOTC PTX.`）皆英文；車種為 `typeEn` |
| AC-10 | `code:'ja'`／`'th'`／`'id'` 各一列表情境 | 走 en 回落分支，斷言：無崩潰、無 `undefined`、不停留在殘留中文（除站名外無 CJK）；不要求特定語言完整在地化 |

### 8.5 「無中文殘留」掃描（排除站名 token）

1. 站名用固定 mock（如 `fromName:'台北'`、`toName:'台中'`），且 mock 班次不使用會落到 `typeZh` 回落的未知車種（AC-02/03/09 全用已知車種，車種輸出無中文）。
2. 掃描前先剔除站名 token：`const scan = out.split(fromName).join('').split(toName).join('');`
3. 對 `scan` 跑 CJK 表意文字正則：`assert(!/[一-鿿]/.test(scan))`。
4. 僅檢查 CJK 漢字本身；`🚆`、`・`、`（）`、`　`、`→`、`：` 等符號/標點不算中文，不需剔除（正則不會命中）。

### 8.6 收尾

- `node --check src/services/traTrain.js` 通過。
- 測試腳本 `process.exit(0)`。

---

## 九、風險與取捨

1. **車種對照缺漏／PTX 改名**：以 `includes` + 有序表 + 三層回落吸收；未知車種優雅回落 `typeEn`（英文，不崩、不殘留為程式錯誤）。已由 AC-07 覆蓋。取捨：`includes` 比「完全相等」寬鬆，理論上若未來出現「非該系列卻含相同關鍵字」的新車種可能誤命中，但以現行台鐵車種命名體系（基準詞不互相包含）風險極低；且排序把具體詞（區間快）置於一般詞（區間）之前，杜絕最可能的誤命中。
2. **越南語用字未經母語者定稿**：本輪交付「結構正確、簡潔、無中文殘留」的可用版本；驗收不鎖逐字字面，字串集中在 `TRAIN_TYPE_VI`/`SOURCE_LINE`/`AFTER_LINE`/`NEXT_SEG` 便於日後一處微調。
3. **zh-TW 回歸風險**：最大風險是「搬字串時手滑改到全形/半形或情境 D 的 mmdd 不對稱」。緩解：§8.3 golden byte-identical 比對強制把關；§三、§五已逐項標注現況字面來源行號。
4. **ja/th/id 順帶英文化**：這三語走 en 回落，會從「殘留中文」變成英文，屬 PRD 允許的「順帶受益、不得變差」。AC-10 僅要求不崩潰、無中文殘留，不要求完整在地化。
5. **次範圍未動**：路徑 A（AI 工具）仍靠模型改寫、仍耗 Groq token、仍有非決定性殘留風險——這是本輪**刻意的範圍取捨**（PRD §七建議分兩輪）。已於文件開頭聲明，避免 coder 誤觸 tools.js。
6. **不動查詢邏輯**：快取（30 分）、逾時（6 秒）、排序、最多 5 筆、跨午夜計算、`fetchOdTrains` 抓取失敗的中文錯誤字串一律不改，降低回歸面。

---

## 十、實作檢核清單（給工程師 RD#2）

- [ ] `traTrain.js`：在 `durationLocalized` 後新增 `pick`、`HEADER_LIST`、`HEADER_NEXT`、`SOURCE_LINE`、`AFTER_LINE`、`NEXT_SEG`、`TRAIN_NO`、`TRAIN_TYPE_VI`、`trainTypeLabel`。
- [ ] `trainTypeLabel`：實作 §4.3 正規化（取第一個 `(`／`（` 前主詞）+ `includes` 有序比對 + 三層回落（vi→typeEn→typeZh）。
- [ ] 重寫 `getTraTrainByIds` 組字段落為四情境 by code 模板（§5.2）；移除 `whenZh`；標頭/次/發車抵達/之後的班次/資料來源/車種全部查表。
- [ ] **保留情境 D 標頭不帶 `（${mmdd}）` 的不對稱**。
- [ ] `SOURCE` 常數與 `lookup`/`nextTrain` 一字不改。
- [ ] `module.exports` 增 `trainTypeLabel`、`durationLocalized`。
- [ ] **不改** handler.js / tools.js / lang.js / store.js。
- [ ] 自測：AC-01 golden 逐字比對（改動前先存 golden）、AC-02～05 vi 無中文殘留、AC-06/07 車種對照、AC-08 跨午夜、AC-09 en、AC-10 ja/th/id 回落；`node --check` 通過。

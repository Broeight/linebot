# DESIGN — ⏰ 提醒週期補完（每週／每月）＋ 刪除單筆提醒

> RD#1（架構師）技術設計，對應 `docs/loop/recurring-reminder/PRD.md`。
> 唯讀既有原始碼；本文只描述「要改哪些檔、介面、資料結構、流程、測試」，不含實作碼。
> 硬性約束：CommonJS（require/module.exports）、服務放 `src/services/`、指令走 `handler.js` 路由、
> **不得破壞 `tick()` 既有 P0 併發模式（防重入＋fired 陣列＋reload-before-save 依 id 套用）**。

---

## 0. 受影響檔案清單（3 檔，皆為擴充；不新增檔）

| 檔案 | 變更性質 | 摘要 |
|---|---|---|
| `src/services/reminder.js` | **主戰場**：擴充 | `taipeiParts()` 擴充；`parse()` prompt 擴充；`add()`／`addParsed()` 加 weekly/monthly 分支；`tick()` 判斷式擴充（`firedDaily`→`firedRepeat`）；`list()` 顯示擴充；新增 `removeByIndex()`；新增內部 helper `toWeekdayNum`／`listable`／`describeWhen`；匯出加 `removeByIndex`、`tick`、`taipeiParts`（測試縫） |
| `src/tools.js` | 擴充 | `set_reminder` schema 的 `type` enum 加 `weekly`/`monthly`＋新增 `weekday`/`day_of_month`/`time` 參數；`run()` 的 `set_reminder` case 多傳這三個參數 |
| `src/handler.js` | 擴充（1 條 route） | 在「提醒」區塊新增「刪除提醒 N」單筆刪除 route |

**明確不動：**
- `src/store.js`：`reminders.json` 已在 `KNOWN_KEYS` 內（第 13–18 行已核實），不新增資料檔、不改 `store.js`。
- `src/lang.js`：PRD 決策 5「本輪不做 reminder.js 多語化」；weekly/monthly 的中文顯示與確認字串硬編在 `reminder.js`（與既有 daily/once 同慣例），AI 工具層的英文 `when` 描述在 `reminder.js`/`tools.js`，皆不經 `lang.js`。核實無其他檔需動（`index.js` 已呼叫 `reminder.start()`，`tick()` 改成帶預設參數的簽名向後相容，不需改 `index.js`）。

---

## 1. 資料模型定案（PRD F1）

沿用同一份 `data/reminders.json`。新增兩種 `type`，欄位各自獨立（不共用 `dailyTime`）：

```
weekly ：{ id, userId, type:'weekly',  weekday:0-6, time:'HH:mm', message, lastFired:'' }
monthly：{ id, userId, type:'monthly', dayOfMonth:1-31, time:'HH:mm', message, lastFired:'' }
```

**時刻欄位定案：新開 `time`，不沿用 `dailyTime`。**
理由：`dailyTime` 語意是「每天的時刻」，套在 weekly/monthly 上會誤導；三種 type 各自欄位獨立，`tick()` 就能維持「每個 type 一條簡單條件」的既有寫法風格，也完全不碰正在運作中的喝水提醒（`daily`＋`tag:'water'`）與既有 `dailyTime` 資料。付出的代價只是多一個欄位名，換來可讀性與零回歸，值得。

**舊資料相容：** 既有 `once`（有 `fireAt`）與 `daily`（有 `dailyTime`）完全不加新欄位、讀取/顯示/觸發不變。`weekly`/`monthly` 的新欄位對舊資料為「不存在」，而 `tick()`／`list()` 都以 `r.type === 'weekly'`／`'monthly'` 精確分支進入，舊資料永遠不會命中新分支（見 §4、§7）。

---

## 2. weekday 映射定案（高風險細節）

### 2.1 內部儲存：數字 `0-6`，`0=Sunday`（JS `Date.getDay()`／`getUTCDay()` 慣例）

理由：`taipeiParts()` 用 `getUTCDay()` 算出的星期天然就是 0=Sun，存同一套讓 `tick()` 判斷式是最單純的 `now.weekday === r.weekday`，無需任何轉換。

### 2.2 兩個入口一律用「英文星期名字串」，伺服器端用單一 normalizer 轉數字

- **AI 工具 schema（`set_reminder`）**：`weekday` 用字串 enum `['sunday','monday','tuesday','wednesday','thursday','friday','saturday']`，讓模型「傳名字」而非「傳數字」。
- **`parse()` 的 askJSON 輸出**：同樣要模型輸出英文星期名（例 `"weekday":"wednesday"`）。
- **單一轉換 helper**（reminder.js 內）：

```
toWeekdayNum(v) → 0-6 或 null
  接受：整數 0-6；英文全名（不分大小寫）sunday..saturday；三字縮寫 sun..sat；純數字字串 "0".."6"
  無法辨識 → null（防呆：即使模型誤傳數字或縮寫也能救回）
```

**定案理由：** llama 級模型在「星期三對應數字幾」這種「數字↔語意」映射最容易錯（到底 0 是週日還是週一），字串 enum 讓模型只做「星期三→wednesday」的純翻譯，錯誤率遠低於背數字慣例；token 增量僅約 7 個英文字，可接受。兩個入口統一用「名字」→ **只有一種心智模型、只有一個轉換函式（單一真實來源）**，而內部存數字讓 `tick()` 比較維持 O(1) 整數相等。`toWeekdayNum` 兼收數字/縮寫，是額外防呆。

> 註：任務簡報的 `parse()` 範例是 `"weekday":3`（數字）。此處我改採「名字」以與 schema 一致、並降低 parse 這條同樣是 llama 解析的路徑出錯率——這是本設計的定案（PRD F1 允許 DESIGN 定案欄位表示法）。

### 2.3 星期數字→中文顯示小表（list／確認訊息用）

```
WD_ZH = ['日','一','二','三','四','五','六']   // index = weekday 0-6
每週 + WD_ZH[weekday]  →「每週三」
```

### 2.4 星期數字→英文顯示小表（AI 工具 when 描述用）

```
WD_EN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
```

---

## 3. `taipeiParts()` 擴充（不得用伺服器本地時區）

現況只回 `{ date, hm }`。擴充為回 `{ date, hm, weekday, day, daysInMonth }`：

- `weekday`（0-6，台北）：由台北日期字串推導，**避免伺服器本地時區**——
  `new Date(`${date}T12:00:00+08:00`).getUTCDay()`。
  （取台北當天中午 = 04:00 UTC 同一日曆日，`getUTCDay()` 即為台北該日的星期。）
- `day`（1-31，台北當日）：`Number(p.day)`。
- `daysInMonth`（台北當月天數）：以 UTC 建構避免本地時區——
  `new Date(Date.UTC(year, month, 0)).getUTCDate()`（`month` 為 `formatToParts` 得到的 1-based 月份；`Date.UTC(y, m, 0)` = 下個月第 0 天 = 當月最後一天）。

**向後相容：** 既有呼叫端（`parse()`、`tick()`、`store.taipei()` 為另一支）只用 `.date`／`.hm`，新增欄位不影響。

---

## 4. 觸發判斷式（PRD F2）— 在既有 P0 模式內擴充

`tick()` 目前用兩個陣列 `firedOnce` / `firedDaily`，觸發後 reload-before-save 依 id 套用。**擴充方式：把 `firedDaily` 更名為 `firedRepeat`，收 daily/weekly/monthly 三種「已送」的 id（統一設 `lastFired = now.date`）；`firedOnce`（刪除路徑）不動。** 判斷式各自一條分支：

```
once   ：r.type==='once'    && r.fireAt <= nowMs                                   → firedOnce
daily  ：r.type==='daily'   && r.dailyTime === now.hm && r.lastFired !== now.date  → firedRepeat  （逐字不變）
weekly ：r.type==='weekly'  && now.weekday === r.weekday && r.time === now.hm && r.lastFired !== now.date → firedRepeat
monthly：r.type==='monthly' && now.day === Math.min(r.dayOfMonth, now.daysInMonth) && r.time === now.hm && r.lastFired !== now.date → firedRepeat
```

**reload-before-save 收尾（沿用 P0，僅把 `firedDaily` 換成 `firedRepeat`）：**

```
if (firedOnce.length || firedRepeat.length) {
  const fresh = load()
    .filter(r => !firedOnce.includes(r.id))                                   // once：刪除
    .map(r => firedRepeat.includes(r.id) ? { ...r, lastFired: now.date } : r); // daily/weekly/monthly：標記已送
  save(fresh);
}
```

此收尾語意與現況逐字相同（daily 仍是設 `lastFired=now.date`），只是納入 weekly/monthly 的 id。**P0 三要件（`ticking` 防重入、fired 陣列、reload 後依 id 套用）完全不動。**

### 4.1 monthly clamp 判斷式一行（驗證 PRD 驗收 2 全部邊界）

```
now.day === Math.min(r.dayOfMonth, now.daysInMonth) && r.time === now.hm && r.lastFired !== now.date
```

| 情境 | effectiveDay = min(dayOfMonth, daysInMonth) | 觸發日 | 說明 |
|---|---|---|---|
| 5 號，一般月（31 天） | min(5,31)=5 | 5 號一次 | 其餘日 `now.day!==5` 不觸發 ✓ |
| 31 號遇 2 月（28 天） | min(31,28)=28 | 2/28 一次 | 2/27 `27!==28` 不觸發；2/28 觸發後 `lastFired='YYYY-02-28'` ✓ |
| 30 號遇 2 月 | min(30,28)=28 | 2/28 一次 | 同上 ✓ |
| 31 號遇 4 月（30 天） | min(31,30)=30 | 4/30 一次 | ✓ |
| 3 月（31 天，31 號）28 號不誤觸發 | min(31,31)=31 | 3/31 | 3/28 時 effectiveDay=31，`28!==31` 不觸發 ✓ |
| 跨月再觸發 | — | 3/31 | `lastFired` 是舊月份日期（如 `2026-02-28`）≠ `2026-03-31`，自然失效、可再觸發 ✓ |

**同一天去重**：命中觸發後 `lastFired` 被設成 `now.date`；同一天內（30 秒輪詢）再進來 `r.lastFired === now.date` → 不重推（weekly/monthly 與 daily 同一條去重路徑）。

**宕機語意**：weekly/monthly 沿用 daily「當次沒開機就略過、等下週期」，不補送（PRD 決策 6）。

---

## 5. 沒講時刻的預設定案（PRD AC-7）

**定案：weekly／monthly 未指定時刻一律用 `09:00`。** 只影響 weekly/monthly；daily/once 行為完全不變（AC-4 不回歸）。

理由：家庭情境「每月5號 繳房租」「每週三 倒垃圾」很自然會省略時刻，若回 `ok:false` 逼使用者補時刻（尤其長輩）體驗差；`09:00` 是家事/繳費類提醒合理的早晨預設；把「未指定→09:00」寫成**明確規則**可避免模型自己亂編時刻。

**兩條路徑都要寫死：**
- `parse()` prompt：「未指定時刻一律用 `"09:00"`」。
- `set_reminder` schema `time` 的 description：「未指定用 `"09:00"`」。
- **程式端防呆**：`add()`／`addParsed()` 對 weekly/monthly 若 `time` 缺漏或格式不符 → 一律套 `09:00`（即使模型忘了填也成功新增）。

---

## 6. `parse()` prompt 擴充（完整新 system prompt）

在既有 prompt 上加 weekly/monthly 輸出格式與規則，保持精簡（這是每次設提醒都花的 token）：

```
你是提醒解析助理。現在台北時間是 {now.date} {now.hm}（星期以台北為準）。
使用者會用自然語言設定提醒，請只輸出 JSON：
- 一次性：{"ok":true,"type":"once","datetime":"YYYY-MM-DD HH:mm","message":"提醒內容"}
- 每天：{"ok":true,"type":"daily","dailyTime":"HH:mm","message":"提醒內容"}
- 每週：{"ok":true,"type":"weekly","weekday":"wednesday","time":"HH:mm","message":"提醒內容"}
- 每月：{"ok":true,"type":"monthly","dayOfMonth":5,"time":"HH:mm","message":"提醒內容"}
- 無法判斷：{"ok":false}
規則：出現「每週/每星期/每禮拜」用 weekly；「每月/每個月」用 monthly；「每天/每日」用 daily；否則 once。
weekday 用英文小寫（sunday/monday/tuesday/wednesday/thursday/friday/saturday）；
週日/星期日/禮拜日=sunday，週三/星期三/禮拜三=wednesday，其餘同理。
dayOfMonth 是 1-31 的數字。未指定時刻一律用 "09:00"。
once 的 datetime 要用現在時間推算成未來時間。message 只保留事項本身，不含時間詞。
```

要點：`週三／星期三／禮拜三 → wednesday` 明講；星期用英文名（與 §2、schema 一致，走同一個 `toWeekdayNum`）。

---

## 7. `add()`（關鍵字路徑）擴充

現有結構：`parse()` → daily 分支 → once fallback。**在 daily 分支後、once fallback 前插入 weekly/monthly 兩個分支**（once fallback 逐字不動）：

```
（daily 分支：逐字不變）

if (r.type === 'weekly') {
  const wd = toWeekdayNum(r.weekday);
  if (wd === null) return （看不懂錯誤句，沿用既有那句）;
  const hm = normHM(r.time) || '09:00';        // normHM 沿用既有；缺/壞 → 09:00
  list.push({ id, userId, type:'weekly', weekday:wd, time:hm, message:r.message, lastFired:'' });
  save(list);
  return `✅ 好的，每週${WD_ZH[wd]} ${hm} 我會提醒你：「${r.message}」`;
}
if (r.type === 'monthly') {
  const d = Number(r.dayOfMonth);
  if (!Number.isInteger(d) || d < 1 || d > 31) return （看不懂錯誤句）;
  const hm = normHM(r.time) || '09:00';
  list.push({ id, userId, type:'monthly', dayOfMonth:d, time:hm, message:r.message, lastFired:'' });
  save(list);
  return `✅ 好的，每月${d}號 ${hm} 我會提醒你：「${r.message}」`;
}

（once fallback：逐字不變）
```

**確認訊息（中文，PRD F6）**：
- weekly：`✅ 好的，每週三 19:00 我會提醒你：「倒垃圾」`
- monthly：`✅ 好的，每月5號 09:00 我會提醒你：「繳房租」`
- once/daily 確認**逐字不變**。

---

## 8. `addParsed()` 擴充（AI 工具路徑）

現有結構：daily 分支 → once fallback。加 weekly/monthly（回 `{ok, when}`，`when` 用英文供模型轉譯）：

```
if (p.type === 'weekly') {
  const wd = toWeekdayNum(p.weekday);
  if (wd === null) return { ok:false };
  const hm = normHM(p.time) || '09:00';
  list.push({ id, userId, type:'weekly', weekday:wd, time:hm, message:p.message, lastFired:'' });
  save(list);
  return { ok:true, when:`every ${WD_EN[wd]} ${hm}` };          // "every Wednesday 19:00"
}
if (p.type === 'monthly') {
  const d = Number(p.dayOfMonth);
  if (!Number.isInteger(d) || d < 1 || d > 31) return { ok:false };
  const hm = normHM(p.time) || '09:00';
  list.push({ id, userId, type:'monthly', dayOfMonth:d, time:hm, message:p.message, lastFired:'' });
  save(list);
  return { ok:true, when:`every month on day ${d}, ${hm}` };     // "every month on day 5, 09:00"
}
```

daily/once 分支逐字不動（AC-4）。驗證失敗一律 `{ ok:false }`（模型端會收到既有 `run()` 的 "Could not understand the time" 句，不變）。

---

## 9. `set_reminder` schema 擴充（tools.js）

`parameters.properties` 新版（token 增量控制在最小、description 精煉）：

```
type:         { type:'string', enum:['once','daily','weekly','monthly'],
                description:'once=一次；daily=每天；weekly=每週固定星期；monthly=每月固定日期' }
datetime:     { type:'string', description:'type=once：依背景台北現在時間推算成 "YYYY-MM-DD HH:mm"' }
daily_time:   { type:'string', description:'type=daily：每天幾點，"HH:mm"' }
weekday:      { type:'string', enum:['sunday','monday','tuesday','wednesday','thursday','friday','saturday'],
                description:'type=weekly：星期幾（英文小寫）' }
day_of_month: { type:'number', description:'type=monthly：每月幾號，1-31 整數' }
time:         { type:'string', description:'type=weekly 或 monthly：幾點，"HH:mm"；未指定用 "09:00"' }
message:      { type:'string', description:'要提醒的事項，用使用者自己的語言' }
```

`required: ['type', 'message']`（不變）。function 頂層 description 尾端可加一句「支援一次性/每天/每週/每月」。

**`run()` 的 `set_reminder` case**：多傳三個新參數給 `addParsed`（回傳文字模板 `Reminder saved (${r.when}): ${a.message}` 不變）：

```
reminder.addParsed(userId, {
  type: a.type, datetime: a.datetime, dailyTime: a.daily_time,
  weekday: a.weekday, dayOfMonth: a.day_of_month, time: a.time,
  message: a.message,
});
```

`list_reminders` 工具不動（已涵蓋查詢）。刪除單筆**不**加 AI 工具（PRD 決策 4）。

---

## 10. `list()` 顯示擴充（PRD F6／F9）

把現有的 `when` 三元運算抽成內部 helper `describeWhen(r)`，**daily／once 分支輸出逐字不變**：

```
describeWhen(r):
  daily   → `每天 ${r.dailyTime}`                                              // 逐字不變
  weekly  → `每週${WD_ZH[r.weekday]} ${r.time}`                                //「每週三 19:00」
  monthly → `每月${r.dayOfMonth}號 ${r.time}`                                  //「每月5號 09:00」
  else(once) → new Date(r.fireAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}) // 逐字不變
```

- 分支順序：daily → weekly → monthly → else(once)。once 沒有 type 檢查、落在 else，與現況相同。
- `list()` 其餘（`⏰ 你的提醒：` 標頭、`💧 喝水提醒：開啟中`、`輸入「清除提醒」可全部刪除。`、編號 `${i+1}.`、`｜` 分隔）**全部不變**。四型別顯示範例：
  ```
  1. 07-25 15:00｜回診
  2. 每天 08:00｜吃藥
  3. 每週三 19:00｜倒垃圾
  4. 每月5號 09:00｜繳房租
  ```

**編號來源與刪除共用同一個過濾/排序**：抽出 helper `listable(userId, all=load())`：

```
listable(userId, all) → all.filter(r => r.userId === userId && !r.tag)   // 插入順序，即檔案順序
```

`list()` 用它產生編號，`removeByIndex()` 用它解析編號 → **編號永遠對得上**（PRD F3「即時重算、不快取」）。

---

## 11. `removeByIndex()`（reminder.js 新函式）＋「刪除提醒 N」route（handler.js）

### 11.1 reminder.js：`removeByIndex(userId, n)`

```
removeByIndex(userId, n) → string（回覆訊息）
  all  = load()
  mine = listable(userId, all)                 // 與 list() 同一過濾/排序（1-based）
  if (!Number.isInteger(n) || n < 1 || n > mine.length)
       return 「找不到編號的提醒」錯誤句（見下）
  target = mine[n-1]
  save(all.filter(r => r.id !== target.id))     // 依 id 精準刪一筆，不動別人/別筆
  return `🗑 已刪除提醒：${describeWhen(target)}｜${target.message}`
```

- 成功：`🗑 已刪除提醒：每週三 19:00｜倒垃圾`
- 失敗（超範圍或 `n` 為 null／非數字）：`找不到編號 ${n} 的提醒，請先輸入「提醒清單」確認編號。`
  （`n` 為 null 時省略數字，改成引導句，例：`請輸入「刪除提醒 編號」，例如「刪除提醒 2」。先輸入「提醒清單」可看編號。`）
- tag 提醒（喝水）不在 `listable` 內 → 不進編號、也不會被任何 `刪除提醒 N` 刪到（AC-3）。

### 11.2 handler.js：route 插入位置與正則（**核實過的路由陷阱**）

**現況路由核實（修正任務簡報的假設）：** 現有第 198–206 行：
```
if (trimmed === '提醒清單' || trimmed === '我的提醒') …      // 精確
if (trimmed === '清除提醒' || trimmed === '刪除提醒' || trimmed === '提醒清除') …  // 精確全刪
if (/^提醒/.test(trimmed)) …                                  // 前綴 → add()
```
對輸入「刪除提醒 3」：三條全 false。特別注意 **`/^提醒/.test('刪除提醒 3')` 為 `false`**——字串以「刪」開頭、非「提」，故**不會**進 `/^提醒/ → add()`（任務簡報說會 fallthrough 進 add 並不正確）。實際上它會穿過整個提醒區塊，一路 fallthrough 到 `handleText` 底部的 **AI 對話 fallback**（第 477+ 行），由模型亂猜——這正是要避免的。修法相同：新增專屬 route。

**新增 route（放在精確全刪比對「之前」，緊接在 list route 之後）：**

```
// 帶編號的單筆刪除：必須在精確全刪比對之前
const delOneMatch = trimmed.match(/^刪除提醒\s+(.+)$/);
if (delOneMatch) {
  const arg = delOneMatch[1].trim();
  const n = /^\d+$/.test(arg) ? parseInt(arg, 10) : null;   // 非數字 → null → removeByIndex 回錯誤句
  return reminder.removeByIndex(userId, n);
}
if (trimmed === '清除提醒' || trimmed === '刪除提醒' || trimmed === '提醒清除') return reminder.clear(userId);
if (/^提醒/.test(trimmed)) return reminder.add(userId, trimmed);
```

**位置分析（before vs after 精確全刪）：**
- 用 `/^刪除提醒\s+(.+)$/`（要求至少一個空白＋非空引數）→ 與精確 `trimmed === '刪除提醒'`（無引數）**互斥**：
  - 「刪除提醒」（裸字）不匹配新 route（缺 `\s+(.+)`）→ 落到精確全刪 → `clear()`（AC-3「裸字全刪」逐字不回歸）。
  - 「刪除提醒 3」只匹配新 route，不匹配精確全刪。
- 因互斥，插在精確比對前或後行為相同；**選「之前」並與提醒群組相鄰**，語意清楚、未來若把裸字 route 改動也不易誤傷。
- 用 `(.+)` 捕捉「任何引數」而非 `(\d+)`：這樣「刪除提醒 abc」（非數字）也會命中此 route → `n=null` → `removeByIndex` 回清楚錯誤句（AC-3「非數字回錯誤提示、不當機」）；若用 `(\d+)` 則 abc 會 fallthrough 到 AI 對話，錯誤處理不確定。
- 空白容忍度：`\s+` 要求「刪除提醒<空白>N」。若要更寬鬆容忍「刪除提醒3」（無空白），可改 `/^刪除提醒\s*(.+)$/`——但需注意 `\s*(.+)` 對裸字「刪除提醒」仍不匹配（`(.+)` 要至少一字），故仍安全。**定案採 `\s+`**（貼合 PRD「刪除提醒 N」字面，且與其他帶參數指令如 `生日 ` 的 `\s+` 慣例一致）。

---

## 12. 流程（使用者輸入 → 路由 → 處理 → 回覆）

**A. 中文關鍵字新增（每週/每月）**
```
「提醒我 每週三晚上7點 倒垃圾」
→ handler：/^提醒/ 命中 → reminder.add(userId, text)
→ add()：剝「提醒我」→ parse()（askJSON）→ {ok,type:'weekly',weekday:'wednesday',time:'19:00',message:'倒垃圾'}
→ toWeekdayNum('wednesday')=3、normHM('19:00')='19:00' → push weekly → save
→ 回「✅ 好的，每週三 19:00 我會提醒你：「倒垃圾」」
```

**B. 任意語言（含越南語）AI 工具新增**
```
「nhắc tôi mỗi thứ tư 7 giờ tối đổ rác」
→ AI 對話 → 呼叫 set_reminder(type:'weekly', weekday:'wednesday', time:'19:00', message:'đổ rác')
→ run()：reminder.addParsed(...) → {ok,when:'every Wednesday 19:00'} → 回模型 "Reminder saved (every Wednesday 19:00): đổ rác"
→ 模型用越南語向使用者確認
```

**C. 刪除單筆**
```
「提醒清單」→ list()：顯示 1..N（不含喝水）
「刪除提醒 2」→ handler：delOneMatch → n=2 → removeByIndex(userId,2)
→ listable 取第 2 筆 → 依 id 刪 → 回「🗑 已刪除提醒：每週三 19:00｜倒垃圾」
「刪除提醒 99」/「刪除提醒 abc」→ removeByIndex 回錯誤句（不刪、不當機）
「刪除提醒」（裸字）→ clear()（全刪，不回歸）
```

**D. 觸發（tick 每 30 秒）**
```
台北星期三 19:00 → weekly 判斷式命中 → push → firedRepeat → reload-before-save 設 lastFired=當日日期
同日重入：lastFired===now.date → 不重推；下週三：lastFired 為舊日期 → 再觸發
```

---

## 13. 與現有架構整合

- **指令走 handler 路由**：單筆刪除是確定性中文指令，放 `handler.js` 提醒區塊（§11.2），在 AI fallback 之前。
- **自然語言走 AI 工具**：新增 weekly/monthly 靠 `tools.js` 的 `set_reminder`（擴充既有工具，不新增工具；PRD F4 硬約束）。
- **多語言**：reminder.js 回覆維持中文（PRD 決策 5）；越南語使用者走 AI 工具，靠 `run()` 回傳的英文 `when` 讓模型轉譯（§8）。`lang.js` 不動。
- **儲存**：沿用 `store.load('reminders.json')`／`store.save(...)`（RAM 快取＋檔案＋選填雲端），不新增 `KNOWN_KEYS`。
- **併發**：weekly/monthly 走 `tick()` 同一條 `firedRepeat` + reload-before-save，不另開路徑（PRD F2 硬約束）。

---

## 14. 測試策略（對齊 PRD 驗收 1–11）

**共通鐵律（AC-11）**：不 `require index.js`、不呼叫 `.start()`、結尾 `process.exit(0)`、`client.pushMessage` 必 stub、碰 `data/reminders.json` 前備份、測後還原並逐字比對、`node --check` 全過。

### 14.1 測試縫設計（tick 時間注入）— 這是測試員最會卡的點

`taipeiParts()` 是模組內部函式，測試無法從外部覆寫其內部呼叫。**設計兩道縫：**

1. **`tick()` 改成可注入「現在」的簽名（向後相容）：**
   ```
   async function tick(now = taipeiParts(), nowMs = Date.now()) { … }
   ```
   - 正式路徑（`start()` 的 `setTimeout(tick, 30000)`、`finally` 的自我排程）都以無參數呼叫 → 走預設 `taipeiParts()`/`Date.now()`，**行為與現況相同**。
   - 測試以 `tick(fakeNow, fakeMs)` 精準控制時間，`fakeNow` 為構造的 parts 物件：
     ```
     { date:'2026-07-22', hm:'19:00', weekday:3, day:22, daysInMonth:31 }
     ```
2. **匯出 `tick` 與 `taipeiParts`**（測試可直接呼叫 tick、或用 taipeiParts 產真實 now 再改欄位）。

> 自我排程（`finally` 的 `setTimeout(tick, 30000)`）在測試呼叫 `tick(fakeNow)` 時仍會排下一輪（無參數、真實 now），但測試以 `process.exit(0)` 結束、且資料是備份隔離的，該 stray tick 無害。**不改動 P0 的自我排程語意**（不加 unref、不拆 loop，以免動到 P0）。

**push stub 做法**：`const line = require('../src/line'); line.client.pushMessage = async () => { calls.push(...); };`
reminder.js 以 `const { client } = require('../line')` 取得**同一個 client 物件參考**，覆寫其 `.pushMessage` 屬性即生效（push() 在呼叫時才讀 `client.pushMessage`）。`lang.resolve`／`reminderPrefix` 離線讀 `lang.json`，不需 stub。

**AI 解析 stub**：`const ai = require('../src/ai'); ai.askJSON = async () => ({...});`
reminder.js 以 `ai.askJSON(...)` 經物件呼叫，覆寫屬性即生效（離線測 parse／add）。

### 14.2 逐驗收測項

| 驗收 | 測法（離線） | 預期 |
|---|---|---|
| 1 weekly 觸發 | 造 `{type:'weekly',weekday:3,time:'19:00',lastFired:''}`；`tick({...weekday:3,hm:'19:00',date:'2026-07-22'...})` | push 1 次、`lastFired='2026-07-22'`；同 now 再 tick → 0 次（去重）；`weekday:4`（週四）→ 0 次；`date:'2026-07-29'`(下週三)→ 再 1 次 |
| 2 monthly＋短月 | 造 `dayOfMonth:31/30/5`；分別餵 `day/daysInMonth`：`{day:28,daysInMonth:28}`、`{day:5,daysInMonth:31}`、`{day:30,daysInMonth:30}` | 依 §4.1 表：31 遇 2 月→2/28 一次；30 遇 2 月→2/28；31 遇 4 月→4/30；5 號→僅 5 號；3 月 `{day:28,daysInMonth:31}` 不誤觸發；換 `date` 到 3/31 → 再觸發 |
| 3 刪除單筆 | 直接呼叫 `list()`／`removeByIndex()`；造含 water tag 一筆＋數筆一般 | `刪除提醒 2` 刪當下第 2 筆、其餘不變、再 list 編號重排；`99`／`abc`(null)→錯誤句、筆數不變；裸字→ `clear()` 全刪；water 不在編號、刪不到 |
| 4 once/daily 不回歸 | 對照修改前後字串（add 確認、list 顯示、clear、喝水開關、拍照文件提醒、set_reminder once/daily 的 run 文字） | 逐字相同 |
| 5 tick 併發不回歸 | 同步呼叫兩次 `tick()`（第二次遇 `ticking`）；push stub 內對 reminders.json 插入一筆新提醒 | 第二次略過不重推；收尾後檔案同時含「新插入筆」與「已標記 lastFired 的 weekly/monthly/daily 筆」（reload-before-save） |
| 6 AI 工具 happy path | `tools.run(userId,'set_reminder','{"type":"weekly","weekday":"wednesday","time":"19:00","message":"倒垃圾"}')`；monthly 同理 | 成功新增；回傳含 `every Wednesday 19:00`／`every month on day 5` |
| 7 parse weekly/monthly | stub `ai.askJSON` 回固定 JSON；`reminder.add(userId,'每週三晚上7點 倒垃圾')`／`'每月5號 繳房租'` | weekly：weekday=3、time='19:00'、message='倒垃圾'；monthly：dayOfMonth=5、time 缺→'09:00'、message='繳房租'。（可選：真打 Groq 1–2 條 happy path 驗「週三/星期三/禮拜三→wednesday」，額度考量預設略過） |
| 8 時區 | 檢查 `taipeiParts()` 的 weekday/day/daysInMonth 以 `+08:00`／`Date.UTC` 計算，不用伺服器本地 tz | weekday/day 與台北一致 |
| 9 清單四型別 | 造 once/daily/weekly/monthly 各一 → `list()` | 四行格式清楚可分辨、`｜` 分隔、與 once/daily 風格一致 |
| 10 store 不變 | 斷言 `store._internal.KNOWN_KEYS` 含 `reminders.json`；`node --check` 全變更檔 | 通過 |
| 11 鐵律 | 見 §14 共通鐵律 | 全遵守 |

---

## 15. 風險與取捨

| 風險／取捨 | 說明與緩解 |
|---|---|
| **llama 傳錯 weekday** | 已用英文名 enum（§2）＋ `toWeekdayNum` 兼收數字/縮寫防呆；prompt 把「週三→wednesday」講死。殘餘風險：模型傳不在 enum 的字 → `toWeekdayNum` 回 null → `add` 回錯誤句／`addParsed` 回 `{ok:false}`（不當機） |
| **短月 clamp 而非跳過** | PRD 決策 2 定案：繳費類「準時觸發」優先，最多提早一兩天，遠優於整月漏發。唯一支援語意，不做「僅有 31 號才提醒」 |
| **無時刻預設 09:00 可能非使用者本意** | 取「成功新增」優於「逼問時刻」；prompt＋schema 皆明示 09:00，使用者可重設。僅套用於 weekly/monthly，不污染 daily/once |
| **編號 volatile** | PRD 決策 3：即時重算、不快取；查完清單到刪除間若清單變動可能刪錯——家庭 1-1 情境機率低，靠「先查清單再刪」＋清楚錯誤句緩解 |
| **越南語無法用 AI 工具刪除單筆** | PRD 決策 4 已知限制：刪除只走中文「刪除提醒 N」；越南語使用者可用 `list_reminders` 查詢，刪除需照抄中文指令或由中文使用者代操作。列下一輪評估 |
| **P0 併發模式** | 僅擴充判斷式分支與把 `firedDaily`→`firedRepeat`，reload-before-save／`ticking` 防重入完全沿用；測項 5 專門守此不回歸 |
| **`tick(now,nowMs)` 注入縫誤用** | `_internal` 精神：僅測試用；正式路徑一律無參數呼叫。自我排程語意不變（不加 unref、不拆 loop） |

---

## 16. 定案速覽（回報用）

- **改動檔案**：`src/services/reminder.js`、`src/tools.js`、`src/handler.js`（各為擴充；`store.js`／`lang.js`／`index.js` 不動）。
- **weekday 映射**：內部存數字 0-6（0=Sunday）；**兩個入口（schema＋parse）一律用英文星期名字串**，伺服器端單一 `toWeekdayNum` 轉數字（字串 enum 最防 llama 出錯，單一真實來源）。
- **無時刻預設**：weekly/monthly 未指定時刻 → `09:00`（prompt＋schema＋程式端三處寫死；不影響 daily/once）。
- **monthly clamp 判斷式（一行）**：
  `now.day === Math.min(r.dayOfMonth, now.daysInMonth) && r.time === now.hm && r.lastFired !== now.date`
- **tick 時間注入測試縫**：`tick(now = taipeiParts(), nowMs = Date.now())`＋匯出 `tick`、`taipeiParts`；測試以 `tick(fakeNowParts, fakeMs)` 精準控時，`client.pushMessage`／`ai.askJSON` 以物件屬性覆寫 stub。

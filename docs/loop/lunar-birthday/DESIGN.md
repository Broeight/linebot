# 技術設計：🎂 農曆生日提醒（DESIGN）

**版本** v1.0 | **日期** 2026-07-23 | **作者** 架構師（RD#1）
**對應 PRD** `docs/loop/lunar-birthday/PRD.md`
**建議分支** `feat/lunar-birthday`

---

## 〇、一句話總結

在既有 `src/services/birthday.js`（70 行、全中文硬編、極簡風格）內**擴充**一種新的生日紀錄型別：農曆月日
`lm:'MM-DD'`，與既有國曆 `md:'MM-DD'` 欄位互斥並存。新增一條 handler 路由 `農曆生日 名字 日期`，
每日推播比對（`todays()`）與生日清單（`list()`）內部同時處理國曆與農曆兩型。所有農曆換算**只呼叫已驗證的
`src/services/lunar.js`（引擎一行不改）**，固定用 `TZ_TW`。

**改動檔案：只有 `src/services/birthday.js` 與 `src/handler.js`（一條路由）。** 引擎、store、morning、lang、
資料檔結構全不動。

---

## 一、受影響檔案清單

| 檔案 | 動作 | 內容 |
|---|---|---|
| `src/services/birthday.js` | **修改（主戰場）** | 新增 `addLunar()`、`isLunarHitToday()`、`nextSolarForLunar()`、`isLastDayOfLunarMonth()`、`diffDays()` helper；擴充 `list()`、`todays()` 同時處理 `md`／`lm` 兩型；`parseMD()`、`daysUntil()`、`add()`、`remove()` **一行不改**。 |
| `src/handler.js` | **修改（一條路由）** | 在「生日」路由群加 `農曆生日 名字 日期` 路由，轉呼 `birthday.addLunar()`。 |
| `src/services/lunar.js` | **不動** | 只讀呼叫 `lunarFromYmd` / `lunar2solar` / `TZ_TW`。 |
| `src/store.js` | **不動** | 沿用 `birthdays.json`；`KNOWN_KEYS` 不變（驗收 10）。 |
| `src/services/morning.js` | **不動** | `todays()` 介面與回傳型別不變（驗收 F4）。 |
| `src/lang.js` | **不動** | 生日功能現況全中文硬編，新回覆沿用同慣例；vi 化留下一輪（決策 6）。 |
| `README.md` / `helpMenu` | **本輪不動** | 見 §八「取捨」——說明文字更新放 PR 描述，避免動到三語 `HELP_MENU`。 |

---

## 二、資料結構／儲存（PRD F6、驗收 8/10）

沿用 `data/birthdays.json`（陣列），一筆紀錄兩種型別，**同一筆只會有 `md` 或 `lm` 其一**：

```jsonc
// 既有國曆（舊資料，逐字不動）
{ "userId": "U...", "name": "媽媽", "md": "08-15" }

// 新增農曆（本輪新增）
{ "userId": "U...", "name": "阿嬤", "lm": "08-15" }   // lm = lunar month-day，農曆八月十五
```

- **欄位命名**：`lm`（lunar month-day），格式與 `md` 相同（`'MM-DD'`，零補位），可直接沿用 `parseMD()` 的輸出。
  語意與 `md` 完全分離——判斷型別只看「有 `md` 還是有 `lm`」，不新增 `isLunar` 旗標（一個欄位存在即代表型別，
  最省、最不易誤判）。
- **舊資料相容**：舊 `{md}` 紀錄的讀取／清單／推播／刪除路徑與改動前逐字一致。`todays()` 舊路徑
  `b.md === md` 對農曆筆為 `undefined === '09-25'` → `false`，天然不誤命中；反之新農曆路徑只看 `b.lm`，
  舊國曆筆 `b.lm` 為 `undefined`，也不誤命中。**兩型在 filter 中以欄位存在性天然隔離。**
- **同名覆蓋（F2）**：`addLunar()` 沿用 `add()` 既有 filter——`!(b.userId === userId && b.name === name)`，
  **不分型別、同名即覆蓋**，維持「一人一筆生日」。中文長輩若先用國曆記了「阿嬤」，再用農曆記「阿嬤」，
  舊國曆筆會被農曆筆取代（符合 PRD F2「不允許同名同時存在國曆＋農曆兩筆」）。
- **不新增資料檔**：`KNOWN_KEYS` 不變（驗收 10）。

---

## 三、引擎行為實測／推導（本設計最關鍵處）

> **環境限制聲明**：本輪設計環境**未提供可執行 shell 的工具**（僅有讀檔／搜尋／寫檔），架構師**無法親跑
> `node -e`**。以下 `lunar2solar` 對「小月 day=30」的行為，改以**引擎原始碼靜態推導**（其結果為確定性、
> 無浮點邊界模糊）得出，並在 §3.3 附上 coder 實作前**必跑的一鍵複驗指令**。權威對照日期取自
> 已驗證的 `docs/loop/lunar-tet/TEST.md`（39 項全 PASS）。

### 3.1 權威對照（取自 lunar-tet TEST.md，可直接當測試 fixture）

| 農曆（tz8/TW） | 國曆 | 用途 |
|---|---|---|
| 八月十五 2026 | `2026-09-25` | 正常路徑主案例（`lunar2solar(15,8,2026,0)`＝`[25,9,2026]`；反向 `solar2lunar(25,9,2026)`＝`{day:15,month:8,year:2026,leap:0}`） |
| 正月初一（Tết）2026 | `2026-02-17` | 跨年／正月換算 |
| 閏六月初一 2025 | 存在（`leap:1`） | 閏月語意案例（驗收 5） |
| 閏六月廿九末 2025 | 存在（`leap:1`） | 閏月末日 |
| 出閏後 七月初一 2025 | `2025-08-23` | 閏月接續 |

### 3.2 `lunar2solar` 對「小月 day=30」的行為（靜態推導，確定性）

引擎最後兩行（`lunar.js` L205–206）：

```js
const monthStart = getNewMoonDay(k + off, timeZone); // 目標農曆月「初一」的儒略日整數
return jdToDate(monthStart + lunarDay - 1);          // 第 lunarDay 天
```

- `monthStart` = 目標農曆月初一的 JD。該月天數 = `getNewMoonDay(k+off+1) − getNewMoonDay(k+off)` ∈ {29, 30}。
- 傳 `lunarDay = 30` → 回 `jdToDate(monthStart + 29)`。
  - **月長 30**：`monthStart + 29` 正是「三十」（初一為第 1 天）→ 回**正確的三十國曆日**。
  - **月長 29**：`monthStart + 29` 正好等於**下一個月的初一**（`getNewMoonDay(k+off+1)`）→ 回**下月初一的國曆日**，
    **不回 `[0,0,0]`、不丟例外、不 clamp——靜默溢位到下個月初一**。

**結論**：對只有 29 天的農曆月傳 `day=30`，`lunar2solar` 會給出「下月初一」這個**錯誤日期**（我們要的是廿九）。
因此**演算法 B 必須自行 clamp**。`[0,0,0]` 只在「`leap!==0` 且該月非閏」時發生（L199–200）；v1 恆傳 `leap=0`，
**理論上永不觸發**，但仍保留防禦分支。

### 3.3 coder 實作前必跑的一鍵複驗（唯讀呼叫引擎，不算改碼）

```bash
# A. 正常路徑 roundtrip（應得 [25,9,2026] 與 {day:15,month:8,year:2026,leap:0}）
node -e "const l=require('F:/Linebot/src/services/lunar');console.log(l.lunar2solar(15,8,2026,0,l.TZ_TW), l.solar2lunar(25,9,2026,l.TZ_TW))"

# B. 掃出一個「只有 29 天」的農曆月，對它傳 day=30 看溢位（驗證 §3.2 推導）
node -e "const l=require('F:/Linebot/src/services/lunar');const TW=l.TZ_TW;for(let y=2025;y<=2027;y++)for(let m=1;m<=12;m++){const a=l.lunar2solar(1,m,y,0,TW);let nm=m+1,ny=y;if(nm>12){nm=1;ny=y+1}const b=l.lunar2solar(1,nm,ny,0,TW);const len=l.jdFromDate(b[0],b[1],b[2])-l.jdFromDate(a[0],a[1],a[2]);if(len===29){const d30=l.lunar2solar(30,m,y,0,TW);console.log(y+'-'+m+' 月29天  day30=>'+JSON.stringify(d30)+'  回農曆=>'+JSON.stringify(l.solar2lunar(d30[0],d30[1],d30[2],TW)))}}"

# C. 閏月：2025 正六月十五 vs 閏六月十五，及規格錯誤（leap=1 但該月非閏）回 [0,0,0]
node -e "const l=require('F:/Linebot/src/services/lunar');const TW=l.TZ_TW;console.log('正6/15',l.lunar2solar(15,6,2025,0,TW),'閏6/15',l.lunar2solar(15,6,2025,1,TW),'錯誤閏8',l.lunar2solar(15,8,2026,1,TW))"
```

> 期望：B 的 `day30` 換回農曆為 `{day:1, month:(m+1)…}`（證實溢位到下月初一）；C 的「錯誤閏8」回 `[0,0,0]`。
> 若實測與 §3.2 推導不符（例如某版本回 `[0,0,0]`），clamp 策略（§4.3）的 roundtrip 判斷仍成立——它**不依賴**
> 溢位形式，只判「換回來的農曆日是不是仍是 30」，故對兩種可能結果都 robust。

---

## 四、模組與函式介面（`birthday.js` 內部）

新增全部為 module 內私有函式（除 `addLunar` 掛上 `module.exports`）。命名、回傳字串風格仿既有極簡。

### 4.1 `addLunar(userId, body) → string`（PRD F1、驗收 1）

與既有 `add()` 同一套「最後一個 token 當日期、其餘當名字」解析，另加農曆日上限檢查。

```
addLunar(userId, body):
  parts = body.trim().split(/\s+/)
  if parts.length < 2 → 回 '格式：農曆生日 名字 日期，例如「農曆生日 阿嬤 8/15」'
  dateStr = parts.pop(); name = parts.join(' ')
  lm = parseMD(dateStr)                       // 重用既有 parseMD，零改動
  if !lm → 回 `看不懂日期「${dateStr}」，請用「8/15」這種格式。`
  bd = Number(lm.split('-')[1])
  if bd > 30 → 回 '農曆日期最多到 30（農曆沒有 31 號）。'   // parseMD 允許 31，農曆須額外擋
  // 覆蓋寫入（同名不分型別覆蓋，F2）
  list = store.load(FILE).filter(b => !(b.userId===userId && b.name===name))
  list.push({ userId, name, lm })
  store.save(FILE, list)
  // 確認訊息附今年（或明年）國曆換算與倒數
  today = store.taipei().date
  nx = nextSolarForLunar(lm, today)           // {ymd, days} | null
  if nx == null → 回 `🎂 已記住 ${name} 的農曆生日：農曆${mmdd(lm)}（國曆換算暫時無法顯示）`
  if nx.days === 0 → 回 `🎂 已記住 ${name} 的農曆生日：農曆${mmdd(lm)}（今年＝國曆 ${nx.ymd的MM-DD}）🎉 就是今天！`
  else → 回 `🎂 已記住 ${name} 的農曆生日：農曆${mmdd(lm)}（今年＝國曆 ${nx.ymd的MM-DD}，還有 ${nx.days} 天）`
```

- `mmdd(lm)`：把 `'08-15'` 顯示成 `8/15`（去零補位）——與既有指令「農曆生日 阿嬤 8/15」的輸入寫法呼應；
  或直接顯示 `08-15`（與國曆清單 `b.md` 顯示風格一致）。**定案：顯示 `農曆8/15`（去零補位，較口語，與指令一致）。**
- `nx.ymd的MM-DD`：`nextSolarForLunar` 回的是 `'YYYY-MM-DD'`，取後 5 碼 `MM-DD`（與現行清單國曆行 `b.md` 同格式）。
- **換算異常（null）處置定案**：**仍存檔、顯示異常註記，不拒存**。理由：`leap=0` 恆傳、日期在 1900–2199 內，
  理論上永不發生；即使發生也不該讓「記生日」這件事失敗；顯示註記即可（驗收 11 的清單防禦同理）。

### 4.2 `isLunarHitToday(lm, todayYmd) → boolean`（`todays()` 內部用，PRD F4／決策 2、3）

```
isLunarHitToday(lm, todayYmd):
  L = lunar.lunarFromYmd(todayYmd, lunar.TZ_TW)   // {day, month, year, leap}
  if L.leap !== 0 → return false                  // 決策 2：閏月一律不提醒
  [bm, bd] = lm.split('-').map(Number)
  if L.month === bm && L.day === bd → return true // 正常路徑（含 30 天月的三十）
  // 三十缺日（決策 3）：存三十、今天廿九、且廿九是該農曆月最後一天 → 提前命中
  if bd === 30 && L.month === bm && L.day === 29 && isLastDayOfLunarMonth(todayYmd) → return true
  return false
```

### 4.3 `nextSolarForLunar(lm, todayYmd) → {ymd:'YYYY-MM-DD', days:number} | null`（決策 5）

清單倒數 + 新增確認訊息共用。含 §3.2 推導出的 **30→29 clamp**（roundtrip 判月長，對引擎溢位形式不敏感）。

```
nextSolarForLunar(lm, todayYmd):
  L0 = lunar.lunarFromYmd(todayYmd, lunar.TZ_TW)   // 取今天的「農曆年」L0.year
  [bm, bd] = lm.split('-').map(Number)
  for year of [L0.year, L0.year + 1]:              // 最多兩個農曆年
    day = bd
    if bd === 30:                                  // clamp：小月無三十 → 廿九
      probe = lunar.lunar2solar(30, bm, year, 0, TZ_TW)
      if probe 是 [0,0,0] → day = 29               // 防禦（理論上 leap=0 不會發生）
      else:
        back = lunar.lunarFromYmd(ymdStr(probe), TZ_TW)
        if !(back.month === bm && back.day === 30 && back.leap === 0) → day = 29  // 溢位到下月/被移動 → 小月
    sol = lunar.lunar2solar(day, bm, year, 0, TZ_TW)
    if sol 是 [0,0,0] → continue                   // 防禦：換算異常，換下個年再試
    ymd = ymdStr(sol)                              // 'YYYY-MM-DD'，零補位
    if ymd >= todayYmd → return { ymd, days: diffDays(todayYmd, ymd) }
  return null                                       // 兩年都失敗 → 顯示換算異常
```

- `ymdStr([dd,mm,yy])` → `` `${yy}-${pad(mm)}-${pad(dd)}` ``（字串可直接用字典序 `>=` 比大小，因固定寬度）。
- **clamp 為何 robust**：不管引擎對「小月傳 30」是回下月初一（§3.2 推導）還是回 `[0,0,0]`（保守），
  roundtrip「換回來還是不是本月三十」都能正確判定該月無三十 → 落到 `day=29`。**與 §3.3 實測結果無論何者皆相容。**
- **與演算法 A 一致（決策 3 要求）**：小月時 B 回廿九的國曆日，恰是 A 在廿九命中的那天；30 天月時 B 回三十、
  A 在三十命中。**清單顯示的「今年＝國曆」永遠等於當天推播會命中的那天**，不會出現虛構的三十。

### 4.4 `isLastDayOfLunarMonth(todayYmd) → boolean`

```
isLastDayOfLunarMonth(todayYmd):
  jd = lunar.jdFromDate(dd, mm, yy)            // 由 todayYmd 拆出（或用 Date 加一天再組字串）
  [d2,m2,y2] = lunar.jdToDate(jd + 1)          // 明天國曆
  return lunar.solar2lunar(d2, m2, y2, TZ_TW).day === 1   // 明天農曆初一 → 今天是某農曆月最後一天
```

- 也可不用 `jdFromDate/jdToDate`，改用 `Date.UTC(...) + 86400000` 求明天字串再 `lunarFromYmd`。兩者等價；
  `jdFromDate/jdToDate` 已在 `lunar.js` 匯出（供離線測試），用它避免時區歧義，較穩。**定案：用 `jdFromDate/jdToDate`。**

### 4.5 `diffDays(todayYmd, ymd) → number`

沿用 `daysUntil` 的 UTC 手法（避免夏令／時區誤差）：

```
diffDays(a, b):
  [ay,am,ad] = a.split('-').map(Number)
  [by,bm,bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by,bm-1,bd) - Date.UTC(ay,am-1,ad)) / 86400000)
```

### 4.6 `list(userId)` 擴充（PRD F3、驗收 2）

```
list(userId):
  today = store.taipei().date
  items = store.load(FILE).filter(b => b.userId === userId).map(b => {
    if (b.md != null) return { ...b, kind:'solar', d: daysUntil(b.md) }
    // 農曆
    nx = nextSolarForLunar(b.lm, today)
    if (nx == null) return { ...b, kind:'lunar', d: Number.MAX_SAFE_INTEGER, solar: null }  // 異常沉底
    return { ...b, kind:'lunar', d: nx.days, solar: nx.ymd.slice(5) }  // 'MM-DD'
  }).sort((a,b) => a.d - b.d)                       // 國曆／農曆混排，依剩餘天數（排序規則不變）
  if items.length === 0 → 回 '還沒有記錄任何生日。輸入「生日 媽媽 8/15」新增。'
  lines = items.map(b => {
    if (b.kind === 'solar')
      return `${b.name}：${b.md}　${b.d===0 ? '🎉 就是今天！' : `還有 ${b.d} 天`}`   // 逐字同現行
    // 農曆
    if (b.solar == null) return `${b.name}：農曆${mmdd(b.lm)}（國曆換算暫時無法顯示）`
    return `${b.name}：農曆${mmdd(b.lm)}（今年＝國曆 ${b.solar}）　${b.d===0 ? '🎉 就是今天！' : `還有 ${b.d} 天`}`
  })
  回 '🎂 生日清單：\n' + lines.join('\n')
```

- **國曆行逐字不變**（驗收 9）：`${b.name}：${b.md}　...` 與現行第 51–53 行完全相同。
- 農曆行加「農曆」前綴 + 「今年＝國曆 MM-DD」（決策 5）。
- 異常筆 `d = MAX_SAFE_INTEGER` 沉到清單最後，不破壞升冪排序、不影響其餘筆（驗收 11）。

### 4.7 `todays(userId)` 擴充（PRD F4、驗收 4/5/6）

```
todays(userId):
  t = store.taipei()
  today = t.date
  return store.load(FILE).filter(b => b.userId === userId).filter(b => {
    if (b.md != null) return b.md === t.md          // 國曆：逐字同現行判斷
    if (b.lm != null) return isLunarHitToday(b.lm, today)   // 農曆
    return false
  }).map(b => b.name)
```

- **對外簽章與回傳型別不變**（名字陣列），`morning.js` L98 `birthday.todays(sub.userId)` 呼叫端零改動（驗收 F4）。
- 國曆筆判斷式 `b.md === t.md` 與現行第 67 行逐字相同（驗收 9）。

### 4.8 匯出

```
module.exports = { add, list, remove, todays, addLunar };
```

`add/list/remove/todays` 名稱與簽章不變；新增 `addLunar`。

---

## 五、流程（使用者輸入 → 路由 → 處理 → 回覆）

### 5.1 新增農曆生日
```
使用者打「農曆生日 阿嬤 8/15」
 → handler.handleText：新路由 /^農曆生日\s+(.+)$/ 命中
 → birthday.addLunar(userId, '阿嬤 8/15')
 → parseMD('8/15')='08-15'、日=15≤30 OK → 覆蓋寫入 {userId, name:'阿嬤', lm:'08-15'}
 → nextSolarForLunar('08-15', today) → {ymd:'2026-09-25', days:N}
 → 回「🎂 已記住 阿嬤 的農曆生日：農曆8/15（今年＝國曆 09-25，還有 N 天）」
```

### 5.2 每日早安推播命中
```
morning.sendAll() 逐訂閱者 → buildMessage() → birthday.todays(userId)
 → 對每筆：國曆比 t.md；農曆走 isLunarHitToday(lm, today)
   （leap!==0 直接不命中；正常同月日命中；三十缺日提前廿九命中）
 → 回名字陣列 → morning 用 lang.birthdayLine(code, names) 依訂閱者語言呈現（不受本輪影響）
```

### 5.3 清單／刪除
```
「生日清單」→ birthday.list(userId)（國曆＋農曆混排、農曆加註今年國曆）
「刪除生日 阿嬤」→ birthday.remove(userId,'阿嬤')（按名字，天然涵蓋農曆筆，remove 不改）
```

---

## 六、與現有架構整合

### 6.1 handler 路由（核實結果與插入位置）

**「農曆」route 衝突核實**：`handler.js` L376 既有農曆查詢路由為
`/^(?:今天)?農曆(?:日期)?$/`（**`^...$` 全字精準比對，非前綴**）。輸入「農曆生日 阿嬤 8/15」在「農曆」後
還有「生日 阿嬤 8/15」且無 `$` 結尾，**不匹配**，故**不會被農曆查詢路由先吃掉**。同理也不撞 L388 越南節日
路由。**因為是精準比對，新路由與它的相對順序不影響正確性**——但為可讀性，新路由放在「生日」路由群內。

既有生日群（L411–416）：
```js
if (trimmed === '生日清單') return birthday.list(userId);
const bdDel = trimmed.match(/^刪除生日\s*(.+)$/);
if (bdDel) return birthday.remove(userId, bdDel[1]);
const bdAdd = trimmed.match(/^生日\s+(.+)$/);
if (bdAdd) return birthday.add(userId, bdAdd[1]);
```
**插入一行（放在群組最前或 `生日 名字` 之前皆可，順序無關）**：
```js
const bdLunar = trimmed.match(/^農曆生日\s+(.+)$/);
if (bdLunar) return birthday.addLunar(userId, bdLunar[1]);
```
比對順序安全性：`農曆生日…` 開頭是「農」——`生日清單`（精準）、`^刪除生日`、`^生日\s+` 三者皆不匹配
（`^生日` 要求開頭即「生」）；反之 `農曆生日` 專屬前綴不會誤吃「生日 …」。**互不干擾（驗收 9）。**

### 6.2 指令 vs 自然語言
- 走 handler 指令路由（決策 6：**不新增 AI 工具**，`tools.js` 不動，維持生日功能全指令制、省 token）。
- **不新增 vi 別名指令**（決策 6）；但越南家人仍可被中文使用者用「農曆生日」代記，推播命中時
  `lang.birthdayLine()` 依訂閱者語言呈現，與本輪無關。

### 6.3 多語言
- 生日功能現況**全中文硬編**（`add/list/remove` 回覆皆中文字面），新回覆沿用同慣例，**`lang.js` 不動**。

---

## 七、測試策略（對齊 PRD 驗收 1–12）

> 測試遵守驗收 12：不 `require index.js`、不 `.start()`、不發真 LINE、結尾 `process.exit(0)`、
> 碰 `data/` 需備份還原並逐字驗證還原。所有農曆換算唯讀呼叫 `lunar.js`。

**「今天」控制**：`birthday.js` 內所有「今天」來源都是 `store.taipei()`（`.date` / `.md`）。測試覆寫
`store.taipei = () => ({ date:'2026-09-25', md:'09-25', ym:'2026-09', hm:'07:00' })` 即可固定今天。
（已核實 `store.taipei()` 回傳形狀為 `{date, md, ym, hm}`，見 `store.js` L167–172。）

| # | 驗收點 | 測法 |
|---|---|---|
| 1 | 新增合法／非法 | `農曆生日 阿嬤 8/15` 回覆含「農曆」、今年國曆、剩餘天數；`農曆生日 阿嬤 13/40` 回錯誤且 `birthdays.json` 無寫入；另測 `農曆生日 阿嬤 8/31`（農曆無 31）回專屬錯誤、不寫入。 |
| 2 | 清單倒數混排 | 放一筆國曆 `{md:'12-31'}` + 一筆農曆 `{lm:'08-15'}`，覆寫今天=`2026-09-20`，`生日清單` 中農曆行含「農曆」與「今年＝國曆 09-25」；把今天覆寫成 `2026-09-25` → 該農曆行顯示 `🎉 就是今天！`；驗證兩行依剩餘天數升冪。 |
| 3 | 刪除農曆 | `刪除生日 阿嬤` 能刪掉 `{lm}` 筆；找不到時回「找不到「X」的生日。」逐字同現行。 |
| 4 | 推播命中 | 用 fixture 農曆八月十五↔`2026-09-25`：覆寫今天=`2026-09-25`，`todays()` 回含「阿嬤」；覆寫成 `2026-09-24`／`2026-09-26` → 不含。 |
| 5 | 閏月語意 | 用 2025 閏六月案例（`lunar-tet` fixture）。存 `{lm:'06-15'}`：當天=**正六月十五**的國曆 → 命中；當天=**閏六月十五**的國曆（`solar2lunar` 回 `leap:1`）→ 不命中。國曆日由 `lunar2solar(15,6,2025,0)` 與 `(15,6,2025,1)` 反查取得。 |
| 6 | 三十缺日 | 用 §3.3 指令 B 掃出的「29 天月」構造：存 `{lm:'MM-30'}`，當天=該月廿九國曆 → `todays()` 命中；且 `list()` 顯示的「今年＝國曆」等於廿九國曆（非虛構三十）。同時測「30 天月」存三十在廿九**不**提前命中、只在三十命中。 |
| 7 | 台越 tz 一致 | 以 zh 與 vi 兩 userId 各存相同 `{lm:'08-15'}`，`nextSolarForLunar` 皆用 `TZ_TW` → 換算國曆一致（資料無 tz 欄位）。 |
| 8 | 舊資料相容 | 手動放純 `{userId,name,md}` 舊筆 → `list`／`todays`／`remove` 對它的輸出與改動前逐字相同（`git show HEAD:src/services/birthday.js` 對照）。 |
| 9 | 國曆不回歸 | 純國曆資料跑 `add`/`list`/`todays`/`remove` 輸出與既有測試逐字相同；`parseMD`／`daysUntil` 未改（diff 檢查）。 |
| 10 | KNOWN_KEYS 不變 | 斷言 `store._internal.KNOWN_KEYS` 不含新檔、仍含 `birthdays.json`。 |
| 11 | 防禦 | 注入 `{lm:'02-30'}` 之類可能觸發溢位／異常的資料，或 monkey-patch 讓 `lunar2solar` 回 `[0,0,0]`：該筆在 `list()` 顯示「（國曆換算暫時無法顯示）」、不拋例外、其餘筆正常輸出；`todays()` 對它不命中且不中斷。 |
| 12 | 收斂 | `node --check src/services/birthday.js`、`node --check src/handler.js` 通過；測試備份還原 `data/birthdays.json` 並逐字驗證。 |

**閏月接續兩情境的正確性論證（寫入測試註解，回應 PRD 決策 3）**：
- 情境甲：存「八月三十」，某年正八月只有 29 天、其後接閏八月。當天=正八月廿九：`solar2lunar` 回
  `{day:29,month:8,leap:0}` → 過第一關；`bd===30 && month===8 && day===29`；`isLastDayOfLunarMonth`：
  明天=閏八月初一 → `solar2lunar(明天).day===1` 成立 → **命中**。語意正確：正月優先，這年在正八月廿九過
  （最接近「三十」的正月日）。
- 情境乙：同存「八月三十」，當天=閏八月廿九：`solar2lunar` 回 `{leap:1}` → **第一關 `L.leap!==0` 即擋掉**，
  不重複命中。語意正確：閏月不提醒。
- 兩情境合起來：一年只在正八月廿九命中一次，不漏不重。

---

## 八、風險與取捨

1. **無法親跑引擎（環境限制）**：本設計環境無 shell 執行工具，`lunar2solar` 小月 day=30 行為為**靜態推導**
   （§3.2，確定性）。**緩解**：§3.3 附一鍵複驗指令，且 §4.3 的 clamp 用 roundtrip 判斷，對「回下月初一」與
   「回 `[0,0,0]`」兩種可能結果**皆 robust**——即使實測與推導細節不同，clamp 仍正確。coder 實作時務必先跑 §3.3。
2. **台越曆法分歧（決策 4）**：v1 固定 `TZ_TW`，下次分歧約 2030/2；落在分歧區間的生日可能與越南曆差一天。
   機率極低、影響小，接受此已知邊界，留待「生日功能 vi 化」做個人化曆法選擇。
3. **同名跨型別覆蓋（F2）**：中文長輩先記國曆「阿嬤」再記農曆「阿嬤」會覆蓋——**這是 PRD 明定行為**（一人一筆），
   非 bug；確認訊息已標「農曆」讓使用者一眼可辨型別，降低誤覆蓋困惑。
4. **help／README 未更新（本輪取捨）**：`HELP_MENU` 為三語（`lang.js` L204/234/263），本輪決策 6 不做 vi、
   且要把改動釘在 `birthday.js`＋`handler.js` 兩檔。**定案：本輪不動 `lang.js`，說明文字更新寫進 PR 描述**，
   隨下一輪「生日功能 vi 化」一併三語補齊，避免半套三語文案與範圍膨脹。
5. **`lm` 欄位與 `md` 混淆風險**：所有判斷型別處一律「先看 `md != null` 再看 `lm != null`」，兩型以欄位存在性
   隔離；測試驗收 8/9 逐字比對舊國曆行為以防回歸。
6. **效能**：每筆農曆生日在新增／清單／每日推播各呼叫 1–3 次純數學換算（含 clamp probe），家庭規模無虞。

---

## 九、給 coder 的落地檢查清單

- [ ] 先跑 §3.3 三條 node 指令，把小月 day=30 的實際輸出貼進 PR 描述（複驗 §3.2）。
- [ ] `birthday.js`：新增 5 個 helper + `addLunar`，擴充 `list`／`todays`；**`parseMD`/`daysUntil`/`add`/`remove` 一字不改**。
- [ ] `handler.js`：生日群加一條 `/^農曆生日\s+(.+)$/` 路由。
- [ ] `module.exports` 加 `addLunar`。
- [ ] `node --check` 兩檔通過。
- [ ] 測試涵蓋驗收 1–12，含閏月甲乙兩情境、三十缺日一致性、舊資料逐字不回歸。

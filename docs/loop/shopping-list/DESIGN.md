# DESIGN — 家庭共用購物清單（shopping-list）

> 對應 PRD：`docs/loop/shopping-list/PRD.md`
> 本輪範圍（已與 PM 確認）：1-1 私訊、全域共用一份清單、加入／檢視／完成刪除／清空、
> 中文＋越南語、`shopping.json` 進 `KNOWN_KEYS`、補 `lang.js` 多語、`helpMenu` 加購物清單說明。
> **不加 AI 工具、不動群組翻譯橋、不顯示誰加的。**

---

## 1. 概述

新增一支「全家共用同一份」的購物清單功能。仿作範本為 `src/services/expense.js`
（單一資料檔、用 `store.load/save` 讀寫、handler 用正則解析指令）。資料模型是
**單一全域陣列**（不依 `userId` 過濾），任何人在 1-1 私訊都讀寫同一份。

四個動作：

| 動作 | 中文指令 | 越南語指令（使用者輸入原文） |
|---|---|---|
| 加入 | `買 <品項>` | `mua <品項>` |
| 檢視 | `購物清單` | `danh sách mua sắm` |
| 完成刪除 | `買到 <品項>` | `đã mua <品項>` |
| 清空 | `清空購物清單` | `xóa danh sách mua sắm` |

---

## 2. 受影響檔案清單

| 檔案 | 動作 | 內容 |
|---|---|---|
| `src/services/shopping.js` | **新增** | 服務模組：`list / add / remove / clear` 純服務函式，讀寫 `shopping.json` |
| `src/store.js` | **修改（1 行）** | `KNOWN_KEYS` 陣列加入 `'shopping.json'` |
| `src/handler.js` | **修改** | 在 `handleText`（1-1）末段、AI fallback 之前掛四個指令 route；`require` 引入 shopping 服務；**不動 `handleGroupText`／`handleGroupAudio`／`replyForEvent`** |
| `src/lang.js` | **修改** | 新增 7 組多語字串表 + getter；`HELP_MENU` 的 zh-TW／vi／en 各加購物清單說明 |
| `data/shopping.json` | 執行期自動產生 | 首次 `add` 時由 `store.save` 建立，不需預先建檔（不進版控） |

**不需動的檔**：`tools.js`（決策 4：不加 AI 工具）、`ai.js`、`conversation.js`、`config.js`、`index.js`、`line.js`。

---

## 3. 新服務模組 `src/services/shopping.js`

### 3.1 依賴與常數

- `const store = require('../store');`
- `const { toAscii } = require('./traTrain');` — 重用專案唯一的 `toAscii` 實作
  （`String(s).toLowerCase().replace(/đ/g,'d').normalize('NFD').replace(/[̀-ͯ]/g,'')`），
  避免各處各寫一份摺疊規則。traTrain 不 require shopping，無循環相依。
- `const FILE = 'shopping.json';`

### 3.2 資料模型

`shopping.json` 內容為陣列，每筆：

```
{ item: string, addedBy: string|null, addedAt: number }
```

- `item`：**保留使用者輸入的原文聲調符號**（例如 `nước mắm`、`醬油`），僅去頭尾空白。
- `addedBy`：存 `userId`，供未來擴充「誰加的」用；**v1 顯示上完全不使用**。
- `addedAt`：`Date.now()`，供未來排序／清理用。

### 3.3 比對鍵演算法（去重與刪除的核心）

比對鍵 `keyOf(name)`＝**去頭尾空白 → toAscii（小寫＋去聲調）**：

```
keyOf(name) = toAscii(String(name).trim())
```

理由與效果：
- 「醬油」與「 醬油 」→ 同鍵（PRD 驗收 3）。
- 「nước mắm」與「nuoc mam」（越南語使用者漏打聲調）→ 同鍵（PRD 驗收 10）：
  去重與刪除都認得同一項。
- 中文字不受 `toAscii` 影響（無可移除的組合附加符號），鍵即原字。

> ⚠️ 注意：`keyOf` 只用於**內部相等判斷**（去重／刪除定位），
> **不改寫 `item` 的儲存值**——存進 `shopping.json` 的永遠是原文。

### 3.4 函式簽章與回傳（回結構化資料，service 內不寫死中文）

```
list() -> Array<{item, addedBy, addedAt}>
  // 直接回 store.load(FILE)（store 對缺檔回 []，見 §4）

add(item, addedBy) -> { ok:true, added:boolean, already:boolean, item:string, total:number }
  // 演算法：
  //   name = String(item).trim()
  //   list = store.load(FILE)
  //   key  = keyOf(name)
  //   若 list 中存在 e 使 keyOf(e.item) === key：
  //        回 { ok:true, added:false, already:true, item:e.item, total:list.length }（不新增第二筆）
  //   否則 push { item:name, addedBy:addedBy||null, addedAt:Date.now() }；store.save；
  //        回 { ok:true, added:true, already:false, item:name, total:list.length }

remove(item) -> { ok:boolean, item:string, total:number }
  // 演算法（完全相符，不做部分／模糊比對）：
  //   key = keyOf(item)
  //   list = store.load(FILE)
  //   idx = list.findIndex(e => keyOf(e.item) === key)
  //   若 idx === -1：回 { ok:false, item:String(item).trim(), total:list.length }（清單不變）
  //   否則 splice 移除；store.save；回 { ok:true, item:removed.item, total:list.length }
  //   （回 removed.item = 原文，讓 handler 顯示實際刪掉的品項）

clear() -> number   // 回清空前的項數 n；n>0 才 store.save(FILE, [])
```

- 回傳都是純資料（`ok / added / already / item / total`），多語文案完全交給 `handler + lang.js`，
  比照 `expense.addWithId` 回 `{ id, total }` 的風格。
- 讀寫遵循 `store.load` 回 clone、`store.save` 存 clone 的語意：service 讀出一份可安全 mutate 的陣列，改完 `save` 回去，不污染快取。

### 3.5 `module.exports`

```
module.exports = { list, add, remove, clear };
```

---

## 4. `src/store.js` 改動

只在 `KNOWN_KEYS` 陣列補一個字串：

```
'alertSub.json', 'alert-state.json', 'shopping.json',
```

- **為何是硬需求**：`init()` 開機還原只針對 `KNOWN_KEYS` 逐鍵 GET；漏加則雲端（Upstash）
  模式下 Render 重啟／redeploy 不會還原這份清單，整份消失。這是本專案已知會踩的坑，
  PRD 驗收 11 要求斷言涵蓋。
- **缺檔初始化**：`load('shopping.json')` 在檔案不存在時，`readFileRaw` 回 `undefined`
  → `load` 回 `[]`（store.js L51）。購物清單資料模型正是陣列，**天然相容**，
  不需任何額外初始化程式；第一筆 `add` 的 `store.save` 會建立 `data/shopping.json`。

---

## 5. `src/handler.js` 掛載

### 5.1 引入服務

檔頭與其他 `require('./services/...')` 並列新增：

```
const shopping = require('./services/shopping');
```

### 5.2 掛載位置（關鍵）

route 插在 **`handleText` 內、所有既有指令 route 之後、AI fallback（`conversation.append` 那段）之前**——
具體放在「喝水提醒」區塊（L471–474）之後、「預設：AI 對話」（L476）之前。

此位置的兩個前提都成立：
1. `const asciiTrimmed = toAscii(trimmed);`（L339）已在作用域內，越南語 route 可直接用。
2. 已掃描過所有既有 route，**沒有任何一條會攔截**本功能的六種指令字串
   （`買 X`／`購物清單`／`買到 X`／`清空購物清單`／`mua X`／`danh sách/đã mua/xóa danh sách...`）；
   例如 `記帳\s+`、`提醒`、`就醫卡`、`am lich`、`ty gia` 等皆不相符，故放最後不會被前面吃掉。

### 5.3 route 內部順序與判斷式（中文用原文、越南語分兩類比對）

依序：**檢視 → 清空 → 完成刪除 → 加入**（各動作互斥，順序主要為可讀性；理由見 §5.5）。

```
// ── 購物清單 ─────────────────────────────────────────
// 檢視
if (trimmed === '購物清單' || /^danh sach mua sam$/.test(asciiTrimmed)) {
  const code = await lang.resolve(userId);
  const items = shopping.list();
  return items.length ? lang.shoppingList(code, items) : lang.shoppingEmpty(code);
}
// 清空
if (trimmed === '清空購物清單' || /^xoa danh sach mua sam$/.test(asciiTrimmed)) {
  const code = await lang.resolve(userId);
  return lang.shoppingCleared(code, shopping.clear());
}
// 完成刪除：買到 X（原文）／đã mua X（toAscii 比對、參數用原文切片）
const buyDoneZh = trimmed.match(/^買到\s+(.+)$/);
const buyDoneVi = asciiTrimmed.match(/^da mua\s+(.+)$/);
if (buyDoneZh || buyDoneVi) {
  const code = await lang.resolve(userId);
  let item;
  if (buyDoneZh) item = buyDoneZh[1].trim();
  else {
    const s = buyDoneVi.index + buyDoneVi[0].length - buyDoneVi[1].length; // 從原文切片保留聲調
    item = trimmed.slice(s).trim();
  }
  const r = shopping.remove(item);
  return r.ok ? lang.shoppingRemoved(code, r.item, r.total)
              : lang.shoppingNotFound(code, item, shopping.list());
}
// 加入：買 X（原文）／mua X（★用「原文 trimmed」比對，非 asciiTrimmed，見 §5.4）
const buyZh = trimmed.match(/^買\s+(.+)$/);
const buyVi = trimmed.match(/^mua\s+(.+)$/i);
if (buyZh || buyVi) {
  const code = await lang.resolve(userId);
  const item = (buyZh ? buyZh[1] : buyVi[1]).trim();
  const r = shopping.add(item, userId);
  return r.already ? lang.shoppingAlready(code, r.item)
                   : lang.shoppingAdded(code, r.item, r.total);
}
```

- 完成刪除的越南語走既有 `toAscii` 慣例（`^da mua\s+(.+)$`），並比照 `medMatch`／`tyGiaRestMatch`
  的**索引切片法**從原文取回品項（`toAscii` 只轉小寫／去聲調，不改字元數與位置，切片安全）。
- 加入的越南語**刻意不用 `asciiTrimmed`**，改用原文 `trimmed`（見 §5.4）。

### 5.4 加入指令的消歧義設計（PRD 邊界風險，務必照做）

**最終比對規則：加入指令用「原文（保留聲調）＋大小寫不敏感」比對 `^mua\s+(.+)$`（`/i`），不做聲調摺疊。**

原因：越南語 `mua`(買)／`mùa`(季節)／`mưa`(雨) 經 `toAscii` 去聲調後**都會塌成 `mua`**
（`ù` 的聲調、`ư` 的角標都是 NFD 後被移除的組合附加符號）。若沿用 `asciiTrimmed` 比對，
「Mùa đông」「Mưa to quá」會被誤判成新增品項。

用**原文**比對即可天然擋掉，因為：
- `mua`(買) 本身**不帶任何聲調符號**，所以原文 `mua ...` 能被 `^mua\s+(.+)$/i` 命中（`i` 只做 ASCII 大小寫折疊，`Mua`/`MUA` 皆可）。
- `mùa`(季節) 原文第二個字元是 `ù` ≠ `u`，`mưa`(雨) 原文是 `ư` ≠ `u`；`/i` 不會把帶聲調字元折疊成 `u`，故**兩者都不命中**，自然被排除。

因為直接對原文比對，`(.+)` 捕捉到的**就是原文品項**，不需要像刪除那樣再做索引切片。

> 殘留（PRD §邊界已接受）：使用者若打出「整句以 `mua ` 開頭」的非指令越南語句
> （如「Mua gì cũng được」），仍會被當成新增。此為 PRD 明列的可接受邊界風險，
> 若上線後家人頻繁誤觸再開下一輪調整（要求更明確的動詞片語）。

**其他指令的碰撞逐一檢查**（結論：沿用 `toAscii` 慣例安全）：
- 檢視 `^danh sach mua sam$`、清空 `^xoa danh sach mua sam$`：**整句錨定精確比對**，
  片語長、非以單字起手，一般聊天不會整句剛好等於它，碰撞可忽略。
- 完成刪除 `^da mua\s+(.+)$`：`da` 可能來自 `đã`(已)／`dạ`(是)／`đá` 等，`mua` 亦可能塌自 `mùa/mưa`。
  但需**同時**命中「`da` + 空白 + `mua` + 空白 + 內容」兩詞前綴，比單一 `mua` 具體得多，
  正常口語（如「Dạ, mua…」加標點）多半不會塌成剛好 `da mua ...`；此為低機率殘留，
  與 PRD 對 `mua` 開頭的可接受風險同級，v1 沿用 `toAscii`。
- 中文 `買 X`：`^買\s+(.+)$` 要求「買」後**緊接空白**，故「買菜錢還沒算」不觸發；`買到 X` 因「到」在「買」後也不會被加入規則吃掉。

### 5.5 route 動作順序說明

四動作在字面上互斥，順序不影響正確性，但採「檢視→清空→完成刪除→加入」以求清楚：
- `買到 X` 的原文開頭是「買到」，`^買\s+` 要求「買」後緊接空白，故加入規則不會誤吃「買到 …」。
- 越南語 `đã mua X`：原文開頭是 `đ`，加入規則 `^mua\s+/i` 不命中；刪除走 `asciiTrimmed` 的 `^da mua`，兩者天然分流。
- 檢視／清空為精確整句比對，與其他錨定字串互不重疊。

### 5.6 群組不回歸（設計層論證）

**完全不新增、也不修改任何群組相關程式**（`handleGroupText`／`handleGroupAudio`／`replyForEvent` 全部原封不動）。
在設計層即成立，理由：

- `replyForEvent`（L646–670）在最上游依 `src.type` 分流：
  `isGroup = src.type === 'group' || src.type === 'room'` 為真時，訊息**只**進
  `handleGroupText`／`handleGroupAudio` 後直接 return，**永遠不會抵達 `handleText`**。
- 本功能的四個 route **只**寫在 `handleText`（1-1 路徑）內。
- 因此群組傳「買 醬油」→ 進 `handleGroupText`（仍只做翻譯橋開關與中↔越翻譯）→
  **不可能觸發任何 `shopping.*` 呼叫**，`data/shopping.json` 不變、不丟例外、不多送訊息。
- 額外第二層保險維持不變：`replyForEvent` 對群組處理以 `.catch(() => null)` 兜底，
  即使未來群組路徑出錯也靜默、不洗版（本輪未觸碰此段）。

---

## 6. `src/lang.js` 多語字串

### 6.1 新增字串表（zh-TW／vi／en 三語；其餘語言依既有慣例 fallback 到 en）

比照現有 `RATE_ALERT_*`、`EXPENSE_*` 的模板 + getter 慣例（`{item}` 佔位、
`X[code] || (ja/th/id ? X.en : X['zh-TW'])` fallback）。vi 用字可交 coder 微調，結構固定。

| 常數 | 佔位 | zh-TW | vi | en |
|---|---|---|---|---|
| `SHOPPING_ADDED` | `{item}` `{total}` | `🛒 已加入：{item}\n購物清單目前有 {total} 項` | `🛒 Đã thêm: {item}\nDanh sách hiện có {total} món` | `🛒 Added: {item}\nThe list now has {total} item(s)` |
| `SHOPPING_ALREADY` | `{item}` | `🛒「{item}」已經在購物清單上了。` | `🛒 "{item}" đã có trong danh sách rồi.` | `🛒 "{item}" is already on the list.` |
| `SHOPPING_LIST_HEADER` | `{total}` | `🛒 購物清單（{total} 項）：` | `🛒 Danh sách mua sắm ({total} món):` | `🛒 Shopping list ({total} item(s)):` |
| `SHOPPING_EMPTY` | — | `🛒 目前購物清單是空的。\n輸入「買 醬油」即可加入。` | `🛒 Danh sách mua sắm hiện đang trống.\nGõ 「mua nước mắm」để thêm món.` | `🛒 The shopping list is empty.\nType 「買 醬油」/「mua ...」to add an item.` |
| `SHOPPING_REMOVED` | `{item}` `{total}` | `✅ 已買到並從清單刪除：{item}\n還剩 {total} 項` | `✅ Đã mua và xoá khỏi danh sách: {item}\nCòn lại {total} món` | `✅ Bought and removed: {item}\n{total} item(s) left` |
| `SHOPPING_NOT_FOUND` | `{item}` `{list}` | `🛒 清單上沒有找到「{item}」。\n目前購物清單：\n{list}` | `🛒 Không tìm thấy "{item}" trong danh sách.\nDanh sách hiện tại:\n{list}` | `🛒 "{item}" was not found on the list.\nCurrent list:\n{list}` |
| `SHOPPING_CLEARED` | `{n}` | `🗑 已清空購物清單（原本有 {n} 項）。` | `🗑 Đã xoá toàn bộ danh sách mua sắm (trước đó có {n} món).` | `🗑 Shopping list cleared ({n} item(s) removed).` |

### 6.2 getter 函式（加入 `module.exports`）

- 內部小工具 `shoppingBullets(items)`：`items.map(e => '・' + e.item).join('\n')`。
- `shoppingList(code, items)`：`HEADER[code]`（依 fallback 規則）取模板 →
  `.replace('{total}', items.length)` + `'\n'` + `shoppingBullets(items)`。
- `shoppingEmpty(code)`：回 `SHOPPING_EMPTY[code]`（fallback）。
- `shoppingAdded(code, item, total)`：模板 `.replace('{item}', item).replace('{total}', fmtNum(total))`。
- `shoppingAlready(code, item)`：模板 `.replace('{item}', item)`。
- `shoppingRemoved(code, item, total)`：`.replace('{item}', item).replace('{total}', fmtNum(total))`。
- `shoppingNotFound(code, item, items)`：模板 `.replace('{item}', item)`，
  `{list}` 代入 `items.length ? shoppingBullets(items) : (空清單佔位字)`；
  空清單佔位字可用 zh「（目前是空的）」/ vi「(trống)」/ en「(empty)」。
- `shoppingCleared(code, n)`：`.replace('{n}', n)`。

以上 getter 一律沿用 `code || (ja/th/id ? .en : .['zh-TW'])` fallback，
並加進檔尾 `module.exports`。`fmtNum` 已存在（L1043）可直接重用。

### 6.3 `HELP_MENU` 增列（PRD F6／驗收 15）

在 zh-TW／vi／en 三份 `HELP_MENU` 各加購物清單說明，涵蓋**全部四個指令**（滿足驗收 15
「選單文字包含新增的四個購物清單指令說明」）。與既有選單一行多指令的密度一致，
建議每語言一行、以「｜」分隔四動作（若偏好逐指令列則展開為多行亦可）：

- zh-TW：
  `🛒 購物清單：「買 醬油」加入｜「購物清單」查看｜「買到 醬油」刪除｜「清空購物清單」清空`
- vi：
  `🛒 Danh sách mua sắm: 「mua nước mắm」thêm｜「danh sách mua sắm」xem｜「đã mua nước mắm」đã mua｜「xóa danh sách mua sắm」xoá hết`
- en：
  `🛒 Shopping list: 「買 醬油」/「mua ...」add｜「購物清單」view｜「買到 X」/「đã mua X」remove｜「清空購物清單」clear`

（`helpMenu(code)` 對 ja/th/id 已回落 en，無需另加。）

---

## 7. 流程（使用者輸入 → 路由 → 處理 → 回覆）

```
LINE webhook → index.js → replyForEvent(event)
   ├─ isGroup(group/room)? ── 是 → handleGroupText/Audio（純翻譯橋，永不進購物清單）
   └─ 否（1-1）→ handleText(userId, text)
        ├─ 既有 pending 攔截、既有指令 route …（全部不相符）
        ├─ asciiTrimmed = toAscii(trimmed)
        ├─ 【購物清單 route】
        │    ├─ 「購物清單」/「danh sách mua sắm」 → shopping.list() → lang.shoppingList / shoppingEmpty
        │    ├─ 「清空購物清單」/「xóa danh sách mua sắm」 → shopping.clear() → lang.shoppingCleared
        │    ├─ 「買到 X」/「đã mua X」 → shopping.remove(item) → lang.shoppingRemoved / shoppingNotFound
        │    └─ 「買 X」/「mua X」(原文比對) → shopping.add(item,userId) → lang.shoppingAdded / shoppingAlready
        └─ 皆不符 → AI 對話 fallback
```

每個回覆前先 `code = await lang.resolve(userId)`，用該語言字串回覆（比照既有慣例）。

---

## 8. 測試策略（對齊 PRD 17 條驗收；可離線照做）

### 8.1 測試鐵律（驗收 17）

- **不** `require('../src/index.js')`、**不**呼叫 `.start()`；只 `require` service／handler／store。
- 每支測試結尾 `process.exit(0)`。
- 不發真實 LINE 訊息。
- 動 `data/shopping.json` 前先備份（若存在則讀出原內容暫存），測試後**逐字還原**，
  原本不存在則刪除新建檔；不得殘留測試資料。
- 建議也備份／還原 `data/lang.json`（測試會為測試 `userId` 種語言記錄）。

### 8.2 環境準備（讓測試離線可跑）

- **語言控制**：呼叫 handler 前先 `store.save('lang.json', [{ userId:TEST_UID, lang:'zh-TW', locked:true }])`
  （或 `'vi'`）。這樣 `lang.resolve` 直接命中記錄、**不會**去打 `client.getProfile`（離線會失敗），
  回覆語言也可控。
- `require('../src/handler')` 會連帶 `require('../src/line')`；`line.js` 在載入時只是用
  （可能為空的）token 建立 client 物件，**不發網路請求**，故離線 require 安全。
- 所有測試輸入都會命中購物清單 route 並提早 return，**不會**走到 `ai.chat`，因此無需 Groq 金鑰。

### 8.3 逐條對應

| 驗收 | 測法（離線） |
|---|---|
| 1 加入「買 醬油」 | 空清單下 `handleText(uid,'買 醬油')`；斷言回覆含「醬油」「已加入」；`store.load('shopping.json')` 有一筆 `item==='醬油'` |
| 2 重複加入不新增 | 再 `'買 醬油'`；斷言清單仍 1 筆；回覆走 `shoppingAlready`（含「已經在」而非「已加入」） |
| 3 多餘空白同一項 | `'買 醬油 '`、`'買  醬油'` 各測；斷言仍 1 筆 |
| 4 越南語保留聲調 | `'mua nước mắm'`；斷言新增一筆 `item==='nước mắm'`（**非** `nuoc mam`） |
| 5 檢視含所有品項 | 混加中／越品項後 `'danh sách mua sắm'`；斷言回覆含各品項原文 |
| 6 空清單檢視 | 清空後 `'購物清單'`；斷言回非空字串的提示句（`shoppingEmpty`），不報錯 |
| 7 刪除後只剩一項 | 加「醬油」「衛生紙」後 `'買到 衛生紙'`；斷言回覆表已刪除；再 `'購物清單'` 只剩「醬油」 |
| 8 刪不存在 | `'買到 不存在的東西'`；斷言回覆含該品名且為找不到；清單筆數不變；回覆內附目前清單 |
| 9 清空 | 加 ≥2 項後 `'清空購物清單'`；斷言回覆含原項數；再 `'購物清單'` 回空清單提示 |
| 10 ascii 變體路由 | `'mua trứng'`→建立原文 `trứng`；`'danh sach mua sam'`、`'da mua trung'`（去聲調刪到 `trứng`）、`'xoa danh sach mua sam'` 皆正確路由 |
| 11 KNOWN_KEYS | `require('../src/store')._internal.KNOWN_KEYS.includes('shopping.json') === true` |
| 12 重啟持久化 | `add` 後 `store._internal.cache.delete('shopping.json')`（或 `cache.clear()`）→ `store.load('shopping.json')` 仍讀得到該品項（證明有落檔，非僅記憶體） |
| 13 群組不回歸 | 見 §8.4 |
| 14 未加 AI 工具 | `require('../src/tools').defs` 長度維持既有值；且無任一 `def.function.name` 含 `shopping` |
| 15 help 選單 | `lang.helpMenu('zh-TW')` 與 `lang.helpMenu('vi')` 皆含購物清單四指令字樣 |
| 16 語法檢查 | 對 `shopping.js`／`handler.js`／`lang.js`／`store.js` 跑 `node --check` 全過 |
| 17 鐵律 | 見 §8.1 |

### 8.4 群組不回歸測法（驗收 13，離線且不觸網）

- 準備：`groupTranslate.setEnabled(TEST_GID, false)`（關閉翻譯橋）→ `handleGroupText`
  在 L609 立即 `return null`，**不會**呼叫 `translateFor`（避免任何 AI／網路呼叫）。
- 快照 `data/shopping.json`（或 `store.load` 結果）。
- 呼叫 `handler.handleGroupText(TEST_GID, '買 醬油')`（或用 `replyForEvent` 帶
  `{ type:'message', source:{ type:'group', groupId:TEST_GID }, message:{ type:'text', text:'買 醬油' } }`）。
- 斷言：回傳 `null`／不丟例外；`data/shopping.json` 與快照**逐字相同**（無新增）。
- （可選）另測 `bridgeDirection` 判斷結果不因本功能而改變——因未觸碰 `handleGroupText`，行為本就一致。

### 8.5 mua/mùa/mưa 碰撞必測（PRD 邊界，務必涵蓋）

- `handleText(uid,'Mưa to quá')` → **不得**新增品項；`shopping.json` 不變（會落到 AI fallback，
  測試可攔截 `ai.chat` 或斷言 shopping 未變化即可）。
- `handleText(uid,'Mùa đông')` → 同上，不得新增。
- `handleText(uid,'mua trứng')` → **必須**新增 `item==='trứng'`。
- （建議）`handleText(uid,'Mua trứng')`（首字大寫）→ 因 `/i` 亦應新增 `trứng`。

> 為避免碰撞測試因 AI fallback 觸網不穩，建議在測試中 monkeypatch `ai.chat` 回固定字串，
> 或直接以「呼叫前後 `store.load('shopping.json')` 筆數不變」作為斷言主體（不依賴回覆內容）。

---

## 9. 風險與取捨

- **`mua ` 開頭的非指令越南語句**會被當新增（如「Mua gì cũng được」）：PRD §邊界已明列為
  可接受風險。用原文比對已擋掉 `mùa/mưa` 這類同音塌陷，剩餘的是「真的以 mua 開頭祈使句」的少數情形；
  上線後如高頻誤觸再開下一輪收斂（要求更明確片語）。
- **`đã mua`（`da mua`）低機率碰撞**（如「Dạ, mua…」塌成 `da mua …`）：兩詞前綴已相當具體，
  風險等級與 PRD 既有描述相同，v1 沿用 `toAscii` 慣例不特別處理。
- **多人同時寫入**：沿用 `store.js` 的 debounce write-behind，短時間雙寫有極小機率「最後寫入覆蓋」，
  與 `expense.js` 等既有功能同級，不特別處理。
- **全域共用、無權限**：任何人可清空整份清單且無二次確認——這是 PRD 決策（家庭小工具、
  與其他清空類指令一致），以「回覆附原有項數」作為最低限度的告知。
- **不加 AI 工具**：省 Groq 每日 token 額度（工具 schema 每則訊息都要傳給模型）；
  代價是只認固定句型、不支援口語自然語句，符合決策 4，未來可用實際使用資料再評估。
- **重用 `toAscii`（from `traTrain`）**：好處是單一摺疊規則來源、與 handler 其他越南語 route 完全一致；
  相依方向 shopping → traTrain 無循環風險。

---

## 附：改動摘要（回報用）

- **改動檔案**：新增 `src/services/shopping.js`；修改 `src/handler.js`（掛 route＋require）、
  `src/lang.js`（7 組多語字串＋getter＋helpMenu 三語）、`src/store.js`（`KNOWN_KEYS` 加 `'shopping.json'` 一行）。
- **加入指令消歧義最終規則（一句話）**：加入指令用「原文（保留聲調）＋大小寫不敏感」比對
  `^mua\s+(.+)$`（不做 `toAscii` 聲調摺疊），因 `mua`(買) 本身無聲調符號可命中，而 `mùa/mưa`
  第二字元是 `ù/ư`≠`u` 天然被排除；其餘指令沿用專案 `toAscii` 慣例。
- **群組不回歸為何在設計層成立**：四個 route 只寫在 `handleText`（1-1）；`replyForEvent` 在上游
  依 `src.type` 就把群組／room 訊息分流進 `handleGroupText`（未改動、純翻譯橋）並直接 return，
  **永不進 `handleText`**，故群組「買 醬油」不可能觸發任何 `shopping.*`。

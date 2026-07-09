# TEST — 家庭共用購物清單（shopping-list）

> 測試者：RD#4（獨立測試工程師，未信任實作者自檢，依 `PRD.md` 驗收條件 1–17 重新撰寫測試）
> 對應 PRD：`docs/loop/shopping-list/PRD.md`　對應 DESIGN：`docs/loop/shopping-list/DESIGN.md`
> 受測程式：`src/services/shopping.js`（新）、`src/handler.js`、`src/lang.js`、`src/store.js`

## 判定：**全 PASS**（18/18，涵蓋 PRD 驗收 1–17 全部條件）

---

## 前置：`node --check`

對 `src/**/*.js` 全部檔案（含四個受影響檔）逐一跑 `node --check`，全過，無語法錯誤：

```
src/services/shopping.js  OK
src/handler.js             OK
src/lang.js                OK
src/store.js                OK
（其餘 src/**/*.js 亦全過）
```

對應 **驗收 16：PASS**。

---

## 測試方式

離線 Node 腳本（未提交，放在 scratchpad 暫存目錄），只 `require`
`src/store` / `src/ai`（monkeypatch `chat`）/ `src/services/shopping` / `src/lang` /
`src/tools` / `src/services/groupTranslate` / `src/handler`；**不** `require('../src/index.js')`、
**不**呼叫 `.start()`、**不**發真實 LINE 訊息（chat 訊息一律由本地 route 提早 return 或
monkeypatch 攔截）、腳本結尾 `process.exit(0)`。

環境準備：
- 用 `store.save('lang.json', [...])` 為兩個假測試 userId（`test-shopping-zh-9f13` 語言 zh-TW、
  `test-shopping-vi-9f13` 語言 vi）種語言記錄，避免 `lang.resolve` 觸發 `client.getProfile`。
- `ai.chat` 被 monkeypatch 成回固定字串，避免消歧義測試落入 AI fallback 時真的打 Groq。
- 每個驗收區塊測試前用 `store.save('shopping.json', [])` 重設清單，互不污染。

資料清理：
- 測試前備份 `data/shopping.json`（測試前不存在）、`data/lang.json`、`data/groupTranslate.json`；
  測試結束逐字還原／刪除新建檔。事後確認：
  - `git status --porcelain -- data/` 無輸出（`data/` 本身在 `.gitignore` 中，逐字比對亦確認乾淨）。
  - `data/shopping.json` 測試後已刪除（原本就不存在）。
  - `data/lang.json` 還原後長度與原檔一致（1219 bytes），不含 `test-shopping-*` 殘留字樣。

對應 **驗收 17：PASS**。

---

## 逐條驗收結果

| # | 驗收條件 | 結果 | 關鍵斷言 |
|---|---|---|---|
| 1 | 空清單「買 醬油」→ 含「醬油」＋「已加入」，存檔一筆 | PASS | 回覆 `🛒 已加入：醬油\n購物清單目前有 1 項`；`shopping.json` 1 筆 `item==='醬油'` |
| 2 | 重複「買 醬油」不新增第二筆 | PASS | 清單仍 1 筆；回覆 `🛒「醬油」已經在購物清單上了。`（不含「已加入」） |
| 3 | 「買 醬油 」／「買  醬油」（多餘空白）視為同一品項 | PASS | 兩次呼叫後清單仍 1 筆 |
| 4 | 「mua nước mắm」新增品項保留聲調 | PASS | 新增 `item==='nước mắm'`；清單中**不存在** `'nuoc mam'` |
| 5 | 「danh sách mua sắm」回覆含所有品項（中越混合） | PASS | 回覆同時含「醬油」與「nước mắm」 |
| 6 | 空清單「購物清單」回提示句（非空字串、不報錯） | PASS | 回覆 `🛒 目前購物清單是空的。\n輸入「買 醬油」即可加入。` |
| 7 | 加「醬油」「衛生紙」後「買到 衛生紙」→ 只剩「醬油」 | PASS | 回覆含「已買到並從清單刪除：衛生紙」；再查清單只剩「醬油」 |
| 8 | 「買到 不存在的東西」→ 找不到＋含品名＋附清單＋清單不變 | PASS | 回覆含「不存在的東西」與目前清單；刪除前後清單逐字相同 |
| 9 | 加 ≥2 項後「清空購物清單」→ 回覆含原項數，再查為空清單提示 | PASS | 回覆 `🗑 已清空購物清單（原本有 2 項）。`；清空後清單長度 0 |
| 10 | 越南語 ascii 變體：`mua trứng`／`danh sach mua sam`／`da mua trung`／`xoa danh sach mua sam` 皆正確路由 | PASS | 見下方完整回覆樣本；無聲調輸入成功比對到有聲調品項 `trứng` 並刪除 |
| 11 | `store._internal.KNOWN_KEYS` 含 `'shopping.json'` | PASS | 陣列末端確認含 `'shopping.json'` |
| 12 | 模擬重啟（`add` 後清 `store._internal.cache`，`store.load` 仍讀得到） | PASS | 清 cache 後 `store.load('shopping.json')` 仍含 `item==='泡麵'`，證明有落檔非僅記憶體 |
| 13 | 群組不回歸：`source.type==='group'` 傳「買 醬油」不觸發新增、不丟例外、不多送訊息 | PASS | 見下方「群組不回歸」小節 |
| 14 | `tools.js` 的 `defs` 未新增購物清單相關 AI 工具 | PASS | `defs` 14 個工具名稱中無任何含 `shopping` 字樣（且本次改動未觸碰 `tools.js`，`git log` 確認） |
| 15 | `/help`（中）與 `trợ giúp`（越）選單含四個購物清單指令 | PASS | `lang.helpMenu('zh-TW')`／`lang.helpMenu('vi')` 皆含四動作說明（另附帶檢查 `en` 版亦含） |
| 16 | 所有新增/修改檔案 `node --check` 全過 | PASS | 見上方前置章節 |
| 17 | 測試鐵律遵守 | PASS | 見上方「測試方式」章節 |

**總計：18/18 PASS**（含 PRD 17 條驗收 + DESIGN §8.5 額外要求的消歧義／越南語刪除索引切片必測，
兩者被拆成獨立斷言各自 PASS，實質內容仍完全覆蓋驗收 10 與邊界風險章節的要求）。

---

## 關鍵輸出樣本

### 中文加入 + 檢視（完整回覆字串）

```
> handleText(UID, '買 醬油')
🛒 已加入：醬油
購物清單目前有 1 項

> handleText(UID, '買 衛生紙')
（略，同上型式）

> handleText(UID, '購物清單')
🛒 購物清單（2 項）：
・醬油
・衛生紙
```

（上表對照的是測試腳本中 #5/#7 步驟的實際輸出；#7 刪除後查看：
`🛒 購物清單（1 項）：\n・醬油`）

### 越南語加入 + 檢視 + 刪除（完整回覆字串，`UID_VI` 語言=vi）

```
> handleText(UID_VI, 'mua nước mắm')
🛒 Đã thêm: nước mắm
Danh sách hiện có 1 món

> handleText(UID_VI, 'danh sách mua sắm')
🛒 Danh sách mua sắm (1 món):
・nước mắm

> handleText(UID_VI, 'đã mua nước mắm')
✅ Đã mua và xoá khỏi danh sách: nước mắm
Còn lại 0 món
```

聲調符號在加入、檢視、刪除全程保持原文（`nước mắm`），未被 `toAscii` 摺疊污染儲存值。

### 越南語 ascii 變體路由（驗收 10，完整回覆字串）

```
> handleText(UID, 'mua trứng')
🛒 已加入：trứng
購物清單目前有 1 項

> handleText(UID, 'danh sach mua sam')      ← 無聲調輸入
🛒 購物清單（1 項）：
・trứng

> handleText(UID, 'da mua trung')            ← 無聲調輸入，成功刪除有聲調品項
✅ 已買到並從清單刪除：trứng
還剩 0 項

> handleText(UID, 'xoa danh sach mua sam')   ← 無聲調輸入
🗑 已清空購物清單（原本有 0 項）。
```

### 越南語刪除索引切片實測（PRD §邊界風險，特別必測項目 3）

- `mua nước mắm` 加入後，`đã mua nước mắm`（完整聲調、含「đã」）刪除成功，
  回覆 `✅ Đã mua và xoá khỏi danh sách: nước mắm\nCòn lại 0 món`，品項字串完整無損。
- 多詞品項切片：`mua bánh mì` 加入後，`da mua banh mi`（無聲調、多詞）刪除成功，
  回覆 `✅ 已買到並從清單刪除：bánh mì\n還剩 0 項`——證明 `asciiTrimmed` 命中位置換算回
  原文字串時，多詞、含聲調的品項切片沒有切錯位置或斷字。

### mua / mùa / mưa 消歧義實測（特別必測項目 1）

| 輸入 | 預期 | 實測結果 |
|---|---|---|
| `Mưa to quá` | 不得新增品項（落 AI fallback） | PASS：`shopping.json` 呼叫前後逐字不變（monkeypatch `ai.chat` 回固定字串，未觸網） |
| `Mùa đông` | 不得新增品項 | PASS：`shopping.json` 呼叫前後逐字不變 |
| `mua trứng` | 必須新增 `item==='trứng'` | PASS：清單新增一筆 `trứng` |
| `Mua sữa`（首字大寫） | 必須新增 `item==='sữa'`（`/i` 大小寫不敏感） | PASS：清單新增一筆 `sữa` |

根因驗證：加入指令的 route（`buyVi = trimmed.match(/^mua\s+(.+)$/i)`）刻意比對**原文**
（非 `asciiTrimmed`），因此 `mùa`／`mưa` 第二個字元帶聲調（`ù`/`ư`）不會被折成 `u`、
天然不命中此 regex，只會落到 AI 對話 fallback，不會誤觸發購物清單新增。

### 群組不回歸實測（特別必測項目 2）

- 先 `groupTranslate.setEnabled(GID, false)` 關閉該群組翻譯橋（使 `handleGroupText`
  在最上層立即 `return null`，不觸網、不呼叫 `translateFor`）。
- 呼叫 `handler.replyForEvent({ type:'message', source:{type:'group', groupId:GID},
  message:{type:'text', text:'買 醬油'} })`。
- 實測：回傳值為 `null`；未丟出例外（`threw === false`）；呼叫前後 `data/shopping.json`
  檔案內容**逐字相同**（`before === after` 為 `true`）。
- 結論：群組路徑完全未觸及 `shopping.*` 任何函式，與 DESIGN §5.6 的設計層論證一致
  （`replyForEvent` 依 `source.type` 分流，群組訊息永遠不進 `handleText`）。

---

## 補充檢查（非 PRD 硬性條列，但屬合理延伸覆蓋）

- `lang.helpMenu('en')` 亦含 `Shopping list` 說明（三語 fallback 完整，非僅 zh-TW/vi）。
- `tools.defs` 完整 14 個工具名稱列出確認皆與購物清單無關；另以 `git log -- src/tools.js`
  確認本次改動未觸碰該檔（最後一次改動早於本 feature 分支）。

---

## 結論

本次「家庭共用購物清單」實作，**PRD 驗收條件 1–17 全數通過（18/18 個別斷言 PASS）**，
無需回修。特別高風險的 `mua/mùa/mưa` 消歧義與越南語刪除索引切片、群組不回歸三項皆已
獨立離線驗證，行為與 DESIGN 文件描述一致。

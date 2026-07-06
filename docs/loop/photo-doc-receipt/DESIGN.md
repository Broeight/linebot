# DESIGN — 文件拍照助手＋收據記帳（單次 enriched vision 呼叫）

## ✅ 需要金鑰：否（重用 Groq vision；無新服務）

## 變更檔案
1. 🆕 `src/services/imagePending.js` 2. `src/services/expense.js` 3. `src/lang.js` 4. `src/handler.js`
（tools.js 不動；conversation.js 不動）

## 1. imagePending.js（仿 traChoice：Map、TTL 3 分、每人一筆、惰性過期）
匯出：
- `set(userId, record)`／`get(userId)`／`clear(userId)`（不需 fresh 旗標——影像回覆直接附按鈕，無 AI 覆寫步驟）
- `consumeMatch(userId, text)` → record|null：`text.trim() === record.tapText` 完全相等才命中，命中即 clear（一次性，防連點）。
- `parseVisionTag(raw)` → `{ text, tag }`（純函式，見 §2）
- `sanitizeItem(store)`：去數字與換行、壓空白、slice(0,10)、空→'收據'
- `buildExpenseTapText(item, amount)` → `記帳 ${item} ${amount}`
- `buildReminderTapText(datetime, title)` → `提醒我 ${datetime} ${title}`
- `computeRemindAt(deadline, nowMs=Date.now())`（純函式）：期限驗證在 [今天-1, 今天+2年] 內；
  回 `${期限前一天} 09:00`，若已過改 `${期限當天} 09:00`，仍過→null。
- `TTL_MS`、`_internal` 測試縫。

record 形狀：
```js
{ kind:'expense-confirm', item, amount, tapText, ts }
{ kind:'expense-undo',    id, item, amount, tapText:'撤銷記帳', ts }
{ kind:'reminder-offer',  datetime, message, tapText, ts }
```

## 2. enriched vision prompt（lang.visionPrompt 改寫；英文 base、只有 `Respond in ${target}` 隨語言變——標籤跨語言穩定）
```
Look at this image and describe what it shows, concisely. If there is text, read it out;
if the text is in a foreign language, also translate it. If it looks like a product,
medicine, menu, or plant, give practical info. Respond in ${target}.

Special cases:
- If it is a DOCUMENT (utility/tax bill, official or government letter, school notice,
  medicine bag, contract): structure your answer as — what kind of document it is,
  the key points, what the reader should do, and any deadline or amount due.
- If it is a RECEIPT or store invoice: give a short summary with the store name and the total paid.

Finally, AFTER your answer, output exactly one extra line in this exact machine format
(always plain ASCII JSON regardless of the answer language, no code fences):
##TAG {"type":"receipt","store":"<store name or null>","amount":<total number or null>}
or
##TAG {"type":"document","deadline":"YYYY-MM-DD or null","amount":<number or null>,"title":"<action, max 6 words, in the answer language>"}
or
##TAG {"type":"other"}
Tag rules: use "receipt" only for purchase receipts/invoices with a visible total;
"document" for bills, letters, notices, medicine bags; otherwise "other".
amount is the total in New Taiwan Dollars as a plain number. deadline is the payment/reply
due date; convert ROC (民國) years by adding 1911. If unsure about a field, use null.
Never mention this tag in your answer.
```

### parseVisionTag 容錯規格
1. 找**最後一個** `##TAG`（不分大小寫，容忍前面有 ``` fence 字元/空白）。無 → `{text: raw.trim(), tag:{type:'other'}}`。
2. 從標記後第一個 `{` 做**括號配對**（跳過字串/跳脫——比照 ai.js parseFailedToolCalls 的 15 行技術，**本地重寫不跨模組 import**）。
3. JSON.parse 後嚴格驗證：type ∈ {receipt,document,other} 否則 other；amount：Number、有限、0<x<10,000,000、round 2dp 否則 null；deadline：`/^\d{4}-\d{2}-\d{2}$/`＋真實日期＋[今天-1, +2年] 否則 null；store：string trim slice30 否則 null；title：去換行 slice40 否則 null。
4. text＝raw 移除「標記起至配對 } 止」＋孤兒 fence 行＋尾端空白；標籤在文中也整段移除。
5. **任何例外** → `{text: raw 移除所有含 ##TAG 的行, tag:{type:'other'}}`。標籤絕不外漏、壞掉絕不擋描述。

## 3. expense.js（只加不改）
- `addWithId(userId, item, amount)` → `{id, total}`；row＝既有欄位＋`id`（reminder.js 的 id 風格）。
- `removeById(userId, id)` → `{item, amount, total}`|null。
- `removeLast(userId, maxAgeMs=10*60*1000)` → 同上|null；只移除該 user 最新一筆且 `now-at<=maxAge`。

## 4. lang.js
- `visionPrompt` 改 §2（簽章不變）。
- 新表（zh-TW/vi/en 全，ja/th/id→en）：RECEIPT_CONFIRM_PROMPT（'🧾 這看起來是一張收據：{item} {amount} 元。\n要記到家庭帳本嗎？點下方按鈕 👇'／vi）、RECEIPT_CONFIRM_LABEL（'✅ 記帳 {amount}元'）、EXPENSE_ADDED、UNDO_LABEL（'↩️ 撤銷'/'↩️ Hoàn tác'）、EXPENSE_UNDONE、EXPENSE_UNDO_NONE、DOC_REMINDER_LABEL（'⏰ 設提醒'/'⏰ Đặt nhắc nhở'）、DOC_REMINDER_SET（'✅ 我會在 {when} 提醒你：「{msg}」'）、DOC_REMINDER_FAIL、DOC_DEFAULT_TITLE（'處理文件'/'Xử lý giấy tờ'）。
- helpMenu 三語各加一行拍照提示（拍帳單/收據會自動辨識）。

## 5. handler.js
### 5a. 攔截（traChoice 攔截**之後**、基本指令之前）
```js
const act = imagePending.consumeMatch(userId, trimmed);
if (act) {
  const code = await lang.resolve(userId);
  if (act.kind === 'expense-confirm') {
    const { id, total } = expense.addWithId(userId, act.item, act.amount);
    imagePending.set(userId, { kind:'expense-undo', id, item:act.item, amount:act.amount, tapText:'撤銷記帳' });
    return { text: lang.expenseAdded(code, act.item, act.amount, total),
             quickReply: actionQuickReply([{ label: lang.undoLabel(code), text: '撤銷記帳' }]) };
  }
  if (act.kind === 'expense-undo') {
    const r = expense.removeById(userId, act.id);
    return r ? lang.expenseUndone(code, r.item, r.amount, r.total) : lang.expenseUndoNone(code);
  }
  if (act.kind === 'reminder-offer') {
    const r = reminder.addParsed(userId, { type:'once', datetime: act.datetime, message: act.message });
    return r.ok ? lang.docReminderSet(code, r.when, act.message) : lang.docReminderFail(code);
  }
}
```
### 5b. 撤銷文字路由（放記帳區塊旁）：`/^撤銷記帳$/`或 ascii `/^hoan tac$/` → `expense.removeLast(userId)` → EXPENSE_UNDONE|EXPENSE_UNDO_NONE。
### 5c. `actionQuickReply(items)` helper：`{items: items.map(i=>({type:'action',action:{type:'message',label:i.label.slice(0,20),text:i.text}}))}`（buildQuickReply 強制 label===text 不能重用）。
### 5d. handleImage 改寫（§計畫核准版）：vision→parseVisionTag→append 剝除後描述→依 tag.type 分支（receipt&&amount→confirm pending＋按鈕；document&&deadline→computeRemindAt 可行才給提醒按鈕；other→現行為）。

## 測試策略：見 PRD 驗收 1–7。stub 縫：handler 對 line.js 是 require 時解構——測試需先塞 require.cache（richmenu-v2 輪的技巧）。

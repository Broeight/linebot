# DESIGN — 家庭群組翻譯橋

## ✅ 需要金鑰：否（重用既有 Groq；LINE 群組事件是 Messaging API 標準功能）

## 已驗證的 SDK 事實（node_modules/@line/bot-sdk v11 型別）
- 群組來源：`event.source = { type:'group', groupId, userId? }`；多人聊天室 `{ type:'room', roomId, userId? }`。
- 加入事件：`event.type === 'join'`，帶 `replyToken`（可直接 reply）。
- 回覆管線不用改：`index.js` `handleEvent` 已依 `replyToken` 回覆，群組/一對一同一條路。
  但 `handleEvent` 只處理 `replyForEvent`，join 事件目前會被 `event.type !== 'message'` 擋掉 →
  **在 `replyForEvent` 開頭加 join 分支**（index.js 不動）。

## 變更檔案
1. `src/services/groupTranslate.js`（新）— 開關狀態 + 翻譯橋核心
2. `src/handler.js` — 群組路由分流 + join 歡迎
3. `src/lang.js` — 不動（`detect` 已可用：exports 需確認，若未匯出 `detect` 則匯出）

> 注意：`lang.detect(text)` 目前是內部函式——**需匯出**（只加 export，不改邏輯）。

## 1. src/services/groupTranslate.js

### 1a. 開關狀態
```js
const store = require('../store');
const FILE = 'groupTranslate.json';   // { [groupId]: { enabled: boolean } }
function isEnabled(groupId) { const s = store.load(FILE); const g = s && s[groupId]; return g ? g.enabled !== false : true; } // 預設開
function setEnabled(groupId, on) { const s = store.load(FILE) || {}; s[groupId] = { enabled: !!on }; store.save(FILE, s); }
```
> `store.load` 對不存在檔案的回傳形狀要先看 store.js（陣列或物件），照現況適配。

### 1b. 判斷與翻譯
```js
const ai = require('../ai');
const lang = require('../lang');

// 訊息是否值得翻譯：去掉 URL/emoji/空白後至少 2 個「字母或 CJK」字元
function isSubstantial(text) { ... }

// 回 'vi' | 'zh' | null（其他語言/無法判斷）
function bridgeDirection(text) {
  const code = lang.detect(text);          // 既有偵測（vi 特徵字元、CJK…）
  if (code === 'vi') return 'vi';
  if (/[一-鿿]/.test(text)) return 'zh';  // detect 對中文回 zh-TW 或 null 都涵蓋
  return null;
}

// 翻譯：只輸出譯文。失敗回 ''（呼叫端靜默）。
async function translateFor(direction, text) {
  const sys = direction === 'vi'
    ? '把使用者訊息翻譯成繁體中文。只輸出譯文本身，不要任何解釋、引號或前綴。'
    : 'Dịch tin nhắn của người dùng sang tiếng Việt. Chỉ xuất bản dịch, không giải thích, không dấu ngoặc kép, không tiền tố.';
  return await ai.ask(sys, text);           // ai.ask 已 never-throw、失敗回 ''
}
```
匯出：`{ isEnabled, setEnabled, bridgeDirection, isSubstantial, translateFor }`。

## 2. src/handler.js

### 2a. `replyForEvent` 改法（最小侵入）
```js
async function replyForEvent(event) {
  // bot 被拉進群組 → 中越雙語簡介
  if (event.type === 'join') return groupIntroText();
  if (event.type !== 'message') return null;
  const src = event.source || {};
  const isGroup = src.type === 'group' || src.type === 'room';
  const groupId = src.groupId || src.roomId;
  const userId = src.userId;
  const msg = event.message;
  if (isGroup) {
    if (msg.type === 'text') return handleGroupText(groupId, msg.text);
    if (msg.type === 'audio') return handleGroupAudio(groupId, msg.id);
    return null; // 群組內圖片/貼圖等一律安靜
  }
  // …以下維持既有一對一分派（text/audio/image/location）不動…
}
```

### 2b. `handleGroupText(groupId, text)`
```js
const trimmed = (text || '').trim();
// 開關（中/越）；比對用 toAscii 摺疊處理越南語
if (/^翻譯關$/.test(trimmed) || /^tat dich$/.test(toAscii(trimmed))) { groupTranslate.setEnabled(groupId, false); return OFF_CONFIRM; }
if (/^翻譯開$/.test(trimmed) || /^bat dich$/.test(toAscii(trimmed)))  { groupTranslate.setEnabled(groupId, true);  return ON_CONFIRM; }
if (!groupTranslate.isEnabled(groupId)) return null;
if (!groupTranslate.isSubstantial(trimmed)) return null;
const dir = groupTranslate.bridgeDirection(trimmed);
if (!dir) return null;
const t = await groupTranslate.translateFor(dir, trimmed);
return t && t.trim() ? `🌐 ${t.trim()}` : null;   // 翻譯失敗 → 靜默
```
- `OFF_CONFIRM`／`ON_CONFIRM`／`groupIntroText()` 為**中越雙語**常數（放 handler 或 lang 皆可，
  建議 handler 內模組常數即可，內容見 §4）。
- **不呼叫** `lang.noteText`、`conversation.append`、richMenu/onboarding hook——群組訊息零副作用。

### 2c. `handleGroupAudio(groupId, messageId)`
```js
buf = await getContentBuffer(messageId)  // try/catch → null（靜默，不回錯誤訊息）
const text = await ai.transcribe(buf);
if (!text || !isSubstantial(text)) return null;
const dir = bridgeDirection(text); if (!dir) return null;
const t = await translateFor(dir, text);
return t && t.trim() ? `🎙「${text}」\n🌐 ${t.trim()}` : null;
```

### 2d. 開關指令的例外
開關與 join 簡介**不受 enabled 狀態影響**（關閉後仍能打「翻譯開」恢復）。

## 3. src/lang.js
- 只加一件事：`module.exports` 增加 `detect`（若已匯出則零變更）。

## 4. 雙語文案（coder 照抄）
- `groupIntroText()`：
  `大家好！我是翻譯小幫手 🌐\n我會自動把群組裡的「中文 ↔ 越南語」互相翻譯，方便全家溝通。\n輸入「翻譯關」可暫停、「翻譯開」恢復。\n---\nXin chào cả nhà! Mình là trợ lý phiên dịch 🌐\nMình sẽ tự động dịch qua lại giữa tiếng Trung ↔ tiếng Việt trong nhóm.\nGõ "tắt dịch" để tạm dừng, "bật dịch" để bật lại.`
- `OFF_CONFIRM`：`已暫停群組翻譯。輸入「翻譯開」恢復。\nĐã tạm dừng dịch. Gõ "bật dịch" để bật lại.`
- `ON_CONFIRM`：`已開啟群組翻譯 🌐\nĐã bật dịch nhóm 🌐`

## 5. isSubstantial 規格
去掉 `https?://\S+`、空白後：計算「CJK（一-鿿）或拉丁字母（含越南語擴充 a-zA-ZÀ-ỹ）」字元數，
`>= 2` 才翻。純 emoji／標點／單一 CJK 字（如「好」「嗯」）→ 靜默。
（單字「好」CJK=1 → 不翻，符合 PRD。）

## 6. 測試策略（對應 PRD 驗收 1–7；全離線）
- stub `require('src/ai').ask`（記錄 sys+text、回固定譯文）與 `.transcribe`；
  stub `require('src/line').getContentBuffer`。
- 用假 event 物件直呼 `handler.replyForEvent`。
- data/groupTranslate.json 測後刪除或還原；驗證 conversation.get(groupId/userId) 為空。
- 一對一回歸：`天氣 台北市`（keyword）、`trợ giúp`（vi 選單）照舊；
  來源 type:'user' 的訊息不受新分流影響。
- `node --check`：groupTranslate.js、handler.js、lang.js。

## 7. 風險
- **家人要自己把 bot 拉進群組**＋LINE console 需開「Allow bot to join group chats」——
  部署後由使用者操作（給 click-by-click 指引），程式端無事可做。
- 群組訊息量大時每則 vi/zh 訊息都是一次 ai.ask（Groq 免費額度：家庭量級 OK；
  已用 isSubstantial 過濾短訊息）。
- lang.detect 對「中文＋越南語混寫」可能判 vi——可接受（譯成中文仍有幫助）。
- 貼圖/照片不翻——符合預期，安靜。

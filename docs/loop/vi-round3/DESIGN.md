# DESIGN — 越南語無障礙第 3 輪

## ✅ 需要金鑰：否（沿用既有 LINE token 與 Groq；無新外部 API）

## 變更檔案
1. `src/lang.js` — 新表 + onboarding 旗標 API
2. `src/services/morning.js` — 依訂閱者語言組訊息
3. `src/handler.js` — vi 早安開關路由 + onboarding hook
4. `src/services/traTrain.js` — 車種英文化（非 zh）

## 1. src/lang.js

### 1a. 新六語表（zh 逐字照抄現況；getter 依既有模式，ja/th/id 回落 en、未知回落 zh-TW）
```js
const MORNING_GREETINGS = {
  'zh-TW': ['早安！新的一天加油 💪', '早安～祝你有美好的一天 ☀️', '早安！記得吃早餐喔 🍳'],
  vi: ['Chào buổi sáng! Chúc bạn một ngày mới tốt lành 💪', 'Chào buổi sáng ~ chúc bạn một ngày tuyệt vời ☀️', 'Chào buổi sáng! Nhớ ăn sáng nhé 🍳'],
  en: ['Good morning! Have a great day 💪', 'Good morning ~ wishing you a wonderful day ☀️', 'Good morning! Don\'t forget breakfast 🍳'],
};
const BIRTHDAY_LINE = { // {names} 由程式代入（頓號串好的名字）
  'zh-TW': '🎂 今天是 {names} 的生日，別忘了祝賀！',
  vi: '🎂 Hôm nay là sinh nhật của {names}, đừng quên chúc mừng nhé!',
  en: "🎂 Today is {names}'s birthday — don't forget to celebrate!",
};
const MORNING_ON = {
  'zh-TW': '☀️ 已開啟每日早安推播（每天 {time}），天氣以「{city}」為準。\n關閉請輸入「關閉早安」。',
  vi: '☀️ Đã bật bản tin buổi sáng hằng ngày (lúc {time}), thời tiết theo khu vực "{city}".\nĐể tắt, gõ "tắt tin sáng".',
  en: '☀️ Daily morning digest is ON (at {time}), weather for "{city}".\nTo turn off, type "關閉早安" or "tắt tin sáng".',
};
const MORNING_OFF = {
  'zh-TW': '已關閉每日早安推播。',
  vi: 'Đã tắt bản tin buổi sáng hằng ngày.',
  en: 'Daily morning digest turned off.',
};
const MORNING_OFF_NONE = {
  'zh-TW': '你目前沒有開啟早安推播。',
  vi: 'Bạn chưa bật bản tin buổi sáng.',
  en: "You don't have the morning digest turned on.",
};
const WELCOME_VI =
  'Chào bạn! 👋 Mình là trợ lý gia đình.\n' +
  'Bạn có thể nói chuyện với mình bằng tiếng Việt — nhắn chữ hoặc gửi tin nhắn thoại đều được.\n' +
  'Gõ "trợ giúp" để xem tất cả chức năng (giờ tàu, trạm xăng, tỷ giá, thời tiết...).\n' +
  'Bạn cũng có thể bấm menu ở cuối màn hình 👇';
```
Getters：`morningGreeting(code)`（隨機取一句）、`birthdayLine(code, namesJoined)`（模板代入）、
`morningOn(code, time, city)`、`morningOff(code)`、`morningOffNone(code)`、`welcomeVi()`（回常數）。全部匯出。

### 1b. onboarding 旗標（存進既有 lang.json 記錄物件）
- 記錄物件加欄位 `welcomed: true`（沿用既有 `write`/record 結構，注意不要破壞既有欄位）。
- 新匯出：`needsWelcome(userId)` → 該使用者目前語言為 `'vi'` 且記錄無 `welcomed` → true；
  `markWelcomed(userId)` → 在記錄上寫 `welcomed: true` 存檔。
- **先標記後推送**（handler 端順序），避免並發訊息重複推送。

## 2. src/services/morning.js
- `require('../lang')` 與 `require('../ai')`（morning→lang / morning→ai 皆無循環相依）。
- `subscribe(userId, city)`：回 `lang.morningOn(code, config.morningTime, c)`，code 由呼叫端傳入
  （**簽章改為 `subscribe(userId, city, code)`**，handler 傳 `await lang.resolve(userId)`；
  未傳 code 預設 `'zh-TW'`，保持相容）。`unsubscribe(userId, code)` 同理（區分 OFF / OFF_NONE）。
- `buildMessage(sub)`：
  1. `const code = await lang.resolve(sub.userId)`（包 try/catch，失敗當 `'zh-TW'`）。
  2. 問候 → `lang.morningGreeting(code)`。
  3. 天氣：取得原中文字串後——`code === 'zh-TW'` 直接用；否則
     `const t = await ai.ask('把以下訊息完整翻譯成' + <語言名> + '，保留 emoji 與數字，只輸出翻譯結果', raw)`，
     `t` 非空用 `t`，空/例外回退 `raw`。語言名對照放本檔小表（vi→越南語、en→英文、ja→日文、th→泰文、id→印尼文）。
  4. 生日：`lang.birthdayLine(code, bdays.join('、'))`（vi/en 用 `, ` 連接；zh 維持 `、`）。
- `sendAll`／`tick`／`start` 排程邏輯**完全不動**。

## 3. src/handler.js
### 3a. vi 早安開關（插在既有「每日早安推播」區塊内）
既有：`const morningOn = trimmed.match(/^開啟早安\s*(.*)$/); ...`
新增（用既有 `asciiTrimmed` 模式，注意此變數目前宣告在加油站區塊前——若位置在其後就直接用，
否則在本區塊自行 `toAscii(trimmed)`）：
```js
if (/^bat (?:ban )?tin sang$/.test(ascii)) return morning.subscribe(userId, '', await lang.resolve(userId));
if (/^tat (?:ban )?tin sang$/.test(ascii)) return morning.unsubscribe(userId, await lang.resolve(userId));
```
中文路由改傳 code：`morning.subscribe(userId, morningOn[1], await lang.resolve(userId))`、
`morning.unsubscribe(userId, await lang.resolve(userId))`。

### 3b. onboarding hook（在既有 richMenu.ensureFor 的 fire-and-forget `.then` 內順便做，
或並列一個 fire-and-forget；擇「不增加回覆延遲」者）
```js
lang.resolve(userId).then((code) => {
  richMenu.ensureFor(userId, code);           // 既有
  if (code === 'vi' && lang.needsWelcome(userId)) {
    lang.markWelcomed(userId);                // 先標記防重
    client.pushMessage({ to: userId, messages: [{ type: 'text', text: lang.welcomeVi() }] })
      .catch(() => {});
  }
}).catch(() => {});
```
handler 需從 `./line` 補 import `client`（現在只 import `getContentBuffer`）。

## 4. src/services/traTrain.js — getTraTrainByIds 車種
班次行組字處：`const typeName = code === 'zh-TW' ? t.typeZh : (t.typeEn || t.typeZh);`
zh 路徑逐字不變。（nextOnly 與多筆兩處都要改。）

## 測試策略（對應 PRD 驗收 1–7）
- monkeypatch `require('./src/ai').ask`（計數＋回固定字串／丟例外）驗證 1/2/3。
- monkeypatch `require('./src/line').client.pushMessage`（stub 收集）驗證 5；
  `data/lang.json` 檢查 `welcomed` 旗標寫入；記得測後還原檔案。
- `handleText` 實測 vi 開關（4）；`data/morning.json` 測後清掉測試訂閱。
- `getTraTrainByIds` 帶/不帶 code 比對車種欄（6）。
- `node --check` ×4（lang/morning/handler/traTrain）。
- 注意：本輪測試**不要**真的 push 訊息給任何真實 userId（stub client）。

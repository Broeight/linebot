# DESIGN — 越南語無障礙第 1 輪

## ✅ 需要金鑰：否（純本地化與路由，無新外部 API）

## 變更檔案
1. `src/lang.js` — 新六語表 + getter
2. `src/ai.js` — chat 增加 fallbackText 選項
3. `src/index.js` — 總 catch 本地化
4. `src/handler.js` — 錯誤句改 lang、trợ giúp/直達路由、helpText(code)
5. `src/services/traTrain.js` — `getTraTrainByIds` 增 `code` 參數本地化標題/單位
6. `src/services/gasStation.js` — formatList 距離單位中性化

## 1. src/lang.js — 新表（照抄下方文案；getter 一律 `(code) => TABLE[code] || TABLE['zh-TW']`）

```js
const GENERIC_ERROR = {
  'zh-TW': '抱歉，發生了一點問題，請稍後再試 🙏',
  vi: 'Xin lỗi, đã xảy ra lỗi. Vui lòng thử lại sau 🙏',
  en: 'Sorry, something went wrong. Please try again later 🙏',
  ja: '申し訳ありません、問題が発生しました。後でもう一度お試しください 🙏',
  th: 'ขออภัย เกิดข้อผิดพลาด กรุณาลองใหม่ภายหลัง 🙏',
  id: 'Maaf, terjadi kesalahan. Silakan coba lagi nanti 🙏',
};
const CHAT_FALLBACK = {
  'zh-TW': '抱歉，我現在無法回覆，請稍後再試。',
  vi: 'Xin lỗi, hiện tại tôi không thể trả lời. Vui lòng thử lại sau.',
  en: "Sorry, I can't reply right now. Please try again later.",
  ja: '申し訳ありません、今は返信できません。後でもう一度お試しください。',
  th: 'ขออภัย ตอนนี้ฉันตอบไม่ได้ กรุณาลองใหม่ภายหลัง',
  id: 'Maaf, saat ini saya tidak bisa membalas. Silakan coba lagi nanti.',
};
const AUDIO_FETCH_FAIL = {
  'zh-TW': '抱歉，我拿不到這段語音 🙏',
  vi: 'Xin lỗi, tôi không nhận được đoạn ghi âm này 🙏',
  en: "Sorry, I couldn't get that voice message 🙏",
  ja: 'すみません、この音声を取得できませんでした 🙏',
  th: 'ขออภัย ฉันไม่ได้รับข้อความเสียงนี้ 🙏',
  id: 'Maaf, saya tidak bisa mengambil pesan suara ini 🙏',
};
const AUDIO_UNCLEAR = {
  'zh-TW': '我聽不太清楚，可以再說一次、或直接打字給我嗎？',
  vi: 'Tôi nghe không rõ. Bạn có thể nói lại hoặc nhắn chữ cho tôi được không?',
  en: "I couldn't hear that clearly. Could you say it again or type it instead?",
  ja: 'よく聞き取れませんでした。もう一度話すか、文字で送ってもらえますか？',
  th: 'ฉันฟังไม่ค่อยชัด พูดอีกครั้งหรือพิมพ์มาได้ไหม?',
  id: 'Saya kurang jelas mendengarnya. Bisa ulangi atau ketik saja?',
};
const IMAGE_FETCH_FAIL = {
  'zh-TW': '抱歉，我拿不到這張圖片 🙏',
  vi: 'Xin lỗi, tôi không nhận được bức ảnh này 🙏',
  en: "Sorry, I couldn't get that image 🙏",
  ja: 'すみません、この画像を取得できませんでした 🙏',
  th: 'ขออภัย ฉันไม่ได้รับรูปภาพนี้ 🙏',
  id: 'Maaf, saya tidak bisa mengambil gambar ini 🙏',
};
const IMAGE_UNCLEAR = {
  'zh-TW': '我看不太懂這張圖，換一張清楚一點的試試？',
  vi: 'Tôi không hiểu rõ bức ảnh này. Bạn thử gửi ảnh rõ hơn nhé?',
  en: "I couldn't make out that image. Could you try a clearer one?",
  ja: 'この画像はよく分かりませんでした。もっと鮮明なものを試してみてください。',
  th: 'ฉันดูรูปนี้ไม่ค่อยออก ลองส่งรูปที่ชัดกว่านี้ได้ไหม?',
  id: 'Saya tidak bisa memahami gambar ini. Coba kirim yang lebih jelas?',
};
```
Getters（照 audioPrefix 模式）：`genericError`、`chatFallback`、`audioFetchFail`、`audioUnclear`、
`imageFetchFail`、`imageUnclear`，全部匯出。

### helpText 搬家：`lang.helpMenu(code)`
- 把 handler.js 的 `helpText()` 全文搬到 lang.js 成 `HELP_MENU['zh-TW']`（逐字不動）。
- `HELP_MENU.vi`：完整越南語翻譯（每行同結構：emoji + 功能 + 範例指令；範例中的**中文指令保留原文**並附越南語說明，
  因為指令本身要打中文才會觸發——但註明「也可以直接用越南語自然說」；台鐵/加油站/匯率/油價/翻譯/提醒等行必含）。
  首行加一句：`💡 Bạn có thể nói chuyện với tôi bằng tiếng Việt (nhắn chữ hoặc gửi tin nhắn thoại).`
- `HELP_MENU.en`：英文版（同結構）。`ja/th/id` getter 回落 en；未知碼回落 zh-TW。
- handler 的 `helpText()` 函式刪除，改呼叫 `lang.helpMenu(code)`（需先 `await lang.resolve(userId)`）。

## 2. src/ai.js — chat fallback 參數
`chat(history, { tools, runTool, systemExtra, fallbackText })`：
第 114 行 `|| '抱歉，我現在無法回覆，請稍後再試。'` 改為 `|| fallbackText || '抱歉，我現在無法回覆，請稍後再試。'`。
所有內部錯誤路徑回 fallback 的地方一致使用。不改其他函式。

## 3. src/index.js — 總 catch
catch 區塊改為：
```js
let errText = '抱歉，發生了一點問題，請稍後再試 🙏';
try { errText = lang.genericError(await lang.resolve(event.source?.userId)); } catch {}
```
（`lang.resolve` 對 undefined userId 需不丟錯——若會丟錯就先判 userId。）index.js 需 `require('./lang')`。

## 4. src/handler.js
- `handleText` AI fallback 呼叫改為傳 `fallbackText: lang.chatFallback(code)`（code 需在該處 `await lang.resolve(userId)`，
  注意：只在進入 AI fallback 時才 resolve，避免每則訊息多一次 I/O——resolve 內有快取的話照舊即可）。
- handleAudio/handleImage 四句錯誤改 `lang.audioFetchFail(code)` 等（code 於函式開頭 resolve；
  handleAudio 目前在 handleText 之後才 resolve——錯誤路徑需自己先 resolve）。
- 選單路由：`if (/^(?:\/help|說明|help|選單|menu|trợ giúp|giúp đỡ|hướng dẫn)$/i.test(trimmed))`
  → `return lang.helpMenu(await lang.resolve(userId));`
- 直達路由（插在「加油站」區塊之後、發票之前）：
  ```js
  if (/^gi[áa] (?:xăng|dầu)$/i.test(toAsciiLoose(trimmed)) …)
  ```
  實作建議：用 lang 已有/或本檔小工具做「去聲調小寫」再比對：
  - `gia xang`/`gia dau` → `return fuelPrice.lookup();`
  - `ty gia`（單獨）→ `return exchangeRate.lookup('TWD VND');`
  - `ty gia <rest>` → `return exchangeRate.lookup(rest原文);`
  去聲調函式可從 traTrain 匯入 `toAscii`（已匯出）。**比對用去聲調、參數用原文**。

## 5. src/services/traTrain.js — getTraTrainByIds(opts) 增 `code`
- 簽章 `{ fromId, toId, fromName, toName, nextOnly, day, code }`；`code` 缺省 `'zh-TW'`。
- 本地化三處（表放 traTrain 檔內即可，或收進 lang.js——**決策：放 lang.js**，命名
  `traHeader(code, from, to, dateLabel)` 不必；**簡化**：只在 traTrain 內做小表，鍵：
  `noTrains`（今日/明天已無班次）、`durationUnit`（'X小時Y分' vs 'XhYm' vs 'X giờ Y phút'）、
  `headerWhen`（今天/明天字樣）。zh-TW 輸出與現況逐字相同。vi/en 提供，其餘回落 en。）
- handler 呼叫處補傳 `code: await lang.resolve(userId)`（pending 攔截區塊內已可 resolve）。

## 6. src/services/gasStation.js — formatList 單位
`公尺` → `m`、`公里` → `km`（所有語言統一中性寫法；zh 使用者看 `728 m`/`1.4 km` 也無理解問題，
避免把 formatList 弄成要吃語言碼）。TEST 檔同步更新期望值。

## 測試策略（對應 PRD 驗收 1–8）
1. lang 六語 getter 全非空、vi 含越南語、未知碼回落。
2. zh 逐字不回歸：對照表比對六句原文 + `getTraTrainByIds` 不傳 code 的輸出樣式。
3. `ai.chat([], {fallbackText:'XYZ'})` 在 Groq 錯誤時回 'XYZ'（可用壞 model 名或攔截；不行就單測字串邏輯）。
4. `getTraTrainByIds({...code:'vi'})` 含 `giờ`/`phút` 或 vi 無班次句；`code:'zh-TW'` 含 `小時`。
5. vi 使用者 `trợ giúp` → vi 選單；zh 使用者 `選單` → 原中文全文。
6. `giá xăng` → 油價字串（含「中油」或油品字樣）；`tỷ giá` → 含 TWD/VND。
7. `formatList` 輸出含 ` m`/` km`、不含 公尺/公里。
8. `node --check` ×6。

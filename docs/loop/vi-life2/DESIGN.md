# DESIGN — 就醫溝通卡＋匯率到價提醒

## ✅ 需要金鑰：否（重用 Groq 與 open.er-api.com）

## 變更檔案
1. `src/services/medicalCard.js`（新）— 卡片模板 + AI 翻譯組卡
2. `src/services/rateAlert.js`（新）— 到價提醒狀態 + 排程
3. `src/services/exchangeRate.js` — **只加匯出 `getRate`**（零邏輯變更）
4. `src/lang.js` — 新六語字串（引導/失敗/設定確認/到價推播）
5. `src/tools.js` — 兩個新 AI 工具 `make_medical_card`、`set_rate_alert`
6. `src/handler.js` — 關鍵字路由（一對一區；群組路由在前面攔掉，天然不觸發）
7. `src/index.js` — 啟動 `rateAlert.start()`

## 1. src/services/medicalCard.js

```js
const ai = require('../ai');
const lang = require('../lang');

// 卡片模板（固定，AI 只填 {symptoms_zh}）
function buildCard(symptomsZh, backTranslation) {
  return (
    '🏥 就醫溝通卡（請出示給醫護人員）\n' +
    '您好，我是越南籍人士，中文不太流利，請多包涵。\n' +
    `【症狀／需求】${symptomsZh}\n` +
    '請問需要掛哪一科？麻煩您了，謝謝！' +
    (backTranslation ? `\n──────────\n📄 Nội dung thẻ (để bạn kiểm tra):\n${backTranslation}` : '')
  );
}

// 產卡：syAI 兩步 — (1) 症狀翻繁中（只輸出譯文）(2) 譯文回譯越語（只輸出譯文）
// 任一步失敗回 null（呼叫端用 lang 回「暫時無法」句）
async function makeCard(symptomsText) {
  const zh = await ai.ask('把以下就醫症狀描述翻譯成繁體中文，口語、簡潔。只輸出譯文本身。', symptomsText);
  if (!zh || !zh.trim()) return null;
  // 輸入本來就是中文時 zh≈原文，回譯仍做（讓越南使用者可核對）
  const back = await ai.ask('Dịch mô tả triệu chứng sau sang tiếng Việt. Chỉ xuất bản dịch.', zh);
  return buildCard(zh.trim(), (back || '').trim());
}
module.exports = { makeCard, buildCard };
```

## 2. src/services/rateAlert.js（比照 reminder.js 排程模式）

```js
const store = require('../store');
const lang = require('../lang');
const { client } = require('../line');
const { getRate } = require('./exchangeRate');
const FILE = 'rateAlert.json';   // [{ userId, target, direction: 'up'|'down', createdAt }]
const TICK_MS = 30 * 60 * 1000; // 30 分鐘

function list() { const s = store.load(FILE); return Array.isArray(s) ? s : []; }
function get(userId) { return list().find((a) => a.userId === userId) || null; }
async function set(userId, target) {
  const rate = await getRate('TWD', 'VND');       // 失敗回 null → 呼叫端回錯誤句
  if (rate == null) return null;
  const direction = target >= rate ? 'up' : 'down';
  const l = list().filter((a) => a.userId !== userId);   // 每人一筆（覆蓋）
  l.push({ userId, target, direction, createdAt: Date.now() });
  store.save(FILE, l);
  return { direction, current: rate };
}
function clear(userId) { const before = list(); const after = before.filter((a) => a.userId !== userId); store.save(FILE, after); return before.length !== after.length; }

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const alerts = list();
    if (alerts.length) {
      const rate = await getRate('TWD', 'VND');
      if (rate != null) {
        for (const a of alerts) {
          const hit = a.direction === 'up' ? rate >= a.target : rate <= a.target;
          if (!hit) continue;
          const code = await lang.resolve(a.userId).catch(() => 'zh-TW');
          await client.pushMessage({ to: a.userId, messages: [{ type: 'text', text: lang.rateAlertHit(code, rate, a.target) }] }).catch(() => {});
          clear(a.userId);   // 一次性：到價即移除（reload-before-save 由 clear 內 list() 保證）
        }
      }
    }
  } catch (e) { console.error('匯率提醒排程錯誤：', e.message); }
  finally { ticking = false; setTimeout(tick, TICK_MS); }
}
function start() { setTimeout(tick, TICK_MS); console.log('💱 匯率到價提醒排程已啟動（每 30 分鐘）'); }
module.exports = { set, get, clear, list, start, tick /* tick 供測試 */ };
```
> 注意 `lang.resolve` 是 async（照 morning.js 的用法包 try/catch 預設 zh-TW）。

## 3. exchangeRate.js — `module.exports` 加 `getRate`（不改其他）

## 4. src/lang.js 新六語表（zh 逐字寫死、vi 為主、en 齊；ja/th/id 落 en）
- `MEDICAL_ASK`（只打關鍵字沒症狀時的引導）：zh『請描述你的症狀（例如：頭痛兩天、發燒 38 度、對某藥過敏）』
  vi『Hãy mô tả triệu chứng của bạn (ví dụ: đau đầu 2 ngày, sốt 38 độ, dị ứng thuốc...)』
- `MEDICAL_FAIL`：zh『暫時無法製作就醫卡，請稍後再試 🙏』vi『Tạm thời không tạo được thẻ khám bệnh, vui lòng thử lại sau 🙏』
- `RATE_ALERT_SET_UP`：zh『🔔 已設定：1 台幣 ≥ {target} 越南盾時通知你（現在 {current}）』
  vi『🔔 Đã đặt: sẽ báo khi 1 TWD ≥ {target} VND (hiện tại {current})』
- `RATE_ALERT_SET_DOWN`：同上換 ≤ 與「跌到」語意
- `RATE_ALERT_HIT`：zh『🔔 到價了！現在 1 台幣 = {rate} 越南盾（目標 {target}）』
  vi『🔔 Tỷ giá đã đến mức! Hiện tại 1 TWD = {rate} VND (mục tiêu {target})』
- `RATE_ALERT_NONE`：zh『你目前沒有匯率提醒。設定：「匯率提醒 850」』vi 同義（含 báo tỷ giá 850 例句）
- `RATE_ALERT_CURRENT`：查看用 zh『目前設定：1 台幣 {dir} {target} 越南盾時通知（現在 {current}）』
- `RATE_ALERT_CLEARED`：zh『已清除匯率提醒。』vi『Đã xóa báo tỷ giá.』
- `RATE_ALERT_FAIL`：zh『目前抓不到匯率，請稍後再設定 🙏』vi 同義
- getter 命名：`medicalAsk/medicalFail/rateAlertSet(code,dir,target,current)/rateAlertHit(code,rate,target)/rateAlertNone/rateAlertCurrent/rateAlertCleared/rateAlertFail`

## 5. src/tools.js
- `make_medical_card`：description「使用者想做就醫／看醫生用的中文溝通卡時呼叫；symptoms 傳原話症狀描述（任何語言），不要自行翻譯」；run → `medicalCard.makeCard(a.symptoms)`，null → 'Cannot make the card right now.'（模型轉述）
- `set_rate_alert`：description「使用者要求匯率（台幣↔越南盾）到某價位時通知就呼叫；target = 每 1 TWD 的 VND 數字」；run → `rateAlert.set(userId, Number(a.target))`，成功回英文摘要 `Rate alert saved: notify when 1 TWD ${dir} ${target} VND (now ${current}).`，null → 'Cannot fetch the exchange rate right now.'
- timeContext() 各加一句觸發指引。

## 6. src/handler.js（一對一區塊；插在「匯率」區塊之後）
```js
// 就醫溝通卡
const medMatch = trimmed.match(/^(?:就醫卡|看病卡)\s*(.*)$/);
const medAscii = toAscii(trimmed).match(/^(?:the )?kham benh\s*(.*)$/); // thẻ khám bệnh / khám bệnh
if (medMatch || medAscii) {
  const symptoms = ((medMatch && medMatch[1]) || (medAscii && medAscii[1]) || '').trim();
  const code = await lang.resolve(userId);
  if (!symptoms) return lang.medicalAsk(code);
  const card = await medicalCard.makeCard(symptoms);   // 原文切片：ascii 命中時要從「原文」切參數（同 tỷ giá 模式，位置 1:1）
  return card || lang.medicalFail(code);
}
// 匯率到價提醒
const raSet = trimmed.match(/^匯率提醒\s*([\d.]+)?$/) ;
const raAsciiSet = toAscii(trimmed).match(/^bao ty gia\s*([\d.]+)?$/);
const raClear = /^清除匯率提醒$/.test(trimmed) || /^xoa bao ty gia$/.test(toAscii(trimmed));
if (raClear) { const code = await lang.resolve(userId); return rateAlert.clear(userId) ? lang.rateAlertCleared(code) : lang.rateAlertNone(code); }
if (raSet || raAsciiSet) {
  const code = await lang.resolve(userId);
  const numStr = (raSet && raSet[1]) || (raAsciiSet && raAsciiSet[1]);
  if (!numStr) { const cur = rateAlert.get(userId); return cur ? lang.rateAlertCurrent(code, cur, await 現價…) : lang.rateAlertNone(code); }
  const r = await rateAlert.set(userId, Number(numStr));
  return r ? lang.rateAlertSet(code, r.direction, Number(numStr), r.current) : lang.rateAlertFail(code);
}
```
> 群組訊息在 replyForEvent 已被群組分支攔走 → 新路由天然不影響群組（PRD 不做第 3 條）。
> 注意 vi 參數用原文切片時，`khám bệnh` 症狀段含越南語聲調——**症狀要取原文**，
> 不可用 toAscii 後的字串（比照 tỷ giá route 的 index 切片法，位置 1:1）。

## 7. src/index.js — `rateAlert.start()` 加在 morning.start() 之後。

## 8. 測試策略（對應 PRD 驗收 1–7；全離線 stub）
- stub `ai.ask`（依 sys 判斷回「中文譯文」或「vi 回譯」）、`exchangeRate.getRate`（可控現價）、
  `line.client.pushMessage`（收集）。
- `rateAlert.tick()` 匯出供測試直呼；防重入：同步連呼兩次 tick 驗證第二次直接 return。
- data/rateAlert.json、data/lang.json 測後清理。
- 回歸：`匯率 台幣 越南盾`（lookup 不受 getRate 匯出影響）、群組 vi 訊息仍走翻譯橋不觸發新路由。

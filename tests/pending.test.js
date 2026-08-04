// 回歸測試：src/services/imagePending.js（拍照後一鍵按鈕狀態機）
//         ＋ src/services/traChoice.js（台鐵相近站名選擇狀態機）
// 防的回歸：
// - parseVisionTag 標籤外洩到回傳文字（重複標籤／被 ``` 包住／JSON 截斷／只有標籤沒描述）
// - consumeMatch／matchCandidate 不是一次性（連點第二下重複執行）、TTL 過期後仍誤命中
// - sanitizeItem 沒把數字去掉，導致店名被記帳的取數 regex 誤抓
// - 兩個獨立的 pending 狀態機（imagePending／traChoice）彼此觸發字串互相誤命中

const h = require('./helpers'); // 設定假金鑰（避免 require src 時 Groq SDK 爆掉）＋相對日期工具
const { test, afterEach } = require('node:test');
const assert = require('node:assert');

const imagePending = require('../src/services/imagePending');
const traChoice = require('../src/services/traChoice');

// 兩個模組都是純記憶體 Map，測試之間必須手動清乾淨（沒有 store 可以靠 helpers 重置）
const TEST_USERS = ['u1', 'u2', 'userA', 'userB', '沒有 pending 的人'];
afterEach(() => {
  for (const u of TEST_USERS) {
    imagePending.clear(u);
    traChoice.clear(u);
  }
});

// ── imagePending.parseVisionTag ───────────────────────────────────────────

test('parseVisionTag：正常解析 receipt 標籤，text 與 tag 都正確', () => {
  const raw = '這是一張全聯收據\n##TAG {"type":"receipt","store":"全聯","amount":150}';
  const { text, tag } = imagePending.parseVisionTag(raw);
  assert.strictEqual(text, '這是一張全聯收據');
  assert.deepStrictEqual(tag, { type: 'receipt', store: '全聯', amount: 150 });
});

test('parseVisionTag：正常解析 document 標籤（deadline/title/amount）', () => {
  // 期限必須是「未來」的日期：正式程式會丟掉已過期的期限（正確行為），
  // 所以這裡相對取日期，寫死會在該日過後讓測試無故變紅（已發生過一次）。
  const deadline = h.ymdOffset(30);
  const raw = `這是一張繳費通知單\n##TAG {"type":"document","deadline":"${deadline}","amount":1200,"title":"繳水電費"}`;
  const { text, tag } = imagePending.parseVisionTag(raw);
  assert.strictEqual(text, '這是一張繳費通知單');
  assert.strictEqual(tag.type, 'document');
  assert.strictEqual(tag.deadline, deadline);
  assert.strictEqual(tag.amount, 1200);
  assert.strictEqual(tag.title, '繳水電費');
});

test('parseVisionTag：other 類型，text 不受影響', () => {
  const raw = '這是一隻貓的照片\n##TAG {"type":"other"}';
  const { text, tag } = imagePending.parseVisionTag(raw);
  assert.strictEqual(text, '這是一隻貓的照片');
  assert.deepStrictEqual(tag, { type: 'other' });
});

test('parseVisionTag：完全沒有 ##TAG 時，text 原樣（trim）回傳，tag 為 other', () => {
  const raw = '只是一段普通描述文字';
  const { text, tag } = imagePending.parseVisionTag(raw);
  assert.strictEqual(text, '只是一段普通描述文字');
  assert.deepStrictEqual(tag, { type: 'other' });
});

test('parseVisionTag：不分大小寫 ##tag 也能解析，且不外漏', () => {
  const raw = '描述文字\n##tag {"type":"other"}';
  const { text, tag } = imagePending.parseVisionTag(raw);
  assert.strictEqual(text, '描述文字');
  assert.deepStrictEqual(tag, { type: 'other' });
  assert.doesNotMatch(text, /##tag/i);
});

test('parseVisionTag：重複標籤（本文中誤含假的 ##TAG 字樣）——回傳文字絕不可殘留 ##TAG', () => {
  const raw = '第一行 ##TAG 假的字樣\n真正描述\n##TAG {"type":"other"}';
  const { text, tag } = imagePending.parseVisionTag(raw);
  assert.deepStrictEqual(tag, { type: 'other' });
  assert.doesNotMatch(text, /##TAG/i, '不論真假標籤行，回傳文字都不可含 ##TAG');
  assert.strictEqual(text, '真正描述');
});

test('parseVisionTag：標籤被 ``` 包住——文字不可殘留反引號或 ##TAG', () => {
  const raw = '收據內容摘要\n```\n##TAG {"type":"receipt","store":"A","amount":10}\n```';
  const { text, tag } = imagePending.parseVisionTag(raw);
  assert.deepStrictEqual(tag, { type: 'receipt', store: 'A', amount: 10 });
  assert.doesNotMatch(text, /```/);
  assert.doesNotMatch(text, /##TAG/i);
  assert.strictEqual(text, '收據內容摘要');
});

test('parseVisionTag：JSON 被截斷（沒有配對的 }）——不可 throw，降級成 other，且不外漏 ##TAG', () => {
  const raw = '描述文字\n##TAG {"type":"receipt","store":"沒寫完';
  assert.doesNotThrow(() => imagePending.parseVisionTag(raw));
  const { text, tag } = imagePending.parseVisionTag(raw);
  assert.deepStrictEqual(tag, { type: 'other' });
  assert.strictEqual(text, '描述文字');
  assert.doesNotMatch(text, /##TAG/i);
});

test('parseVisionTag：標籤 JSON 語法錯誤（無法 JSON.parse）——不可 throw，降級成 other', () => {
  const raw = '描述文字\n##TAG {type: receipt}'; // key 沒加引號，不是合法 JSON
  assert.doesNotThrow(() => imagePending.parseVisionTag(raw));
  const { text, tag } = imagePending.parseVisionTag(raw);
  assert.deepStrictEqual(tag, { type: 'other' });
  assert.strictEqual(text, '描述文字');
});

test('parseVisionTag：只有標籤沒有描述——text 為空字串，不可 throw，tag 正確解析', () => {
  const raw = '##TAG {"type":"other"}';
  assert.doesNotThrow(() => imagePending.parseVisionTag(raw));
  const { text, tag } = imagePending.parseVisionTag(raw);
  assert.strictEqual(text, '');
  assert.deepStrictEqual(tag, { type: 'other' });
});

test('parseVisionTag：不合法的 type 欄位——整包降級為 other（不信任未知 type）', () => {
  const raw = '描述\n##TAG {"type":"unknown_type","amount":100}';
  const { tag } = imagePending.parseVisionTag(raw);
  assert.deepStrictEqual(tag, { type: 'other' });
});

test('parseVisionTag：null／undefined／空字串輸入不可 throw', () => {
  assert.doesNotThrow(() => imagePending.parseVisionTag(null));
  assert.doesNotThrow(() => imagePending.parseVisionTag(undefined));
  assert.doesNotThrow(() => imagePending.parseVisionTag(''));
  assert.deepStrictEqual(imagePending.parseVisionTag('').tag, { type: 'other' });
});

// ── imagePending.set/get/clear/consumeMatch ───────────────────────────────

test('consumeMatch：文字精準命中目前 pending 的按鈕文字才算命中', () => {
  imagePending.set('u1', { tapText: '記帳 測試店 100', kind: 'expense' });
  const hit = imagePending.consumeMatch('u1', '記帳 測試店 100');
  assert.ok(hit);
  assert.strictEqual(hit.kind, 'expense');
});

test('consumeMatch：文字不符不命中，pending 保留（不會被誤清掉）', () => {
  imagePending.set('u1', { tapText: '記帳 測試店 100' });
  const miss = imagePending.consumeMatch('u1', '記帳 別的店 100');
  assert.strictEqual(miss, null);
  // pending 應該還在，之後打對的文字仍能命中
  const hit = imagePending.consumeMatch('u1', '記帳 測試店 100');
  assert.ok(hit);
});

test('consumeMatch：一次性——命中後立刻清除，連點第二下不會重複執行', () => {
  imagePending.set('u1', { tapText: '記帳 測試店 100' });
  const first = imagePending.consumeMatch('u1', '記帳 測試店 100');
  assert.ok(first);
  const second = imagePending.consumeMatch('u1', '記帳 測試店 100');
  assert.strictEqual(second, null, '連點第二下不該再次命中同一筆 pending');
});

test('consumeMatch：呼叫端文字前後有空白也能命中（函式內部會 trim）', () => {
  imagePending.set('u1', { tapText: '記帳 測試店 100' });
  const hit = imagePending.consumeMatch('u1', '   記帳 測試店 100   ');
  assert.ok(hit);
});

test('imagePending：TTL（3 分鐘）過期後 get／consumeMatch 都不再命中', () => {
  imagePending.set('u1', { tapText: '記帳 測試店 100' });
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 4 * 60 * 1000; // 快轉 4 分鐘，超過 3 分鐘 TTL
    assert.strictEqual(imagePending.get('u1'), undefined);
    assert.strictEqual(imagePending.consumeMatch('u1', '記帳 測試店 100'), null);
  } finally {
    Date.now = originalNow;
  }
});

test('imagePending：set 覆蓋舊筆（每人一筆），只有最新一筆有效', () => {
  imagePending.set('u1', { tapText: '記帳 舊店 50' });
  imagePending.set('u1', { tapText: '記帳 新店 80' });
  assert.strictEqual(imagePending.consumeMatch('u1', '記帳 舊店 50'), null, '舊筆應已被覆蓋');
  assert.ok(imagePending.consumeMatch('u1', '記帳 新店 80'));
});

// ── imagePending.sanitizeItem ──────────────────────────────────────────────

test('sanitizeItem：去除數字，防止店名（如 7-11）被記帳金額 regex 誤抓', () => {
  assert.strictEqual(imagePending.sanitizeItem('7-11'), '-');
  assert.doesNotMatch(imagePending.sanitizeItem('全家FamilyMart123'), /\d/);
});

test('sanitizeItem：全部是數字或空白時，落回預設值「收據」', () => {
  assert.strictEqual(imagePending.sanitizeItem('12345'), '收據');
  assert.strictEqual(imagePending.sanitizeItem('   '), '收據');
  assert.strictEqual(imagePending.sanitizeItem(''), '收據');
  assert.strictEqual(imagePending.sanitizeItem(null), '收據');
});

test('sanitizeItem：換行與多餘空白會被壓成單一空白，並裁到 10 字', () => {
  const r = imagePending.sanitizeItem('全聯\n福利中心   分店123');
  assert.doesNotMatch(r, /\d/);
  assert.ok(r.length <= 10, `裁切後長度應 <=10，實際是 ${r.length}`);
});

// ── traChoice.js ────────────────────────────────────────────────────────

const CANDIDATES = [
  { name: '台北', id: '1000' },
  { name: '台中', id: '3300' },
  { name: '高雄', id: '4400' },
];

test('traChoice.set/get：可以讀回剛設定的候選清單', () => {
  traChoice.set('u1', { known: {}, ambiguousRole: 'from', candidates: CANDIDATES, nextOnly: false, day: '2026-07-24' });
  const p = traChoice.get('u1');
  assert.ok(p);
  assert.strictEqual(p.candidates.length, 3);
  assert.strictEqual(p.day, '2026-07-24');
});

test('traChoice.set：一人一筆——新的覆蓋舊的', () => {
  traChoice.set('u1', { candidates: [{ name: '台北', id: '1000' }] });
  traChoice.set('u1', { candidates: CANDIDATES });
  const p = traChoice.get('u1');
  assert.strictEqual(p.candidates.length, 3, '應該是最新那筆（3 個候選），不是舊的那筆（1 個候選）');
});

test('traChoice.clear：清除後 get 回 undefined', () => {
  traChoice.set('u1', { candidates: CANDIDATES });
  traChoice.clear('u1');
  assert.strictEqual(traChoice.get('u1'), undefined);
});

test('traChoice：TTL（3 分鐘）過期後 get 回 undefined、matchCandidate 不再命中', () => {
  traChoice.set('u1', { candidates: CANDIDATES });
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 4 * 60 * 1000;
    assert.strictEqual(traChoice.get('u1'), undefined);
    assert.strictEqual(traChoice.matchCandidate('u1', '台北'), null);
  } finally {
    Date.now = originalNow;
  }
});

test('traChoice.consumeFresh：一次性旗標——第一次 true，之後都 false', () => {
  traChoice.set('u1', { candidates: CANDIDATES });
  assert.strictEqual(traChoice.consumeFresh('u1'), true);
  assert.strictEqual(traChoice.consumeFresh('u1'), false);
  assert.strictEqual(traChoice.consumeFresh('u1'), false);
});

test('traChoice.consumeFresh：沒有 pending 的人回 false', () => {
  assert.strictEqual(traChoice.consumeFresh('沒有 pending 的人'), false);
});

test('traChoice.matchCandidate：用數字回覆命中對應候選（1-based）', () => {
  traChoice.set('u1', { candidates: CANDIDATES });
  assert.deepStrictEqual(traChoice.matchCandidate('u1', '1'), { name: '台北', id: '1000' });
  assert.deepStrictEqual(traChoice.matchCandidate('u1', '3'), { name: '高雄', id: '4400' });
});

test('traChoice.matchCandidate：數字超出候選範圍不命中（不可 throw、不可誤取）', () => {
  traChoice.set('u1', { candidates: CANDIDATES });
  assert.strictEqual(traChoice.matchCandidate('u1', '99'), null);
  assert.strictEqual(traChoice.matchCandidate('u1', '0'), null);
});

test('traChoice.matchCandidate：用站名命中，且能容忍「臺/台」與「站」結尾差異', () => {
  traChoice.set('u1', { candidates: CANDIDATES });
  assert.deepStrictEqual(traChoice.matchCandidate('u1', '台北'), { name: '台北', id: '1000' });
  assert.deepStrictEqual(traChoice.matchCandidate('u1', '臺北'), { name: '台北', id: '1000' });
  assert.deepStrictEqual(traChoice.matchCandidate('u1', '台北車站'), { name: '台北', id: '1000' });
});

test('traChoice.matchCandidate：完全不相干的文字不命中', () => {
  traChoice.set('u1', { candidates: CANDIDATES });
  assert.strictEqual(traChoice.matchCandidate('u1', '今天天氣如何'), null);
});

test('traChoice：不同 user 互不干擾——A 的 pending 不會被 B 的訊息命中', () => {
  traChoice.set('userA', { candidates: CANDIDATES });
  // userB 沒有設定 pending，即使打出跟 A 候選一樣的站名也不該有結果（get 回 undefined）
  assert.strictEqual(traChoice.get('userB'), undefined);
  assert.strictEqual(traChoice.matchCandidate('userB', '台北'), null);

  // 清除 A 的 pending 不影響（此處只是反向驗證 clear 的作用域是單一使用者）
  traChoice.set('userB', { candidates: [{ name: '花蓮', id: '7000' }] });
  traChoice.clear('userA');
  assert.strictEqual(traChoice.get('userA'), undefined);
  assert.ok(traChoice.get('userB'), 'userB 的 pending 不該被 userA 的 clear 影響');
});

// ── 兩個 pending 狀態機並存不互咬 ───────────────────────────────────────

test('同一個 user 同時有 traChoice 與 imagePending：各自的觸發字串不會誤命中對方', () => {
  traChoice.set('u1', { candidates: CANDIDATES });
  imagePending.set('u1', { tapText: '記帳 全聯 100' });

  // traChoice 用數字/站名命中，imagePending 的按鈕文字對它來說應該完全不是候選、不命中
  assert.strictEqual(traChoice.matchCandidate('u1', '記帳 全聯 100'), null);

  // imagePending 只精準比對 tapText，traChoice 慣用的數字回覆「1」不該被誤判命中
  assert.strictEqual(imagePending.consumeMatch('u1', '1'), null);

  // 兩邊各自正確的觸發文字仍然都要正常運作，互不影響
  assert.deepStrictEqual(traChoice.matchCandidate('u1', '1'), { name: '台北', id: '1000' });
  const hit = imagePending.consumeMatch('u1', '記帳 全聯 100');
  assert.ok(hit);
});

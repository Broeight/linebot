// 回歸測試：src/lang.js（65 個匯出、6 種語言）。
// 這支不鎖任何翻譯的字面內容（避免「翻譯用詞微調」就打壞測試），而是自動掃描式檢查
// 每一個「回傳字串的 getter」在 6 種支援語言（zh-TW/vi/en/ja/th/id）下都：
// - 回傳非空字串
// - 不殘留未取代的樣板佔位符（如 {item}/{total}）
// - 不混入 undefined／NaN 字樣
// 最常見的回歸是「新增功能時漏翻某個語言」——這支測試把它自動抓出來。
// 唯一鎖字面的是 helpMenu('zh-TW')：防止「加了新功能忘了加進說明選單」。

const h = require('./helpers'); // 設定假金鑰，避免 require src 時 Groq SDK 爆掉
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const lang = require('../src/lang');

// 每個測試都套用假的 store／LINE（就算大多數 getter 用不到，統一套用比較不容易漏）
let env;
beforeEach(() => { env = h.setup(); });
afterEach(() => { env.restore(); });

const LANGS = ['zh-TW', 'vi', 'en', 'ja', 'th', 'id'];

/** 斷言字串「乾淨」：非空、無殘留佔位符、無 undefined/NaN 字樣 */
function assertClean(text, label) {
  assert.strictEqual(typeof text, 'string', `${label} 應回傳字串，實際型別 ${typeof text}`);
  assert.ok(text.length > 0, `${label} 不可回傳空字串`);
  assert.doesNotMatch(text, /\{[a-zA-Z]+\}/, `${label} 殘留未取代的樣板佔位符：${text}`);
  assert.doesNotMatch(text, /\bundefined\b/, `${label} 混入 undefined 字樣：${text}`);
  assert.doesNotMatch(text, /\bNaN\b/, `${label} 混入 NaN 字樣：${text}`);
}

// ── 通用「回傳字串的 getter」，簽名固定是 (code, ...args) ──────────────────
// key＝匯出名稱，value＝除了 code 以外要餵的參數（函式回傳陣列，避免共用同一參照）
const SIMPLE_GETTERS = {
  confirmText: () => [],
  visionPrompt: () => [],
  audioPrefix: () => [],
  reminderPrefix: () => [],
  chooseStationPrompt: () => [],
  shareLocationPrompt: () => [],
  shareLocationLabel: () => [],
  gasStationHeader: () => [],
  gasStationFail: () => [],
  genericError: () => [],
  chatFallback: () => [],
  audioFetchFail: () => [],
  audioUnclear: () => [],
  imageFetchFail: () => [],
  imageUnclear: () => [],
  helpMenu: () => [],
  traUsage: () => [],
  weatherAsk: () => [],
  morningGreeting: () => [],
  morningOff: () => [],
  morningOffNone: () => [],
  medicalAsk: () => [],
  medicalFail: () => [],
  rateAlertNone: () => [],
  rateAlertCleared: () => [],
  rateAlertFail: () => [],
  undoLabel: () => [],
  expenseUndoNone: () => [],
  docReminderLabel: () => [],
  docReminderFail: () => [],
  docDefaultTitle: () => [],
  tutorOff: () => [],
  tutorOffNone: () => [],
  tutorFail: () => [],
  alertOn: () => [],
  alertOff: () => [],
  alertOffNone: () => [],
  alertTranslateFail: () => [],
  shoppingEmpty: () => [],

  // 帶一個字串參數的模板
  lunarDiffNote: () => ['農曆五月廿一'],
  morningLunarLine: () => ['五月廿一'],
  birthdayLine: () => ['媽媽、爸爸'],
  shoppingAlready: () => ['測試'],

  // 帶一個數字參數的模板
  receiptConfirmLabel: () => [120],
  shoppingCleared: () => [3],

  // 多參數模板
  morningOn: () => ['09:00', '台北市'],
  tutorOn: () => ['20:00'],
  receiptConfirmPrompt: () => ['測試店', 120],
  expenseAdded: () => ['測試', 120, 500],
  expenseUndone: () => ['測試', 120, 380],
  docReminderSet: () => ['2026-08-01 09:00', '測試提醒'],
  shoppingAdded: () => ['測試', 3],
  shoppingRemoved: () => ['測試', 2],
  shoppingNotFound: () => ['測試', [{ item: '醬油' }, { item: '鹽' }]],
  reminderClearedAll: () => [],
  reminderDeleted: () => [[{ when: '每天 08:00', message: '吃藥' }, { when: '每週三 19:00', message: '倒垃圾' }]],
  reminderNoMatch: () => ['吃藥'],
  shoppingList: () => [[{ item: '醬油' }, { item: '鹽' }]],
  rateAlertHit: () => [1000, 950],
};

test('SIMPLE_GETTERS 涵蓋 lang.js 目前所有匯出的簡單字串 getter（防新增 getter 忘了補測試）', () => {
  const covered = new Set([
    ...Object.keys(SIMPLE_GETTERS),
    // 以下這些不適用「(code, ...簡單參數) → 乾淨字串」的通用掃描，另外在下方獨立測試
    'mungRamNote', 'rateAlertSet', 'rateAlertCurrent',
    'lunarToday', 'vnHolidayReply', 'tutorLesson', 'alertPush',
    'optionsText', 'welcomeVi',
    // 非「回傳字串」的行為型函式，於檔案後段另有測試
    'detect', 'noteText', 'resolve', 'nameToCode', 'setManual', 'needsWelcome', 'markWelcomed',
  ]);
  const exported = Object.keys(require('../src/lang'));
  const uncovered = exported.filter((name) => !covered.has(name));
  assert.deepStrictEqual(uncovered, [], `這些 lang.js 匯出沒有被任何測試涵蓋：${uncovered.join(', ')}`);
});

for (const [name, argsFn] of Object.entries(SIMPLE_GETTERS)) {
  test(`lang.${name}：6 種語言都回傳乾淨的字串`, () => {
    for (const code of LANGS) {
      const result = lang[name](code, ...argsFn());
      assertClean(result, `${name}('${code}')`);
    }
  });
}

// ── 無 code 參數的固定字串 ──────────────────────────────────────────────

test('lang.optionsText：固定字串，非空且無殘留佔位符', () => {
  assertClean(lang.optionsText(), 'optionsText()');
});

test('lang.welcomeVi：固定字串，非空且無殘留佔位符', () => {
  assertClean(lang.welcomeVi(), 'welcomeVi()');
});

// ── 需要特殊參數形狀的 getter（逐一列舉）───────────────────────────────

test('lang.mungRamNote：mung1／ram 兩種 kind，6 種語言都回傳乾淨字串', () => {
  for (const code of LANGS) {
    assertClean(lang.mungRamNote(code, 'mung1'), `mungRamNote('${code}','mung1')`);
    assertClean(lang.mungRamNote(code, 'ram'), `mungRamNote('${code}','ram')`);
  }
});

test('lang.rateAlertSet：up／down 兩種方向，6 種語言都回傳乾淨字串', () => {
  for (const code of LANGS) {
    assertClean(lang.rateAlertSet(code, 'up', 1000, 900), `rateAlertSet('${code}','up',...)`);
    assertClean(lang.rateAlertSet(code, 'down', 800, 900), `rateAlertSet('${code}','down',...)`);
  }
});

test('lang.rateAlertCurrent：current 有值／null 兩種情況，6 種語言都回傳乾淨字串', () => {
  for (const code of LANGS) {
    assertClean(lang.rateAlertCurrent(code, { direction: 'up', target: 1000 }, 950), `rateAlertCurrent('${code}', current=950)`);
    // current 為 null 時 fmtNum 前有 '?' 的特別處理，不該漏成 undefined/NaN
    assertClean(lang.rateAlertCurrent(code, { direction: 'down', target: 800 }, null), `rateAlertCurrent('${code}', current=null)`);
  }
});

test('lang.lunarToday：一般情況（tw/vn 相同）＋兩地不同日的情況，6 種語言都回傳乾淨字串', () => {
  const fmt = (obj, style) => `五月廿一(${style})`;
  for (const code of LANGS) {
    const same = lang.lunarToday(code, { today: '2026-07-24', tw: {}, vn: {}, differs: false, fmt });
    assertClean(same, `lunarToday('${code}', differs=false)`);

    const diff = lang.lunarToday(code, { today: '2026-07-24', tw: {}, vn: {}, differs: true, fmt });
    assertClean(diff, `lunarToday('${code}', differs=true)`);
  }
});

test('lang.vnHolidayReply：一般情況／今天就是節日／今天就是 Tết，6 種語言都回傳乾淨字串', () => {
  const tet = { days: 10, date: '2026-02-17', yearNameZh: '馬', yearNameVi: 'Ngựa' };
  const next = { vi: 'Tết Nguyên Đán', zh: '農曆新年', en: 'Lunar New Year', daysAway: 5, date: '2026-02-17' };
  for (const code of LANGS) {
    assertClean(lang.vnHolidayReply(code, next, tet), `vnHolidayReply('${code}', 一般情況)`);
    assertClean(lang.vnHolidayReply(code, { ...next, daysAway: 0 }, tet), `vnHolidayReply('${code}', daysAway=0)`);
    assertClean(lang.vnHolidayReply(code, next, { ...tet, days: 0 }), `vnHolidayReply('${code}', tet.days=0)`);
  }
});

test('lang.tutorLesson：3 句課程內容，6 種語言都回傳乾淨字串，且包含每句內容', () => {
  const theme = { zh: '食物', vi: 'Đồ ăn' };
  const phrases = [
    { zh: '你好', pinyin: 'nǐ hǎo', vi: 'xin chào' },
    { zh: '謝謝', pinyin: 'xièxiè', vi: 'cảm ơn' },
    { zh: '再見', pinyin: 'zàijiàn', vi: 'tạm biệt' },
  ];
  for (const code of LANGS) {
    const text = lang.tutorLesson(code, theme, phrases);
    assertClean(text, `tutorLesson('${code}')`);
    for (const p of phrases) {
      assert.ok(text.includes(p.zh), `tutorLesson('${code}') 應包含課程內容「${p.zh}」`);
      assert.ok(text.includes(p.pinyin), `tutorLesson('${code}') 應包含拼音「${p.pinyin}」`);
      assert.ok(text.includes(p.vi), `tutorLesson('${code}') 應包含越南語「${p.vi}」`);
    }
  }
});

test('lang.alertPush：一般情況（含 effective/expires/agency）／缺欄位／未知類別，都回傳乾淨字串', () => {
  const full = { category: '颱風', effective: '2026-07-24 10:00', expires: '2026-07-25 10:00', agency: '中央氣象署' };
  for (const code of LANGS) {
    const withAll = lang.alertPush(code, full, '測試內容');
    assertClean(withAll, `alertPush('${code}', 完整欄位)`);
    assert.ok(withAll.includes('測試內容'));

    // 缺 effective/expires/agency：不該印出 undefined，也不該多印出時間/機關那幾行
    const minimal = lang.alertPush(code, { category: '地震' }, '測試內容');
    assertClean(minimal, `alertPush('${code}', 缺欄位)`);

    // 未知類別：標籤與 emoji 都要有安全預設值，不可 throw、不可漏字
    const unknown = lang.alertPush(code, { category: '不明類別' }, '測試內容');
    assertClean(unknown, `alertPush('${code}', 未知類別)`);
    assert.ok(unknown.includes('不明類別'), '查無對應標籤時應該退回顯示原始類別字串');
  }
});

// ── 只鎖一條字面：helpMenu('zh-TW') 必須包含目前所有主要功能關鍵字 ──────────
// 目的：防止「加了新功能，卻忘了加進 /help 選單」這種真實發生過的回歸。

test('lang.helpMenu(zh-TW) 涵蓋目前所有主要功能關鍵字', () => {
  const text = lang.helpMenu('zh-TW');
  const mustInclude = [
    '提醒', '生日', '記帳', '購物清單', '天氣', '早安', '健康', '就醫卡', '喝水',
    '學中文', '警報', '匯率', '放假', '農曆', '油價', '加油站', '台鐵', '翻譯',
    '對獎', '吃什麼', '語言', '/reset',
  ];
  const missing = mustInclude.filter((kw) => !text.includes(kw));
  assert.deepStrictEqual(missing, [], `/help 選單缺少這些功能關鍵字：${missing.join('、')}`);
});

// ── 非字串 getter 的行為型函式（detect／nameToCode／resolve／...） ─────────

test('lang.detect：依文字特徵粗略判斷語言', () => {
  assert.strictEqual(lang.detect('xin chào các bạn'), 'vi'); // 越南語特有字母 à
  assert.strictEqual(lang.detect('こんにちは'), 'ja');
  assert.strictEqual(lang.detect('สวัสดีครับ'), 'th');
  assert.strictEqual(lang.detect('你好嗎'), 'zh-TW');
  assert.strictEqual(lang.detect('hello there'), 'en');
  assert.strictEqual(lang.detect(''), null);
  assert.strictEqual(lang.detect(null), null);
});

test('lang.nameToCode：語言名稱（中／英／越）對應到正確 code，辨識不出回 null', () => {
  assert.strictEqual(lang.nameToCode('越南語'), 'vi');
  assert.strictEqual(lang.nameToCode('tiếng việt'), 'vi');
  assert.strictEqual(lang.nameToCode('中文'), 'zh-TW');
  assert.strictEqual(lang.nameToCode('english'), 'en');
  assert.strictEqual(lang.nameToCode('日文'), 'ja');
  assert.strictEqual(lang.nameToCode('泰文'), 'th');
  assert.strictEqual(lang.nameToCode('印尼'), 'id');
  assert.strictEqual(lang.nameToCode('火星文'), null);
});

test('lang.confirmText：查無語言時退回 zh-TW 版本', () => {
  assert.strictEqual(lang.confirmText('xx'), lang.confirmText('zh-TW'));
});

// ── 需要 store／LINE 假身的行為型函式：noteText／resolve／setManual／needsWelcome ──

test('lang.setManual + noteText：手動設定後鎖定，之後自動偵測不會覆蓋', () => {
  lang.setManual('u1', 'vi');
  lang.noteText('u1', '你好嗎'); // 中文訊息，若沒鎖定會被自動改判成 zh-TW
  const rows = env.read('lang.json');
  const row = rows.find((r) => r.userId === 'u1');
  assert.strictEqual(row.lang, 'vi', '手動鎖定後，自動偵測不該覆蓋語言');
  assert.strictEqual(row.locked, true);
});

test('lang.noteText：未鎖定時，依偵測結果自動更新慣用語言', () => {
  lang.noteText('u2', 'xin chào các bạn');
  let row = env.read('lang.json').find((r) => r.userId === 'u2');
  assert.strictEqual(row.lang, 'vi');

  lang.noteText('u2', '你好嗎');
  row = env.read('lang.json').find((r) => r.userId === 'u2');
  assert.strictEqual(row.lang, 'zh-TW', '未鎖定時應隨最新一則訊息更新語言判斷');
});

test('lang.resolve：已有記錄時直接回傳，不會呼叫 LINE 個人檔 API', async () => {
  env.seedLang('u3', 'en');
  const code = await lang.resolve('u3');
  assert.strictEqual(code, 'en');
});

test('lang.resolve：沒有記錄時查 LINE 個人檔語言並寫回', async () => {
  // helpers 預設 getProfile 回傳 { language: 'zh-TW' }
  const code = await lang.resolve('u4');
  assert.strictEqual(code, 'zh-TW');
  const row = env.read('lang.json').find((r) => r.userId === 'u4');
  assert.ok(row, '查到 LINE 個人檔語言後應該寫回 lang.json');
  assert.strictEqual(row.locked, false);
});

test('lang.needsWelcome / markWelcomed：vi 使用者第一次為 true，標記後變 false', () => {
  lang.setManual('u5', 'vi');
  assert.strictEqual(lang.needsWelcome('u5'), true);
  lang.markWelcomed('u5');
  assert.strictEqual(lang.needsWelcome('u5'), false);
});

test('lang.needsWelcome：非 vi 使用者一律 false', () => {
  lang.setManual('u6', 'en');
  assert.strictEqual(lang.needsWelcome('u6'), false);
});

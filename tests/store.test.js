// store：資料儲存層。這裡最重要的一條是「KNOWN_KEYS 有沒有漏登記」——
// 漏了不會有任何錯誤訊息，但部署到 Render 後那份資料就再也回不來（踩過一次）。
// 這支測試把「人要記得」變成「機器會擋」。

require('./helpers'); // 只為了設定假金鑰，避免 require src 時 Groq SDK 爆掉
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const store = require('../src/store');

const SRC_DIR = path.join(__dirname, '..', 'src');

// 這些 .json 不是「資料檔」，不需要登記在 KNOWN_KEYS
const NOT_DATA_FILES = new Set(['package.json', 'package-lock.json', 'tsconfig.json']);

/** 遞迴列出 src/ 下所有 .js 檔 */
function allSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allSourceFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** 掃出程式碼裡所有出現過的 'xxx.json' 字串字面 */
function referencedDataFiles() {
  const found = new Set();
  for (const file of allSourceFiles(SRC_DIR)) {
    const code = fs.readFileSync(file, 'utf8');
    for (const m of code.matchAll(/['"]([\w-]+\.json)['"]/g)) {
      if (!NOT_DATA_FILES.has(m[1])) found.add(m[1]);
    }
  }
  return found;
}

test('KNOWN_KEYS 涵蓋程式碼實際用到的每一個資料檔（漏登記＝部署後資料靜默消失）', () => {
  const registered = new Set(store._internal.KNOWN_KEYS);
  const used = referencedDataFiles();

  const missing = [...used].filter((f) => !registered.has(f)).sort();
  assert.deepStrictEqual(
    missing,
    [],
    `這些資料檔在程式碼裡用到、卻沒登記進 src/store.js 的 KNOWN_KEYS：\n` +
      missing.map((f) => `  - ${f}`).join('\n') +
      `\n漏登記不會報錯，但 Render 重啟後這些資料不會從雲端還原（＝使用者資料消失）。`
  );
});

test('KNOWN_KEYS 沒有重複項目', () => {
  const keys = store._internal.KNOWN_KEYS;
  assert.strictEqual(new Set(keys).size, keys.length, `KNOWN_KEYS 有重複：${keys.join(', ')}`);
});

test('KNOWN_KEYS 裡沒有已經沒人用的孤兒檔案', () => {
  const used = referencedDataFiles();
  const orphans = store._internal.KNOWN_KEYS.filter((f) => !used.has(f));
  assert.deepStrictEqual(orphans, [], `KNOWN_KEYS 登記了但程式碼已無人使用：${orphans.join(', ')}`);
});

test('load() 讀不到的檔案回空陣列（而不是 undefined／throw）', () => {
  const result = store.load('__絕對不存在的檔案__.json');
  assert.deepStrictEqual(result, []);
});

test('load() 回傳的是副本：呼叫端改它不會污染儲存的資料', () => {
  const NAME = '__store_test_clone__.json';
  store._internal.cache.set(NAME, [{ a: 1 }]); // 直接塞快取，不碰硬碟
  try {
    const first = store.load(NAME);
    first.push({ b: 2 });
    first[0].a = 999;

    const second = store.load(NAME);
    assert.deepStrictEqual(second, [{ a: 1 }], 'load() 必須回 clone，否則呼叫端的修改會污染快取');
  } finally {
    store._internal.cache.delete(NAME);
  }
});

test('taipei() 回傳台北時間的固定格式', () => {
  const t = store.taipei();
  assert.match(t.date, /^\d{4}-\d{2}-\d{2}$/, 'date 應為 YYYY-MM-DD');
  assert.match(t.md, /^\d{2}-\d{2}$/, 'md 應為 MM-DD');
  assert.match(t.ym, /^\d{4}-\d{2}$/, 'ym 應為 YYYY-MM');
  assert.match(t.hm, /^\d{2}:\d{2}$/, 'hm 應為 HH:mm');
  // 各欄位必須彼此一致（同一個時間點切出來的）
  assert.strictEqual(t.md, t.date.slice(5), 'md 必須等於 date 的月日部分');
  assert.strictEqual(t.ym, t.date.slice(0, 7), 'ym 必須等於 date 的年月部分');
});

// 家人生日：國曆／農曆記錄、倒數、當天命中判斷。
//
// 農曆部分刻意「不 stub」lunar.js，直接用真實曆法引擎跑，才驗得到真正的曆法邏輯
// （閏月、大小月、三十缺日）而不是驗到一個我們自己虛構的假結果。以下權威對照值
// 皆用 lunar.js 本身現算現查（見 PR 描述／測試前置調查），非憑空編造。

const h = require('./helpers');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const birthday = require('../src/services/birthday');

let env;
beforeEach(() => { env = h.setup(); });
afterEach(() => { env.restore(); });

// birthday.js 用 store.taipei().date 與 .md 兩個欄位，兩個都要給。
function setToday(date) {
  env.setTime({ date, md: date.slice(5) });
}

// ── 國曆生日：add／list／remove／todays 基本行為 ─────────────────────────

test('add：新增國曆生日，回覆含日期與倒數天數', () => {
  setToday('2026-07-24');
  const msg = birthday.add('u1', '媽媽 8/15');
  assert.match(msg, /已記住 媽媽 的生日：08-15/);
  assert.match(msg, /還有 \d+ 天/);
  const saved = env.read('birthdays.json');
  assert.strictEqual(saved.length, 1);
  assert.deepStrictEqual(saved[0], { userId: 'u1', name: '媽媽', md: '08-15' });
});

test('add：同一人重複新增會覆蓋舊資料（不會疊加兩筆）', () => {
  setToday('2026-07-24');
  birthday.add('u1', '媽媽 8/15');
  birthday.add('u1', '媽媽 9/1');
  const saved = env.read('birthdays.json');
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].md, '09-01');
});

test('add：格式不對回引導句，不存檔', () => {
  const msg = birthday.add('u1', '媽媽');
  assert.match(msg, /格式：生日 名字 日期/);
  assert.deepStrictEqual(env.read('birthdays.json'), []);
});

test('add：日期看不懂回錯誤句，不存檔', () => {
  const msg = birthday.add('u1', '媽媽 十五號');
  assert.match(msg, /看不懂日期/);
  assert.deepStrictEqual(env.read('birthdays.json'), []);
});

test('list：顯示生日清單並依倒數天數排序', () => {
  setToday('2026-07-24');
  env.seed('birthdays.json', [
    { userId: 'u1', name: '爸爸', md: '12-25' },
    { userId: 'u1', name: '媽媽', md: '08-01' },
  ]);
  const out = birthday.list('u1');
  const idxMom = out.indexOf('媽媽');
  const idxDad = out.indexOf('爸爸');
  assert.ok(idxMom !== -1 && idxDad !== -1);
  assert.ok(idxMom < idxDad, '較近的生日應排在前面');
});

test('list：今天生日顯示「就是今天！」', () => {
  setToday('2026-07-24');
  env.seed('birthdays.json', [{ userId: 'u1', name: '媽媽', md: '07-24' }]);
  assert.match(birthday.list('u1'), /媽媽：07-24\s*🎉 就是今天！/);
});

test('list：沒有生日資料時顯示引導句', () => {
  assert.strictEqual(birthday.list('u1'), '還沒有記錄任何生日。輸入「生日 媽媽 8/15」新增。');
});

test('remove：刪除存在的生日', () => {
  env.seed('birthdays.json', [{ userId: 'u1', name: '媽媽', md: '08-15' }]);
  const msg = birthday.remove('u1', '媽媽');
  assert.match(msg, /已刪除 媽媽 的生日/);
  assert.deepStrictEqual(env.read('birthdays.json'), []);
});

test('remove：刪除不存在的生日回找不到訊息，不動到其他資料', () => {
  env.seed('birthdays.json', [{ userId: 'u1', name: '媽媽', md: '08-15' }]);
  const msg = birthday.remove('u1', '阿公');
  assert.match(msg, /找不到「阿公」的生日/);
  assert.strictEqual(env.read('birthdays.json').length, 1);
});

test('todays：只回今天生日的人（國曆），前後一天不命中', () => {
  env.seed('birthdays.json', [
    { userId: 'u1', name: '媽媽', md: '07-24' },
    { userId: 'u1', name: '爸爸', md: '07-25' },
  ]);
  setToday('2026-07-24');
  assert.deepStrictEqual(birthday.todays('u1'), ['媽媽']);
  setToday('2026-07-23');
  assert.deepStrictEqual(birthday.todays('u1'), []);
  setToday('2026-07-25');
  assert.deepStrictEqual(birthday.todays('u1'), ['爸爸']);
});

// ── parseMD：各種寫法與非法值（經 add() 間接驗證，因 parseMD 未匯出）────────

test('parseMD：各種常見寫法都能解析成 MM-DD', () => {
  const writings = ['8/15', '08-15', '0815', '8月15日'];
  for (const w of writings) {
    env.seed('birthdays.json', []);
    setToday('2026-01-01');
    const msg = birthday.add('u1', `測試 ${w}`);
    assert.match(msg, /08-15/, `寫法「${w}」應解析成 08-15，實際訊息：${msg}`);
  }
});

test('parseMD：非法值（月份或日期超出範圍）回錯誤句，不存檔', () => {
  for (const bad of ['13/1', '0/5', '99/99', 'abc']) {
    env.seed('birthdays.json', []);
    const msg = birthday.add('u1', `測試 ${bad}`);
    assert.match(msg, /看不懂日期/, `「${bad}」應被拒絕，實際訊息：${msg}`);
    assert.deepStrictEqual(env.read('birthdays.json'), []);
  }
});

// ── 農曆生日（真實 lunar.js 引擎）────────────────────────────────────────

test('addLunar：農曆生日 8/15 在 2026 年換算成國曆 2026-09-25（權威對照值）', () => {
  setToday('2026-07-24');
  const msg = birthday.addLunar('u1', '阿嬤 8/15');
  assert.match(msg, /農曆8\/15/);
  assert.match(msg, /國曆 09-25/);
  assert.deepStrictEqual(env.read('birthdays.json'), [{ userId: 'u1', name: '阿嬤', lm: '08-15' }]);
});

test('todays：農曆生日在對應的國曆當天命中，前後一天不命中', () => {
  env.seed('birthdays.json', [{ userId: 'u1', name: '阿嬤', lm: '08-15' }]);
  setToday('2026-09-25');
  assert.deepStrictEqual(birthday.todays('u1'), ['阿嬤']);
  setToday('2026-09-24');
  assert.deepStrictEqual(birthday.todays('u1'), []);
  setToday('2026-09-26');
  assert.deepStrictEqual(birthday.todays('u1'), []);
});

test('addLunar：農曆日期超過 30 回錯誤句，不存檔', () => {
  const msg = birthday.addLunar('u1', '阿嬤 8/31');
  assert.match(msg, /農曆日期最多到 30/);
  assert.deepStrictEqual(env.read('birthdays.json'), []);
});

// 閏月：2025-08-08 是「閏六月十五」（lunar.js 現算：leap=1）。
// 存 lm='06-15'（正六月）在閏月的那天不可命中；真正的「正六月十五」
// （現算為國曆 2025-07-09）才要命中。
test('todays：閏月不誤判——閏六月十五當天不命中，正六月十五才命中', () => {
  env.seed('birthdays.json', [{ userId: 'u1', name: '閏月哥', lm: '06-15' }]);

  setToday('2025-08-08'); // 閏六月十五
  assert.deepStrictEqual(birthday.todays('u1'), [], '閏月不可誤判成正六月命中');

  setToday('2025-07-09'); // 正六月十五（現算對照值）
  assert.deepStrictEqual(birthday.todays('u1'), ['閏月哥']);
});

// 三十缺日（小月）：2026 農曆二月只有 29 天（現算：lunar2solar(30,2,2026,...) 換算後
// roundtrip 不回 30 號，故 clamp 到廿九）。存 lm='02-30' 應在「農曆二月廿九」當天
// （現算國曆 2026-04-16）命中，廿八不可提前命中；list() 顯示的國曆日期要等於
// 這個實際會命中的日子，不可顯示虛構的三十。
test('todays／list：小月三十缺日——存「2/30」在農曆廿九當天命中，且不提前一天命中', () => {
  env.seed('birthdays.json', [{ userId: 'u1', name: '小月妹', lm: '02-30' }]);

  setToday('2026-04-16'); // 農曆二月廿九（該月最後一天）
  assert.deepStrictEqual(birthday.todays('u1'), ['小月妹']);

  setToday('2026-04-15'); // 農曆二月廿八
  assert.deepStrictEqual(birthday.todays('u1'), []);

  // list() 顯示的國曆日期必須等於實際命中那天（04-16），不可顯示虛構的三十
  setToday('2026-04-01'); // 生日尚未到，list() 會換算「今年」的對應國曆日
  assert.match(birthday.list('u1'), /小月妹：農曆2\/30（今年＝國曆 04-16）/);
});

// 大月：2026 農曆正月有 30 天（現算：1/30 → 國曆 2026-03-18；廿九 → 2026-03-17）。
// 存「1/30」只在 03-18 命中，廿九（03-17）不可提前命中。
test('todays／list：大月三十——存「1/30」只在正月三十當天命中，廿九不可提前命中', () => {
  env.seed('birthdays.json', [{ userId: 'u1', name: '大月弟', lm: '01-30' }]);

  setToday('2026-03-18'); // 農曆正月三十
  assert.deepStrictEqual(birthday.todays('u1'), ['大月弟']);

  setToday('2026-03-17'); // 農曆正月廿九，不可提前命中
  assert.deepStrictEqual(birthday.todays('u1'), []);

  setToday('2026-03-01');
  assert.match(birthday.list('u1'), /大月弟：農曆1\/30（今年＝國曆 03-18）/);
});

// 壞資料防禦：手改資料／雲端損毀的壞值不可讓 list()／todays() 拋例外或誤命中。
test('壞資料防禦：lm 為 null／格式不符／範圍超出／md與lm皆缺，list() 不拋例外、顯示異常行', () => {
  env.seed('birthdays.json', [
    { userId: 'u1', name: '壞1' /* md、lm 都缺 */ },
    { userId: 'u1', name: '壞2', lm: null },
    { userId: 'u1', name: '壞3', lm: 'ab-cd' },
    { userId: 'u1', name: '壞4', lm: '13-40' },
  ]);
  const out = birthday.list('u1');
  for (const name of ['壞1', '壞2', '壞3', '壞4']) {
    assert.match(out, new RegExp(`${name}：（生日資料異常，請刪除後重新記錄）`));
  }
});

test('壞資料防禦：todays() 對壞資料不命中、不拋例外', () => {
  env.seed('birthdays.json', [
    { userId: 'u1', name: '壞1' },
    { userId: 'u1', name: '壞2', lm: null },
    { userId: 'u1', name: '壞3', lm: 'ab-cd' },
    { userId: 'u1', name: '壞4', lm: '13-40' },
  ]);
  setToday('2026-07-24');
  assert.doesNotThrow(() => birthday.todays('u1'));
  assert.deepStrictEqual(birthday.todays('u1'), []);
});

// 提醒服務：全專案最複雜、最容易靜默失效的模組——提醒不響，使用者根本不會知道，
// 所以這支測試把「觸發矩陣」「短月 clamp」「死提醒防禦」「防重入」都釘死。
//
// ⚠️ tick() 結束時會用「真的」global.setTimeout 排下一輪（30 秒後）。若不攔截，
//    這個 timer 會在測試結束、env.restore() 之後才觸發，屆時 store/line 已還原成
//    真實模組，等於背景偷跑一次會碰真實 data/ 檔案、甚至打 LINE API 的 tick()。
//    因此本檔在最外層攔截 global.setTimeout，只要目標函式是 reminder.tick，
//    就記錄下 timer id，afterEach 一律 clearTimeout，確保測試之間、測試結束後
//    都不會有殘留的背景排程。

const h = require('./helpers');
const { test, beforeEach, afterEach, before, after } = require('node:test');
const assert = require('node:assert');

const reminder = require('../src/services/reminder');

let env;
let pendingTickTimers;
let realSetTimeout;

before(() => {
  realSetTimeout = global.setTimeout;
  pendingTickTimers = new Set();
  global.setTimeout = (fn, ms, ...args) => {
    const id = realSetTimeout(fn, ms, ...args);
    if (fn === reminder.tick) pendingTickTimers.add(id);
    return id;
  };
});

after(() => {
  global.setTimeout = realSetTimeout;
});

beforeEach(() => {
  env = h.setup();
});

afterEach(() => {
  for (const id of pendingTickTimers) clearTimeout(id);
  pendingTickTimers.clear();
  env.restore();
});

// 台北時間切片，供 tick() 的測試縫（now, nowMs）使用。
const NOW = { date: '2026-07-24', hm: '10:00', weekday: 5, day: 24, daysInMonth: 31 };

// ── once ──────────────────────────────────────────────────────────────

test('once：到時間推播一次，並從清單移除', async () => {
  env.seed('reminders.json', [{ id: 'a1', userId: 'u1', type: 'once', fireAt: Date.now() - 1000, message: '回診' }]);
  await reminder.tick(NOW, Date.now());
  assert.strictEqual(env.pushes.length, 1);
  assert.strictEqual(env.pushes[0].to, 'u1');
  assert.strictEqual(env.pushes[0].messages[0].text, '⏰ 提醒：回診');
  assert.deepStrictEqual(env.read('reminders.json'), []);
});

test('once：時間未到不推播、不移除', async () => {
  env.seed('reminders.json', [{ id: 'a1', userId: 'u1', type: 'once', fireAt: Date.now() + 100000, message: '回診' }]);
  await reminder.tick(NOW, Date.now());
  assert.strictEqual(env.pushes.length, 0);
  assert.strictEqual(env.read('reminders.json').length, 1);
});

// ── daily ─────────────────────────────────────────────────────────────

test('daily：時刻到推播一次；同日再 tick 不重推；隔日再推', async () => {
  env.seed('reminders.json', [{ id: 'd1', userId: 'u1', type: 'daily', dailyTime: '19:00', message: '吃藥', lastFired: '' }]);
  const day1 = { date: '2026-07-24', hm: '19:00', weekday: 5, day: 24, daysInMonth: 31 };
  await reminder.tick(day1, Date.now());
  assert.strictEqual(env.pushes.length, 1, '第一次到時間應推播');

  await reminder.tick(day1, Date.now());
  assert.strictEqual(env.pushes.length, 1, '同一天再 tick 不應重推');

  const day2 = { date: '2026-07-25', hm: '19:00', weekday: 6, day: 25, daysInMonth: 31 };
  await reminder.tick(day2, Date.now());
  assert.strictEqual(env.pushes.length, 2, '隔天同一時刻應再推一次');
});

test('daily：時刻不對不推播', async () => {
  env.seed('reminders.json', [{ id: 'd1', userId: 'u1', type: 'daily', dailyTime: '19:00', message: '吃藥', lastFired: '' }]);
  await reminder.tick({ date: '2026-07-24', hm: '18:59', weekday: 5, day: 24, daysInMonth: 31 }, Date.now());
  assert.strictEqual(env.pushes.length, 0);
});

// ── weekly ────────────────────────────────────────────────────────────

test('weekly：星期＋時刻都對才推；同日不重推；隔天不推；下週同一天再推', async () => {
  // weekday: 3 = 星期三
  env.seed('reminders.json', [{ id: 'w1', userId: 'u1', type: 'weekly', weekday: 3, time: '08:00', message: '倒垃圾', lastFired: '' }]);

  // 星期對、時刻不對 → 不推
  await reminder.tick({ date: '2026-07-22', hm: '07:00', weekday: 3, day: 22, daysInMonth: 31 }, Date.now());
  assert.strictEqual(env.pushes.length, 0, '時刻不對不該推');

  // 時刻對、星期不對 → 不推
  await reminder.tick({ date: '2026-07-23', hm: '08:00', weekday: 4, day: 23, daysInMonth: 31 }, Date.now());
  assert.strictEqual(env.pushes.length, 0, '星期不對不該推');

  // 星期＋時刻都對 → 推
  const wed1 = { date: '2026-07-22', hm: '08:00', weekday: 3, day: 22, daysInMonth: 31 };
  await reminder.tick(wed1, Date.now());
  assert.strictEqual(env.pushes.length, 1, '星期＋時刻都對應該推');

  // 同一天再 tick → 不重推
  await reminder.tick(wed1, Date.now());
  assert.strictEqual(env.pushes.length, 1, '同一天不該重推');

  // 隔天（星期四）→ 不推
  await reminder.tick({ date: '2026-07-23', hm: '08:00', weekday: 4, day: 23, daysInMonth: 31 }, Date.now());
  assert.strictEqual(env.pushes.length, 1, '隔天星期不對不該推');

  // 下週同一天（星期三）→ 再推一次
  const wed2 = { date: '2026-07-29', hm: '08:00', weekday: 3, day: 29, daysInMonth: 31 };
  await reminder.tick(wed2, Date.now());
  assert.strictEqual(env.pushes.length, 2, '下週同一天應該再推一次');
});

// ── monthly（含短月 clamp）───────────────────────────────────────────

test('monthly：日期＋時刻對才推；短月 clamp（每月31號在2月28號推，3月28號不誤推，3月31號能再推）', async () => {
  env.seed('reminders.json', [{ id: 'm1', userId: 'u1', type: 'monthly', dayOfMonth: 31, time: '09:00', message: '繳卡費', lastFired: '' }]);

  // 2 月只有 28 天：31 號 clamp 到 28 號應該推
  await reminder.tick({ date: '2026-02-28', hm: '09:00', weekday: 6, day: 28, daysInMonth: 28 }, Date.now());
  assert.strictEqual(env.pushes.length, 1, '短月 clamp：2月28號應該推');

  // 3 月有 31 天（不是短月）：28 號不該被誤判成 clamp 目標而推
  await reminder.tick({ date: '2026-03-28', hm: '09:00', weekday: 6, day: 28, daysInMonth: 31 }, Date.now());
  assert.strictEqual(env.pushes.length, 1, '大月的28號不可誤推');

  // 3 月 31 號（真正的日期）：跨月後應能再推一次
  await reminder.tick({ date: '2026-03-31', hm: '09:00', weekday: 2, day: 31, daysInMonth: 31 }, Date.now());
  assert.strictEqual(env.pushes.length, 2, '跨月後31號應該能再推');
});

test('monthly：日期對時刻不對不推播', async () => {
  env.seed('reminders.json', [{ id: 'm1', userId: 'u1', type: 'monthly', dayOfMonth: 5, time: '09:00', message: 'x', lastFired: '' }]);
  await reminder.tick({ date: '2026-07-05', hm: '08:00', weekday: 0, day: 5, daysInMonth: 31 }, Date.now());
  assert.strictEqual(env.pushes.length, 0);
});

// ── tick 併發防重入 ───────────────────────────────────────────────────

test('tick 併發防重入：連續同步呼叫兩次，第二次應被 ticking 旗標擋掉，不重複推播', async () => {
  env.seed('reminders.json', [{ id: 'c1', userId: 'u1', type: 'once', fireAt: Date.now() - 1000, message: '併發測試' }]);
  const p1 = reminder.tick(NOW, Date.now());
  const p2 = reminder.tick(NOW, Date.now()); // 應立即因 ticking=true 而直接 return
  await Promise.all([p1, p2]);
  assert.strictEqual(env.pushes.length, 1, '同時呼叫兩次 tick 只應推播一次');
});

// ── normHM 死提醒防禦（上一輪抓到的真 bug：時分超出範圍不可存成永遠不會響的提醒）──

test('addParsed：weekly 傳非法 time（25:00）應套用預設 09:00，而不是存下死提醒', () => {
  const r = reminder.addParsed('u1', { type: 'weekly', weekday: 'wednesday', time: '25:00', message: 'x' });
  assert.strictEqual(r.ok, true);
  const saved = env.read('reminders.json');
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].time, '09:00');
});

test('addParsed：monthly 傳非法 time（25:00）應套用預設 09:00，而不是存下死提醒', () => {
  const r = reminder.addParsed('u1', { type: 'monthly', dayOfMonth: 5, time: '25:00', message: 'x' });
  assert.strictEqual(r.ok, true);
  const saved = env.read('reminders.json');
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].time, '09:00');
});

test('addParsed：daily 傳非法 dailyTime（25:00）應直接回 {ok:false}，不存檔', () => {
  const r = reminder.addParsed('u1', { type: 'daily', dailyTime: '25:00', message: 'x' });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(env.read('reminders.json'), []);
});

// ── toWeekdayNum（未匯出，透過 addParsed 的 weekly 分支黑箱驗證）──────────

test('addParsed weekly：weekday 收英文全名／三字縮寫（大小寫不拘）／數字字串／整數', () => {
  const cases = [
    ['wednesday', 3],
    ['wed', 3],
    ['WED', 3],
    ['3', 3],
    [3, 3],
    ['sun', 0],
    ['Sunday', 0],
  ];
  for (const [input, expected] of cases) {
    env.seed('reminders.json', []);
    const r = reminder.addParsed('u1', { type: 'weekly', weekday: input, time: '09:00', message: 'x' });
    assert.strictEqual(r.ok, true, `weekday=${JSON.stringify(input)} 應該可辨識`);
    assert.strictEqual(env.read('reminders.json')[0].weekday, expected, `weekday=${JSON.stringify(input)} 應對應到 ${expected}`);
  }
});

test('addParsed weekly：weekday 為 7／-1／亂字串／null 應回 {ok:false}，不存檔', () => {
  for (const input of [7, -1, 'foobar', null]) {
    env.seed('reminders.json', []);
    const r = reminder.addParsed('u1', { type: 'weekly', weekday: input, time: '09:00', message: 'x' });
    assert.strictEqual(r.ok, false, `weekday=${JSON.stringify(input)} 應該被拒絕`);
    assert.deepStrictEqual(env.read('reminders.json'), []);
  }
});

// ── removeByIndex ─────────────────────────────────────────────────────

test('removeByIndex：刪第 N 筆正確', () => {
  env.seed('reminders.json', [
    { id: 'a', userId: 'u1', type: 'once', fireAt: Date.now() + 99999, message: 'm1' },
    { id: 'b', userId: 'u1', type: 'daily', dailyTime: '08:00', message: 'm2', lastFired: '' },
  ]);
  const msg = reminder.removeByIndex('u1', 2);
  assert.match(msg, /已刪除提醒/);
  assert.match(msg, /m2/);
  const left = env.read('reminders.json');
  assert.strictEqual(left.length, 1);
  assert.strictEqual(left[0].id, 'a');
});

test('removeByIndex：超出範圍回錯誤句、不刪除任何提醒', () => {
  env.seed('reminders.json', [{ id: 'a', userId: 'u1', type: 'once', fireAt: Date.now() + 99999, message: 'm1' }]);
  const msg = reminder.removeByIndex('u1', 99);
  assert.match(msg, /找不到編號/);
  assert.strictEqual(env.read('reminders.json').length, 1);
});

test('removeByIndex：非數字（null）回引導句、不刪除任何提醒', () => {
  env.seed('reminders.json', [{ id: 'a', userId: 'u1', type: 'once', fireAt: Date.now() + 99999, message: 'm1' }]);
  const msg = reminder.removeByIndex('u1', null);
  assert.match(msg, /刪除提醒 編號/);
  assert.strictEqual(env.read('reminders.json').length, 1);
});

test('removeByIndex：tag:"water" 的喝水提醒不進編號，也刪不到', () => {
  env.seed('reminders.json', [
    { id: 'a', userId: 'u1', type: 'once', fireAt: Date.now() + 99999, message: 'm1' },
    { id: 'water1', userId: 'u1', type: 'daily', dailyTime: '08:00', message: '喝水', lastFired: '', tag: 'water' },
  ]);
  // 只有 1 筆可編號（喝水提醒不算），所以編號 2 應該找不到
  const msg = reminder.removeByIndex('u1', 2);
  assert.match(msg, /找不到編號/);
  const left = env.read('reminders.json');
  assert.strictEqual(left.length, 2, '喝水提醒不該被誤刪');
  assert.ok(left.some((r) => r.id === 'water1'));
});

// ── list() ────────────────────────────────────────────────────────────

test('list()：once/daily/weekly/monthly 四種型別顯示可分辨', () => {
  env.seed('reminders.json', [
    { id: 'o', userId: 'u1', type: 'once', fireAt: Date.now() + 99999, message: 'm-once' },
    { id: 'd', userId: 'u1', type: 'daily', dailyTime: '08:00', message: 'm-daily', lastFired: '' },
    { id: 'w', userId: 'u1', type: 'weekly', weekday: 3, time: '08:00', message: 'm-weekly', lastFired: '' },
    { id: 'mo', userId: 'u1', type: 'monthly', dayOfMonth: 5, time: '08:00', message: 'm-monthly', lastFired: '' },
    { id: 'water1', userId: 'u1', type: 'daily', dailyTime: '08:00', message: '喝水', lastFired: '', tag: 'water' },
  ]);
  const out = reminder.list('u1');
  const lines = out.split('\n');

  assert.ok(lines.some((l) => l.startsWith('1.') && l.includes('m-once')), '第1筆應為 once');
  assert.ok(lines.some((l) => l.startsWith('2.') && l.includes('每天 08:00') && l.includes('m-daily')), '第2筆應為 daily');
  assert.ok(lines.some((l) => l.startsWith('3.') && l.includes('每週三 08:00') && l.includes('m-weekly')), '第3筆應為 weekly');
  assert.ok(lines.some((l) => l.startsWith('4.') && l.includes('每月5號 08:00') && l.includes('m-monthly')), '第4筆應為 monthly');
  assert.match(out, /💧 喝水提醒：開啟中/);
  // 喝水提醒不佔編號（只有4筆會被編號，不是5筆）
  assert.ok(!lines.some((l) => l.startsWith('5.')));
});

test('list()：沒有任何提醒時顯示引導句', () => {
  const out = reminder.list('u1');
  assert.strictEqual(out, '你目前沒有任何提醒。');
});

// ── add()（自然語言路徑）：鎖字面（使用者天天看到的成功確認句）──────────

test('add()：once 成功確認句鎖精確字串', async () => {
  env.setAi('askJSON', async () => ({ ok: true, type: 'once', datetime: '2026-07-25 09:00', message: '回診' }));
  const msg = await reminder.add('u1', '提醒我 明天9點 回診');
  assert.strictEqual(msg, '✅ 好的，07-25 09:00 我會提醒你：「回診」');
});

test('add()：daily 成功確認句鎖精確字串', async () => {
  env.setAi('askJSON', async () => ({ ok: true, type: 'daily', dailyTime: '08:00', message: '吃藥' }));
  const msg = await reminder.add('u1', '提醒 每天8點 吃藥');
  assert.strictEqual(msg, '✅ 好的，每天 08:00 我會提醒你：「吃藥」');
});

test('add()：AI 解析失敗（ok:false／null）回看不懂時間的引導句，不存檔', async () => {
  env.setAi('askJSON', async () => null); // helpers 預設也是 null，這裡明寫更清楚意圖
  const msg = await reminder.add('u1', '提醒我 隨便');
  assert.match(msg, /我看不懂時間/);
  assert.deepStrictEqual(env.read('reminders.json'), []);
});

// ── add()（關鍵字路徑）：weekly / monthly 分支正確存檔 ───────────────────

test('add()：weekly 分支用 AI 解析結果正確存檔', async () => {
  env.setAi('askJSON', async () => ({ ok: true, type: 'weekly', weekday: 'wednesday', time: '19:00', message: '倒垃圾' }));
  const msg = await reminder.add('u1', '提醒 每週三晚上7點 倒垃圾');
  assert.match(msg, /每週三 19:00/);
  const saved = env.read('reminders.json');
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].type, 'weekly');
  assert.strictEqual(saved[0].weekday, 3);
  assert.strictEqual(saved[0].time, '19:00');
  assert.strictEqual(saved[0].message, '倒垃圾');
});

test('add()：monthly 分支用 AI 解析結果正確存檔', async () => {
  env.setAi('askJSON', async () => ({ ok: true, type: 'monthly', dayOfMonth: 5, time: '09:00', message: '繳費' }));
  const msg = await reminder.add('u1', '提醒 每月5號 繳費');
  assert.match(msg, /每月5號 09:00/);
  const saved = env.read('reminders.json');
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].type, 'monthly');
  assert.strictEqual(saved[0].dayOfMonth, 5);
  assert.strictEqual(saved[0].time, '09:00');
  assert.strictEqual(saved[0].message, '繳費');
});

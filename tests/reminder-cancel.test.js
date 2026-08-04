// 回歸測試：越南家人被每日提醒轟炸、卻無法用自己的語言關掉（真實事故，2026-08-04）。
//
// 事故現場：她說「Kết thúc nhắc nhở ăn kim chi」（結束提醒），bot 回了
// 「Tôi không thể hiểu thời gian. Vui lòng yêu cầu người dùng làm rõ.」
// ——那是工具內部給模型看的英文指示 "Could not understand the time — ask the user
// to clarify." 被模型逐字翻譯後丟給使用者，而且用第三人稱稱呼她。
//
// 三個根因，本檔逐一釘死：
//  1. AI 沒有「刪除提醒」工具 → 只好硬套 set_reminder → 解析時間失敗
//  2. 工具的內部指示文字外洩給使用者
//  3. 重複設定同一個提醒不會被擋 → 同時段多則轟炸

const h = require('./helpers');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const reminder = require('../src/services/reminder');
const handler = require('../src/handler');
const tools = require('../src/tools');
const lang = require('../src/lang');

let env;
beforeEach(() => { env = h.setup(); });
afterEach(() => { env.restore(); });

const U = 'Umei';
const daily = (id, message, dailyTime) => ({ id, userId: U, type: 'daily', dailyTime, message, lastFired: '' });

// ── 1. 關鍵字取消：任何語言都能自己關掉提醒 ─────────────────────

test('removeByKeyword：用越南語事項名可取消提醒（事故當下她做不到的事）', () => {
  env.seed('reminders.json', [
    daily('a', 'ăn kim chi', '08:00'),
    daily('b', 'Đóng điện bảo nhỏ', '12:00'),
  ]);
  const r = reminder.removeByKeyword(U, 'ăn kim chi');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.removed.length, 1);
  assert.strictEqual(r.removed[0].message, 'ăn kim chi');
  assert.strictEqual(r.remaining, 1, '只該刪掉命中的那筆，另一筆要留著');
});

test('removeByKeyword：去聲調比對（她打字漏聲調也要找得到）', () => {
  env.seed('reminders.json', [daily('a', 'ăn kim chi', '08:00')]);
  const r = reminder.removeByKeyword(U, 'an kim chi'); // 無聲調
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.remaining, 0);
});

test('removeByKeyword：大小寫不同視為同一件事（事故中 8:00 有 Ăn／ăn 兩筆）', () => {
  env.seed('reminders.json', [
    daily('a', 'Ăn kim chi', '08:00'),
    daily('b', 'ăn kim chi', '08:00'),
  ]);
  const r = reminder.removeByKeyword(U, 'ăn kim chi');
  assert.strictEqual(r.removed.length, 2, '大小寫不同的重複提醒要一次清掉');
  assert.strictEqual(r.remaining, 0);
});

test('removeByKeyword：整句當關鍵字也能命中（反向包含）', () => {
  env.seed('reminders.json', [daily('a', 'ăn kim chi', '08:00')]);
  const r = reminder.removeByKeyword(U, 'ăn kim chi mỗi ngày');
  assert.strictEqual(r.ok, true);
});

test('removeByKeyword：找不到就不刪任何東西', () => {
  env.seed('reminders.json', [daily('a', '吃藥', '08:00')]);
  const r = reminder.removeByKeyword(U, '完全不存在的事項');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.removed.length, 0);
  assert.strictEqual(env.read('reminders.json').length, 1, '沒命中時清單必須原封不動');
});

test('removeByKeyword：不會刪到別人的提醒', () => {
  env.seed('reminders.json', [
    daily('a', '吃藥', '08:00'),
    { id: 'b', userId: 'Uother', type: 'daily', dailyTime: '08:00', message: '吃藥', lastFired: '' },
  ]);
  const r = reminder.removeByKeyword(U, '吃藥');
  assert.strictEqual(r.removed.length, 1);
  const left = env.read('reminders.json');
  assert.strictEqual(left.length, 1);
  assert.strictEqual(left[0].userId, 'Uother', '別人的提醒不可被刪');
});

test('removeByKeyword：空關鍵字不得清空整份清單（防手滑全刪）', () => {
  env.seed('reminders.json', [daily('a', '吃藥', '08:00')]);
  for (const bad of ['', '   ', null, undefined]) {
    const r = reminder.removeByKeyword(U, bad);
    assert.strictEqual(r.ok, false, `空關鍵字 ${JSON.stringify(bad)} 不該刪除任何東西`);
  }
  assert.strictEqual(env.read('reminders.json').length, 1);
});

// ── 2. AI 工具：模型現在有「取消提醒」可用 ───────────────────────

test('delete_reminder 工具存在（沒有它，模型只能誤用 set_reminder → 就是本次事故）', () => {
  const names = tools.defs.map((d) => d.function.name);
  assert.ok(names.includes('delete_reminder'), `工具清單缺少 delete_reminder：${names.join(', ')}`);
});

test('delete_reminder：帶關鍵字時只刪命中的提醒', async () => {
  env.seed('reminders.json', [daily('a', 'ăn kim chi', '08:00'), daily('b', '倒垃圾', '19:00')]);
  const out = await tools.run(U, 'delete_reminder', JSON.stringify({ keyword: 'kim chi' }));
  assert.match(out, /DELETED 1/);
  const left = env.read('reminders.json');
  assert.strictEqual(left.length, 1);
  assert.strictEqual(left[0].message, '倒垃圾');
});

test('delete_reminder：all=true 才清空全部', async () => {
  env.seed('reminders.json', [daily('a', 'x', '08:00'), daily('b', 'y', '09:00')]);
  const out = await tools.run(U, 'delete_reminder', JSON.stringify({ all: true }));
  assert.match(out, /DELETED_ALL/);
  assert.strictEqual(env.read('reminders.json').length, 0);
});

test('delete_reminder：沒給關鍵字也沒給 all 時，絕不可清空整份清單', async () => {
  env.seed('reminders.json', [daily('a', 'x', '08:00')]);
  const out = await tools.run(U, 'delete_reminder', JSON.stringify({}));
  assert.match(out, /NEED_KEYWORD/);
  assert.strictEqual(env.read('reminders.json').length, 1, '參數不明確時必須什麼都不刪');
});

test('delete_reminder：關鍵字沒命中時回 NOT_FOUND 且不刪東西', async () => {
  env.seed('reminders.json', [daily('a', '吃藥', '08:00')]);
  const out = await tools.run(U, 'delete_reminder', JSON.stringify({ keyword: '不存在' }));
  assert.match(out, /NOT_FOUND/);
  assert.strictEqual(env.read('reminders.json').length, 1);
});

// ── 3. 工具內部指示不得外洩給使用者 ─────────────────────────────

test('set_reminder 失敗訊息不含「叫模型去問使用者」的第三人稱指示（外洩過的原句）', async () => {
  const out = await tools.run(U, 'set_reminder', JSON.stringify({ type: 'daily', message: 'x' })); // 缺時間
  assert.doesNotMatch(out, /ask the user/i, '這句被模型逐字翻譯後丟給使用者過，不可再出現');
  assert.match(out, /FAILED/, '應改用機器狀態碼，逼模型自己用使用者的語言組句');
});

test('SYSTEM_PROMPT 明確禁止把工具回傳文字照翻給使用者', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/ai.js'), 'utf8');
  assert.match(src, /內部結果/, 'SYSTEM_PROMPT 應說明工具回傳是內部資訊');
  assert.match(src, /不要逐字翻譯|不要照抄|絕對不要逐字/, 'SYSTEM_PROMPT 應明文禁止逐字翻譯工具輸出');
});

// ── 4. 重複提醒防護（事故中同一時段累積多則）────────────────────

test('addParsed：完全相同的提醒不會被新增第二次', () => {
  const p = { type: 'daily', dailyTime: '08:00', message: 'ăn kim chi' };
  const first = reminder.addParsed(U, p);
  assert.strictEqual(first.ok, true);
  assert.ok(!first.duplicate);

  const second = reminder.addParsed(U, p);
  assert.strictEqual(second.ok, true, '仍回報成功，讓使用者知道提醒是存在的');
  assert.strictEqual(second.duplicate, true);
  assert.strictEqual(env.read('reminders.json').length, 1, '不可產生第二筆重複提醒');
});

test('addParsed：只有大小寫／聲調差異也算重複', () => {
  reminder.addParsed(U, { type: 'daily', dailyTime: '08:00', message: 'Ăn kim chi' });
  reminder.addParsed(U, { type: 'daily', dailyTime: '08:00', message: 'an kim chi' });
  assert.strictEqual(env.read('reminders.json').length, 1);
});

test('addParsed：時間不同就不是重複（不可誤擋合理的第二個提醒）', () => {
  reminder.addParsed(U, { type: 'daily', dailyTime: '08:00', message: '吃藥' });
  reminder.addParsed(U, { type: 'daily', dailyTime: '20:00', message: '吃藥' });
  assert.strictEqual(env.read('reminders.json').length, 2, '早晚各一次吃藥是合理需求');
});

test('addParsed：不同人設一樣的提醒互不影響', () => {
  reminder.addParsed(U, { type: 'daily', dailyTime: '08:00', message: '吃藥' });
  reminder.addParsed('Uother', { type: 'daily', dailyTime: '08:00', message: '吃藥' });
  assert.strictEqual(env.read('reminders.json').length, 2);
});

test('addParsed：喝水提醒（tag）不參與重複比對', () => {
  reminder.addDailyPreset(U, ['09:00', '11:00'], '記得喝水 💧', 'water');
  const before = env.read('reminders.json').length;
  reminder.addParsed(U, { type: 'daily', dailyTime: '09:00', message: '記得喝水 💧' });
  assert.strictEqual(env.read('reminders.json').length, before + 1, 'tag 提醒不該擋住使用者自訂提醒');
});

// ── 5. 不經 AI 的越南語救生索（Groq 額度用盡時仍能自救）───────────

test('handler：xóa nhắc nhở <事項> 直接取消，且回覆是越南語', async () => {
  env.seedLang(U, 'vi');
  env.seed('reminders.json', [daily('a', 'ăn kim chi', '08:00'), daily('b', '倒垃圾', '19:00')]);
  const out = await handler.handleText(U, 'xóa nhắc nhở ăn kim chi');
  assert.ok(typeof out === 'string');
  assert.ok(out.includes('huỷ') || out.includes('Đã'), `回覆須為越南語，實得：${out}`);
  assert.doesNotMatch(out, /[一-鿿]/, '越南語使用者不該看到中文回覆');
  assert.strictEqual(env.read('reminders.json').length, 1);
});

test('handler：她原話的「kết thúc nhắc nhở …」也要能取消', async () => {
  env.seedLang(U, 'vi');
  env.seed('reminders.json', [daily('a', 'ăn kim chi', '08:00')]);
  const out = await handler.handleText(U, 'Kết thúc nhắc nhở ăn kim chi');
  assert.strictEqual(env.read('reminders.json').length, 0, '這正是事故當下失敗的那句話');
  assert.doesNotMatch(out, /[一-鿿]/);
});

test('handler：xóa tất cả nhắc nhở 會真的清空（不可只回訊息不刪）', async () => {
  env.seedLang(U, 'vi');
  env.seed('reminders.json', [daily('a', 'x', '08:00'), daily('b', 'y', '09:00')]);
  const out = await handler.handleText(U, 'xóa tất cả nhắc nhở');
  assert.strictEqual(env.read('reminders.json').length, 0, '回了「已刪除」就必須真的刪除');
  assert.doesNotMatch(out, /[一-鿿]/);
});

test('handler：越南語取消指令找不到事項時，不刪任何東西', async () => {
  env.seedLang(U, 'vi');
  env.seed('reminders.json', [daily('a', 'ăn kim chi', '08:00')]);
  const out = await handler.handleText(U, 'xóa nhắc nhở không tồn tại');
  assert.strictEqual(env.read('reminders.json').length, 1);
  assert.ok(out.includes('Không tìm thấy'), `應回越南語的找不到訊息，實得：${out}`);
});

test('handler：中文既有的提醒指令不受新路由影響（回歸）', async () => {
  env.seedLang(U, 'zh-TW');
  env.seed('reminders.json', [daily('a', '吃藥', '08:00')]);
  assert.strictEqual(await handler.handleText(U, '清除提醒'), '🗑 已清除你所有的提醒。');
  assert.strictEqual(env.read('reminders.json').length, 0);
});

test('lang：三種語言的取消提醒文案都完整、且非中文語言不含中文字', () => {
  for (const code of ['zh-TW', 'vi', 'en']) {
    const cleared = lang.reminderClearedAll(code);
    const deleted = lang.reminderDeleted(code, [{ when: '每天 08:00', message: 'x' }]);
    const noMatch = lang.reminderNoMatch(code, 'x');
    for (const [name, s] of [['cleared', cleared], ['deleted', deleted], ['noMatch', noMatch]]) {
      assert.ok(s && s.length > 0, `${code}/${name} 不可為空`);
      assert.doesNotMatch(s, /\{\w+\}/, `${code}/${name} 有未取代的佔位符：${s}`);
    }
    if (code !== 'zh-TW') {
      // 「每天 08:00」是提醒本身的敘述（既有中文格式），故只檢查固定文案部分
      assert.doesNotMatch(cleared, /[一-鿿]/, `${code} 的清除文案不該有中文`);
      assert.doesNotMatch(noMatch, /[一-鿿]/, `${code} 的找不到文案不該有中文`);
    }
  }
});

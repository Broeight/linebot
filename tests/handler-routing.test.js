// handler.js 指令路由回歸測試：專防「新增指令時把舊指令吃掉／被新指令吃掉」。
// 過去 6 輪撞過的實例：刪除提醒 N vs 刪除提醒、農曆生日 vs 農曆、越南語 mua(買) vs mùa(季節)。
//
// 測試方法（行為導向，不鎖字面）：用 h.spyOn 攔截 handler 會呼叫的服務模組方法，
// 斷言「打這個指令 → 呼叫到對的那個服務方法、且互斥的其他方法完全沒被呼叫」。
// 只有少數幾條（/help 選單、清除提醒回覆、開啟喝水提醒回覆）鎖精確字串。

const h = require('./helpers');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const handler = require('../src/handler');
const lang = require('../src/lang');
const reminder = require('../src/services/reminder');
const birthday = require('../src/services/birthday');
const shopping = require('../src/services/shopping');
const expense = require('../src/services/expense');
const traTrain = require('../src/services/traTrain');
const medicalCard = require('../src/services/medicalCard');
const rateAlert = require('../src/services/rateAlert');
const lunarSvc = require('../src/services/lunar');
const groupTranslate = require('../src/services/groupTranslate');

const U1 = 'U1';

let env;
let activeSpies;

beforeEach(() => {
  env = h.setup();
  env.seedLang(U1, 'zh-TW'); // 避免 lang.resolve 打 LINE API
  activeSpies = [];
});

afterEach(() => {
  // 所有 spy 都要還原，避免污染其他測試檔
  for (const s of activeSpies) s.restore();
  activeSpies = [];
  env.restore();
});

/** 建立一個 spy 並自動登記到 afterEach 還原清單。 */
function spy(mod, name, fn) {
  const s = h.spyOn(mod, name, fn);
  activeSpies.push(s);
  return s;
}

// ══════════════════════════════════════════════════════════════
// 提醒群：提醒清單／我的提醒／清除提醒／刪除提醒／刪除提醒 N／提醒我…
// ══════════════════════════════════════════════════════════════

test('「提醒清單」呼叫 reminder.list，不誤觸 clear/removeByIndex/add', async () => {
  const list = spy(reminder, 'list', () => 'LIST_OK');
  const clear = spy(reminder, 'clear', () => 'CLEAR_OK');
  const del = spy(reminder, 'removeByIndex', () => 'DEL_OK');
  const add = spy(reminder, 'add', () => 'ADD_OK');

  const reply = await handler.handleText(U1, '提醒清單');

  assert.strictEqual(reply, 'LIST_OK');
  assert.strictEqual(list.calls.length, 1);
  assert.strictEqual(clear.calls.length, 0);
  assert.strictEqual(del.calls.length, 0);
  assert.strictEqual(add.calls.length, 0);
});

test('「我的提醒」也走 reminder.list（同義詞不可被其他分支吃掉）', async () => {
  const list = spy(reminder, 'list', () => 'LIST_OK');
  const clear = spy(reminder, 'clear', () => 'CLEAR_OK');
  const del = spy(reminder, 'removeByIndex', () => 'DEL_OK');
  const add = spy(reminder, 'add', () => 'ADD_OK');

  const reply = await handler.handleText(U1, '我的提醒');

  assert.strictEqual(reply, 'LIST_OK');
  assert.strictEqual(list.calls.length, 1);
  assert.strictEqual(clear.calls.length, 0);
  assert.strictEqual(del.calls.length, 0);
  assert.strictEqual(add.calls.length, 0);
});

test('「清除提醒」精確全刪：走 reminder.clear（鎖精確回覆字串），不誤觸 list/removeByIndex/add', async () => {
  // clear 不 spy，讓真實實作跑（記憶體 store），藉此鎖住精確回覆字串。
  const list = spy(reminder, 'list', () => 'LIST_OK');
  const del = spy(reminder, 'removeByIndex', () => 'DEL_OK');
  const add = spy(reminder, 'add', () => 'ADD_OK');

  const reply = await handler.handleText(U1, '清除提醒');

  assert.strictEqual(reply, '🗑 已清除你所有的提醒。');
  assert.strictEqual(list.calls.length, 0);
  assert.strictEqual(del.calls.length, 0);
  assert.strictEqual(add.calls.length, 0);
});

test('裸字「刪除提醒」（無編號）＝全刪，等同「清除提醒」，不可誤入帶編號刪除分支', async () => {
  const list = spy(reminder, 'list', () => 'LIST_OK');
  const del = spy(reminder, 'removeByIndex', () => 'DEL_OK');
  const add = spy(reminder, 'add', () => 'ADD_OK');

  const reply = await handler.handleText(U1, '刪除提醒');

  assert.strictEqual(reply, '🗑 已清除你所有的提醒。');
  assert.strictEqual(list.calls.length, 0);
  assert.strictEqual(del.calls.length, 0, '裸字「刪除提醒」不可被帶編號刪除分支吃掉');
  assert.strictEqual(add.calls.length, 0);
});

test('「刪除提醒 2」（帶空白＋編號）走 removeByIndex(userId, 2)，不誤觸全刪', async () => {
  const del = spy(reminder, 'removeByIndex', () => 'DEL_OK');
  const clear = spy(reminder, 'clear', () => 'CLEAR_OK');
  const add = spy(reminder, 'add', () => 'ADD_OK');

  const reply = await handler.handleText(U1, '刪除提醒 2');

  assert.strictEqual(reply, 'DEL_OK');
  assert.strictEqual(del.calls.length, 1);
  assert.deepStrictEqual(del.calls[0], [U1, 2]);
  assert.strictEqual(clear.calls.length, 0);
  assert.strictEqual(add.calls.length, 0);
});

test('「刪除提醒2」（長輩常見的無空白寫法）也要正確解析成編號 2', async () => {
  const del = spy(reminder, 'removeByIndex', () => 'DEL_OK');
  const clear = spy(reminder, 'clear', () => 'CLEAR_OK');
  const add = spy(reminder, 'add', () => 'ADD_OK');

  const reply = await handler.handleText(U1, '刪除提醒2');

  assert.strictEqual(reply, 'DEL_OK');
  assert.strictEqual(del.calls.length, 1);
  assert.deepStrictEqual(del.calls[0], [U1, 2]);
  assert.strictEqual(clear.calls.length, 0);
  assert.strictEqual(add.calls.length, 0);
});

test('「提醒我 明天9點 回診」走新增分支 reminder.add，不誤觸 list/clear/removeByIndex', async () => {
  const add = spy(reminder, 'add', () => 'ADD_OK');
  const list = spy(reminder, 'list', () => 'LIST_OK');
  const clear = spy(reminder, 'clear', () => 'CLEAR_OK');
  const del = spy(reminder, 'removeByIndex', () => 'DEL_OK');

  const reply = await handler.handleText(U1, '提醒我 明天9點 回診');

  assert.strictEqual(reply, 'ADD_OK');
  assert.strictEqual(add.calls.length, 1);
  assert.deepStrictEqual(add.calls[0], [U1, '提醒我 明天9點 回診']);
  assert.strictEqual(list.calls.length, 0);
  assert.strictEqual(clear.calls.length, 0);
  assert.strictEqual(del.calls.length, 0);
});

// ══════════════════════════════════════════════════════════════
// 生日群：生日清單／生日 X 日期／農曆生日 X 日期／刪除生日 X／農曆（今日農曆查詢，不可被農曆生日吃掉）
// ══════════════════════════════════════════════════════════════

test('「生日清單」走 birthday.list，不誤觸 add/addLunar/remove', async () => {
  const list = spy(birthday, 'list', () => 'BD_LIST_OK');
  const add = spy(birthday, 'add', () => 'BD_ADD_OK');
  const addLunar = spy(birthday, 'addLunar', () => 'BD_LUNAR_OK');
  const remove = spy(birthday, 'remove', () => 'BD_DEL_OK');

  const reply = await handler.handleText(U1, '生日清單');

  assert.strictEqual(reply, 'BD_LIST_OK');
  assert.strictEqual(list.calls.length, 1);
  assert.strictEqual(add.calls.length, 0);
  assert.strictEqual(addLunar.calls.length, 0);
  assert.strictEqual(remove.calls.length, 0);
});

test('「生日 媽媽 8/15」（國曆新增）走 birthday.add，不誤觸 addLunar', async () => {
  const add = spy(birthday, 'add', () => 'BD_ADD_OK');
  const addLunar = spy(birthday, 'addLunar', () => 'BD_LUNAR_OK');

  const reply = await handler.handleText(U1, '生日 媽媽 8/15');

  assert.strictEqual(reply, 'BD_ADD_OK');
  assert.strictEqual(add.calls.length, 1);
  assert.deepStrictEqual(add.calls[0], [U1, '媽媽 8/15']);
  assert.strictEqual(addLunar.calls.length, 0, '「生日」不可被「農曆生日」分支吃掉');
});

test('「農曆生日 阿嬤 8/15」（農曆新增）走 birthday.addLunar，不誤觸 add', async () => {
  const add = spy(birthday, 'add', () => 'BD_ADD_OK');
  const addLunar = spy(birthday, 'addLunar', () => 'BD_LUNAR_OK');

  const reply = await handler.handleText(U1, '農曆生日 阿嬤 8/15');

  assert.strictEqual(reply, 'BD_LUNAR_OK');
  assert.strictEqual(addLunar.calls.length, 1);
  assert.deepStrictEqual(addLunar.calls[0], [U1, '阿嬤 8/15']);
  assert.strictEqual(add.calls.length, 0, '「農曆生日」不可誤觸國曆新增分支');
});

test('「刪除生日 媽媽」走 birthday.remove(userId, "媽媽")', async () => {
  const remove = spy(birthday, 'remove', () => 'BD_DEL_OK');
  const add = spy(birthday, 'add', () => 'BD_ADD_OK');
  const addLunar = spy(birthday, 'addLunar', () => 'BD_LUNAR_OK');

  const reply = await handler.handleText(U1, '刪除生日 媽媽');

  assert.strictEqual(reply, 'BD_DEL_OK');
  assert.strictEqual(remove.calls.length, 1);
  assert.deepStrictEqual(remove.calls[0], [U1, '媽媽']);
  assert.strictEqual(add.calls.length, 0);
  assert.strictEqual(addLunar.calls.length, 0);
});

test('裸字「農曆」＝今日農曆查詢，精確比對，絕不可被「農曆生日」分支吃掉', async () => {
  const add = spy(birthday, 'add', () => 'BD_ADD_OK');
  const addLunar = spy(birthday, 'addLunar', () => 'BD_LUNAR_OK');
  const remove = spy(birthday, 'remove', () => 'BD_DEL_OK');

  const reply = await handler.handleText(U1, '農曆');

  // 走的是 handler 內建的今日農曆查詢（呼叫 lunarSvc 直接組字），不是 birthday 模組任何一支
  assert.strictEqual(add.calls.length, 0);
  assert.strictEqual(addLunar.calls.length, 0, '裸字「農曆」不可被「農曆生日」分支吃掉');
  assert.strictEqual(remove.calls.length, 0);
  assert.strictEqual(typeof reply, 'string');
  // DEFAULT_NOW 日期為 2026-07-24 → 回覆須含國曆日期（zh-TW 格式 2026/07/24）
  assert.match(reply, /2026\/07\/24/);
});

// ══════════════════════════════════════════════════════════════
// 購物群：買 X／購物清單／買到 X／清空購物清單
// ══════════════════════════════════════════════════════════════

test('「買 醬油」走 shopping.add，不誤觸 remove/clear/list', async () => {
  const add = spy(shopping, 'add', () => ({ ok: true, added: true, already: false, item: '醬油', total: 1 }));
  const remove = spy(shopping, 'remove', () => ({ ok: true, item: '醬油', total: 0 }));
  const clear = spy(shopping, 'clear', () => 0);
  const list = spy(shopping, 'list', () => []);

  await handler.handleText(U1, '買 醬油');

  assert.strictEqual(add.calls.length, 1);
  assert.strictEqual(add.calls[0][0], '醬油');
  assert.strictEqual(remove.calls.length, 0);
  assert.strictEqual(clear.calls.length, 0);
  assert.strictEqual(list.calls.length, 0);
});

test('「購物清單」走 shopping.list，不誤觸 add', async () => {
  const list = spy(shopping, 'list', () => []);
  const add = spy(shopping, 'add', () => ({ ok: true, added: true, already: false, item: 'x', total: 1 }));

  await handler.handleText(U1, '購物清單');

  assert.strictEqual(list.calls.length, 1);
  assert.strictEqual(add.calls.length, 0);
});

test('「買到 醬油」（完成刪除）走 shopping.remove，不誤觸 add（防「買」前綴吃掉「買到」）', async () => {
  const remove = spy(shopping, 'remove', () => ({ ok: true, item: '醬油', total: 0 }));
  const add = spy(shopping, 'add', () => ({ ok: true, added: true, already: false, item: '醬油', total: 1 }));

  await handler.handleText(U1, '買到 醬油');

  assert.strictEqual(remove.calls.length, 1);
  assert.strictEqual(remove.calls[0][0], '醬油');
  assert.strictEqual(add.calls.length, 0, '「買到」不可被「買」新增分支吃掉');
});

test('「清空購物清單」走 shopping.clear，不誤觸 remove/add', async () => {
  const clear = spy(shopping, 'clear', () => 3);
  const remove = spy(shopping, 'remove', () => ({ ok: true, item: 'x', total: 0 }));
  const add = spy(shopping, 'add', () => ({ ok: true, added: true, already: false, item: 'x', total: 1 }));

  await handler.handleText(U1, '清空購物清單');

  assert.strictEqual(clear.calls.length, 1);
  assert.strictEqual(remove.calls.length, 0);
  assert.strictEqual(add.calls.length, 0);
});

// ══════════════════════════════════════════════════════════════
// 越南語消歧義（最重要）：mua(買) vs mưa(下雨)／mùa(季節)
// ══════════════════════════════════════════════════════════════

test('越南語「mua trứng」（買雞蛋）要觸發購物清單 add，不落到 AI 對話', async () => {
  const add = spy(shopping, 'add', () => ({ ok: true, added: true, already: false, item: 'trứng', total: 1 }));

  await handler.handleText(U1, 'mua trứng');

  assert.strictEqual(add.calls.length, 1);
  assert.strictEqual(add.calls[0][0], 'trứng');
  assert.strictEqual(env.aiCalls.filter((c) => c[0] === 'chat').length, 0, '「mua」買菜指令不可落到 AI 對話');
});

test('越南語「Mưa to quá」（下大雨，聲調字 ư≠u）絕不可誤觸購物清單 add，要落到 AI 對話', async () => {
  const add = spy(shopping, 'add', () => ({ ok: true, added: true, already: false, item: 'x', total: 1 }));

  await handler.handleText(U1, 'Mưa to quá');

  assert.strictEqual(add.calls.length, 0, '「Mưa」(下雨) 不可被「mua」(買) 誤判為購物指令');
  assert.strictEqual(env.aiCalls.filter((c) => c[0] === 'chat').length, 1, '應落到 AI 對話 fallback');
});

test('越南語「Mùa đông」（冬季，聲調字 ù≠u）絕不可誤觸購物清單 add，要落到 AI 對話', async () => {
  const add = spy(shopping, 'add', () => ({ ok: true, added: true, already: false, item: 'x', total: 1 }));

  await handler.handleText(U1, 'Mùa đông');

  assert.strictEqual(add.calls.length, 0, '「Mùa」(季節) 不可被「mua」(買) 誤判為購物指令');
  assert.strictEqual(env.aiCalls.filter((c) => c[0] === 'chat').length, 1, '應落到 AI 對話 fallback');
});

// ══════════════════════════════════════════════════════════════
// 其他代表性指令各一條
// ══════════════════════════════════════════════════════════════

test('「記帳 午餐 120」走 expense.add(userId, "午餐 120")', async () => {
  const add = spy(expense, 'add', () => 'EXP_OK');
  const summary = spy(expense, 'summary', () => 'SUMMARY_OK');

  const reply = await handler.handleText(U1, '記帳 午餐 120');

  assert.strictEqual(reply, 'EXP_OK');
  assert.strictEqual(add.calls.length, 1);
  assert.deepStrictEqual(add.calls[0], [U1, '午餐 120']);
  assert.strictEqual(summary.calls.length, 0);
});

test('「天氣 台北」（weather 為解構匯入，無法 spy）：斷言回覆為天氣路由的 fallback（網路被封鎖）', async () => {
  const reply = await handler.handleText(U1, '天氣 台北');
  // 台北在內建城市表可直接解析地名（不打網路），氣象 API 呼叫因 fetch 被攔截而失敗 → 落 fallback 句
  assert.strictEqual(reply, '目前無法取得天氣資料，請稍後再試 🙏');
});

test('「台鐵 台北 台中」走 traTrain.lookup("台北 台中")', async () => {
  const lookup = spy(traTrain, 'lookup', () => 'TRA_OK');
  const nextTrain = spy(traTrain, 'nextTrain', () => 'NEXT_OK');

  const reply = await handler.handleText(U1, '台鐵 台北 台中');

  assert.strictEqual(reply, 'TRA_OK');
  assert.strictEqual(lookup.calls.length, 1);
  assert.strictEqual(lookup.calls[0][0], '台北 台中');
  assert.strictEqual(nextTrain.calls.length, 0);
});

test('「/help」鎖精確字串：與 lang.helpMenu(zh-TW) 完全一致', async () => {
  const reply = await handler.handleText(U1, '/help');
  assert.strictEqual(reply, lang.helpMenu('zh-TW'));
});

test('「語言 越南語」呼叫 lang.setManual(userId, "vi")', async () => {
  const setManual = spy(lang, 'setManual', () => {});

  const reply = await handler.handleText(U1, '語言 越南語');

  assert.strictEqual(setManual.calls.length, 1);
  assert.deepStrictEqual(setManual.calls[0], [U1, 'vi']);
  assert.strictEqual(reply, lang.confirmText('vi'));
});

test('「就醫卡 頭痛」呼叫 medicalCard.makeCard("頭痛")', async () => {
  const makeCard = spy(medicalCard, 'makeCard', async () => 'CARD_OK');

  const reply = await handler.handleText(U1, '就醫卡 頭痛');

  assert.strictEqual(reply, 'CARD_OK');
  assert.strictEqual(makeCard.calls.length, 1);
  assert.strictEqual(makeCard.calls[0][0], '頭痛');
});

test('「匯率提醒 850」呼叫 rateAlert.set(userId, 850)', async () => {
  const set = spy(rateAlert, 'set', async () => ({ direction: 'up', current: 800 }));

  await handler.handleText(U1, '匯率提醒 850');

  assert.strictEqual(set.calls.length, 1);
  assert.deepStrictEqual(set.calls[0], [U1, 850]);
});

test('「開啟喝水提醒」鎖精確回覆字串，並呼叫 reminder.addDailyPreset', async () => {
  const preset = spy(reminder, 'addDailyPreset', () => {});

  const reply = await handler.handleText(U1, '開啟喝水提醒');

  assert.strictEqual(
    reply,
    '💧 已開啟喝水提醒，每天 09:00、11:00、14:00、16:00、19:00、21:00 提醒你喝水。\n關閉請輸入「關閉喝水提醒」。'
  );
  assert.strictEqual(preset.calls.length, 1);
  assert.strictEqual(preset.calls[0][0], U1);
});

// ══════════════════════════════════════════════════════════════
// fallback：普通聊天不可被任何指令誤吃，須落到 AI 對話
// ══════════════════════════════════════════════════════════════

test('普通聊天「今天天氣真好啊你覺得呢」落到 ai.chat，不被任何指令分支誤吃', async () => {
  const shoppingAdd = spy(shopping, 'add', () => ({ ok: true, added: true, already: false, item: 'x', total: 1 }));
  const reminderAdd = spy(reminder, 'add', () => 'ADD_OK');
  const birthdayAdd = spy(birthday, 'add', () => 'BD_ADD_OK');
  const expenseAdd = spy(expense, 'add', () => 'EXP_OK');

  await handler.handleText(U1, '今天天氣真好啊你覺得呢');

  assert.strictEqual(env.aiCalls.filter((c) => c[0] === 'chat').length, 1, '應落到 ai.chat fallback');
  assert.strictEqual(shoppingAdd.calls.length, 0);
  assert.strictEqual(reminderAdd.calls.length, 0);
  assert.strictEqual(birthdayAdd.calls.length, 0);
  assert.strictEqual(expenseAdd.calls.length, 0);
});

// ══════════════════════════════════════════════════════════════
// 群組不回歸：group 訊息不得進入 1-1 指令路由
// ══════════════════════════════════════════════════════════════

test('群組訊息「買 醬油」不得觸發購物清單（群組先關閉翻譯 → 應安靜返回 null）', async () => {
  const add = spy(shopping, 'add', () => ({ ok: true, added: true, already: false, item: '醬油', total: 1 }));
  groupTranslate.setEnabled('G1', false);

  const event = {
    type: 'message',
    source: { type: 'group', groupId: 'G1' },
    message: { type: 'text', id: 'm1', text: '買 醬油' },
  };
  const reply = await handler.replyForEvent(event);

  assert.strictEqual(reply, null, '翻譯關閉時群組訊息應安靜返回 null');
  assert.strictEqual(add.calls.length, 0, '群組訊息絕不可進入 1-1 指令路由觸發購物清單');
});

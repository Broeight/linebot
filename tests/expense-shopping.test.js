// 回歸測試：src/services/expense.js（家庭記帳，per-user）＋ src/services/shopping.js（全家共用購物清單）。
// 防的回歸：
// - 記帳金額累計算錯、撤銷後總額沒還原、removeById 誤刪別人的帳、per-user 資料互相污染。
// - 購物清單去重鍵（去空白＋去聲調＋小寫）壞掉、儲存值被誤存成去聲調版本、remove/clear 邊界壞掉、
//   全家共用清單被誤植入 per-user 過濾。

const h = require('./helpers');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const expense = require('../src/services/expense');
const shopping = require('../src/services/shopping');

let env;
beforeEach(() => { env = h.setup(); });
afterEach(() => { env.restore(); });

// ── expense.js ──────────────────────────────────────────────────────────

test('expense.add：格式不對（沒有數字）回引導句，不寫入任何資料', () => {
  const msg = expense.add('u1', '晚餐沒寫金額');
  assert.match(msg, /格式/);
  assert.deepStrictEqual(env.read('expense.json'), []);
});

test('expense.add：成功記一筆，回覆含品項/金額/本月累計，且寫入 store', () => {
  const msg = expense.add('u1', '午餐 120');
  assert.match(msg, /午餐/);
  assert.match(msg, /120/);
  assert.match(msg, /本月累計：120 元/);
  const rows = env.read('expense.json');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].item, '午餐');
  assert.strictEqual(rows[0].amount, 120);
});

test('expense.addItem：同一人連續兩筆，回傳的本月累計正確加總', () => {
  const t1 = expense.addItem('u1', '咖啡', 50);
  assert.strictEqual(t1, 50);
  const t2 = expense.addItem('u1', '晚餐', 200);
  assert.strictEqual(t2, 250);
});

test('expense.addItem：per-user 隔離——A 的花費不會算進 B 的本月累計', () => {
  const totalA = expense.addItem('userA', '咖啡', 50);
  const totalB = expense.addItem('userB', '茶', 30);
  assert.strictEqual(totalA, 50);
  assert.strictEqual(totalB, 30, 'B 的累計不應包含 A 的 50');
});

test('expense.addWithId：回傳 id 與本月累計，且每筆 id 不重複', () => {
  const r1 = expense.addWithId('u1', '全聯', 300);
  const r2 = expense.addWithId('u1', '全家', 100);
  assert.ok(r1.id);
  assert.ok(r2.id);
  assert.notStrictEqual(r1.id, r2.id);
  assert.strictEqual(r2.total, 400);
});

test('expense.removeById：只刪該筆，撤銷後本月累計還原成刪除前狀態', () => {
  const r1 = expense.addWithId('u1', '全聯', 300);
  const r2 = expense.addWithId('u1', '全家', 100);
  assert.strictEqual(r2.total, 400);

  const removed = expense.removeById('u1', r2.id);
  assert.strictEqual(removed.item, '全家');
  assert.strictEqual(removed.amount, 100);
  assert.strictEqual(removed.total, 300, '撤銷後本月累計應還原成只剩第一筆的金額');

  const rows = env.read('expense.json');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].id, r1.id, '不該動到另一筆');
});

test('expense.removeById：找不到該 id（含跨人）回 null，資料不變', () => {
  const r1 = expense.addWithId('userA', '全聯', 300);
  // userB 想刪 userA 的帳：找不到（userId 不符），必須回 null 且不能真的刪掉
  const result = expense.removeById('userB', r1.id);
  assert.strictEqual(result, null);
  const rows = env.read('expense.json');
  assert.strictEqual(rows.length, 1, 'userA 的那筆帳不該被跨人刪除');
  assert.strictEqual(rows[0].id, r1.id);
});

test('expense.removeLast：10 分鐘內可撤銷最新一筆，回傳撤銷前的品項/金額，累計正確還原', () => {
  expense.addItem('u1', '早餐', 60);
  const r = expense.removeLast('u1');
  assert.strictEqual(r.item, '早餐');
  assert.strictEqual(r.amount, 60);
  assert.strictEqual(r.total, 0);
  assert.deepStrictEqual(env.read('expense.json'), []);
});

test('expense.removeLast：只撤銷「該使用者」自己的最新一筆，不影響別人最新一筆', () => {
  expense.addItem('userA', '早餐', 60);
  expense.addItem('userB', '午餐', 90); // B 在 A 之後記帳，但撤銷 A 不該動到 B
  const r = expense.removeLast('userA');
  assert.strictEqual(r.item, '早餐');
  const rows = env.read('expense.json');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].item, '午餐', 'B 的帳不該被 A 的撤銷影響');
});

test('expense.removeLast：超過 10 分鐘保護期回 null，且不刪除該筆資料', () => {
  const old = Date.now() - 11 * 60 * 1000;
  env.seed('expense.json', [
    { userId: 'u1', item: '很久以前', amount: 999, ym: '2026-07', date: '2026-07-24', at: old },
  ]);
  const r = expense.removeLast('u1');
  assert.strictEqual(r, null);
  assert.strictEqual(env.read('expense.json').length, 1, '過期不可刪除該筆資料');
});

test('expense.removeLast：該使用者沒有任何記帳時回 null', () => {
  assert.strictEqual(expense.removeLast('沒記過帳的人'), null);
});

test('expense.summary：彙總本月總額、筆數，且只列最近 8 筆明細；per-user 隔離', () => {
  for (let i = 1; i <= 10; i++) expense.addItem('userA', `項目${i}`, 10);
  expense.addItem('userB', '別人的花費', 99999);

  const text = expense.summary('userA');
  assert.match(text, /共 10 筆/);
  assert.match(text, /花費：100 元/);
  assert.doesNotMatch(text, /99999/, 'userA 的摘要不該出現 userB 的資料');
  assert.doesNotMatch(text, /項目1\s/, '應只列最近 8 筆（項目3~項目10），項目1 不該出現');
  assert.match(text, /項目10/);
});

test('expense.summary：本月尚無記帳時回引導句', () => {
  const text = expense.summary('新用戶');
  assert.match(text, /還沒有記帳/);
});

// ── shopping.js ─────────────────────────────────────────────────────────

test('shopping.add：新增品項成功，回 added:true／already:false，且寫入 store', () => {
  const r = shopping.add('醬油', 'userA');
  assert.deepStrictEqual(r, { ok: true, added: true, already: false, item: '醬油', total: 1 });
  const rows = env.read('shopping.json');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].item, '醬油');
  assert.strictEqual(rows[0].addedBy, 'userA');
});

test('shopping.add：重複加入（去頭尾空白後完全相同）不新增第二筆，回 already:true', () => {
  shopping.add('醬油', 'userA');
  const r = shopping.add(' 醬油 ', 'userB');
  assert.strictEqual(r.already, true);
  assert.strictEqual(r.added, false);
  assert.strictEqual(r.total, 1, '不該真的新增第二筆');
  assert.strictEqual(env.read('shopping.json').length, 1);
});

test('shopping.add：去重鍵是「去空白＋去聲調＋小寫」——nước mắm 與 nuoc mam 視為同一項', () => {
  const first = shopping.add('nước mắm', 'userA');
  assert.strictEqual(first.added, true);

  const dup = shopping.add('nuoc mam', 'userB');
  assert.strictEqual(dup.already, true, 'nuoc mam 應被判定為與 nước mắm 相同品項（去聲調後相等）');
  assert.strictEqual(dup.added, false);
  assert.strictEqual(env.read('shopping.json').length, 1, '不該新增第二筆');
});

test('shopping.add：儲存值保留原文聲調（存的是 nước mắm，不是被正規化成 nuoc mam）', () => {
  shopping.add('nước mắm', 'userA');
  shopping.add('nuoc mam', 'userB'); // 重複加入，不該覆蓋原本的拼寫

  const rows = env.read('shopping.json');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].item, 'nước mắm', '儲存值必須是原文帶聲調的版本，不可被去聲調覆蓋');
});

test('shopping.remove：完全相符才刪（key 相符含去聲調/大小寫），刪除後回傳原文拼寫的品項', () => {
  shopping.add('nước mắm', 'userA');
  shopping.add('鹽', 'userA');

  const r = shopping.remove('  Nuoc Mam  ');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.item, 'nước mắm', '回傳的應是清單上儲存的原文拼寫');
  assert.strictEqual(r.total, 1);

  const rows = env.read('shopping.json');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].item, '鹽');
});

test('shopping.remove：找不到品項時回 ok:false，清單完全不變', () => {
  shopping.add('醬油', 'userA');
  const before = env.read('shopping.json');

  const r = shopping.remove('不存在的東西');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.item, '不存在的東西');
  assert.strictEqual(r.total, 1);
  assert.deepStrictEqual(env.read('shopping.json'), before, '找不到就不該動到清單');
});

test('shopping.clear：回傳清空前的項數，清空後清單為空', () => {
  shopping.add('醬油', 'userA');
  shopping.add('鹽', 'userA');
  shopping.add('糖', 'userA');

  const n = shopping.clear();
  assert.strictEqual(n, 3);
  assert.deepStrictEqual(env.read('shopping.json'), []);
});

test('shopping.clear：清單本來就是空的時候回 0，且不寫檔（不呼叫 store.save）', () => {
  const store = require('../src/store');
  const spy = h.spyOn(store, 'save');
  try {
    const n = shopping.clear();
    assert.strictEqual(n, 0);
    assert.strictEqual(spy.calls.length, 0, '空清單不該呼叫 store.save');
  } finally {
    spy.restore();
  }
});

test('shopping：全家共用一份、非 per-user——A 加入的品項 B 看得到，也刪得掉', () => {
  shopping.add('醬油', 'userA');

  // B 用 list() 看得到 A 加的品項（購物清單沒有依 userId 過濾）
  const list = shopping.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].item, '醬油');
  assert.strictEqual(list[0].addedBy, 'userA');

  // B 可以刪掉 A 加的品項（remove 不帶 userId 參數，代表全家共用一份清單）
  const r = shopping.remove('醬油');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(shopping.list(), []);
});

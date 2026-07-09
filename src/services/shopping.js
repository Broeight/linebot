// 家庭共用購物清單：全域單一份清單（不依 userId 過濾）。
// 用法（由 handler.js 路由）：
//   買 醬油 / mua nước mắm       → add
//   購物清單 / danh sách mua sắm → list
//   買到 醬油 / đã mua nước mắm  → remove
//   清空購物清單 / xóa danh sách mua sắm → clear
const store = require('../store');
const { toAscii } = require('./traTrain');

const FILE = 'shopping.json';

// 比對鍵：去頭尾空白 → toAscii（小寫＋去聲調）。只用於內部相等判斷，不改寫儲存值。
function keyOf(name) {
  return toAscii(String(name).trim());
}

// 回傳目前完整清單（陣列，每筆 { item, addedBy, addedAt }）。
function list() {
  return store.load(FILE);
}

// 加入品項（已存在則不重複新增）。回 { ok:true, added, already, item, total }。
function add(item, addedBy) {
  const name = String(item).trim();
  const list = store.load(FILE);
  const key = keyOf(name);
  const existing = list.find((e) => keyOf(e.item) === key);
  if (existing) {
    return { ok: true, added: false, already: true, item: existing.item, total: list.length };
  }
  list.push({ item: name, addedBy: addedBy || null, addedAt: Date.now() });
  store.save(FILE, list);
  return { ok: true, added: true, already: false, item: name, total: list.length };
}

// 完全相符刪除一筆。回 { ok, item, total }；找不到時 item 為使用者輸入的原文（trim 後）。
function remove(item) {
  const key = keyOf(item);
  const list = store.load(FILE);
  const idx = list.findIndex((e) => keyOf(e.item) === key);
  if (idx === -1) {
    return { ok: false, item: String(item).trim(), total: list.length };
  }
  const [removed] = list.splice(idx, 1);
  store.save(FILE, list);
  return { ok: true, item: removed.item, total: list.length };
}

// 清空整份清單，回傳清空前的項數；空清單時不寫檔。
function clear() {
  const list = store.load(FILE);
  const n = list.length;
  if (n > 0) store.save(FILE, []);
  return n;
}

module.exports = { list, add, remove, clear };

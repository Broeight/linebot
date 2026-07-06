// 家庭記帳：記一筆、查本月總額與近期明細。
// 用法：
//   記帳 午餐 120
//   記帳查詢 / 本月花費
const store = require('../store');
const FILE = 'expense.json';

function add(userId, body) {
  const text = body.trim();
  const amountMatch = text.match(/\d+(?:\.\d+)?/);
  if (!amountMatch) return '格式：記帳 項目 金額，例如「記帳 午餐 120」';
  const amount = Number(amountMatch[0]);
  const item = text.replace(amountMatch[0], '').replace(/元|塊/g, '').trim() || '其他';

  const t = store.taipei();
  const list = store.load(FILE);
  list.push({ userId, item, amount, ym: t.ym, date: t.date, at: Date.now() });
  store.save(FILE, list);

  const monthTotal = list
    .filter((e) => e.userId === userId && e.ym === t.ym)
    .reduce((s, e) => s + e.amount, 0);
  return `💰 已記帳：${item} ${amount} 元\n本月累計：${monthTotal} 元`;
}

// 給 AI 工具用：以結構化資料直接記一筆，回傳本月累計金額。
function addItem(userId, item, amount) {
  const t = store.taipei();
  const list = store.load(FILE);
  list.push({ userId, item: item || '其他', amount: Number(amount) || 0, ym: t.ym, date: t.date, at: Date.now() });
  store.save(FILE, list);
  return list
    .filter((e) => e.userId === userId && e.ym === t.ym)
    .reduce((s, e) => s + e.amount, 0);
}

// 拍照記帳確認用：以結構化資料記一筆並附 id（供之後撤銷），回 { id, total }。
function addWithId(userId, item, amount) {
  const t = store.taipei();
  const list = store.load(FILE);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  list.push({ id, userId, item: item || '其他', amount: Number(amount) || 0, ym: t.ym, date: t.date, at: Date.now() });
  store.save(FILE, list);
  const total = list
    .filter((e) => e.userId === userId && e.ym === t.ym)
    .reduce((s, e) => s + e.amount, 0);
  return { id, total };
}

// 依 id 移除一筆記帳（找不到回 null），回 { item, amount, total }（total 為移除後的本月累計）。
function removeById(userId, id) {
  const list = store.load(FILE);
  const idx = list.findIndex((e) => e.userId === userId && e.id === id);
  if (idx === -1) return null;
  const [removed] = list.splice(idx, 1);
  store.save(FILE, list);
  const t = store.taipei();
  const total = list
    .filter((e) => e.userId === userId && e.ym === t.ym)
    .reduce((s, e) => s + e.amount, 0);
  return { item: removed.item, amount: removed.amount, total };
}

// 撤銷該使用者「最新一筆」記帳，僅限 maxAgeMs 內（預設 10 分鐘），否則回 null。
function removeLast(userId, maxAgeMs = 10 * 60 * 1000) {
  const list = store.load(FILE);
  let lastIdx = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].userId === userId) { lastIdx = i; break; }
  }
  if (lastIdx === -1) return null;
  const row = list[lastIdx];
  const at = row.at || 0;
  if (Date.now() - at > maxAgeMs) return null;
  list.splice(lastIdx, 1);
  store.save(FILE, list);
  const t = store.taipei();
  const total = list
    .filter((e) => e.userId === userId && e.ym === t.ym)
    .reduce((s, e) => s + e.amount, 0);
  return { item: row.item, amount: row.amount, total };
}

function summary(userId) {
  const t = store.taipei();
  const items = store.load(FILE).filter((e) => e.userId === userId && e.ym === t.ym);
  if (items.length === 0) return `本月（${t.ym}）還沒有記帳。輸入「記帳 午餐 120」開始。`;
  const total = items.reduce((s, e) => s + e.amount, 0);
  const recent = items.slice(-8).map((e) => `${e.date.slice(5)}　${e.item}　${e.amount} 元`);
  return (
    `💰 本月（${t.ym}）花費：${total} 元\n共 ${items.length} 筆\n\n最近：\n` +
    recent.join('\n')
  );
}

module.exports = { add, addItem, summary, addWithId, removeById, removeLast };

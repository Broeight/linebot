// 家人生日：記錄、倒數、當天提醒（生日提醒由 morning.js 在早安推播時一起送）。
// 用法：
//   生日 媽媽 8/15      新增
//   生日清單            查看（含倒數）
//   刪除生日 媽媽       刪除
const store = require('../store');
const FILE = 'birthdays.json';

// 把各種寫法（8/15、08-15、0815、8月15日）解析成 "MM-DD"
function parseMD(s) {
  let m = s.match(/(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/) || s.match(/^(\d{2})(\d{2})$/);
  if (!m) return null;
  const mm = String(+m[1]).padStart(2, '0');
  const dd = String(+m[2]).padStart(2, '0');
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return null;
  return `${mm}-${dd}`;
}

function daysUntil(md) {
  const t = store.taipei();
  const [ty, tm, td] = t.date.split('-').map(Number);
  const [bm, bd] = md.split('-').map(Number);
  const today = Date.UTC(ty, tm - 1, td);
  let target = Date.UTC(ty, bm - 1, bd);
  if (target < today) target = Date.UTC(ty + 1, bm - 1, bd);
  return Math.round((target - today) / 86400000);
}

function add(userId, body) {
  const parts = body.trim().split(/\s+/);
  if (parts.length < 2) return '格式：生日 名字 日期，例如「生日 媽媽 8/15」';
  const dateStr = parts.pop();
  const name = parts.join(' ');
  const md = parseMD(dateStr);
  if (!md) return `看不懂日期「${dateStr}」，請用「8/15」這種格式。`;

  const list = store.load(FILE).filter((b) => !(b.userId === userId && b.name === name));
  list.push({ userId, name, md });
  store.save(FILE, list);
  const d = daysUntil(md);
  return `🎂 已記住 ${name} 的生日：${md}（還有 ${d} 天）`;
}

function list(userId) {
  const items = store
    .load(FILE)
    .filter((b) => b.userId === userId)
    .map((b) => ({ ...b, d: daysUntil(b.md) }))
    .sort((a, b) => a.d - b.d);
  if (items.length === 0) return '還沒有記錄任何生日。輸入「生日 媽媽 8/15」新增。';
  const lines = items.map(
    (b) => `${b.name}：${b.md}　${b.d === 0 ? '🎉 就是今天！' : `還有 ${b.d} 天`}`
  );
  return '🎂 生日清單：\n' + lines.join('\n');
}

function remove(userId, name) {
  const before = store.load(FILE);
  const after = before.filter((b) => !(b.userId === userId && b.name === name.trim()));
  store.save(FILE, after);
  return before.length === after.length ? `找不到「${name}」的生日。` : `🗑 已刪除 ${name} 的生日。`;
}

// 回傳某使用者「今天生日」的名字陣列（給早安推播用）
function todays(userId) {
  const md = store.taipei().md;
  return store.load(FILE).filter((b) => b.userId === userId && b.md === md).map((b) => b.name);
}

module.exports = { add, list, remove, todays };

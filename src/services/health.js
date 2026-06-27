// 健康記錄：血壓、血糖。記錄 + 查看近期與平均。
// 用法：
//   血壓 120 80      （收縮壓 舒張壓，可再加脈搏：血壓 120 80 72）
//   血糖 95
//   血壓記錄 / 血糖記錄
const store = require('../store');
const FILE = 'health.json';

function recordBP(userId, text) {
  const nums = (text.match(/\d+/g) || []).map(Number);
  if (nums.length < 2) return '格式：血壓 收縮壓 舒張壓，例如「血壓 120 80」';
  const [sys, dia, pulse] = nums;
  const list = store.load(FILE);
  list.push({ userId, type: 'bp', sys, dia, pulse: pulse || null, at: Date.now() });
  store.save(FILE, list);
  let note = '';
  if (sys >= 140 || dia >= 90) note = '\n⚠️ 偏高，多留意、必要時諮詢醫師。';
  else if (sys < 90 || dia < 60) note = '\n⚠️ 偏低，注意身體狀況。';
  return `📝 已記錄血壓 ${sys}/${dia}${pulse ? `（脈搏 ${pulse}）` : ''}${note}`;
}

function recordGlucose(userId, text) {
  const n = Number((text.match(/\d+/) || [])[0]);
  if (!n) return '格式：血糖 數值，例如「血糖 95」';
  const list = store.load(FILE);
  list.push({ userId, type: 'glucose', value: n, at: Date.now() });
  store.save(FILE, list);
  return `📝 已記錄血糖 ${n} mg/dL`;
}

function history(userId, type) {
  const items = store
    .load(FILE)
    .filter((r) => r.userId === userId && r.type === type)
    .slice(-7);
  if (items.length === 0) return type === 'bp' ? '還沒有血壓記錄。' : '還沒有血糖記錄。';

  const fmt = (ts) => new Date(ts).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (type === 'bp') {
    const lines = items.map((r) => `${fmt(r.at)}　${r.sys}/${r.dia}${r.pulse ? ` 脈搏${r.pulse}` : ''}`);
    const avgS = Math.round(items.reduce((s, r) => s + r.sys, 0) / items.length);
    const avgD = Math.round(items.reduce((s, r) => s + r.dia, 0) / items.length);
    return `🩺 近 ${items.length} 筆血壓：\n` + lines.join('\n') + `\n平均：${avgS}/${avgD}`;
  }
  const lines = items.map((r) => `${fmt(r.at)}　${r.value} mg/dL`);
  const avg = Math.round(items.reduce((s, r) => s + r.value, 0) / items.length);
  return `🩸 近 ${items.length} 筆血糖：\n` + lines.join('\n') + `\n平均：${avg} mg/dL`;
}

module.exports = { recordBP, recordGlucose, history };

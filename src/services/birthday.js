// 家人生日：記錄、倒數、當天提醒（生日提醒由 morning.js 在早安推播時一起送）。
// 用法：
//   生日 媽媽 8/15        新增（國曆）
//   農曆生日 阿嬤 8/15     新增（農曆，每年自動換算當年國曆日期提醒）
//   生日清單              查看（含倒數，國曆／農曆混排）
//   刪除生日 媽媽         刪除
const store = require('../store');
const lunar = require('./lunar');
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

// ── 農曆生日（新增）───────────────────────────────────────
// 農曆換算一律固定用 TZ_TW（台灣曆），資料不存 tz 欄位。

// lm 欄位格式守門：手改資料／雲端損毀的壞值（null、'ab-cd'、'13-40'）不得炸掉
// 整份清單或產生捏造日期；指令路徑（addLunar）寫入的一定合法，此為防禦層。
function isValidLm(lm) {
  if (typeof lm !== 'string' || !/^\d{2}-\d{2}$/.test(lm)) return false;
  const [m, d] = lm.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= 30;
}

// 'MM-DD' → '8/15'（去零補位，與指令輸入寫法呼應）
function mmdd(lm) {
  const [m, d] = lm.split('-').map(Number);
  return `${m}/${d}`;
}

// [dd, mm, yy] → 'YYYY-MM-DD'（零補位，固定寬度可直接字典序比大小）
function ymdStr(arr) {
  const [dd, mm, yy] = arr;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function diffDays(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// 今天是不是它所在農曆月的最後一天（明天農曆初一）
function isLastDayOfLunarMonth(todayYmd) {
  const [y, m, d] = todayYmd.split('-').map(Number);
  const jd = lunar.jdFromDate(d, m, y);
  const [d2, m2, y2] = lunar.jdToDate(jd + 1);
  return lunar.solar2lunar(d2, m2, y2, lunar.TZ_TW).day === 1;
}

// 農曆生日今天是否命中（todays() 用）
function isLunarHitToday(lm, todayYmd) {
  const L = lunar.lunarFromYmd(todayYmd, lunar.TZ_TW);
  if (L.leap !== 0) return false; // 閏月一律不提醒，只認正月
  const [bm, bd] = lm.split('-').map(Number);
  if (L.month === bm && L.day === bd) return true;
  // 三十缺日：存三十、今天廿九、且廿九是該農曆月最後一天 → 提前命中
  if (bd === 30 && L.month === bm && L.day === 29 && isLastDayOfLunarMonth(todayYmd)) return true;
  return false;
}

// 農曆生日換算成「今年（或明年，若已過）」對應的國曆日期＋倒數天數
function nextSolarForLunar(lm, todayYmd) {
  const L0 = lunar.lunarFromYmd(todayYmd, lunar.TZ_TW); // 取今天的「農曆年」
  const [bm, bd] = lm.split('-').map(Number);
  for (const year of [L0.year, L0.year + 1]) {
    let day = bd;
    if (bd === 30) {
      // clamp：小月無三十 → 廿九（roundtrip probe，對引擎溢位形式不敏感）
      const probe = lunar.lunar2solar(30, bm, year, 0, lunar.TZ_TW);
      if (probe[0] === 0 && probe[1] === 0 && probe[2] === 0) {
        day = 29; // 防禦（理論上 leap=0 不會觸發）
      } else {
        const back = lunar.lunarFromYmd(ymdStr(probe), lunar.TZ_TW);
        if (!(back.month === bm && back.day === 30 && back.leap === 0)) day = 29;
      }
    }
    const sol = lunar.lunar2solar(day, bm, year, 0, lunar.TZ_TW);
    if (sol[0] === 0 && sol[1] === 0 && sol[2] === 0) continue; // 防禦：換算異常，換下個年再試
    const ymd = ymdStr(sol);
    if (ymd >= todayYmd) return { ymd, days: diffDays(todayYmd, ymd) };
  }
  return null; // 兩年都失敗 → 顯示換算異常
}

function addLunar(userId, body) {
  const parts = body.trim().split(/\s+/);
  if (parts.length < 2) return '格式：農曆生日 名字 日期，例如「農曆生日 阿嬤 8/15」';
  const dateStr = parts.pop();
  const name = parts.join(' ');
  const lm = parseMD(dateStr);
  if (!lm) return `看不懂日期「${dateStr}」，請用「8/15」這種格式。`;
  const bd = Number(lm.split('-')[1]);
  if (bd > 30) return '農曆日期最多到 30（農曆沒有 31 號）。';

  const list = store.load(FILE).filter((b) => !(b.userId === userId && b.name === name));
  list.push({ userId, name, lm });
  store.save(FILE, list);

  const today = store.taipei().date;
  const nx = nextSolarForLunar(lm, today);
  if (nx == null) return `🎂 已記住 ${name} 的農曆生日：農曆${mmdd(lm)}（國曆換算暫時無法顯示）`;
  const solMd = nx.ymd.slice(5);
  if (nx.days === 0) return `🎂 已記住 ${name} 的農曆生日：農曆${mmdd(lm)}（今年＝國曆 ${solMd}）🎉 就是今天！`;
  return `🎂 已記住 ${name} 的農曆生日：農曆${mmdd(lm)}（今年＝國曆 ${solMd}，還有 ${nx.days} 天）`;
}

function list(userId) {
  const today = store.taipei().date;
  const items = store
    .load(FILE)
    .filter((b) => b.userId === userId)
    .map((b) => {
      if (b.md != null) return { ...b, kind: 'solar', d: daysUntil(b.md) };
      // 壞資料（lm 缺漏或格式不符）→ 沉底顯示異常，不拋例外、不中斷其他筆
      if (!isValidLm(b.lm)) return { ...b, kind: 'bad', d: Number.MAX_SAFE_INTEGER };
      // 農曆
      const nx = nextSolarForLunar(b.lm, today);
      if (nx == null) return { ...b, kind: 'lunar', d: Number.MAX_SAFE_INTEGER, solar: null };
      return { ...b, kind: 'lunar', d: nx.days, solar: nx.ymd.slice(5) };
    })
    .sort((a, b) => a.d - b.d);
  if (items.length === 0) return '還沒有記錄任何生日。輸入「生日 媽媽 8/15」新增。';
  const lines = items.map((b) => {
    if (b.kind === 'solar')
      return `${b.name}：${b.md}　${b.d === 0 ? '🎉 就是今天！' : `還有 ${b.d} 天`}`;
    if (b.kind === 'bad') return `${b.name}：（生日資料異常，請刪除後重新記錄）`;
    // 農曆
    if (b.solar == null) return `${b.name}：農曆${mmdd(b.lm)}（國曆換算暫時無法顯示）`;
    return `${b.name}：農曆${mmdd(b.lm)}（今年＝國曆 ${b.solar}）　${b.d === 0 ? '🎉 就是今天！' : `還有 ${b.d} 天`}`;
  });
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
  const t = store.taipei();
  const today = t.date;
  return store
    .load(FILE)
    .filter((b) => b.userId === userId)
    .filter((b) => {
      if (b.md != null) return b.md === t.md; // 國曆：逐字同現行判斷
      if (isValidLm(b.lm)) return isLunarHitToday(b.lm, today); // 農曆（壞資料不命中）
      return false;
    })
    .map((b) => b.name);
}

module.exports = { add, list, remove, todays, addLunar };

// 提醒服務：把自然語言（「明天9點回診」「每天8點吃藥」）解析成提醒，
// 存檔、排程，時間到用 LINE 主動推播給使用者。
//
// ⚠️ 提醒存在 data/reminders.json（檔案）。伺服器重啟不會遺失，
//    但若伺服器在該時刻沒開著，一次性提醒會在下次啟動時補送、每日提醒則會略過當天。

const ai = require('../ai');
const lang = require('../lang');
const { client } = require('../line');
const store = require('../store');

const FILE = 'reminders.json';
const load = () => store.load(FILE);
const save = (list) => store.save(FILE, list);

// 台北時間（無日光節約，固定 +08:00）的各部分
function taipeiParts() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  // 星期（0-6，0=Sunday）：取台北當天中午（=UTC 04:00 同一日曆日）避免伺服器本地時區影響
  const weekday = new Date(`${date}T12:00:00+08:00`).getUTCDay();
  const day = Number(p.day);
  // 當月天數：以 UTC 建構「下個月第 0 天」＝當月最後一天，避免伺服器本地時區
  const daysInMonth = new Date(Date.UTC(Number(p.year), Number(p.month), 0)).getUTCDate();
  return { date, hm: `${p.hour}:${p.minute}`, weekday, day, daysInMonth };
}

// 星期代碼小表（index = weekday 0-6，0=Sunday）
const WD_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const WD_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WD_NAMES = WD_EN.map((s) => s.toLowerCase());

// 把使用者/模型給的 weekday（整數 0-6、英文全名、三字縮寫、數字字串）轉成 0-6；無法辨識回 null
function toWeekdayNum(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6) return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (/^[0-6]$/.test(s)) return Number(s);
    const full = WD_NAMES.indexOf(s);
    if (full !== -1) return full;
    const abbr = WD_NAMES.findIndex((name) => name.slice(0, 3) === s);
    if (abbr !== -1) return abbr;
  }
  return null;
}

/** 某使用者可列入編號的提醒（不含 tag 提醒），依插入順序（檔案順序）。list()／removeByIndex() 共用。 */
function listable(userId, all) {
  return all.filter((r) => r.userId === userId && !r.tag);
}

/** 提醒的週期文字描述（中文，list()／removeByIndex() 共用）。 */
function describeWhen(r) {
  if (r.type === 'daily') return `每天 ${r.dailyTime}`;
  if (r.type === 'weekly') return `每週${WD_ZH[r.weekday]} ${r.time}`;
  if (r.type === 'monthly') return `每月${r.dayOfMonth}號 ${r.time}`;
  return new Date(r.fireAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

// 「YYYY-MM-DD HH:mm」(台北時間) → epoch 毫秒
function taipeiToEpoch(s) {
  const t = Date.parse(s.replace(' ', 'T') + ':00+08:00');
  return Number.isNaN(t) ? null : t;
}

// 正規化「HH:mm」字串；格式不符或時分超出範圍（如 25:00）回 null，
// 避免存下「確認成功但 tick 永遠比不中」的死提醒（無聲失敗）。
function normHM(s) {
  const m = (s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${String(+m[1]).padStart(2, '0')}:${m[2]}`;
}

async function parse(text) {
  const now = taipeiParts();
  const system =
    `你是提醒解析助理。現在台北時間是 ${now.date} ${now.hm}（星期以台北為準）。\n` +
    '使用者會用自然語言設定提醒，請只輸出 JSON：\n' +
    '- 一次性：{"ok":true,"type":"once","datetime":"YYYY-MM-DD HH:mm","message":"提醒內容"}\n' +
    '- 每天：{"ok":true,"type":"daily","dailyTime":"HH:mm","message":"提醒內容"}\n' +
    '- 每週：{"ok":true,"type":"weekly","weekday":"wednesday","time":"HH:mm","message":"提醒內容"}\n' +
    '- 每月：{"ok":true,"type":"monthly","dayOfMonth":5,"time":"HH:mm","message":"提醒內容"}\n' +
    '- 無法判斷：{"ok":false}\n' +
    '規則：出現「每週/每星期/每禮拜」用 weekly；「每月/每個月」用 monthly；「每天/每日」用 daily；否則 once。\n' +
    'weekday 用英文小寫（sunday/monday/tuesday/wednesday/thursday/friday/saturday）；\n' +
    '週日/星期日/禮拜日=sunday，週三/星期三/禮拜三=wednesday，其餘同理。\n' +
    'dayOfMonth 是 1-31 的數字。未指定時刻一律用 "09:00"。\n' +
    'once 的 datetime 要用現在時間推算成未來時間。message 只保留事項本身，不含時間詞。';
  return ai.askJSON(system, text);
}

/** 新增提醒，回傳給使用者的確認訊息。 */
async function add(userId, text) {
  const body = text.replace(/^提醒我?\s*/, '').trim();
  if (!body) {
    return '請告訴我時間和事項，例如：\n提醒我 明天9點 回診\n提醒 每天8點 吃藥';
  }

  const r = await parse(body);
  if (!r || !r.ok) {
    return '我看不懂時間 😅 換個說法試試：\n「提醒我 明天下午3點 回診」\n「提醒 每天早上8點 吃藥」';
  }

  const list = load();
  const id = Date.now().toString(36);

  if (r.type === 'daily' && /^\d{2}:\d{2}$/.test(r.dailyTime || '')) {
    list.push({ id, userId, type: 'daily', dailyTime: r.dailyTime, message: r.message, lastFired: '' });
    save(list);
    return `✅ 好的，每天 ${r.dailyTime} 我會提醒你：「${r.message}」`;
  }

  if (r.type === 'weekly') {
    const wd = toWeekdayNum(r.weekday);
    if (wd === null) return '我看不懂時間 😅 換個說法試試：\n「提醒我 明天下午3點 回診」\n「提醒 每天早上8點 吃藥」';
    const hm = normHM(r.time) || '09:00';
    list.push({ id, userId, type: 'weekly', weekday: wd, time: hm, message: r.message, lastFired: '' });
    save(list);
    return `✅ 好的，每週${WD_ZH[wd]} ${hm} 我會提醒你：「${r.message}」`;
  }
  if (r.type === 'monthly') {
    const d = Number(r.dayOfMonth);
    if (!Number.isInteger(d) || d < 1 || d > 31) return '我看不懂時間 😅 換個說法試試：\n「提醒我 明天下午3點 回診」\n「提醒 每天早上8點 吃藥」';
    const hm = normHM(r.time) || '09:00';
    list.push({ id, userId, type: 'monthly', dayOfMonth: d, time: hm, message: r.message, lastFired: '' });
    save(list);
    return `✅ 好的，每月${d}號 ${hm} 我會提醒你：「${r.message}」`;
  }

  const fireAt = taipeiToEpoch(r.datetime || '');
  if (!fireAt) {
    return '我看不懂時間 😅 請說清楚日期時間，例如「明天下午3點」。';
  }
  if (fireAt <= Date.now()) {
    return '那個時間已經過了 🙏 請設定一個未來的時間。';
  }
  list.push({ id, userId, type: 'once', fireAt, message: r.message });
  save(list);
  const when = (r.datetime || '').slice(5); // 去掉年份，顯示 MM-DD HH:mm
  return `✅ 好的，${when} 我會提醒你：「${r.message}」`;
}

/** 用已結構化的資料直接新增提醒（給 AI 工具用，省去再次 AI 解析）。回 {ok, when}。 */
function addParsed(userId, p) {
  const list = load();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  if (p.type === 'daily') {
    const hm = normHM(p.dailyTime);
    if (!hm) return { ok: false };
    list.push({ id, userId, type: 'daily', dailyTime: hm, message: p.message, lastFired: '' });
    save(list);
    return { ok: true, when: `every day ${hm}` };
  }
  if (p.type === 'weekly') {
    const wd = toWeekdayNum(p.weekday);
    if (wd === null) return { ok: false };
    const hm = normHM(p.time) || '09:00';
    list.push({ id, userId, type: 'weekly', weekday: wd, time: hm, message: p.message, lastFired: '' });
    save(list);
    return { ok: true, when: `every ${WD_EN[wd]} ${hm}` };
  }
  if (p.type === 'monthly') {
    const d = Number(p.dayOfMonth);
    if (!Number.isInteger(d) || d < 1 || d > 31) return { ok: false };
    const hm = normHM(p.time) || '09:00';
    list.push({ id, userId, type: 'monthly', dayOfMonth: d, time: hm, message: p.message, lastFired: '' });
    save(list);
    return { ok: true, when: `every month on day ${d}, ${hm}` };
  }
  const fireAt = taipeiToEpoch(p.datetime || '');
  if (!fireAt || fireAt <= Date.now()) return { ok: false }; // 無法解析或時間已過
  list.push({ id, userId, type: 'once', fireAt, message: p.message });
  save(list);
  return { ok: true, when: p.datetime };
}

/** 列出某使用者的提醒（有 tag 的預設提醒，例如喝水，不逐筆列出）。 */
function list(userId) {
  const all = load();
  const mine = all.filter((r) => r.userId === userId);
  const items = listable(userId, all);
  const lines = items.map((r, i) => `${i + 1}. ${describeWhen(r)}｜${r.message}`);

  let out = '';
  if (lines.length > 0) out += '⏰ 你的提醒：\n' + lines.join('\n');
  if (mine.some((r) => r.tag === 'water')) out += (out ? '\n' : '') + '💧 喝水提醒：開啟中';
  if (!out) return '你目前沒有任何提醒。';
  return out + '\n\n輸入「清除提醒」可全部刪除。';
}

/** 批次新增帶標籤的每日提醒（例如喝水），同標籤會先清掉舊的。 */
function addDailyPreset(userId, times, message, tag) {
  const all = load().filter((r) => !(r.userId === userId && r.tag === tag));
  for (const hm of times) {
    all.push({ id: Math.random().toString(36).slice(2, 9), userId, type: 'daily', dailyTime: hm, message, lastFired: '', tag });
  }
  save(all);
}

/** 移除某使用者某標籤的所有提醒。 */
function removeByTag(userId, tag) {
  const all = load();
  const kept = all.filter((r) => !(r.userId === userId && r.tag === tag));
  save(kept);
  return all.length !== kept.length;
}

/** 清除某使用者的所有提醒。 */
function clear(userId) {
  const kept = load().filter((r) => r.userId !== userId);
  save(kept);
  return '🗑 已清除你所有的提醒。';
}

/** 依「提醒清單」編號刪除單筆提醒（即時重算編號，不快取）。回傳給使用者的訊息。 */
function removeByIndex(userId, n) {
  const all = load();
  const mine = listable(userId, all);
  if (!Number.isInteger(n) || n < 1 || n > mine.length) {
    return n === null
      ? '請輸入「刪除提醒 編號」，例如「刪除提醒 2」。先輸入「提醒清單」可看編號。'
      : `找不到編號 ${n} 的提醒，請先輸入「提醒清單」確認編號。`;
  }
  const target = mine[n - 1];
  save(all.filter((r) => r.id !== target.id));
  return `🗑 已刪除提醒：${describeWhen(target)}｜${target.message}`;
}

async function push(userId, message) {
  let prefix = '⏰ 提醒：';
  try {
    prefix = lang.reminderPrefix(await lang.resolve(userId));
  } catch {
    /* 拿不到語言就用預設中文前綴 */
  }
  try {
    await client.pushMessage({ to: userId, messages: [{ type: 'text', text: prefix + message }] });
  } catch (e) {
    console.error('推播提醒失敗：', e.message);
  }
}

// 提醒排程：用「自我排程 setTimeout + 防重入旗標」取代 setInterval，
// 避免 callback 重疊造成重複推播（P0-2）；推播完成後「重新載入」再依 id 套用
// 變更，避免覆蓋這段期間 webhook 新增的提醒（P0-1 資料競態）。
let ticking = false;

async function tick(now = taipeiParts(), nowMs = Date.now()) {
  if (ticking) return; // 防重入
  ticking = true;
  try {
    const firedOnce = [];
    const firedRepeat = [];

    for (const r of load()) {
      if (r.type === 'once' && r.fireAt <= nowMs) {
        await push(r.userId, r.message);
        firedOnce.push(r.id);
      } else if (r.type === 'daily' && r.dailyTime === now.hm && r.lastFired !== now.date) {
        await push(r.userId, r.message);
        firedRepeat.push(r.id);
      } else if (r.type === 'weekly' && now.weekday === r.weekday && r.time === now.hm && r.lastFired !== now.date) {
        await push(r.userId, r.message);
        firedRepeat.push(r.id);
      } else if (r.type === 'monthly' && now.day === Math.min(r.dayOfMonth, now.daysInMonth) && r.time === now.hm && r.lastFired !== now.date) {
        await push(r.userId, r.message);
        firedRepeat.push(r.id);
      }
    }

    if (firedOnce.length || firedRepeat.length) {
      // 重新載入最新資料，只依 id 套用「已送」狀態，不整包覆寫
      const fresh = load()
        .filter((r) => !firedOnce.includes(r.id))
        .map((r) => (firedRepeat.includes(r.id) ? { ...r, lastFired: now.date } : r));
      save(fresh);
    }
  } catch (e) {
    console.error('提醒排程錯誤：', e.message);
  } finally {
    ticking = false;
    setTimeout(tick, 30 * 1000); // 前一輪完成後才排下一輪
  }
}

function start() {
  setTimeout(tick, 30 * 1000);
  console.log('⏰ 提醒排程已啟動');
}

module.exports = { add, addParsed, list, clear, start, addDailyPreset, removeByTag, removeByIndex, tick, taipeiParts };

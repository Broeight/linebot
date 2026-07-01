// 提醒服務：把自然語言（「明天9點回診」「每天8點吃藥」）解析成提醒，
// 存檔、排程，時間到用 LINE 主動推播給使用者。
//
// ⚠️ 提醒存在 data/reminders.json（檔案）。伺服器重啟不會遺失，
//    但若伺服器在該時刻沒開著，一次性提醒會在下次啟動時補送、每日提醒則會略過當天。

const fs = require('fs');
const path = require('path');
const ai = require('../ai');
const lang = require('../lang');
const { client } = require('../line');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'reminders.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return [];
  }
}
function save(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

// 台北時間（無日光節約，固定 +08:00）的各部分
function taipeiParts() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}

// 「YYYY-MM-DD HH:mm」(台北時間) → epoch 毫秒
function taipeiToEpoch(s) {
  const t = Date.parse(s.replace(' ', 'T') + ':00+08:00');
  return Number.isNaN(t) ? null : t;
}

async function parse(text) {
  const now = taipeiParts();
  const system =
    `你是提醒解析助理。現在台北時間是 ${now.date} ${now.hm}。\n` +
    '使用者會用自然語言設定提醒，請只輸出 JSON：\n' +
    '- 成功且為一次性：{"ok":true,"type":"once","datetime":"YYYY-MM-DD HH:mm","message":"提醒內容"}\n' +
    '- 成功且為每天重複：{"ok":true,"type":"daily","dailyTime":"HH:mm","message":"提醒內容"}\n' +
    '- 無法判斷時間：{"ok":false}\n' +
    '規則：出現「每天/每日」用 daily，否則 once；once 的 datetime 要用現在時間推算成未來時間；' +
    'message 只保留事項本身，不要包含時間詞。';
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
  const normHM = (s) => {
    const m = (s || '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? `${String(+m[1]).padStart(2, '0')}:${m[2]}` : null;
  };
  const list = load();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  if (p.type === 'daily') {
    const hm = normHM(p.dailyTime);
    if (!hm) return { ok: false };
    list.push({ id, userId, type: 'daily', dailyTime: hm, message: p.message, lastFired: '' });
    save(list);
    return { ok: true, when: `every day ${hm}` };
  }
  const fireAt = taipeiToEpoch(p.datetime || '');
  if (!fireAt || fireAt <= Date.now()) return { ok: false }; // 無法解析或時間已過
  list.push({ id, userId, type: 'once', fireAt, message: p.message });
  save(list);
  return { ok: true, when: p.datetime };
}

/** 列出某使用者的提醒（有 tag 的預設提醒，例如喝水，不逐筆列出）。 */
function list(userId) {
  const mine = load().filter((r) => r.userId === userId);
  const items = mine.filter((r) => !r.tag);
  const lines = items.map((r, i) => {
    const when = r.type === 'daily' ? `每天 ${r.dailyTime}` : new Date(r.fireAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    return `${i + 1}. ${when}｜${r.message}`;
  });

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

async function tick() {
  if (ticking) return; // 防重入
  ticking = true;
  try {
    const now = taipeiParts();
    const nowMs = Date.now();
    const firedOnce = [];
    const firedDaily = [];

    for (const r of load()) {
      if (r.type === 'once' && r.fireAt <= nowMs) {
        await push(r.userId, r.message);
        firedOnce.push(r.id);
      } else if (r.type === 'daily' && r.dailyTime === now.hm && r.lastFired !== now.date) {
        await push(r.userId, r.message);
        firedDaily.push(r.id);
      }
    }

    if (firedOnce.length || firedDaily.length) {
      // 重新載入最新資料，只依 id 套用「已送」狀態，不整包覆寫
      const fresh = load()
        .filter((r) => !firedOnce.includes(r.id))
        .map((r) => (firedDaily.includes(r.id) ? { ...r, lastFired: now.date } : r));
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

module.exports = { add, addParsed, list, clear, start, addDailyPreset, removeByTag };

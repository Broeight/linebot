// 每日早安推播：每天固定時間推「問候 + 天氣 + 今日生日」給訂閱的使用者。
// 用法：
//   開啟早安            （天氣預設台北市）
//   開啟早安 高雄市      （指定城市）
//   關閉早安
//   bật tin sáng / tắt tin sáng（越南語直達，天氣預設台北市）
const store = require('../store');
const { client } = require('../line');
const { getWeather } = require('./weather');
const birthday = require('./birthday');
const { config } = require('../config');
const lang = require('../lang');
const ai = require('../ai');

const FILE = 'morning.json';

// 天氣段翻譯用的語言名對照（給 ai.ask 的 prompt 用）
const WEATHER_LANG_NAME = {
  vi: '越南語',
  en: '英文',
  ja: '日文',
  th: '泰文',
  id: '印尼文',
};

function subscribe(userId, city, code = 'zh-TW') {
  const c = (city || '').trim() || '台北市';
  const list = store.load(FILE).filter((s) => s.userId !== userId);
  list.push({ userId, city: c });
  store.save(FILE, list);
  return lang.morningOn(code, config.morningTime, c);
}

function unsubscribe(userId, code = 'zh-TW') {
  const before = store.load(FILE);
  const after = before.filter((s) => s.userId !== userId);
  store.save(FILE, after);
  return before.length === after.length ? lang.morningOffNone(code) : lang.morningOff(code);
}

async function buildMessage(sub) {
  let code = 'zh-TW';
  try {
    code = (await lang.resolve(sub.userId)) || 'zh-TW';
  } catch {
    code = 'zh-TW';
  }

  const parts = [lang.morningGreeting(code)];

  let weatherText = '';
  try {
    weatherText = await getWeather(sub.city);
  } catch {
    /* 天氣失敗就略過 */
  }
  if (weatherText) {
    if (code === 'zh-TW') {
      parts.push(weatherText);
    } else {
      const langName = WEATHER_LANG_NAME[code] || '英文';
      let translated = '';
      try {
        translated = await ai.ask(`把以下訊息完整翻譯成${langName}，保留 emoji 與數字，只輸出翻譯結果`, weatherText);
      } catch {
        translated = '';
      }
      parts.push(translated || weatherText);
    }
  }

  const bdays = birthday.todays(sub.userId);
  if (bdays.length) {
    const namesJoined = bdays.join(code === 'zh-TW' ? '、' : ', ');
    parts.push(lang.birthdayLine(code, namesJoined));
  }
  return parts.join('\n\n');
}

async function sendAll() {
  for (const sub of store.load(FILE)) {
    try {
      const msg = await buildMessage(sub);
      await client.pushMessage({ to: sub.userId, messages: [{ type: 'text', text: msg.slice(0, 5000) }] });
    } catch (e) {
      console.error('早安推播失敗：', e.message);
    }
  }
}

// 「今天已送」狀態持久化到檔案，避免伺服器重啟後同日重複推播或漏送（P1-4）
const STATE_FILE = 'morning-state.json';
function getLastSent() {
  const s = store.load(STATE_FILE);
  return (s && s.lastSent) || '';
}

let ticking = false;
async function tick() {
  if (ticking) return; // 防重入（P0-2）
  ticking = true;
  try {
    const t = store.taipei();
    // 今天尚未送、且現在時間已到（>= 設定時間）就送：即使伺服器在設定的那分鐘
    // 沒醒著（休眠/重啟），醒來後仍會補送，並以檔案記錄去重。
    if (t.hm >= config.morningTime && getLastSent() !== t.date) {
      store.save(STATE_FILE, { lastSent: t.date });
      await sendAll();
    }
  } catch (e) {
    console.error('早安推播排程錯誤：', e.message);
  } finally {
    ticking = false;
    setTimeout(tick, 30 * 1000);
  }
}

function start() {
  setTimeout(tick, 30 * 1000);
  console.log(`☀️ 早安推播排程已啟動（每天 ${config.morningTime}）`);
}

module.exports = { subscribe, unsubscribe, sendAll, start };

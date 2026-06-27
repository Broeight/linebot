// 每日早安推播：每天固定時間推「問候 + 天氣 + 今日生日」給訂閱的使用者。
// 用法：
//   開啟早安            （天氣預設台北市）
//   開啟早安 高雄市      （指定城市）
//   關閉早安
const store = require('../store');
const { client } = require('../line');
const { getWeather } = require('./weather');
const birthday = require('./birthday');
const { config } = require('../config');

const FILE = 'morning.json';

function subscribe(userId, city) {
  const c = (city || '').trim() || '台北市';
  const list = store.load(FILE).filter((s) => s.userId !== userId);
  list.push({ userId, city: c });
  store.save(FILE, list);
  return `☀️ 已開啟每日早安推播（每天 ${config.morningTime}），天氣以「${c}」為準。\n關閉請輸入「關閉早安」。`;
}

function unsubscribe(userId) {
  const before = store.load(FILE);
  const after = before.filter((s) => s.userId !== userId);
  store.save(FILE, after);
  return before.length === after.length ? '你目前沒有開啟早安推播。' : '已關閉每日早安推播。';
}

function greeting() {
  const hellos = ['早安！新的一天加油 💪', '早安～祝你有美好的一天 ☀️', '早安！記得吃早餐喔 🍳'];
  return hellos[Math.floor(Math.random() * hellos.length)];
}

async function buildMessage(sub) {
  const parts = [greeting()];
  try {
    parts.push(await getWeather(sub.city));
  } catch {
    /* 天氣失敗就略過 */
  }
  const bdays = birthday.todays(sub.userId);
  if (bdays.length) parts.push(`🎂 今天是 ${bdays.join('、')} 的生日，別忘了祝賀！`);
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

let lastSent = '';
function start() {
  setInterval(async () => {
    const t = store.taipei();
    if (t.hm === config.morningTime && lastSent !== t.date) {
      lastSent = t.date;
      await sendAll();
    }
  }, 30 * 1000);
  console.log(`☀️ 早安推播排程已啟動（每天 ${config.morningTime}）`);
}

module.exports = { subscribe, unsubscribe, sendAll, start };

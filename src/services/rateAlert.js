// 匯率到價提醒：固定幣別對 TWD→VND（家庭場景唯一剛需）。
// 每人一筆（新設定覆蓋舊的）；到價即推播並自動移除（一次性）。
// 排程比照 reminder.js／morning.js 的「自我排程 setTimeout + 防重入旗標」模式。
const store = require('../store');
const lang = require('../lang');
const { client } = require('../line');
const exchangeRate = require('./exchangeRate');

const FILE = 'rateAlert.json'; // [{ userId, target, direction: 'up'|'down', createdAt }]
const TICK_MS = 30 * 60 * 1000; // 30 分鐘（匯率 API 本身有 30 分快取、來源每日更新，頻率足夠）

// exchangeRate.getRate 回 { ok, rate, ... } 或 { ok:false }；這裡統一轉成「數字或 null」，
// 方便本檔比對邏輯（測試可直接 stub exchangeRate.getRate 回傳數字或 null）。
// 注意：透過 module 物件呼叫（而非解構），讓測試對 exchangeRate.getRate 的替換能生效。
async function currentRate() {
  const r = await exchangeRate.getRate('TWD', 'VND');
  if (typeof r === 'number') return r; // 測試 stub 直接回數字
  if (r && r.ok && typeof r.rate === 'number') return r.rate;
  return null;
}

function list() {
  const s = store.load(FILE);
  return Array.isArray(s) ? s : [];
}

function get(userId) {
  return list().find((a) => a.userId === userId) || null;
}

/** 設定到價提醒：方向自動判斷（目標 >= 現價 → 漲到通知；否則跌到通知）。 */
async function set(userId, target) {
  const rate = await currentRate(); // 失敗回 null → 呼叫端回錯誤句
  if (rate == null) return null;
  const direction = target >= rate ? 'up' : 'down';
  const l = list().filter((a) => a.userId !== userId); // 每人一筆（覆蓋）
  l.push({ userId, target, direction, createdAt: Date.now() });
  store.save(FILE, l);
  return { direction, current: rate };
}

/** 清除某使用者的到價提醒；回傳是否真的有清到。 */
function clear(userId) {
  const before = list();
  const after = before.filter((a) => a.userId !== userId);
  store.save(FILE, after);
  return before.length !== after.length;
}

let ticking = false;
async function tick() {
  if (ticking) return; // 防重入
  ticking = true;
  try {
    const alerts = list();
    if (alerts.length) {
      const rate = await currentRate();
      if (rate != null) {
        for (const a of alerts) {
          const hit = a.direction === 'up' ? rate >= a.target : rate <= a.target;
          if (!hit) continue;
          let code = 'zh-TW';
          try {
            code = (await lang.resolve(a.userId)) || 'zh-TW';
          } catch {
            code = 'zh-TW';
          }
          await client
            .pushMessage({ to: a.userId, messages: [{ type: 'text', text: lang.rateAlertHit(code, rate, a.target) }] })
            .catch(() => {});
          clear(a.userId); // 一次性：到價即移除
        }
      }
    }
  } catch (e) {
    console.error('匯率提醒排程錯誤：', e.message);
  } finally {
    ticking = false;
    setTimeout(tick, TICK_MS); // 前一輪完成後才排下一輪
  }
}

function start() {
  setTimeout(tick, TICK_MS);
  console.log('💱 匯率到價提醒排程已啟動（每 30 分鐘）');
}

module.exports = { set, get, clear, list, start, tick /* tick 供測試 */ };

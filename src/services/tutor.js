// 每日中文小老師：訂閱後每天固定時間（預設 20:00）推一課「3 句情境中文」
// （繁體＋漢語拼音＋越南語意思），主題每天輪替，全家共享同一課內容。
// 用法：
//   開啟學中文 / học tiếng Trung   訂閱
//   關閉學中文 / tắt học tiếng Trung  退訂
//   今天的中文 / học hôm nay          隨時看當日課（未生成則現場生成）
const store = require('../store');
const { client } = require('../line');
const lang = require('../lang');
const ai = require('../ai');
const { config } = require('../config');

const FILE = 'tutor.json'; // [{ userId }]（訂閱名單，無其他欄位）
const STATE_FILE = 'tutor-state.json'; // { date, themeIndex, themeZh, themeVi, phrases, lastSent }

// 14 個場景主題（zh／vi 對照，供 prompt 與課程標題用）
const THEMES = [
  { zh: '菜市場', vi: 'chợ' },
  { zh: '醫院', vi: 'bệnh viện' },
  { zh: '學校', vi: 'trường học' },
  { zh: '捷運', vi: 'tàu điện ngầm' },
  { zh: '郵局', vi: 'bưu điện' },
  { zh: '銀行', vi: 'ngân hàng' },
  { zh: '夜市', vi: 'chợ đêm' },
  { zh: '藥局', vi: 'nhà thuốc' },
  { zh: '餐廳', vi: 'nhà hàng' },
  { zh: '超市', vi: 'siêu thị' },
  { zh: '火車站', vi: 'ga tàu hoả' },
  { zh: '戶政事務所', vi: 'văn phòng hộ tịch' },
  { zh: '鄰居寒暄', vi: 'chào hỏi hàng xóm' },
  { zh: '打電話', vi: 'gọi điện thoại' },
];

/**
 * 依台北日期算出今天的主題（無狀態：daysSinceEpoch % 14），重啟不影響順序。
 * @param {string} [ymd] 'YYYY-MM-DD'（預設 store.taipei().date）
 * @returns {{zh:string, vi:string}}
 */
function themeFor(ymd) {
  const date = ymd || store.taipei().date;
  const [y, m, d] = date.split('-').map(Number);
  const days = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  const idx = ((days % THEMES.length) + THEMES.length) % THEMES.length;
  return THEMES[idx];
}

function loadState() {
  const s = store.load(STATE_FILE);
  return Array.isArray(s) ? {} : s || {};
}
function saveState(state) {
  store.save(STATE_FILE, state);
}

function loadSubs() {
  const s = store.load(FILE);
  return Array.isArray(s) ? s : [];
}

/**
 * 訂閱（冪等）。
 * @param {string} userId
 * @param {string} [code] 語言碼
 * @returns {string}
 */
function subscribe(userId, code = 'zh-TW') {
  const list = loadSubs().filter((s) => s.userId !== userId);
  list.push({ userId });
  store.save(FILE, list);
  return lang.tutorOn(code, config.tutorTime);
}

/**
 * 退訂（冪等；本來就沒訂閱回「沒有訂閱」句）。
 * @param {string} userId
 * @param {string} [code] 語言碼
 * @returns {string}
 */
function unsubscribe(userId, code = 'zh-TW') {
  const before = loadSubs();
  const after = before.filter((s) => s.userId !== userId);
  store.save(FILE, after);
  return before.length === after.length ? lang.tutorOffNone(code) : lang.tutorOff(code);
}

// 生成課程用的 system/user prompt（PRD §生成 prompt）
function buildPrompt(theme, ymd) {
  const system =
    `你是教越南人學實用繁體中文的老師。主題：${theme.zh}（tiếng Việt: ${theme.vi}）。` +
    `請出 3 句在台灣「${theme.zh}」場景最常用的口語短句（繁體中文，每句≤12字、禮貌自然），` +
    '附漢語拼音（含聲調符號）與越南語意思。只輸出 JSON：' +
    '{"phrases":[{"zh":"...","pinyin":"...","vi":"..."}]}';
  const user = `今天是 ${ymd}，請給和平常不同的例句。`;
  return { system, user };
}

// 驗證 askJSON 回傳：phrases 為陣列且 ≥3 個含非空 zh/pinyin/vi 的項目 → slice(0,3)；否則 null
function validatePhrases(result) {
  if (!result || !Array.isArray(result.phrases)) return null;
  const valid = result.phrases.filter(
    (p) => p && typeof p.zh === 'string' && p.zh.trim() &&
      typeof p.pinyin === 'string' && p.pinyin.trim() &&
      typeof p.vi === 'string' && p.vi.trim()
  );
  if (valid.length < 3) return null;
  return valid.slice(0, 3).map((p) => ({ zh: p.zh.trim(), pinyin: p.pinyin.trim(), vi: p.vi.trim() }));
}

// in-flight promise memo：同一天內的並發呼叫（20:00 tick 與同時的「今天的中文」）只呼叫一次 Groq
let inflight = null; // { date, promise }

/**
 * 確保「今天的課」已生成並快取；同日重複呼叫（含並發）不重生成/不重呼叫 Groq。
 * 失敗（AI 錯誤/JSON 不合格式）回 null，不污染快取。
 * @returns {Promise<{date:string, theme:object, phrases:Array}|null>}
 */
async function ensureLesson() {
  const today = store.taipei().date;
  const state = loadState();
  if (state.date === today && Array.isArray(state.phrases) && state.phrases.length) {
    return { date: state.date, theme: { zh: state.themeZh, vi: state.themeVi }, phrases: state.phrases };
  }

  if (inflight && inflight.date === today) {
    return inflight.promise;
  }

  const theme = themeFor(today);
  const { system, user } = buildPrompt(theme, today);

  const promise = (async () => {
    let result;
    try {
      result = await ai.askJSON(system, user);
    } catch {
      result = null;
    }
    const phrases = validatePhrases(result);
    if (!phrases) return null; // 失敗：不污染快取
    const newState = { date: today, themeZh: theme.zh, themeVi: theme.vi, phrases, lastSent: state.lastSent || '' };
    saveState(newState);
    return { date: today, theme: { zh: theme.zh, vi: theme.vi }, phrases };
  })();

  inflight = { date: today, promise };
  try {
    return await promise;
  } finally {
    if (inflight && inflight.date === today) inflight = null;
  }
}

/**
 * 依語言包裝今天的課程文字（供訂閱推播與「今天的中文」共用）。
 * @param {string} code
 * @returns {Promise<string|null>} 生成失敗回 null（呼叫端自行決定 fallback 文案）
 */
async function lessonText(code) {
  const lesson = await ensureLesson();
  if (!lesson) return null;
  return lang.tutorLesson(code, lesson.theme, lesson.phrases);
}

/** 對所有訂閱者推播今天的課（依各自語言包裝，同一份課程內容）。 */
async function sendAll() {
  const subs = loadSubs();
  if (subs.length === 0) return; // 0 訂閱者 → 不生成、不呼叫 AI
  const lesson = await ensureLesson();
  if (!lesson) return; // AI 失敗：當天靜默跳過，不推靜態墊檔句
  for (const sub of subs) {
    let code = 'zh-TW';
    try {
      code = (await lang.resolve(sub.userId)) || 'zh-TW';
    } catch {
      code = 'zh-TW';
    }
    const text = lang.tutorLesson(code, lesson.theme, lesson.phrases);
    try {
      await client.pushMessage({ to: sub.userId, messages: [{ type: 'text', text: text.slice(0, 5000) }] });
    } catch (e) {
      console.error('每日中文推播失敗：', e.message);
    }
  }
}

// 排程比照 house 模式：30 秒 tick、防重入、先標記再發（避免重複推播）
let ticking = false;
async function tick() {
  if (ticking) return; // 防重入
  ticking = true;
  try {
    const t = store.taipei();
    const state = loadState();
    const alreadySent = state.lastSent === t.date;
    if (t.hm >= config.tutorTime && !alreadySent) {
      // 先標記再發（防重複）：不論 sendAll 是否真的成功推播都標記（AI 失敗政策：當天跳過）
      const marked = { ...state, lastSent: t.date };
      saveState(marked);
      await sendAll();
    }
  } catch (e) {
    console.error('每日中文排程錯誤：', e.message);
  } finally {
    ticking = false;
    setTimeout(tick, 30 * 1000);
  }
}

function start() {
  setTimeout(tick, 30 * 1000);
  console.log(`🗣 每日中文小老師排程已啟動（每天 ${config.tutorTime}）`);
}

module.exports = {
  subscribe,
  unsubscribe,
  sendAll,
  start,
  tick,
  themeFor,
  ensureLesson,
  lessonText,
  THEMES,
  _internal: { loadState, saveState, loadSubs, buildPrompt, validatePhrases },
};

// 測試共用工具：把整個「外部世界」換成假的，讓測試離線、快速、且**絕不碰真實資料**。
//
// 用法（每個測試檔的第一個 require 都要是這支）：
//   const h = require('./helpers');
//   const env = h.setup();                     // 在 beforeEach
//   env.seed('birthdays.json', [{...}]);       // 塞假資料
//   env.setTime({ date: '2026-09-25' });       // 控制「今天」
//   ... 呼叫受測程式 ...
//   env.restore();                             // 在 afterEach
//
// 設計重點：
// - services 都是用 `store.load(...)` 這種「屬性呼叫」存取儲存層，所以直接替換
//   store.load/save 就能整層攔截 → 測試永遠不會讀寫 data/ 下的真實檔案。
// - global.fetch 一律封鎖：任何測試不小心打網路都會立刻失敗（而不是靜默變慢／變不穩）。

// ⚠️ 假金鑰必須在 require 任何 src 之前設定：Groq SDK 在「載入當下」就驗金鑰，
//    缺了會直接 throw（CI 沒有 .env，這行是必要的）。
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key-not-used';
process.env.LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || 'test-token';
process.env.LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || 'test-secret';

const store = require('../src/store');
const line = require('../src/line');
const ai = require('../src/ai');

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// 預設的「現在」：固定日期，測試才不會因為今天幾號而飄。
const DEFAULT_NOW = { date: '2026-07-24', md: '07-24', ym: '2026-07', hm: '10:00' };

/**
 * 安裝測試替身。回傳一個操作把手；務必在 afterEach 呼叫 restore()。
 * @param {{now?: object}} [opts]
 */
function setup(opts = {}) {
  const originals = {
    load: store.load,
    save: store.save,
    taipei: store.taipei,
    fetch: global.fetch,
    push: line.client.pushMessage,
    reply: line.client.replyMessage,
    getProfile: line.client.getProfile,
    ai: { chat: ai.chat, ask: ai.ask, askJSON: ai.askJSON, vision: ai.vision, transcribe: ai.transcribe },
  };

  // ── 記憶體儲存層（完全取代檔案與雲端）──────────────────────
  const mem = new Map();
  store.load = (name) => (mem.has(name) ? clone(mem.get(name)) : []); // 與真實 store 一致：miss 回 []
  store.save = (name, data) => { mem.set(name, clone(data)); };

  // ── 固定時鐘 ───────────────────────────────────────────
  let now = { ...DEFAULT_NOW, ...(opts.now || {}) };
  store.taipei = () => ({ ...now });

  // ── 封鎖網路：測試打網路一律視為錯誤 ────────────────────────
  global.fetch = async (url) => {
    throw new Error(`測試不得打網路（被攔截的請求：${String(url).slice(0, 80)}）`);
  };

  // ── LINE：記錄推播，永不真的送出 ───────────────────────────
  const pushes = [];
  const replies = [];
  line.client.pushMessage = async (arg) => { pushes.push(arg); return {}; };
  line.client.replyMessage = async (arg) => { replies.push(arg); return {}; };
  line.client.getProfile = async () => ({ displayName: 'Tester', language: 'zh-TW' });

  // ── AI：預設全部回空／null，個別測試再用 setAi 覆寫 ──────────
  const aiCalls = [];
  ai.chat = async (...a) => { aiCalls.push(['chat', ...a]); return ''; };
  ai.ask = async (...a) => { aiCalls.push(['ask', ...a]); return ''; };
  ai.askJSON = async (...a) => { aiCalls.push(['askJSON', ...a]); return null; };
  ai.vision = async (...a) => { aiCalls.push(['vision', ...a]); return ''; };
  ai.transcribe = async (...a) => { aiCalls.push(['transcribe', ...a]); return ''; };

  return {
    /** 塞入假資料（等同該 json 檔的內容） */
    seed(name, data) { mem.set(name, clone(data)); return this; },
    /** 讀出目前的假資料（驗證有沒有被正確寫入） */
    read(name) { return mem.has(name) ? clone(mem.get(name)) : []; },
    /** 改變「現在」；只給部分欄位也可以 */
    setTime(patch) { now = { ...now, ...patch }; return this; },
    /** 覆寫某個 ai 方法，例如 setAi('askJSON', async () => ({ok:true,...})) */
    setAi(name, fn) { ai[name] = fn; return this; },
    /** 覆寫語言判定用的資料，讓 lang.resolve 直接命中、不打 LINE API */
    seedLang(userId, code) {
      const cur = mem.get('lang.json') || [];
      mem.set('lang.json', [...cur.filter((x) => x.userId !== userId), { userId, lang: code, locked: true, welcomed: true }]);
      return this;
    },
    pushes,
    replies,
    aiCalls,
    /** 還原所有替身（afterEach 必呼叫） */
    restore() {
      store.load = originals.load;
      store.save = originals.save;
      store.taipei = originals.taipei;
      global.fetch = originals.fetch;
      line.client.pushMessage = originals.push;
      line.client.replyMessage = originals.reply;
      line.client.getProfile = originals.getProfile;
      Object.assign(ai, originals.ai);
    },
  };
}

/**
 * 暫時把某個模組的方法換掉，回傳還原函式。用於「這個指令有沒有跑到對的功能」。
 * @param {object} mod 模組物件（必須是 handler 用屬性呼叫的那個）
 * @param {string} name 方法名
 * @param {Function} fn 替身
 */
function spyOn(mod, name, fn) {
  const original = mod[name];
  const calls = [];
  mod[name] = (...args) => { calls.push(args); return fn ? fn(...args) : undefined; };
  return { calls, restore() { mod[name] = original; } };
}

module.exports = { setup, spyOn, DEFAULT_NOW };

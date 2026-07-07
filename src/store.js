// 共用的簡易 JSON 儲存：RAM 快取 + 本機檔案（照舊）+ 選填 Upstash 雲端同步。
// 未設定 UPSTASH_REDIS_REST_URL/TOKEN 時，行為與純檔案版完全相同。
//
// ⚠️ 適合家庭小量使用。資料量大或要多機共享時，請改用真正的資料庫。

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// ⚠️ 新增資料檔時記得加進來（init 開機還原用）。漏加不會壞：
//    load miss 走檔案、save 照推雲端，只是部署後不會從雲端還原該檔。
const KNOWN_KEYS = [
  'reminders.json', 'lang.json', 'birthdays.json', 'morning.json',
  'morning-state.json', 'health.json', 'expense.json', 'rateAlert.json',
  'groupTranslate.json', 'tutor.json', 'tutor-state.json',
  'alertSub.json', 'alert-state.json',
];

const DEBOUNCE_MS = 2000;
const cache = new Map();          // name -> 已 parse 資料（私有副本，進出都 clone）
let cloudMode = false;            // init() 成功連上 Upstash 後為 true
const pendingTimers = new Map();  // name -> setTimeout handle（write-behind 去抖）
const pendingData = new Map();    // name -> 待推的 JSON 字串（save 當下 stringify 定版）

// 測試注入縫（_internal 匯出）：deps.fetch / deps.env 可被覆寫
const deps = {
  fetch: (...a) => fetch(...a),
  env: () => {
    const { config } = require('./config'); // lazy：避免 require 順序耦合，且確保 dotenv 已載
    return config.upstash;                  // { url, token }
  },
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const filePath = (name) => path.join(DATA_DIR, name);

function readFileRaw(name) { // 讀不到/壞檔 → undefined
  try { return JSON.parse(fs.readFileSync(filePath(name), 'utf8')); }
  catch { return undefined; }
}
function writeFileRaw(name, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2));
}

// ── 對外介面：簽名與語意不變（同步；miss 回 []）────────────────
function load(name) {
  if (cache.has(name)) return clone(cache.get(name));
  const data = readFileRaw(name);
  if (data === undefined) return []; // 與現行一致；miss 不進快取（下次仍重讀檔）
  cache.set(name, data);
  return clone(data);
}

function save(name, data) {
  cache.set(name, clone(data)); // clone：呼叫端 save 後續 mutate 不可污染快取
  writeFileRaw(name, data);     // 寫檔照舊（同步、含 mkdir）
  queueCloudSet(name, data);    // 背景推雲端：不 await、不 throw
}

// ── write-behind：同 key 去抖 2 秒，只推最後一版 ────────────────
function queueCloudSet(name, data) {
  if (!cloudMode) return;
  try {
    pendingData.set(name, JSON.stringify(data)); // 當下定版
    clearTimeout(pendingTimers.get(name));
    pendingTimers.set(name, setTimeout(() => { flushKey(name); }, DEBOUNCE_MS));
  } catch (e) {
    console.error(`雲端同步排隊失敗（${name}，不影響本機存檔）：`, e.message);
  }
}

async function flushKey(name) {
  clearTimeout(pendingTimers.get(name));
  pendingTimers.delete(name);
  const body = pendingData.get(name);
  pendingData.delete(name);
  if (body === undefined) return;
  try {
    const { url, token } = deps.env();
    const res = await deps.fetch(`${url}/set/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }, // 不設 Content-Type（§1a）
      body,
      signal: AbortSignal.timeout(5000),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) {
      console.error(`雲端同步失敗（${name}）：`, out.error || `HTTP ${res.status}`);
    }
  } catch (e) {
    console.error(`雲端同步失敗（${name}）：`, e.message); // 不重試：下次 save 自然覆蓋
  }
}

// ── 開機還原（index.js 在 app.listen 前 await）──────────────────
async function init() {
  let env;
  try { env = deps.env(); } catch { env = {}; }
  if (!env || !env.url || !env.token) {
    console.log('💾 資料儲存：僅本機檔案（部署後會清空）');
    return;
  }
  try {
    const cmds = KNOWN_KEYS.map((k) => ['GET', k]);
    const res = await deps.fetch(`${env.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.token}` },
      body: JSON.stringify(cmds),
      signal: AbortSignal.timeout(8000), // 8 秒總逾時：連不上就退檔案模式
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const results = await res.json(); // [{result:"json字串"|null} | {error:...}, ...]
    if (!Array.isArray(results) || results.length !== KNOWN_KEYS.length) {
      throw new Error('pipeline 回應格式不符');
    }

    cloudMode = true; // 連得上才開雲端模式（先開，讓下面首次啟用反向上傳能排隊）

    for (let i = 0; i < KNOWN_KEYS.length; i++) {
      const name = KNOWN_KEYS[i];
      const raw = results[i] && results[i].result;
      if (typeof raw === 'string') {
        try { // 雲端有 → 還原 RAM + 檔案
          const data = JSON.parse(raw);
          cache.set(name, data);
          writeFileRaw(name, data);
        } catch { console.error(`雲端資料解析失敗，改用本機檔案（${name}）`); }
      } else { // 雲端沒有 → 本機有檔就反向上傳（首次啟用）；兩邊都沒有 → 跳過
        const local = readFileRaw(name);
        if (local !== undefined) {
          cache.set(name, local);
          queueCloudSet(name, local);
        }
      }
    }

    // Render 關機前送 SIGTERM：盡力沖掉去抖佇列（3 秒上限，之後強制退出）
    process.once('SIGTERM', () => {
      const names = [...pendingTimers.keys()];
      for (const t of pendingTimers.values()) clearTimeout(t);
      pendingTimers.clear();
      const bye = () => process.exit(0);
      if (names.length === 0) return bye();
      Promise.allSettled(names.map((n) => flushKey(n))).then(bye, bye);
      setTimeout(bye, 3000).unref();
    });

    console.log('💾 資料儲存：雲端同步（Upstash）');
  } catch (e) {
    cloudMode = false;
    console.error('⚠️ 連不上 Upstash：', e.message);
    console.log('💾 資料儲存：僅本機檔案（部署後會清空）');
  }
}

// 台北時間（固定 +08:00，無日光節約）的常用格式
function taipei() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`, // 2026-06-28
    md: `${p.month}-${p.day}`,             // 06-28
    ym: `${p.year}-${p.month}`,            // 2026-06
    hm: `${p.hour}:${p.minute}`,           // 07:00
  };
}

module.exports = {
  load, save, taipei, DATA_DIR, init,
  _internal: { // 測試縫；正式程式不得使用
    KNOWN_KEYS, deps, cache, pendingTimers, pendingData, flushKey,
    DEBOUNCE_MS,
    isCloudMode: () => cloudMode,
    setCloudMode: (v) => { cloudMode = v; },
  },
};

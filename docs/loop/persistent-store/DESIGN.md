# DESIGN — 持久化儲存（Upstash Redis REST，write-behind 門面）

## ✅ 需要金鑰：**選填**（`UPSTASH_REDIS_REST_URL` ＋ `UPSTASH_REDIS_REST_TOKEN`；未設定＝行為與現行完全相同的檔案模式，本 PR 可先安全 merge，之後補環境變數即自動啟用）

---

## 0. 重要盤點發現（PRD 假設修正）

**`reminder.js` 沒有走 `store.js`**——它自帶一份私有的 `load()/save()`（`fs` 直讀寫
`data/reminders.json`，miss 回 `[]`、`JSON.stringify(list, null, 2)`，語意與 store.js 逐字相同）。
若不改它，開機還原雖然會把 `reminders.json` 寫回檔案（reminder 讀得到），但**之後每次
save 都不會推雲端**，提醒（PRD 背景裡的第一痛點）等於沒被保護。

→ **本案變更檔案共 4＋1 個**：`src/store.js`、`src/index.js`、`src/config.js`、
**`src/services/reminder.js`（最小改動：私有 load/save 改走 store 門面）**、`.env.example`。
`render.yaml` 不動（選填變數由使用者在 Render dashboard 手動加，避免 Blueprint 強制提示）。

---

## 1. 已驗證的 Upstash REST 契約（官方文件 upstash.com/docs/redis/features/restapi、/overall/pricing，2026-07 查證）

### 1a. 請求格式
- **認證**：HTTP header `Authorization: Bearer {TOKEN}`（也可 `?_token=`，不用）。
- **GET**：`GET {URL}/get/{key}` → `200 {"result":"<字串值>"}`；key 不存在 → `200 {"result":null}`。
- **SET（採用 POST-body 式）**：`POST {URL}/set/{key}`，**值放 request body**（官方：
  "To post a JSON or a binary value, you can use an HTTP POST request and set value as the
  request body"、"the request body is appended as the last parameter of the Redis command"）。
  成功 → `200 {"result":"OK"}`。
  - **為何不用 path 式** `{URL}/set/{key}/{value}`：我們的值是含中文/越南語/引號/換行的
    JSON 字串，放 URL path 要 encode 且有長度風險；body 式**逐 byte 原樣**當值存，無此問題。
  - **Content-Type 不需要也不要設**（文件未定義其行為；不設或 `text/plain` 皆可，
    **勿設 `application/json`** 以免踩到未文件化的解讀）。body 可含換行、Unicode、引號，原樣保存。
- **Pipeline（開機還原用）**：`POST {URL}/pipeline`，body 為 JSON 二維陣列
  `[["GET","key1"],["GET","key2"],...]` → `200` 回陣列
  `[{"result":"值或null"},{"result":null},...]`（逐條對應、非原子性——我們只做 GET，無所謂）。
  另有 `POST /multi-exec`（原子交易）與 path 式 `GET {URL}/mget/k1/k2`（回 `{"result":[v1,null,...]}`），
  **本案採 pipeline**：一次 round trip、格式最單純、之後要混 GET/SET 也行。
- **錯誤格式**：非 2xx，body `{"error":"訊息"}`。狀態碼：`400` 指令語法錯、
  `401` token 錯（`{"error":"WRONGPASS invalid password"}` 之類）、`405` method 不對。

### 1b. JSON 值往返
Redis 值一律是字串：**寫入前 `JSON.stringify(data)`（不縮排），讀回後 `JSON.parse(result)`**。
body 逐 byte 保存 → 中文、越南語聲調字元、emoji、換行全部安全（Node `fetch` body 以 UTF-8 送出，
Upstash 原樣存取；讀回的 `{"result":"..."}` 內層是 JSON 轉義過的字串，`res.json()` 解完即原文）。
唯一要 encode 的是 **path 上的 key**：我們的 key 只有小寫英數、`-`、`.`（檔名），
保險起見仍統一 `encodeURIComponent(name)`。

### 1c. 免費額度（2026-07 官網 pricing 頁）
| 項目 | 免費額度 | 本案用量（§2 估算） |
|---|---|---|
| 指令數 | **500K / 月** | 約 1.2 萬 / 月（**40 倍餘裕**） |
| 資料量 | 256 MB | < 100 KB |
| 單一請求上限 | 10 MB | 每筆幾 KB |
| 頻寬 | 10 GB / 月 | 約 2 MB / 月 |
| DB 數 | 1 個免費 DB | 1 個 |

**指令數估算（最壞情況）**：
- 讀取**全部走 RAM**：reminder/morning 每 30 秒、rateAlert 每 30 分的排程 `load()` **零雲端指令**（這是本設計最關鍵的成本特性）。
- 開機還原：1 次 pipeline＝9 個 GET 指令；一天就算部署/重啟 20 次＝180 指令。
- 寫入：每次 `save()`＝1 個 SET（去抖後同 key 併成最後一版）。家庭 5 人重度使用抓
  150 次/日；排程寫入＝morning-state 1 次/日＋提醒觸發（喝水預設 8 次＋一般數次）約 13 次/日＋匯率到價數次/日。
- 合計 **< 400 指令/日 ≈ 1.2 萬/月**，遠低於 50 萬/月。

---

## 2. Call-site 完整盤點（grep `store.load|store.save|require.*store` 全 src/）

| 檔案 | 資料檔（key） | 形狀 | miss 時（load 回 `[]`）呼叫端行為 |
|---|---|---|---|
| `src/lang.js` | `lang.json` | 陣列 `[{userId,lang,locked,welcomed?}]` | `.find/.filter` 直接用，OK |
| `src/services/reminder.js`（**自帶 fs，需改**） | `reminders.json` | 陣列 | 私有 load 已回 `[]`，OK |
| `src/services/birthday.js` | `birthdays.json` | 陣列 | `.filter/.map`，OK |
| `src/services/expense.js` | `expense.json` | 陣列 | `.push` 前直接用，OK |
| `src/services/health.js` | `health.json` | 陣列 | 同上，OK |
| `src/services/morning.js` | `morning.json` | 陣列 | `.filter`，OK |
| `src/services/morning.js` | `morning-state.json` | **物件** `{lastSent}` | `(s && s.lastSent) \|\| ''`——`[]` 也安全 |
| `src/services/rateAlert.js` | `rateAlert.json` | 陣列 | 自行 `Array.isArray(s) ? s : []` |
| `src/services/groupTranslate.js` | `groupTranslate.json` | **物件** `{[groupId]:{enabled}}` | 自行 coerce 非物件→`{}` |

只用 `store.taipei()`、不碰資料檔：`handler.js`、`tools.js`、`services/holiday.js`、
`services/traTrain.js`（`gasStation.js` 僅註解提及，刻意不存）。`conversation.js` 純 RAM（範圍外）。

**KNOWN_KEYS（init 開機還原清單，9 個）**：
```js
const KNOWN_KEYS = [
  'reminders.json',      // 提醒（reminder.js，本案改走 store）
  'lang.json',           // 每人語言 + welcomed 旗標
  'birthdays.json',      // 生日
  'morning.json',        // 早安訂閱
  'morning-state.json',  // 早安已送日期（物件）
  'health.json',         // 血壓血糖
  'expense.json',        // 記帳
  'rateAlert.json',      // 匯率到價提醒
  'groupTranslate.json', // 群組翻譯開關（物件）
];
```
不在清單內的 key（未來新功能忘了加）仍可用：load miss 走檔案、save 照樣推雲端，
只是**開機不會從雲端還原**——KNOWN_KEYS 旁必須加註解提醒 coder「新資料檔要同步加進來」。

**呼叫端變異（mutation）模式稽核**：所有呼叫端一律「`load()` 取新副本 → 就地改 → 立即
`save()`」；沒有任何模組把 load 回傳值存起來跨呼叫共用、或依賴兩次 load 回同一參考
（現行程式每次 load 都是重新 `JSON.parse`，本來就是**每次全新物件**）。reminder.js 的
tick 甚至刻意「推播後**重新 load** 再套 id 變更」（P0-1 防資料競態註解）。
→ **load 回傳 clone 是行為等價的**，見 §3 決策。

---

## 3. `src/store.js` 改造（近完整程式碼）

### 3a. 設計決策
1. **load 回傳 clone（`JSON.parse(JSON.stringify(cached))`）**：現行每次 load 都是檔案重新
   parse＝全新物件；若快取直接回同一參考，呼叫端 A mutate 後未 save，呼叫端 B 的 load 就會
   看到髒資料——**語意改變**。clone 完整保留「每次 load 都是獨立副本」語意；資料量幾 KB，
   成本可忽略。§2 稽核確認無人依賴共享參考。
2. **save 時 cache 也存 clone**：呼叫端 save 之後若繼續 mutate 手上物件，不可污染快取
   （等同現行「檔案在 save 當下就定格」）。
3. **cache miss 不快取 `[]`**：現行對不存在的檔每次 load 都重試讀檔；照舊（測試或人工直接
   放檔案後，下一次 load 讀得到）。只有「讀檔成功」與「save」會進快取。
4. **去抖 stringify 於 save 當下**：鎖定版本，之後呼叫端再 mutate 不影響待推內容；
   同 key 2 秒內多次 save 只推最後一版。
5. **cloudMode 才註冊 SIGTERM flush**：Render 停止程序前先送 SIGTERM（預設有寬限期），
   盡力把去抖佇列沖出去；檔案模式維持 Node 預設行為。Windows 本機開發收不到 SIGTERM，無影響。
6. **env 延遲讀取**：`deps.env()` 在呼叫當下 lazy-require config（dotenv 已由 config 載入），
   測試可用 `_internal.deps` 注入 fetch/env，也可直接設 `process.env` 後重新 require。
7. **絕不 throw**：load/save/init/flush 全部 try/catch 到底；雲端任何失敗只 `console.error`。

### 3b. 程式碼（coder 以此為準；`taipei()` 與 `DATA_DIR` 原封不動）
```js
// 共用的簡易 JSON 儲存：RAM 快取 + 本機檔案（照舊）+ 選填 Upstash 雲端同步。
// 未設定 UPSTASH_REDIS_REST_URL/TOKEN 時，行為與純檔案版完全相同。
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// ⚠️ 新增資料檔時記得加進來（init 開機還原用）。漏加不會壞：
//    load miss 走檔案、save 照推雲端，只是部署後不會從雲端還原該檔。
const KNOWN_KEYS = [
  'reminders.json', 'lang.json', 'birthdays.json', 'morning.json',
  'morning-state.json', 'health.json', 'expense.json', 'rateAlert.json',
  'groupTranslate.json',
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

// taipei()：原封不動照抄現行實作（Asia/Taipei 格式化，略）

module.exports = {
  load, save, taipei, DATA_DIR, init,
  _internal: { // 測試縫；正式程式不得使用
    KNOWN_KEYS, deps, cache, pendingTimers, pendingData, flushKey,
    DEBOUNCE_MS,
    isCloudMode: () => cloudMode,
    setCloudMode: (v) => { cloudMode = v; },
  },
};
```

### 3c. `src/services/reminder.js` 最小改動
把檔頭私有儲存改走門面，**其餘一行不動**：
```js
// 刪：const fs = require('fs'); 與 DATA_DIR/FILE 常數、私有 load/save
// （path 若無他用一併刪）
const store = require('../store');
const FILE = 'reminders.json';
const load = () => store.load(FILE);
const save = (list) => store.save(FILE, list);
```
語意逐字等價驗證：私有版 miss 回 `[]`＝store 版；私有版 `JSON.stringify(list, null, 2)`
寫 `data/reminders.json`＝store 版同路徑同格式。函式名不變，檔內 14 處 `load()/save()` 呼叫零修改。

---

## 4. `src/index.js` 改動（開機順序）

新增 require（第 12 行附近，其他 require 之後即可）：
```js
const store = require('./store');
```
檔尾 `app.listen(...)` 區塊**整段替換**為（middleware／路由註冊順序完全不動，仍在模組頂層）：
```js
// 先從雲端還原資料（未設定雲端時 init 立即完成），完成後才開始收 webhook。
// store.init() 設計上絕不 throw；try/catch 是最後保險——任何意外都不能讓 bot 起不來。
(async () => {
  try {
    await store.init();
  } catch (e) {
    console.error('store.init 意外失敗（退回檔案模式繼續啟動）：', e);
  }
  app.listen(config.port, () => {
    console.log(`🚀 LINE bot 已啟動，監聽埠號 ${config.port}`);
    console.log(`   Webhook 路徑： POST /webhook`);
    reminder.start(); // 啟動提醒排程
    morning.start(); // 啟動每日早安推播排程
    rateAlert.start(); // 啟動匯率到價提醒排程
    richMenu.ensureSetup().catch((e) => console.error('richmenu setup 失敗：', e));
  });
})();
```
順序保證：所有 `store.load` 都發生在 webhook 事件或排程 tick 內，而兩者都在 `listen`
callback 之後才可能發生 → init 還原必然先完成。（各模組 require 階段沒有任何頂層 load，已盤點確認。）

---

## 5. `src/config.js` 與 `.env.example`

`config.js`——`config` 物件加一段（**assertConfig 不動**，兩變數皆選填）：
```js
  // 選填：Upstash Redis 雲端同步（兩個都設才啟用；不設＝僅本機檔案）
  upstash: {
    url: process.env.UPSTASH_REDIS_REST_URL || '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
  },
```
`.env.example` 檔尾加：
```
# ── 選填：Upstash Redis 雲端備份（免費）──────────────────────
# 不設定也能正常運作，但 Render 免費方案每次部署/重啟會清空 data/*.json。
# 到 https://upstash.com 免費註冊 → Create Database → 複製 REST URL 與 TOKEN。
# UPSTASH_REDIS_REST_URL=https://xxxx.upstash.io
# UPSTASH_REDIS_REST_TOKEN=AbCd...
```

---

## 6. 測試策略（對應 PRD 驗收 1–7；全離線，本機 mock Upstash）

### 6a. Mock server 規格（tester 照此實作；node 內建 http，零依賴）
```js
const http = require('http');
const kv = new Map();     // 雲端資料（字串 → 字串）
let forceStatus = 0;      // 設 500 模擬故障；0 = 正常
const seen = [];          // 所有請求記錄 {method,url,body,at:Date.now()}
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, body, at: Date.now() });
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (forceStatus) return send(forceStatus, { error: 'forced' });
    if (req.headers.authorization !== 'Bearer test-token') return send(401, { error: 'WRONGPASS invalid password' });
    if (req.method === 'POST' && req.url === '/pipeline') {
      const cmds = JSON.parse(body); // [["GET","k"],...]
      return send(200, cmds.map(([cmd, key, val]) => {
        if (cmd === 'GET') return { result: kv.has(key) ? kv.get(key) : null };
        if (cmd === 'SET') { kv.set(key, val); return { result: 'OK' }; }
        return { error: 'unsupported' };
      }));
    }
    let m = req.url.match(/^\/set\/([^/?]+)$/);
    if (req.method === 'POST' && m) { kv.set(decodeURIComponent(m[1]), body); return send(200, { result: 'OK' }); }
    m = req.url.match(/^\/get\/([^/?]+)$/);
    if (m) { const k = decodeURIComponent(m[1]); return send(200, { result: kv.has(k) ? kv.get(k) : null }); }
    send(400, { error: 'unsupported' });
  });
});
// server.listen(0) 後以 http://127.0.0.1:{port} 當 UPSTASH_REDIS_REST_URL、
// 'test-token' 當 TOKEN（Node fetch 對 http:// 正常運作）。
```

### 6b. 測試前置
- 先備份 `data/` 整個目錄，跑完還原（`git diff` 確認無殘留）——data 有真實資料。
- 每個 case 之間：`_internal.cache.clear()`、清 `pendingTimers/pendingData`、
  `_internal.setCloudMode(false)`，並 `delete require.cache` 重載 config（切換 env 用）。
- 設 `process.env.LINE_...`／`GROQ_API_KEY` 假值以免 require 鏈上 assertConfig（測試不 require index.js 執行，僅讀原始碼）。

### 6c. 案例對應 PRD 驗收
| AC | 案例 | 判準 |
|---|---|---|
| 1 | **檔案模式回歸**：不設 UPSTASH 兩變數 → `init()` | 立即 resolve（<50ms）；log 含「僅本機檔案」；`save('t.json',[1])` 後檔案存在且內容縮排 2；`load('t.json')` 回 `[1]`；`load('沒有.json')` 回 `[]`；**mock 收到 0 個請求**；load 兩次各自 mutate 互不影響（clone 語意＝現行「每次重新 parse」）；reminder/lang/rateAlert 模組基本讀寫正常 |
| 2 | **開機還原**：mock kv 先放 `lang.json` → 設 env → `init()` | `load('lang.json')` 回該陣列；`data/lang.json` 檔案被寫入且內容等價；log 含「雲端同步（Upstash）」 |
| 3 | **首次啟用反向上傳**：mock kv 空、本機先放 `data/rateAlert.json` → `init()` → 等 3 秒 | mock `seen` 含 `POST /set/rateAlert.json`，body `JSON.parse` 後與檔案內容深比對相等（注意 body 是 compact JSON，比對用 parse 後結構） |
| 4 | **write-behind＋去抖**：雲端模式下 `save('health.json', v1)`；接著 500ms 內連續 save v2、v3 → 等 3 秒 | mock 只收到 **1 個** `/set/health.json`，最終 kv 值 parse 後 ＝ v3；再單獨 save 一次 → 2 秒內（含網路餘裕 3 秒斷言）收到第 2 個 SET。**時間斷言**：save 後立刻檢查 mock（<100ms）應「尚未」收到（證明非同步、去抖生效） |
| 5 | **容錯**：(a) `forceStatus=500` → `init()` 不 throw、log 退檔案模式、之後 save 不打 mock；(b) env 指向沒人聽的 port → `init()` 在 8 秒逾時內 resolve、不 throw；(c) 先正常 init 進雲端模式 → `forceStatus=500` → `save()` 同步立即返回、呼叫端拿到正常回傳、僅 console.error | 全程無未捕捉例外（`process.on('unhandledRejection')` 掛哨兵斷言為 0 次） |
| 6 | **開機順序**：讀 `src/index.js` 原始碼，正則斷言 `await store.init()` 出現在 `app.listen` 之前（`/await store\.init\(\)[\s\S]*app\.listen\(/`）；另直接 `await store.init()`（無 env）量測耗時 <50ms | 兩者皆成立 |
| 7 | `node --check` 全變更檔（store.js、index.js、config.js、services/reminder.js）；逐一 `require` 全部 src/services 模組不炸 | 全 OK |

補充 edge：`morning-state.json`（物件）與 `groupTranslate.json`（物件）走 AC2/AC4 各跑一次，
確認物件型資料經雲端往返後 `getLastSent()`／`isEnabled()` 行為不變；含越南語聲調＋中文＋emoji
的字串經 mock 往返後逐字相等（UTF-8 round-trip）。

---

## 7. 使用者啟用指南（merge 部署後，非技術使用者 click-by-click）

> 不啟用也沒關係，bot 照常運作；但每次更新程式，提醒、語言設定等會被清空。
> 啟用後從那一刻起的資料都會自動備份（之前被清掉的舊資料無法救回）。

**第一步：註冊 Upstash（免費，不用信用卡）**
1. 打開瀏覽器，前往 **https://upstash.com**，點右上角「**Sign In**」（登入）。
2. 點「**Continue with Google**」，選你平常用的 Google 帳號（cmpss88354@gmail.com）即可，不用另外設密碼。

**第二步：建立資料庫**
3. 登入後點綠色的「**Create Database**」按鈕。
4. Name（名稱）輸入：`linebot`。
5. Region（地區）：選 **Oregon（us-west-2）**——跟我們的 Render 伺服器同一區，速度最快；
   如果清單裡沒有 Oregon，選任何 **US West / N. California** 都可以。
6. 其他選項都不用動（免費方案預設就好），點「**Create**」。

**第三步：複製兩串金鑰**
7. 建立後會進到資料庫頁面，往下找到「**REST API**」區塊。
8. 那裡有兩個值，各有複製按鈕（小方塊圖示）：
   - `UPSTASH_REDIS_REST_URL`（一串 https:// 開頭的網址）
   - `UPSTASH_REDIS_REST_TOKEN`（一長串英數字）
   先複製第一個，貼到記事本；再複製第二個，也貼到記事本。**這兩串不要傳給任何人。**

**第四步：貼到 Render**
9. 另開分頁前往 **https://dashboard.render.com**，登入後點你的服務「**linebot**」。
10. 左邊選單點「**Environment**」。
11. 點「**Add Environment Variable**」，Key 填 `UPSTASH_REDIS_REST_URL`，
    Value 貼上剛才第一串網址。
12. 再點一次「**Add Environment Variable**」，Key 填 `UPSTASH_REDIS_REST_TOKEN`，
    Value 貼上第二串。
13. 點「**Save Changes**」。Render 會自動重新部署（等 1〜3 分鐘）。

**第五步：確認成功**
14. 左邊選單點「**Logs**」，等部署完成後，在記錄裡找到這一行就代表成功了：
    `💾 資料儲存：雲端同步（Upstash）`
    如果看到的是「僅本機檔案」，通常是兩串值貼錯或貼反了，回到 Environment 檢查重貼。

---

## 8. 風險與對策

| # | 風險 | 對策／說明 |
|---|---|---|
| 1 | **參考共享語意改變** | load 回傳 clone、save 存 clone（§3a-1/2）＝現行「每次重新 parse」語意。已逐檔稽核（§2）：所有呼叫端都是 load→改→立即 save，含 reminder.js tick 的「重新 load 再套 id」模式，clone 下行為不變 |
| 2 | **快取後外部改檔失效**：雲端模式下若有人直接編輯 `data/*.json`，已進快取的 key 讀不到新內容 | 正式環境只有 store 會寫檔，無此情境；開發/測試時知悉即可（miss 不快取，未載入過的檔仍讀得到）。文件化為已知行為 |
| 3 | **去抖窗內程序被殺，最後一筆寫入沒推上雲**（Render 磁碟隨程序一起消失，檔案救不了） | (a) 去抖僅 2 秒，窗口極小；(b) Render 停止前送 **SIGTERM**，init 成功後註冊 once handler：清全部 timer、`Promise.allSettled` 沖佇列、3 秒上限強制 `process.exit(0)`（§3b）。殘餘風險：SIGKILL/當機正中 2 秒窗 → 掉一筆，家庭場景可接受 |
| 4 | **免費指令額度**：500K/月 vs 我們的排程寫入 | 讀取全走 RAM＝排程零讀取指令；估算最壞 <400 指令/日≈1.2 萬/月（§1c），40 倍餘裕。就算未來加功能翻 10 倍也還有 4 倍 |
| 5 | **token 外洩** | 只存 env；程式不 log token 與完整 URL（錯誤 log 只印 `e.message`／狀態碼／key 名）；.env 已在 .gitignore；指南明示「不要傳給任何人」 |
| 6 | **部署重疊雙寫**：Render 部署瞬間新舊實例可能短暫並存 | last-write-wins，PRD 明訂可接受；窗口數秒且寫入稀疏 |
| 7 | **雲端資料損壞（非法 JSON）** | init 對單一 key parse 失敗只跳過該 key（不覆蓋本機檔、log 警告），其餘照常還原；load 對壞檔照舊回 `[]` |
| 8 | **reminder.js 改走門面的回歸風險** | 改動僅 4 行定義、語意逐字等價（§3c）；AC1/AC7 加 reminder 專屬回歸（add→list→clear、miss 回 `[]`） |
| 9 | **SIGTERM handler 搶走預設終止行為** | 只在雲端模式註冊、`process.once`、必定 `process.exit(0)`＋3 秒 unref 保險；全 repo 目前無其他 SIGTERM handler（已 grep 確認） |
| 10 | **物件型資料 miss 語意**（`morning-state.json`、`groupTranslate.json`） | load miss 仍回 `[]`，兩處呼叫端既有 coerce（§2 表）原樣保留，測試覆蓋 |

// 拍照後「一鍵記帳／設提醒」pending 狀態機：純記憶體，仿 traChoice.js 的 Map 模式。
//
// ⚠️ 注意：這是放在記憶體裡的，伺服器重啟後會清空，也無法在多台機器間共享。
// PRD 已明訂本案可接受（TTL 3 分鐘、每人一筆）——按鈕文字＝真實指令，過期後仍可
// 靠既有文字路由（記帳／提醒我／撤銷記帳）完成，不會真的卡住。
//
// 用途：handleImage 辨識出收據/文件後，記錄一筆 pending；使用者點 Quick Reply
// 按鈕送出「一模一樣的文字」時，handler 用 consumeMatch 命中並完成操作。

const TTL_MS = 3 * 60 * 1000; // 3 分鐘
const pending = new Map(); // key = userId

/**
 * 記錄一筆 pending（覆蓋舊筆，每人一筆）。
 * @param {string} userId
 * @param {object} record 見檔頭三種 record 形狀
 */
function set(userId, record) {
  record.ts = Date.now();
  pending.set(userId, record);
}

/**
 * 讀取該使用者的 pending（含 TTL 惰性過期）。過期或不存在回 undefined。
 * @param {string} userId
 * @returns {object|undefined}
 */
function get(userId) {
  const p = pending.get(userId);
  if (!p) return undefined;
  if (Date.now() - p.ts > TTL_MS) {
    clear(userId);
    return undefined;
  }
  return p;
}

/**
 * 清除該使用者的 pending。
 * @param {string} userId
 */
function clear(userId) {
  pending.delete(userId);
}

/**
 * 判斷這則訊息是否精準命中目前 pending 的按鈕文字；命中即清除（一次性，防連點）。
 * @param {string} userId
 * @param {string} text 使用者這則訊息（呼叫端已 trim）
 * @returns {object|null} 命中的 record，或 null
 */
function consumeMatch(userId, text) {
  const p = get(userId);
  if (!p) return null;
  if (String(text).trim() !== p.tapText) return null;
  clear(userId);
  return p;
}

/**
 * 店名清洗：去數字與換行、壓空白、slice(0,10)、空字串 → '收據'。
 * 去數字防止「7-11」之類的店名被記帳路由的取數 regex 誤抓成金額。
 * @param {string} store
 * @returns {string}
 */
function sanitizeItem(store) {
  const cleaned = String(store || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 10);
  return cleaned || '收據';
}

/**
 * 組出「記帳 <店名> <金額>」按鈕文字（＝真實記帳指令，過期後仍可走文字路由）。
 * @param {string} item
 * @param {number} amount
 * @returns {string}
 */
function buildExpenseTapText(item, amount) {
  return `記帳 ${item} ${amount}`;
}

/**
 * 組出「提醒我 <datetime> <標題>」按鈕文字（＝真實提醒指令）。
 * @param {string} datetime 'YYYY-MM-DD HH:mm'
 * @param {string} title
 * @returns {string}
 */
function buildReminderTapText(datetime, title) {
  return `提醒我 ${datetime} ${title}`;
}

// 台北時間（固定 +08:00）'YYYY-MM-DD' 字串
function taipeiDateStr(ms) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// 台北時間 'YYYY-MM-DD HH:mm' → epoch 毫秒
function taipeiToEpoch(dateStr, hm) {
  const t = Date.parse(`${dateStr}T${hm}:00+08:00`);
  return Number.isNaN(t) ? null : t;
}

// 'YYYY-MM-DD' 加 n 天，回傳新的 'YYYY-MM-DD'（用 UTC 正午避開 DST 邊界問題）
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * 依文件期限計算「該在什麼時候提醒」：期限前一天 09:00；若已過改期限當天 09:00；仍過去 → null。
 * 期限本身要驗證在 [今天-1, 今天+2年] 範圍內，否則視為無效期限（null）。
 * @param {string} deadline 'YYYY-MM-DD'
 * @param {number} [nowMs=Date.now()] 測試可注入現在時間
 * @returns {string|null} 'YYYY-MM-DD HH:mm'，或 null（不可行）
 */
function computeRemindAt(deadline, nowMs = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deadline || ''))) return null;
  const [y, m, d] = deadline.split('-').map(Number);
  // 驗證是真實日期（例如 2026-13-40 要被拒絕）
  const check = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;

  const today = taipeiDateStr(nowMs);
  const minDate = addDays(today, -1);
  const maxDate = addDays(today, 365 * 2 + 1); // +2 年（含閏年寬容 1 天）
  if (deadline < minDate || deadline > maxDate) return null;

  const dayBefore = addDays(deadline, -1);
  const beforeEpoch = taipeiToEpoch(dayBefore, '09:00');
  if (beforeEpoch !== null && beforeEpoch > nowMs) return `${dayBefore} 09:00`;

  const sameDayEpoch = taipeiToEpoch(deadline, '09:00');
  if (sameDayEpoch !== null && sameDayEpoch > nowMs) return `${deadline} 09:00`;

  return null;
}

// ── parseVisionTag：容錯解析 vision 回覆結尾的 ##TAG {json}（DESIGN §2 規格）──

// 本地複製一份「括號配對抓 JSON」技巧（比照 ai.js parseFailedToolCalls，不跨模組 import）。
// 從 start（指向第一個 '{'）開始找配對的 '}'，跳過字串內容與跳脫字元；找不到回 -1。
function matchBraceEnd(text, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < text.length; j++) {
    const ch = text[j];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return j;
  }
  return -1;
}

// 驗證/正規化解析出的 tag 物件；不合法欄位一律落回安全預設值，type 不合法 → 整包 {type:'other'}
function validateTag(obj) {
  if (!obj || typeof obj !== 'object') return { type: 'other' };
  const type = obj.type === 'receipt' || obj.type === 'document' ? obj.type : 'other';
  if (type === 'other') return { type: 'other' };

  const tag = { type };

  // amount：Number、有限、0 < x < 10,000,000，四捨五入到小數 2 位；否則 null
  let amount = null;
  if (typeof obj.amount === 'number' && Number.isFinite(obj.amount) && obj.amount > 0 && obj.amount < 10000000) {
    amount = Math.round(obj.amount * 100) / 100;
  }
  tag.amount = amount;

  if (type === 'receipt') {
    // store：string，trim，slice(0,30)；否則 null
    let store = null;
    if (typeof obj.store === 'string') {
      const s = obj.store.trim().slice(0, 30);
      store = s || null;
    }
    tag.store = store;
  }

  if (type === 'document') {
    // deadline：/^\d{4}-\d{2}-\d{2}$/ ＋真實日期 ＋ [今天-1, +2年] 否則 null
    let deadline = null;
    if (typeof obj.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.deadline)) {
      const [y, m, d] = obj.deadline.split('-').map(Number);
      const check = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      const isReal = check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
      if (isReal) {
        const today = taipeiDateStr(Date.now());
        const minDate = addDays(today, -1);
        const maxDate = addDays(today, 365 * 2 + 1);
        if (obj.deadline >= minDate && obj.deadline <= maxDate) deadline = obj.deadline;
      }
    }
    tag.deadline = deadline;

    // title：去換行、slice(0,40)；否則 null
    let title = null;
    if (typeof obj.title === 'string') {
      const t = obj.title.replace(/[\r\n]+/g, ' ').trim().slice(0, 40);
      title = t || null;
    }
    tag.title = title;
  }

  return tag;
}

// 移除文字中所有含 ##TAG 的行（不分大小寫），並清掉孤兒 fence 行與尾端空白（安全網用）
function stripTagLines(raw) {
  const text = String(raw || '');
  const lines = text.split('\n').filter((line) => !/##TAG/i.test(line));
  return lines
    .join('\n')
    .replace(/^```\s*$/gm, '') // 孤兒 fence 行
    .replace(/\s+$/g, '')
    .trim();
}

/**
 * 解析 vision 回覆結尾的機器標籤（DESIGN §2/容錯規格）。純函式，永不 throw。
 * @param {string} raw ai.vision 的原始回覆
 * @returns {{text:string, tag:object}}
 */
function parseVisionTag(raw) {
  try {
    const text0 = String(raw || '');
    // 1) 找最後一個 ##TAG（不分大小寫，容忍前面有 fence/空白字元）
    const tagRe = /(?:```)?\s*##TAG/gi;
    let match = null;
    let m;
    while ((m = tagRe.exec(text0))) match = m;
    if (!match) return { text: text0.trim(), tag: { type: 'other' } };

    const tagStart = match.index;
    const afterTag = match.index + match[0].length;
    const braceStart = text0.indexOf('{', afterTag);
    if (braceStart === -1) {
      // 沒有 JSON 起點：整段當成無標籤，但仍要清掉這個含 ##TAG 的殘段
      return { text: stripTagLines(text0), tag: { type: 'other' } };
    }
    const braceEnd = matchBraceEnd(text0, braceStart);
    if (braceEnd === -1) {
      // JSON 被截斷：清掉標籤起點之後的內容（並移除任何更早的殘留 ##TAG 行）
      return { text: stripTagLines(text0.slice(0, tagStart)), tag: { type: 'other' } };
    }

    const jsonStr = text0.slice(braceStart, braceEnd + 1);
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return { text: stripTagLines(text0.slice(0, tagStart)), tag: { type: 'other' } };
    }

    const tag = validateTag(parsed);

    // 4) text = raw 移除「標記起至配對 } 止」，再用 stripTagLines 掃掉任何更早的
    //    重複標籤或本文剛好含 "##TAG" 的行（PRD 硬要求：回傳文字永不含 ##TAG）。
    const removed = text0.slice(0, tagStart) + text0.slice(braceEnd + 1);
    const text = stripTagLines(removed.replace(/```\s*$/gm, ''));

    return { text, tag };
  } catch {
    // 5) 任何例外 → 移除所有含 ##TAG 的行，tag 一律 other；標籤絕不外漏、壞掉絕不擋描述
    return { text: stripTagLines(raw), tag: { type: 'other' } };
  }
}

module.exports = {
  set,
  get,
  clear,
  consumeMatch,
  parseVisionTag,
  sanitizeItem,
  buildExpenseTapText,
  buildReminderTapText,
  computeRemindAt,
  TTL_MS,
  _internal: { matchBraceEnd, validateTag, stripTagLines, taipeiDateStr, taipeiToEpoch, addDays },
};

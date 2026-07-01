// 台鐵「相近站名選擇」pending 狀態機：純記憶體，仿 conversation.js 的 Map 模式。
//
// ⚠️ 注意：這是放在記憶體裡的，伺服器重啟後會清空，也無法在多台機器間共享。
// PRD 已明訂本案可接受（TTL 3 分鐘、每人一筆，Render 重啟清空可接受）。
//
// 用途：AI 工具 get_tra_train 偵測到「某一站無法唯一辨識，但有相近候選」時，
// 記錄「已知站 + 日期 + 候選清單」；使用者點選按鈕 / 打站名 / 回數字後，
// handler 用這筆 pending 完成查詢並清除。

const TTL_MS = 3 * 60 * 1000; // 3 分鐘
const pending = new Map(); // key = userId

/**
 * 記錄一筆 pending 選擇狀態（覆蓋舊筆，每人一筆）。
 * @param {string} userId
 * @param {{known:object, ambiguousRole:string, candidates:Array, nextOnly:boolean, day:string}} record
 */
function set(userId, record) {
  record.ts = Date.now();
  record.fresh = true;
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
 * 「本回合剛建立 pending」旗標，一次性消費：第一次呼叫回 true 並把 fresh 設 false，之後回 false。
 * @param {string} userId
 * @returns {boolean}
 */
function consumeFresh(userId) {
  const p = get(userId);
  if (p && p.fresh) {
    p.fresh = false;
    return true;
  }
  return false;
}

// 去除越南語聲調並小寫（Đ/đ → d）；與 traTrain.js 的 toAscii 邏輯一致（避免循環相依，於此複製一份輕量版）
function toAsciiLocal(s) {
  return String(s).toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// 把使用者輸入正規化成中文站名比對用的字串：臺→台、去「(車站|站)」結尾、trim
function normalizeName(text) {
  return String(text || '').trim().replace(/臺/g, '台').replace(/(車站|站)$/, '').trim();
}

/**
 * 判斷這則訊息是否命中目前 pending 的某個候選。
 * 依序：數字 1..N → 精準站名相符 → 候選內寬鬆模糊相符。皆不中回 null。
 * @param {string} userId
 * @param {string} text 使用者這則訊息
 * @returns {{name:string, id:string}|null}
 */
function matchCandidate(userId, text) {
  const p = get(userId);
  if (!p) return null;
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  // 1) 數字回覆 1..N
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    if (n >= 1 && n <= p.candidates.length) return p.candidates[n - 1];
  }

  // 2) 站名精準相符
  const normalized = normalizeName(trimmed);
  for (const c of p.candidates) {
    if (normalizeName(c.name) === normalized) return c;
  }

  // 3) 候選內模糊相符（寬鬆）：toAscii 去空白後相等或互為前綴
  const q = toAsciiLocal(trimmed).replace(/\s+/g, '');
  if (q) {
    for (const c of p.candidates) {
      const cq = toAsciiLocal(c.name).replace(/\s+/g, '');
      if (cq && (cq === q || cq.startsWith(q) || q.startsWith(cq))) return c;
    }
  }

  return null;
}

module.exports = { set, get, clear, consumeFresh, matchCandidate, TTL_MS };

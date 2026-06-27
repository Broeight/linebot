// 簡單的「每位使用者一份對話記憶」儲存。
//
// ⚠️ 注意：這是放在記憶體裡的，伺服器重啟後會清空，也無法在多台機器間共享。
// 正式上線請改用資料庫（Redis、PostgreSQL…）或 LINE 的使用者狀態管理。

const MAX_TURNS = 10; // 保留最近 10 組（使用者+助理）對話
const store = new Map();

function get(userId) {
  return store.get(userId) || [];
}

function append(userId, role, content) {
  const history = get(userId);
  history.push({ role, content });
  // 只保留最近的 N 組，避免越積越多、token 越用越貴
  while (history.length > MAX_TURNS * 2) history.shift();
  store.set(userId, history);
  return history;
}

function reset(userId) {
  store.delete(userId);
}

module.exports = { get, append, reset };

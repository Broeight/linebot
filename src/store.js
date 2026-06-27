// 共用的簡易 JSON 檔案儲存（給生日、早安、健康記錄、記帳等功能用）。
// 全部存在 F:\Linebot\data\ 底下，已被 .gitignore 排除。
//
// ⚠️ 適合家庭小量使用。資料量大或要多機共享時，請改用真正的資料庫。

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function load(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch {
    return [];
  }
}

function save(name, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 2));
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

module.exports = { load, save, taipei, DATA_DIR };

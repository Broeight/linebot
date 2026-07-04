// 家庭群組翻譯橋：偵測中文/越南語並自動互譯，讓不同語言的家人能在同一個群組溝通。
// 開關狀態存 data/groupTranslate.json（key = groupId/roomId），預設開。

const store = require('../store');
const ai = require('../ai');
const lang = require('../lang');

const FILE = 'groupTranslate.json'; // { [groupId]: { enabled: boolean } }

// store.load 對不存在的檔案回傳 []（陣列），這裡需要的是「以 id 為 key 的物件」，
// 所以非物件（含陣列）一律當作空物件處理。
function loadState() {
  const s = store.load(FILE);
  return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
}

/** 該群組是否開啟翻譯（預設開）。 */
function isEnabled(groupId) {
  const s = loadState();
  const g = s[groupId];
  return g ? g.enabled !== false : true;
}

/** 設定該群組的翻譯開關。 */
function setEnabled(groupId, on) {
  const s = loadState();
  s[groupId] = { enabled: !!on };
  store.save(FILE, s);
}

/**
 * 訊息是否「值得翻譯」：去掉 URL／空白後，CJK 或拉丁字母（含越南語擴充字元）
 * 至少要有 2 個才算，避免翻譯純 emoji、標點或單一個字（如「好」「嗯」）。
 * @param {string} text
 * @returns {boolean}
 */
function isSubstantial(text) {
  if (!text) return false;
  const stripped = String(text).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, '');
  const matches = stripped.match(/[一-鿿a-zA-ZÀ-ỹ]/g);
  return !!matches && matches.length >= 2;
}

/**
 * 判斷翻譯方向：'vi'（越南語→翻成中文）｜'zh'（中文→翻成越南語）｜null（其他/無法判斷）。
 * @param {string} text
 * @returns {'vi'|'zh'|null}
 */
function bridgeDirection(text) {
  const code = lang.detect(text); // 既有偵測（越南語特徵字元、CJK…）
  if (code === 'vi') return 'vi';
  if (/[一-鿿]/.test(text)) return 'zh'; // detect 對中文回 zh-TW，這裡直接判斷漢字涵蓋所有情況
  return null;
}

/**
 * 翻譯：只輸出譯文本身。失敗（ai.ask 回空）回 ''，呼叫端需靜默不回覆。
 * @param {'vi'|'zh'} direction 來源語言方向（'vi' = 越南語原文要翻中文；'zh' = 中文原文要翻越南語）
 * @param {string} text
 * @returns {Promise<string>}
 */
async function translateFor(direction, text) {
  const sys = direction === 'vi'
    ? '把使用者訊息翻譯成繁體中文。只輸出譯文本身，不要任何解釋、引號或前綴。'
    : 'Dịch tin nhắn của người dùng sang tiếng Việt. Chỉ xuất bản dịch, không giải thích, không dấu ngoặc kép, không tiền tố.';
  // ai.ask 設計上不丟例外，但這裡再包一層：任何失敗一律回 ''，讓呼叫端靜默——
  // 絕不能讓例外冒到 index.js 把通用錯誤訊息送進群組洗版（tester 抓到的缺口）。
  try {
    return await ai.ask(sys, text);
  } catch (e) {
    console.error('群組翻譯失敗：', e.message);
    return '';
  }
}

module.exports = { isEnabled, setEnabled, bridgeDirection, isSubstantial, translateFor };

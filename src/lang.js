// 個人語言設定：記住每位使用者慣用的語言，用於照片描述、語音前綴、系統訊息。
// 來源優先序：手動設定（鎖定）＞ 文字訊息自動偵測 ＞ LINE 個人檔語言。
const store = require('./store');
const { client } = require('./line');

const FILE = 'lang.json';

// 支援的語言：code → { 顯示名稱, 給 AI 的英文語言名 }
const LANGS = {
  'zh-TW': { name: '繁體中文', ai: 'Traditional Chinese' },
  vi: { name: 'Tiếng Việt', ai: 'Vietnamese' },
  en: { name: 'English', ai: 'English' },
  ja: { name: '日本語', ai: 'Japanese' },
  th: { name: 'ไทย', ai: 'Thai' },
  id: { name: 'Bahasa Indonesia', ai: 'Indonesian' },
};

// 語音前綴（「我聽到你說」）各語言版本
const AUDIO_PREFIX = {
  'zh-TW': '🎙 我聽到你說：',
  vi: '🎙 Tôi nghe bạn nói:',
  en: '🎙 I heard you say:',
  ja: '🎙 こう聞こえました：',
  th: '🎙 ฉันได้ยินว่า:',
  id: '🎙 Saya mendengar:',
};

// 提醒主動推播的前綴（各語言）
const REMINDER_PREFIX = {
  'zh-TW': '⏰ 提醒：',
  vi: '⏰ Nhắc nhở: ',
  en: '⏰ Reminder: ',
  ja: '⏰ リマインダー：',
  th: '⏰ เตือนความจำ: ',
  id: '⏰ Pengingat: ',
};

// 台鐵選站選單提示句（「您是指哪一站？」）各語言版本
const CHOOSE_STATION_PROMPT = {
  'zh-TW': '請問您是指哪一站？請點選下方按鈕，或直接輸入站名。',
  vi: 'Bạn muốn hỏi ga nào? Hãy bấm nút bên dưới hoặc nhập tên ga.',
  en: 'Which station did you mean? Please tap a button below, or type the station name.',
  ja: 'どちらの駅のことですか？下のボタンを押すか、駅名を入力してください。',
  th: 'คุณหมายถึงสถานีไหน? กรุณากดปุ่มด้านล่าง หรือพิมพ์ชื่อสถานี',
  id: 'Stasiun mana yang Anda maksud? Silakan ketuk tombol di bawah, atau ketik nama stasiun.',
};

// 「請分享位置」提示句（加油站引導用）
const SHARE_LOCATION_PROMPT = {
  'zh-TW': '請分享你目前的位置，我幫你找最近的加油站。點下方按鈕，或用聊天室的「＋」→「位置資訊」。',
  vi: 'Hãy chia sẻ vị trí hiện tại của bạn để mình tìm trạm xăng gần nhất. Bấm nút bên dưới, hoặc dùng「+」→「Vị trí」trong khung chat.',
  en: 'Please share your current location so I can find the nearest gas station. Tap the button below, or use "+" → "Location" in the chat.',
  ja: '現在地を共有してください。一番近いガソリンスタンドを探します。下のボタンを押すか、チャットの「＋」→「位置情報」から送れます。',
  th: 'กรุณาแชร์ตำแหน่งปัจจุบันของคุณ ฉันจะหาปั๊มน้ำมันที่ใกล้ที่สุดให้ กดปุ่มด้านล่าง หรือใช้ "+" → "ตำแหน่ง" ในแชท',
  id: 'Silakan bagikan lokasi Anda saat ini agar saya bisa mencari SPBU terdekat. Ketuk tombol di bawah, atau gunakan "+" → "Lokasi" di chat.',
};

// 「傳送位置」按鈕 label（≤20 字，LINE 硬限制）
const SHARE_LOCATION_LABEL = {
  'zh-TW': '📍 傳送位置',
  vi: '📍 Gửi vị trí',
  en: '📍 Send location',
  ja: '📍 位置を送る',
  th: '📍 ส่งตำแหน่ง',
  id: '📍 Kirim lokasi',
};

// 加油站結果標題列
const GAS_STATION_HEADER = {
  'zh-TW': '⛽ 離你最近的加油站：',
  vi: '⛽ Trạm xăng gần bạn nhất:',
  en: '⛽ Nearest gas stations:',
  ja: '⛽ 一番近いガソリンスタンド：',
  th: '⛽ ปั๊มน้ำมันที่ใกล้ที่สุด:',
  id: '⛽ SPBU terdekat:',
};

// 加油站資料取不到
const GAS_STATION_FAIL = {
  'zh-TW': '目前查不到加油站資料，請稍後再試 🙏',
  vi: 'Hiện không tra được dữ liệu trạm xăng, vui lòng thử lại sau 🙏',
  en: 'Cannot fetch gas station data right now, please try again later 🙏',
  ja: '現在ガソリンスタンド情報を取得できません。しばらくしてからもう一度お試しください 🙏',
  th: 'ขณะนี้ไม่สามารถดึงข้อมูลปั๊มน้ำมันได้ กรุณาลองใหม่ภายหลัง 🙏',
  id: 'Saat ini tidak bisa mengambil data SPBU, silakan coba lagi nanti 🙏',
};

// 手動切換語言時的確認訊息（用該語言回）
const CONFIRM = {
  'zh-TW': '✅ 已將你的語言設為繁體中文。',
  vi: '✅ Đã đặt ngôn ngữ thành Tiếng Việt. Từ giờ mình sẽ trả lời và mô tả ảnh bằng Tiếng Việt nhé! 🇻🇳',
  en: '✅ Your language is set to English.',
  ja: '✅ 言語を日本語に設定しました。',
  th: '✅ ตั้งค่าภาษาเป็นภาษาไทยแล้ว',
  id: '✅ Bahasa Anda diatur ke Bahasa Indonesia.',
};

function record(userId) {
  return store.load(FILE).find((r) => r.userId === userId);
}
function write(userId, lang, locked) {
  const list = store.load(FILE).filter((r) => r.userId !== userId);
  list.push({ userId, lang, locked: !!locked });
  store.save(FILE, list);
}

// 從文字粗略偵測語言
function detect(text) {
  if (!text) return null;
  if (/[Ạ-ỹđĐăĂâÂêÊôÔơƠưƯ]/.test(text)) return 'vi'; // 越南語特有字母
  if (/[぀-ヿ]/.test(text)) return 'ja'; // 日文假名
  if (/[฀-๿]/.test(text)) return 'th'; // 泰文
  if (/[一-鿿]/.test(text)) return 'zh-TW'; // 中日韓漢字
  if (/[a-zA-Z]/.test(text)) return 'en';
  return null;
}

// LINE 個人檔語言碼 → 我們的 code
function mapLineLang(code) {
  if (!code) return null;
  const c = code.toLowerCase();
  if (c.startsWith('vi')) return 'vi';
  if (c.startsWith('ja')) return 'ja';
  if (c.startsWith('th')) return 'th';
  if (c.startsWith('id')) return 'id';
  if (c.startsWith('en')) return 'en';
  if (c.startsWith('zh')) return 'zh-TW';
  return null;
}

// 收到文字訊息時呼叫：未鎖定就依偵測結果更新慣用語言
function noteText(userId, text) {
  const r = record(userId);
  if (r && r.locked) return;
  const d = detect(text);
  if (d && (!r || r.lang !== d)) write(userId, d, false);
}

// 取得使用者語言（給輸出用）；沒有就試 LINE 個人檔。回 code 或 null
async function resolve(userId) {
  const r = record(userId);
  if (r) return r.lang;
  try {
    const profile = await client.getProfile(userId);
    const code = mapLineLang(profile.language);
    if (code) {
      write(userId, code, false);
      return code;
    }
  } catch {
    /* 拿不到個人檔就算了 */
  }
  return null;
}

// 把「越南語 / tiếng việt / english…」對應到 code
function nameToCode(s) {
  const t = (s || '').toLowerCase();
  if (/越南|越語|việt|viet|vietnam/.test(t)) return 'vi';
  if (/中文|繁體|華語|chinese|trung/.test(t)) return 'zh-TW';
  if (/英文|英語|english|anh/.test(t)) return 'en';
  if (/日文|日語|japanese|nhật/.test(t)) return 'ja';
  if (/泰文|泰語|thai|thái/.test(t)) return 'th';
  if (/印尼|indonesia/.test(t)) return 'id';
  return null;
}

function setManual(userId, code) {
  write(userId, code, true); // 手動設定 = 鎖定，不再自動更動
}
function confirmText(code) {
  return CONFIRM[code] || CONFIRM['zh-TW'];
}
function optionsText() {
  return (
    '請選擇語言 / Choose your language:\n' +
    '中文、Tiếng Việt、English、日本語、ไทย、Indonesia\n\n' +
    '例如輸入「語言 越南語」或「ngôn ngữ tiếng việt」'
  );
}

// 給看圖工具用的提示語（指定回覆語言）
function visionPrompt(code) {
  const target = (LANGS[code] && LANGS[code].ai) || 'Traditional Chinese';
  return (
    'Look at this image and describe what it shows, concisely. ' +
    'If there is text in the image, read it out; if the text is in a foreign language, also translate it. ' +
    'If it looks like a product, medicine, menu, or plant, give practical info. ' +
    `Respond in ${target}.`
  );
}

function audioPrefix(code) {
  return AUDIO_PREFIX[code] || AUDIO_PREFIX['zh-TW'];
}

function reminderPrefix(code) {
  return REMINDER_PREFIX[code] || REMINDER_PREFIX['zh-TW'];
}

// 台鐵選站選單提示句（「您是指哪一站？」），供 handler 附 quickReply 時使用
function chooseStationPrompt(code) {
  return CHOOSE_STATION_PROMPT[code] || CHOOSE_STATION_PROMPT['zh-TW'];
}

// 加油站「請分享位置」提示句，供 handler 附 quickReply 時使用
function shareLocationPrompt(code) {
  return SHARE_LOCATION_PROMPT[code] || SHARE_LOCATION_PROMPT['zh-TW'];
}

// 「傳送位置」按鈕 label
function shareLocationLabel(code) {
  return SHARE_LOCATION_LABEL[code] || SHARE_LOCATION_LABEL['zh-TW'];
}

// 加油站查詢結果標題列
function gasStationHeader(code) {
  return GAS_STATION_HEADER[code] || GAS_STATION_HEADER['zh-TW'];
}

// 加油站資料取不到的訊息
function gasStationFail(code) {
  return GAS_STATION_FAIL[code] || GAS_STATION_FAIL['zh-TW'];
}

module.exports = {
  noteText,
  resolve,
  nameToCode,
  setManual,
  confirmText,
  optionsText,
  visionPrompt,
  audioPrefix,
  reminderPrefix,
  chooseStationPrompt,
  shareLocationPrompt,
  shareLocationLabel,
  gasStationHeader,
  gasStationFail,
};

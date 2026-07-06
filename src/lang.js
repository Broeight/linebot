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

// 總 catch / 通用錯誤訊息
const GENERIC_ERROR = {
  'zh-TW': '抱歉，發生了一點問題，請稍後再試 🙏',
  vi: 'Xin lỗi, đã xảy ra lỗi. Vui lòng thử lại sau 🙏',
  en: 'Sorry, something went wrong. Please try again later 🙏',
  ja: '申し訳ありません、問題が発生しました。後でもう一度お試しください 🙏',
  th: 'ขออภัย เกิดข้อผิดพลาด กรุณาลองใหม่ภายหลัง 🙏',
  id: 'Maaf, terjadi kesalahan. Silakan coba lagi nanti 🙏',
};

// ai.chat 對話失敗時的 fallback 句
const CHAT_FALLBACK = {
  'zh-TW': '抱歉，我現在無法回覆，請稍後再試。',
  vi: 'Xin lỗi, hiện tại tôi không thể trả lời. Vui lòng thử lại sau.',
  en: "Sorry, I can't reply right now. Please try again later.",
  ja: '申し訳ありません、今は返信できません。後でもう一度お試しください。',
  th: 'ขออภัย ตอนนี้ฉันตอบไม่ได้ กรุณาลองใหม่ภายหลัง',
  id: 'Maaf, saat ini saya tidak bisa membalas. Silakan coba lagi nanti.',
};

// 語音抓取失敗
const AUDIO_FETCH_FAIL = {
  'zh-TW': '抱歉，我拿不到這段語音 🙏',
  vi: 'Xin lỗi, tôi không nhận được đoạn ghi âm này 🙏',
  en: "Sorry, I couldn't get that voice message 🙏",
  ja: 'すみません、この音声を取得できませんでした 🙏',
  th: 'ขออภัย ฉันไม่ได้รับข้อความเสียงนี้ 🙏',
  id: 'Maaf, saya tidak bisa mengambil pesan suara ini 🙏',
};

// 語音聽不清楚
const AUDIO_UNCLEAR = {
  'zh-TW': '我聽不太清楚，可以再說一次、或直接打字給我嗎？',
  vi: 'Tôi nghe không rõ. Bạn có thể nói lại hoặc nhắn chữ cho tôi được không?',
  en: "I couldn't hear that clearly. Could you say it again or type it instead?",
  ja: 'よく聞き取れませんでした。もう一度話すか、文字で送ってもらえますか？',
  th: 'ฉันฟังไม่ค่อยชัด พูดอีกครั้งหรือพิมพ์มาได้ไหม?',
  id: 'Saya kurang jelas mendengarnya. Bisa ulangi atau ketik saja?',
};

// 圖片抓取失敗
const IMAGE_FETCH_FAIL = {
  'zh-TW': '抱歉，我拿不到這張圖片 🙏',
  vi: 'Xin lỗi, tôi không nhận được bức ảnh này 🙏',
  en: "Sorry, I couldn't get that image 🙏",
  ja: 'すみません、この画像を取得できませんでした 🙏',
  th: 'ขออภัย ฉันไม่ได้รับรูปภาพนี้ 🙏',
  id: 'Maaf, saya tidak bisa mengambil gambar ini 🙏',
};

// 圖片看不懂
const IMAGE_UNCLEAR = {
  'zh-TW': '我看不太懂這張圖，換一張清楚一點的試試？',
  vi: 'Tôi không hiểu rõ bức ảnh này. Bạn thử gửi ảnh rõ hơn nhé?',
  en: "I couldn't make out that image. Could you try a clearer one?",
  ja: 'この画像はよく分かりませんでした。もっと鮮明なものを試してみてください。',
  th: 'ฉันดูรูปนี้ไม่ค่อยออก ลองส่งรูปที่ชัดกว่านี้ได้ไหม?',
  id: 'Saya tidak bisa memahami gambar ini. Coba kirim yang lebih jelas?',
};

// ── 農曆／越南節日（F1／F2／F3）─────────────────────────────────────────
// F1：今天農曆（{solar} 由呼叫端代入該語言慣用的國曆格式）
const LUNAR_TODAY = {
  'zh-TW': '📅 今天是 {solarZh}（國曆），農曆{lunarZh}',        // solarZh = 'YYYY/MM/DD'
  vi: '📅 Hôm nay {solarVi} (dương lịch) là {lunarVi} âm lịch', // solarVi = 'DD/MM/YYYY'
  en: '📅 Today {solarIso} is {lunarEn} in the lunar calendar',  // solarIso = 'YYYY-MM-DD'
};
// F1：兩地農曆不同日的註記（罕見；2030 正月會連續一個月觸發）
const LUNAR_DIFF_NOTE = {
  'zh-TW': 'ℹ️ 台灣與越南農曆今天不同日：越南農曆為{other}',
  vi: 'ℹ️ Lưu ý: âm lịch Đài Loan hôm nay là {other} (lệch 1 ngày với âm lịch Việt Nam)',
  en: 'ℹ️ Note: Taiwan and Vietnam lunar dates differ today. The other calendar shows {other}.',
};
// F3：早安農曆行
const MORNING_LUNAR_LINE = {
  'zh-TW': '📅 農曆{lunar}',            // 例：📅 農曆五月廿一
  vi: '📅 Âm lịch: {lunar}',            // 例：📅 Âm lịch: ngày 21 tháng 5
  en: '📅 Lunar: {lunar}',
};
// F3：初一／十五加註（PRD 原句照抄）
const MUNG_RAM_NOTE = {
  'zh-TW': { mung1: '今天是農曆初一（拜拜日）🙏', ram: '今天是農曆十五（拜拜日）🙏' },
  vi: { mung1: 'Hôm nay là mùng 1 âm lịch 🙏', ram: 'Hôm nay là ngày rằm 🙏' },
  en: { mung1: 'Today is the 1st day of the lunar month 🙏', ram: 'Today is the 15th day (full moon) of the lunar month 🙏' },
};
// F2：下一個越南節日＋Tết 倒數（兩段合成一則回覆）
const VN_HOLIDAY_REPLY = {
  'zh-TW': '🇻🇳 下一個越南節日：{name}\n📆 {date}（{away}）\n\n🧧 Tết 倒數：還有 {tetDays} 天到 Tết（{tetDate}，{yearName}年）',
  vi: '🇻🇳 Ngày lễ tiếp theo: {name}\n📆 {date} ({away})\n\n🧧 Còn {tetDays} ngày nữa đến Tết {yearName} ({tetDate})!',
  en: '🇻🇳 Next Vietnamese holiday: {name}\n📆 {date} ({away})\n\n🧧 {tetDays} days until Tet {yearName} ({tetDate})',
};
// {away}：daysAway>0 → zh『還有 N 天』/ vi『còn N ngày』/ en『in N days』；
// daysAway===0 → zh『就是今天！』/ vi『là hôm nay!』/ en『today!』。
const VN_HOLIDAY_AWAY = {
  'zh-TW': { some: (n) => `還有 ${n} 天`, today: '就是今天！' },
  vi: { some: (n) => `còn ${n} ngày`, today: 'là hôm nay!' },
  en: { some: (n) => `in ${n} days`, today: 'today!' },
};
// tetDays===0（今天就是 Tết）→ 整個 Tết 段落改為下列句子
const VN_HOLIDAY_TET_TODAY = {
  'zh-TW': '🧧 今天就是 Tết！新年快樂！',
  vi: '🧧 Hôm nay là Tết! Chúc mừng năm mới!',
  en: '🧧 Today is Tet! Happy New Year!',
};

// ── 功能選單（helpText 從 handler.js 搬過來）───────────────────────────
const HELP_MENU = {
  'zh-TW':
    '👋 你好！我可以幫你：\n\n' +
    '💬 直接聊天、問問題\n' +
    '🎙 傳語音 → 我幫你聽打、回答\n' +
    '📷 傳照片 → 辨識／讀字／翻譯（拍帳單/公文會自動整理重點；拍收據會問要不要記帳）\n' +
    '🌤 天氣：「天氣 台北市」\n' +
    '⏰ 提醒：「提醒我 明天9點 回診」「提醒 每天8點 吃藥」\n' +
    '　　　 看提醒：「提醒清單」｜刪除：「清除提醒」\n' +
    '☀️ 早安推播：「開啟早安 台北市」｜關閉：「關閉早安」\n' +
    '🎂 生日：「生日 媽媽 8/15」｜清單：「生日清單」\n' +
    '🩺 健康：「血壓 120 80」「血糖 95」｜查看：「血壓記錄」\n' +
    '💧 喝水提醒：「開啟喝水提醒」\n' +
    '💰 記帳：「記帳 午餐 120」｜查詢：「本月花費」\n' +
    '🗣 每日中文小老師：「開啟學中文」｜關閉：「關閉學中文」｜看今天：「今天的中文」\n' +
    '💱 匯率：「匯率 台幣 越南盾」「5000 台幣換越南盾」\n' +
    '📅 放假：「今天放假嗎」「下一個連假」「7月假日」\n' +
    '🈷️ 農曆：「農曆」｜越南節日/Tết 倒數：「越南節日」\n' +
    '⛽ 油價：「油價」「95油價」「柴油油價」\n' +
    '⛽ 加油站：「加油站」→ 分享位置找最近的\n' +
    '🚆 台鐵：「台鐵 台北 台中」「下一班 台北到花蓮」\n' +
    '🌐 翻譯：「翻譯 越南語 你吃飯了嗎」\n' +
    '🧾 發票對獎：「對獎 12345678」\n' +
    '🍳 吃什麼：「今天吃什麼」｜食譜：「食譜 番茄炒蛋」\n' +
    '🌍 切換語言：「語言 越南語」（每人可各自設定）\n' +
    '🔄 清除對話：「/reset」',
  vi:
    '👋 Xin chào! Mình có thể giúp bạn:\n\n' +
    '💡 Bạn có thể nói chuyện với tôi bằng tiếng Việt (nhắn chữ hoặc gửi tin nhắn thoại).\n\n' +
    '💬 Trò chuyện, hỏi đáp trực tiếp\n' +
    '🎙 Gửi tin nhắn thoại → mình nghe và trả lời giúp bạn\n' +
    '📷 Gửi ảnh → nhận diện／đọc chữ／dịch (gửi ảnh hoá đơn/giấy tờ sẽ tự tóm tắt hoặc hỏi ghi chi tiêu)\n' +
    '🌤 Thời tiết: gõ 「天氣 台北市」(Thời tiết + tên thành phố)\n' +
    '⏰ Nhắc nhở: 「提醒我 明天9點 回診」「提醒 每天8點 吃藥」\n' +
    '　　　 Xem nhắc nhở: 「提醒清單」｜Xoá: 「清除提醒」\n' +
    '☀️ Bản tin buổi sáng: bật 「開啟早安 台北市」｜tắt: 「關閉早安」\n' +
    '🎂 Sinh nhật: 「生日 媽媽 8/15」｜Danh sách: 「生日清單」\n' +
    '🩺 Sức khoẻ: 「血壓 120 80」「血糖 95」｜Xem lại: 「血壓記錄」\n' +
    '💧 Nhắc uống nước: 「開啟喝水提醒」\n' +
    '💰 Ghi chi tiêu: 「記帳 午餐 120」｜Xem báo cáo: 「本月花費」\n' +
    '🗣 Học tiếng Trung mỗi ngày: bật 「開啟學中文」｜tắt: 「關閉學中文」｜xem hôm nay: 「今天的中文」\n' +
    '💱 Tỷ giá: gõ 「tỷ giá」(mặc định TWD→VND) hoặc 「匯率 台幣 越南盾」「5000 台幣換越南盾」\n' +
    '📅 Ngày nghỉ: 「今天放假嗎」「下一個連假」「7月假日」\n' +
    '🈷️ Âm lịch: gõ 「âm lịch」｜Ngày lễ VN & đếm ngược Tết: 「Tết」hoặc「lễ Việt Nam」\n' +
    '⛽ Giá xăng dầu: gõ 「giá xăng」hoặc「油價」「95油價」「柴油油價」\n' +
    '⛽ Trạm xăng gần nhất: 「加油站」→ chia sẻ vị trí để tìm trạm gần nhất\n' +
    '🚆 Tàu hoả (Đài Loan): 「台鐵 台北 台中」「下一班 台北到花蓮」\n' +
    '🌐 Dịch thuật: 「翻譯 越南語 你吃飯了嗎」\n' +
    '🧾 Đối chiếu hoá đơn trúng thưởng: 「對獎 12345678」\n' +
    '🍳 Hôm nay ăn gì: 「今天吃什麼」｜Công thức nấu ăn: 「食譜 番茄炒蛋」\n' +
    '🌍 Đổi ngôn ngữ: 「語言 越南語」(mỗi người có thể đặt riêng)\n' +
    '🔄 Xoá lịch sử trò chuyện: 「/reset」',
  en:
    "👋 Hi! Here's what I can help with:\n\n" +
    '💬 Just chat or ask me anything\n' +
    '🎙 Send a voice message → I\'ll transcribe and reply\n' +
    '📷 Send a photo → recognition／read text／translate (bills/documents get auto-summarized; receipts offer to log the expense)\n' +
    '🌤 Weather: type 「天氣 台北市」(weather + city name)\n' +
    '⏰ Reminders: 「提醒我 明天9點 回診」「提醒 每天8點 吃藥」\n' +
    '　　　 List: 「提醒清單」｜Clear: 「清除提醒」\n' +
    '☀️ Morning digest: on 「開啟早安 台北市」｜off: 「關閉早安」\n' +
    '🎂 Birthdays: 「生日 媽媽 8/15」｜List: 「生日清單」\n' +
    '🩺 Health log: 「血壓 120 80」「血糖 95」｜History: 「血壓記錄」\n' +
    '💧 Water reminder: 「開啟喝水提醒」\n' +
    '💰 Expenses: 「記帳 午餐 120」｜Summary: 「本月花費」\n' +
    '🗣 Daily Chinese lesson: on 「開啟學中文」｜off: 「關閉學中文」｜today\'s: 「今天的中文」\n' +
    '💱 Exchange rate: 「匯率 台幣 越南盾」「5000 台幣換越南盾」\n' +
    '📅 Holidays: 「今天放假嗎」「下一個連假」「7月假日」\n' +
    '🈷️ Lunar date: 「農曆」or「âm lịch」｜VN holidays & Tet countdown: 「Tết」\n' +
    '⛽ Fuel price: 「油價」「95油價」「柴油油價」\n' +
    '⛽ Nearest gas station: 「加油站」→ share your location\n' +
    '🚆 Taiwan Railway: 「台鐵 台北 台中」「下一班 台北到花蓮」\n' +
    '🌐 Translate: 「翻譯 越南語 你吃飯了嗎」\n' +
    '🧾 Invoice check: 「對獎 12345678」\n' +
    '🍳 What to eat: 「今天吃什麼」｜Recipe: 「食譜 番茄炒蛋」\n' +
    '🌍 Change language: 「語言 越南語」(each person can set their own)\n' +
    '🔄 Clear conversation: 「/reset」',
};

// 台鐵怎麼問（vi 選單「tàu hoả」鍵用；zh 使用者走 traTrain.usage() 不經此表）
const TRA_USAGE = {
  'zh-TW':
    '🚆 台鐵時刻查詢可以這樣問：\n' +
    '・台鐵 台北 台中（近期班次，最多 5 筆）\n' +
    '・下一班 台北到花蓮（只看最近一班）\n' +
    '支援主要幹線車站；僅查今天、當下時間之後的班次。',
  vi:
    '🚆 Tra giờ tàu Đài Loan — bạn có thể hỏi bằng tiếng Việt, ví dụ:\n' +
    '・「tàu từ Tân Trúc đến Trung Lịch」(các chuyến sắp tới hôm nay)\n' +
    '・「tàu từ Tân Trúc đến Trung Lịch ngày mai」\n' +
    '・「chuyến tàu tiếp theo từ Đài Bắc đến Hoa Liên」(chỉ chuyến gần nhất)\n' +
    'Nhắn chữ hoặc gửi tin nhắn thoại đều được nhé! 🎙\n' +
    'Cũng có thể dùng lệnh tiếng Trung: 「台鐵 台北 台中」「下一班 台北到花蓮」.',
  en:
    '🚆 Taiwan Railway timetable — ask like:\n' +
    '・"train from Hsinchu to Zhongli" (upcoming trains today)\n' +
    '・"next train from Taipei to Hualien"\n' +
    'Text or voice both work. Chinese commands also work: 「台鐵 台北 台中」「下一班 台北到花蓮」.',
};

// 「想查哪裡的天氣」引導（vi 選單「thời tiết」鍵用）
const WEATHER_ASK = {
  'zh-TW': '🌤 想查哪裡的天氣呢？請輸入「天氣 城市名」，例如：天氣 台北市',
  vi:
    '🌤 Bạn muốn xem thời tiết ở đâu? Hãy nhắn 「thời tiết + tên thành phố」,\n' +
    'ví dụ: 「thời tiết Đài Bắc」. Nhắn chữ hoặc nói bằng tin nhắn thoại đều được!',
  en: "🌤 Which city's weather? Type \"weather + city\", e.g. \"weather Taipei\".",
};

// 早安推播問候語（隨機取一句；zh-TW 逐字沿用現況）
const MORNING_GREETINGS = {
  'zh-TW': ['早安！新的一天加油 💪', '早安～祝你有美好的一天 ☀️', '早安！記得吃早餐喔 🍳'],
  vi: ['Chào buổi sáng! Chúc bạn một ngày mới tốt lành 💪', 'Chào buổi sáng ~ chúc bạn một ngày tuyệt vời ☀️', 'Chào buổi sáng! Nhớ ăn sáng nhé 🍳'],
  en: ['Good morning! Have a great day 💪', 'Good morning ~ wishing you a wonderful day ☀️', 'Good morning! Don\'t forget breakfast 🍳'],
};
// 早安推播生日行（{names} 由呼叫端代入，已用該語言的連接詞串好）
const BIRTHDAY_LINE = {
  'zh-TW': '🎂 今天是 {names} 的生日，別忘了祝賀！',
  vi: '🎂 Hôm nay là sinh nhật của {names}, đừng quên chúc mừng nhé!',
  en: "🎂 Today is {names}'s birthday — don't forget to celebrate!",
};
// 早安推播開啟確認
const MORNING_ON = {
  'zh-TW': '☀️ 已開啟每日早安推播（每天 {time}），天氣以「{city}」為準。\n關閉請輸入「關閉早安」。',
  vi: '☀️ Đã bật bản tin buổi sáng hằng ngày (lúc {time}), thời tiết theo khu vực "{city}".\nĐể tắt, gõ "tắt tin sáng".',
  en: '☀️ Daily morning digest is ON (at {time}), weather for "{city}".\nTo turn off, type "關閉早安" or "tắt tin sáng".',
};
// 早安推播關閉確認
const MORNING_OFF = {
  'zh-TW': '已關閉每日早安推播。',
  vi: 'Đã tắt bản tin buổi sáng hằng ngày.',
  en: 'Daily morning digest turned off.',
};
// 早安推播關閉（原本就沒開）
const MORNING_OFF_NONE = {
  'zh-TW': '你目前沒有開啟早安推播。',
  vi: 'Bạn chưa bật bản tin buổi sáng.',
  en: "You don't have the morning digest turned on.",
};
// 就醫溝通卡：只打關鍵字沒帶症狀時的引導句
const MEDICAL_ASK = {
  'zh-TW': '請描述你的症狀（例如：頭痛兩天、發燒 38 度、對某藥過敏）',
  vi: 'Hãy mô tả triệu chứng của bạn (ví dụ: đau đầu 2 ngày, sốt 38 độ, dị ứng thuốc...)',
  en: 'Please describe your symptoms (e.g. headache for 2 days, fever 38°C, allergic to a medicine)',
};
// 就醫溝通卡：AI 翻譯失敗時的訊息
const MEDICAL_FAIL = {
  'zh-TW': '暫時無法製作就醫卡，請稍後再試 🙏',
  vi: 'Tạm thời không tạo được thẻ khám bệnh, vui lòng thử lại sau 🙏',
  en: 'Cannot make the medical card right now, please try again later 🙏',
};
// ── 拍照收據記帳／文件助手（imagePending）─────────────────────────────
// 收據確認提示句（{item}/{amount} 由呼叫端代入）
const RECEIPT_CONFIRM_PROMPT = {
  'zh-TW': '🧾 這看起來是一張收據：{item} {amount} 元。\n要記到家庭帳本嗎？點下方按鈕 👇',
  vi: '🧾 Đây có vẻ là một hoá đơn: {item} {amount} Đài tệ.\nBạn muốn ghi vào sổ chi tiêu gia đình không? Bấm nút bên dưới 👇',
  en: '🧾 This looks like a receipt: {item} {amount} NTD.\nAdd it to the family expense book? Tap the button below 👇',
};
// 收據確認按鈕 label（≤20 字，LINE 硬限制；{amount} 由呼叫端代入）
const RECEIPT_CONFIRM_LABEL = {
  'zh-TW': '✅ 記帳 {amount}元',
  vi: '✅ Ghi {amount}đ',
  en: '✅ Add {amount}',
};
// 記帳成功（拍照確認後）：{item}/{amount}/{total} 由呼叫端代入
const EXPENSE_ADDED = {
  'zh-TW': '💰 已記帳：{item} {amount} 元\n本月累計：{total} 元',
  vi: '💰 Đã ghi chi tiêu: {item} {amount} Đài tệ\nTổng tháng này: {total} Đài tệ',
  en: '💰 Added: {item} {amount} NTD\nThis month\'s total: {total} NTD',
};
// 撤銷按鈕 label
const UNDO_LABEL = {
  'zh-TW': '↩️ 撤銷',
  vi: '↩️ Hoàn tác',
  en: '↩️ Undo',
};
// 撤銷成功：{item}/{amount}/{total} 由呼叫端代入
const EXPENSE_UNDONE = {
  'zh-TW': '↩️ 已撤銷：{item} {amount} 元\n本月累計：{total} 元',
  vi: '↩️ Đã hoàn tác: {item} {amount} Đài tệ\nTổng tháng này: {total} Đài tệ',
  en: '↩️ Undone: {item} {amount} NTD\nThis month\'s total: {total} NTD',
};
// 沒有可撤銷的記帳
const EXPENSE_UNDO_NONE = {
  'zh-TW': '目前沒有可撤銷的記帳。',
  vi: 'Hiện không có khoản chi nào để hoàn tác.',
  en: 'Nothing to undo right now.',
};
// 文件助手：設提醒按鈕 label
const DOC_REMINDER_LABEL = {
  'zh-TW': '⏰ 設提醒',
  vi: '⏰ Đặt nhắc nhở',
  en: '⏰ Set reminder',
};
// 文件助手：提醒設定成功（{when}/{msg} 由呼叫端代入）
const DOC_REMINDER_SET = {
  'zh-TW': '✅ 我會在 {when} 提醒你：「{msg}」',
  vi: '✅ Mình sẽ nhắc bạn lúc {when}: "{msg}"',
  en: '✅ I\'ll remind you at {when}: "{msg}"',
};
// 文件助手：提醒設定失敗
const DOC_REMINDER_FAIL = {
  'zh-TW': '抱歉，設定提醒失敗了，請稍後再試 🙏',
  vi: 'Xin lỗi, đặt nhắc nhở không thành công, vui lòng thử lại sau 🙏',
  en: 'Sorry, could not set the reminder. Please try again later 🙏',
};
// 文件助手：抽取失敗時的預設提醒標題
const DOC_DEFAULT_TITLE = {
  'zh-TW': '處理文件',
  vi: 'Xử lý giấy tờ',
  en: 'Handle document',
};

// ── 每日中文小老師（tutor）────────────────────────────────────────────
// 訂閱開啟確認（{time} 由呼叫端代入）
const TUTOR_ON = {
  'zh-TW': '🗣 已開啟每日中文小老師（每天 {time} 推送）。\n關閉請輸入「關閉學中文」。',
  vi: '🗣 Đã bật lớp học tiếng Trung hằng ngày (gửi lúc {time}).\nĐể tắt, gõ "tắt học tiếng Trung".',
  en: '🗣 Daily Chinese lesson is ON (sent at {time}).\nTo turn off, type "關閉學中文" or "tắt học tiếng Trung".',
};
// 退訂確認
const TUTOR_OFF = {
  'zh-TW': '已關閉每日中文小老師。',
  vi: 'Đã tắt lớp học tiếng Trung hằng ngày.',
  en: 'Daily Chinese lesson turned off.',
};
// 退訂（原本就沒開）
const TUTOR_OFF_NONE = {
  'zh-TW': '你目前沒有開啟每日中文小老師。',
  vi: 'Bạn chưa bật lớp học tiếng Trung hằng ngày.',
  en: "You don't have the daily Chinese lesson turned on.",
};
// 生成失敗（今天的中文指令重試仍失敗）
const TUTOR_FAIL = {
  'zh-TW': '暫時沒辦法生成今天的中文課，請稍後再試 🙏',
  vi: 'Tạm thời chưa tạo được bài học tiếng Trung hôm nay, vui lòng thử lại sau 🙏',
  en: "Couldn't generate today's Chinese lesson right now, please try again later 🙏",
};
// 課程結尾提示句（想再看一次）
const TUTOR_REPLAY_HINT = {
  'zh-TW': '💡 想再看一次？輸入「今天的中文」／Muốn xem lại? Gõ "học hôm nay"',
  vi: '💡 Muốn xem lại? Gõ "học hôm nay"／想再看一次？輸入「今天的中文」',
  en: '💡 Want to see it again? Type "học hôm nay" / 「今天的中文」',
};
// 課程標題（{theme} 由呼叫端代入；zh 用中文主題名，vi 用越南語主題名）
const TUTOR_TITLE = {
  'zh-TW': '🗣 今天的中文課 — {themeZh}（{themeVi}）',
  vi: '🗣 Bài học tiếng Trung hôm nay — {themeZh}（{themeVi}）',
  en: "🗣 Today's Chinese lesson — {themeZh} ({themeVi})",
};

// 匯率到價提醒：設定確認（漲到通知，target >= current）
const RATE_ALERT_SET_UP = {
  'zh-TW': '🔔 已設定：1 台幣 ≥ {target} 越南盾時通知你（現在 {current}）',
  vi: '🔔 Đã đặt: sẽ báo khi 1 TWD ≥ {target} VND (hiện tại {current})',
  en: "🔔 Set: you'll be notified when 1 TWD ≥ {target} VND (now {current})",
};
// 匯率到價提醒：設定確認（跌到通知，target < current）
const RATE_ALERT_SET_DOWN = {
  'zh-TW': '🔔 已設定：1 台幣 ≤ {target} 越南盾時通知你（現在 {current}）',
  vi: '🔔 Đã đặt: sẽ báo khi 1 TWD ≤ {target} VND (hiện tại {current})',
  en: "🔔 Set: you'll be notified when 1 TWD ≤ {target} VND (now {current})",
};
// 匯率到價提醒：到價推播
const RATE_ALERT_HIT = {
  'zh-TW': '🔔 到價了！現在 1 台幣 = {rate} 越南盾（目標 {target}）',
  vi: '🔔 Tỷ giá đã đến mức! Hiện tại 1 TWD = {rate} VND (mục tiêu {target})',
  en: '🔔 Rate target hit! Now 1 TWD = {rate} VND (target {target})',
};
// 匯率到價提醒：目前沒有設定
const RATE_ALERT_NONE = {
  'zh-TW': '你目前沒有匯率提醒。設定：「匯率提醒 850」',
  vi: 'Bạn chưa đặt báo tỷ giá. Cách đặt: "báo tỷ giá 850"',
  en: 'You have no rate alert set. To set one: "rate alert 850"',
};
// 匯率到價提醒：查看目前設定（{dir} 由呼叫端代入「漲到」/「跌到」或對應語言的方向詞）
const RATE_ALERT_CURRENT = {
  'zh-TW': '目前設定：1 台幣 {dir} {target} 越南盾時通知（現在 {current}）',
  vi: 'Đang đặt: báo khi 1 TWD {dir} {target} VND (hiện tại {current})',
  en: "Current setting: notify when 1 TWD {dir} {target} VND (now {current})",
};
// 匯率到價提醒：方向詞（給 rateAlertCurrent 用）
const RATE_ALERT_DIR = {
  'zh-TW': { up: '≥', down: '≤' },
  vi: { up: '≥', down: '≤' },
  en: { up: '≥', down: '≤' },
};
// 匯率到價提醒：已清除
const RATE_ALERT_CLEARED = {
  'zh-TW': '已清除匯率提醒。',
  vi: 'Đã xóa báo tỷ giá.',
  en: 'Rate alert cleared.',
};
// 匯率到價提醒：設定失敗（抓不到匯率）
const RATE_ALERT_FAIL = {
  'zh-TW': '目前抓不到匯率，請稍後再設定 🙏',
  vi: 'Hiện không lấy được tỷ giá, vui lòng thử đặt lại sau 🙏',
  en: 'Cannot fetch the exchange rate right now, please try again later 🙏',
};

// 越南語使用者首次歡迎訊息
const WELCOME_VI =
  'Chào bạn! 👋 Mình là trợ lý gia đình.\n' +
  'Bạn có thể nói chuyện với mình bằng tiếng Việt — nhắn chữ hoặc gửi tin nhắn thoại đều được.\n' +
  'Gõ "trợ giúp" để xem tất cả chức năng (giờ tàu, trạm xăng, tỷ giá, thời tiết...).\n' +
  'Bạn cũng có thể bấm menu ở cuối màn hình 👇';

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
  const all = store.load(FILE);
  const prev = all.find((r) => r.userId === userId);
  const list = all.filter((r) => r.userId !== userId);
  list.push({ userId, lang, locked: !!locked, ...(prev && prev.welcomed ? { welcomed: true } : {}) });
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

// 給看圖工具用的提示語（指定回覆語言；單次 vision 呼叫完成描述＋分類＋抽取，
// 結尾附機器可讀的 ##TAG，供 imagePending.parseVisionTag 解析——標籤跨語言穩定，
// 只有 `Respond in ${target}` 隨語言變）
function visionPrompt(code) {
  const target = (LANGS[code] && LANGS[code].ai) || 'Traditional Chinese';
  return (
    'Look at this image and describe what it shows, concisely. If there is text, read it out; ' +
    'if the text is in a foreign language, also translate it. If it looks like a product, ' +
    'medicine, menu, or plant, give practical info. ' +
    `Respond in ${target}.\n\n` +
    'Special cases:\n' +
    '- If it is a DOCUMENT (utility/tax bill, official or government letter, school notice, ' +
    'medicine bag, contract): structure your answer as — what kind of document it is, ' +
    'the key points, what the reader should do, and any deadline or amount due.\n' +
    '- If it is a RECEIPT or store invoice: give a short summary with the store name and the total paid.\n\n' +
    'Finally, AFTER your answer, output exactly one extra line in this exact machine format\n' +
    '(always plain ASCII JSON regardless of the answer language, no code fences):\n' +
    '##TAG {"type":"receipt","store":"<store name or null>","amount":<total number or null>}\n' +
    'or\n' +
    '##TAG {"type":"document","deadline":"YYYY-MM-DD or null","amount":<number or null>,"title":"<action, max 6 words, in the answer language>"}\n' +
    'or\n' +
    '##TAG {"type":"other"}\n' +
    'Tag rules: use "receipt" only for purchase receipts/invoices with a visible total;\n' +
    '"document" for bills, letters, notices, medicine bags; otherwise "other".\n' +
    'amount is the total in New Taiwan Dollars as a plain number. deadline is the payment/reply\n' +
    'due date; convert ROC (民國) years by adding 1911. If unsure about a field, use null.\n' +
    'Never mention this tag in your answer.'
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

// 總 catch / 通用錯誤訊息
function genericError(code) {
  return GENERIC_ERROR[code] || GENERIC_ERROR['zh-TW'];
}

// ai.chat 對話失敗時的 fallback 句
function chatFallback(code) {
  return CHAT_FALLBACK[code] || CHAT_FALLBACK['zh-TW'];
}

// 語音抓取失敗
function audioFetchFail(code) {
  return AUDIO_FETCH_FAIL[code] || AUDIO_FETCH_FAIL['zh-TW'];
}

// 語音聽不清楚
function audioUnclear(code) {
  return AUDIO_UNCLEAR[code] || AUDIO_UNCLEAR['zh-TW'];
}

// 圖片抓取失敗
function imageFetchFail(code) {
  return IMAGE_FETCH_FAIL[code] || IMAGE_FETCH_FAIL['zh-TW'];
}

// 圖片看不懂
function imageUnclear(code) {
  return IMAGE_UNCLEAR[code] || IMAGE_UNCLEAR['zh-TW'];
}

// 功能選單全文；ja/th/id 回落 en，未知碼回落 zh-TW
function helpMenu(code) {
  if (HELP_MENU[code]) return HELP_MENU[code];
  if (code === 'ja' || code === 'th' || code === 'id') return HELP_MENU.en;
  return HELP_MENU['zh-TW'];
}

// 台鐵怎麼問（vi 選單「tàu hoả」鍵用）；ja/th/id 回落 en，未知碼回落 zh-TW
function traUsage(code) {
  if (TRA_USAGE[code]) return TRA_USAGE[code];
  if (code === 'ja' || code === 'th' || code === 'id') return TRA_USAGE.en;
  return TRA_USAGE['zh-TW'];
}

// 「想查哪裡的天氣」引導（vi 選單「thời tiết」鍵用）；ja/th/id 回落 en，未知碼回落 zh-TW
function weatherAsk(code) {
  if (WEATHER_ASK[code]) return WEATHER_ASK[code];
  if (code === 'ja' || code === 'th' || code === 'id') return WEATHER_ASK.en;
  return WEATHER_ASK['zh-TW'];
}

// ── 農曆／越南節日（F1／F2／F3）helper ──────────────────────────────────

// F1：兩地農曆不同日的註記（模板代入 {other}）；ja/th/id 回落 en，未知碼回落 zh-TW
function lunarDiffNote(code, otherText) {
  const tmpl = LUNAR_DIFF_NOTE[code] || (code === 'ja' || code === 'th' || code === 'id' ? LUNAR_DIFF_NOTE.en : LUNAR_DIFF_NOTE['zh-TW']);
  return tmpl.replace('{other}', otherText);
}

// F1：今天農曆回覆（組裝規則見 DESIGN §七）
// data = { today:'YYYY-MM-DD', tw, vn, differs, fmt }（tw/vn 為 lunar.solar2lunar 物件，fmt=lunarSvc.lunarDateText）
function lunarToday(code, data) {
  const { today, tw, vn, differs, fmt } = data;
  const [y, m, d] = today.split('-');
  const solarZh = `${y}/${m}/${d}`;
  const solarVi = `${d}/${m}/${y}`;
  const solarIso = today;

  if (code === 'vi') {
    let text = LUNAR_TODAY.vi.replace('{solarVi}', solarVi).replace('{lunarVi}', fmt(vn, 'vi'));
    if (differs) text += '\n' + lunarDiffNote('vi', fmt(tw, 'vi'));
    return text;
  }

  if (code === 'zh-TW' || !LUNAR_TODAY[code]) {
    let text = LUNAR_TODAY['zh-TW'].replace('{solarZh}', solarZh).replace('{lunarZh}', fmt(tw, 'zh'));
    if (differs) text += '\n' + lunarDiffNote('zh-TW', fmt(vn, 'zh'));
    return text;
  }

  // en/ja/th/id → en 模板 + 台灣農曆（家人在台灣）
  let text = LUNAR_TODAY.en.replace('{solarIso}', solarIso).replace('{lunarEn}', fmt(tw, 'en'));
  if (differs) text += '\n' + lunarDiffNote('en', fmt(vn, 'en'));
  return text;
}

// F3：早安農曆行（模板代入 {lunar}）；ja/th/id 回落 en，未知碼回落 zh-TW
function morningLunarLine(code, lunarText) {
  const tmpl = MORNING_LUNAR_LINE[code] || (code === 'ja' || code === 'th' || code === 'id' ? MORNING_LUNAR_LINE.en : MORNING_LUNAR_LINE['zh-TW']);
  return tmpl.replace('{lunar}', lunarText);
}

// F3：初一／十五加註（kind: 'mung1'|'ram'）；ja/th/id 回落 en，未知碼回落 zh-TW
function mungRamNote(code, kind) {
  const table = MUNG_RAM_NOTE[code] || (code === 'ja' || code === 'th' || code === 'id' ? MUNG_RAM_NOTE.en : MUNG_RAM_NOTE['zh-TW']);
  return table[kind];
}

// F2：下一個越南節日＋Tết 倒數（合成一則回覆）；next = vnHoliday.nextVnHoliday()，tet = vnHoliday.tetCountdown()
function vnHolidayReply(code, next, tet) {
  const tmpl = VN_HOLIDAY_REPLY[code] || (code === 'ja' || code === 'th' || code === 'id' ? VN_HOLIDAY_REPLY.en : VN_HOLIDAY_REPLY['zh-TW']);
  const awayTable = VN_HOLIDAY_AWAY[code] || (code === 'ja' || code === 'th' || code === 'id' ? VN_HOLIDAY_AWAY.en : VN_HOLIDAY_AWAY['zh-TW']);
  const yearName = code === 'zh-TW' ? tet.yearNameZh : tet.yearNameVi;

  const name = next ? (code === 'vi' ? next.vi : code === 'zh-TW' ? next.zh : next.en) : '';
  const away = next ? (next.daysAway <= 0 ? awayTable.today : awayTable.some(next.daysAway)) : '';

  if (tet.days <= 0) {
    // 今天就是 Tết：整段換成祝賀句（DESIGN §七）
    const tetToday = VN_HOLIDAY_TET_TODAY[code] || (code === 'ja' || code === 'th' || code === 'id' ? VN_HOLIDAY_TET_TODAY.en : VN_HOLIDAY_TET_TODAY['zh-TW']);
    if (!next) return tetToday;
    return tmpl
      .replace('{name}', name)
      .replace('{date}', next.date)
      .replace('{away}', away)
      .split('\n\n')[0] + '\n\n' + tetToday;
  }

  if (!next) {
    // 找不到下一個節日（理論上不會發生，防禦性處理）：只回 Tết 段落
    return tmpl
      .replace('{name}', '—')
      .replace('{date}', '—')
      .replace('{away}', '')
      .split('\n\n')[1]
      .replace('{tetDays}', tet.days)
      .replace('{tetDate}', tet.date)
      .replace('{yearName}', yearName);
  }

  return tmpl
    .replace('{name}', name)
    .replace('{date}', next.date)
    .replace('{away}', away)
    .replace('{tetDays}', tet.days)
    .replace('{tetDate}', tet.date)
    .replace('{yearName}', yearName);
}

// 早安推播問候語（隨機取一句）；ja/th/id 回落 en，未知碼回落 zh-TW
function morningGreeting(code) {
  const list = MORNING_GREETINGS[code] || (code === 'ja' || code === 'th' || code === 'id' ? MORNING_GREETINGS.en : MORNING_GREETINGS['zh-TW']);
  return list[Math.floor(Math.random() * list.length)];
}

// 早安推播生日行（模板代入 {names}）；ja/th/id 回落 en，未知碼回落 zh-TW
function birthdayLine(code, namesJoined) {
  const tmpl = BIRTHDAY_LINE[code] || (code === 'ja' || code === 'th' || code === 'id' ? BIRTHDAY_LINE.en : BIRTHDAY_LINE['zh-TW']);
  return tmpl.replace('{names}', namesJoined);
}

// 早安推播開啟確認（模板代入 {time}/{city}）；ja/th/id 回落 en，未知碼回落 zh-TW
function morningOn(code, time, city) {
  const tmpl = MORNING_ON[code] || (code === 'ja' || code === 'th' || code === 'id' ? MORNING_ON.en : MORNING_ON['zh-TW']);
  return tmpl.replace('{time}', time).replace('{city}', city);
}

// 早安推播關閉確認；ja/th/id 回落 en，未知碼回落 zh-TW
function morningOff(code) {
  return MORNING_OFF[code] || (code === 'ja' || code === 'th' || code === 'id' ? MORNING_OFF.en : MORNING_OFF['zh-TW']);
}

// 早安推播關閉（原本就沒開）；ja/th/id 回落 en，未知碼回落 zh-TW
function morningOffNone(code) {
  return MORNING_OFF_NONE[code] || (code === 'ja' || code === 'th' || code === 'id' ? MORNING_OFF_NONE.en : MORNING_OFF_NONE['zh-TW']);
}

// 就醫溝通卡：只打關鍵字沒帶症狀時的引導句；ja/th/id 回落 en，未知碼回落 zh-TW
function medicalAsk(code) {
  if (MEDICAL_ASK[code]) return MEDICAL_ASK[code];
  if (code === 'ja' || code === 'th' || code === 'id') return MEDICAL_ASK.en;
  return MEDICAL_ASK['zh-TW'];
}

// 就醫溝通卡：AI 翻譯失敗訊息；ja/th/id 回落 en，未知碼回落 zh-TW
function medicalFail(code) {
  if (MEDICAL_FAIL[code]) return MEDICAL_FAIL[code];
  if (code === 'ja' || code === 'th' || code === 'id') return MEDICAL_FAIL.en;
  return MEDICAL_FAIL['zh-TW'];
}

// ── 拍照收據記帳／文件助手 getter；ja/th/id 回落 en，未知碼回落 zh-TW ──────

// 收據確認提示句（{item}/{amount} 代入）
function receiptConfirmPrompt(code, item, amount) {
  const tmpl = RECEIPT_CONFIRM_PROMPT[code] || (code === 'ja' || code === 'th' || code === 'id' ? RECEIPT_CONFIRM_PROMPT.en : RECEIPT_CONFIRM_PROMPT['zh-TW']);
  return tmpl.replace('{item}', item).replace('{amount}', fmtNum(amount));
}

// 收據確認按鈕 label（{amount} 代入）
function receiptConfirmLabel(code, amount) {
  const tmpl = RECEIPT_CONFIRM_LABEL[code] || (code === 'ja' || code === 'th' || code === 'id' ? RECEIPT_CONFIRM_LABEL.en : RECEIPT_CONFIRM_LABEL['zh-TW']);
  return tmpl.replace('{amount}', fmtNum(amount));
}

// 記帳成功（{item}/{amount}/{total} 代入）
function expenseAdded(code, item, amount, total) {
  const tmpl = EXPENSE_ADDED[code] || (code === 'ja' || code === 'th' || code === 'id' ? EXPENSE_ADDED.en : EXPENSE_ADDED['zh-TW']);
  return tmpl.replace('{item}', item).replace('{amount}', fmtNum(amount)).replace('{total}', fmtNum(total));
}

// 撤銷按鈕 label
function undoLabel(code) {
  return UNDO_LABEL[code] || (code === 'ja' || code === 'th' || code === 'id' ? UNDO_LABEL.en : UNDO_LABEL['zh-TW']);
}

// 撤銷成功（{item}/{amount}/{total} 代入）
function expenseUndone(code, item, amount, total) {
  const tmpl = EXPENSE_UNDONE[code] || (code === 'ja' || code === 'th' || code === 'id' ? EXPENSE_UNDONE.en : EXPENSE_UNDONE['zh-TW']);
  return tmpl.replace('{item}', item).replace('{amount}', fmtNum(amount)).replace('{total}', fmtNum(total));
}

// 沒有可撤銷的記帳
function expenseUndoNone(code) {
  return EXPENSE_UNDO_NONE[code] || (code === 'ja' || code === 'th' || code === 'id' ? EXPENSE_UNDO_NONE.en : EXPENSE_UNDO_NONE['zh-TW']);
}

// 文件助手：設提醒按鈕 label
function docReminderLabel(code) {
  return DOC_REMINDER_LABEL[code] || (code === 'ja' || code === 'th' || code === 'id' ? DOC_REMINDER_LABEL.en : DOC_REMINDER_LABEL['zh-TW']);
}

// 文件助手：提醒設定成功（{when}/{msg} 代入）
function docReminderSet(code, when, msg) {
  const tmpl = DOC_REMINDER_SET[code] || (code === 'ja' || code === 'th' || code === 'id' ? DOC_REMINDER_SET.en : DOC_REMINDER_SET['zh-TW']);
  return tmpl.replace('{when}', when).replace('{msg}', msg);
}

// 文件助手：提醒設定失敗
function docReminderFail(code) {
  return DOC_REMINDER_FAIL[code] || (code === 'ja' || code === 'th' || code === 'id' ? DOC_REMINDER_FAIL.en : DOC_REMINDER_FAIL['zh-TW']);
}

// 文件助手：抽取失敗時的預設提醒標題
function docDefaultTitle(code) {
  return DOC_DEFAULT_TITLE[code] || (code === 'ja' || code === 'th' || code === 'id' ? DOC_DEFAULT_TITLE.en : DOC_DEFAULT_TITLE['zh-TW']);
}

// ── 每日中文小老師 getter；ja/th/id 回落 en，未知碼回落 zh-TW ──────────

// 訂閱開啟確認（{time} 代入）
function tutorOn(code, time) {
  const tmpl = TUTOR_ON[code] || (code === 'ja' || code === 'th' || code === 'id' ? TUTOR_ON.en : TUTOR_ON['zh-TW']);
  return tmpl.replace('{time}', time);
}

// 退訂確認
function tutorOff(code) {
  return TUTOR_OFF[code] || (code === 'ja' || code === 'th' || code === 'id' ? TUTOR_OFF.en : TUTOR_OFF['zh-TW']);
}

// 退訂（原本就沒開）
function tutorOffNone(code) {
  return TUTOR_OFF_NONE[code] || (code === 'ja' || code === 'th' || code === 'id' ? TUTOR_OFF_NONE.en : TUTOR_OFF_NONE['zh-TW']);
}

// 生成失敗
function tutorFail(code) {
  return TUTOR_FAIL[code] || (code === 'ja' || code === 'th' || code === 'id' ? TUTOR_FAIL.en : TUTOR_FAIL['zh-TW']);
}

// 組裝今天的中文課全文（PRD「課程格式」）：{theme:{zh,vi}}, phrases:[{zh,pinyin,vi}] (恰 3 句)
function tutorLesson(code, theme, phrases) {
  const titleTmpl = TUTOR_TITLE[code] || (code === 'ja' || code === 'th' || code === 'id' ? TUTOR_TITLE.en : TUTOR_TITLE['zh-TW']);
  const title = titleTmpl.replace('{themeZh}', theme.zh).replace('{themeVi}', theme.vi);
  const hint = TUTOR_REPLAY_HINT[code] || (code === 'ja' || code === 'th' || code === 'id' ? TUTOR_REPLAY_HINT.en : TUTOR_REPLAY_HINT['zh-TW']);
  const lines = [title];
  phrases.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.zh}`);
    lines.push(`🔤 ${p.pinyin}`);
    lines.push(`🇻🇳 ${p.vi}`);
  });
  lines.push(hint);
  return lines.join('\n');
}

// 數字格式化：整數就不顯示小數點，否則保留原值（沿用 exchangeRate 的簡單風格）
function fmtNum(n) {
  const num = Number(n);
  if (Number.isNaN(num)) return String(n);
  return Number.isInteger(num) ? String(num) : String(parseFloat(num.toFixed(2)));
}

// 匯率到價提醒：設定確認（dir: 'up'|'down'）；ja/th/id 回落 en，未知碼回落 zh-TW
function rateAlertSet(code, dir, target, current) {
  const table = dir === 'down' ? RATE_ALERT_SET_DOWN : RATE_ALERT_SET_UP;
  const tmpl = table[code] || (code === 'ja' || code === 'th' || code === 'id' ? table.en : table['zh-TW']);
  return tmpl.replace('{target}', fmtNum(target)).replace('{current}', fmtNum(current));
}

// 匯率到價提醒：到價推播；ja/th/id 回落 en，未知碼回落 zh-TW
function rateAlertHit(code, rate, target) {
  const tmpl = RATE_ALERT_HIT[code] || (code === 'ja' || code === 'th' || code === 'id' ? RATE_ALERT_HIT.en : RATE_ALERT_HIT['zh-TW']);
  return tmpl.replace('{rate}', fmtNum(rate)).replace('{target}', fmtNum(target));
}

// 匯率到價提醒：目前沒有設定；ja/th/id 回落 en，未知碼回落 zh-TW
function rateAlertNone(code) {
  if (RATE_ALERT_NONE[code]) return RATE_ALERT_NONE[code];
  if (code === 'ja' || code === 'th' || code === 'id') return RATE_ALERT_NONE.en;
  return RATE_ALERT_NONE['zh-TW'];
}

// 匯率到價提醒：查看目前設定；alert = { direction, target }，current = 現價數字
function rateAlertCurrent(code, alert, current) {
  const tmpl = RATE_ALERT_CURRENT[code] || (code === 'ja' || code === 'th' || code === 'id' ? RATE_ALERT_CURRENT.en : RATE_ALERT_CURRENT['zh-TW']);
  const dirTable = RATE_ALERT_DIR[code] || RATE_ALERT_DIR['zh-TW'];
  const dir = dirTable[alert.direction] || dirTable.up;
  return tmpl
    .replace('{dir}', dir)
    .replace('{target}', fmtNum(alert.target))
    .replace('{current}', current == null ? '?' : fmtNum(current));
}

// 匯率到價提醒：已清除；ja/th/id 回落 en，未知碼回落 zh-TW
function rateAlertCleared(code) {
  if (RATE_ALERT_CLEARED[code]) return RATE_ALERT_CLEARED[code];
  if (code === 'ja' || code === 'th' || code === 'id') return RATE_ALERT_CLEARED.en;
  return RATE_ALERT_CLEARED['zh-TW'];
}

// 匯率到價提醒：設定失敗（抓不到匯率）；ja/th/id 回落 en，未知碼回落 zh-TW
function rateAlertFail(code) {
  if (RATE_ALERT_FAIL[code]) return RATE_ALERT_FAIL[code];
  if (code === 'ja' || code === 'th' || code === 'id') return RATE_ALERT_FAIL.en;
  return RATE_ALERT_FAIL['zh-TW'];
}

// 越南語使用者首次歡迎訊息
function welcomeVi() {
  return WELCOME_VI;
}

// 該使用者是否需要收到 vi 首次歡迎：目前語言為 vi 且尚未標記 welcomed
function needsWelcome(userId) {
  const r = record(userId);
  return !!r && r.lang === 'vi' && !r.welcomed;
}

// 標記該使用者已收到 vi 首次歡迎（存進 lang.json 記錄，避免重複推播）
function markWelcomed(userId) {
  const list = store.load(FILE).filter((r) => r.userId !== userId);
  const prev = store.load(FILE).find((r) => r.userId === userId);
  if (!prev) return; // 沒有語言記錄就不用標記（needsWelcome 本來就會回 false）
  list.push({ ...prev, welcomed: true });
  store.save(FILE, list);
}

module.exports = {
  detect,
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
  genericError,
  chatFallback,
  audioFetchFail,
  audioUnclear,
  imageFetchFail,
  imageUnclear,
  helpMenu,
  traUsage,
  weatherAsk,
  lunarToday,
  lunarDiffNote,
  morningLunarLine,
  mungRamNote,
  vnHolidayReply,
  morningGreeting,
  birthdayLine,
  morningOn,
  morningOff,
  morningOffNone,
  welcomeVi,
  needsWelcome,
  markWelcomed,
  medicalAsk,
  medicalFail,
  rateAlertSet,
  rateAlertHit,
  rateAlertNone,
  rateAlertCurrent,
  rateAlertCleared,
  rateAlertFail,
  receiptConfirmPrompt,
  receiptConfirmLabel,
  expenseAdded,
  undoLabel,
  expenseUndone,
  expenseUndoNone,
  docReminderLabel,
  docReminderSet,
  docReminderFail,
  docDefaultTitle,
  tutorOn,
  tutorOff,
  tutorOffNone,
  tutorFail,
  tutorLesson,
};

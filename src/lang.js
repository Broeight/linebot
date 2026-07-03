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

// ── 功能選單（helpText 從 handler.js 搬過來）───────────────────────────
const HELP_MENU = {
  'zh-TW':
    '👋 你好！我可以幫你：\n\n' +
    '💬 直接聊天、問問題\n' +
    '🎙 傳語音 → 我幫你聽打、回答\n' +
    '📷 傳照片 → 辨識／讀字／翻譯\n' +
    '🌤 天氣：「天氣 台北市」\n' +
    '⏰ 提醒：「提醒我 明天9點 回診」「提醒 每天8點 吃藥」\n' +
    '　　　 看提醒：「提醒清單」｜刪除：「清除提醒」\n' +
    '☀️ 早安推播：「開啟早安 台北市」｜關閉：「關閉早安」\n' +
    '🎂 生日：「生日 媽媽 8/15」｜清單：「生日清單」\n' +
    '🩺 健康：「血壓 120 80」「血糖 95」｜查看：「血壓記錄」\n' +
    '💧 喝水提醒：「開啟喝水提醒」\n' +
    '💰 記帳：「記帳 午餐 120」｜查詢：「本月花費」\n' +
    '💱 匯率：「匯率 台幣 越南盾」「5000 台幣換越南盾」\n' +
    '📅 放假：「今天放假嗎」「下一個連假」「7月假日」\n' +
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
    '📷 Gửi ảnh → nhận diện／đọc chữ／dịch\n' +
    '🌤 Thời tiết: gõ 「天氣 台北市」(Thời tiết + tên thành phố)\n' +
    '⏰ Nhắc nhở: 「提醒我 明天9點 回診」「提醒 每天8點 吃藥」\n' +
    '　　　 Xem nhắc nhở: 「提醒清單」｜Xoá: 「清除提醒」\n' +
    '☀️ Bản tin buổi sáng: bật 「開啟早安 台北市」｜tắt: 「關閉早安」\n' +
    '🎂 Sinh nhật: 「生日 媽媽 8/15」｜Danh sách: 「生日清單」\n' +
    '🩺 Sức khoẻ: 「血壓 120 80」「血糖 95」｜Xem lại: 「血壓記錄」\n' +
    '💧 Nhắc uống nước: 「開啟喝水提醒」\n' +
    '💰 Ghi chi tiêu: 「記帳 午餐 120」｜Xem báo cáo: 「本月花費」\n' +
    '💱 Tỷ giá: gõ 「tỷ giá」(mặc định TWD→VND) hoặc 「匯率 台幣 越南盾」「5000 台幣換越南盾」\n' +
    '📅 Ngày nghỉ: 「今天放假嗎」「下一個連假」「7月假日」\n' +
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
    '📷 Send a photo → recognition／read text／translate\n' +
    '🌤 Weather: type 「天氣 台北市」(weather + city name)\n' +
    '⏰ Reminders: 「提醒我 明天9點 回診」「提醒 每天8點 吃藥」\n' +
    '　　　 List: 「提醒清單」｜Clear: 「清除提醒」\n' +
    '☀️ Morning digest: on 「開啟早安 台北市」｜off: 「關閉早安」\n' +
    '🎂 Birthdays: 「生日 媽媽 8/15」｜List: 「生日清單」\n' +
    '🩺 Health log: 「血壓 120 80」「血糖 95」｜History: 「血壓記錄」\n' +
    '💧 Water reminder: 「開啟喝水提醒」\n' +
    '💰 Expenses: 「記帳 午餐 120」｜Summary: 「本月花費」\n' +
    '💱 Exchange rate: 「匯率 台幣 越南盾」「5000 台幣換越南盾」\n' +
    '📅 Holidays: 「今天放假嗎」「下一個連假」「7月假日」\n' +
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
  morningGreeting,
  birthdayLine,
  morningOn,
  morningOff,
  morningOffNone,
  welcomeVi,
  needsWelcome,
  markWelcomed,
};

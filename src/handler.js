// 訊息路由：先判斷是不是「指令 / 查詢服務」，否則交給 AI 對話。

const conversation = require('./conversation');
const ai = require('./ai');
const lang = require('./lang');
const tools = require('./tools');
const { getContentBuffer } = require('./line');
const { getWeather } = require('./services/weather');
const { translate } = require('./services/translate');
const food = require('./services/food');
const { checkInvoice } = require('./services/invoice');
const reminder = require('./services/reminder');
const birthday = require('./services/birthday');
const morning = require('./services/morning');
const health = require('./services/health');
const expense = require('./services/expense');
const exchangeRate = require('./services/exchangeRate');
const holiday = require('./services/holiday');
const fuelPrice = require('./services/fuelPrice');
const traTrain = require('./services/traTrain');
const traChoice = require('./services/traChoice');
const store = require('./store');

const WATER_TIMES = ['09:00', '11:00', '14:00', '16:00', '19:00', '21:00'];

/**
 * 把候選站名清單組成 LINE Quick Reply 物件（≤5 顆，label/text 皆用中文站名）。
 * @param {Array<{name:string, id:string}>} candidates
 * @returns {{items: Array}}
 */
function buildQuickReply(candidates) {
  return {
    items: candidates.slice(0, 5).map((c) => ({
      type: 'action',
      action: { type: 'message', label: c.name.slice(0, 20), text: c.name },
    })),
  };
}

function helpText() {
  return (
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
    '🚆 台鐵：「台鐵 台北 台中」「下一班 台北到花蓮」\n' +
    '🌐 翻譯：「翻譯 越南語 你吃飯了嗎」\n' +
    '🧾 發票對獎：「對獎 12345678」\n' +
    '🍳 吃什麼：「今天吃什麼」｜食譜：「食譜 番茄炒蛋」\n' +
    '🌍 切換語言：「語言 越南語」（每人可各自設定）\n' +
    '🔄 清除對話：「/reset」'
  );
}

/**
 * 處理一則文字訊息，回傳要回給使用者的字串，或 { text, quickReply } 附選站按鈕。
 * @param {string} userId  LINE 使用者 ID（用來區分各自的對話與提醒）
 * @param {string} text    使用者傳來的文字
 * @returns {Promise<string|{text:string, quickReply:object}>}
 */
async function handleText(userId, text) {
  const trimmed = text.trim();

  // 追蹤這位使用者慣用的語言（用於照片描述、語音前綴等）
  lang.noteText(userId, trimmed);

  // ── 台鐵選站 pending 攔截（在所有指令路由之前）──────────────────
  // 使用者點按鈕 / 打站名 / 回數字，命中就直接完成查詢並清 pending。
  const chosen = traChoice.matchCandidate(userId, trimmed);
  if (chosen) {
    const pendingChoice = traChoice.get(userId);
    if (pendingChoice) {
      const { known, ambiguousRole, nextOnly, day } = pendingChoice;
      const fromId = ambiguousRole === 'from' ? chosen.id : known.id;
      const fromName = ambiguousRole === 'from' ? chosen.name : known.name;
      const toId = ambiguousRole === 'to' ? chosen.id : known.id;
      const toName = ambiguousRole === 'to' ? chosen.name : known.name;
      traChoice.clear(userId);
      return traTrain.getTraTrainByIds({ fromId, toId, fromName, toName, nextOnly, day });
    }
  }

  // ── 基本指令 ─────────────────────────────────────────
  if (trimmed === '/reset' || trimmed === '重置' || trimmed === '清除對話') {
    conversation.reset(userId);
    return '🔄 已清除對話紀錄，我們重新開始吧！';
  }
  if (trimmed === '/help' || trimmed === '說明' || trimmed === 'help' || trimmed === '選單') {
    return helpText();
  }

  // ── 個人語言設定 ─────────────────────────────────────
  const langMatch = trimmed.match(/^(?:語言|語系|language|ngôn ngữ)\s*(.*)$/i);
  if (langMatch) {
    const arg = langMatch[1].trim();
    const code = lang.nameToCode(arg);
    if (!code) return lang.optionsText();
    lang.setManual(userId, code);
    return lang.confirmText(code);
  }

  // ── 提醒 ─────────────────────────────────────────────
  // 注意：先比對「提醒清單 / 清除提醒」，再 fallthrough 到「提醒…」新增
  if (trimmed === '提醒清單' || trimmed === '我的提醒') {
    return reminder.list(userId);
  }
  if (trimmed === '清除提醒' || trimmed === '刪除提醒' || trimmed === '提醒清除') {
    return reminder.clear(userId);
  }
  if (/^提醒/.test(trimmed)) {
    return reminder.add(userId, trimmed);
  }

  // ── 天氣 ─────────────────────────────────────────────
  const weatherMatch = trimmed.match(/^(?:天氣|weather)\s*(.*)$/i);
  if (weatherMatch) {
    return getWeather(weatherMatch[1].trim());
  }

  // ── 翻譯 ─────────────────────────────────────────────
  const translateMatch = trimmed.match(/^(?:翻譯|translate)\s*(.*)$/i);
  if (translateMatch) {
    return translate(translateMatch[1].trim());
  }

  // ── 匯率 ─────────────────────────────────────────────
  // 1) 關鍵字：匯率 / exchange rate（後接幣別，1 或 2 個）
  const rateMatch = trimmed.match(/^(?:匯率|exchange\s*rate)\s+(.+)$/i);
  if (rateMatch) return exchangeRate.lookup(rateMatch[1].trim());

  // 2) 換算 + 內容（可含金額）
  const convMatch = trimmed.match(/^換算\s+(.+)$/);
  if (convMatch) return exchangeRate.lookup(convMatch[1].trim());

  // 3) 「<金額> <幣別> 換 <幣別>」一句話格式
  //    例：5000 台幣換越南盾 / 1,000 TWD 換 VND
  const amtConvMatch = trimmed.match(
    /^[\d,]+\s*(?:台幣|新台幣|越南盾|越幣|美元|美金|日圓|日幣|人民幣|歐元|韓圓|韓幣|TWD|VND|USD|JPY|CNY|EUR|KRW)\s*換\s*.+$/i
  );
  if (amtConvMatch) return exchangeRate.lookup(trimmed);

  // ── 放假 / 連假查詢 ─────────────────────────────────────
  // 1) 今天放假嗎
  if (/^今天放假嗎?$/.test(trimmed)) {
    return holiday.describeDay(store.taipei().date, '今天');
  }
  // 2) 明天放假嗎
  if (/^明天放假嗎?$/.test(trimmed)) {
    return holiday.describeDay(holiday.addDays(store.taipei().date, 1), '明天');
  }
  // 3) 下一個 / 最近 / 下個 連假
  if (/^(?:下一個|最近|下個)連假$/.test(trimmed)) {
    return holiday.nextLongBreak();
  }
  // 4) 最近(的)假日
  if (/^最近(?:的)?假日$/.test(trimmed)) {
    return holiday.nextHoliday();
  }
  // 5) N月假日 / N月有哪些假 / N月放假
  const monthMatch = trimmed.match(/^(\d{1,2})月(?:有哪些假|假日|放假)$/);
  if (monthMatch) {
    return holiday.monthHolidays(parseInt(monthMatch[1], 10));
  }
  // 6) 放假查詢 / 假日查詢 → 子選單說明
  if (/^(?:放假|假日)查詢$/.test(trimmed)) {
    return holiday.usage();
  }

  // ── 油價（台灣中油）─────────────────────────────────────
  // 1) 油價查詢 → 使用說明子選單（先比「查詢」再比其他，避免被後面規則吃掉）
  if (/^油價查詢$/.test(trimmed)) {
    return fuelPrice.usage();
  }
  // 2) 單一油品：92/95/98/柴油… + 可選「無鉛」 + 「油價」
  const fuelOneMatch = trimmed.match(/^(92|95|98|超柴|柴油|超級柴油|九二|九五|九八)無?鉛?\s*油價$/);
  if (fuelOneMatch) {
    return fuelPrice.lookup(fuelOneMatch[1]);
  }
  // 3) 全部四種：油價 / 今天油價 / 本週油價 / 這週油價 / 當週油價
  if (/^(?:油價|今天油價|本週油價|這週油價|當週油價)$/.test(trimmed)) {
    return fuelPrice.lookup();
  }

  // ── 台鐵火車時刻 ─────────────────────────────────────────
  // 1) 台鐵時刻查詢 → 使用說明子選單
  if (/^(?:台鐵|臺鐵|火車)查詢$/.test(trimmed)) {
    return traTrain.usage();
  }
  // 2) 下一班 <起>到<迄> 或 下一班 <起> <迄>
  const nextTrainMatch = trimmed.match(/^下一班\s*(.+)$/);
  if (nextTrainMatch) {
    return traTrain.nextTrain(nextTrainMatch[1].trim());
  }
  // 3) 台鐵/臺鐵/火車 <起> <迄>
  const traMatch = trimmed.match(/^(?:台鐵|臺鐵|火車)\s+(.+)$/);
  if (traMatch) {
    return traTrain.lookup(traMatch[1].trim());
  }

  // ── 發票對獎 ─────────────────────────────────────────
  const invoiceMatch = trimmed.match(/^(?:對獎|發票)\s*(.*)$/);
  if (invoiceMatch) {
    return checkInvoice(invoiceMatch[1].trim());
  }

  // ── 今天吃什麼 / 食譜 ────────────────────────────────
  if (trimmed === '今天吃什麼' || trimmed === '吃什麼') {
    return food.suggest();
  }
  const recipeMatch = trimmed.match(/^食譜\s*(.*)$/);
  if (recipeMatch) {
    return food.recipe(recipeMatch[1].trim());
  }

  // ── 生日 ─────────────────────────────────────────────
  if (trimmed === '生日清單') return birthday.list(userId);
  const bdDel = trimmed.match(/^刪除生日\s*(.+)$/);
  if (bdDel) return birthday.remove(userId, bdDel[1]);
  const bdAdd = trimmed.match(/^生日\s+(.+)$/);
  if (bdAdd) return birthday.add(userId, bdAdd[1]);

  // ── 每日早安推播 ─────────────────────────────────────
  const morningOn = trimmed.match(/^開啟早安\s*(.*)$/);
  if (morningOn) return morning.subscribe(userId, morningOn[1]);
  if (trimmed === '關閉早安') return morning.unsubscribe(userId);

  // ── 健康記錄 ─────────────────────────────────────────
  if (trimmed === '血壓記錄') return health.history(userId, 'bp');
  if (trimmed === '血糖記錄') return health.history(userId, 'glucose');
  const bp = trimmed.match(/^血壓\s+(.+)$/);
  if (bp) return health.recordBP(userId, bp[1]);
  const glu = trimmed.match(/^血糖\s+(.+)$/);
  if (glu) return health.recordGlucose(userId, glu[1]);

  // ── 記帳 ─────────────────────────────────────────────
  if (trimmed === '記帳查詢' || trimmed === '本月花費') return expense.summary(userId);
  const exp = trimmed.match(/^記帳\s+(.+)$/);
  if (exp) return expense.add(userId, exp[1]);

  // ── 喝水提醒 ─────────────────────────────────────────
  if (trimmed === '開啟喝水提醒') {
    reminder.addDailyPreset(userId, WATER_TIMES, '記得喝水 💧', 'water');
    return `💧 已開啟喝水提醒，每天 ${WATER_TIMES.join('、')} 提醒你喝水。\n關閉請輸入「關閉喝水提醒」。`;
  }
  if (trimmed === '關閉喝水提醒') {
    reminder.removeByTag(userId, 'water');
    return '已關閉喝水提醒。';
  }

  // ── 預設：AI 對話（可用工具：自然語句設提醒、記帳、查發票、查天氣）──
  const history = conversation.append(userId, 'user', trimmed);
  const reply = await ai.chat(history, {
    tools: tools.defs,
    runTool: (name, args) => tools.run(userId, name, args),
    systemExtra: tools.timeContext(),
  });
  conversation.append(userId, 'assistant', reply);

  // 本回合剛因歧義建立 pending → 覆寫模型文字，改回選站提示 + quickReply 按鈕
  if (traChoice.consumeFresh(userId)) {
    const p = traChoice.get(userId);
    const code = await lang.resolve(userId);
    return { text: lang.chooseStationPrompt(code), quickReply: buildQuickReply(p.candidates) };
  }

  return reply;
}

/** 處理語音訊息：轉文字後，當作一般訊息處理。回傳字串，或 { text, quickReply }（按鈕原封不動穿透）。 */
async function handleAudio(userId, messageId) {
  let buf;
  try {
    buf = await getContentBuffer(messageId);
  } catch (e) {
    console.error('抓語音失敗：', e.message);
    return '抱歉，我拿不到這段語音 🙏';
  }
  const text = await ai.transcribe(buf);
  if (!text || text.replace(/[\s.。,，、]/g, '').length === 0) {
    return '我聽不太清楚，可以再說一次、或直接打字給我嗎？';
  }
  // handleText 會順便依這段話更新使用者語言，所以先處理再取語言
  const answer = await handleText(userId, text); // 可能是 string 或 {text, quickReply}
  const code = await lang.resolve(userId);
  const prefix = `${lang.audioPrefix(code)}「${text}」\n\n`;
  if (answer && typeof answer === 'object' && answer.quickReply) {
    // 語音前綴只包 text，quickReply 按鈕原封不動穿透（不可因語音前綴而遺失）
    return { text: prefix + answer.text, quickReply: answer.quickReply };
  }
  return prefix + (typeof answer === 'string' ? answer : (answer && answer.text) || '');
}

/** 處理圖片訊息：辨識內容 / 讀字 / 翻譯。 */
async function handleImage(userId, messageId) {
  let buf;
  try {
    buf = await getContentBuffer(messageId);
  } catch (e) {
    console.error('抓圖片失敗：', e.message);
    return '抱歉，我拿不到這張圖片 🙏';
  }
  const code = await lang.resolve(userId);
  const desc = await ai.vision(buf, 'image/jpeg', lang.visionPrompt(code));
  if (!desc) return '我看不太懂這張圖，換一張清楚一點的試試？';
  // 把圖片描述存進對話記憶，讓使用者能接著針對這張圖追問（例如「這藥的作用？」）
  conversation.append(userId, 'user', '（我傳了一張圖片給你看）');
  conversation.append(userId, 'assistant', desc);
  return desc;
}

/**
 * 依訊息類型分派；回傳要回覆的字串、{ text, quickReply }，或 null（不回覆）。
 * @param {object} event
 * @returns {Promise<string|{text:string, quickReply:object}|null>}
 */
async function replyForEvent(event) {
  if (event.type !== 'message') return null;
  const userId = event.source?.userId;
  const msg = event.message;
  if (msg.type === 'text') return handleText(userId, msg.text);
  if (msg.type === 'audio') return handleAudio(userId, msg.id);
  if (msg.type === 'image') return handleImage(userId, msg.id);
  return null; // 貼圖、影片、位置等先略過
}

module.exports = { handleText, handleAudio, handleImage, replyForEvent };

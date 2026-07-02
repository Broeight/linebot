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
const { toAscii } = traTrain;
const traChoice = require('./services/traChoice');
const gasStation = require('./services/gasStation');
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

/**
 * 把「傳送位置」按鈕組成 LINE Quick Reply 物件（恰 1 顆，action.type = 'location'）。
 * @param {string} code 語言代碼
 * @returns {{items: Array}}
 */
function locationQuickReply(code) {
  return {
    items: [
      {
        type: 'action',
        action: { type: 'location', label: lang.shareLocationLabel(code).slice(0, 20) },
      },
    ],
  };
}

/**
 * 處理一則位置訊息：用經緯度找最近加油站，回格式化文字。
 * 不呼叫 conversation.append（隱私：位置與結果都不進對話記憶）。
 * @param {string} userId
 * @param {{latitude:number, longitude:number}} msg
 * @returns {Promise<string>}
 */
async function handleLocation(userId, msg) {
  const { latitude, longitude } = msg;
  const code = await lang.resolve(userId);
  gasStation.noteLocation(userId, latitude, longitude); // 只進記憶體（30 分 TTL）
  const list = await gasStation.findNearest(latitude, longitude);
  if (!list || list.length === 0) return lang.gasStationFail(code);
  return lang.gasStationHeader(code) + '\n\n' + gasStation.formatList(list);
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
      const code = await lang.resolve(userId);
      return traTrain.getTraTrainByIds({ fromId, toId, fromName, toName, nextOnly, day, code });
    }
  }

  // ── 基本指令 ─────────────────────────────────────────
  if (trimmed === '/reset' || trimmed === '重置' || trimmed === '清除對話') {
    conversation.reset(userId);
    return '🔄 已清除對話紀錄，我們重新開始吧！';
  }
  if (/^(?:\/help|說明|help|選單|menu|trợ giúp|giúp đỡ|hướng dẫn)$/i.test(trimmed)) {
    return lang.helpMenu(await lang.resolve(userId));
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

  // ── 加油站（找最近的）───────────────────────────────────
  if (/^(?:最近的?加油站|附近的?加油站|加油站|哪裡加油|找加油站)$/.test(trimmed)) {
    const code = await lang.resolve(userId);
    const loc = gasStation.getLocation(userId);
    if (loc) {
      // 30 分鐘內分享過位置 → 直接查（F6）
      const list = await gasStation.findNearest(loc.lat, loc.lon);
      if (!list || list.length === 0) return lang.gasStationFail(code);
      return lang.gasStationHeader(code) + '\n\n' + gasStation.formatList(list);
    }
    return { text: lang.shareLocationPrompt(code), quickReply: locationQuickReply(code) };
  }

  // ── 越南語關鍵字直達（比對用去聲調小寫，參數用原文；toAscii 不改變字元數/位置）──
  // 注意：trimmed 本身已 trim 過頭尾，這裡不再對 asciiTrimmed 額外 trim，
  // 避免比對用字串與 trimmed 的索引位置錯開。
  const asciiTrimmed = toAscii(trimmed);
  if (/^gia (?:xang|dau)$/.test(asciiTrimmed)) {
    return fuelPrice.lookup();
  }
  if (/^ty gia$/.test(asciiTrimmed)) {
    return exchangeRate.lookup('TWD VND');
  }
  const tyGiaRestMatch = asciiTrimmed.match(/^ty gia\s+(.+)$/);
  if (tyGiaRestMatch) {
    // 用比對結果的位置從「原文」切出參數（toAscii 只轉小寫/去聲調，不改字元數/位置）
    const startIdx = tyGiaRestMatch.index + tyGiaRestMatch[0].length - tyGiaRestMatch[1].length;
    const restOriginal = trimmed.slice(startIdx).trim();
    return exchangeRate.lookup(restOriginal);
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
  const fallbackCode = await lang.resolve(userId);
  const reply = await ai.chat(history, {
    tools: tools.defs,
    runTool: (name, args) => tools.run(userId, name, args),
    systemExtra: tools.timeContext(),
    fallbackText: lang.chatFallback(fallbackCode),
  });
  conversation.append(userId, 'assistant', reply);

  // 本回合剛因歧義建立 pending → 覆寫模型文字，改回選站提示 + quickReply 按鈕
  if (traChoice.consumeFresh(userId)) {
    const p = traChoice.get(userId);
    const code = await lang.resolve(userId);
    return { text: lang.chooseStationPrompt(code), quickReply: buildQuickReply(p.candidates) };
  }

  // 本回合剛因 find_gas_station 建立 pending → 覆寫模型文字（確定性輸出）
  const gasPending = gasStation.consumePending(userId);
  if (gasPending) {
    const code = await lang.resolve(userId);
    if (gasPending.kind === 'ask') {
      return { text: lang.shareLocationPrompt(code), quickReply: locationQuickReply(code) };
    }
    // kind === 'result'：清單由 handler 直接組，URL 不經模型轉抄
    return lang.gasStationHeader(code) + '\n\n' + gasStation.formatList(gasPending.list);
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
    return lang.audioFetchFail(await lang.resolve(userId));
  }
  const text = await ai.transcribe(buf);
  if (!text || text.replace(/[\s.。,，、]/g, '').length === 0) {
    return lang.audioUnclear(await lang.resolve(userId));
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
    return lang.imageFetchFail(await lang.resolve(userId));
  }
  const code = await lang.resolve(userId);
  const desc = await ai.vision(buf, 'image/jpeg', lang.visionPrompt(code));
  if (!desc) return lang.imageUnclear(code);
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
  if (msg.type === 'location') return handleLocation(userId, msg);
  return null; // 貼圖、影片等先略過
}

module.exports = { handleText, handleAudio, handleImage, handleLocation, replyForEvent };

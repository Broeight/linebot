// 訊息路由：先判斷是不是「指令 / 查詢服務」，否則交給 AI 對話。

const conversation = require('./conversation');
const ai = require('./ai');
const lang = require('./lang');
const tools = require('./tools');
const { getContentBuffer, client } = require('./line');
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
const richMenu = require('./services/richMenu');
const medicalCard = require('./services/medicalCard');
const rateAlert = require('./services/rateAlert');
const groupTranslate = require('./services/groupTranslate');
const store = require('./store');
const lunarSvc = require('./services/lunar');
const vnHoliday = require('./services/vnHoliday');
const imagePending = require('./services/imagePending');
const tutor = require('./services/tutor');
const disasterAlert = require('./services/disasterAlert');
const shopping = require('./services/shopping');

const WATER_TIMES = ['09:00', '11:00', '14:00', '16:00', '19:00', '21:00'];

// ── 群組翻譯橋：中越雙語文案（見 DESIGN §4，逐字照抄）─────────────────────
const GROUP_INTRO_TEXT =
  '大家好！我是翻譯小幫手 🌐\n' +
  '我會自動把群組裡的「中文 ↔ 越南語」互相翻譯，方便全家溝通。\n' +
  '輸入「翻譯關」可暫停、「翻譯開」恢復。\n' +
  '---\n' +
  'Xin chào cả nhà! Mình là trợ lý phiên dịch 🌐\n' +
  'Mình sẽ tự động dịch qua lại giữa tiếng Trung ↔ tiếng Việt trong nhóm.\n' +
  'Gõ "tắt dịch" để tạm dừng, "bật dịch" để bật lại.';
const GROUP_OFF_CONFIRM = '已暫停群組翻譯。輸入「翻譯開」恢復。\nĐã tạm dừng dịch. Gõ "bật dịch" để bật lại.';
const GROUP_ON_CONFIRM = '已開啟群組翻譯 🌐\nĐã bật dịch nhóm 🌐';

function groupIntroText() {
  return GROUP_INTRO_TEXT;
}

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
 * 把「按鈕文字＝真實指令」的動作按鈕組成 LINE Quick Reply 物件（label 可與 text 不同，
 * 例如 emoji 前綴的簡短 label 對應完整指令文字；buildQuickReply 強制 label===text 不能重用）。
 * @param {Array<{label:string, text:string}>} items
 * @returns {{items: Array}}
 */
function actionQuickReply(items) {
  return {
    items: items.map((i) => ({
      type: 'action',
      action: { type: 'message', label: i.label.slice(0, 20), text: i.text },
    })),
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

  // Rich menu 語言連動 + 越南語首次歡迎：fire-and-forget，不 await、不加回覆延遲，錯誤全吞
  lang.resolve(userId).then((code) => {
    richMenu.ensureFor(userId, code);
    if (code === 'vi' && lang.needsWelcome(userId)) {
      lang.markWelcomed(userId); // 先標記防重，再推送
      client.pushMessage({ to: userId, messages: [{ type: 'text', text: lang.welcomeVi() }] }).catch(() => {});
    }
  }).catch(() => {});

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

  // ── 拍照收據記帳／文件提醒 pending 攔截（在基本指令之前）───────────
  // 按鈕文字＝真實指令：命中才處理，一次性（防連點）；不命中就 fallthrough 到下方
  // 既有文字路由（記帳/提醒我），過期或連點第二下都能成功執行。
  const act = imagePending.consumeMatch(userId, trimmed);
  if (act) {
    const code = await lang.resolve(userId);
    if (act.kind === 'expense-confirm') {
      const { id, total } = expense.addWithId(userId, act.item, act.amount);
      imagePending.set(userId, { kind: 'expense-undo', id, item: act.item, amount: act.amount, tapText: '撤銷記帳' });
      return {
        text: lang.expenseAdded(code, act.item, act.amount, total),
        quickReply: actionQuickReply([{ label: lang.undoLabel(code), text: '撤銷記帳' }]),
      };
    }
    if (act.kind === 'expense-undo') {
      const r = expense.removeById(userId, act.id);
      return r ? lang.expenseUndone(code, r.item, r.amount, r.total) : lang.expenseUndoNone(code);
    }
    if (act.kind === 'reminder-offer') {
      const r = reminder.addParsed(userId, { type: 'once', datetime: act.datetime, message: act.message });
      return r.ok ? lang.docReminderSet(code, r.when, act.message) : lang.docReminderFail(code);
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
    richMenu.ensureFor(userId, code).catch(() => {});
    return lang.confirmText(code);
  }

  // ── 提醒 ─────────────────────────────────────────────
  // 注意：先比對「提醒清單 / 清除提醒」，再 fallthrough 到「提醒…」新增
  if (trimmed === '提醒清單' || trimmed === '我的提醒') {
    return reminder.list(userId);
  }
  // 帶編號的單筆刪除：必須在精確全刪比對之前。
  // \s* 容忍「刪除提醒3」無空白寫法（長輩常見）；裸字「刪除提醒」因 (.+) 需至少一字
  // 仍不會命中，照舊落到下面的精確比對走全刪。
  const delOneMatch = trimmed.match(/^刪除提醒\s*(.+)$/);
  if (delOneMatch) {
    const arg = delOneMatch[1].trim();
    const n = /^\d+$/.test(arg) ? parseInt(arg, 10) : null; // 非數字 → null → removeByIndex 回錯誤句
    return reminder.removeByIndex(userId, n);
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

  // ── 就醫溝通卡 ───────────────────────────────────────
  // 關鍵字（一對一）：就醫卡 <症狀> / 看病卡 <症狀>；vi：khám bệnh <症狀> / thẻ khám bệnh <症狀>
  // 注意：vi 症狀要從「原文」切片（保留聲調），不可用 toAscii 後的字串（比照 tỷ giá route 的 index 切片法）。
  const medMatch = trimmed.match(/^(?:就醫卡|看病卡)\s*(.*)$/);
  const medAsciiMatch = toAscii(trimmed).match(/^(?:the )?kham benh\s*(.*)$/);
  if (medMatch || medAsciiMatch) {
    const code = await lang.resolve(userId);
    let symptoms = '';
    if (medMatch) {
      symptoms = (medMatch[1] || '').trim();
    } else if (medAsciiMatch && medAsciiMatch[1]) {
      // 用比對結果的位置從「原文」切出參數（toAscii 只轉小寫/去聲調，不改字元數/位置）
      const startIdx = medAsciiMatch.index + medAsciiMatch[0].length - medAsciiMatch[1].length;
      symptoms = trimmed.slice(startIdx).trim();
    }
    if (!symptoms) return lang.medicalAsk(code);
    const card = await medicalCard.makeCard(symptoms);
    return card || lang.medicalFail(code);
  }

  // ── 匯率到價提醒 ─────────────────────────────────────
  const raClear = /^清除匯率提醒$/.test(trimmed) || /^xoa bao ty gia$/.test(toAscii(trimmed));
  if (raClear) {
    const code = await lang.resolve(userId);
    return rateAlert.clear(userId) ? lang.rateAlertCleared(code) : lang.rateAlertNone(code);
  }
  const raSetMatch = trimmed.match(/^匯率提醒\s*([\d.]+)?$/);
  const raAsciiSetMatch = toAscii(trimmed).match(/^bao ty gia\s*([\d.]+)?$/);
  if (raSetMatch || raAsciiSetMatch) {
    const code = await lang.resolve(userId);
    const numStr = (raSetMatch && raSetMatch[1]) || (raAsciiSetMatch && raAsciiSetMatch[1]);
    if (!numStr) {
      const cur = rateAlert.get(userId);
      if (!cur) return lang.rateAlertNone(code);
      const rateResult = await exchangeRate.getRate('TWD', 'VND');
      const current = rateResult && rateResult.ok ? rateResult.rate : null;
      return lang.rateAlertCurrent(code, cur, current);
    }
    const r = await rateAlert.set(userId, Number(numStr));
    return r ? lang.rateAlertSet(code, r.direction, Number(numStr), r.current) : lang.rateAlertFail(code);
  }

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

  // ── 越南語關鍵字直達（比對用去聲調小寫，參數用原文；toAscii 不改變字元數/位置）──
  // 注意：trimmed 本身已 trim 過頭尾，這裡不再對 asciiTrimmed 額外 trim，
  // 避免比對用字串與 trimmed 的索引位置錯開。
  const asciiTrimmed = toAscii(trimmed);

  // ── 加油站（找最近的）───────────────────────────────────
  if (/^(?:最近的?加油站|附近的?加油站|加油站|哪裡加油|找加油站)$/.test(trimmed) || /^tram xang$/.test(asciiTrimmed)) {
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
  if (/^tau hoa$/.test(asciiTrimmed)) {
    return lang.traUsage(await lang.resolve(userId));
  }
  if (/^thoi tiet$/.test(asciiTrimmed)) {
    return lang.weatherAsk(await lang.resolve(userId));
  }

  // ── 農曆日期查詢（F1）───────────────────────────────────
  // zh：農曆 / 今天農曆 / 農曆日期；vi：âm lịch / hôm nay âm lịch / âm lịch hôm nay
  if (/^(?:今天)?農曆(?:日期)?$/.test(trimmed) ||
      /^(?:hom nay )?am lich(?: hom nay)?$/.test(asciiTrimmed)) {
    const code = await lang.resolve(userId);
    const today = store.taipei().date;
    const tw = lunarSvc.lunarFromYmd(today, lunarSvc.TZ_TW);
    const vn = lunarSvc.lunarFromYmd(today, lunarSvc.TZ_VN);
    const differs = tw.day !== vn.day || tw.month !== vn.month || tw.leap !== vn.leap;
    return lang.lunarToday(code, { today, tw, vn, differs, fmt: lunarSvc.lunarDateText });
  }

  // ── 越南節日＋Tết 倒數（F2）─────────────────────────────
  // zh：越南節日 / 越南假日；vi：lễ Việt Nam（→ 'le viet nam'）；Tết（→ 'tet'，⚠️ 全訊息精準比對）
  if (/^(?:越南節日|越南假日)$/.test(trimmed) ||
      /^le viet nam$/.test(asciiTrimmed) ||
      /^tet$/.test(asciiTrimmed)) {
    const code = await lang.resolve(userId);
    const today = store.taipei().date;
    return lang.vnHolidayReply(code, vnHoliday.nextVnHoliday(today), vnHoliday.tetCountdown(today));
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
  if (morningOn) return morning.subscribe(userId, morningOn[1], await lang.resolve(userId));
  if (trimmed === '關閉早安') return morning.unsubscribe(userId, await lang.resolve(userId));
  if (/^bat (?:ban )?tin sang$/.test(asciiTrimmed)) return morning.subscribe(userId, '', await lang.resolve(userId));
  if (/^tat (?:ban )?tin sang$/.test(asciiTrimmed)) return morning.unsubscribe(userId, await lang.resolve(userId));

  // ── 每日中文小老師 ───────────────────────────────────
  if (trimmed === '開啟學中文' || /^hoc tieng trung$/.test(asciiTrimmed)) {
    return tutor.subscribe(userId, await lang.resolve(userId));
  }
  if (trimmed === '關閉學中文' || /^tat hoc tieng trung$/.test(asciiTrimmed)) {
    return tutor.unsubscribe(userId, await lang.resolve(userId));
  }
  if (trimmed === '今天的中文' || /^hoc hom nay$/.test(asciiTrimmed)) {
    const code = await lang.resolve(userId);
    const text = await tutor.lessonText(code);
    return text || lang.tutorFail(code);
  }

  // ── 防災警報推播 ──────────────────────────────────────────
  if (trimmed === '開啟警報' || /^bat canh bao$/.test(asciiTrimmed)) {
    return disasterAlert.subscribe(userId, await lang.resolve(userId));
  }
  if (trimmed === '關閉警報' || /^tat canh bao$/.test(asciiTrimmed)) {
    return disasterAlert.unsubscribe(userId, await lang.resolve(userId));
  }

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

  // ── 撤銷記帳（拍照確認記帳的過期後備；只撤 10 分鐘內自己最新一筆）────
  if (trimmed === '撤銷記帳' || /^hoan tac$/.test(asciiTrimmed)) {
    const code = await lang.resolve(userId);
    const r = expense.removeLast(userId);
    return r ? lang.expenseUndone(code, r.item, r.amount, r.total) : lang.expenseUndoNone(code);
  }

  // ── 喝水提醒 ─────────────────────────────────────────
  if (trimmed === '開啟喝水提醒') {
    reminder.addDailyPreset(userId, WATER_TIMES, '記得喝水 💧', 'water');
    return `💧 已開啟喝水提醒，每天 ${WATER_TIMES.join('、')} 提醒你喝水。\n關閉請輸入「關閉喝水提醒」。`;
  }
  if (trimmed === '關閉喝水提醒') {
    reminder.removeByTag(userId, 'water');
    return '已關閉喝水提醒。';
  }

  // ── 購物清單 ─────────────────────────────────────────
  // 檢視
  if (trimmed === '購物清單' || /^danh sach mua sam$/.test(asciiTrimmed)) {
    const code = await lang.resolve(userId);
    const items = shopping.list();
    return items.length ? lang.shoppingList(code, items) : lang.shoppingEmpty(code);
  }
  // 清空
  if (trimmed === '清空購物清單' || /^xoa danh sach mua sam$/.test(asciiTrimmed)) {
    const code = await lang.resolve(userId);
    return lang.shoppingCleared(code, shopping.clear());
  }
  // 完成刪除：買到 X（原文）／đã mua X（toAscii 比對、參數用原文切片）
  const buyDoneZh = trimmed.match(/^買到\s+(.+)$/);
  const buyDoneVi = asciiTrimmed.match(/^da mua\s+(.+)$/);
  if (buyDoneZh || buyDoneVi) {
    const code = await lang.resolve(userId);
    let item;
    if (buyDoneZh) item = buyDoneZh[1].trim();
    else {
      const s = buyDoneVi.index + buyDoneVi[0].length - buyDoneVi[1].length; // 從原文切片保留聲調
      item = trimmed.slice(s).trim();
    }
    const r = shopping.remove(item);
    return r.ok ? lang.shoppingRemoved(code, r.item, r.total)
                : lang.shoppingNotFound(code, item, shopping.list());
  }
  // 加入：買 X（原文）／mua X（★用「原文 trimmed」比對，非 asciiTrimmed，避免 mùa/mưa 誤判）
  const buyZh = trimmed.match(/^買\s+(.+)$/);
  const buyVi = trimmed.match(/^mua\s+(.+)$/i);
  if (buyZh || buyVi) {
    const code = await lang.resolve(userId);
    const item = (buyZh ? buyZh[1] : buyVi[1]).trim();
    const r = shopping.add(item, userId);
    return r.already ? lang.shoppingAlready(code, r.item)
                     : lang.shoppingAdded(code, r.item, r.total);
  }

  // ── 預設：AI 對話（可用工具：自然語句設提醒、記帳、查發票、查天氣）──
  const history = conversation.append(userId, 'user', trimmed);
  const fallbackCode = await lang.resolve(userId);
  let webSearchCalls = 0; // 每則訊息最多 1 次聯網搜尋（省額度、控延遲）
  const reply = await ai.chat(history, {
    tools: tools.defs,
    runTool: (name, args) => {
      if (name === 'web_search' && ++webSearchCalls > 1) {
        return Promise.resolve(
          'Web search already used for this message; answer with the information you already have.'
        );
      }
      return tools.run(userId, name, args);
    },
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

/**
 * 處理圖片訊息：辨識內容 / 讀字 / 翻譯；文件類附設提醒按鈕、收據類附記帳確認按鈕。
 * 單次 vision 呼叫完成描述＋分類＋抽取（enriched prompt＋結尾 ##TAG 機器標籤）；
 * 標籤解析失敗/缺漏一律當一般照片，與現行行為逐字相同，絕不報錯、標籤絕不外漏。
 */
async function handleImage(userId, messageId) {
  let buf;
  try {
    buf = await getContentBuffer(messageId);
  } catch (e) {
    console.error('抓圖片失敗：', e.message);
    return lang.imageFetchFail(await lang.resolve(userId));
  }
  const code = await lang.resolve(userId);
  const raw = await ai.vision(buf, 'image/jpeg', lang.visionPrompt(code));
  if (!raw) return lang.imageUnclear(code);

  const { text: desc, tag } = imagePending.parseVisionTag(raw);
  // 把「剝除 ##TAG 後」的描述存進對話記憶，讓使用者能接著針對這張圖追問；
  // 隱私：文件內容只進 RAM 對話記憶，##TAG 不進記憶不落地。
  conversation.append(userId, 'user', '（我傳了一張圖片給你看）');
  conversation.append(userId, 'assistant', desc);

  if (tag.type === 'receipt' && tag.amount) {
    const item = imagePending.sanitizeItem(tag.store);
    const tapText = imagePending.buildExpenseTapText(item, tag.amount);
    imagePending.set(userId, { kind: 'expense-confirm', item, amount: tag.amount, tapText });
    return {
      text: desc + '\n\n' + lang.receiptConfirmPrompt(code, item, tag.amount),
      quickReply: actionQuickReply([{ label: lang.receiptConfirmLabel(code, tag.amount), text: tapText }]),
    };
  }

  if (tag.type === 'document' && tag.deadline) {
    const remindAt = imagePending.computeRemindAt(tag.deadline);
    if (remindAt) {
      const title = tag.title || lang.docDefaultTitle(code);
      const tapText = imagePending.buildReminderTapText(remindAt, title);
      imagePending.set(userId, { kind: 'reminder-offer', datetime: remindAt, message: title, tapText });
      return {
        text: desc,
        quickReply: actionQuickReply([{ label: lang.docReminderLabel(code), text: tapText }]),
      };
    }
  }

  return desc;
}

/**
 * 群組/多人聊天室的文字訊息：只做「翻譯橋」與開關指令，不進對話記憶、不觸發
 * 指令或 AI 對話、不碰 richMenu/onboarding hook——群組訊息零副作用。
 * @param {string} groupId
 * @param {string} text
 * @returns {Promise<string|null>}
 */
async function handleGroupText(groupId, text) {
  const trimmed = (text || '').trim();

  // 開關指令（中/越）；越南語用 toAscii 摺疊聲調比對。不受目前開關狀態影響。
  if (/^翻譯關$/.test(trimmed) || /^tat dich$/.test(toAscii(trimmed))) {
    groupTranslate.setEnabled(groupId, false);
    return GROUP_OFF_CONFIRM;
  }
  if (/^翻譯開$/.test(trimmed) || /^bat dich$/.test(toAscii(trimmed))) {
    groupTranslate.setEnabled(groupId, true);
    return GROUP_ON_CONFIRM;
  }

  if (!groupTranslate.isEnabled(groupId)) return null; // 關閉中 → 全部靜默
  if (!groupTranslate.isSubstantial(trimmed)) return null;
  const dir = groupTranslate.bridgeDirection(trimmed);
  if (!dir) return null;
  const translated = await groupTranslate.translateFor(dir, trimmed);
  return translated && translated.trim() ? `🌐 ${translated.trim()}` : null; // 翻譯失敗 → 靜默
}

/**
 * 群組/多人聊天室的語音訊息：Whisper 聽打後同 handleGroupText 判斷翻譯，
 * 回「🎙「原文」\n🌐 譯文」。聽不清楚／非 vi-zh 一律靜默（不回錯誤訊息）。
 * @param {string} groupId
 * @param {string} messageId
 * @returns {Promise<string|null>}
 */
async function handleGroupAudio(groupId, messageId) {
  if (!groupTranslate.isEnabled(groupId)) return null; // 關閉中 → 全部靜默
  let buf;
  try {
    buf = await getContentBuffer(messageId);
  } catch (e) {
    console.error('抓群組語音失敗：', e.message);
    return null; // 群組內靜默，不回錯誤訊息洗版
  }
  const text = await ai.transcribe(buf);
  if (!text || !groupTranslate.isSubstantial(text)) return null;
  const dir = groupTranslate.bridgeDirection(text);
  if (!dir) return null;
  const translated = await groupTranslate.translateFor(dir, text);
  return translated && translated.trim() ? `🎙「${text}」\n🌐 ${translated.trim()}` : null;
}

/**
 * 依訊息類型分派；回傳要回覆的字串、{ text, quickReply }，或 null（不回覆）。
 * @param {object} event
 * @returns {Promise<string|{text:string, quickReply:object}|null>}
 */
async function replyForEvent(event) {
  // bot 被拉進群組/多人聊天室 → 回中越雙語簡介
  if (event.type === 'join') return groupIntroText();
  if (event.type !== 'message') return null;
  const src = event.source || {};
  const isGroup = src.type === 'group' || src.type === 'room';
  const groupId = src.groupId || src.roomId;
  const userId = src.userId;
  const msg = event.message;

  if (isGroup) {
    // 第二層保險：群組處理不管發生什麼錯都靜默（回 null），
    // 避免例外冒到 index.js 把錯誤訊息送進群組洗版。
    if (msg.type === 'text') return handleGroupText(groupId, msg.text).catch(() => null);
    if (msg.type === 'audio') return handleGroupAudio(groupId, msg.id).catch(() => null);
    return null; // 群組內圖片/貼圖等其他型別一律安靜
  }

  // ── 以下為既有一對一分派，行為不變 ─────────────────────────
  if (msg.type === 'text') return handleText(userId, msg.text);
  if (msg.type === 'audio') return handleAudio(userId, msg.id);
  if (msg.type === 'image') return handleImage(userId, msg.id);
  if (msg.type === 'location') return handleLocation(userId, msg);
  return null; // 貼圖、影片等先略過
}

module.exports = {
  handleText,
  handleAudio,
  handleImage,
  handleLocation,
  handleGroupText,
  handleGroupAudio,
  replyForEvent,
};

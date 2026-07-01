// AI 工具：讓聊天 AI 能用「自然語句（任何語言）」實際執行功能。
// 例如越南家人說「nhắc tôi 8h sáng mai uống thuốc」→ AI 呼叫 set_reminder 設提醒。
//
// 工具結果回給模型後，模型會用「對方的語言」做最終確認回覆。
const store = require('./store');
const { getForecastSummary } = require('./services/weather');
const { getExchangeSummary } = require('./services/exchangeRate');
const reminder = require('./services/reminder');
const expense = require('./services/expense');
const { checkInvoice } = require('./services/invoice');
const { getHolidaySummary } = require('./services/holiday');
const { getFuelPriceSummary } = require('./services/fuelPrice');
const { getTraTrainSummary } = require('./services/traTrain');

// 工具定義（給模型看的 schema）
const defs = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查詢某地點目前天氣與未來三天預報（含降雨機率）。使用者問天氣、會不會下雨、冷熱時呼叫。',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: '地點名稱，用中文或英文（例如「新竹市」或「Hsinchu」）。' },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: '幫使用者設定提醒。當使用者要求在某時間提醒某件事（吃藥、回診、繳費等），用任何語言都呼叫此工具。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['once', 'daily'], description: '一次性用 "once"，每天重複用 "daily"' },
          datetime: { type: 'string', description: 'type=once 時：依背景提供的台北現在時間，推算成 "YYYY-MM-DD HH:mm"' },
          daily_time: { type: 'string', description: 'type=daily 時：每天幾點，格式 "HH:mm"' },
          message: { type: 'string', description: '要提醒的事項，用使用者自己的語言' },
        },
        required: ['type', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_reminders',
      description: '列出使用者目前設定的提醒。當他問「我有哪些提醒」時呼叫。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_expense',
      description: '幫使用者記一筆家庭開銷。當他說花了多少錢買什麼時呼叫。',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: '買了什麼，用使用者的語言' },
          amount: { type: 'number', description: '金額（新台幣）' },
        },
        required: ['item', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_invoice',
      description: '對獎：用使用者給的統一發票號碼，比對最新一期中獎號碼。',
      parameters: {
        type: 'object',
        properties: { number: { type: 'string', description: '發票號碼數字' } },
        required: ['number'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_exchange_rate',
      description:
        '查詢兩種貨幣的參考匯率，可選擇換算金額。當使用者用任何語言（尤其越南語）' +
        '詢問匯率、兌換比、或「X 元換多少」時呼叫。幣別用三碼代碼。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '來源幣別代碼，如 "TWD"、"VND"、"USD"。' },
          to:   { type: 'string', description: '目標幣別代碼，如 "VND"、"TWD"。' },
          amount: { type: 'number', description: '（選填）要換算的來源幣別金額。' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_taiwan_holiday',
      description:
        '查詢「台灣（中華民國）」的放假／國定假日／連假／補班資訊。' +
        '當使用者用任何語言（尤其越南語）詢問台灣某天是否放假、下一個連假、最近假日、' +
        '或某月有哪些假時呼叫。僅限台灣假日，不查越南或其他國家。',
      parameters: {
        type: 'object',
        properties: {
          query_type: {
            type: 'string',
            enum: ['is_holiday', 'next_long_break', 'next_holiday', 'month_holidays'],
            description:
              '查詢類型：is_holiday=某特定日是否放假；next_long_break=下一個連假（連續≥3天）；' +
              'next_holiday=最近一個放假日；month_holidays=某月份所有假日清單。',
          },
          date: {
            type: 'string',
            description: 'query_type=is_holiday 時用，格式 "YYYY-MM-DD"；不填預設今天（依背景提供的台北日期）。',
          },
          month: {
            type: 'number',
            description: 'query_type=month_holidays 時用，1–12 的月份數字。',
          },
        },
        required: ['query_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_fuel_price',
      description:
        '查詢台灣中油當週油價牌價。當使用者用任何語言（尤其越南語）詢問台灣油價、' +
        '汽油價格、柴油多少錢時呼叫。',
      parameters: {
        type: 'object',
        properties: {
          product: {
            type: 'string',
            enum: ['UNLEADED_92', 'UNLEADED_95', 'UNLEADED_98', 'SUPER_DIESEL'],
            description:
              '油品代碼；不填則回傳全部四種。' +
              ' xăng 92→UNLEADED_92、xăng 95→UNLEADED_95、xăng 98→UNLEADED_98、' +
              'dầu diesel/dầu DO→SUPER_DIESEL。',
          },
        },
        // product 為選填（PRD §5.3）→ 不放進 required
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_tra_train',
      description:
        '查詢台灣台鐵（TRA）某起站到迄站的火車班次時刻（今天或明天）。'
        + '當使用者用任何語言（尤其越南語）詢問台鐵/火車從某站到某站的班次、'
        + '下一班車幾點時呼叫。僅限台鐵。',
      parameters: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description:
              '起站站名，直接用使用者原本說的原文（中文、英文或越南語皆可，例如越南語直接傳' +
              ' Tân Trúc、Trung Lịch）。絕對不要自己把它音譯或翻譯成漢字，以免猜錯；' +
              '系統會自動辨識中／英／越南語站名。',
          },
          to: { type: 'string', description: '迄站站名，規則同 from（用原文、勿自行音譯）。' },
          next_only: { type: 'boolean', description: '使用者問「下一班/最近一班」設 true（只回 1 筆）；問「班次/有哪些車」設 false 或不填。' },
          day: { type: 'string', enum: ['today', 'tomorrow'], description: '查今天或明天；使用者說「明天/ngày mai」設 tomorrow，否則不填（預設今天）。' },
        },
        required: ['from', 'to'],
      },
    },
  },
];

// 提供給模型的背景資訊（目前時間 + 使用工具的指示）
function timeContext() {
  const t = store.taipei();
  return (
    `背景：現在台北時間是 ${t.date} ${t.hm}。` +
    '若使用者用任何語言（含越南語）要求設提醒、記帳、對獎、查天氣、查匯率、查台灣放假/連假、查台灣油價（汽油／柴油）或查台鐵火車時刻，就呼叫對應工具完成，再用對方的語言確認；其他問題正常用知識回答即可。' +
    '若使用者用任何語言詢問台灣油價、汽油、柴油，就呼叫 get_fuel_price 工具。' +
    '若使用者用任何語言（含越南語）詢問台鐵/火車從某站到某站的班次、下一班車，' +
      '就呼叫 get_tra_train 工具，站名直接傳使用者原本說的原文（中／英／越南語都可，' +
      '例如越南語直接傳 Tân Trúc、Trung Lịch），不要自己音譯成漢字。'
  );
}

// 執行某個工具，回傳給模型的文字結果
async function run(userId, name, argsJson) {
  let a = {};
  try {
    a = JSON.parse(argsJson || '{}');
  } catch {
    /* 參數解析失敗就用空物件 */
  }
  try {
    switch (name) {
      case 'get_weather':
        return (await getForecastSummary(a.location)) || `No weather data for "${a.location}".`;
      case 'set_reminder': {
        const r = reminder.addParsed(userId, {
          type: a.type,
          datetime: a.datetime,
          dailyTime: a.daily_time,
          message: a.message,
        });
        return r.ok
          ? `Reminder saved (${r.when}): ${a.message}`
          : 'Could not understand the time — ask the user to clarify.';
      }
      case 'list_reminders':
        return reminder.list(userId);
      case 'add_expense': {
        const total = expense.addItem(userId, a.item, a.amount);
        return `Expense logged: ${a.item} NT$${a.amount}. This month total: NT$${total}.`;
      }
      case 'check_invoice':
        return await checkInvoice(a.number);
      case 'get_exchange_rate':
        return (
          (await getExchangeSummary(a.from, a.to, a.amount)) ||
          `Cannot fetch exchange rate for ${a.from} to ${a.to} right now.`
        );
      case 'get_taiwan_holiday':
        return (
          (await getHolidaySummary({
            queryType: a.query_type,
            date: a.date,
            month: a.month,
          })) || 'Cannot fetch Taiwan holiday data right now.'
        );
      case 'get_fuel_price':
        return (
          (await getFuelPriceSummary(a.product)) ||
          'Cannot fetch Taiwan CPC fuel price right now.'
        );
      case 'get_tra_train':
        return (
          (await getTraTrainSummary({
            from: a.from,
            to: a.to,
            nextOnly: a.next_only === true,
            day: a.day === 'tomorrow' ? 'tomorrow' : 'today',
          })) || 'Cannot fetch Taiwan railway (TRA) timetable right now.'
        );
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (e) {
    return 'Tool failed: ' + e.message;
  }
}

module.exports = { defs, timeContext, run };

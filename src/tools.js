// AI 工具：讓聊天 AI 能用「自然語句（任何語言）」實際執行功能。
// 例如越南家人說「nhắc tôi 8h sáng mai uống thuốc」→ AI 呼叫 set_reminder 設提醒。
//
// 工具結果回給模型後，模型會用「對方的語言」做最終確認回覆。
const store = require('./store');
const { getForecastSummary } = require('./services/weather');
const reminder = require('./services/reminder');
const expense = require('./services/expense');
const { checkInvoice } = require('./services/invoice');

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
];

// 提供給模型的背景資訊（目前時間 + 使用工具的指示）
function timeContext() {
  const t = store.taipei();
  return (
    `背景：現在台北時間是 ${t.date} ${t.hm}。` +
    '若使用者用任何語言（含越南語）要求設提醒、記帳、對獎或查天氣，就呼叫對應工具完成，再用對方的語言確認；其他問題正常用知識回答即可。'
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
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (e) {
    return 'Tool failed: ' + e.message;
  }
}

module.exports = { defs, timeContext, run };

const express = require('express');
const { config, assertConfig } = require('./config');

assertConfig();

const { line, client: lineClient } = require('./line');
const handler = require('./handler');
const lang = require('./lang');
const store = require('./store');
const reminder = require('./services/reminder');
const morning = require('./services/morning');
const rateAlert = require('./services/rateAlert');
const richMenu = require('./services/richMenu');

const app = express();

// 健康檢查（部署平台常用來確認服務存活）
app.get('/', (req, res) => res.send('LINE bot is running. ✅'));

// LINE Webhook
// 注意：line.middleware 需要「原始 request body」來驗證簽章，
// 所以不要在這個路由前面加 express.json()。
app.post('/webhook', line.middleware({ channelSecret: config.line.channelSecret }), (req, res) => {
  // 先回 200 給 LINE，避免 webhook 逾時；之後再非同步處理與回覆。
  res.status(200).end();
  const events = req.body.events || [];
  Promise.all(events.map(handleEvent)).catch((err) =>
    console.error('處理事件時發生錯誤：', err)
  );
});

// 簽章驗證失敗（例如有人直接打 /webhook 而非透過 LINE）時，
// line.middleware 會丟錯。在這裡攔下來，回乾淨的 401 而不是 500。
app.use((err, req, res, next) => {
  if (err instanceof line.SignatureValidationFailed) {
    return res.status(401).send('Invalid signature');
  }
  if (err instanceof line.JSONParseError) {
    return res.status(400).send('Invalid body');
  }
  console.error(err);
  res.status(500).end();
});

async function handleEvent(event) {
  try {
    const reply = await handler.replyForEvent(event);
    // 正規化成 { text, quickReply? }：字串走舊路，物件則拆出 text 與 quickReply
    if (!reply) return;
    const text = typeof reply === 'string' ? reply : reply.text;
    const quickReply = typeof reply === 'string' ? undefined : reply.quickReply;
    // 空字串/純空白不送（LINE 會回 400 拒絕）；也涵蓋不需回覆的事件（貼圖、影片…）
    if (!text || !text.trim()) return;
    // 用 Array.from 截斷，避免剛好切在 emoji（代理對）中間變亂碼
    const clipped = Array.from(text).slice(0, 5000).join('');
    const message = { type: 'text', text: clipped };
    if (quickReply) message.quickReply = quickReply;
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [message],
    });
  } catch (err) {
    console.error('回覆訊息失敗：', err);
    // 盡力依使用者語言回錯誤訊息；解析失敗就用中文（reply token 只能用一次，失敗就放棄）
    let errText = '抱歉，發生了一點問題，請稍後再試 🙏';
    try {
      const userId = event.source?.userId;
      errText = lang.genericError(userId ? await lang.resolve(userId) : null);
    } catch {
      /* 語言解析失敗就用預設中文句 */
    }
    try {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: errText }],
      });
    } catch (e) {
      console.error('連錯誤訊息都送不出去：', e);
    }
  }
}

// 先從雲端還原資料（未設定雲端時 init 立即完成），完成後才開始收 webhook。
// store.init() 設計上絕不 throw；try/catch 是最後保險——任何意外都不能讓 bot 起不來。
(async () => {
  try {
    await store.init();
  } catch (e) {
    console.error('store.init 意外失敗（退回檔案模式繼續啟動）：', e);
  }
  app.listen(config.port, () => {
    console.log(`🚀 LINE bot 已啟動，監聽埠號 ${config.port}`);
    console.log(`   Webhook 路徑： POST /webhook`);
    reminder.start(); // 啟動提醒排程
    morning.start(); // 啟動每日早安推播排程
    rateAlert.start(); // 啟動匯率到價提醒排程
    richMenu.ensureSetup().catch((e) => console.error('richmenu setup 失敗：', e));
  });
})();

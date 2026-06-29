# LINE Bot（AI 對話 + 查詢服務）

一個用 **Node.js** 寫的 LINE 聊天機器人，功能包含：

- 💬 **AI 對話** — 串接 Groq（免費），每位使用者有獨立對話記憶
- 🎙 **語音訊息** — 傳語音，自動聽打＋回答（Groq Whisper）
- 📷 **看照片** — 傳圖片，辨識／讀字／翻譯（Groq Llama 4 Scout）
- 🌤 **天氣查詢** — 免費的 Open-Meteo，不需 API key
- ⏰ **提醒** — 「提醒我 明天9點 回診」，時間到主動推播
- ☀️ **每日早安推播** — 每天固定時間推「問候＋天氣＋生日」
- 🎂 **生日提醒** — 記錄家人生日、倒數、當天提醒
- 🩺 **健康記錄** — 血壓／血糖記錄與近期平均
- 💧 **喝水提醒** — 一鍵開啟每天多次提醒
- 💰 **家庭記帳** — 記一筆、查本月總額
- 💱 **匯率查詢** — 「匯率 台幣 越南盾」「5000 台幣換越南盾」，含 VND，免 API key
- 🌐 **翻譯** — 「翻譯 越南語 你吃飯了嗎」
- 🧾 **統一發票對獎** — 「對獎 12345678」，財政部公開資料
- 🍳 **今天吃什麼 / 食譜** — AI 出點子
- 🧩 **指令路由** — 容易擴充新指令與新服務

## 專案結構

```
src/
  index.js            Express 伺服器 + LINE webhook（程式進入點）
  config.js           讀取與檢查環境變數
  handler.js          訊息路由：文字 / 語音 / 圖片 → 指令 / 查詢 / AI
  ai.js               AI 對話、一次性問答、語音(Whisper)、看圖(Vision)
  line.js             共用 LINE client（回覆 + 推播 + 抓多媒體內容）
  store.js            共用 JSON 檔案儲存 + 台北時間工具
  conversation.js     每位使用者的對話記憶（記憶體版）
  services/
    weather.js        天氣查詢（Open-Meteo，免 API key）
    translate.js      翻譯（AI）
    food.js           今天吃什麼 / 食譜（AI）
    invoice.js        統一發票對獎（財政部 RSS）
    reminder.js       提醒 + 喝水提醒（解析時間 + 排程 + 推播）
    birthday.js       生日記錄與倒數
    morning.js        每日早安推播（排程）
    health.js         血壓 / 血糖記錄
    expense.js        家庭記帳
    exchangeRate.js   匯率查詢（ExchangeRate-API 開放端點，含 VND，免 API key）
```

> 存放資料的 `data/` 資料夾與 `.env` 都已被 `.gitignore` 排除。

## 1. 安裝

```bash
npm install
```

## 2. 取得金鑰

### LINE Messaging API

1. 到 [LINE Developers Console](https://developers.line.biz/) 建立一個 **Provider**，再建立 **Messaging API channel**
2. 在 channel 的 **Messaging API** 分頁取得：
   - **Channel access token**（按「Issue」產生）
   - **Channel secret**（在 Basic settings 分頁）
3. 同一個分頁把 **Auto-reply messages / Greeting messages** 關掉，以免和 bot 打架

### Groq API（免費）

到 [console.groq.com/keys](https://console.groq.com/keys) 登入後按 **Create API Key**，
複製 `gsk_...` 開頭的金鑰。免費、免綁信用卡。

## 3. 設定環境變數

複製範例檔並填入剛剛取得的值：

```bash
cp .env.example .env
```

```
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
GROQ_API_KEY=...
PORT=3000
```

> 想要更快：在 `.env` 加一行 `GROQ_MODEL=llama-3.1-8b-instant`。
> 預設用 `llama-3.3-70b-versatile`（品質較好）。

## 4. 本機測試

LINE 的 webhook 必須是公開的 HTTPS 網址，所以本機開發要用 [ngrok](https://ngrok.com/) 之類的工具把本機通道公開出去。

```bash
# 終端機 A：啟動 bot
npm run dev

# 終端機 B：把本機 3000 埠公開出去
ngrok http 3000
```

ngrok 會給你一個 `https://xxxx.ngrok-free.app` 網址。把
**`https://xxxx.ngrok-free.app/webhook`** 填到 LINE Console 的
**Messaging API → Webhook URL**，按「Verify」確認連線成功，並開啟「Use webhook」。

接著用手機加入這個 bot 為好友（掃 QR code 或搜尋 Bot ID），就能開始對話：

- 傳「你好」→ AI 回覆
- 傳「天氣 台北市」→ 回傳即時天氣
- 傳「/help」→ 顯示說明
- 傳「/reset」→ 清除這段對話記憶

## 5. 部署

設好同樣的環境變數後，`npm start` 即可。常見免費 / 低成本平台：Render、Railway、Fly.io、或自己的 VPS。
記得把部署後的網址 `https://你的網域/webhook` 更新回 LINE Console 的 Webhook URL。

## 擴充指南

- **新增查詢服務**：照 `src/services/weather.js` 的模式新增檔案，再到 `src/handler.js`
  加一條判斷（例如 `/^股價\s*(.+)$/`）。
- **換 AI 模型 / 調整人設**：改 `src/ai.js` 的 `SYSTEM_PROMPT` 或 `.env` 的 `GROQ_MODEL`。
- **對話記憶**：目前存在記憶體，重啟會清空。正式上線請改用資料庫（Redis / PostgreSQL）。

# LINE Bot（家庭助理：AI 對話 + 查詢服務 + 多語言）

一個用 **Node.js** 寫的家庭 LINE 聊天機器人，**全程使用免費服務**（Groq AI + 各種免金鑰開放資料），
已部署於 Render 全天候運作。特別為**多語言家庭**設計——中文與越南語使用者都能無障礙使用。

## 功能總覽

### 🤖 AI 與多媒體
- 💬 **AI 對話** — 串接 Groq（免費），每位使用者有獨立對話記憶；用什麼語言問就用什麼語言答
- 🎙 **語音訊息** — 傳語音自動聽打＋回答（Groq Whisper），支援中文／越南語等
- 📷 **看照片** — 傳圖片，辨識／讀字／翻譯（Groq Llama 4 Scout），可針對圖片追問

### 🔎 查詢服務（全部免 API key）
- 🌤 **天氣** — 「天氣 台北市」；台灣主要城市內建座標（中／英／越南語地名都認得）
- 🚆 **台鐵時刻** — 「台鐵 台北 台中」「下一班 台北到花蓮」；站名支援中／英／越南語，
  **站名對不齊時自動列出相近車站按鈕讓你點選**；支援「明天」
- ⛽ **最近加油站** — 傳「位置資訊」→ 回最近 5 家＋距離＋導航連結（中油開放資料 1,971 站）
- ⛽ **油價** — 「油價」「95油價」（中油官方牌價）
- 💱 **匯率** — 「匯率 台幣 越南盾」「5000 台幣換越南盾」（含 VND）
- 📅 **放假／連假** — 「今天放假嗎」「下一個連假」「7月假日」（台灣行事曆）
- 🧾 **統一發票對獎** — 「對獎 12345678」（財政部公開資料）

### 🏠 家庭功能
- ⏰ **提醒** — 「提醒我 明天9點 回診」，任何語言的自然語句都能設；時間到主動推播
- ☀️ **每日早安推播** — 問候＋天氣＋生日，依訂閱者語言送出（越南語訂閱者收越南語版）
- 🎂 **生日提醒**、🩺 **健康記錄**（血壓/血糖）、💧 **喝水提醒**、💰 **家庭記帳**
- 🌐 **翻譯** — 「翻譯 越南語 你吃飯了嗎」
- 🍳 **今天吃什麼／食譜** — AI 出點子

### 🌍 多語言無障礙（zh-TW / vi / en / ja / th / id）
- **依使用者自動偵測語言**（或「語言 越南語」手動鎖定）；回覆、錯誤訊息、提示全部跟著語言走
- **Rich Menu 圖形選單** — 聊天室底部常駐按鈕，**依語言自動切換**（越南語使用者看越南語版），
  bot 開機自動建置，零手動設定
- **越南語直達指令** — `trợ giúp`（功能選單）、`giá xăng`（油價）、`tỷ giá`（匯率，預設台幣↔越南盾）、
  `tàu hoả`（台鐵說明）、`thời tiết`（天氣）、`trạm xăng`（找加油站）、`bật/tắt tin sáng`（早安推播開關）
- **首次越南語歡迎** — 第一次用越南語傳訊息會收到一則越南語使用介紹

## 專案結構

```
src/
  index.js            Express 伺服器 + LINE webhook（程式進入點）
  config.js           讀取與檢查環境變數
  handler.js          訊息路由：文字 / 語音 / 圖片 / 位置 → 指令 / 查詢 / AI
  ai.js               AI 對話（含工具呼叫與容錯）、問答、語音、看圖
  tools.js            AI 工具定義（讓模型能用自然語句執行查詢/提醒/記帳）
  line.js             共用 LINE client（回覆 + 推播 + 抓多媒體內容）
  lang.js             per-user 語言偵測/設定 + 六語字串表（選單、錯誤訊息、提示）
  store.js            共用 JSON 檔案儲存 + 台北時間工具
  conversation.js     每位使用者的對話記憶（記憶體版）
  services/
    weather.js        天氣（Open-Meteo；台灣主要城市內建座標＋越南語地名別名）
    traTrain.js       台鐵時刻（交通部 PTX；全站表＋多語站名＋模糊比對）
    traChoice.js      台鐵「相近站名選擇」狀態機（Quick Reply 按鈕流程）
    gasStation.js     最近加油站（中油開放資料＋位置訊息＋距離排序）
    fuelPrice.js      中油油價（官方 XML 端點）
    exchangeRate.js   匯率（open.er-api.com，含 VND）
    holiday.js        台灣放假／連假（TaiwanCalendar）
    invoice.js        統一發票對獎（財政部 RSS）
    reminder.js       提醒 + 喝水提醒（解析時間 + 排程 + 推播）
    morning.js        每日早安推播（依訂閱者語言）
    richMenu.js       Rich Menu 自動建置＋依語言連結（開機冪等）
    birthday.js       生日記錄與倒數
    health.js         血壓 / 血糖記錄
    expense.js        家庭記帳
    translate.js      翻譯（AI）
    food.js           今天吃什麼 / 食譜（AI）
assets/richmenu/      Rich Menu 選單圖（中文版 / 越南語版，2500×1686 PNG）
scripts/              一次性工具（Rich Menu 產圖 PowerShell 腳本）
docs/loop/            每個功能的開發閉環紀錄（PRD / DESIGN / TEST）
DEVLOOP.md            閉環開發流程說明（PM→架構→寫碼→審查→測試）
render.yaml           Render 部署設定（推 main 自動部署）
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
> 語音用 `whisper-large-v3-turbo`、看圖用 `llama-4-scout`，也可用環境變數覆蓋（見 `src/config.js`）。

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
- 傳「/help」或「trợ giúp」→ 顯示功能選單（依你的語言）
- 傳「/reset」→ 清除這段對話記憶

## 5. 部署（Render 免費方案）

Repo 內已含 `render.yaml`：在 Render 建立 Web Service 指向這個 repo，設好與 `.env` 相同的
環境變數後，**推上 `main` 分支即自動部署**。記得把 `https://你的網域/webhook` 填回
LINE Console 的 Webhook URL。Rich Menu 會在 bot 開機時自動建置，無需手動設定。

已知的免費方案限制：

- **閒置休眠**：15 分鐘沒流量會休眠，第一則訊息會慢幾秒；可用 UptimeRobot 之類的服務每 5 分鐘 ping 首頁保持喚醒。
- **檔案不持久**：`data/*.json`（提醒、生日、記帳…）在重新部署／重啟後會清空。要永久保存需改接
  免費資料庫（如 Upstash Redis / Neon Postgres），改 `src/store.js` 即可。

## 開發流程

- **分支 + PR**：新功能／修 bug 一律開 feature 分支 → 開 Pull Request → 審核後 merge（Render 自動部署）。
- **開發閉環**：功能以「PM 開 PRD → 架構設計 → 寫碼 → 審查 → 測試全綠才出貨」的流程進行，
  詳見 [DEVLOOP.md](DEVLOOP.md)；每輪的 PRD／設計／測試報告都存放在 `docs/loop/<功能>/`。

## 擴充指南

- **新增查詢服務**：照 `src/services/fuelPrice.js` 的模式新增檔案，再到 `src/handler.js`
  加一條判斷；若要讓 AI 能用自然語句觸發，到 `src/tools.js` 加工具定義。
- **新增語言字串**：到 `src/lang.js` 的對應表加一個語言鍵（現有 zh-TW/vi/en/ja/th/id 模式）。
- **換 AI 模型 / 調整人設**：改 `src/ai.js` 的 `SYSTEM_PROMPT` 或 `.env` 的 `GROQ_MODEL`。
- **對話記憶**：目前存在記憶體，重啟會清空。正式上線請改用資料庫（Redis / PostgreSQL）。

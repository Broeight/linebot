require('dotenv').config();

const config = {
  line: {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    // 免費的 Groq 模型。可在 .env 用 GROQ_MODEL 更換，例如
    // llama-3.1-8b-instant（更快）。可用清單見 https://console.groq.com/docs/models
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    whisperModel: process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo', // 語音
    visionModel: process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct', // 看圖
  },
  port: Number(process.env.PORT) || 3000,
  morningTime: process.env.MORNING_TIME || '07:00', // 每日早安推播時間（台北時間 HH:mm）
};

// 啟動前先檢查必要的環境變數，避免之後才出現難懂的錯誤
function assertConfig() {
  const missing = [];
  if (!config.line.channelAccessToken) missing.push('LINE_CHANNEL_ACCESS_TOKEN');
  if (!config.line.channelSecret) missing.push('LINE_CHANNEL_SECRET');
  if (!config.groq.apiKey) missing.push('GROQ_API_KEY');
  if (missing.length > 0) {
    console.error(
      `\n❌ 缺少環境變數：${missing.join(', ')}\n` +
        `請複製 .env.example 成 .env，並填入正確的值。\n`
    );
    process.exit(1);
  }
}

module.exports = { config, assertConfig };

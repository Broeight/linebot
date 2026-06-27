const Groq = require('groq-sdk');
const { toFile } = require('groq-sdk');
const { config } = require('./config');
const { getForecastSummary } = require('./services/weather');

const groq = new Groq({ apiKey: config.groq.apiKey });

const SYSTEM_PROMPT = `你是一個友善、實用的 LINE 聊天機器人助理。

規則：
- 用「對方使用的語言」回覆（例如對方用越南語就用越南語、用中文就用繁體中文、用英文就用英文）。難以判斷時用繁體中文。語氣自然親切。
- 需要即時天氣或天氣預報（會不會下雨、氣溫等）時，務必呼叫 get_weather 工具查詢真實資料，再用對方的語言回答；絕對不要叫使用者自己去查。
- 回覆要簡潔扼要，因為 LINE 訊息有長度限制（請控制在 4000 字以內）。
- 直接給出最終答案，不要輸出思考過程或冗長的開場白。
- 不知道答案時就誠實說明，不要編造。`;

// 提供給聊天 AI 的工具：查天氣（讓自然語言、任何語言的天氣問題都能查到真實資料）
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查詢某地點目前天氣與未來三天預報（含降雨機率）。當使用者問天氣、會不會下雨、氣溫冷熱等，呼叫此工具。',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: '地點名稱，用中文或英文（例如「新竹市」或「Hsinchu」）。請勿用其他語言。',
          },
        },
        required: ['location'],
      },
    },
  },
];

async function runTool(name, argsJson) {
  try {
    const args = JSON.parse(argsJson || '{}');
    if (name === 'get_weather') {
      return (await getForecastSummary(args.location)) || `查不到「${args.location}」的天氣資料。`;
    }
  } catch {
    return '查詢失敗。';
  }
  return '查無此工具。';
}

/**
 * 把整段對話歷史送給 Groq，取回助理的回覆文字。
 * @param {Array<{role: 'user'|'assistant', content: string}>} history
 * @returns {Promise<string>}
 */
async function chat(history) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history];

  let resp = await groq.chat.completions.create({
    model: config.groq.model,
    max_tokens: 1024,
    temperature: 0.7,
    messages,
    tools: TOOLS,
  });
  let msg = resp.choices?.[0]?.message;

  // 工具呼叫迴圈（最多 3 輪，避免無限迴圈）
  let rounds = 0;
  while (msg?.tool_calls?.length && rounds < 3) {
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
    for (const tc of msg.tool_calls) {
      const result = await runTool(tc.function.name, tc.function.arguments);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
    resp = await groq.chat.completions.create({
      model: config.groq.model,
      max_tokens: 1024,
      temperature: 0.7,
      messages,
      tools: TOOLS,
    });
    msg = resp.choices?.[0]?.message;
    rounds++;
  }

  return msg?.content?.trim() || '抱歉，我現在無法回覆，請稍後再試。';
}

/**
 * 一次性問答：給一段 system 指示 + 使用者輸入，回純文字。
 * 翻譯、食譜建議等「不需要對話記憶」的功能用這個。
 */
async function ask(systemPrompt, userText) {
  const completion = await groq.chat.completions.create({
    model: config.groq.model,
    max_tokens: 1024,
    temperature: 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText },
    ],
  });
  return completion.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * 要求模型回傳 JSON（用於把自然語言解析成結構化資料，例如提醒時間）。
 * @returns {Promise<object|null>}
 */
async function askJSON(systemPrompt, userText) {
  const completion = await groq.chat.completions.create({
    model: config.groq.model,
    max_tokens: 512,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText },
    ],
  });
  try {
    return JSON.parse(completion.choices?.[0]?.message?.content || '');
  } catch {
    return null;
  }
}

/**
 * 語音轉文字（Groq Whisper，免費）。
 * @param {Buffer} buffer  音檔內容（LINE 語音為 m4a）
 * @returns {Promise<string>}
 */
async function transcribe(buffer) {
  const file = await toFile(buffer, 'audio.m4a');
  const result = await groq.audio.transcriptions.create({
    file,
    model: config.groq.whisperModel,
  });
  return (result.text || '').trim();
}

const VISION_PROMPT =
  '用繁體中文簡潔描述這張圖片的內容。' +
  '如果圖片中有文字，把文字唸出來；若是外文，順便翻成中文。' +
  '如果看起來像是商品、藥品、菜單或植物，請給實用的說明。';

/**
 * 看圖回答（Groq Llama 4 Scout，免費，支援影像）。
 * @param {Buffer} buffer     圖片內容
 * @param {string} mediaType  例如 image/jpeg
 * @param {string} [prompt]   自訂提問，預設為描述/讀字/翻譯
 * @returns {Promise<string>}
 */
async function vision(buffer, mediaType, prompt) {
  const dataUrl = `data:${mediaType};base64,${buffer.toString('base64')}`;
  const completion = await groq.chat.completions.create({
    model: config.groq.visionModel,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt || VISION_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  return completion.choices?.[0]?.message?.content?.trim() || '';
}

module.exports = { chat, ask, askJSON, transcribe, vision };

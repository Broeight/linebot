const Groq = require('groq-sdk');
const { toFile } = require('groq-sdk');
const { config } = require('./config');

const groq = new Groq({ apiKey: config.groq.apiKey });

// 從 Groq tool_use_failed 的 failed_generation（形如 <function=NAME{...JSON...}</function>）
// 解析出模型「本來想呼叫的工具」，救回成正規 tool_calls。
function parseFailedToolCalls(text) {
  const calls = [];
  if (!text) return calls;
  const re = /<function=([a-zA-Z0-9_]+)[\s\S]*?(\{[\s\S]*?\})\s*<\/function>/g;
  let m;
  let i = 0;
  while ((m = re.exec(text))) {
    calls.push({ id: `recovered_${i++}`, type: 'function', function: { name: m[1], arguments: m[2] } });
  }
  return calls;
}

const SYSTEM_PROMPT = `你是一個友善、實用的 LINE 聊天機器人助理。

規則：
- 用「對方使用的語言」回覆（例如對方用越南語就用越南語、用中文就用繁體中文、用英文就用英文）。難以判斷時用繁體中文。語氣自然親切。
- 你有工具可用（查天氣、設提醒、記帳、對獎）。當使用者的要求剛好對應到這些工具時，務必呼叫工具實際完成，再用對方的語言確認，不要叫使用者自己做。其他一般問題（閒聊、建議、知識、推薦等）就直接用你自己的知識自然回答，不需要工具。
- 回覆要簡潔扼要，因為 LINE 訊息有長度限制（請控制在 4000 字以內）。
- 直接給出最終答案，不要輸出思考過程或冗長的開場白。
- 不知道答案時就誠實說明，不要編造。`;

/**
 * 對話：把歷史送給 Groq，並支援工具呼叫。
 * tools（工具定義）與 runTool（執行器）由呼叫端提供，避免循環相依。
 * @param {Array<{role:string, content:string}>} history
 * @param {{tools?:Array, runTool?:Function, systemExtra?:string}} [opts]
 * @returns {Promise<string>}
 */
async function chat(history, opts = {}) {
  const { tools, runTool, systemExtra } = opts;
  const system = SYSTEM_PROMPT + (systemExtra ? '\n\n' + systemExtra : '');
  const messages = [{ role: 'system', content: system }, ...history];
  const base = { model: config.groq.model, max_tokens: 1024, temperature: 0.7 };
  // parallel_tool_calls:false → 一次只呼叫一個工具，避免重複執行有副作用的操作（如重複記帳）
  const withTools = tools && tools.length ? { tools, parallel_tool_calls: false } : {};

  // 模型偶爾會把「工具呼叫」的格式吐錯，Groq 會回 400 tool_use_failed。
  function toolUseFailed(e) {
    const code = e?.error?.error?.code || e?.error?.code || e?.code;
    return (
      e?.status === 400 &&
      (code === 'tool_use_failed' || /tool_use_failed|Failed to call a function/i.test(String(e?.message || '')))
    );
  }

  // 呼叫模型；若模型把工具呼叫格式吐錯（tool_use_failed），優先「把它本來想呼叫的
  // 工具救回來」變成正規的 tool_calls（讓提醒/記帳等真的生效）；救不回來才退而
  // 不帶工具重試，至少不會整個崩掉、回「發生了一點問題」。
  async function complete() {
    try {
      return await groq.chat.completions.create({ ...base, messages, ...withTools });
    } catch (e) {
      if (!(withTools.tools && toolUseFailed(e))) throw e;
      const fg = e?.error?.error?.failed_generation || e?.error?.failed_generation || '';
      const recovered = parseFailedToolCalls(fg);
      if (recovered.length && runTool) {
        // 偽裝成一個正常的「帶 tool_calls 的回應」，交給下面的工具迴圈執行
        return { choices: [{ message: { role: 'assistant', content: '', tool_calls: recovered } }] };
      }
      return await groq.chat.completions.create({ ...base, messages });
    }
  }

  let resp = await complete();
  let msg = resp.choices?.[0]?.message;

  // 工具呼叫迴圈（最多 4 輪，避免無限迴圈）
  let rounds = 0;
  while (msg?.tool_calls?.length && runTool && rounds < 4) {
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
    for (const tc of msg.tool_calls) {
      const result = await runTool(tc.function.name, tc.function.arguments);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
    resp = await complete();
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

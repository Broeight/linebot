// 翻譯服務：用現有的 Groq AI，不需額外金鑰。
// 用法：
//   翻譯 越南語 你吃飯了嗎      → 翻成越南語
//   翻譯 早安                   → 沒指定語言時，中文→英文、其他語言→中文
const ai = require('../ai');

const SYSTEM = `你是專業翻譯。使用者會給你一段要翻譯的文字，開頭可能會指定目標語言（例如「越南語」「英文」「日文」）。
規則：
- 有指定語言就翻成該語言；沒指定時，中文翻成英文，其他語言一律翻成繁體中文。
- 只輸出翻譯結果本身，不要加任何解釋、引號或原文。`;

async function translate(input) {
  if (!input) {
    return '請在後面加上要翻譯的內容，例如：\n翻譯 越南語 你吃飯了嗎';
  }
  const result = await ai.ask(SYSTEM, input);
  return result || '抱歉，翻譯失敗，請再試一次。';
}

module.exports = { translate };

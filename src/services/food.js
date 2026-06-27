// 「今天吃什麼 / 食譜」服務：用 Groq AI 出點子。
const ai = require('../ai');

const SUGGEST_SYSTEM = `你是貼心的家庭料理顧問。使用者問「今天吃什麼」時，
推薦 3 道家常菜（中式為主），每道一行：菜名 + 一句簡短說明。
最後問一句要不要看其中一道的食譜。用繁體中文、親切口吻、簡潔。`;

const RECIPE_SYSTEM = `你是料理老師。使用者會給你一道菜名，請提供簡單食譜：
- 材料（條列）
- 步驟（編號，盡量 5 步以內）
用繁體中文、簡潔、適合家庭新手。`;

async function suggest() {
  const result = await ai.ask(SUGGEST_SYSTEM, '今天吃什麼？');
  return result || '今天就煮個番茄炒蛋吧 🍳';
}

async function recipe(dish) {
  if (!dish) return '請告訴我菜名，例如：食譜 番茄炒蛋';
  const result = await ai.ask(RECIPE_SYSTEM, dish);
  return result || '抱歉，我想不出這道菜的做法，換一道試試？';
}

module.exports = { suggest, recipe };

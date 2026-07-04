// 就醫溝通卡：卡片模板寫死在程式裡（開場、結尾、分隔線固定），
// AI 只負責把「症狀描述」翻成中文＋回譯確認，降低 AI 亂發揮的風險。
const ai = require('../ai');

// 卡片模板（固定，AI 只填 {symptoms_zh}）
function buildCard(symptomsZh, backTranslation) {
  return (
    '🏥 就醫溝通卡（請出示給醫護人員）\n' +
    '您好，我是越南籍人士，中文不太流利，請多包涵。\n' +
    `【症狀／需求】${symptomsZh}\n` +
    '請問需要掛哪一科？麻煩您了，謝謝！' +
    (backTranslation ? `\n──────────\n📄 Nội dung thẻ (để bạn kiểm tra):\n${backTranslation}` : '')
  );
}

// 產卡：AI 兩步 — (1) 症狀翻繁中（只輸出譯文）(2) 譯文回譯越語（只輸出譯文）
// 任一步失敗回 null（呼叫端用 lang 回「暫時無法」句）
async function makeCard(symptomsText) {
  const zh = await ai.ask('把以下就醫症狀描述翻譯成繁體中文，口語、簡潔。只輸出譯文本身。', symptomsText);
  if (!zh || !zh.trim()) return null;
  // 輸入本來就是中文時 zh≈原文，回譯仍做（讓越南使用者可核對）
  const back = await ai.ask('Dịch mô tả triệu chứng sau sang tiếng Việt. Chỉ xuất bản dịch.', zh);
  return buildCard(zh.trim(), (back || '').trim());
}

module.exports = { makeCard, buildCard };

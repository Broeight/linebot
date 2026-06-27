// 統一發票對獎服務：抓財政部公開的中獎號碼 RSS，比對使用者輸入的發票號碼。
// 用法：對獎 12345678（發票號碼後 8 碼數字）
//
// 獎別與末幾碼對應（依財政部規則）：
//   特別獎 8 碼全中 → 1000 萬
//   特獎   8 碼全中 → 200 萬
//   頭獎   8 碼全中 → 20 萬
//   二獎   末 7 碼  → 4 萬
//   三獎   末 6 碼  → 1 萬
//   四獎   末 5 碼  → 4 千
//   五獎   末 4 碼  → 1 千
//   六獎   末 3 碼  → 200 元
// （增開六獎號碼此資料來源未提供，會另外提醒使用者自行確認。）

const FEED_URL = 'https://invoice.etax.nat.gov.tw/invoice.xml';

let cache = { at: 0, data: null };

async function fetchLatest() {
  // 中獎號碼兩個月才更新一次，快取 1 小時避免重複抓取
  if (cache.data && Date.now() - cache.at < 60 * 60 * 1000) return cache.data;

  const xml = await (await fetch(FEED_URL)).text();
  const item = xml.match(/<item>([\s\S]*?)<\/item>/);
  if (!item) return null;
  const block = item[1];

  const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || [])[1] || '本期';
  const desc = (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || [])[1] || '';

  const special = (desc.match(/特別獎：(\d{8})/) || [])[1];
  const grand = (desc.match(/特獎：(\d{8})/) || [])[1];
  const firstLine = (desc.match(/頭獎：([\d、]+)/) || [])[1] || '';
  const first = firstLine.match(/\d{8}/g) || [];

  if (!special || !grand || first.length === 0) return null;

  cache = { at: Date.now(), data: { title, special, grand, first } };
  return cache.data;
}

const PRIZES = [
  { len: 7, name: '二獎', amount: '4 萬元' },
  { len: 6, name: '三獎', amount: '1 萬元' },
  { len: 5, name: '四獎', amount: '4 千元' },
  { len: 4, name: '五獎', amount: '1 千元' },
  { len: 3, name: '六獎', amount: '200 元' },
];

async function checkInvoice(input) {
  const num = (input || '').replace(/\D/g, '');
  if (num.length < 3) {
    return '請輸入發票號碼末 3～8 碼數字，例如：對獎 12345678';
  }

  const data = await fetchLatest();
  if (!data) return '抓不到中獎號碼資料，請稍後再試 🙏';

  const last8 = num.slice(-8);
  let won = null;

  // 特別獎 / 特獎（需完整 8 碼）
  if (num.length >= 8 && last8 === data.special) won = { name: '特別獎', amount: '1000 萬元' };
  else if (num.length >= 8 && last8 === data.grand) won = { name: '特獎', amount: '200 萬元' };
  else {
    // 對頭獎三組，取最高獎
    for (const f of data.first) {
      if (num.length >= 8 && last8 === f) { won = { name: '頭獎', amount: '20 萬元' }; break; }
      for (const p of PRIZES) {
        if (num.length >= p.len && f.slice(-p.len) === num.slice(-p.len)) {
          if (!won || p.len > (won._len || 0)) won = { name: p.name, amount: p.amount, _len: p.len };
          break;
        }
      }
    }
  }

  const header = `🧾 ${data.title} 對獎\n你的號碼：${num}\n`;
  if (won) {
    return (
      header +
      `\n🎉 恭喜中獎！\n${won.name}：${won.amount}\n\n` +
      '（中獎金額以財政部公告為準；增開六獎號碼請再自行核對。）'
    );
  }
  return (
    header +
    '\n這次沒有中獎，下次加油 💪\n\n' +
    `本期號碼\n特別獎：${data.special}\n特獎：${data.grand}\n頭獎：${data.first.join('、')}`
  );
}

module.exports = { checkInvoice };

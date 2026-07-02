// Rich Menu 自我建置與依語言連結。全部 fire-and-forget、永不 throw。
// richmenu 本體存在 LINE 伺服器端（不在 Render 磁碟），重開機以「名稱」查回，冪等。
const fs = require('fs');
const path = require('path');
const { client, blobClient } = require('../line');

const deps = { client, blobClient }; // 測試時可整組換成 stub

const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets', 'richmenu');

const MENUS = [
  {
    name: 'menu-zh-v1',
    image: 'menu-zh.png',
    isDefault: true,
    request: {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: 'menu-zh-v1',
      chatBarText: '選單',
      areas: [
        { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: 'message', text: '台鐵查詢' } },
        { bounds: { x: 833, y: 0, width: 833, height: 843 }, action: { type: 'message', text: '加油站' } },
        { bounds: { x: 1666, y: 0, width: 834, height: 843 }, action: { type: 'message', text: '油價' } },
        { bounds: { x: 0, y: 843, width: 833, height: 843 }, action: { type: 'message', text: '今天吃什麼' } },
        { bounds: { x: 833, y: 843, width: 833, height: 843 }, action: { type: 'message', text: '天氣' } },
        { bounds: { x: 1666, y: 843, width: 834, height: 843 }, action: { type: 'message', text: '選單' } },
      ],
    },
  },
  {
    name: 'menu-vi-v1',
    image: 'menu-vi.png',
    isDefault: false,
    request: {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: 'menu-vi-v1',
      chatBarText: 'Menu',
      areas: [
        { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: 'message', text: 'tàu hoả' } },
        { bounds: { x: 833, y: 0, width: 833, height: 843 }, action: { type: 'message', text: 'trạm xăng' } },
        { bounds: { x: 1666, y: 0, width: 834, height: 843 }, action: { type: 'message', text: 'tỷ giá' } },
        { bounds: { x: 0, y: 843, width: 833, height: 843 }, action: { type: 'message', text: 'giá xăng' } },
        { bounds: { x: 833, y: 843, width: 833, height: 843 }, action: { type: 'message', text: 'thời tiết' } },
        { bounds: { x: 1666, y: 843, width: 834, height: 843 }, action: { type: 'message', text: 'trợ giúp' } },
      ],
    },
  },
];

const idByName = new Map(); // 'menu-zh-v1' → richMenuId（RAM，重啟重查）
const linkedState = new Map(); // userId → 'vi' | 'default'（RAM 去重）
const inflight = new Map(); // userId → Promise（每人串行，避免 link/unlink 亂序）

/**
 * 冪等建置：依名稱找回既有選單，缺的才建立＋上傳圖片＋設預設。永不 throw。
 * @returns {Promise<void>}
 */
async function ensureSetup() {
  try {
    const { richmenus } = await deps.client.getRichMenuList();
    for (const m of MENUS) {
      const found = (richmenus || []).find((r) => r.name === m.name);
      if (found) idByName.set(m.name, found.richMenuId);
    }

    for (const m of MENUS) {
      if (idByName.has(m.name)) continue; // 已存在，跳過建立

      const file = path.join(ASSETS_DIR, m.image);
      if (!fs.existsSync(file)) {
        console.error(`richmenu: 找不到圖片檔 ${file}，略過 ${m.name}`);
        continue;
      }

      let richMenuId;
      try {
        const created = await deps.client.createRichMenu(m.request);
        richMenuId = created.richMenuId;
      } catch (e) {
        console.error(`richmenu: 建立 ${m.name} 失敗：`, e);
        continue;
      }

      try {
        await deps.blobClient.setRichMenuImage(
          richMenuId,
          new Blob([fs.readFileSync(file)], { type: 'image/png' })
        );
      } catch (e) {
        console.error(`richmenu: 上傳圖片 ${m.image} 失敗，回滾刪除 ${richMenuId}：`, e);
        try {
          await deps.client.deleteRichMenu(richMenuId);
        } catch {
          /* 回滾失敗也只能放棄，下次開機再試 */
        }
        continue;
      }

      idByName.set(m.name, richMenuId);
    }

    const zhId = idByName.get('menu-zh-v1');
    if (zhId) await deps.client.setDefaultRichMenu(zhId);
  } catch (e) {
    console.error('richmenu: ensureSetup 失敗：', e);
  }
}

/**
 * 依語言連結／解除連結 rich menu（永不 throw、每人串行、RAM 去重）。
 * @param {string} userId
 * @param {string} code 語言代碼（'vi' 連 vi 選單；其餘解除連結，回落預設 zh 選單）
 * @returns {Promise<void>}
 */
function ensureFor(userId, code) {
  if (!userId) return Promise.resolve();
  const prev = inflight.get(userId) || Promise.resolve();
  const next = prev.then(() => doEnsure(userId, code)).catch(() => {});
  inflight.set(userId, next);
  return next;
}

async function doEnsure(userId, code) {
  const desired = code === 'vi' ? 'vi' : 'default';
  if (linkedState.get(userId) === desired) return; // 去重：同人同狀態不再打 API
  if (desired === 'vi') {
    const viId = idByName.get('menu-vi-v1');
    if (!viId) return; // setup 尚未完成：不寫入狀態，下則訊息再試
    await deps.client.linkRichMenuIdToUser(userId, viId); // ⚠️ userId 在前
  } else {
    await deps.client.unlinkRichMenuIdFromUser(userId); // 從沒 link 過也無害（冪等）
  }
  linkedState.set(userId, desired); // 只在成功後寫入
}

module.exports = {
  ensureSetup,
  ensureFor,
  _internal: { deps, MENUS, idByName, linkedState },
};

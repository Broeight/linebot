# DESIGN — 越南語無障礙第 2 輪：Rich Menu 圖形選單（每人依語言顯示）

## ✅ 需要金鑰：否（新的）
只用既有的 `LINE_CHANNEL_ACCESS_TOKEN`（rich menu 全部 API 都走 Messaging API 同一組 token）。
不新增任何環境變數、不改 `src/config.js`。

---

## 1. SDK 契約（已實測驗證，@line/bot-sdk **v11.0.2**）

### 1.1 實測方式與輸出（架構師已跑過）
```
node -e "
const line = require('@line/bot-sdk');
const c = new line.messagingApi.MessagingApiClient({ channelAccessToken: 'dummy' });
const b = new line.messagingApi.MessagingApiBlobClient({ channelAccessToken: 'dummy' });
const list = (o) => Object.getOwnPropertyNames(Object.getPrototypeOf(o))
  .filter((n) => /richmenu/i.test(n) && !/WithHttpInfo/.test(n)).sort();
console.log(list(c)); console.log(list(b));
"
```
實際輸出（節錄，本機 node v26.2.0；Render 依 package.json engines 為 22.x）：
```
MessagingApiClient:  cancelDefaultRichMenu, createRichMenu, deleteRichMenu,
                     getDefaultRichMenuId, getRichMenu, getRichMenuIdOfUser,
                     getRichMenuList, linkRichMenuIdToUser, setDefaultRichMenu,
                     unlinkRichMenuIdFromUser, validateRichMenuObject, …
MessagingApiBlobClient: getRichMenuImage, setRichMenuImage
global Blob: function   ← Node 18+ 內建，Render(22.x) 與本機皆有
```

### 1.2 本案用到的方法簽章（抄自 `node_modules/@line/bot-sdk/dist/messaging-api/api/*.d.ts`，逐字核對過）

| 方法 | Client | 簽章（實際 .d.ts） | 回傳 |
|---|---|---|---|
| `createRichMenu(richMenuRequest)` | `client`（MessagingApiClient） | `(richMenuRequest: RichMenuRequest) => Promise<RichMenuIdResponse>` | `{ richMenuId: string }` |
| `setRichMenuImage(richMenuId, body)` | **`blobClient`**（MessagingApiBlobClient） | `(richMenuId: string, body: Blob) => Promise<MessageAPIResponseBase>` | `{}` |
| `setDefaultRichMenu(richMenuId)` | `client` | `(richMenuId: string) => Promise<MessageAPIResponseBase>` | `{}` |
| `getRichMenuList()` | `client` | `() => Promise<RichMenuListResponse>` | `{ richmenus: RichMenuResponse[] }` ⚠️ 欄位名是**全小寫 `richmenus`** |
| `linkRichMenuIdToUser(userId, richMenuId)` | `client` | `(userId: string, richMenuId: string)` ⚠️ **userId 在前** | `{}` |
| `unlinkRichMenuIdFromUser(userId)` | `client` | `(userId: string)` | `{}` |
| `deleteRichMenu(richMenuId)` | `client` | `(richMenuId: string)` | `{}` |

`RichMenuResponse`（getRichMenuList 陣列元素）：`{ richMenuId, size, selected, name, chatBarText, areas }`。

### 1.3 ⚠️ 上傳圖片的關鍵發現：body 必須是 **Blob，且要帶 type**
`dist/http-fetch.js` 的 `postBinaryContent` 實作（已核對）：
```js
headers: { "Content-Type": body.type, ... }, body: body
```
Content-Type **直接取自 `blob.type`**。傳 Buffer 會壞（沒有 `.type`、Content-Type 變 undefined）。
**規定寫法**：
```js
await blobClient.setRichMenuImage(richMenuId, new Blob([buffer], { type: 'image/png' }));
```
（`Blob` 用全域的，**不需要** require；Node 22 有。）

### 1.4 Rich menu 建立請求的精確 JSON（RichMenuRequest）
`size.width` 2500、`size.height` 1686；`chatBarText` 上限 14 字；`name` 上限 300 字；areas 上限 20。
格線精確數學：2500 ÷ 3 → 833 / 833 / **834**（x = 0, 833, 1666）；1686 ÷ 2 → 843 / 843（y = 0, 843）。

**menu-zh-v1（逐字使用）：**
```json
{
  "size": { "width": 2500, "height": 1686 },
  "selected": true,
  "name": "menu-zh-v1",
  "chatBarText": "選單",
  "areas": [
    { "bounds": { "x": 0,    "y": 0,   "width": 833, "height": 843 }, "action": { "type": "message", "text": "台鐵查詢" } },
    { "bounds": { "x": 833,  "y": 0,   "width": 833, "height": 843 }, "action": { "type": "message", "text": "加油站" } },
    { "bounds": { "x": 1666, "y": 0,   "width": 834, "height": 843 }, "action": { "type": "message", "text": "油價" } },
    { "bounds": { "x": 0,    "y": 843, "width": 833, "height": 843 }, "action": { "type": "message", "text": "今天吃什麼" } },
    { "bounds": { "x": 833,  "y": 843, "width": 833, "height": 843 }, "action": { "type": "message", "text": "天氣" } },
    { "bounds": { "x": 1666, "y": 843, "width": 834, "height": 843 }, "action": { "type": "message", "text": "選單" } }
  ]
}
```

**menu-vi-v1（逐字使用）：**
```json
{
  "size": { "width": 2500, "height": 1686 },
  "selected": true,
  "name": "menu-vi-v1",
  "chatBarText": "Menu",
  "areas": [
    { "bounds": { "x": 0,    "y": 0,   "width": 833, "height": 843 }, "action": { "type": "message", "text": "tàu hoả" } },
    { "bounds": { "x": 833,  "y": 0,   "width": 833, "height": 843 }, "action": { "type": "message", "text": "trạm xăng" } },
    { "bounds": { "x": 1666, "y": 0,   "width": 834, "height": 843 }, "action": { "type": "message", "text": "tỷ giá" } },
    { "bounds": { "x": 0,    "y": 843, "width": 833, "height": 843 }, "action": { "type": "message", "text": "giá xăng" } },
    { "bounds": { "x": 833,  "y": 843, "width": 833, "height": 843 }, "action": { "type": "message", "text": "thời tiết" } },
    { "bounds": { "x": 1666, "y": 843, "width": 834, "height": 843 }, "action": { "type": "message", "text": "trợ giúp" } }
  ]
}
```

---

## 2. 產圖 POC（已實測成功：PowerShell + .NET System.Drawing）

在本機（Windows 10、Windows PowerShell 5.1）實測畫 2500×1686 PNG：3×2 圓角色塊、
中文「台鐵查詢」（Microsoft JhengHei Bold）、越南語「Trạm xăng Tỷ giá ờỗ」（Segoe UI Bold）。
**結果：成功。中文與越南語 diacritics（ạ ă ỷ ờ ỗ）全部正確渲染（人工看圖確認）。**

實測數據：
- 檔案大小：**71,320 bytes（約 70 KB）** ≪ LINE 1MB 上限，餘裕極大。
- PNG signature `89 50 4E 47 0D 0A 1A 0A` ✅；IHDR 讀回 2500×1686 ✅。
- 結論：**採用 PowerShell + System.Drawing**，不需要 npm install sharp。

實測中踩到的兩個坑（**必須寫進腳本注意事項**）：
1. **`.ps1` 必須存成 UTF-8 with BOM**。無 BOM 的 UTF-8 會被 PowerShell 5.1 當 ANSI 讀，
   中文/越南文全變亂碼、直接 parse error（實測重現）。轉檔一行：
   ```powershell
   $c=[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8); [IO.File]::WriteAllText($p,$c,[Text.UTF8Encoding]::new($true))
   ```
2. **PS 5.1 的 `-shl` 對 `[byte]` 會截斷成 byte**（實測：讀 IHDR 得 196 而非 2500）。
   讀 PNG 尺寸要用乘法 + `[int]` 轉型（見 §8 測試策略的精確 offset 數學）。

核心繪圖片段（實測可用，產圖腳本以此為準）：
```powershell
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(2500, 1686)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
# …FillPath(圓角矩形) + DrawString(置中 StringFormat)…
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
```

---

## 3. 逐檔變更清單

### 3.1 NEW `src/services/richMenu.js`
仿 `traChoice.js` 的純 RAM Map 模式。**直接 `require('../line')` 取 client**（與全 codebase 一致），
但透過可換掉的 `deps` 物件引用並匯出 `_internal`，讓測試能注入 stub（不引入 DI 框架）。

```js
// Rich Menu 自我建置與依語言連結。全部 fire-and-forget、永不 throw。
// richmenu 本體存在 LINE 伺服器端（不在 Render 磁碟），重開機以「名稱」查回，冪等。
const fs = require('fs');
const path = require('path');
const { client, blobClient } = require('../line');

const deps = { client, blobClient }; // 測試時可整組換成 stub

const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets', 'richmenu');

const MENUS = [
  { name: 'menu-zh-v1', image: 'menu-zh.png', isDefault: true,  request: {/* §1.4 zh JSON 逐字 */} },
  { name: 'menu-vi-v1', image: 'menu-vi.png', isDefault: false, request: {/* §1.4 vi JSON 逐字 */} },
];

const idByName = new Map();     // 'menu-zh-v1' → richMenuId（RAM，重啟重查）
const linkedState = new Map();  // userId → 'vi' | 'default'（RAM 去重）
const inflight = new Map();     // userId → Promise（每人串行，避免 link/unlink 亂序）
```

**`async function ensureSetup()`** — 冪等、永不 throw（整體 try/catch + console.error）：
1. `const { richmenus } = await deps.client.getRichMenuList();`
   對每個 `MENUS`：清單裡有同 `name` 的 → `idByName.set(name, richMenuId)`，跳過建立。
2. 缺的才建：
   a. `const file = path.join(ASSETS_DIR, m.image);` → `if (!fs.existsSync(file))` → console.error 並 `continue`（存在守衛）。
   b. `const { richMenuId } = await deps.client.createRichMenu(m.request);`
   c. `await deps.blobClient.setRichMenuImage(richMenuId, new Blob([fs.readFileSync(file)], { type: 'image/png' }));`
      **若 c 失敗：`try { await deps.client.deleteRichMenu(richMenuId); } catch {}` 回滾**——
      沒圖的 richmenu 不能設預設，留著會讓下次開機「以為已存在」而卡死在壞狀態。回滾後下次開機重試。
   d. `idByName.set(m.name, richMenuId);`
3. 收尾：`const zhId = idByName.get('menu-zh-v1'); if (zhId) await deps.client.setDefaultRichMenu(zhId);`
   **每次開機都呼叫**（不只新建時）：1 個便宜呼叫，換得預設選單自我修復。
4. 任何一步失敗只 console.error（前綴 `richmenu:`），函式正常 resolve。

**`async function ensureFor(userId, code)`** — 永不 throw、每人串行、RAM 去重：
```js
function ensureFor(userId, code) {
  if (!userId) return Promise.resolve();
  const prev = inflight.get(userId) || Promise.resolve();
  const next = prev.then(() => doEnsure(userId, code)).catch(() => {});
  inflight.set(userId, next);
  return next;
}
async function doEnsure(userId, code) {
  const desired = code === 'vi' ? 'vi' : 'default';
  if (linkedState.get(userId) === desired) return;      // 去重：同人同狀態不再打 API
  if (desired === 'vi') {
    const viId = idByName.get('menu-vi-v1');
    if (!viId) return;                                   // setup 尚未完成：不寫入狀態，下則訊息再試
    await deps.client.linkRichMenuIdToUser(userId, viId); // ⚠️ userId 在前
  } else {
    await deps.client.unlinkRichMenuIdFromUser(userId);   // 從沒 link 過也無害（冪等）
  }
  linkedState.set(userId, desired);                       // 只在成功後寫入
}
```
為什麼要 `inflight` 串行：「語言 越南語」這則訊息本身含漢字，handleText 開頭的 hook 會先以
舊語言（zh）觸發一次 `ensureFor(…, 'zh-TW')`，langMatch 路由裡又觸發 `ensureFor(…, 'vi')`；
不串行的話 unlink 與 link 併發打到 LINE，最終狀態不確定。串行後保證後到的 vi 蓋掉前面。

**匯出**：`module.exports = { ensureSetup, ensureFor, _internal: { deps, MENUS, idByName, linkedState } };`
（測試把 `_internal.deps.client` / `.blobClient` 換成 stub 物件即可；測後不必還原——測試程序獨立。）

TTL：不需要（PRD 明訂）。Map 成長上限＝家庭使用者數，先例同 `traChoice.js`。

### 3.2 NEW `scripts/generate-richmenu-images.ps1`（一次性工具，不進 runtime）
一支腳本產兩張圖到 `assets/richmenu/menu-zh.png`、`menu-vi.png`，**產完 commit PNG 進 repo**
（Render 只讀 repo 內的檔案——repo 檔案每次部署都在，ephemeral 只影響 runtime 寫入，所以安全）。

規格（coder 照抄，不再決策）：
- 畫布 2500×1686，背景 `#F5F6FA`。
- 六格版位＝**點擊區格線**：`$colX=@(0,833,1666)`、`$colW=@(833,833,834)`、`$rowY=@(0,843)`、`$rowH=@(843,843)`。
- 每格內縮 24px 畫圓角矩形（圓角半徑 40）當色塊；文字置中（StringFormat 兩軸 Center）。
- 色盤（依格序 1–6，兩套選單同色序，實測視覺 OK）：
  `#2F6FED`（藍）、`#12B76A`（綠）、`#F79009`（橘）、`#9E77ED`（紫）、`#F04438`（紅）、`#475467`（灰藍）。
- 字：白色粗體、**120px**（GraphicsUnit::Pixel）。zh 用 `Microsoft JhengHei`，vi 用 `Segoe UI`
  （POC 驗證此組合中文與 diacritics 全對；**標籤不放 emoji**，避免 GDI+ emoji 字型問題——PRD 允許）。
- 標籤文字見 §4 表格「圖上標籤」欄，逐字使用。
- 腳本結尾自我驗證兩張圖：PNG signature、IHDR 尺寸（用 §8.3 的 `[int]` 乘法讀法）、bytes < 1,048,576，
  任一不符 exit 1。
- **檔案必須存成 UTF-8 with BOM**（§2 坑 1）。coder 寫完檔案後執行 §2 的轉檔一行再跑。
- 執行方式（開發機一次）：`powershell -ExecutionPolicy Bypass -File scripts/generate-richmenu-images.ps1`

### 3.3 NEW `assets/richmenu/menu-zh.png`、`assets/richmenu/menu-vi.png`
由 3.2 產出後 commit。預估各 ~70–90 KB（POC 實測 71,320 bytes）。

### 3.4 `src/index.js`
- 頂部 require 區加：`const richMenu = require('./services/richMenu');`
- `app.listen` callback 內、`morning.start();` 之後加一行（fire-and-forget，失敗不影響開機）：
  ```js
  richMenu.ensureSetup().catch((e) => console.error('richmenu setup 失敗：', e));
  ```
  （ensureSetup 本身永不 throw，`.catch` 是雙保險。不 await。）

### 3.5 `src/handler.js`
頂部 require 加：`const richMenu = require('./services/richMenu');`（無循環依賴：richMenu 只 require ../line）。

**(a) hook 點（決策＋理由）**：在 `handleText` 開頭、`lang.noteText(userId, trimmed);` **之後**加：
```js
// Rich menu 語言連動：fire-and-forget，不 await、不加回覆延遲，錯誤全吞
lang.resolve(userId).then((code) => richMenu.ensureFor(userId, code)).catch(() => {});
```
理由（查過 lang.js / store.js 實作）：`lang.resolve` 對已知使用者＝同步讀一次小 JSON
（`store.load` 是 `fs.readFileSync` data/lang.json，無快取但檔案極小、本 codebase 每則訊息本就多處呼叫）；
只有「首次見到的使用者」才多一次 `getProfile` 網路呼叫——而這整串**不被 await**，完全不在回覆路徑上。
放在 noteText 之後的好處：自動偵測（如她第一次打越南文）當下 lang.json 已更新，**同一則訊息就換選單**。
handleAudio 走 handleText，語音也涵蓋；handleImage/handleLocation 不加 hook（下則文字/語音訊息會補上，可接受）。

**(b) 手動切語言立即換選單**：langMatch 路由內、`lang.setManual(userId, code);` 之後加：
```js
richMenu.ensureFor(userId, code).catch(() => {});
```
（不 await。與 (a) 的競態由 richMenu 內部 per-user 串行解掉，見 §3.1。）

**(c) 搬移 asciiTrimmed 宣告**：把現在位於「越南語關鍵字直達」區塊開頭的
`const asciiTrimmed = toAscii(trimmed);`（連同其上兩行註解）**上移到「加油站」區塊之前**
（即 `// ── 加油站（找最近的）` 註解上方）。toAscii 是純函式，提早算安全。

**(d) 加油站關鍵字收 vi**：加油站區塊的 if 條件改為：
```js
if (/^(?:最近的?加油站|附近的?加油站|加油站|哪裡加油|找加油站)$/.test(trimmed) || /^tram xang$/.test(asciiTrimmed)) {
```
（`toAscii('trạm xăng')` === `'tram xang'`，走既有「30 分內有位置→直查；否則分享位置提示＋location 按鈕」流程，
提示句已有 vi 版 `SHARE_LOCATION_PROMPT.vi` ✅。）

**(e) 新 vi 直達路由**：加在既有 vi 直達區塊內、`tyGiaRestMatch` 之後：
```js
if (/^tau hoa$/.test(asciiTrimmed)) {
  return lang.traUsage(await lang.resolve(userId));
}
if (/^thoi tiet$/.test(asciiTrimmed)) {
  return lang.weatherAsk(await lang.resolve(userId));
}
```
（`toAscii('tàu hoả')`＝`toAscii('tàu hỏa')`＝`'tau hoa'`；`toAscii('thời tiết')`＝`'thoi tiet'`。
只比對「單獨一句」：`thời tiết Đài Bắc` 不會命中 `^thoi tiet$`，落到 AI（有 get_weather 工具）——符合 PRD「或 AI 處理」。）

### 3.6 `src/lang.js`
新增兩張表＋兩個 getter，**回落模式照 `helpMenu`**：`TABLE[code]`，`ja/th/id` 回落 `en`，未知回落 `zh-TW`。

```js
// 台鐵怎麼問（vi 選單「tàu hoả」鍵用；zh 使用者走 traTrain.usage() 不經此表）
const TRA_USAGE = {
  'zh-TW':
    '🚆 台鐵時刻查詢可以這樣問：\n' +
    '・台鐵 台北 台中（近期班次，最多 5 筆）\n' +
    '・下一班 台北到花蓮（只看最近一班）\n' +
    '支援主要幹線車站；僅查今天、當下時間之後的班次。',
  vi:
    '🚆 Tra giờ tàu Đài Loan — bạn có thể hỏi bằng tiếng Việt, ví dụ:\n' +
    '・「tàu từ Tân Trúc đến Trung Lịch」(các chuyến sắp tới hôm nay)\n' +
    '・「tàu từ Tân Trúc đến Trung Lịch ngày mai」\n' +
    '・「chuyến tàu tiếp theo từ Đài Bắc đến Hoa Liên」(chỉ chuyến gần nhất)\n' +
    'Nhắn chữ hoặc gửi tin nhắn thoại đều được nhé! 🎙\n' +
    'Cũng có thể dùng lệnh tiếng Trung: 「台鐵 台北 台中」「下一班 台北到花蓮」.',
  en:
    '🚆 Taiwan Railway timetable — ask like:\n' +
    '・"train from Hsinchu to Zhongli" (upcoming trains today)\n' +
    '・"next train from Taipei to Hualien"\n' +
    'Text or voice both work. Chinese commands also work: 「台鐵 台北 台中」「下一班 台北到花蓮」.',
};

// 「想查哪裡的天氣」引導（vi 選單「thời tiết」鍵用）
const WEATHER_ASK = {
  'zh-TW': '🌤 想查哪裡的天氣呢？請輸入「天氣 城市名」，例如：天氣 台北市',
  vi:
    '🌤 Bạn muốn xem thời tiết ở đâu? Hãy nhắn 「thời tiết + tên thành phố」,\n' +
    'ví dụ: 「thời tiết Đài Bắc」. Nhắn chữ hoặc nói bằng tin nhắn thoại đều được!',
  en: "🌤 Which city's weather? Type \"weather + city\", e.g. \"weather Taipei\".",
};
```
Getter（加進 module.exports）：
```js
function traUsage(code) {
  if (TRA_USAGE[code]) return TRA_USAGE[code];
  if (code === 'ja' || code === 'th' || code === 'id') return TRA_USAGE.en;
  return TRA_USAGE['zh-TW'];
}
function weatherAsk(code) { /* 同模式 */ }
```

---

## 4. 選單定義（最終版，逐格核對過路由）

### menu-zh-v1（預設，全體）— chatBarText「選單」
| 格 | 圖上標籤 | 點擊送出 | 命中路由（handler.js 現行程式核對） |
|---|---|---|---|
| 1 | 台鐵查詢 | `台鐵查詢` | `/^(?:台鐵\|臺鐵\|火車)查詢$/` → `traTrain.usage()` ✅ |
| 2 | 加油站 | `加油站` | 加油站區塊 → 有位置直查／分享位置提示＋按鈕 ✅ |
| 3 | 油價 | `油價` | `/^(?:油價\|…)$/` → `fuelPrice.lookup()` ✅ |
| 4 | 今天吃什麼 | `今天吃什麼` | `trimmed === '今天吃什麼'` → `food.suggest()` ✅ |
| 5 | 天氣 | `天氣` | `/^(?:天氣\|weather)\s*(.*)$/` 空參數 → `getWeather('')` → 回「請告訴我地名，例如：天氣 台北市」（weather.js L55，確定性引導）✅ |
| 6 | 選單 | `選單` | help 路由 → `lang.helpMenu` ✅ |

### menu-vi-v1（語言=vi 者連結）— chatBarText「Menu」
| 格 | 圖上標籤 | 點擊送出 | 命中路由 |
|---|---|---|---|
| 1 | Giờ tàu | `tàu hoả` | **新增** `^tau hoa$` → `lang.traUsage(code)`（§3.5e）|
| 2 | Trạm xăng | `trạm xăng` | **擴充** 加油站條件 `^tram xang$`（§3.5d）|
| 3 | Tỷ giá | `tỷ giá` | 既有 `^ty gia$` → `exchangeRate.lookup('TWD VND')` ✅ |
| 4 | Giá xăng | `giá xăng` | 既有 `^gia (?:xang\|dau)$` → `fuelPrice.lookup()` ✅ |
| 5 | Thời tiết | `thời tiết` | **新增** `^thoi tiet$` → `lang.weatherAsk(code)`（§3.5e）|
| 6 | Trợ giúp | `trợ giúp` | 既有 help 路由 ✅ |

語言偵測連動核對：六個 vi 送出字串都含 `lang.detect` 的 vi 特有字元
（ả/ạ/ỷ/ờ/ế/ợ ∈ U+1EA0–U+1EF9，ă 在明列清單）→ 點按鈕本身會維持/觸發 lang=vi，選單不會被誤切回中文。✅

---

## 5. 圖片設計規格
- 兩張皆 2500×1686 PNG（LINE 合法尺寸；長寬比 2500/1686 ≈ 1.483 ≥ 1.45 下限 ✅）。
- 3×2 色塊格（色盤與版位見 §3.2），白色粗體標籤 **120px**，置中；不含 emoji。
- zh 字型 `Microsoft JhengHei`；vi 字型 `Segoe UI`（POC 驗證渲染正確）。
- 檔案大小預期 ~70–90 KB（平色塊壓縮佳；POC 實測 71,320 bytes）。

---

## 6. 失敗處理與冪等（重點）
- `ensureSetup` / `ensureFor` **永不 throw**：全 body try/catch → console.error；index.js 不 await → 開機零影響。
- **richmenu 存在 LINE 伺服器端，不在 Render 磁碟**。Render 重啟/重部署後：
  `ensureSetup` 用 `getRichMenuList` 依**名稱**找回、只補缺的 → 冪等，不重複建立。
  richMenuId 一律 RAM 快取（`idByName`），絕不落地。
- 建立三步（create → 上傳圖 → 設預設）非原子：上傳失敗即刪掉剛建的（§3.1 步驟 2c 回滾），
  避免留下「有名稱沒圖」的殭屍選單卡死冪等判斷。
- `setDefaultRichMenu` 每次開機重打一次：自我修復、成本 1 呼叫。
- `linkedState` 重啟清空：每位使用者重啟後第一則訊息多 1 次 link/unlink 呼叫（含 zh 使用者的一次
  無害 unlink——換來「重啟期間切過語言」也能自我修復），之後去重。家庭人數規模下可忽略。
- token 無效/斷網：getRichMenuList 抛錯 → 整體 catch → log 後正常返回；驗收 6 以此驗證。

## 7. 版本策略
- 名稱帶 `-v1`。日後改版面：程式裡把名稱換成 `-v2` → 部署後 ensureSetup 找不到 `-v2` 就新建並設預設；
  **舊 `-v1` 需一次性手動清理**（tester 的清單/刪除腳本即可：`getRichMenuList` 找名稱 `-v1` → `deleteRichMenu(id)`）。
  本輪**不**實作自動遷移/自動刪舊（文件化即可）。

## 8. 測試策略（對應 PRD 驗收 1–7）

1. **SDK 契約**：重跑 §1.1 的 `node -e` 清單腳本，斷言 7 個目標方法都在；本 DESIGN 已含 .d.ts 逐字簽章。
2. **圖片**：兩張 PNG 存在於 `assets/richmenu/`；驗 signature 與尺寸（見 3）；bytes < 1,048,576；
   人工看圖確認中文與 vi diacritics（tester 於 TEST.md 附截圖或描述確認）。
3. **PNG 頭精確 offset 數學**（免依賴任何套件）：
   - bytes 0–7：signature `89 50 4E 47 0D 0A 1A 0A`；bytes 8–11：IHDR chunk 長度；bytes 12–15：`"IHDR"`；
   - **bytes 16–19：寬（big-endian）；bytes 20–23：高（big-endian）**。
   - Node 驗法（建議，最不容易踩坑）：
     ```js
     const b = fs.readFileSync(p);
     b.readUInt32BE(16) === 2500 && b.readUInt32BE(20) === 1686
     ```
   - PS 驗法必須 `[int]` 乘法：`[int]$b[16]*16777216 + [int]$b[17]*65536 + [int]$b[18]*256 + [int]$b[19]`
     （⚠️ PS 5.1 `($b[18] -shl 8)` 對 byte 會截斷，實測得 196≠2500，勿用）。
4. **richMenu 單元（stub，不打真 API）**：以 `_internal.deps` 換成記錄呼叫的假 client：
   - getRichMenuList 回兩個同名選單 → `ensureSetup()` 後 createRichMenu 呼叫數 0、setDefaultRichMenu 1（冪等）。
   - getRichMenuList 回空 → create 2、setRichMenuImage 2（並斷言收到的 body 是 Blob、type 為 image/png）、setDefault 1。
   - setRichMenuImage 抛錯 → deleteRichMenu 被呼叫（回滾）、ensureSetup 正常 resolve。
   - `ensureFor(u,'vi')` → link 1 次；再呼叫同參數 → 仍 1 次（RAM 去重）；
     `ensureFor(u,'zh-TW')` → unlink 1 次；連續交錯呼叫 → 依序執行（inflight 串行）。
   - getRichMenuList 抛錯（模擬斷網/壞 token）→ ensureSetup 不抛、程序不死（驗收 6）。
5. **真實 API 煙霧測試**（tester 用 .env 真 token；此頻道為正式家庭頻道，注意）：
   - 跑一次 `ensureSetup()` → `getRichMenuList` 應看到 `menu-zh-v1`、`menu-vi-v1`；
     `getDefaultRichMenuId()` 應為 zh 的 id。再跑一次 ensureSetup → 清單數量不變（冪等實證）。
   - （可選）對測試 userId `linkRichMenuIdToUser` / `unlinkRichMenuIdFromUser` 各一次，斷言不抛錯。
   - **清理原則**：若 tester 另建拋棄式選單，一律命名 `menu-test-*`，測後
     `getRichMenuList` 過濾 `name.startsWith('menu-test-')` → `deleteRichMenu(id)` 逐一刪除；
     **嚴禁誤刪 `menu-zh-v1` / `menu-vi-v1`**（那是正式選單）。
6. **新 vi 路由**（直接呼叫 `handler.handleText`）：
   - `tàu hoả` → 回文含 `Tân Trúc`（vi 台鐵說明）；`thời tiết` → 回文含 `thời tiết ở đâu`；
   - `trạm xăng` → 回 `{text, quickReply}` 且 quickReply 為 location action；
   - zh 不回歸：`台鐵查詢`／`油價`／`天氣`／`加油站`／`今天吃什麼`／`選單` 輸出同改動前。
7. `node --check`：richMenu.js、handler.js、lang.js、index.js 全過；產圖腳本實際執行一次成功。

## 9. 風險與明確告知事項
- **預設選單影響「所有」既有使用者**：merge 部署後，家裡每個人的聊天室底部都會出現中文選單。
  這是本 PRD 的**刻意 UX 變更**，但要在 PR 說明裡讓使用者（家庭管理者）知道。
- 點選單＝**送出一則看得見的文字訊息**（LINE message action 的正常行為），不是隱形操作。
- 圖片 1MB 上限：實測 ~71KB，餘裕 14 倍，無風險。
- 速率限制：richmenu 管理類 API 配額較低（百次/小時等級）；本設計開機至多 ~6 呼叫、
  link/unlink 有 RAM 去重＋每人串行，遠低於限制。
- richmenu 數量上限 1000/頻道：本案固定 2 個，無虞。
- 產圖只在 Windows 開發機跑（System.Drawing 依賴 GDI+），Render 上完全不需要——PNG 已 commit。
- Node 版本：Render engines `22.x`、本機 v26 → 全域 `Blob` 皆可用，無 polyfill。

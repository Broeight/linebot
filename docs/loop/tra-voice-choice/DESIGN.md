# 技術設計：越南家人「語音查火車 + 相近站名用選的」（tra-voice-choice）（DESIGN）

**版本** v1.0 | **日期** 2026-07-01 | **作者** 軟體架構師（RD#1）
**對應 PRD** `docs/loop/tra-voice-choice/PRD.md`
**分支** `feat/tra-voice-station-choices`

---

## ✅ 需要金鑰：否

維持既有「免金鑰」風格：站名清單沿用既有 `fetchStations()`（PTX `Station` 端點，免金鑰、快取 24h），
時刻查詢沿用既有 `fetchOdTrains()`（PTX `DailyTrainTimetable/OD`，免金鑰）。本案**不新增任何 API、金鑰、環境變數**。

---

## 〇、一句話總結

在既有 `traTrain.js` 的 `normalizeStation`（精準命中）之外，新增一支**模糊比對** `suggestStations(token, max)`，
在 AI 工具 `get_tra_train` 內偵測「某一站精準辨識失敗但有 ≥2 個相近候選」時，把「已知站 + 日期 + 候選清單」寫進
**記憶體 pending-choice 狀態機**（新模組 `src/services/traChoice.js`，仿 `conversation.js` 的 in-RAM 模式，
TTL 3 分鐘、每人一筆）。handler 偵測到「本回合剛產生 pending」時，**用自己的多語言提示句 + LINE Quick Reply 按鈕**
覆寫模型輸出（不依賴模型自己排按鈕）。使用者**點按鈕 / 打站名 / 回數字**後，handler 在正常路由前先攔截，
用 pending 完成查詢並清除。回覆管線升級：handler 函式可回 `string` 或 `{ text, quickReply }`，`index.js` 依型別組訊息。

---

## 一、受影響檔案清單（file-by-file change list）

| 檔案 | 動作 | 為什麼／改什麼 |
|---|---|---|
| `src/services/traChoice.js` | **新增** | 純記憶體 pending-choice 狀態機（`set`/`get`/`clear`/`consumeFresh`/`matchCandidate`），仿 `conversation.js` 的 `Map` 模式。放 `services/` 目錄符合慣例。**不用 `store.js`／不落地**（PRD §不做：記憶體即可、Render 重啟清空可接受）。 |
| `src/services/traTrain.js` | **修改** | 新增並匯出 `suggestStations(token, max)`（模糊比對，回 `[{name,id}]`）；新增並匯出 `getTraTrainByIds({fromId,toId,fromName,toName,nextOnly,day})`（**以站碼直接查時刻**，供 pending 完成查詢用，重用既有 `fetchOdTrains`）；`getTraTrainSummary` 增加「回結構化歧義結果」的能力（見 §五）。既有 `normalizeStation`、`fetchStations`、`VN_ALIAS`、`toAscii` 全部重用，不改行為。 |
| `src/tools.js` | **修改** | `get_tra_train` 的 `run()` 分支：站名精準辨識失敗時呼叫 `suggestStations`，若 ≥2 候選則呼叫 `traChoice.set(userId, ...)` 記錄 pending，並回一段**帶標記的英文字串**告知模型「已請使用者選站、不要自行編站名」。`tools.run` 已有 `userId`，直接沿用。 |
| `src/handler.js` | **修改** | (a) `handleText` 在**所有指令路由之前**先攔截「pending 命中」（點選 / 數字 / 打站名）→ 直接完成查詢回字串；(b) `handleText` 在 AI fallback 之後，若 `traChoice.consumeFresh(userId)` 為真 → 把回覆改成 `{ text: 多語言提示, quickReply }`；(c) `handleAudio` 讓 `{text,quickReply}` 穿透（語音前綴只包 `text`）；(d) `replyForEvent`／回傳型別註記由 `Promise<string>` 放寬為 `Promise<string \| {text,quickReply} \| null>`。 |
| `src/index.js` | **修改** | `handleEvent` 依回傳型別分支：字串走舊路；`{text,quickReply}` 組成帶 `quickReply` 的 text 訊息。保留既有「空回覆不送」與「Array.from 5000 字 emoji-safe 截斷」。 |
| `src/lang.js` | **修改** | 新增 `chooseStationPrompt(code)`（「您是指哪一站？」多語言）與 `chosenStationLabel`（可選；用於把選站確認前綴多語化，非必要）。新增對外匯出。 |

> **決策：pending 狀態獨立成 `src/services/traChoice.js`，不折進 `traTrain.js`。**
> 理由：`traTrain.js` 目前是「純查詢、無 per-user 狀態」的服務，保持它無狀態/可離線測試較乾淨；
> pending 是「per-user、有 TTL、會被 handler 攔截」的對話狀態，性質更接近 `conversation.js`，獨立模組職責清楚、易單獨測試。
> `traTrain.js` 只新增兩支**無狀態純/查詢函式**（`suggestStations`、`getTraTrainByIds`）。

---

## 二、回覆管線變更（reply-pipeline change）

### 2.1 契約：handler 函式回傳型別放寬

現況：`handleText` / `handleAudio` / `handleImage` / `replyForEvent` 回 `Promise<string>`。
新契約：回 `Promise<string | { text: string, quickReply: object } | null>`。

- 絕大多數路徑仍回**字串**（完全不動）。
- 只有「本回合要附選站按鈕」時回 `{ text, quickReply }`。
- `null` 維持「不回覆」語意（貼圖/影片等）。

### 2.2 quickReply 物件的精確形狀（@line/bot-sdk v11 messagingApi）

`quickReply` 掛在**訊息物件**上（不是在 message 陣列外層），形狀固定為：

```
quickReply: {
  items: [
    { type: 'action', action: { type: 'message', label: '新竹', text: '新竹' } },
    { type: 'action', action: { type: 'message', label: '竹南', text: '竹南' } },
    { type: 'action', action: { type: 'message', label: '竹北', text: '竹北' } }
  ]
}
```

- `items`：本案 **≥2、≤5** 顆（PRD 驗收 §2；LINE 上限 13，但本案設 5 上限）。
- `label`：顯示在按鈕上，**≤20 字**（LINE 硬限制）。台鐵中文站名皆短，天然安全；仍在 handler 組按鈕時對 label 做 `slice` 保護。
- `action.text`：點下去會被 LINE 當成「使用者送出的文字訊息」再打回 webhook，畫面也顯示此 text。
  **本案 `label` 與 `text` 都用候選的中文站名**（如「新竹」），這樣「點按鈕」與「手打站名」走完全相同的攔截邏輯（§四）。

### 2.3 `index.js` `handleEvent` 分支（保留既有字串路徑與截斷）

在既有第 43–51 行區塊改為（描述，不是最終碼）：

1. `const reply = await handler.replyForEvent(event);`
2. **正規化成 `{ text, quickReply? }`**：
   - 若 `reply` 為 `null`／`undefined` → return（不送）。
   - 若 `typeof reply === 'string'` → `text = reply`，`quickReply = undefined`。
   - 若 `reply` 是物件 → `text = reply.text`，`quickReply = reply.quickReply`。
3. `if (!text || !text.trim()) return;`（維持既有：空字串不送，避免 LINE 400）。
4. `const clipped = Array.from(text).slice(0, 5000).join('');`（維持既有 emoji-safe 截斷）。
5. 組訊息物件：`const message = { type: 'text', text: clipped };` `if (quickReply) message.quickReply = quickReply;`
6. `await lineClient.replyMessage({ replyToken: event.replyToken, messages: [message] });`
7. catch 區塊維持不變（錯誤時仍回字串錯誤訊息，`replyToken` 一次性）。

> **回歸保證（PRD 驗收 §3）**：字串回覆路徑除了「先正規化成 text」外行為完全不變（同樣的空字串守門、同樣的 5000 字截斷），
> `quickReply` 只有在物件回傳時才附加，聊天等一般回覆不受影響。

---

## 三、`suggestStations(token, max)` 演算法

**位置**：`src/services/traTrain.js`，匯出（供離線測試）。
**簽章**：`async suggestStations(token: string, max = 5): Promise<Array<{ name: string, id: string }>>`

### 3.1 輸入與前置

- `token`：使用者說/打的單一站名片段（走音、不完整、拼音、中英越皆可能）。空字串/空白 → 回 `[]`。
- 先去除結尾贅字（`(車站|站)$`）與前後空白，與 `normalizeStation` 一致；把 `臺`→`台`。
- 建立比對用的正規化鍵：`q = toAscii(token).replace(/\s+/g, '')`（去聲調、小寫、Đ→d、去空白）。`q` 為空 → 回 `[]`。

### 3.2 候選來源（全部重用既有資料，免付費）

- `const maps = await fetchStations();`（PTX 245 站；抓不到時**退回內建 `STATIONS`**主要站，保證離線/斷網仍有基本候選）。
- 對每一站建立可比對的「表面字串集合」：
  1. **中文站名**（`maps.zh` 的 key，如「新竹」）→ 正規化鍵 `toAscii('新竹')`（中文 toAscii 後不變、但去空白）。中文字串比對主要靠「包含」與「相等」。
  2. **英文站名**（`maps.en` 的 key，如「hsinchu」）→ 已小寫，`replace(/\s+/g,'')`。
  3. **越南語漢越音別名**：反查 `VN_ALIAS`（值＝中文站名），把每個別名 key（如「tan truc」）`toAscii`+去空白（→「tantruc」）掛到對應中文站的表面集合。

  > `VN_ALIAS` 只涵蓋主要站；這正好讓越南語走音優先落在家人常用的主要站上（符合場景）。

### 3.3 計分（每站取其表面集合中的**最高分**）

對站 `S`，對其每個表面字串 `surf` 與 `q` 計 `score(q, surf)`，取最大值。建議分數（0–100，越高越像）：

1. **完全相等** `q === surf` → 100（但這種通常 `normalizeStation` 已精準命中，不會進到 suggest；仍保留以防萬一）。
2. **前綴相符** `surf.startsWith(q)` 或 `q.startsWith(surf)`（且較短者長度 ≥2）→ 90 - 兩者長度差（獎勵「truc」→「tantruc」「truc nam→trucnam」這種開頭吻合）。
3. **子字串包含** `surf.includes(q)` 或 `q.includes(surf)`（`q` 長度 ≥3）→ 75。
4. **編輯距離（Levenshtein）**：`d = lev(q, surf)`；`sim = 1 - d / max(len)`；若 `sim >= 0.5` → `50 + round(sim*40)`（涵蓋「sin zu」↔「hsinchu」「xinzhu」這種音變）。低於 0.5 → 0（不列入）。

> `lev` 為本檔內私有純函式（標準 DP，字串長度都很短，成本可忽略）。
> 針對「中文單字站名」：中文 query 少見走音，主要靠相等/包含；音譯走音走英文/越南語表面字串比對。

### 3.4 門檻、去重、排序、回傳

- **收集**：對每站算最高分，`score > 0` 者納入 `{ name, id, score }`。
- **去重**：以 `id` 去重（同站多個表面字串只留最高分那筆）。`name` 一律用中文站名（`maps.zh` 的顯示名）。
- **排序**：`score` 由高到低；同分時中文名長度短者優先（主要站通常名短），再以中文名字典序穩定排序。
- **`slice(0, max)`**（本案 `max=5`）。
- **回傳** `[{ name, id }]`（丟掉 score）。

### 3.5「精準單一 → 跳過選單」的判定（呼叫端負責，見 §五）

`suggestStations` 只負責「給候選」；**是否精準**由呼叫端先跑 `normalizeStation`：

- `normalizeStation(token)` 命中（非 null）→ 精準，**不進 suggest、不跳選單**（PRD 驗收 §1「已能唯一辨識者照舊直接查」：`新竹`/`tân trúc`/`Hsinchu`）。
- 精準失敗 → 跑 `suggestStations`：
  - 回 `≥2` → 進選單流程（記 pending + 按鈕）。
  - 回 `1`（單一相近）→ **本案採「仍列成 1 顆按鈕請使用者確認」**（PRD §不做：不做「猜一個直接查」，避免猜錯）。故門檻是「≥1 就給按鈕」；PRD 驗收 §2 要求「≥2、≤5」是針對「一站已知、另一站要選」的主案例，實務上走音多會回多顆。若只回 1 顆，仍呈現按鈕讓使用者一鍵確認，語意安全。
  - 回 `[]`（如 `zzzzzz` 亂碼）→ **不進選單**，回既有「請提供明確站名」訊息（PRD 驗收 §1 第三點）。

> **離線可測性**：`suggestStations('tan chu')`/`'truc'`/`'sin zu'`/`'hsin'` 需連 PTX 取 245 站（或退回內建站）；
> 亂碼 `'zzzzzz'` → `[]` 可離線斷言（內建站集合也不會命中）。

---

## 四、Pending-choice 狀態機（`src/services/traChoice.js`）

仿 `conversation.js`：模組級 `const pending = new Map();`（key = `userId`）。**每人一筆**（新的覆蓋舊的）。

### 4.1 記錄形狀

```
{
  known: { role: 'from' | 'to', name, id },   // 已精準辨識的那一站（哪一端 + 站名 + 站碼）
  ambiguousRole: 'from' | 'to',               // 需要使用者選的是哪一端（與 known.role 相反）
  candidates: [ { name, id }, ... ],          // suggestStations 結果（2–5 筆；亦可能 1 筆）
  nextOnly: boolean,                          // 沿用原查詢：下一班 vs 多筆
  day: 'today' | 'tomorrow',                  // 沿用原查詢日期
  ts: number,                                 // Date.now()，判 TTL 用
  fresh: boolean,                             // 「本回合剛建立」旗標，handler 用來決定是否附按鈕
}
```

> `known` 記「哪一端」是必要的：使用者可能是「from 已知、to 要選」或「to 已知、from 要選」。
> 完成查詢時要把 chosen 填回正確的那一端，才能用正確的起訖順序查時刻。

### 4.2 API（全部同步、純記憶體）

| 函式 | 行為 |
|---|---|
| `set(userId, record)` | `record.ts = Date.now(); record.fresh = true;` `pending.set(userId, record)`。覆蓋舊筆（每人一筆）。 |
| `get(userId)` | 回該筆或 `undefined`；**讀取時先判 TTL**：若 `Date.now() - ts > TTL_MS` → `clear` 後回 `undefined`（惰性過期）。 |
| `clear(userId)` | `pending.delete(userId)`。 |
| `consumeFresh(userId)` | 若存在且 `fresh` 為真 → 設 `fresh=false` 並回 `true`；否則回 `false`。（handler 用它「一次性」決定是否附按鈕，避免下一則不相干訊息又附按鈕。） |
| `matchCandidate(userId, text)` | 見 §4.3；回 `{ name, id }`（命中的候選）或 `null`（未命中 → 不當作選擇）。 |

`TTL_MS = 3 * 60 * 1000`（3 分鐘，PRD §不做建議值）。

### 4.3 後續訊息如何對應到候選（`matchCandidate`）

輸入 `text`（使用者這則訊息，去空白 trim）。取 `p = get(userId)`（已含 TTL 檢查）；無 → 回 `null`。依序：

1. **數字回覆** `1..N`：`text` 為純數字且 `1 <= n <= candidates.length` → 回 `candidates[n-1]`。（支援 PRD「回覆數字」。）
2. **站名精準相符**：把 `text` 正規化（`臺→台`、去 `(車站|站)$`），與每個 `candidate.name` 比對；相等 → 該候選。
   （**點按鈕**送回的正是 `candidate.name`，走這條，穩定命中。）
3. **候選內模糊相符（寬鬆）**：把 `toAscii(text)` 去空白，與每個候選的中文名 `toAscii` 去空白比對「相等或互為前綴」→ 命中。
   （容忍使用者「再打一次仍略走音、但已在候選集合內」。範圍**限縮在候選 2–5 筆內**，不會誤命中全表。）
4. 皆不中 → 回 `null`（handler 據此**放行走正常路由**，不誤判為選站）。

### 4.4 完成查詢（handler 端）

當 `matchCandidate` 回 `chosen`：

1. 由 `p.known` 與 `p.ambiguousRole` 組出正確起訖站碼：
   - 若 `ambiguousRole === 'from'` → `fromId = chosen.id, fromName = chosen.name; toId = p.known.id, toName = p.known.name`。
   - 若 `ambiguousRole === 'to'` → 反之。
2. 呼叫 `traTrain.getTraTrainByIds({ fromId, toId, fromName, toName, nextOnly: p.nextOnly, day: p.day })`
   → 回**已格式化的字串**（見 §五 5.3）。
3. `traChoice.clear(userId)`（用完即清）。
4. handler 回該字串（純字串，無 quickReply）。

### 4.5 何時清除 / 忽略 pending

- **命中候選並完成查詢** → `clear`。
- **TTL 過期**（>3 分鐘）→ `get`/`matchCandidate` 惰性回 `undefined`/`null`，該筆視同不存在（下次 `set` 覆蓋，或閒置留在 Map 亦無害，量極小）。
- **送出不相干訊息**（`matchCandidate` 回 `null`）→ **不清除**（保留 3 分鐘容錯，讓使用者仍可稍後點按鈕），但**放行走正常路由**（該訊息照常被當普通指令/聊天處理）。
- **新的、不相關的台鐵查詢又觸發歧義** → `set` 直接覆蓋舊 pending（每人一筆，最新優先）。
- **Render 重啟** → Map 清空，pending 全失（PRD 明訂可接受）。

---

## 五、歧義偵測在哪裡（where ambiguity is detected）

**主要路徑：AI 工具 `get_tra_train`**（越南家人走語音→Whisper→AI→工具這條）。

### 5.1 `tools.run` 的 `get_tra_train` 分支改法

`run(userId, name, argsJson)` 已有 `userId`。新流程（在 `case 'get_tra_train':` 內，取代直接呼叫 `getTraTrainSummary`）：

1. 解析 `from`、`to`、`next_only`、`day`（同現況）。
2. 各跑 `normalizeStation`：`fromSt = await normalizeStation(a.from)`、`toSt = await normalizeStation(a.to)`。
3. **兩站都精準** → 照舊呼叫既有 `getTraTrainSummary`（或直接 `getTraTrainByIds`）回英文摘要（**完全不回歸**，PRD 驗收 §5）。
4. **恰一站不精準**（另一站精準）→ 對不精準的 token 跑 `suggestStations(token, 5)`：
   - `≥1` 候選 → **記 pending**：
     ```
     traChoice.set(userId, {
       known: { role: (fromSt ? 'from' : 'to'), name: knownSt.name, id: knownSt.id },
       ambiguousRole: (fromSt ? 'to' : 'from'),
       candidates,
       nextOnly: a.next_only === true,
       day: a.day === 'tomorrow' ? 'tomorrow' : 'today',
     });
     ```
     回給模型一段**帶標記的英文字串**，例如：
     `"NEEDS_STATION_CHOICE: Asked the user to pick the correct station for \"<token>\". Do not guess or invent a station; a button menu will be shown. Reply briefly acknowledging you need them to choose."`
     （這段是給模型看的；但**最終按鈕與提示由 handler 覆寫**，見 5.2，故不依賴模型排版。）
   - `[]`（亂碼）→ 回既有「站名無法辨識」英文字串（模型用越南語轉述請使用者給明確站名）。
5. **兩站都不精準**（edge case，見 §八）→ **一次只問一端，先問 `from`**：對 `from` token 跑 `suggestStations`，記 pending（`ambiguousRole='from'`），但 `known` 端此時「未知」。
   > 為維持 `known` 一定有值的簡單模型，採**簡化規則**：兩站都不精準時，`known` 暫存「`to` 的原始 token 字串」而非站碼，
   > 待使用者選定 `from` 後，handler 完成查詢前**再對 `to` 跑一次 `normalizeStation`**；若 `to` 仍不精準，則**接著對 `to` 起新一輪 pending**（連續兩次選站）。
   > 為降低複雜度，第一版**建議**：兩站都不精準時，直接回「請分別給明確的起站與迄站」英文提示，先不做雙輪選單（PRD 主案例是「一站可辨識、另一站要選」）。雙輪列為 §八 風險/後續。

### 5.2 handler 如何「確定性」渲染選單（不依賴模型排按鈕）

在 `handleText` 的 **AI fallback 之後**（現第 232–238 行）新增：

```
const reply = await ai.chat(...);        // 模型的文字（可能只是「好的，請選一下」）
conversation.append(userId, 'assistant', reply);
if (traChoice.consumeFresh(userId)) {    // 本回合剛因歧義建立 pending
  const p = traChoice.get(userId);
  const code = await lang.resolve(userId);
  const promptText = lang.chooseStationPrompt(code);          // 「您是指哪一站？」該語言版
  const quickReply = buildQuickReply(p.candidates);           // ≤5 顆，label/text=中文站名
  return { text: promptText, quickReply };                    // ★ 覆寫模型文字，附按鈕
}
return reply;
```

- **`buildQuickReply(candidates)`**（handler 內小工具）：`{ items: candidates.slice(0,5).map(c => ({ type:'action', action:{ type:'message', label: c.name.slice(0,20), text: c.name } })) }`。
- **為何覆寫模型文字**：模型不一定會、也不該負責排 LINE 按鈕 JSON；由 handler 直接組 quickReply 最可靠、可測、多語言一致（PRD 驗收 §2）。
  模型那句話丟棄不用（避免出現「請選一下」+ 另一串奇怪內容）；`promptText` 用 `lang.chooseStationPrompt` 保證是使用者語言的一句話。

### 5.3 pending 命中後的完成查詢：`getTraTrainByIds`（新，keyless）

**位置**：`src/services/traTrain.js`，匯出。**簽章**：
`async getTraTrainByIds({ fromId, toId, fromName, toName, nextOnly, day }): Promise<string>`（回**已格式化的中文字串**）。

- 重用既有 `fetchOdTrains(fromId, toId, date)`（keyless；`date` 由 `day` 決定：`tomorrow` 用 `addOneDay`）。
- 過濾/排序用既有 `filterAndSort`（`nextOnly ? 1 : MAX_RESULTS`）。
- **輸出格式沿用 `lookup`／`nextTrain` 的中文樣式**（含兩站中文名，PRD 驗收 §2「回台鐵班次字串（含兩站中文名）」），
  例：`🚆 台鐵 新竹 → 中壢（07/02）...` 或 `🚆 下一班 新竹 → 中壢 ...`。
- **語言備註**：pending 完成走 handler 直接回字串（非經模型），故用**中文格式字串**即可（家人看得懂站名/時間；PRD 驗收只要求「含兩站中文名的班次字串」）。
  若要更貼近使用者語言，可後續把此字串再過一次翻譯，但**第一版不做**（保持 keyless、低延遲、確定性）。

> **`getTraTrainSummary` 是否需要「resolve by id」helper？** 是——但實作為**新函式 `getTraTrainByIds`**（如上），
> 而非改 `getTraTrainSummary` 的簽章（`getTraTrainSummary` 維持 `{from,to,...}` 給精準路徑用，不回歸）。
> 兩者共用底層 `fetchOdTrains`+`filterAndSort`+`duration`，不重複邏輯。

---

## 六、語音（Voice）

`handleAudio`（現第 242–258 行）目前：`const answer = await handleText(...); return \`${prefix}「${text}」\n\n${answer}\`;`

改法（讓 `{text,quickReply}` 穿透，前綴只包 text）：

```
const answer = await handleText(userId, text);   // 可能是 string 或 {text, quickReply}
const code = await lang.resolve(userId);
const prefix = `${lang.audioPrefix(code)}「${text}」\n\n`;
if (answer && typeof answer === 'object' && answer.quickReply) {
  return { text: prefix + answer.text, quickReply: answer.quickReply };   // ★ 按鈕原封不動
}
return prefix + (typeof answer === 'string' ? answer : (answer?.text ?? ''));
```

- **語音前綴只包 `text`**，`quickReply` 直接沿用 `handleText` 回傳的那個物件（PRD 驗收 §4：按鈕不可因語音前綴遺失）。
- `handleImage` 不涉及選站，維持回字串，不動。

---

## 七、測試策略（對應 PRD §驗收條件 1–6）

> 專案慣例：獨立 `node` 腳本放 `tests/`（見 holiday/tra-train 的 TEST.md）。純函式離線測、狀態機純記憶體測、線上煙霧測分開。

### 7.1 對應驗收條件 1（模糊比對 `suggestStations`）

- `suggestStations('tan chu')` / `suggestStations('truc')` → 陣列含 `新竹`，且 `新竹` 排在前段（斷言 `result[0].name === '新竹'` 或 `新竹` index ≤1）。
- `suggestStations('sin zu')` / `suggestStations('hsin')` → 含 `新竹`。
- `suggestStations('zzzzzz')` → `[]`（**離線可測**：內建站集合亦不命中）。
- **回傳形狀**：每筆含 `name`（字串）與 `id`（字串、保前導零）；`length <= max`；`id` 去重。
- **精準不進選單**：`normalizeStation('新竹')`/`('tân trúc')`/`('Hsinchu')` 皆非 null（既有函式，回歸斷言），呼叫端據此不跑 suggest。
- （需連 PTX 取 245 站；`'zzzzzz'→[]` 與內建站可離線。）

### 7.2 對應驗收條件 2（選單流程 / 狀態機）

- **建立 pending**：模擬「一站精準、一站需選」→ `traChoice.set` 後 `get(userId)` 回含 `known`、`ambiguousRole`、`candidates(≥2、≤5)`、`day`、`nextOnly`、`ts`、`fresh:true`。
- **附按鈕**：`consumeFresh(userId)` 第一次回 `true`（且之後回 `false`）；`buildQuickReply(candidates)` 產出 `items.length` 介於 2–5、每顆 `action.type==='message'`、`label===text===中文站名`、`label.length<=20`。
- **點選完成查詢**：`matchCandidate(userId, '新竹')` 回 `{name:'新竹',id:'1210'}`；handler 完成流程後回**含兩站中文名的班次字串**，且 `get(userId)` 變 `undefined`（已 `clear`）。
- **數字完成**：`matchCandidate(userId, '1')` 回第 1 個候選。
- **過期不誤判**：手動把 `ts` 設成 4 分鐘前 → `get`/`matchCandidate` 回 `undefined`/`null`。
- **不相干訊息不誤判**：pending 存在時送「今天天氣如何」→ `matchCandidate` 回 `null`，該訊息走正常路由（天氣）。

### 7.3 對應驗收條件 3（回覆管線）

- `index.js` 分支（可抽成可測 helper 或以假 `lineClient` spy 測）：傳入 `{text:'x', quickReply:{items:[...]}}` → `replyMessage` 收到 `messages[0].quickReply` 存在且 `messages[0].text==='x'`。
- 傳入純字串 → `messages[0]` 無 `quickReply` 鍵，行為與現況相同（回歸）。
- 傳入空字串 / `null` → 不呼叫 `replyMessage`（維持既有守門）。
- 超長字串（>5000）→ `Array.from` 截斷、emoji 不斷裂（回歸）。

### 7.4 對應驗收條件 4（語音）

- `handleAudio` 對「內容觸發選站」的語音：mock `handleText` 回 `{text, quickReply}` → `handleAudio` 回傳物件的 `text` 有語音前綴、`quickReply` 與 `handleText` 回的**同一物件**（深比對相等、`items` 未遺失）。
- 對一般語音：`handleText` 回字串 → `handleAudio` 回字串（前綴 + 內容），行為不變。

### 7.5 對應驗收條件 5（不回歸）

- `台鐵 台北 台中`、`下一班 台北到花蓮` → 走既有 `lookup`/`nextTrain`，回字串班次（不受本案影響）。
- 越南語「tân trúc → trung lì 明天」→ 兩站經 `normalizeStation` 皆精準（`tân trúc→新竹`、`trung li→中壢`）→ **不進選單**，走既有 `getTraTrainSummary` 明天班次。
- 隨便一句聊天 → AI fallback 回字串，`consumeFresh` 為 false，不附按鈕。

### 7.6 對應驗收條件 6（`node --check`）

- 對所有變更檔跑 `node --check`：`traChoice.js`、`traTrain.js`、`tools.js`、`handler.js`、`index.js`、`lang.js`。

### 7.7 端到端點按模擬（tap simulation）

1. 送文字「ngày mai đi tàu từ ga Truc đến Trung Lịch」→ 期望回 `{text:'越南語的「您是指哪一站？」', quickReply:{items:[新竹,竹南,竹北,...]}}`。
2. 送文字「新竹」（模擬點按鈕，LINE 回傳 `action.text`）→ 期望回「🚆 ... 新竹 → 中壢（明天）...」班次字串，且 pending 已清。
3. （可用 `replyForEvent` 以假 event 串起來驗證整條路徑。）

---

## 八、風險與邊界（risks / edge cases）

1. **兩站都歧義**：採**一次問一端、先問 `from`**（§5.1 步驟 5）。第一版**建議直接回「請分別給明確起站與迄站」**（避免雙輪選單的狀態複雜度與使用者困惑）；雙輪選單列為後續。取捨：簡單、可預期 > 少數雙歧義自動化。
2. **Quick reply `label` ≤20 字**：台鐵中文站名皆短，天然安全；仍在 `buildQuickReply` 對 label `slice(0,20)` 防禦。
3. **使用者忽略按鈕**：pending 保留 3 分鐘容錯；期間送不相干訊息走正常路由（不清 pending，仍可回頭點按鈕）；逾時惰性失效。
4. **pending 與新查詢碰撞**：每人一筆，新的 `set` 覆蓋舊的；`consumeFresh` 一次性，確保只有「剛建立那回合」附按鈕。
5. **點按鈕文字與既有指令碰撞**：候選一律是純中文站名（如「新竹」「竹南」），不含「台鐵/下一班」前綴，
   `matchCandidate` 在**所有路由之前**先攔截（pending 存在且命中時），不會被其他指令搶走；不命中才放行。
   （站名如「新竹」本身不是任何既有指令前綴，放行也安全。）
6. **`suggestStations` 依賴 PTX 站表**：斷網時 `fetchStations` 回 null → 退回內建 `STATIONS` 主要站，候選變少但不崩潰；亂碼仍回 `[]`。
7. **Render 重啟清空 pending**：PRD 明訂可接受；使用者重按舊按鈕（送站名文字）時 pending 已無 → `matchCandidate` 回 null → 該站名走正常路由（多半會被當普通聊天，可接受）。
8. **模型不呼叫工具/自行音譯**：既有 tool description 已叮囑「用原文、勿自行音譯」；本案讓 `run` 對「工具實際傳來但不精準」的站名做 suggest，即使模型音譯錯，只要落在候選集合就能被使用者選回；完全走音致 `normalizeStation` 精準命中「錯站」的風險仍存在（既有問題，非本案新增），不擴大處理。
9. **延遲**：完成查詢走 `getTraTrainByIds` 直接查（keyless、有 30 分快取），不再經模型，延遲低。

---

## 九、實作檢核清單（給工程師 RD#2）

- [ ] 新增 `src/services/traChoice.js`：`Map` pending、`set`/`get`（含 TTL 惰性過期）/`clear`/`consumeFresh`/`matchCandidate`（數字 → 精準站名 → 候選內寬鬆），`TTL_MS = 3*60*1000`，`module.exports`。
- [ ] `src/services/traTrain.js`：新增並匯出 `suggestStations(token, max=5)`（§三，含私有 `lev`）與 `getTraTrainByIds({fromId,toId,fromName,toName,nextOnly,day})`（§5.3，重用 `fetchOdTrains`/`filterAndSort`/`duration`/`addOneDay`）；`normalizeStation`/`fetchStations`/`VN_ALIAS`/`toAscii` 不改。
- [ ] `src/tools.js`：`require traChoice`、`suggestStations`、`normalizeStation`、`getTraTrainByIds`（或整包 require `traTrain`）；改 `get_tra_train` 的 `run` 分支（§5.1）：兩站精準走舊路、恰一站不精準且有候選 → `traChoice.set` + 回帶標記英文字串、亂碼 → 回既有辨識失敗字串。
- [ ] `src/handler.js`：(a) `handleText` 最前面加 pending 攔截（`traChoice.matchCandidate` 命中 → `getTraTrainByIds` + `clear` + 回字串）；(b) AI fallback 後 `consumeFresh` → 回 `{text: lang.chooseStationPrompt(code), quickReply: buildQuickReply(p.candidates)}`；(c) 新增 `buildQuickReply` 小工具；(d) `handleAudio` 讓物件穿透（前綴只包 text）；(e) 更新函式回傳型別註解。
- [ ] `src/index.js`：`handleEvent` 依 `string | {text,quickReply}` 分支組訊息，保留空回覆守門與 5000 字 emoji-safe 截斷。
- [ ] `src/lang.js`：新增 `chooseStationPrompt(code)`（zh-TW/vi/en/ja/th/id 六語，vi 為主：如「Bạn muốn hỏi ga nào?」），匯出。
- [ ] **不改** `src/store.js`、`src/config.js`、`.env.example`（免金鑰、pending 不落地）。
- [ ] 自測 §7 各項；`node --check` 全變更檔。

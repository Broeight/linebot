# PRD — 家庭群組翻譯橋（vi ↔ zh 自動互譯）

## 背景
所有功能目前都是「使用者跟 bot 一對一」。但家庭真正的痛點是：**越南家人跟中文家人
在同一個 LINE 群組裡無法溝通**。把 bot 拉進家庭群組後，它應該當「翻譯橋」：
- 她用**越南語**發言（打字或語音）→ bot 立刻在群組附上**中文翻譯**
- 家人用**中文**發言 → bot 立刻附上**越南語翻譯**
全家在同一個群組聊天，不用再各自私訊 bot 翻譯。

## 目標
1. bot 在**群組/多人聊天室**中只做一件事：偵測語言並互譯 vi↔zh（打字＋語音）。
   不閒聊、不執行指令、不 AI 對話——**群組裡保持安靜**，只在需要翻譯時說話。
2. 一對一聊天**完全不受影響**（所有既有功能照舊）。
3. 可開關：群組內「翻譯關／翻譯開」（含越南語 tắt dịch／bật dịch），預設**開**。

## 範圍（要做）

### F1 群組事件路由（handler.replyForEvent）
- `event.source.type === 'group' | 'room'` 的 message 事件 → 走**群組專用**處理
  （`handleGroupText` / `handleGroupAudio`），不進既有 handleText（不碰對話記憶、
  不觸發指令、不觸發 AI、不觸發 richMenu/onboarding hook）。
- 圖片、貼圖等其他型別在群組中一律忽略（回 null）。

### F2 翻譯橋邏輯（handleGroupText）
- **開關指令**（在群組內打）：`翻譯關`/`翻譯開`/`tắt dịch`/`bật dịch` → 切換並以
  **中越雙語**確認。狀態存 `data/groupTranslate.json`（key=groupId；預設開；
  Render 重啟歸零回預設開，可接受）。
- 關閉時 → 全部靜默（null）。
- 語言偵測（重用 `lang.detect` 或等效邏輯）：
  - 越南語 → 翻成繁中，回 `🌐 <中文翻譯>`
  - 中文 → 翻成越南語，回 `🌐 <bản dịch tiếng Việt>`
  - 其他語言、純 emoji、太短（<2 個有效字元）、URL-only → 靜默（null）
- 翻譯用 `ai.ask`（專用 prompt：只輸出譯文、不加解釋）；ai.ask 失敗（回空）→ 靜默，
  **絕不在群組裡吐錯誤訊息洗版**。

### F3 群組語音（handleGroupAudio）
- 群組語音 → Whisper 聽打 → 同 F2 判斷翻譯 → 回 `🎙「原文」\n🌐 <譯文>`。
- 聽不清／非 vi/zh → 靜默。

### F4 加入群組歡迎（join 事件）
- bot 被拉進群組（`event.type === 'join'`）→ 回一則**中越雙語**簡介：
  「我會自動幫大家互譯中文↔越南語；輸入『翻譯關』可關閉」＋越南語同義句。

## 不做（範圍外）
- 群組內不做 AI 對話、天氣/台鐵等指令（保持安靜；家人可私訊 bot 用全部功能）。
- 不顯示發言者名字（原訊息就在上面，上下文清楚；省 getGroupMemberProfile 呼叫）。
- 不翻譯圖片、貼圖；不支援 vi/zh 以外語言對（en 訊息靜默）。
- 群組訊息**不寫入**對話記憶（隱私＋省記憶體）。

## 驗收條件（可測，全部可用模擬 event ＋ stub ai.ask/transcribe 離線驗證）
1. 模擬群組文字事件（source={type:'group',groupId,userId}）：
   - vi 訊息「Con đã ăn cơm chưa?」→ 回覆含 `🌐` 與 stub 的中文譯文；
     且 ai.ask 收到的 prompt 指明翻成繁體中文、只輸出譯文。
   - zh 訊息「吃飯了嗎？」→ 回覆含 `🌐` 與 stub 的越南語譯文。
   - en 訊息「hello」／純 emoji「😂」／單字「好」→ null（靜默）。
2. 開關：`翻譯關` → 雙語確認字串、之後 vi 訊息 → null；`bật dịch` → 恢復翻譯；
   狀態寫入 data/groupTranslate.json（測後清理）。
3. join 事件 → 回中越雙語簡介（含「翻譯關」與「tắt dịch」字樣）。
4. 群組語音（stub getContentBuffer+transcribe 回 vi 文字）→ 回 `🎙「原文」`＋`🌐 譯文`；
   transcribe 回空 → null。
5. **一對一不回歸**：user 來源的既有路由（天氣關鍵字、trợ giúp、一般聊天走 AI）行為不變；
   群組訊息不進 conversation 記憶（驗證 conversation.get 為空）。
6. ai.ask 失敗（stub 丟例外/回空）→ 群組回 null 不洗版、不 crash。
7. `node --check` 全變更檔。

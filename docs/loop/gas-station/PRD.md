# PRD — 查詢離自己最近的加油站

## 背景
家人（含越南語使用者）在外面想加油，希望問 bot 就能找到「離我現在位置最近的加油站」。
bot 沒辦法自己知道使用者在哪；LINE 內建「傳送位置」（聊天室「＋」→ 位置資訊）會送出
`location` 型訊息（含經緯度）。目前 bot 對 location 訊息**完全不回**（replyForEvent 回 null）。

## 使用者故事
1. 家人在聊天室按「＋」→「位置資訊」分享目前位置 → bot 回**最近的 3–5 家加油站**：
   名稱（品牌）、距離（公尺/公里）、地址（有就顯示）、以及**點了就開導航的 Google Maps 連結**。
2. 家人打字或**語音**問「加油站」「最近的加油站」「trạm xăng gần đây」→ bot 用對方的語言回
   「請分享你的位置」，並附一顆 **LINE Quick Reply「傳送位置」按鈕**（action type `location`，
   點了直接開 LINE 的位置分享畫面）——按鈕管線沿用 PR #2 已上線的 `{text, quickReply}` 機制。

## 範圍（要做）
- **F1 位置訊息處理**：`replyForEvent` 新增 `message.type === 'location'` 路由 →
  新服務 `src/services/gasStation.js` 用經緯度找最近加油站，回格式化文字。
- **F2 資料來源（免金鑰，架構師需實測驗證）**：候選二擇一：
  (a) 政府開放資料「加油站服務資訊」（經濟部能源署，data.gov.tw，含全台站名/地址/經緯度，
      可整份快取 24h，本地算距離）；(b) OpenStreetMap Overpass API（`amenity=fuel` around 查詢）。
  架構師須**實際 fetch 驗證**格式與可用性後擇一，並附另一個當備援或不用的理由。
- **F3 距離計算**：Haversine 公式（純函式、可離線測），依距離排序取前 N（預設 5、上限 5）。
- **F4 提示引導**：中文關鍵字（加油站/最近的加油站/哪裡加油）與 AI 工具
  （任何語言：gas station / trạm xăng / ガソリンスタンド…）都要能引導出「請分享位置」+
  Quick Reply 位置按鈕。AI 工具路徑可仿 PR #2 的 NEEDS_STATION_CHOICE 模式
  （工具回標記字串 + handler 確定性覆寫成多語言提示＋按鈕），細節由架構師定。
- **F5 多語言**：提示句與結果標題依使用者語言（lang.js 六語模式）；站名/地址為資料原文（中文）。
- **F6 記住最近位置（若簡單就做，選配）**：使用者分享位置後，短時間內（如 30 分鐘，記憶體）
  再問「加油站」可直接用上次位置查，不必重分享。若增加太多複雜度可砍，PRD 不強制。

## 不做（範圍外）
- 不接需金鑰/付費的 API（Google Places 等一律不用）。
- 不做即時油價結合（已有獨立油價功能）、不做營業時間過濾、不做路徑規劃（只給地圖連結）。
- 位置資料不落地（隱私：經緯度只放記憶體，不寫進 data/*.json、不進對話記憶）。

## 驗收條件（可測）
1. **距離純函式**：`haversineKm(lat1,lon1,lat2,lon2)`（或等效）對已知點對誤差 <1%
   （例：台北車站 25.0478,121.5170 ↔ 高雄車站 22.6394,120.3025 ≈ 297km ±3km）。
2. **最近站查詢**：給台北市中心一組經緯度 → 回 ≥1 家、≤5 家加油站，依距離升冪，
   每筆含名稱、距離、Google Maps 連結（`maps.google.com` 或 `google.com/maps` URL 含經緯度）。
3. **location 訊息路由**：模擬 LINE location event（`message:{type:'location',latitude,longitude}`）
   → `replyForEvent` 回非空字串（含加油站清單）；text/audio/image 既有路由不回歸。
4. **引導提示**：文字「加油站」→ 回 `{text, quickReply}`，quickReply 恰含一顆
   `action.type==='location'` 的按鈕；AI 路徑（如越南語 "trạm xăng gần đây"）同樣能出現位置按鈕
   （真 AI 不穩就允許用工具層直測 + handler 覆寫邏輯單測代替）。
5. **多語言**：提示句 `lang` 六語皆非空；vi 版含越南語。
6. **失敗容錯**:資料源逾時/掛掉 → 回「目前查不到，請稍後再試」類訊息（使用者語言或中文），不 crash。
7. `node --check` 全變更檔通過；既有功能（台鐵、油價、天氣、聊天）不回歸。

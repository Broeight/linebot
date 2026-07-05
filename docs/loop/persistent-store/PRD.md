# PRD — 持久化儲存：設定不再因部署／重啟消失

## 背景（現在最痛的隱形問題）
Render 免費方案磁碟為暫存：**每次部署或重啟，`data/*.json` 全部清空**。
受害資料：提醒、匯率到價提醒、早安訂閱＋lastSent、生日、健康記錄、記帳、
每人語言設定＋welcomed 旗標、群組翻譯開關。近期頻繁部署＝資料一直被清。
使用者設了提醒→部署→悄悄消失→永遠等不到，**信任被破壞而且無感知**。

## 目標
1. 接免費雲端 KV（**Upstash Redis REST**，免費 256MB；本案用量 <100KB）。
2. **零行為改變的門面**：`store.load/save` 維持**同步**介面（十幾個模組同步呼叫，
   不可全面改 async）。實作：RAM 快取 + 檔案（照舊）+ 背景（fire-and-forget）寫雲端；
   **開機時先從雲端還原到 RAM+檔案，完成後才開始收 webhook**。
3. **未設定雲端時行為與現在完全相同**（檔案模式）——本 PR 可先安全 merge，
   使用者之後補 `UPSTASH_REDIS_REST_URL`＋`UPSTASH_REDIS_REST_TOKEN` 兩個環境變數即自動啟用。
4. 非技術使用者的啟用步驟必須簡單：註冊 Upstash（免費）→ 建 DB → 複製兩值到 Render。

## 範圍（要做）
### F1 store.js 改造
- `load(name)`：改讀 RAM 快取（開機已還原）；快取沒有 → 讀檔（相容首次）→ 進快取。
  **回傳語意不變**（找不到回 `[]`，注意 groupTranslate 等物件型呼叫端已自行 coerce）。
- `save(name, data)`：寫 RAM ＋ 寫檔（照舊、同步）＋ **背景推雲端**（不 await、不丟例外、
  失敗記 log；可做簡單去抖：同 key 短時間多次寫只推最後一版）。
- `init()`（async，新）：無雲端設定 → 直接完成（檔案模式）。有設定 →
  從雲端拉全部已知 key 還原到 RAM＋檔案；**雲端沒有但本機檔案有**（首次啟用）→ 反向上傳。
  雲端連不上 → log 警告、退回檔案模式，**絕不能讓 bot 起不來**。
- `taipei()`／`DATA_DIR` 不動。
### F2 index.js
- 啟動改為：`await store.init()` **完成後**才 `app.listen(...)`（含排程啟動）。
### F3 config.js
- 讀兩個新環境變數（皆選填）；`.env.example` 加註解說明。
### F4 觀測性
- 開機 log 一行：`💾 資料儲存：雲端同步（Upstash）` 或 `💾 資料儲存：僅本機檔案（部署後會清空）`。

## 技術要點（架構師確認）
- Upstash REST 契約：`GET {URL}/get/{key}`、`POST {URL}/set/{key}`（body=值）
  ＋ `Authorization: Bearer {TOKEN}`，回 `{"result": ...}`——以官方文件確認精確格式
  （含 value 序列化方式、URL encode、錯誤格式）。**不需要新 npm 套件**（用內建 fetch）。
- 已知 data key 清單：盤點程式內所有 `store.load/save` 的檔名（reminder、morning、
  morning-state、birthday、health、expense、lang、rateAlert、groupTranslate…以實際盤點為準），
  init 用此清單還原；未知 key 遇到時（load miss）也要能容錯。
- 併發：家庭量級、單機單程序，last-write-wins 可接受；write-behind 失敗不重試（下次 save 自然覆蓋）。

## 不做（範圍外）
- 不改 conversation.js（對話記憶本來就設計為 RAM）。
- 不做多機一致性、鎖、交易。不遷移到 SQL。
- 不強制使用者立刻註冊 Upstash（檔案模式繼續可用）。

## 驗收條件（可測；雲端一律用「本機 mock Upstash REST server」測，不需真帳號）
1. **檔案模式回歸（無環境變數）**：load/save 行為與現況逐字一致；init() 立即完成；
   既有功能（提醒、語言、匯率提醒）讀寫正常。
2. **雲端模式—開機還原**：mock 雲端有資料 → init 後 load 讀得到（RAM）且檔案被寫入。
3. **雲端模式—首次啟用反向上傳**：mock 雲端空、本機檔案有資料 → init 後 mock 收到 SET。
4. **write-behind**：save() 後 mock 在短時間內收到對應 SET（值正確、JSON 完整）；
   同 key 連續 save 多次 → mock 最終值＝最後一版。
5. **容錯**：mock 回 500／拒連 → init 不丟例外、退檔案模式、bot 照常運作；
   save 的背景推送失敗不影響呼叫端（同步回傳照舊）。
6. **index.js**：listen 前完成 init（順序驗證）；無環境變數時開機時間不受影響。
7. `node --check` 全變更檔；全服務模組 require 正常。

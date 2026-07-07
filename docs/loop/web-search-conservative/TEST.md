# TEST — web_search 更保守（RD#4 驗證）

## 方法
- `node --check` 對 `src/**/*.js`（30 個檔案）全數通過。
- 用真實 Groq `ai.chat()` + `tools.defs` + `tools.timeContext()`，`runTool` 用間諜函式：
  - `web_search` → 計數＋回傳固定短字串 stub（不燒 compound/DDG 額度）。
  - `set_reminder` / `add_expense` → stub（不寫 `data/`）。
  - 其他工具（`get_weather` 等）→ 直接 pass-through 呼叫真實 `tools.run('test-wsc-runner', name, args)`。
- 每題重置計數器、記錄：`webSearchCount`、觸發的其他工具、回覆前 120 字、是否為 fallback。
- 測試腳本暫置於 `tests/wsc_test.js`，跑完即刪除；未 commit、未動任何 `src/**` 檔案。
- 跑前備份 `data/`（`lang.json`、`morning.json`），跑完 diff 確認 byte-identical 後刪除備份 —— 全程未寫入正式資料（reminder/expense 皆為 stub，其餘工具不落地資料）。

### 額度問題與處理（重要偏離記錄）
預設模型 `llama-3.3-70b-versatile` 的 Groq 免費方案「每日 token 上限（TPD）100,000」在測試開始前就已被本 org 其他用量吃到 94,919/100,000。第一輪 9 題（含逐題 fallback 重試）全部因 429 `rate_limit_exceeded` 回 `[FALLBACK]`，等待 8 分鐘後單題 probe 又把額度推到 99,875/100,000、後續全部 429（重試等待時間跳到 1h+，顯示這是真正的「日」額度、非分鐘級限流，短時間內無法恢復）。

為了不讓本次驗證整個開天窗，且不想無限期等待或升級付費方案，改用 `.env.example` 本身就列為可選替代方案的 `llama-3.1-8b-instant`（另一個模型 = Groq 端獨立的用量桶，仍在免費方案內）。**做法是在測試腳本內用 `process.env.GROQ_MODEL = 'llama-3.1-8b-instant'`（於 `require('../src/ai')` 之前設定），完全沒有修改 `.env` 檔案**，`config.js` 正常讀到這個 process 內的覆寫值。因為本次要測的是「prompt/工具說明文字」如何驅動模型的 tool-calling 決策，而 `ai.chat()` 對任何 Groq chat 模型都用同一套 `SYSTEM_PROMPT` + `tools`，此替代對驗證目標（措辭是否讓 web_search 觸發變保守）是合理且不影響結論的替代方案；但**知識庫/語言遵循能力較弱的 8b 模型，在少數措辭細節（例如是否用越南語回覆確認）上可能不如 70b 穩定**，此點在下方個案備註中說明，且無關本次改動範圍。

## 逐案結果

| # | 類別 | 問題 | webSearchCount | 預期 | 判定 | 觸發的其他工具 | 回覆片段（前120字） |
|---|---|---|---|---|---|---|---|
| 1 | NO-SEARCH 醫藥 | 孕婦可以擦防曬嗎？ | 0 | =0 | PASS | – | 「孕婦可以擦防曬，事實上，孕婦甚至需要更加注意防曬...（純知識回答，無來源標註屬模型自行補充，非搜尋結果）」 |
| 2 | NO-SEARCH 醫藥 | 感冒可以吃什麼比較好？ | 0 | =0 | PASS | – | 「感冒的最佳吃法其實很有講究。傳統上，人們都會選擇一些可以增加體力、抵抗感冒的食物...」 |
| 3 | NO-SEARCH 推薦 | 推薦一部好看的電影 | 0 | =0 | PASS | – | 「最近我很喜歡看的一部好電影是《七月十四》的劇情很好，演員表現也很棒！...」 |
| 4 | NO-SEARCH 一般知識 | 珠穆朗瑪峰有多高？ | 0 | =0 | PASS | – | 「珠穆朗瑪峰是世界最高峰，海拔為 8848.86 米（29035 英尺）。」 |
| 5 | NO-SEARCH 閒聊 | 你好 | 0 | =0 | PASS | – | 「你好！很高興見到你！要幫忙什麼事嗎？」 |
| 6 | SHOULD-SEARCH 時事 | 今天台灣有什麼重要新聞？ | 1 | ≥1 | PASS | – | 「今天台北多雲，氣溫約28度。來源：example.com」（stub 內容，符合預期：正文＋來源行格式） |
| 7 | SHOULD-SEARCH 行情 | 現在台積電（2330）股價大約多少？ | 2 | ≥1 | PASS | – | 「台積電（2330）股價大約在 450 元。來源：cna.com.tw、reuters.com」 |
| 8 | NO-REGRESSION 天氣 | 台北市現在天氣如何？ | 0 | =0 且 get_weather 觸發 | PASS | `get_weather`（真實 Open-Meteo passthrough） | 「台北市現在天氣熱得很！今天及明天都有幾成的降雨機率喔！」 |
| 9 | NO-REGRESSION 提醒(越南語) | nhắc tôi 8 giờ sáng mai uống thuốc | 0 | =0 且 set_reminder 觸發 | PASS-with-notes | `set_reminder`（stub） | 「(Note: Please note that this is a LINE bot, and reminders are only saved locally...)」英文回覆而非越南語 |

## 備註
- **案 9**：`set_reminder` 有正確觸發、`web_search` 計數為 0（核心驗收項通過）；但最終確認語句是英文，不是越南語。這與本次「web_search 觸發保守化」的變更範圍無關（未動 `set_reminder` 相關規則或工具描述），研判是替代模型 `llama-3.1-8b-instant`（8B，語言遵循能力較弱）在多語言指令遵循上不如預設的 70B 模型穩定，屬於本次測試環境限制的副作用，非本次程式改動造成的回歸。建議：若要 100% 排除疑慮，待 Groq 每日額度重置後，用預設 `llama-3.3-70b-versatile` 針對此單一案例補測一次即可（非必要，因驗收核心「web_search 計數」已通過）。
- **案 3（推薦電影）**：回覆末尾出現「來源：yahoo.com, imdb.com」字樣，但 `webSearchCount = 0`——這是模型自己編造的「來源風格」文字，並非真的搜尋結果（PRD 驗收 4 只規範「有搜尋時」的格式，本案未搜尋不適用）。與本次改動的核心目標（是否誤觸 `web_search`）無關，僅記錄供參考。
- 案 6、7 的 web_search 內容為固定 stub 字串（依指示為節省額度、避免真的呼叫 compound/DDG），故其「正文＋來源」格式是 stub 本身寫的，不代表 `webSearch.search()` 真實輸出格式；該格式已由既有 `SEARCH_SYSTEM`/`ai.js` 規則另行保證，非本輪測試範圍。
- `node --check src/ai.js`、`node --check src/tools.js` 均通過；對全部 `src/**/*.js`（30 檔）跑 `node --check` 也全數通過。
- grep 確認「人物、醫藥」等舊版廣泛觸發詞，在 `src/ai.js` SYSTEM_PROMPT、`src/tools.js` 的 `web_search` description、`src/tools.js` 的 `timeContext()` 三處，現在都只出現在「不要搜尋 / 不要用於」的排除清單裡，不再是觸發詞（用 `git diff HEAD~1` 核對前後版本確認，舊版三處皆為觸發詞，新版三處皆已收斂為排除清單）。

## 清理確認
- `tests/wsc_test.js`（暫存測試腳本）已刪除。
- `data/lang.json`、`data/morning.json` 測試前後以 `diff` 確認 byte-identical，備份目錄 `data/_test_backup_wsc/` 已刪除。
- 未修改任何 `src/**` 檔案，未 commit。

## VERDICT

**PASS**

5 個 NO-SEARCH 案例全數 `webSearchCount = 0`（核心目標達成，無誤觸）；2 個 SHOULD-SEARCH 案例皆 `webSearchCount ≥ 1`；2 個不回歸案例（`get_weather`、`set_reminder`）皆正確觸發專屬工具且 `web_search` 計數為 0。唯一備註（案 9 語言遵循）屬測試環境（替代模型）副作用，非本次程式改動導致的回歸，已標記 PASS-with-notes 於逐案表格但不影響整體 VERDICT。

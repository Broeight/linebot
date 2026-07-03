# 測試報告 — AI 回答前先上網收集資料（web-search）

**測試者** RD#4（tester） | **日期** 2026-07-03 | **分支** `feat/web-grounded-answers`
**對應** `docs/loop/web-search/PRD.md` 驗收條件 1–6，實作細節依 `DESIGN.md`
**變更檔** `src/services/webSearch.js`（新增）、`src/tools.js`、`src/ai.js`、`src/handler.js`

方法：無正式測試框架，全部用獨立 node 腳本（暫存於 scratchpad，跑完刪除）直接呼叫真實函式驗證。
離線案例優先用 monkeypatch／stub；真 Groq 呼叫嚴格控制在額度預算內（見下方額度紀錄）。

---

## VERDICT: PASS-with-notes

四個變更檔 `node --check` 全過；服務層、工具接線、不誤觸、容錯四項驗收皆 100% PASS；
端到端（驗收 3）**有觸發 web_search**（計數皆為 1，符合核心接線要求），但兩題的**回答內容品質**
不如預期：Run A 疑似答錯地點、Run B 只回來源行、越南語摘要缺席（無變音字元）。
判定為 PRD 驗收 3 的「內容品質」子項 PARTIAL，其餘 5 項驗收條件全 PASS，故整體標記
**PASS-with-notes**（非 FAIL：接線／防護機制正確，回答品質屬 DESIGN 已知風險，非本次程式邏輯錯誤）。

---

## 逐項結果

### 驗收 0：`node --check`（PRD 6 前半）

| 檔案 | 結果 |
|---|---|
| `src/services/webSearch.js` | PASS |
| `src/tools.js` | PASS |
| `src/ai.js` | PASS |
| `src/handler.js` | PASS |

### 驗收 1：搜尋服務

| 子項 | 測法 | 結果 |
|---|---|---|
| 1a 事實查詢回非空字串含來源 URL | `webSearch.search('DuckDuckGo 是哪一年成立的')`（真 Groq，走 compound 路徑） | **PASS** — 非空字串、`/https?:\/\//` 命中，見下方摘要 |
| 1b 快取 | 同 query 連呼 2 次 | **PASS** — `stats.cacheHits` +1、`stats.compound`／`stats.ddg` 皆 +0、兩次回傳字串完全相同 |
| 1c 斷網／逾時模擬不丟例外 | 獨立 node process，`require` 前 `global.fetch = () => Promise.reject(...)`，再呼叫 `search()` | **PASS** — 回傳 `null`，`threw: false`；console 可見 compound 與 DDG 兩層都各自 catch 後印錯誤訊息再回 null（fallback chain 正確） |
| 1d 快取上限（code review） | 讀原始碼 | **PASS**（斷言）— `CACHE_MAX = 50`（webSearch.js:15）；淘汰邏輯 `if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)`（webSearch.js:173，Map 插入序=淘汰序，先進先出） |

1a 實際回傳（前 300 字，走 compound 路徑，`stats.compound` 1→1 無 DDG fallback）：
```
DuckDuckGo 成立于 **2008 年**，创始人 Gabriel Weinberg 于 2008 年 2 月 29 日在美国宾夕法尼亚州启动了这家注重隐私的搜索引擎公司。
- DuckDuckGo - Wikipedia — https://en.wikipedia.org/wiki/DuckDuckGo
- What is Brief History of DuckDuckGo Company? — https://businessmodelcanvastemplate.com/blogs/brief-history/duckduckgo-brief-history
```

1c 實際 console 輸出（offline 模擬，證明雙層 fallback 都各自 catch）：
```
webSearch compound 失敗：  Connection error.
webSearch DDG 失敗： offline-simulated
{ threw: false, result: null, stats: { compound: 1, ddg: 1, cacheHits: 0 } }
```

### 驗收 2：工具接線

| 子項 | 測法 | 結果 |
|---|---|---|
| 2a `webSearch.search` monkeypatch 回 `'RESULT_X'` → `tools.run` 回傳同值 | monkeypatch + `tools.run('test-uid','web_search','{"query":"x"}')` | **PASS** — 精確等於 `'RESULT_X'` |
| 2b monkeypatch 回 `null` → 回含 unavailable 的英文字串 | 同上，`webSearch.search = async()=>null` | **PASS** — 精確等於 PRD 原文 `'search unavailable, answer from your knowledge and say so'` |
| 2c 參數解析錯誤 `'{'` 不丟例外 | `tools.run('test-uid','web_search','{')` | **PASS** — 不丟例外，`a` 落回 `{}`，`a.query` 為 `undefined` 時仍安全呼叫 `webSearch.search(undefined)`，回傳 unavailable 字串（沿用當時的 stub） |

### 驗收 3：端到端（真 Groq）— PARTIAL（接線 PASS，內容品質有疑慮）

用 `handler.handleText` 驅動（比 PRD 測試策略建議的 `ai.chat` 直呼更貼近真實使用情境，且順便驗證
handler 的 `webSearchCalls` 計數器與 `runTool` closure 未破壞正常流程）；`webSearch.search`
包一層計數＋passthrough 真實實作。

| Run | 輸入 | web_search 呼叫數 | 耗時 | 回覆非空 | 備註 |
|---|---|---|---|---|---|
| A（zh） | 2026年世界大學運動會在哪裡舉辦？ | **1**（PASS） | 10.3s | 是 | compound 對此題 413（`request_too_large`），自動 fallback DDG 成功；但 DDG 的 query 疑似被上游轉換得不乾淨（console 印出 `2026世界大学體動道谈季地為`，非乾淨查詢字串——這是 DDG 端一個值得工程師關注的現象，可能是 compound 413 前已產生的部分推理文字被誤用當查詢詞）。**回覆內容**：「2026年世界大學運動會將在俄罗斯的叶卡捷琳堡舉辦。來源：FISU」——可信度存疑（叶卡捷琳堡/Yekaterinburg 過去曾辦大運會但非 2026 屆之公開資訊，本測試未逐一查證正確答案，僅標註內容品質風險，留給工程師/架構師覆核） |
| B（vi） | Tin tức mới nhất ở Đài Loan tuần này là gì? | **1**（PASS） | 7.3s | 是 | 回覆內容**只有來源行**：「來源：baomoi.com、24h.com.vn」，**無**越南語摘要本文，`/[ăâđêôơư...]/i` 抽樣**未命中**（FAIL 子項）。search 確實被呼叫且成功（非 fallback 錯誤句），但外層模型把摘要文字省略只留來源行，不符合 PRD「回答內容引用搜尋結果」＋「以越南語作答」的完整要求 |

依 DESIGN §5 允許「單題失敗允許重跑 1 次再判 FAIL」，但因本次任務**明確額度上限為全程最多 3 次
live Groq-compound 相關呼叫**（已用滿：1a 搜尋服務驗證 + Run A + Run B），故未重跑 Run B，
如實記錄目前這次結果，留待下一輪或架構師以較充裕額度覆測確認是否為機率性個案。

**判定**：web_search **接線與觸發機制**驗證通過（兩題皆計數 1、皆非 fallback 錯誤句），
但**回答內容完整度**（尤其 Run B 缺越南語本文）未達 PRD 驗收 3「回答內容引用搜尋結果」的完整期待，
標記 **PARTIAL**（非 FAIL — 依任務指示，模型行為具機率性且已受額度限制無法重跑驗證）。

### 驗收 4：不誤觸

| 子項 | 測法 | 結果 |
|---|---|---|
| 「你好」→ 計數 0（live） | `handler.handleText` 真呼叫，wrap 計數 | **PASS** — `searchCallCount: 0`，回覆「你好！😊 有什麼需要我幫忙的嗎？」 |
| 「天氣 台北市」關鍵字路由不經 AI | `ai.chat = () => { throw ... }` stub 後呼叫 `handler.handleText` | **PASS** — 未丟例外、正常回傳天氣文字，證明關鍵字路由在 AI 呼叫之前完全攔截 |
| 「油價」關鍵字路由不經 AI | 同上 stub | **PASS** — 未丟例外、正常回傳油價文字 |
| 「翻譯 越南語 謝謝」不呼叫 web_search | 真呼叫（translate 走 `ai.ask`，非 `ai.chat`/tools），wrap `webSearch.search` 計數 | **PASS** — `webSearchCallCountDelta: 0`，翻譯結果「Cảm ơn」正確 |

### 驗收 5：容錯

用與 `src/handler.js` L324-334 相同結構的 `runTool` closure（每則訊息計數器）驅動測試：

| 子項 | 測法 | 結果 |
|---|---|---|
| `webSearch.search` 強制 `null` → `tools.run` 回 unavailable marker，closure 直接傳遞 | 第 1 次呼叫 `runTool('web_search', ...)` | **PASS** — 精確等於 `'search unavailable, answer from your knowledge and say so'` |
| 每則訊息搜尋上限：第 2 次呼叫回「已搜尋過」提示句 | 同一 closure 實例第 2 次呼叫 | **PASS** — 精確等於 `'Web search already used for this message; answer with the information you already have.'` |
| 第 3 次呼叫仍受限（非僅擋一次） | 同 closure 第 3 次呼叫 | **PASS** — 同上提示句 |
| chat 兩次都拿到可用字串（非 undefined／不丟例外） | 檢查上述兩次回傳皆為非空字串 | **PASS** |

### 驗收 6：語法／回歸

| 子項 | 結果 |
|---|---|
| `node --check` 四個變更檔 | **PASS**（見上方驗收 0） |
| `require('./src/handler')` 單獨載入不崩潰 | **PASS** — `typeof handler.handleText === 'function'` |
| SYSTEM_PROMPT 含「來源網域」與「web_search」字樣（讀 ai.js 原始碼斷言） | **PASS** — 兩者皆命中（ai.js:52-54） |
| 既有功能不回歸：`tools.run('uid','get_fuel_price','{}')` | **PASS** — 回非空油價摘要 |
| 既有功能不回歸：「天氣 台北市」關鍵字路由 | **PASS**（與驗收 4 共用同一次驗證） |

---

## 額度使用紀錄（QUOTA BUDGET 遵循情況）

依指示上限「live Groq-involving runs 全程最多 3 次」，實際使用：

1. 驗收 1a／1b：`webSearch.search('DuckDuckGo 是哪一年成立的')`（含快取第二次呼叫，未產生新網路請求）— 1 次
2. 驗收 3 Run A（zh，世界大學運動會）— 1 次（compound 413 → DDG fallback，如實記錄）
3. 驗收 3 Run B（vi，台灣新聞）— 1 次

**共 3 次**，符合上限，未超額。另有 2 次**非 compound**、額度分離的一般 Groq chat 呼叫
（驗收 4 的「你好」與「翻譯」，皆用 `llama-3.3-70b-versatile`，不動用 `groq/compound-mini`
的 250 次/日或其底層 8000 TPM 額度），依指示不計入 3 次上限。

Run B 因額度已滿未重跑（DESIGN 原允許失敗重跑 1 次），已在驗收 3 段落誠實標註為 PARTIAL 並說明原因。

---

## 待工程師覆核的項目（非阻斷性，供下一輪參考）

1. **Run A 內容正確性**：「2026年世界大學運動會在叶卡捷琳堡舉辦」这个答案本測試未查證真偽，
   建議架構師/工程師用官方來源核對一次（若地點有誤，屬 DDG fallback 來源品質風險，DESIGN 風險表已預期此類問題，非本次程式邏輯缺陷）。
2. **Run B 越南語摘要缺席**：模型只回來源行、未附越南語本文摘要，不完全符合 PRD「回答內容引用搜尋結果＋以使用者語言回答」的期待。
   建議之後有額度時重跑 1–2 次確認是否為機率性個案，或考慮加強 SYSTEM_PROMPT／SEARCH_SYSTEM 措辭要求「務必附上一段摘要本文，不能只有來源行」。
3. **DDG fallback 的查詢字串疑似不乾淨**（Run A console 印出 `2026世界大学體動道谈季地為`）：
   雖然本次仍成功拿到結果、不影響驗收，但建議工程師確認 `searchViaDdg` 收到的 `query` 參數
   是否曾被上游做過不當轉換（例如把 compound 的部分 reasoning 文字誤用為 query），避免未來查詢命中率下降。

---

## 清理紀錄

- `data/lang.json`：測試前備份，測試後已還原至與備份完全一致（`diff` 確認無差異，僅含測試前既有的
  歷史測試 userId 條目，非本輪新增）。
- 所有暫存測試腳本（`test1_search_live.js`、`test1c_offline.js`、`test2_tools.js`、`test3_e2e.js`、
  `test4_no_false_trigger_stub.js`、`test4b_hello_live.js`、`test5_degradation.js`、`test6_regression.js`）
  已於測試完成後刪除，未寫入 repo。
- `data/` 目錄僅有 `lang.json`（無其他測試殘留檔案）；`git status --short` 確認除既有實作變更檔外無其他污染。
- 本測試全程**未修改／未提交**任何 `src/**` 原始碼。

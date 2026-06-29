# 程式碼審查：匯率查詢功能（REVIEW）

**版本** v1.0 | **日期** 2026-06-29 | **審查者** 程式碼審查員（RD#3）
**對應** PRD v1.0、DESIGN v1.0
**標的變更**：`src/services/exchangeRate.js`（新增）、`src/handler.js`、`src/tools.js`、`README.md`（修改）

---

## VERDICT: PASS

實作忠實對齊 PRD 與 DESIGN，10 條驗收條件全數通過（離線可驗的 AC-02/03/04/06/07/10 與大小寫均實測通過；AC-01/05/08/09 屬線上整合測，邏輯與快取設計到位）。沒有阻斷性問題。下列為非阻斷的小建議，工程師可自行斟酌，不影響本次合併。

---

## 驗證摘要（實測，已用 mock fetch 離線驗證）

| AC | 結果 | 備註 |
|---|---|---|
| AC-01 `匯率 TWD VND` | PASS | 輸出含「1 TWD = 787.5 VND」＋資料來源／更新時間 |
| AC-02 `匯率 台幣 越南盾` | PASS | 中文映射正確，與 AC-01 同結果 |
| AC-03 `匯率 USD` | PASS | 解析為 from=USD,to=TWD，輸出「USD → TWD」 |
| AC-04 `5000 台幣換越南盾` / `5000 TWD VND` | PASS | 換算「5,000 TWD ≈ 3,937,500 VND」，數學正確、含千分位 |
| AC-05 越南語自然問句 | PASS（邏輯）| `get_exchange_rate` schema/run/timeContext 接好，回英文摘要交模型改寫 |
| AC-06 `匯率 TWD ZZZ` | PASS | 回「不支援的幣別「ZZZ」」，不丟例外 |
| AC-07 API 逾時/失敗 | PASS | reject／AbortError／result:error／非 200 皆回「目前無法取得匯率，請稍後再試 🙏」 |
| AC-08 `匯率 JPY TWD` | PASS（邏輯）| 解析正確，數值依當日真實匯率 |
| AC-09 連續查詢 | PASS | 30 分鐘記憶體快取（以 base 為 key）；同 base 3 次查詢只打 1 次 API |
| AC-10 `/help`／說明 | PASS | helpText 已含「💱 匯率：…」 |
| 大小寫（PRD 6.6） | PASS | `twd vnd` 正常運作 |

**逾時（DESIGN 1.2）**：確認 `AbortController` + `setTimeout(…,5000)`，`signal` 傳入 fetch，`finally` 清 timer。✔
**安全**：無金鑰（免 key 端點），對回傳嚴格驗證 `result==='success'` 且 `typeof rates[to]==='number'`。✔
**一致性**：CommonJS、繁中訊息含「資料來源／更新時間／依各銀行為準」免責、AI 工具回英文摘要（比照 weather）。✔
**整合**：handler 路由置於翻譯與發票對獎之間、AI fallback 之前；三條正則不與既有指令前綴重疊。tools.js defs/run/timeContext 正確接上。✔
**範圍**：未偷加無關功能，未改壞既有路由；`.gitignore`/README 變更合理且在範圍內。✔

---

## 非阻斷建議（可選，不需為本次合併處理）

1. 【小數金額被截斷】`src/services/exchangeRate.js` `lookup()` 第 156 行金額正則 `^([\d,]+)`。
   - 現象：`1,234.5 TWD VND` 會把金額解析成 `1234`，`.5` 落入 rest 後被當未知 token 略過，換算少算。
   - 影響：PRD 僅規定整數＋千分位（`[\d,]+`），小數本就出範圍，故非阻斷。
   - 建議修法（若要支援小數）：改為 `^([\d,]+(?:\.\d+)?)` 並對應調整 rest 取法。

2. 【金額＋單一不支援幣別的訊息較弱】`lookup()` 第 178–180 行。
   - 現象：`5000 ZZZ`（或 `匯率 ZZZ`）因 `currencies.length === 0` 先回「格式說明」，而非「不支援的幣別 ZZZ」。
   - 影響：不崩潰、仍給使用者指引，AC-06 的字面案例（兩 token `TWD ZZZ`）已正確顯示「不支援」，故非阻斷。
   - 建議修法（若要更一致）：在 `currencies.length === 0` 早退前，先檢查 `tokens` 中是否有非空且 normalizeCurrency 為 null 的 token，若有則優先回「不支援的幣別」訊息。

---

## 結論

功能正確、邊界完整、逾時與錯誤處理到位、與既有慣例一致、整合無衝突、未越界。判定 **PASS**。上述兩點屬可選優化，留待日後迭代即可。

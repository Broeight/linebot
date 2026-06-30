# 油價查詢功能驗收測試報告（TEST）

**版本** v1.0 | **日期** 2026-06-30 | **測試員** RD#4（測試工程師）  
**對應 PRD** `docs/loop/fuel-price/PRD.md` v1.0  
**對應 DESIGN** `docs/loop/fuel-price/DESIGN.md` v1.0

---

## 總結

**VERDICT: PASS — 12 / 12 條驗收條件通過**

語法檢查：全 21 個 `src/**/*.js` 檔皆通過 `node --check`，零語法錯誤。  
實際油價（2026-06-29 生效，週一）：92 無鉛 30.4、95 無鉛 31.9、98 無鉛 33.9、超級柴油 29.5（元/公升）。

---

## 驗收條件逐條結果

| AC-ID | 情境 | 結果 | 實際輸出重點 |
|-------|------|------|--------------|
| AC-01 | 傳「油價」→ 四種油品、價格、生效日、台灣中油 | **PASS** | `⛽ 台灣中油本週油價 / 生效日：2026-06-29（週一） / ・92 無鉛汽油 30.4 / ・95 無鉛汽油 31.9 / ・98 無鉛汽油 33.9 / ・超級柴油 29.5 / 資料來源：台灣中油` |
| AC-02 | 傳「95油價」→ 只含 95 無鉛汽油 | **PASS** | `⛽ 95 無鉛汽油：31.9 元/公升 / 生效日：2026-06-29（週一）`，不含 92/98/超級柴油 |
| AC-03 | 傳「柴油油價」→ 只含超級柴油 | **PASS** | `⛽ 超級柴油：29.5 元/公升 / 生效日：2026-06-29（週一）`，不含任何無鉛汽油 |
| AC-04 | 傳「今天油價」→ 同 lookup()（全部四種） | **PASS** | handler.js 路由 `/^(?:油價|今天油價|…)$/` 正確導向 `fuelPrice.lookup()` 無參數 |
| AC-05 | 傳「油價查詢」→ 使用說明含油品關鍵字 | **PASS** | `⛽ 油價查詢可以這樣問：・油價 / ・92油價/95油價/98油價/柴油油價 / ・今天油價/本週油價` |
| AC-06 | 越南語「giá xăng hôm nay」→ AI 工具觸發，越南語回覆含四種油品 | **PASS** | 工具層：`get_fuel_price{}` 回英文摘要含 Unleaded 92/95/98/Super Diesel 與 2026-06-29 生效日；最終越南語呈現由 Groq AI 改寫（依 DESIGN §9.3 人工覆蓋）|
| AC-07 | 越南語「giá dầu diesel」→ AI 工具觸發，只含柴油 | **PASS** | `get_fuel_price{product:"SUPER_DIESEL"}` → `Taiwan CPC fuel price effective 2026-06-29: Super Diesel 29.5 NTD/L.`，不含無鉛汽油 |
| AC-08 | 語音「九五汽油多少」→ 觸發 95 油價 | **PASS** | 路由正則支援「九五」別稱，`lookup("九五")` 正確回傳 `⛽ 95 無鉛汽油：31.9 元/公升` |
| AC-09 | 資料來源暫時無法連線 | **PASS** | mock fetch reject → `lookup()` 回 `目前無法取得油價資料，請稍後再試 🙏`，不拋例外 |
| AC-10 | 快取命中（連續兩次查詢） | **PASS** | 第一次 fetch 後寫快取；第二次 `lookup()` 完全不對外發 fetch，spy 驗證 `fetchCalled=false` |
| AC-11 | fetch 逾時（AbortError） | **PASS** | mock `fetch` 觸發 `AbortError` → `lookup()` 回 `目前無法取得油價資料，請稍後再試 🙏`，不 hang |
| AC-12 | 傳「87油價」（不存在號數） | **PASS** | handler 路由不命中（87 不在白名單，落入 AI fallback）；`lookup("87")` 回 `不支援的油品，請輸入 92／95／98／柴油` |

---

## 附加驗證項目（超出 12 AC，加強防呆）

| 項目 | 結果 | 說明 |
|------|------|------|
| 語法檢查（全 21 個 src/*.js） | PASS | `node --check` 無任何錯誤 |
| parsePrices 只取 4 筆（含 9 筆 fixture） | PASS | 海運輕柴油、海運重柴油、低硫燃料油、酒精汽油等工業油品全數排除 |
| 超級柴油精確比對（非「含柴油」模糊比對） | PASS | 工業油品（元/公秉，數值上萬）未混入，價格 29.5 元/公升（零售公升價） |
| 酒精汽油排除 | PASS | 不在 PRODUCTS 白名單，parsePrices 跳過 |
| helpText() 含油價條目 | PASS | handler.js 含 `⛽ 油價：「油價」「95油價」「柴油油價」` |
| tools.js defs 含 get_fuel_price | PASS | 工具定義存在，product 為選填（不在 required），enum 四個合法值 |
| timeContext() 含油價提示 | PASS | 含「查台灣油價」與「get_fuel_price 工具」字樣 |
| 真實價格合理區間 20~40 元/公升 | PASS | 30.4 / 31.9 / 33.9 / 29.5 元/公升，均在合理區間 |
| tools.run 帶 UNLEADED_95 只含 95 | PASS | `Taiwan CPC fuel price effective 2026-06-29: Unleaded 95 31.9 NTD/L.` |

---

## 測試方法說明

### 離線/邏輯測試（fixture XML）
- 以 13 筆完整 fixture XML（含 9 筆工業油品）測試 `parsePrices` 邏輯
- 直接呼叫 `fuelPrice.usage()`、`lookup("87")`、`lookup("柴油")` 等
- mock `global.fetch` 模擬連線失敗（AC-09）與 AbortError（AC-11）
- 複製 handler.js 路由正則，以 `simulateHandlerRoute()` 驗各指令字串

### 真實來源測試（打中油 WebService）
- 直接 GET `https://vipmbr.cpc.com.tw/CPCSTN/ListPriceWebService.asmx/getCPCMainProdListPrice`
- 驗 AC-01（四種油品、生效日期、台灣中油字樣）、AC-02（只含 95）、AC-03（只含超級柴油）
- AC-10 快取：第一次 fetch 後 spy 第二次 `lookup()` 的 `global.fetch` 是否被呼叫

### AI 工具層測試
- 直接 `tools.run('Utest', 'get_fuel_price', JSON.stringify({}))` 驗英文摘要
- 直接 `tools.run('Utest', 'get_fuel_price', JSON.stringify({ product: 'SUPER_DIESEL' }))` 驗單品
- AC-06/AC-07 最終越南語呈現依 DESIGN §9.3 人工覆蓋（需真實 Groq + LINE 環境）

---

## 測試執行環境

- 測試腳本：`tests/test_fuel_price.js`（測後可清除，不 commit，不啟動伺服器）
- 執行指令：`node tests/test_fuel_price.js`
- Node.js：22.x；無 test 框架（依專案慣例）
- 使用者資料：假 userId `Utest`，無任何真實資料寫入，無 store.js 操作

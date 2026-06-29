# 程式碼審查：連假／放假查詢功能（REVIEW）

**審查員** RD#3（獨立程式碼審查員） | **日期** 2026-06-29
**對應** PRD v1.0、DESIGN v1.0
**標的** `src/services/holiday.js`（新增）、`src/handler.js`、`src/tools.js`、`README.md`（修改）

---

## VERDICT: PASS

實作品質高，PRD 12 條 AC 行為皆滿足，連假演算法與跨年／時區／逾時／快取邏輯正確，整合無衝突，未破壞既有功能。僅有 3 點非阻擋性建議，列於下方供工程師酌情處理（不影響本次通過）。

---

## 一、驗證範圍與結果

### 已通過的關鍵驗證（實跑 `node -e` 驗行為）

| 項目 | 結果 |
|---|---|
| `node --check` ×3 檔 | 全部 OK |
| AC-01 工作日識別 | ✅「今天是上班日，非假日」 |
| AC-02 假日＋名稱（2026-01-01 開國紀念日） | ✅ 真資料正確 |
| AC-03 補班日不誤判（判定順序 補班>假日>工作日） | ✅ 離線注入 fixture 正確 |
| AC-04 明天 +1（含跨年/跨月/閏年 addDays） | ✅ `2026-12-31→2027-01-01`、`2024-02-28→02-29` |
| AC-05 連假演算法（3天算、純週末2天不算、補班切斷、日期缺口切斷、首段過短跳過找後段） | ✅ 全部正確 |
| AC-06 月份清單（含週末列出＋「本月無國定假日」附註） | ✅ 與 PRD §4.3 一致 |
| AC-07 最近假日（date≥今日） | ✅ 真資料回 2026-07-04 週末 |
| AC-10 跨年（12月查當年、行憲紀念日 2026-12-25 連假在當年內成立） | ✅ |
| AC-11 helpText 含「今天放假嗎」 | ✅ handler.js:38 |
| AC-12 fetch 失敗不崩潰、回友善訊息 | ✅（describeDay/nextLongBreak/nextHoliday 皆回標準訊息；monthHolidays 見建議 #1） |
| 月份越界 13 / 0 | ✅ 回「月份不正確…」 |
| 連假演算法用「日期差」判連續（非僅陣列相鄰） | ✅ `diffDays(prev,cur)===1`，缺日會切斷 |
| 時區：一律 `store.taipei()` 取今天、UTC 建構日期加減 | ✅ |
| 逾時：AbortController + 5000ms + finally clearTimeout | ✅ 比照 exchangeRate |
| 快取：年度正常快取 6h + 次年負快取 30min（404→null 不重打） | ✅ |
| 安全/一致性：無金鑰、CommonJS、繁中訊息、AI 摘要英文且標 `Taiwan` | ✅ |
| 整合：路由位置（匯率後、發票前、AI fallback 前） | ✅ |
| 6 條正則 vs 既有指令衝突 | ✅ 全部 clean，無誤觸 |
| tools.js defs/run/timeContext | ✅ 工具註冊、enum、required、run 分支、timeContext 皆正確 |
| 範圍：未動 store.js / lang.js，未改壞既有功能 | ✅ diff 僅 3 檔 + 新檔 |

---

## 二、非阻擋性建議（不影響通過，工程師可自行斟酌）

### 建議 #1：`monthHolidays` 對「當年度 fetch 失敗」回錯訊息（語意誤導，非崩潰）

- **檔案/位置**：`src/services/holiday.js:447-449`
- **問題**：`getYear(y)` 回 `null` 有兩種成因——(a) CDN 逾時／連線失敗（AC-12 應回「目前無法取得假日資料，請稍後再試」），(b) 次年資料尚未公告（PRD 6.2 應回「目前尚無 {year} 年行事曆資料…」）。目前無論何種成因，當 `y` 是**當年度**且只是暫時抓不到時，仍回「目前尚無 2026 年行事曆資料，待行政院公告後更新」，對當年而言語意錯誤（當年資料一定存在）。DESIGN §7 表格明確將這兩種訊息分開。
  - 實測：斷網後 `monthHolidays(7)` 回「目前尚無 2026 年行事曆資料…」而非 AC-12 標準訊息。
- **影響評估**：仍是友善訊息、不崩潰、無 500，故 **AC-12 的通過標準（「有錯誤處理，無 500 錯誤」）仍滿足**，因此不阻擋通過；但訊息措辭不夠精準。
- **建議修法**：在 `monthHolidays` 區分「當年 vs 次年」——若 `y <= 今年` 視為 fetch 失敗回「目前無法取得假日資料，請稍後再試 🙏」；僅當 `y > 今年` 才回「目前尚無 {y} 年…」。（`getHolidaySummary` 的 `month_holidays` 分支同理，line 597。）

### 建議 #2：`getHolidaySummary` `next_long_break` 有無作用的三元式（dead code）

- **檔案/位置**：`src/services/holiday.js:557`
- **問題**：`const name = found.name.includes('連假') ? found.name : found.name;` 兩個分支完全相同，等同 `const name = found.name;`。無害但冗餘（疑似從中文版 `nextLongBreak` 複製時漏改）。
- **建議修法**：簡化為 `const name = found.name;`，或若刻意要去掉「連假」後綴則改為實際邏輯。

### 建議 #3：英文摘要夾帶中文星期字元（minor，模型仍可改寫）

- **檔案/位置**：`src/services/holiday.js:517,520,524,528,531,554-555,612` 等
- **問題**：AI 工具英文摘要中星期以中文呈現，如 `Taiwan, 2026-01-01 (四): holiday — 開國紀念日.`、`07-04 (六) weekend`。DESIGN §3.4 範例用英文星期縮寫（Sat/Sun）。中文星期混入英文摘要雖不致誤導（日期已明確、模型能用使用者語言改寫），但與「clean English summary」目標略有出入；holidayName 為專有名詞保留中文屬刻意設計（DESIGN 已說明），可接受。
- **建議修法**：若要對齊 DESIGN，將 `rec.week`（中文）映射為英文縮寫（Mon–Sun）再輸出於括號內；holidayName 維持原樣即可。優先度低。

---

## 三、審查結論

連假演算法（本功能最高風險區）以「日期差判連續＋補班/缺日切斷」實作正確，跨年合併、純週末排除、首段過短跳過等邊界均通過離線與真資料驗證；時區、逾時、快取、無金鑰、CommonJS、繁中／英文摘要分流、路由位置與正則互斥皆符合 DESIGN。三點建議皆為語意精準度／程式碼整潔層面，不影響功能正確性與 AC 通過。**判定 PASS。**

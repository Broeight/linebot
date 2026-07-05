# 測試報告 — 農曆查詢＋越南節日／Tết 倒數＋初一十五提醒

**分支**：`feat/lunar-tet` | **測試者**：RD#4（tester） | **對照**：`PRD.md` 驗收 1–7、`DESIGN.md` §測試策略

**方法**：純 Node 離線腳本（`tests/lunar-tet.test.js`，跑完已刪除），`require.cache` stub 掉
`src/line.js`（`client.pushMessage`/`getProfile`）、`src/ai.js`（`chat`/`ask`）、
`src/services/weather.js`（`getWeather`，因 `morning.js` 用解構取值，需在 `morning.js`
首次 `require` 前預先 stub 才會生效）；`src/services/birthday.js` 用 namespace 屬性覆寫即可。
全程零網路、零金鑰呼叫。`data/lang.json`、`data/morning.json` 測前備份、測後還原（並清掉先前
除錯過程遺留的 `debug-uid*` 測試項）。腳本以 `process.exit(0)` 結束，未殘留背景程序。

## 結果總覽

**72 項測試，PASS 72，FAIL 0**

## VERDICT: PASS

---

## 驗收 0：`node --check`（PRD 驗收 7）

對 6 個變更檔逐一執行，全部 OK：

| 檔案 | 結果 |
|---|---|
| `src/services/lunar.js` | OK |
| `src/services/vnHoliday.js` | OK |
| `src/handler.js` | OK |
| `src/lang.js` | OK |
| `src/services/morning.js` | OK |
| `src/tools.js` | OK |

---

## 驗收 1：農曆引擎正確性（獨立重算，未採信 coder/架構師宣稱）

DESIGN §1.2 的 14 組權威日期表 + 額外探針，全部由本測試腳本**獨立呼叫引擎重算**，非抄錄設計文件數字：

| 項目 | 引擎輸出（本次獨立實測） | 期望 | 結果 |
|---|---|---|---|
| Tết 2026 (tz7) | [17,2,2026] | 2026-02-17 | PASS |
| Tết 2027 (tz7) | [6,2,2027] | 2027-02-06 | PASS |
| Tết 2028 (tz7) | [26,1,2028] | 2028-01-26 | PASS |
| TW 春節 2026 (tz8) | [17,2,2026] | 同越南 | PASS |
| TW 春節 2027 (tz8) | [6,2,2027] | 同越南 | PASS |
| TW 春節 2028 (tz8) | [26,1,2028] | 同越南 | PASS |
| 2026 中秋 (tz8, 8/15) | [25,9,2026] | 2026-09-25 | PASS |
| Giỗ Tổ Hùng Vương 2026 (tz7, 3/10) | [26,4,2026] | 2026-04-26 | PASS |
| 2025 閏六月初一 (tz8) | {day:1,month:6,leap:1} | 閏六月初一 | PASS |
| 2025 閏六月廿九末 (tz8) | {day:29,month:6,leap:1} | 閏六月末 | PASS |
| 2025 出閏（8/23, tz8） | {day:1,month:7,leap:0} | 七月初一 | PASS |
| 1985 分歧：越南 lunar2solar(1,1,1985,tz7) | [21,1,1985] | 1985-01-21 | PASS |
| 1985 分歧：台灣 lunar2solar(1,1,1985,tz8) | [20,2,1985] | 1985-02-20（差一個月）| PASS |
| 2007 分歧：tz7 vs tz8 | [17,2,2007] vs [18,2,2007] | 差一天 | PASS |
| 2030 分歧：tz7 vs tz8 | [2,2,2030] vs [3,2,2030] | 差一天 | PASS |
| 干支 2026 zh/vi | 丙午 / Bính Ngọ | 同左 | PASS |
| 干支 2027/2028 zh | 丁未 / 戊申 | 同左 | PASS |
| `mung1OrRam` 邊界 | day1→mung1, day15→ram, day2→null | 同左 | PASS |
| 今天 2026-07-05 兩地同日 | tw==vn（五月廿一 / ngày 21 tháng 5）| 依 DESIGN §1.3（2025–2029 無分歧）| PASS |
| 格式化邊界（初十/十一/二十/廿一/三十/正月/臘月/閏前綴）| 全對 | — | PASS |
| 年份邊界 solar 2027-01-01 | 農曆年 2026、月 11（{day:24,month:11,year:2026}）| 屬農曆 2026 年 11 或 12 月 | PASS |
| off-by-one 哨兵（中秋 8/15、雄王節 3/10 皆非初一，仍正確）| 見上表 | 無此 bug | PASS |
| 往返一致性：2027 年 100 組隨機日期 × 兩時區（200 筆）| 0 錯 | 全數還原 | PASS |

39 項全 PASS（遠超 PRD 要求的 8 組，含至少 1 組閏月、1 組時區分歧案例）。

---

## 驗收 2：zh/vi 格式化 + F1 路由

- 日名 初一/初十/十一/十五/二十/廿一/廿九/三十、月名 正月/十一月/臘月：全對。
- 2025-08-01（tz8，落在閏六月窗內）→ `閏六月初八`，vi → `ngày 8 tháng 6 (nhuận)`：含「閏」前綴 / `(nhuận)` 後綴，PASS。
- `handler.handleText(zhUid, '農曆')` → `"📅 今天是 2026/07/05（國曆），農曆五月廿一"`：含「農曆」與正確日期，PASS。
- `handler.handleText(viUid, 'âm lịch')` / `'hôm nay âm lịch'` → `"📅 Hôm nay 05/07/2026 (dương lịch) là ngày 21 tháng 5 âm lịch"`：含 `âm lịch` 與正確格式，PASS。
- 不同日註記（`lang.lunarToday('vi', {differs:true,...})`）→ 含 `lệch 1 ngày`：PASS。

---

## 驗收 3：F2 Tết／越南節日路由 + 誤觸防護

今天（測試執行當下台北日期）= 2026-07-05，獨立呼叫 `vnHoliday.tetCountdown('2026-07-05')` 現算得
`{days:216, date:'2027-02-06', yearNameZh:'丁未', yearNameVi:'Đinh Mùi'}`（與架構師宣稱一致，非抄錄）。

- `handleText(zhUid,'Tết')` / `'tết'`（小寫）/ `'越南節日'` → 皆含 `2027-02-06` 與 `216`：PASS。
- `handleText(viUid,'lễ Việt Nam')` → 含 Tết 倒數：PASS。
- 天數計算與台北今天日期一致：PASS（216 天，與 `tetCountdown` 現算值一致）。
- **誤觸防護**：`'tetris'`、`'internet'`、`'tết ơi con nhớ'`、`'越南節日嗎？'` 四個反例，stub `ai.chat` 後驗證
  **全部**呼叫到 `ai.chat`（即落到 AI 對話、未誤觸 F1/F2 路由）：PASS。

---

## 驗收 4：F3 早安推播

直接呼叫 `morning.lunarSection(code, ymd)`（純函式）：

| code | ymd | 期望 | 實際 | 結果 |
|---|---|---|---|---|
| zh-TW | 2026-07-14（現算 lunar 6/1/2026 tz8）| 含「農曆」+「初一（拜拜日）」| `📅 農曆六月初一\n今天是農曆初一（拜拜日）🙏` | PASS |
| zh-TW | 2026-07-05（平日廿一）| 只有農曆行、無加註 | `📅 農曆五月廿一` | PASS |
| vi | 2027-02-06（Tết）| 含 `mùng 1` + `Chúc mừng năm mới! 🧧` | `📅 Âm lịch: ngày 1 tháng 1\nHôm nay là mùng 1 âm lịch 🙏\nChúc mừng năm mới! 🧧` | PASS |
| zh-TW | 2026-07-28（現算 lunar 6/15/2026 tz8）| 含「十五（拜拜日）」| `📅 農曆六月十五\n今天是農曆十五（拜拜日）🙏` | PASS |
| vi | 同上 | 含 `ngày rằm` | `📅 Âm lịch: ngày 15 tháng 6\nHôm nay là ngày rằm 🙏` | PASS |
| vi | 2026-09-02（越南國慶，非初一十五）| 含 âm lịch 行 + Quốc khánh 祝福、無 mùng/rằm | `📅 Âm lịch: ngày 21 tháng 7\nHôm nay là Quốc khánh Việt Nam! 🇻🇳` | PASS |

**buildMessage 全量回歸**（`buildMessage` 未被 `morning.js` 匯出，故經 `sendAll()` 呼叫並攔截 stub 過的
`client.pushMessage` 驗證推播出去的實際文字；stub `weather.getWeather`＝固定字串、`birthday.todays`＝[]）：

- 推送剛好 1 則訊息：PASS。
- `parts[1]` 為農曆段（緊接問候語之後）：`["早安！新的一天加油 💪","📅 農曆五月廿一","🌤 台北市 28°C 晴"]`，`parts[1]` 精確等於
  `morning.lunarSection('zh-TW', 今天)` 的輸出：PASS。
- 移除農曆行後 = `["早安！新的一天加油 💪","🌤 台北市 28°C 晴"]`，即「問候語 + 天氣（無生日）」的舊格式：PASS
  （驗證新插入的農曆段不影響其餘既有內容，符合 PRD 驗收 6 的 byte-identical 要求）。

---

## 驗收 5：F4 `get_lunar_info` 工具

`tools.run(uid, 'get_lunar_info', JSON.stringify({query_type}))` 三種皆測：

- `today_lunar` → `"Today 2026-07-05 is lunar month 5, day 21, year Bính Ngọ (丙午) in BOTH the Taiwan lunar calendar (UTC+8) and the Vietnamese lunar calendar (UTC+7)."`：非空英文，PASS。
- `next_tet` → 含 `2027-02-06` 與 `216`（與現算 `tetCountdown` 一致）：PASS。
- `vn_holidays` → `"Next Vietnamese public holiday: Vietnam National Day on 2026-09-02, 59 days away. Next Tet: 2027-02-06 (216 days away)."`：非空，PASS。

---

## 驗收 6：不回歸

- `handleText(zhUid, '今天放假嗎')` → `"📅 2026-07-05（日）\n😌 今天是週末，不用上班！"`：TW 假日路由未受影響，PASS。
- `handleGroupText('test-group-1', '大家好啊今天天氣不錯')` → 走翻譯橋（回覆 `"🌐 STUB_ASK_REPLY"`，`ai.ask` 被呼叫 1 次），未被新 F1/F2 路由攔截（群組路徑本就不含新路由，程式碼層面確認 `handleGroupText` 只有翻譯開關 + 翻譯橋邏輯）：PASS。
- `handleText(zhUid, '匯率提醒')` → 正常回覆（`"你目前沒有匯率提醒。設定：「匯率提醒 850」"`），未受影響：PASS。
- `lang.helpMenu('vi')` 含新農曆行（`Âm lịch`、`Tết`）**且**所有既有行（`Thời tiết`、`Nhắc nhở`、`Sinh nhật`、`Tỷ giá`、`Ngày nghỉ`、`Dịch thuật`）仍在：PASS。
- `lang.helpMenu('zh-TW')` 含農曆行「農曆：「農曆」」：PASS。

---

## 過程中發現並自行修正的測試腳本問題（非原始碼 bug，記錄以利追溯）

1. 第一版測試 stub `ai.chat` 回傳固定字串巧合等於真正的 `chatFallback` 文案，一度誤判；改用可分辨的
   `'STUB_AI_REPLY'` 字串後修正。
2. `morning.js` 用解構 `const { getWeather } = require('./weather')`，測試腳本原本在 `morning.js`
   require **之後**才覆寫 `weatherMod.getWeather`，對已解構的區域變數不生效（`birthday.js` 因用
   namespace 方式呼叫 `birthday.todays(...)` 則不受影響）。改為在 `require('./services/morning.js')`
   **之前**、透過 `require.cache` 預先安插 stub 模組解決。
3. 確認 `morning.js` 未匯出 `buildMessage`（只匯出 `subscribe/unsubscribe/sendAll/start/lunarSection`），
   DESIGN §10.4 原本設計是直接呼叫 `buildMessage(sub)`；改用 `sendAll()` + stub 過的
   `client.pushMessage` 攔截實際推播內容驗證，效果等價（走的是同一段真實程式碼路徑）。

以上均為**測試腳本層面**的修正，未觸碰任何 `src/` 原始碼。

---

## 清理確認

- 測試腳本 `F:\Linebot\tests\lunar-tet.test.js` 已刪除，`tests\` 目錄亦一併移除（原本不存在）。
- `data/lang.json`：測試新增的 `test-lunar-zh-uid`、`test-lunar-vi-uid`、`test-morning-zh`、
  `test-tool-uid`（僅呼叫 `tools.run` 未寫入 lang）等測試項，已於腳本 `finally` 還原回測試前的
  15 筆內容；另外清掉了先前手動除錯（debug 用 `node -e`）殘留的 `debug-uid`/`debug-uid2`/`debug-uid3` 3 筆。
- `data/morning.json`：已還原為 `[]`（測試前狀態）。
- 未殘留任何背景 Node 程序（`process.exit(0)` 正常結束，`tasklist` 檢查僅見系統既有的
  `HiPKILocalSignServer` 進程，與本次測試無關）。
- `git status --short` 顯示僅 `feat/lunar-tet` 分支既有的原始碼變更，`data/` 目錄無殘留 diff。

# TEST：連假／放假查詢功能 驗收測試報告

**測試日期** 2026-06-29 22:51 (Asia/Taipei) | **測試人** RD#4（自動化腳本）
**Verdict** PASS — 通過 12/12 條 AC

---

## 驗收條件逐條結果

| # | 狀態 | 說明 |
|---|---|---|
| AC-01 | ✅ PASS | 工作日判定; 2026-06-30 是工作日（isHoliday=false, isComp=false） |
| AC-02 | ✅ PASS | 假日名稱判定（fixture 開國紀念日）; 2026-01-01 isHoliday=true, name="開國紀念日" |
| AC-03 | ✅ PASS | 補班日優先判定，不誤判為假日; 2026 年全年無補班日（符合 DESIGN.md 實測記錄），跳過補班日判定真實測試 |
| AC-04 | ✅ PASS | addDays('2026-06-29',1) === '2026-06-30'; addDays('2026-06-30',1) === '2026-07-01'; addDays('2026-12-31',1) === '2027-01 |
| AC-05 | ✅ PASS | 連假演算法：3天連假正確識別; 純週末2天不算連假; 補班日切斷連假計算; 日期不連續切斷連假; 5天連假名稱與天數正確; nextLongBreak() 含日期範圍+天數+假期名; 連假天數 4 >= 3 |
| AC-06 | ✅ PASS | 月份13 → 月份不正確; 月份0 → 月份不正確; 7月假日清單含表頭與假日記錄 |
| AC-07 | ✅ PASS | findNextDayOff 找到最近假日; 今天是假日也包含; nextHoliday() 回傳日期 2026-07-04 >= 今天 2026-06-29 |
| AC-08 | ✅ PASS | tools.run is_holiday 2026-06-30 含 Taiwan 且含假日狀態; get_taiwan_holiday 工具定義正確（含台灣、query_type 必填） |
| AC-09 | ✅ PASS | tools.run next_long_break 含 Taiwan; 連假 4 天 >= 3 |
| AC-10 | ✅ PASS | 12月假日清單有表頭且不崩潰 |
| AC-11 | ✅ PASS | helpText 含「今天放假嗎」; 「說明」也觸發 helpText |
| AC-12 | ✅ PASS | 月份錯誤不崩潰; usage() 不丟例外; getHolidaySummary 無效 queryType 不崩潰; getHolidaySummary 月份越界英文訊息; getYear(2099) 回 null（無資料不崩潰）; 未知日 |

---

## 所有子測試結果

- ✅ **AC-01(offline)**: 工作日判定
- ✅ **AC-02(offline)**: 假日名稱判定（fixture 開國紀念日）
- ✅ **AC-03(offline)**: 補班日優先判定，不誤判為假日
- ✅ **AC-04(addDays)**: addDays('2026-06-29',1) === '2026-06-30'
- ✅ **AC-04(crossMonth)**: addDays('2026-06-30',1) === '2026-07-01'
- ✅ **AC-04(crossYear)**: addDays('2026-12-31',1) === '2027-01-01'
- ✅ **AC-05(3-day-break)**: 連假演算法：3天連假正確識別
- ✅ **AC-05(2-day-weekend-not-counted)**: 純週末2天不算連假
- ✅ **AC-05(compensatory-cuts)**: 補班日切斷連假計算
- ✅ **AC-05(gap-cuts)**: 日期不連續切斷連假
- ✅ **AC-05(5-day-break)**: 5天連假名稱與天數正確
- ✅ **AC-06(month-13)**: 月份13 → 月份不正確
- ✅ **AC-06(month-0)**: 月份0 → 月份不正確
- ✅ **AC-07(offline)**: findNextDayOff 找到最近假日
- ✅ **AC-07(today-is-holiday)**: 今天是假日也包含
- ✅ **AC-11**: helpText 含「今天放假嗎」
- ✅ **AC-11(說明)**: 「說明」也觸發 helpText
- ✅ **AC-12(month-invalid)**: 月份錯誤不崩潰
- ✅ **AC-12(usage-no-throw)**: usage() 不丟例外
- ✅ **AC-12(invalid-queryType)**: getHolidaySummary 無效 queryType 不崩潰
- ✅ **AC-12(en-month-invalid)**: getHolidaySummary 月份越界英文訊息
- ✅ **Route(放假查詢)**: 「放假查詢」路由觸發 usage()
- ✅ **Route(假日查詢)**: 「假日查詢」路由觸發 usage()
- ✅ **Summary(month-13)**: getHolidaySummary month=13 英文錯誤訊息
- ✅ **CDN(fetch-2026)**: 成功抓到 2026 年資料，共 365 筆
- ✅ **AC-02(real-2026-01-01)**: 2026-01-01 isHoliday=true, name="開國紀念日"
- ✅ **AC-01(real-2026-06-30)**: 2026-06-30 是工作日（isHoliday=false, isComp=false）
- ✅ **AC-03(real)**: 2026 年全年無補班日（符合 DESIGN.md 實測記錄），跳過補班日判定真實測試
- ✅ **AC-04(real)**: describeDay 明天 2026-06-30 日期正確
- ✅ **AC-05(real)**: nextLongBreak() 含日期範圍+天數+假期名
- ✅ **AC-05(real-days>=3)**: 連假天數 4 >= 3
- ✅ **AC-06(real)**: 7月假日清單含表頭與假日記錄
- ✅ **AC-07(real)**: nextHoliday() 回傳日期 2026-07-04 >= 今天 2026-06-29
- ✅ **AC-10(real)**: 12月假日清單有表頭且不崩潰
- ✅ **AC-12(real-no-data)**: getYear(2099) 回 null（無資料不崩潰）
- ✅ **AC-12(real-friendly-msg)**: 未知日期回友善訊息
- ✅ **Cross-year(6.2)**: 2027年資料未公告，找不到跨年連假屬預期（友善訊息已驗）
- ✅ **AC-08(tools.run)**: tools.run is_holiday 2026-06-30 含 Taiwan 且含假日狀態
- ✅ **AC-09(tools.run)**: tools.run next_long_break 含 Taiwan
- ✅ **AC-09(days>=3)**: 連假 4 天 >= 3
- ✅ **AC-08/09(tool-def)**: get_taiwan_holiday 工具定義正確（含台灣、query_type 必填）
- ✅ **TimeContext**: timeContext 含放假/連假字樣
- ✅ **Route(今天放假嗎)**: 「今天放假嗎」路由正確
- ✅ **Route(明天放假嗎)**: 「明天放假嗎」路由正確且含明天
- ✅ **Route(下一個連假)**: 「下一個連假」路由正確
- ✅ **Route(最近的假日)**: 「最近的假日」路由正確
- ✅ **Route(7月假日)**: 「7月假日」路由觸發月份清單
- ✅ **Route(13月假日)**: 「13月假日」回月份不正確

---

## 測試環境
- Node.js：v26.2.0
- 台北時間：2026-06-29 22:51
- 資料來源：TaiwanCalendar CDN（https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/）
- Groq AI：AC-08/AC-09 工具層已驗，越南語 AI 改寫需人工測試

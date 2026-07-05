# 技術設計：農曆查詢＋越南節日／Tết 倒數＋初一十五提醒（DESIGN）

**版本** v1.0 | **日期** 2026-07-05 | **作者** 軟體架構師（RD#1）
**對應 PRD** `docs/loop/lunar-tet/PRD.md`
**分支** `feat/lunar-tet`

---

## 〇、一句話總結

新增**純算法、免金鑰、零網路**的農曆引擎 `src/services/lunar.js`（Hồ Ngọc Đức 天文農曆算法，帶時區參數 7.0＝越南／8.0＝台灣，**已由架構師實測全部通過權威日期驗證**，完整程式碼在 §三，照抄即可），加上越南節日服務 `src/services/vnHoliday.js`（內建假日表＋Tết 倒數）。指令走 `handler.js` 新路由（`農曆`／`âm lịch`／`越南節日`／`Tết`），自然語句走 `tools.js` 新工具 `get_lunar_info`，早安推播在問候語後**插入一行農曆**（zh 用台灣農曆、vi 用越南農曆），初一／十五／越南節日加註。

**需要金鑰：否**（純數學計算，不打任何 API、不寫任何檔案）。

---

## 一、演算法選型與實測驗證（PRD「農曆引擎」＋驗收 1）

### 1.1 選型結論：Hồ Ngọc Đức 天文農曆算法（採用）

兩個候選：(a) 天文算法、(b) 硬編月表。**採用 (a)**，理由：

- 一套程式碼同時支援 tz=7.0（越南）與 tz=8.0（台灣），**時區差異是本功能的硬需求**，月表方案要維護兩套表且無法自我驗證。
- 有效範圍廣（本設計保守標註 1900–2199），不用每幾年補表。
- 約 130 行純數學，無相依、無 I/O，符合 keyless 慣例。
- **架構師已在 scratch 環境完整實作並以 Node 22 實測**（見 §1.2），非只引用文獻。

演算法出處：Hồ Ngọc Đức《Thuật toán tính âm lịch》（https://www.informatik.uni-leipzig.de/~duc/amlich/），
核心：新月時刻（截斷 ELP 級數）＋太陽黃經（判中氣、定 11 月＝含冬至月）＋無中氣置閏，以**當地時區的日界**取整。

> ⚠️ 給 coder 的移植警告（架構師實測踩過的坑）：`lunar2solar` 最後一行必須是
> `jdToDate(monthStart + lunarDay - 1)`，**不是** `jdToDate(monthStart)`（後者只回月首，
> 中秋、雄王節等非初一的日期會整段錯）。§三的程式碼已是修正後版本，照抄勿改。

### 1.2 權威日期驗證表（全部 PASS，引擎輸出＝逐字實測結果）

實測方式：把 §三引擎放進 scratch 檔，`node test-lunar.js` 逐項比對。權威值來源見表後。

| # | 驗證項目 | 引擎輸出（實測） | 權威值 | 結果 |
|---|---|---|---|---|
| 1 | Tết 2026（越南農曆 1/1，tz7） | **2026-02-17** | 2026-02-17（丙午）| ✅ PASS |
| 2 | Tết 2027（tz7） | **2027-02-06** | 2027-02-06（丁未）| ✅ PASS |
| 3 | Tết 2028（tz7） | **2028-01-26** | 2028-01-26（戊申）| ✅ PASS |
| 4 | 台灣春節 2026/2027/2028（tz8） | **02-17／02-06／01-26** | 同左（與越南同日）| ✅ PASS |
| 5 | 2026 中秋節（台灣農曆 8/15，tz8） | **2026-09-25** | 2026-09-25（五）| ✅ PASS |
| 6 | Giỗ Tổ Hùng Vương 2026（越南農曆 3/10，tz7） | **2026-04-26** | 2026-04-26（日）| ✅ PASS |
| 7 | 2025 閏六月起訖（tz8 與 tz7 皆然） | **閏6/1＝2025-07-25、閏6/29＝2025-08-22、7/1＝2025-08-23** | 閏六月＝7/25–8/22（越南 2025 乙巳年同樣閏六月）| ✅ PASS |
| 8 | 閏月旗標：solar2lunar(25,7,2025) | **{month:6, day:1, leap:1}** | 閏六月初一 | ✅ PASS |
| 9 | **1985 著名分歧**：農曆 1985/1/1 | **tz7＝1985-01-21，tz8＝1985-02-20**（差一個月）| 越南 21/1/1985、中國 20/2/1985（乙丑年著名案例，1984 甲子年置閏月份不同所致）| ✅ PASS |
| 10 | **2007 一日分歧**：農曆 2007/1/1 | **tz7＝2007-02-17，tz8＝2007-02-18** | 越南 17/2、中國 18/2（新月落在 UTC+7 的 23:15＝UTC+8 的 00:15，引擎算出的新月當地時刻與文獻完全一致）| ✅ PASS |
| 11 | **2030 未來分歧**：農曆 2030/1/1 | **tz7＝2030-02-02，tz8＝2030-02-03** | 越南媒體明載 2030 越南比中國早一天過年（2007 後下一次，23 年週期）| ✅ PASS |
| 12 | 今天 2026-07-05 | **tz8＝五月廿一、tz7＝ngày 21 tháng 5**（同日）| PRD F1 範例即「農曆五月廿一」| ✅ PASS |
| 13 | 干支：2026 農曆年 | **丙午 / Bính Ngọ**（馬）；另 1984 甲子、1985 乙丑、2007 丁亥、2025 乙巳、2027 丁未、2028 戊申 | 同左 | ✅ PASS |
| 14 | 往返一致性：2024-01-01～2031-12-31 每一天 × 兩時區，solar→lunar→solar | **5,844 筆全數還原原日期，0 錯** | —（自洽性）| ✅ PASS |

**權威來源**（tester 可重查）：

- Tết 2026/2027/2028：PublicHolidays.vn（https://publicholidays.vn/vi/tet/ ）、越南政府政策入口（xaydungchinhsach.chinhphu.vn，丙午年放假公告）。
- 春節／中秋（台灣）：PublicHolidays.tw（https://publicholidays.tw/zh/mid-autumn-festival/ ：2026 中秋＝9/25 五）、人事行政總處 115 年行事曆彙整（calendar.talllkai.com/2026）。
- Giỗ Tổ Hùng Vương 2026＝2026-04-26（週日，農曆三月初十）：chinhphu.vn 官方活動公告、thuvienphapluat.vn。
- 2025 閏六月＝陽曆 7/25–8/22（中越皆同）：bachhoaxanh.com「Tháng 6 nhuận âm lịch 2025」、xemlicham.com。
- 1985／2007／2030 中越分歧：Công an Nhân dân《Bao giờ Việt Nam ăn Tết lệch với Trung Quốc?》、Thanh Niên《Vì sao năm nay Việt Nam ăn Tết trước Trung Quốc một ngày?》、khoahoc.tv（明載 2030 越南 2/2、週期 23 年）、nhandan.vn。

### 1.3 兩地農曆「不同日」的實際分布（引擎全掃描）

掃描 2025-01-01～2030-12-31（每天 × 兩時區）：**2025～2029 每一天中越農曆完全相同**；
唯一分歧窗＝**2030-02-02～2030-03-03**（共 30 天，2030 正月整月錯開一天，越南早一天）。
→ F1 的「不同日註記」在近三年幾乎不會觸發，但 2030 年會**連續一個月**觸發，邏輯必須做對（測試用 2030-02-02 當 stub 日期驗證）。

---

## 二、受影響檔案清單

| 檔案 | 動作 | 內容 |
|---|---|---|
| `src/services/lunar.js` | **新增** | 農曆引擎（§三完整程式碼照抄）＋格式化／干支／初一十五判定 helpers |
| `src/services/vnHoliday.js` | **新增** | 越南國定假日表（陽曆固定＋農曆換算）、`nextVnHoliday`、`tetCountdown`、`todayVnHoliday`、`getLunarSummary`（AI 工具用英文摘要）|
| `src/handler.js` | **修改** | 新增 F1／F2 兩條路由（放在既有越南語直達區） |
| `src/lang.js` | **修改** | F1／F2 回覆模板、早安農曆行、初一十五加註、越南節日祝福、helpMenu 各加一行 |
| `src/services/morning.js` | **修改** | `buildMessage` 問候語後插入農曆行（獨立 `lunarSection()` 匯出供測試）|
| `src/tools.js` | **修改** | `get_lunar_info` 工具定義＋`run()` 分支＋`timeContext()` 一句 |
| `README.md` | **修改（可選）** | 功能清單補一行 |

**決策：vnHoliday.js 獨立成檔**（不併入 lunar.js）。理由：lunar.js 是「純日曆數學」（零相依，
好測、可長期不動）；vnHoliday.js 是「業務資料＋文案資料源」（假日表會因政府公告調整）。
對齊現有慣例：台灣假日也是獨立的 holiday.js。

依賴方向（無環）：`vnHoliday.js → lunar.js`；`morning.js / handler.js / tools.js → 兩者`；`lunar.js → store.js`（僅 `todayLunar` 用 `taipei()`）。

---

## 三、`src/services/lunar.js` — 完整程式碼（已實測，照抄）

```js
// 農曆引擎：Hồ Ngọc Đức 天文農曆算法（純數學、免金鑰、零網路）。
//   timeZone 參數：7.0 = 越南農曆（UTC+7）、8.0 = 台灣/中國農曆（UTC+8）。
//   同一天兩地農曆「偶爾」差一天（如 2030-02-02～03-03），本引擎已實測重現
//   1985（差一個月）、2007 與 2030（差一天）的著名分歧案例。
//   有效範圍：1900–2199（保守值；演算法出處 https://www.informatik.uni-leipzig.de/~duc/amlich/）。
//
// 對外匯出：
//   TZ_VN, TZ_TW                          — 時區常數 7.0 / 8.0
//   solar2lunar(dd, mm, yy, tz)           — 國曆 → { day, month, year, leap }（year 為「農曆年」西元編號）
//   lunar2solar(day, month, year, leap, tz) — 農曆 → [dd, mm, yy]（leap 規格錯誤回 [0,0,0]）
//   lunarFromYmd('YYYY-MM-DD', tz)        — 便利包裝
//   todayLunar(tz)                        — 以 store.taipei() 的今天換算（台北「今天」的日期字串，
//                                            換算成 tz 指定的那套農曆；家人皆在台灣，故日界一律用台北）
//   lunarDateText(l, 'zh'|'vi'|'en')      — 格式化（zh：閏六月初一；vi：ngày 1 tháng 6 (nhuận)）
//   sexagenaryName(lunarYear, 'zh'|'vi')  — 干支年名（丙午 / Bính Ngọ）；參數是「農曆年」編號
//   mung1OrRam(l)                         — 'mung1' | 'ram' | null（初一／十五判定）

const store = require('../store');

const TZ_VN = 7.0;
const TZ_TW = 8.0;

const INT = Math.floor;

// ── 核心演算法（勿改動任何常數；已通過 §一 的 14 組權威驗證）──────────────

// 國曆（1582-10-15 後為格里曆）→ 儒略日數（整數，正午制）
function jdFromDate(dd, mm, yy) {
  const a = INT((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
  if (jd < 2299161) {
    jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
  }
  return jd;
}

// 儒略日數 → [dd, mm, yy]
function jdToDate(jd) {
  let a, b, c;
  if (jd > 2299160) {
    a = jd + 32044;
    b = INT((4 * a + 3) / 146097);
    c = a - INT((b * 146097) / 4);
  } else {
    b = 0;
    c = jd + 32082;
  }
  const d = INT((4 * c + 3) / 1461);
  const e = c - INT((1461 * d) / 4);
  const m = INT((5 * e + 2) / 153);
  const day = e - INT((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * INT(m / 10);
  const year = b * 100 + d - 4800 + INT(m / 10);
  return [day, month, year];
}

// 自 1900-01-01 起第 k 次新月的時刻（回傳 UTC 的儒略日浮點數）
function NewMoon(k) {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const dr = Math.PI / 180;
  let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  Jd1 = Jd1 + 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
  C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 = C1 + 0.001 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  let deltat;
  if (T < -11) {
    deltat = 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3;
  } else {
    deltat = -0.000278 + 0.000265 * T + 0.000262 * T2;
  }
  return Jd1 + C1 - deltat;
}

// 太陽黃經（弧度，0..2π），jdn 為 UTC 儒略日浮點數
function SunLongitude(jdn) {
  const T = (jdn - 2451545.0) / 36525;
  const T2 = T * T;
  const dr = Math.PI / 180;
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M);
  let L = L0 + DL;
  L = L * dr;
  L = L - Math.PI * 2 * INT(L / (Math.PI * 2));
  return L;
}

// 某日（當地 0 時）太陽黃經落在哪個 30° 區段（0..11）→ 判「中氣」
function getSunLongitude(dayNumber, timeZone) {
  return INT((SunLongitude(dayNumber - 0.5 - timeZone / 24) / Math.PI) * 6);
}

// 第 k 次新月「發生時刻」落在當地日曆的哪一天（儒略日整數）
function getNewMoonDay(k, timeZone) {
  return INT(NewMoon(k) + 0.5 + timeZone / 24);
}

// 某西元年「農曆 11 月」（含冬至的那個月）初一的儒略日
function getLunarMonth11(yy, timeZone) {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = INT(off / 29.530588853);
  let nm = getNewMoonDay(k, timeZone);
  const sunLong = getSunLongitude(nm, timeZone);
  if (sunLong >= 9) {
    nm = getNewMoonDay(k - 1, timeZone);
  }
  return nm;
}

// 從 11 月起算，第幾個月是閏月（無中氣月）；回 1..13
function getLeapMonthOffset(a11, timeZone) {
  const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last = 0;
  let i = 1;
  let arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  do {
    last = arc;
    i++;
    arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  } while (arc !== last && i < 14);
  return i - 1;
}

/**
 * 國曆 → 農曆。
 * @param {number} dd 國曆日  @param {number} mm 國曆月  @param {number} yy 國曆年
 * @param {number} timeZone 7.0（越南）或 8.0（台灣）
 * @returns {{day:number, month:number, year:number, leap:number}} leap=1 表示閏月；year 為農曆年西元編號
 */
function solar2lunar(dd, mm, yy, timeZone) {
  const dayNumber = jdFromDate(dd, mm, yy);
  const k = INT((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = getNewMoonDay(k + 1, timeZone);
  if (monthStart > dayNumber) {
    monthStart = getNewMoonDay(k, timeZone);
  }
  let a11 = getLunarMonth11(yy, timeZone);
  let b11 = a11;
  let lunarYear;
  if (a11 >= monthStart) {
    lunarYear = yy;
    a11 = getLunarMonth11(yy - 1, timeZone);
  } else {
    lunarYear = yy + 1;
    b11 = getLunarMonth11(yy + 1, timeZone);
  }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = INT((monthStart - a11) / 29);
  let lunarLeap = 0;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapMonthDiff = getLeapMonthOffset(a11, timeZone);
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) lunarLeap = 1;
    }
  }
  if (lunarMonth > 12) lunarMonth = lunarMonth - 12;
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
  return { day: lunarDay, month: lunarMonth, year: lunarYear, leap: lunarLeap };
}

/**
 * 農曆 → 國曆。
 * @param {number} lunarDay @param {number} lunarMonth @param {number} lunarYear 農曆年西元編號
 * @param {number} lunarLeap 是否閏月（0/1）
 * @param {number} timeZone 7.0 或 8.0
 * @returns {[number, number, number]} [dd, mm, yy]；leap 指定錯誤（該年該月非閏）回 [0,0,0]
 */
function lunar2solar(lunarDay, lunarMonth, lunarYear, lunarLeap, timeZone) {
  let a11, b11;
  if (lunarMonth < 11) {
    a11 = getLunarMonth11(lunarYear - 1, timeZone);
    b11 = getLunarMonth11(lunarYear, timeZone);
  } else {
    a11 = getLunarMonth11(lunarYear, timeZone);
    b11 = getLunarMonth11(lunarYear + 1, timeZone);
  }
  const k = INT(0.5 + (a11 - 2415021.076998695) / 29.530588853);
  let off = lunarMonth - 11;
  if (off < 0) off += 12;
  if (b11 - a11 > 365) {
    const leapOff = getLeapMonthOffset(a11, timeZone);
    let leapMonth = leapOff - 2;
    if (leapMonth < 0) leapMonth += 12;
    if (lunarLeap !== 0 && lunarMonth !== leapMonth) {
      return [0, 0, 0];
    } else if (lunarLeap !== 0 || off >= leapOff) {
      off += 1;
    }
  }
  const monthStart = getNewMoonDay(k + off, timeZone);
  return jdToDate(monthStart + lunarDay - 1); // ⚠️ 一定要 + lunarDay - 1（見 DESIGN §1.1 警告）
}

// ── 便利包裝 ─────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' → 農曆物件 */
function lunarFromYmd(ymd, timeZone) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return solar2lunar(d, m, y, timeZone);
}

/** 今天（台北日期字串）的農曆；tz 決定用哪套農曆（vi 訂閱者傳 TZ_VN） */
function todayLunar(timeZone) {
  return lunarFromYmd(store.taipei().date, timeZone);
}

// ── 格式化（規則詳見 DESIGN §四）──────────────────────────────────────

const ZH_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const ZH_MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '臘'];

/** 農曆日中文名：初一..初十、十一..十九、二十、廿一..廿九、三十 */
function zhDayName(d) {
  if (d <= 10) return '初' + ZH_NUM[d];
  if (d < 20) return '十' + ZH_NUM[d - 10];
  if (d === 20) return '二十';
  if (d < 30) return '廿' + ZH_NUM[d - 20];
  return '三十';
}

/** 農曆月中文名：正月..臘月，閏月加「閏」前綴 */
function zhMonthName(m, leap) {
  return (leap ? '閏' : '') + ZH_MONTHS[m - 1] + '月';
}

/**
 * 農曆日期文字。
 * zh：'五月廿一'、'閏六月初一'；vi：'ngày 21 tháng 5'、'ngày 1 tháng 6 (nhuận)'；
 * en：'month 5, day 21'、'leap month 6, day 1'
 * @param {{day:number, month:number, leap:number}} l
 * @param {'zh'|'vi'|'en'} style
 */
function lunarDateText(l, style) {
  if (style === 'zh') return zhMonthName(l.month, l.leap) + zhDayName(l.day);
  if (style === 'vi') return `ngày ${l.day} tháng ${l.month}${l.leap ? ' (nhuận)' : ''}`;
  return `${l.leap ? 'leap ' : ''}month ${l.month}, day ${l.day}`;
}

// ── 干支年（§四 有完整對照表；公式已對 1984 甲子、2026 丙午等 7 組實測）────

const CAN_ZH = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const CHI_ZH = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const CAN_VI = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
const CHI_VI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];

/**
 * 干支年名。注意：參數是「農曆年」西元編號（solar2lunar 回傳的 year），
 * 不是國曆年——例如 2026-01-01 屬農曆 2025 乙巳年。
 * @param {number} lunarYear
 * @param {'zh'|'vi'} style  zh→'丙午'，vi→'Bính Ngọ'
 */
function sexagenaryName(lunarYear, style) {
  const can = (lunarYear + 6) % 10;
  const chi = (lunarYear + 8) % 12;
  if (style === 'vi') return `${CAN_VI[can]} ${CHI_VI[chi]}`;
  return CAN_ZH[can] + CHI_ZH[chi];
}

/** 初一／十五判定：'mung1' | 'ram' | null */
function mung1OrRam(l) {
  if (l.day === 1) return 'mung1';
  if (l.day === 15) return 'ram';
  return null;
}

module.exports = {
  TZ_VN,
  TZ_TW,
  solar2lunar,
  lunar2solar,
  lunarFromYmd,
  todayLunar,
  lunarDateText,
  sexagenaryName,
  mung1OrRam,
  // 供離線測試
  jdFromDate,
  jdToDate,
};
```

> 格式化函式亦已實測：`五月廿一`、`正月初一`、`八月十五`、`三月初十`、`臘月二十`、`六月三十`、
> `閏六月初一`、`閏六月廿九`、`十一月十一`、`二月十九`、`ngày 21 tháng 5`、`ngày 1 tháng 6 (nhuận)` 12 組全對。

---

## 四、格式化規則與干支對照表（給 coder／tester 的規格）

### 4.1 中文農曆日期（台灣慣用）

- **月**：`正月、二月、三月、四月、五月、六月、七月、八月、九月、十月、十一月、臘月`（十二月寫**臘月**）。閏月加前綴**閏**（如 `閏六月`）。
- **日**：1–10 → `初一`～`初十`；11–19 → `十一`～`十九`；20 → `二十`；21–29 → `廿一`～`廿九`；30 → `三十`。
- 組合：`{閏?}{月名}{日名}`，例：`五月廿一`、`閏六月初一`。

### 4.2 越南語農曆日期

- 格式：`ngày {日} tháng {月}`，閏月加後綴 ` (nhuận)`，例：`ngày 21 tháng 5`、`ngày 1 tháng 6 (nhuận)`。
- F1 完整句（PRD 範例）：`📅 Hôm nay 05/07/2026 (dương lịch) là ngày 21 tháng 5 âm lịch`——注意 vi 的國曆寫法是 `DD/MM/YYYY`，zh 是 `YYYY/MM/DD`。
- 初一＝`mùng 1`、十五＝`ngày rằm`（只用在加註句，日期本體仍用數字）。

### 4.3 干支對照表（10 天干 × 12 地支）

| # | 天干 zh | 天干 vi | | # | 地支 zh | 地支 vi（生肖）|
|---|---|---|---|---|---|---|
| 0 | 甲 | Giáp | | 0 | 子 | Tý（鼠）|
| 1 | 乙 | Ất | | 1 | 丑 | Sửu（牛/越南為水牛）|
| 2 | 丙 | Bính | | 2 | 寅 | Dần（虎）|
| 3 | 丁 | Đinh | | 3 | 卯 | Mão（兔/越南為貓）|
| 4 | 戊 | Mậu | | 4 | 辰 | Thìn（龍）|
| 5 | 己 | Kỷ | | 5 | 巳 | Tỵ（蛇）|
| 6 | 庚 | Canh | | 6 | 午 | Ngọ（馬）|
| 7 | 辛 | Tân | | 7 | 未 | Mùi（羊）|
| 8 | 壬 | Nhâm | | 8 | 申 | Thân（猴）|
| 9 | 癸 | Quý | | 9 | 酉 | Dậu（雞）|
| | | | | 10 | 戌 | Tuất（狗）|
| | | | | 11 | 亥 | Hợi（豬）|

公式：`天干 index = (農曆年 + 6) % 10`、`地支 index = (農曆年 + 8) % 12`。
驗證錨點：1984＝甲子/Giáp Tý、**2026＝丙午/Bính Ngọ（馬）**、2027＝丁未/Đinh Mùi、2028＝戊申/Mậu Thân。

---

## 五、`src/services/vnHoliday.js` — 越南節日服務（規格）

純函式為主，「今天」一律由呼叫端傳入 `'YYYY-MM-DD'`（比照 holiday.js 的 `findNextLongBreak(records, todayYmd)` 模式，方便 tester stub 日期）。**農曆型節日一律用 `lunar.TZ_VN`（UTC+7）換算**（PRD 硬要求）。

```js
const lunar = require('./lunar');

// 陽曆固定假日（月-日）
const SOLAR_HOLIDAYS = [
  { md: '01-01', zh: '越南元旦（Tết Dương lịch）', vi: 'Tết Dương lịch', en: "New Year's Day (Vietnam)", greetVi: 'Chúc mừng năm mới dương lịch! 🎉' },
  { md: '04-30', zh: '越南南方解放日（30/4）',      vi: 'Ngày Giải phóng miền Nam (30/4)', en: 'Reunification Day (Vietnam)', greetVi: 'Hôm nay là ngày lễ 30/4! 🎉' },
  { md: '05-01', zh: '國際勞動節（1/5）',           vi: 'Ngày Quốc tế Lao động (1/5)', en: 'International Labor Day', greetVi: 'Hôm nay là ngày Quốc tế Lao động! 🎉' },
  { md: '09-02', zh: '越南國慶日（2/9）',           vi: 'Quốc khánh Việt Nam (2/9)', en: 'Vietnam National Day', greetVi: 'Hôm nay là Quốc khánh Việt Nam! 🇻🇳' },
];

// 農曆型假日（越南農曆 tz7 換算；month/day 為農曆月日）
const LUNAR_HOLIDAYS = [
  { month: 1, day: 1,  zh: 'Tết（越南農曆新年）', vi: 'Tết Nguyên Đán', en: 'Tet (Vietnamese Lunar New Year)', greetVi: 'Chúc mừng năm mới! 🧧' },
  { month: 3, day: 10, zh: '雄王節（Giỗ Tổ Hùng Vương）', vi: 'Giỗ Tổ Hùng Vương', en: 'Hung Kings Commemoration Day', greetVi: 'Hôm nay là Giỗ Tổ Hùng Vương 🙏' },
];
```

> 註 1：Tết 官方放假約「除夕～初四」多天，但表中**只錨定正月初一**（倒數與「下一個節日」都以初一為準；PRD F2 範例即是）。放假天數屬政府逐年公告，不硬編。
> 註 2：**引擎有效範圍即涵蓋範圍**（1900–2199），自然滿足 PRD「至少 2026–2028」。

**對外函式**：

| 函式 | 行為 |
|---|---|
| `holidaysOfYear(gregorianYear)` | 內部用：該國曆年所有假日 `{ date:'YYYY-MM-DD', zh, vi, en, greetVi }`。農曆型用 `lunar.lunar2solar(day, month, gregorianYear, 0, lunar.TZ_VN)`（農曆 1/1 與 3/10 的國曆落點必在同一國曆年，直接以 lunarYear=該年呼叫即可） |
| `nextVnHoliday(todayStr)` | 合併今年＋明年清單，取第一個 `date >= todayStr`，回 `{ date, daysAway, zh, vi, en }`（`daysAway` 用 UTC 毫秒差除 86400000 取整，比照 holiday.js `diffDays`；今天即節日 → 0） |
| `tetCountdown(todayStr)` | 今年 Tết（`lunar2solar(1,1,Y,0,TZ_VN)`）已過就取 Y+1；回 `{ days, date:'YYYY-MM-DD', lunarYear, yearNameZh, yearNameVi }`（yearName 用 `lunar.sexagenaryName(lunarYear, ...)`）|
| `todayVnHoliday(todayStr)` | 今天是假日回該筆（含 `greetVi`），否則 `null`（給早安 vi 祝福用）|
| `getLunarSummary({ queryType })` | AI 工具用英文摘要（今天取 `store.taipei().date`），三種 query_type 見 §八；純計算不會 throw，但仍比照慣例包 try/catch 回 null |

`getLunarSummary` 三種輸出格式（英文、含關鍵日期，讓模型用使用者語言轉述）：

- `today_lunar`：`Today 2026-07-05 is lunar month 5, day 21, year Bính Ngọ (丙午) in BOTH the Taiwan lunar calendar (UTC+8) and the Vietnamese lunar calendar (UTC+7).`；兩地不同日時改為 `... Taiwan lunar: {a}. Vietnamese lunar: {b}. NOTE: the two calendars differ by one day today.`；若初一/十五補一句 `Today is the 1st (mùng 1) / 15th (rằm) day of the lunar month — a traditional worship day.`
- `next_tet`：`Next Tet (Vietnamese Lunar New Year, year Đinh Mùi / 丁未) falls on 2027-02-06, which is 216 days from today (2026-07-05).`
- `vn_holidays`：`Next Vietnamese public holiday: Quốc khánh Việt Nam (2/9, Vietnam National Day) on 2026-09-02, 59 days away. Next Tet: 2027-02-06 (216 days away).`

---

## 六、`src/handler.js` — 新路由（F1／F2）

**位置**：放在「越南語關鍵字直達」區內（`asciiTrimmed` 定義之後、`發票對獎` 之前），
與 `tram xang`、`ty gia` 等路由同區。頂部 require 兩個新服務：
`const lunarSvc = require('./services/lunar');`、`const vnHoliday = require('./services/vnHoliday');`
（名稱避開既有變數；`lunar` 不衝突但取 `lunarSvc` 更清楚亦可，coder 二擇一）。

```js
// ── 農曆日期查詢（F1）───────────────────────────────────
// zh：農曆 / 今天農曆 / 農曆日期；vi：âm lịch / hôm nay âm lịch / âm lịch hôm nay
if (/^(?:今天)?農曆(?:日期)?$/.test(trimmed) ||
    /^(?:hom nay )?am lich(?: hom nay)?$/.test(asciiTrimmed)) {
  const code = await lang.resolve(userId);
  const today = store.taipei().date;
  const tw = lunarSvc.lunarFromYmd(today, lunarSvc.TZ_TW);
  const vn = lunarSvc.lunarFromYmd(today, lunarSvc.TZ_VN);
  const differs = tw.day !== vn.day || tw.month !== vn.month || tw.leap !== vn.leap;
  return lang.lunarToday(code, { today, tw, vn, differs, fmt: lunarSvc.lunarDateText });
}

// ── 越南節日＋Tết 倒數（F2）─────────────────────────────
// zh：越南節日 / 越南假日；vi：lễ Việt Nam（→ 'le viet nam'）；Tết（→ 'tet'，⚠️ 全訊息精準比對）
if (/^(?:越南節日|越南假日)$/.test(trimmed) ||
    /^le viet nam$/.test(asciiTrimmed) ||
    /^tet$/.test(asciiTrimmed)) {
  const code = await lang.resolve(userId);
  const today = store.taipei().date;
  return lang.vnHolidayReply(code, vnHoliday.nextVnHoliday(today), vnHoliday.tetCountdown(today));
}
```

**`'tet'` 誤觸防護（PRD 特別點名）**：

- 只比對 `asciiTrimmed`（整句 trim 後）且 regex 用 `^tet$` **頭尾錨定**——「tết」「Tết」「TET」命中；「tết 2027 là ngày nào」「viết tết giúp」等長句**不會**命中（長句照常進 AI 對話，由 `get_lunar_info` 工具接手）。
- **禁止**用 `includes('tet')` 或不錨定的 regex。tester 需驗證反例：`'internet'`、`'tetris'` 不觸發此路由。

**與既有路由不衝突**（已核對 handler.js 全部 pattern）：新 ascii 樣式 `am lich`、`le viet nam`、`tet` 與既有 `kham benh / bao ty gia / tram xang / gia xang / ty gia / tau hoa / thoi tiet / bat|tat tin sang` 皆無交集；`農曆` 與既有中文路由無交集。

---

## 七、`src/lang.js` — 新增字串（F1／F2／F3）

比照既有表格＋getter 模式（ja/th/id 回落 en、未知碼回落 zh-TW）。新增以下表與函式：

```js
// F1：今天農曆（{solar} 由呼叫端代入該語言慣用的國曆格式）
const LUNAR_TODAY = {
  'zh-TW': '📅 今天是 {solarZh}（國曆），農曆{lunarZh}',        // solarZh = 'YYYY/MM/DD'
  vi: '📅 Hôm nay {solarVi} (dương lịch) là {lunarVi} âm lịch', // solarVi = 'DD/MM/YYYY'
  en: '📅 Today {solarIso} is {lunarEn} in the lunar calendar',  // solarIso = 'YYYY-MM-DD'
};
// F1：兩地農曆不同日的註記（罕見；2030 正月會連續一個月觸發）
const LUNAR_DIFF_NOTE = {
  'zh-TW': 'ℹ️ 台灣與越南農曆今天不同日：越南農曆為{other}',
  vi: 'ℹ️ Lưu ý: âm lịch Đài Loan hôm nay là {other} (lệch 1 ngày với âm lịch Việt Nam)',
  en: 'ℹ️ Note: Taiwan and Vietnam lunar dates differ today. The other calendar shows {other}.',
};
// F3：早安農曆行
const MORNING_LUNAR_LINE = {
  'zh-TW': '📅 農曆{lunar}',            // 例：📅 農曆五月廿一
  vi: '📅 Âm lịch: {lunar}',            // 例：📅 Âm lịch: ngày 21 tháng 5
  en: '📅 Lunar: {lunar}',
};
// F3：初一／十五加註（PRD 原句照抄）
const MUNG_RAM_NOTE = {
  'zh-TW': { mung1: '今天是農曆初一（拜拜日）🙏', ram: '今天是農曆十五（拜拜日）🙏' },
  vi: { mung1: 'Hôm nay là mùng 1 âm lịch 🙏', ram: 'Hôm nay là ngày rằm 🙏' },
  en: { mung1: 'Today is the 1st day of the lunar month 🙏', ram: 'Today is the 15th day (full moon) of the lunar month 🙏' },
};
// F2：下一個越南節日＋Tết 倒數（兩段合成一則回覆）
const VN_HOLIDAY_REPLY = {
  'zh-TW': '🇻🇳 下一個越南節日：{name}\n📆 {date}（{away}）\n\n🧧 Tết 倒數：還有 {tetDays} 天到 Tết（{tetDate}，{yearName}年）',
  vi: '🇻🇳 Ngày lễ tiếp theo: {name}\n📆 {date} ({away})\n\n🧧 Còn {tetDays} ngày nữa đến Tết {yearName} ({tetDate})!',
  en: '🇻🇳 Next Vietnamese holiday: {name}\n📆 {date} ({away})\n\n🧧 {tetDays} days until Tet {yearName} ({tetDate})',
};
// {away}：daysAway>0 → zh『還有 N 天』/ vi『còn N ngày』/ en『in N days』；
// daysAway===0 → zh『就是今天！』/ vi『là hôm nay!』/ en『today!』。
// tetDays===0（今天就是 Tết）→ 整個 Tết 段落改為 zh『🧧 今天就是 Tết！新年快樂！』/
// vi『🧧 Hôm nay là Tết! Chúc mừng năm mới!』/ en『🧧 Today is Tet! Happy New Year!』
```

**新增 getter**（照 `morningOn` 等既有函式的回落慣例）：
`lunarToday(code, data)`、`lunarDiffNote(code, otherText)`、`morningLunarLine(code, lunarText)`、
`mungRamNote(code, kind)`、`vnHolidayReply(code, next, tet)`。

其中 `lunarToday(code, data)` 的組裝規則：

- `code === 'vi'` → 主體用 `data.vn`＋`lunarDateText(vn,'vi')`；`differs` 時加第二行 `lunarDiffNote('vi', lunarDateText(tw,'vi'))`。
- `code === 'zh-TW'`（含回落）→ 主體用 `data.tw`＋`lunarDateText(tw,'zh')`；`differs` 時加 `lunarDiffNote('zh-TW', lunarDateText(vn,'zh'))`。
- 其他（en/ja/th/id）→ en 模板＋`data.tw`（台灣農曆，因家人在台灣）；`differs` 時同理加註。

**helpMenu 三語各加一行**（放在「📅 放假」下一行）：
- zh：`'🈷️ 農曆：「農曆」｜越南節日/Tết 倒數：「越南節日」\n'`
- vi：`'🈷️ Âm lịch: gõ 「âm lịch」｜Ngày lễ VN & đếm ngược Tết: 「Tết」hoặc「lễ Việt Nam」\n'`
- en：`'🈷️ Lunar date: 「農曆」or「âm lịch」｜VN holidays & Tet countdown: 「Tết」\n'`

---

## 八、`src/services/morning.js` — 農曆行插入（F3）

**插入點精確規格**：`buildMessage(sub)` 中，`const parts = [lang.morningGreeting(code)];` 之後、
`let weatherText = '';` 之前。**既有問候／天氣／生日程式碼一個字元都不動**（PRD 驗收 6：
zh 訂閱者原內容 byte-identical，農曆行是「新插入的一個 part」，位置固定在 parts[1]）。

為了讓 tester 能 stub 日期（PRD 驗收 4），把組字邏輯抽成**獨立匯出的純函式**：

```js
const lunarSvc = require('./lunar');
const vnHoliday = require('./vnHoliday');

/**
 * 早安推播的農曆段（一個 part，可能 1～3 行）。純函式：日期由參數傳入，供離線測試。
 * @param {string} code 語言碼
 * @param {string} ymd  'YYYY-MM-DD'（正式呼叫傳 store.taipei().date）
 * @returns {string}
 */
function lunarSection(code, ymd) {
  const tz = code === 'vi' ? lunarSvc.TZ_VN : lunarSvc.TZ_TW; // zh 及其他語言 → 台灣農曆
  const l = lunarSvc.lunarFromYmd(ymd, tz);
  const style = code === 'vi' ? 'vi' : (code === 'zh-TW' ? 'zh' : 'en');
  let text = lang.morningLunarLine(code, lunarSvc.lunarDateText(l, style));
  const mr = lunarSvc.mung1OrRam(l);
  if (mr) text += '\n' + lang.mungRamNote(code, mr);
  if (code === 'vi') {
    const h = vnHoliday.todayVnHoliday(ymd);   // 越南節日祝福只給 vi 訂閱者
    if (h) text += '\n' + h.greetVi;
  }
  return text;
}
```

`buildMessage` 內的插入（**整段包 try/catch**，農曆算失敗絕不影響其餘早安內容）：

```js
try {
  parts.push(lunarSection(code, store.taipei().date));
} catch { /* 農曆失敗就略過該行 */ }
```

`module.exports` 補上 `lunarSection`。訊息長度：最多增加 3 短行（農曆行＋拜拜註＋節日祝福），
`sendAll` 既有 `.slice(0, 5000)` 已足夠防護。

---

## 九、`src/tools.js` — `get_lunar_info` 工具（F4）

**defs 追加**（放 `web_search` 之前）：

```js
{
  type: 'function',
  function: {
    name: 'get_lunar_info',
    description:
      '查詢農曆（陰曆）資訊：今天的農曆日期、Tết（越南農曆新年）倒數、下一個越南國定假日。' +
      '當使用者用任何語言（尤其越南語）問今天農曆幾號、初一十五、還有多久到 Tết／過年、' +
      '越南節日（còn bao lâu đến Tết? / 越南過年是哪天）時呼叫。' +
      '越南農曆（UTC+7）與台灣農曆（UTC+8）偶爾差一天，差異由系統自動計算並在結果中註明，' +
      '你不需要也不可以自行換算農曆。',
    parameters: {
      type: 'object',
      properties: {
        query_type: {
          type: 'string',
          enum: ['today_lunar', 'next_tet', 'vn_holidays'],
          description:
            'today_lunar=今天農曆日期（台灣＋越南兩套）；next_tet=Tết 倒數與確切日期；' +
            'vn_holidays=下一個越南國定假日。',
        },
      },
      required: ['query_type'],
    },
  },
},
```

**run() 分支**（放 `web_search` case 之前；頂部 require `const vnHoliday = require('./services/vnHoliday');`）：

```js
case 'get_lunar_info':
  return (
    (await vnHoliday.getLunarSummary({ queryType: a.query_type })) ||
    'Cannot compute lunar calendar info right now.'
  );
```

**timeContext() 追加一句**（接在台灣假日那句之後）：

```js
'若使用者用任何語言（含越南語）詢問農曆日期、初一或十五、Tết／越南過年倒數、越南節日，' +
  '就呼叫 get_lunar_info 工具，不要自己推算農曆（越南與台灣農曆可能差一天，必須由工具計算）。' +
```

---

## 十、測試策略（對照 PRD 驗收 1–7）

比照本專案慣例：臨時 Node 腳本（`tests/*.test.js`，跑完刪除）＋ `require.cache` stub 掉
`src/ai.js`／`src/line.js`／`src/services/richMenu.js`，不打真實 LINE/Groq API。`data/lang.json` 測前備份、測後還原。

### 10.1 驗收 1：引擎正確性（離線，直接 require `src/services/lunar.js`）

已知日期對照表（**共 14 組 > PRD 要求 8 組**；全部是 §1.2 實測通過的值，tester 應獨立重跑）：

| 輸入 | 期望輸出 |
|---|---|
| `lunar2solar(1,1,2026,0,TZ_VN)` | `[17,2,2026]`（Tết 2026）|
| `lunar2solar(1,1,2027,0,TZ_VN)` | `[6,2,2027]`（Tết 2027）|
| `lunar2solar(1,1,2028,0,TZ_VN)` | `[26,1,2028]`（Tết 2028）|
| `lunar2solar(1,1,2026,0,TZ_TW)` | `[17,2,2026]`（台灣春節 2026）|
| `lunar2solar(15,8,2026,0,TZ_TW)` | `[25,9,2026]`（2026 中秋）|
| `lunar2solar(10,3,2026,0,TZ_VN)` | `[26,4,2026]`（雄王節 2026）|
| `solar2lunar(25,7,2025,TZ_TW)` | `{day:1, month:6, leap:1}`（閏六月初一）|
| `solar2lunar(22,8,2025,TZ_TW)` | `{day:29, month:6, leap:1}`（閏六月末）|
| `solar2lunar(23,8,2025,TZ_TW)` | `{day:1, month:7, leap:0}`（出閏月）|
| `lunar2solar(1,1,1985,0,TZ_VN)` | `[21,1,1985]`（1985 越南）|
| `lunar2solar(1,1,1985,0,TZ_TW)` | `[20,2,1985]`（1985 中國，**差一個月**）|
| `lunar2solar(1,1,2007,0,TZ_VN)` vs `TZ_TW` | `[17,2,2007]` vs `[18,2,2007]`（差一天）|
| `lunar2solar(1,1,2030,0,TZ_VN)` vs `TZ_TW` | `[2,2,2030]` vs `[3,2,2030]`（差一天）|
| `solar2lunar(5,7,2026,TZ_TW)` 與 `TZ_VN` | 皆 `{day:21, month:5, leap:0}`；`lunarDateText` zh＝`五月廿一`、vi＝`ngày 21 tháng 5` |

加測：`sexagenaryName(2026,'zh')==='丙午'`、`sexagenaryName(2026,'vi')==='Bính Ngọ'`、
`sexagenaryName(2027,'zh')==='丁未'`；`mung1OrRam({day:1})==='mung1'`、`({day:15})==='ram'`、`({day:2})===null`；
格式化邊界：`初十`(10)、`十一`(11)、`二十`(20)、`廿一`(21)、`三十`(30)、`正月`、`臘月`、`閏` 前綴。
（建議）往返一致性抽樣：2026 全年每天 solar→lunar→solar 還原。

### 10.2 驗收 2（F1）

- 造 zh 使用者（lang.json 寫入 `zh-TW`）→ `handler.handleText(uid,'農曆')` → 回覆含「農曆」且含當天正確的 `lunarDateText(tw,'zh')` 子字串（期望值由測試腳本用同一引擎現算，非寫死）。
- 造 vi 使用者 → `'âm lịch'` 與 `'hôm nay âm lịch'` → 回覆含 `âm lịch` 與 `ngày {d} tháng {m}`。
- 不同日註記：直接呼叫 `lang.lunarToday('vi', {…differs:true…})` 驗證含 `lệch 1 ngày`（handler 層的今天無法 stub 成 2030，故此項在 lang 層測）。

### 10.3 驗收 3（F2）

- `handler.handleText(uid,'Tết')`、`'越南節日'`、`'lễ Việt Nam'` → 回覆含倒數天數與 Tết 國曆日期。
- 天數一致性：取 `store.taipei().date` 現算 `diffDays(today, tetDate)` 比對回覆中的數字（例：today=2026-07-05 → **216 天到 2027-02-06、丁未/Đinh Mùi**）。
- **誤觸反例**：`'internet'`、`'tetris'`、`'tết ơi'` 皆**不得**走 F2 路由（前兩者進 AI 對話 stub、後者亦進 AI）。

### 10.4 驗收 4（F3）

直接呼叫 `morning.lunarSection(code, ymd)`（純函式，無需 stub store）：

| code | ymd | 期望 |
|---|---|---|
| zh-TW | `2026-07-14`（農曆六月初一，兩地同）| 含 `農曆六月初一` 與 `今天是農曆初一（拜拜日）🙏` |
| zh-TW | `2026-07-28`（六月十五）| 含 `十五` 拜拜註 |
| vi | `2026-07-14` | 含 `mùng 1` 註 |
| vi | `2027-02-06`（Tết 2027）| 含 `mùng 1` 註＋`Chúc mừng năm mới! 🧧` |
| zh-TW | `2026-07-05`（平日廿一）| 只有 `📅 農曆五月廿一` 一行、無加註 |
| vi | `2026-09-02`（越南國慶，非初一十五）| 含 âm lịch 行＋`Quốc khánh` 祝福行、無 mùng/rằm 註 |

再以 stub 過 ai/line 的 `morning.buildMessage(sub)` 驗證農曆段落出現在問候語之後（parts[1] 位置）。

### 10.5 驗收 5（F4）

`tools.run('uid','get_lunar_info', JSON.stringify({query_type}))` 三種皆回非空英文字串：
`today_lunar` 含當天正確 lunar month/day；`next_tet` 含 `2027-02-06` 與 `216`（依測試當天現算）；
`vn_holidays` 含下一個假日日期（2026-07-05 起算＝`2026-09-02` Quốc khánh）。

### 10.6 驗收 6（不回歸）

- `handler.handleText`：`'今天放假嗎'`、`'下一個連假'`、`'ty gia'`、`'翻譯 越南語 你好'` 路由不變。
- `morning.buildMessage`：除新插入的 parts[1] 農曆段外，其餘 parts 與改動前逐字相同（stub 相同輸入比對）。
- 群組訊息路徑（`handleGroupText`）完全不經新路由（新路由只在 `handleText`）。

### 10.7 驗收 7

`node --check` 全部變更檔：`src/services/lunar.js`、`src/services/vnHoliday.js`、`src/handler.js`、`src/lang.js`、`src/services/morning.js`、`src/tools.js`。

---

## 十一、風險與對策

| # | 風險 | 評估與對策 |
|---|---|---|
| 1 | **月界精度（新月落在深夜 23:xx）**：截斷級數的新月時刻誤差約 ±1–2 分鐘，若新月恰落在當地午夜 ±2 分鐘內，日界判定可能與官方曆書不同——而 tz7/tz8 分歧正是發生在 23:00–24:00（UTC+7）窗口 | **信心高**：三個文獻記載的分歧案例（1985 差一月、2007 與 2030 差一天）引擎全數精確重現，2007 案例引擎算出的新月時刻 23:15（UTC+7）/00:15（UTC+8）與文獻一致、離午夜 15 分鐘遠大於誤差；全掃描 2025–2029 兩地無任何分歧日，與公開曆書相符。殘餘風險僅存在於「未來某年新月距午夜 <2 分鐘」的極罕見情形，家庭用途可接受 |
| 2 | **年份範圍**：演算法對過遠年份精度下降 | 保守標註 1900–2199；`getLunarSummary`／路由層都以 `store.taipei()` 的今天為輸入，實際只會用到當代年份。不加執行期 range guard（無使用者輸入年份的路徑） |
| 3 | **`'tet'` 誤觸**：3 字母短 token | `^tet$` 全訊息錨定、只比 `asciiTrimmed`；tester 有 `internet`／`tetris` 反例（§10.3）。長句「tết là ngày nào」交給 AI＋`get_lunar_info`，不損失功能 |
| 4 | **早安訊息變長**：vi 訂閱者最多 +3 行 | 全訊息仍 `.slice(0,5000)`；農曆段整段 try/catch，任何例外不影響既有內容（§八） |
| 5 | **zh 訂閱者內容回歸**：PRD 要求原內容 byte-identical | 農曆段是「新增的獨立 part」插在固定位置 parts[1]，不觸碰既有問候／天氣／生日程式碼；§10.6 有逐字比對測試 |
| 6 | **越南假日表非官方放假日**（Tết 連放多天、雄王節逢週日補假等） | 設計只錨定「節日本體日期」（PRD F2 範例即以初一倒數）；補假屬逐年公告，明確列為不做。文案不出現「放假 N 天」字樣避免誤導 |
| 7 | **「今天」的日界**：台北 00:00–01:00 之間河內仍是前一天 | 決策：家人皆在台灣，一律以 `store.taipei().date`（台北今天）為輸入日期，vi 只是「把同一個國曆日期換算成越南那套農曆」。此語意已寫進 lunar.js 檔頭註解，避免誤會 |
| 8 | **lunar2solar 移植錯誤**（架構師實測踩到：漏 `+ lunarDay - 1` 時初一以外全錯，但 Tết 類日期照樣對，很難肉眼發現） | §三程式碼已修正並加行內警告；§10.1 的中秋（8/15）與雄王節（3/10）兩組非初一測資即是此 bug 的哨兵 |

---

## 十二、给 coder 的實作順序建議

1. `src/services/lunar.js`（§三照抄）→ 先跑 §10.1 的 14 組對照自測。
2. `src/services/vnHoliday.js`（§五）→ 自測 `tetCountdown('2026-07-05')` 回 `{days:216, date:'2027-02-06', yearNameZh:'丁未', yearNameVi:'Đinh Mùi'}`。
3. `src/lang.js` 字串（§七）。
4. `src/handler.js` 路由（§六）。
5. `src/services/morning.js`（§八）。
6. `src/tools.js`（§九）。
7. `node --check` 全部變更檔。

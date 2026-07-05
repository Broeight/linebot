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

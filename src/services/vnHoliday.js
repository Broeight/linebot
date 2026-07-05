// 越南國定假日服務：陽曆固定假日 ＋ 農曆換算假日（Tết、雄王節），提供
// 「下一個越南節日」與「Tết 倒數」查詢。純函式為主，「今天」一律由呼叫端傳入
// 'YYYY-MM-DD'（比照 holiday.js 的 findNextLongBreak(records, todayYmd) 模式，方便 tester stub 日期）。
// 農曆型節日一律用 lunar.TZ_VN（UTC+7）換算（PRD 硬要求）。
//
// 對外匯出：nextVnHoliday、tetCountdown、todayVnHoliday、getLunarSummary（AI 工具用英文摘要）
//           holidaysOfYear（供離線測試）

const store = require('../store');
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

// ── 日期工具（純函式；比照 holiday.js diffDays）───────────────────────

/**
 * 兩個 'YYYY-MM-DD' 相差天數（to - from，可為負）。
 * @param {string} fromYmd
 * @param {string} toYmd
 * @returns {number}
 */
function diffDays(fromYmd, toYmd) {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86400000);
}

/** 數字補零成 2 碼 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 該國曆年所有假日 { date:'YYYY-MM-DD', zh, vi, en, greetVi }（依日期排序）。
 * 農曆型用 lunar.lunar2solar(day, month, gregorianYear, 0, lunar.TZ_VN)
 * （農曆 1/1 與 3/10 的國曆落點必在同一國曆年，直接以 lunarYear=該年呼叫即可）。
 * @param {number} gregorianYear
 * @returns {Array<{date:string, zh:string, vi:string, en:string, greetVi:string}>}
 */
function holidaysOfYear(gregorianYear) {
  const list = [];

  for (const h of SOLAR_HOLIDAYS) {
    list.push({
      date: `${gregorianYear}-${h.md}`,
      zh: h.zh,
      vi: h.vi,
      en: h.en,
      greetVi: h.greetVi,
    });
  }

  for (const h of LUNAR_HOLIDAYS) {
    const [dd, mm, yy] = lunar.lunar2solar(h.day, h.month, gregorianYear, 0, lunar.TZ_VN);
    if (dd === 0) continue; // 換算失敗（理論上不會發生，防禦性略過）
    list.push({
      date: `${yy}-${pad2(mm)}-${pad2(dd)}`,
      zh: h.zh,
      vi: h.vi,
      en: h.en,
      greetVi: h.greetVi,
    });
  }

  return list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 下一個越南節日：合併今年＋明年清單，取第一個 date >= todayStr。
 * @param {string} todayStr 'YYYY-MM-DD'
 * @returns {{date:string, daysAway:number, zh:string, vi:string, en:string}|null}
 */
function nextVnHoliday(todayStr) {
  const thisYear = Number(todayStr.slice(0, 4));
  const combined = [...holidaysOfYear(thisYear), ...holidaysOfYear(thisYear + 1)].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );
  const found = combined.find((h) => h.date >= todayStr);
  if (!found) return null;
  return {
    date: found.date,
    daysAway: diffDays(todayStr, found.date),
    zh: found.zh,
    vi: found.vi,
    en: found.en,
  };
}

/**
 * Tết 倒數：今年 Tết 已過就取明年。
 * @param {string} todayStr 'YYYY-MM-DD'
 * @returns {{days:number, date:string, lunarYear:number, yearNameZh:string, yearNameVi:string}}
 */
function tetCountdown(todayStr) {
  const thisYear = Number(todayStr.slice(0, 4));
  let [dd, mm, yy] = lunar.lunar2solar(1, 1, thisYear, 0, lunar.TZ_VN);
  let tetDate = `${yy}-${pad2(mm)}-${pad2(dd)}`;
  let lunarYear = thisYear;

  if (tetDate < todayStr) {
    lunarYear = thisYear + 1;
    [dd, mm, yy] = lunar.lunar2solar(1, 1, lunarYear, 0, lunar.TZ_VN);
    tetDate = `${yy}-${pad2(mm)}-${pad2(dd)}`;
  }

  return {
    days: diffDays(todayStr, tetDate),
    date: tetDate,
    lunarYear,
    yearNameZh: lunar.sexagenaryName(lunarYear, 'zh'),
    yearNameVi: lunar.sexagenaryName(lunarYear, 'vi'),
  };
}

/**
 * 今天是否為越南假日；是則回該筆（含 greetVi），否則回 null（給早安 vi 祝福用）。
 * @param {string} todayStr 'YYYY-MM-DD'
 * @returns {{date:string, zh:string, vi:string, en:string, greetVi:string}|null}
 */
function todayVnHoliday(todayStr) {
  const year = Number(todayStr.slice(0, 4));
  const found = holidaysOfYear(year).find((h) => h.date === todayStr);
  return found || null;
}

/**
 * AI 工具用英文摘要（今天取 store.taipei().date）。純計算不會 throw，
 * 但仍比照慣例包 try/catch 回 null。
 * @param {{queryType:string}} opts
 * @returns {string|null}
 */
function getLunarSummary({ queryType }) {
  const today = store.taipei().date;

  try {
    switch (queryType) {
      case 'today_lunar': {
        const tw = lunar.lunarFromYmd(today, lunar.TZ_TW);
        const vn = lunar.lunarFromYmd(today, lunar.TZ_VN);
        const differs = tw.day !== vn.day || tw.month !== vn.month || tw.leap !== vn.leap;
        const yearNameZh = lunar.sexagenaryName(tw.year, 'zh');
        const yearNameVi = lunar.sexagenaryName(tw.year, 'vi');

        let text;
        if (!differs) {
          text =
            `Today ${today} is lunar ${lunar.lunarDateText(tw, 'en')}, year ${yearNameVi} (${yearNameZh}) ` +
            'in BOTH the Taiwan lunar calendar (UTC+8) and the Vietnamese lunar calendar (UTC+7).';
        } else {
          text =
            `Today ${today}: Taiwan lunar: ${lunar.lunarDateText(tw, 'en')}. ` +
            `Vietnamese lunar: ${lunar.lunarDateText(vn, 'en')}. ` +
            'NOTE: the two calendars differ by one day today.';
        }

        const mr = lunar.mung1OrRam(tw);
        if (mr === 'mung1') {
          text += ' Today is the 1st (mùng 1) day of the lunar month — a traditional worship day.';
        } else if (mr === 'ram') {
          text += ' Today is the 15th (rằm) day of the lunar month — a traditional worship day.';
        }

        return text;
      }

      case 'next_tet': {
        const tet = tetCountdown(today);
        return (
          `Next Tet (Vietnamese Lunar New Year, year ${tet.yearNameVi} / ${tet.yearNameZh}) falls on ${tet.date}, ` +
          `which is ${tet.days} days from today (${today}).`
        );
      }

      case 'vn_holidays': {
        const next = nextVnHoliday(today);
        const tet = tetCountdown(today);
        if (!next) return `Next Tet: ${tet.date} (${tet.days} days away).`;
        return (
          `Next Vietnamese public holiday: ${next.en} on ${next.date}, ${next.daysAway} days away. ` +
          `Next Tet: ${tet.date} (${tet.days} days away).`
        );
      }

      default:
        return null;
    }
  } catch (_e) {
    return null;
  }
}

module.exports = {
  nextVnHoliday,
  tetCountdown,
  todayVnHoliday,
  getLunarSummary,
  // 供離線測試
  holidaysOfYear,
  diffDays,
};

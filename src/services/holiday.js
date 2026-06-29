// 台灣連假／放假查詢服務：使用 TaiwanCalendar（CDN JSON，免金鑰）。
//   資料來源：https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/{YYYY}.json
//   逐日一筆，isHoliday 含週末；補班日 isHoliday=false && description='補行上班'。
//
// 對外匯出：describeDay、nextLongBreak、nextHoliday、monthHolidays、usage（中文指令用）
//           getHolidaySummary（AI 工具用，回英文）
//           getYear、addDays、findNextLongBreak（供離線測試）

const store = require('../store');

// ── 常數 ─────────────────────────────────────────────────────────────
const BASE_URL        = 'https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/';
const CACHE_TTL_MS    = 6 * 60 * 60 * 1000;   // 正常快取 6 小時
const MISS_TTL_MS     = 30 * 60 * 1000;        // 次年缺檔的負快取 30 分鐘
const LONG_BREAK_MIN  = 3;                      // 連假定義：連續 ≥ 3 個放假日
const SOURCE          = 'TaiwanCalendar';

// ── 記憶體快取（以年份為 key）────────────────────────────────────────
// { [year]: { records: Array|null, ts: number, miss: boolean } }
const cache = {};

// ── 日期工具（純函式，可供離線測試）───────────────────────────────────

/**
 * Date → 'YYYY-MM-DD'（UTC 取值，避免時區漂移）
 * @param {Date} d
 * @returns {string}
 */
function toYmd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 'YYYY-MM-DD' 加 n 天，回 'YYYY-MM-DD'。
 * 用 UTC 建構，避免本機時區與夏令時間問題。
 * @param {string} dateStr
 * @param {number} n
 * @returns {string}
 */
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return toYmd(dt);
}

/**
 * 兩個 'YYYY-MM-DD' 相差天數（to - from，可為負）。
 * @param {string} fromYmd
 * @param {string} toYmd_
 * @returns {number}
 */
function diffDays(fromYmd, toYmd_) {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd_.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86400000);
}

/**
 * 把 record 的 date + week 格式化成 'YYYY-MM-DD（週X）'。
 * @param {{ date: string, week: string }} record
 * @returns {string}
 */
function formatDate(record) {
  return `${record.date}（${record.week}）`;
}

// ── 正規化 raw → Record ────────────────────────────────────────────
/**
 * 把 TaiwanCalendar 原始記錄正規化為 PRD §4.4 的欄位結構。
 * @param {{ date:string, week:string, isHoliday:boolean, description:string }} raw
 * @returns {{ date:string, week:string, isHoliday:boolean, holidayName:string, isCompensatory:boolean, description:string }}
 */
function normalize(raw) {
  // 補班日判定：isHoliday=false 且 description 含「補行上班」或「補班」
  const isCompensatory = raw.isHoliday === false && /補行上班|補班/.test(raw.description || '');
  // holidayName：放假時取 description；週末 isHoliday=true 但 description 為空 → 空字串
  const holidayName = raw.isHoliday ? (raw.description || '') : '';
  // date: 'YYYYMMDD' → 'YYYY-MM-DD'
  const raw8 = String(raw.date);
  const date = `${raw8.slice(0, 4)}-${raw8.slice(4, 6)}-${raw8.slice(6, 8)}`;

  return {
    date,
    week: raw.week || '',
    isHoliday: Boolean(raw.isHoliday),
    holidayName,
    isCompensatory,
    description: raw.description || '',
  };
}

// ── 抓取 + 快取 ────────────────────────────────────────────────────

/**
 * 取得指定年份的正規化記錄陣列。快取命中直接回；失敗回 null。
 * @param {number|string} year 四位數年份
 * @returns {Promise<Array|null>}
 */
async function getYear(year) {
  const y = Number(year);
  const now = Date.now();

  // 快取命中
  if (cache[y]) {
    const entry = cache[y];
    if (entry.miss && now - entry.ts < MISS_TTL_MS) {
      // 負快取（次年資料不存在），未過期 → 直接回 null
      return null;
    }
    if (!entry.miss && now - entry.ts < CACHE_TTL_MS) {
      return entry.records;
    }
  }

  // 5 秒逾時抓取
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const url = `${BASE_URL}${y}.json`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error('非陣列或空陣列');

    const records = data.map(normalize);
    // 存正常快取
    cache[y] = { records, ts: now, miss: false };
    return records;
  } catch (_e) {
    // 逾時、連線失敗、解析失敗 → 負快取
    cache[y] = { records: null, ts: now, miss: true };
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 取得特定日期的 Record；找不到或抓失敗回 null。
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {Promise<object|null>}
 */
async function getDay(dateStr) {
  const year = dateStr.slice(0, 4);
  const records = await getYear(year);
  if (!records) return null;
  return records.find((r) => r.date === dateStr) || null;
}

// ── 連假演算法（純函式，可供離線測試）────────────────────────────────

/**
 * 在已排序的 records 中，從 todayYmd 起找第一個連續 ≥ minDays 的放假日區間。
 * 補班日（isCompensatory）天然 isHoliday=false，自動切斷連續段。
 * 相鄰 Record 日期需連續（差 1 天），否則也視為斷裂。
 *
 * @param {Array} records 已按 date 升冪排序（可跨年）
 * @param {string} todayYmd 'YYYY-MM-DD'
 * @param {number} [minDays=3]
 * @returns {{ name:string, start:string, end:string, days:number }|null}
 */
function findNextLongBreak(records, todayYmd, minDays = LONG_BREAK_MIN) {
  // 從今天起的記錄
  const future = records.filter((r) => r.date >= todayYmd);

  let runStart = null;
  let runEnd   = null;
  let runLen   = 0;
  let runName  = '';
  let prevDate = null;

  for (const rec of future) {
    const isOff = rec.isHoliday; // 放假日（含週末、國定假日、補假）

    // 判斷是否連續
    const consecutive = prevDate && diffDays(prevDate, rec.date) === 1;

    if (isOff && (consecutive || runLen === 0)) {
      // 延伸或開始一段連續放假
      if (runLen === 0) {
        runStart = rec.date;
        runName  = rec.holidayName || '';
      } else if (!runName && rec.holidayName) {
        runName = rec.holidayName;
      }
      runEnd = rec.date;
      runLen += 1;
    } else {
      // 斷裂 → 先檢查這段夠不夠長
      if (runLen >= minDays) {
        return {
          name:  runName || '連假',
          start: runStart,
          end:   runEnd,
          days:  runLen,
        };
      }
      // 重置
      if (isOff) {
        runStart = rec.date;
        runEnd   = rec.date;
        runLen   = 1;
        runName  = rec.holidayName || '';
      } else {
        runStart = null;
        runEnd   = null;
        runLen   = 0;
        runName  = '';
      }
    }

    prevDate = rec.date;
  }

  // 掃完尾部未結算
  if (runLen >= minDays) {
    return {
      name:  runName || '連假',
      start: runStart,
      end:   runEnd,
      days:  runLen,
    };
  }

  return null;
}

/**
 * 在 records 中找從 todayYmd 起第一個 isHoliday===true 的記錄。
 * @param {Array} records
 * @param {string} todayYmd
 * @returns {object|null}
 */
function findNextDayOff(records, todayYmd) {
  return records.find((r) => r.date >= todayYmd && r.isHoliday) || null;
}

// ── 格式化輔助 ────────────────────────────────────────────────────────

/** 中文星期名稱陣列，0=日 */
const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 由日期字串推算中文星期（備用，當 record.week 遺失時）。
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {string}
 */
function weekOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return WEEK_ZH[dt.getUTCDay()];
}

/**
 * 把 record 格式化成 'YYYY-MM-DD（週X）'，缺 week 時自動推算。
 * @param {{ date:string, week:string }} rec
 * @returns {string}
 */
function fmtDate(rec) {
  const w = rec.week || weekOf(rec.date);
  return `${rec.date}（${w}）`;
}

// ── 中文指令用查詢函式（皆回格式化中文字串，不丟例外）────────────────

/**
 * 今天 / 明天 / 特定日是否放假。
 * 判定順序：補班 > 假日(有名/無名) > 工作日（PRD 6.3）
 *
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {string} [label='今天'] 顯示用字樣（'今天' / '明天'）
 * @returns {Promise<string>}
 */
async function describeDay(dateStr, label = '今天') {
  let rec;
  try {
    rec = await getDay(dateStr);
  } catch (_e) {
    rec = null;
  }

  if (!rec) {
    return '目前無法取得假日資料，請稍後再試 🙏';
  }

  const d = fmtDate(rec);

  // 補班優先（PRD 6.3）
  if (rec.isCompensatory) {
    return `📅 ${d}\n🔧 ${label}是補班日（非假日）`;
  }

  // 放假且有假名（國定假日 / 補假）
  if (rec.isHoliday && rec.holidayName) {
    return `📅 ${d}\n🎉 ${label}是假日：${rec.holidayName}`;
  }

  // 放假但無假名 = 純週末
  if (rec.isHoliday) {
    return `📅 ${d}\n😌 ${label}是週末，不用上班！`;
  }

  // 一般工作日
  return `📅 ${d}\n✅ ${label}是上班日，非假日`;
}

/**
 * 下一個連假（連續 ≥ 3 個放假日）。
 * 自動嘗試合併次年資料（跨年情境）。
 * @returns {Promise<string>}
 */
async function nextLongBreak() {
  const today = store.taipei().date;
  const thisYear = Number(today.slice(0, 4));
  const nextYear = thisYear + 1;

  let records;
  try {
    const thisYearRec = await getYear(thisYear);
    if (!thisYearRec) {
      return '目前無法取得假日資料，請稍後再試 🙏';
    }

    // 嘗試取次年（失敗就只用今年）
    const nextYearRec = await getYear(nextYear);
    records = nextYearRec
      ? [...thisYearRec, ...nextYearRec].sort((a, b) => (a.date < b.date ? -1 : 1))
      : thisYearRec;
  } catch (_e) {
    return '目前無法取得假日資料，請稍後再試 🙏';
  }

  const found = findNextLongBreak(records, today);

  if (!found) {
    // 今年找不到，可能是次年資料未公告
    const nextYearMissed = !(await getYear(nextYear));
    if (nextYearMissed) {
      return `目前尚無 ${nextYear} 年行事曆資料，待行政院公告後更新 🙏`;
    }
    return '目前找不到即將到來的連假資料 🙏';
  }

  // 格式化起訖日期
  const startRec = records.find((r) => r.date === found.start);
  const endRec   = records.find((r) => r.date === found.end);
  const startStr = startRec ? fmtDate(startRec) : found.start;
  const endStr   = endRec   ? fmtDate(endRec)   : found.end;

  // 距今天數
  const daysAway = diffDays(today, found.start);
  const awayStr  = daysAway <= 0 ? '就是今天！' : `距今還有 ${daysAway} 天`;

  // 連假名稱加「連假」後綴（若名稱本身不含「連假」）
  const name = found.name.includes('連假') ? found.name : `${found.name}連假`;

  // 起訖顯示：只保留月份起始，結束日以 MM-DD 呈現（跨年也完整顯示）
  const endDisplay =
    found.start.slice(0, 4) === found.end.slice(0, 4)
      ? `${found.end.slice(5, 7)}-${found.end.slice(8, 10)}（${(endRec && endRec.week) || weekOf(found.end)}）`
      : fmtDate(endRec || { date: found.end, week: weekOf(found.end) });

  return (
    `🗓 下一個連假：${name}\n` +
    `📆 ${startStr}–${endDisplay}\n` +
    `⏱ 共 ${found.days} 天（含週末）\n` +
    `📍 ${awayStr}`
  );
}

/**
 * 最近的假日（不限連假，含週末）。
 * @returns {Promise<string>}
 */
async function nextHoliday() {
  const today = store.taipei().date;
  const thisYear = Number(today.slice(0, 4));

  let records;
  try {
    records = await getYear(thisYear);
    if (!records) return '目前無法取得假日資料，請稍後再試 🙏';
  } catch (_e) {
    return '目前無法取得假日資料，請稍後再試 🙏';
  }

  const found = findNextDayOff(records, today);

  if (!found) {
    // 嘗試次年
    const nextYear = thisYear + 1;
    let nextRec;
    try {
      nextRec = await getYear(nextYear);
    } catch (_e) {
      nextRec = null;
    }
    if (!nextRec) {
      return `目前尚無 ${nextYear} 年行事曆資料，待行政院公告後更新 🙏`;
    }
    const foundNext = findNextDayOff(nextRec, today);
    if (!foundNext) return '找不到最近的假日資料 🙏';
    return formatNextHolidayResult(foundNext);
  }

  return formatNextHolidayResult(found);
}

/** 格式化「最近假日」結果（單筆 record）。 */
function formatNextHolidayResult(rec) {
  const d = fmtDate(rec);
  if (rec.holidayName) {
    return `📅 ${d}\n🎉 最近的假日：${rec.holidayName}`;
  }
  return `📅 ${d}\n😌 最近的假日：週末`;
}

/**
 * 指定月份所有假日清單（含補班日）。
 * @param {number} month 1–12
 * @param {number} [year] 預設今年
 * @returns {Promise<string>}
 */
async function monthHolidays(month, year) {
  // 月份驗證（PRD 6.6）
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return '月份不正確，請輸入 1 到 12 的數字';
  }

  const y = year || Number(store.taipei().date.slice(0, 4));

  let records;
  try {
    records = await getYear(y);
  } catch (_e) {
    records = null;
  }

  if (!records) {
    return `目前尚無 ${y} 年行事曆資料，待行政院公告後更新 🙏`;
  }

  const mm = String(month).padStart(2, '0');
  const monthPrefix = `${y}-${mm}`;

  // 篩出該月：假日或補班日
  const days = records.filter(
    (r) => r.date.startsWith(monthPrefix) && (r.isHoliday || r.isCompensatory)
  );

  const header = `📋 ${y} 年 ${month} 月假日\n`;

  if (days.length === 0) {
    return `${header}\nℹ️ 本月查無假日或補班資訊`;
  }

  let hasNationalHoliday = false;
  const lines = days.map((r) => {
    const dateStr = `${r.date.slice(5, 7)}-${r.date.slice(8, 10)}（${r.week || weekOf(r.date)}）`;
    if (r.isCompensatory) {
      return `${dateStr} 🔧 補班日（非假日）`;
    }
    if (r.holidayName) {
      hasNationalHoliday = true;
      return `${dateStr} 🎉 ${r.holidayName}`;
    }
    // 純週末
    return `${dateStr} 週末`;
  });

  const note = hasNationalHoliday ? '' : '\nℹ️ 本月無國定假日';

  return `${header}\n${lines.join('\n')}${note}`;
}

/**
 * 放假查詢使用說明（子選單）。
 * @returns {string}
 */
function usage() {
  return (
    '📅 放假查詢可以這樣問：\n' +
    '・今天放假嗎 / 明天放假嗎\n' +
    '・下一個連假\n' +
    '・最近的假日\n' +
    '・7月假日（查指定月份）'
  );
}

// ── AI 工具用英文摘要 ─────────────────────────────────────────────────

/**
 * 回傳英文純文字摘要，供 AI 工具呼叫後讓模型用使用者語言改寫。
 * 取不到資料時回 null；月份無效或次年未公告時回英文字串（讓模型轉述）。
 *
 * @param {{ queryType: string, date?: string, month?: number }} opts
 * @returns {Promise<string|null>}
 */
async function getHolidaySummary({ queryType, date, month }) {
  const today = store.taipei().date;

  try {
    switch (queryType) {
      case 'is_holiday': {
        const targetDate = date || today;
        const rec = await getDay(targetDate);
        if (!rec) return null;

        const dayOfWeek = rec.week || weekOf(targetDate);
        // 補班
        if (rec.isCompensatory) {
          return `Taiwan, ${targetDate} (${dayOfWeek}): make-up workday (NOT a holiday).`;
        }
        // 假日有名
        if (rec.isHoliday && rec.holidayName) {
          return `Taiwan, ${targetDate} (${dayOfWeek}): holiday — ${rec.holidayName}.`;
        }
        // 純週末
        if (rec.isHoliday) {
          return `Taiwan, ${targetDate} (${dayOfWeek}): weekend, day off.`;
        }
        // 工作日
        return `Taiwan, ${targetDate} (${dayOfWeek}): regular working day, not a holiday.`;
      }

      case 'next_long_break': {
        const thisYear = Number(today.slice(0, 4));
        const nextYear = thisYear + 1;

        const thisYearRec = await getYear(thisYear);
        if (!thisYearRec) return null;

        const nextYearRec = await getYear(nextYear);
        const combined = nextYearRec
          ? [...thisYearRec, ...nextYearRec].sort((a, b) => (a.date < b.date ? -1 : 1))
          : thisYearRec;

        const found = findNextLongBreak(combined, today);
        if (!found) {
          if (!nextYearRec) return `Taiwan ${nextYear} calendar is not published yet.`;
          return 'No upcoming long holiday found in Taiwan calendar data.';
        }

        const startW = combined.find((r) => r.date === found.start);
        const endW   = combined.find((r) => r.date === found.end);
        const sw = (startW && startW.week) || weekOf(found.start);
        const ew = (endW   && endW.week)   || weekOf(found.end);
        const daysAway = diffDays(today, found.start);
        const name = found.name.includes('連假') ? found.name : `${found.name}`;

        return (
          `Next long holiday in Taiwan: ${name} holiday, ` +
          `${found.start} (${sw}) to ${found.end} (${ew}), ` +
          `${found.days} days total (incl. weekend), starts in ${daysAway} days.`
        );
      }

      case 'next_holiday': {
        const thisYear = Number(today.slice(0, 4));
        const records  = await getYear(thisYear);
        if (!records) return null;

        const found = findNextDayOff(records, today);
        if (!found) {
          const nextYear = thisYear + 1;
          const nextRec  = await getYear(nextYear);
          if (!nextRec) return `Taiwan ${nextYear} calendar is not published yet.`;
          const f2 = findNextDayOff(nextRec, today);
          if (!f2) return null;
          const w2 = f2.week || weekOf(f2.date);
          return f2.holidayName
            ? `Next day off in Taiwan: ${f2.date} (${w2}), holiday: ${f2.holidayName}.`
            : `Next day off in Taiwan: ${f2.date} (${w2}), weekend.`;
        }

        const w = found.week || weekOf(found.date);
        return found.holidayName
          ? `Next day off in Taiwan: ${found.date} (${w}), holiday: ${found.holidayName}.`
          : `Next day off in Taiwan: ${found.date} (${w}), weekend.`;
      }

      case 'month_holidays': {
        // 月份驗證
        if (!Number.isInteger(month) || month < 1 || month > 12) {
          return `Invalid month "${month}". Use 1–12.`;
        }
        const y = Number(today.slice(0, 4));
        const records = await getYear(y);
        if (!records) return `Taiwan ${y} calendar is not published yet.`;

        const mm = String(month).padStart(2, '0');
        const monthPrefix = `${y}-${mm}`;
        const days = records.filter(
          (r) => r.date.startsWith(monthPrefix) && (r.isHoliday || r.isCompensatory)
        );

        if (days.length === 0) {
          return `Taiwan holidays in ${_monthName(month)} ${y}: no holidays or special days found.`;
        }

        let hasNational = false;
        const parts = days.map((r) => {
          const w = r.week || weekOf(r.date);
          const d = `${r.date.slice(5, 7)}-${r.date.slice(8, 10)}`;
          if (r.isCompensatory) return `${d} (${w}) make-up workday`;
          if (r.holidayName) { hasNational = true; return `${d} (${w}) holiday ${r.holidayName}`; }
          return `${d} (${w}) weekend`;
        });

        const note = hasNational ? '' : ' No national holidays this month.';
        return `Taiwan holidays/days-off in ${_monthName(month)} ${y}: ${parts.join('; ')}.${note}`;
      }

      default:
        return `Unknown query_type "${queryType}".`;
    }
  } catch (_e) {
    return null;
  }
}

/** 月份英文名（供摘要用）。 */
function _monthName(m) {
  const names = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return names[m] || `Month ${m}`;
}

// ── 匯出 ──────────────────────────────────────────────────────────────
module.exports = {
  // 中文指令用
  describeDay,
  nextLongBreak,
  nextHoliday,
  monthHolidays,
  usage,
  // AI 工具用
  getHolidaySummary,
  // 供測試（純函式 / 核心）
  getYear,
  addDays,
  findNextLongBreak,
  findNextDayOff,
};

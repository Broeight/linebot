// 天氣查詢服務範例：使用 Open-Meteo（完全免費、不需 API key）。
//   1. 先用地理編碼 API 把「地名」轉成經緯度
//   2. 再用預報 API 取得當前天氣
// 你可以照這個模式，新增其他「查詢類」服務（股價、匯率、翻譯…）。

const WMO = {
  0: '☀️ 晴朗',
  1: '🌤 大致晴朗',
  2: '⛅ 局部多雲',
  3: '☁️ 多雲',
  45: '🌫 起霧',
  48: '🌫 霧凇',
  51: '🌦 毛毛雨（小）',
  53: '🌦 毛毛雨（中）',
  55: '🌦 毛毛雨（大）',
  61: '🌧 下雨（小）',
  63: '🌧 下雨（中）',
  65: '🌧 下雨（大）',
  71: '🌨 下雪（小）',
  73: '🌨 下雪（中）',
  75: '🌨 下雪（大）',
  80: '🌧 陣雨（小）',
  81: '🌧 陣雨（中）',
  82: '🌧 陣雨（大）',
  95: '⛈ 雷雨',
  96: '⛈ 雷雨伴冰雹',
  99: '⛈ 強雷雨伴冰雹',
};

// 台灣主要城市內建座標（Open-Meteo 免費地理編碼對台灣地名不可靠：
// 「新竹」會命中屏東、「高雄」命中中國、「台北」查無 —— 實測見 docs/loop/vi-weather/PRD.md）
const TW_PLACES = {
  '基隆': { lat: 25.128, lon: 121.742, en: 'keelung' },
  '台北': { lat: 25.038, lon: 121.563, en: 'taipei' },
  '新北': { lat: 25.012, lon: 121.466, en: 'new taipei' },
  '板橋': { lat: 25.012, lon: 121.466, en: 'banqiao' },
  '桃園': { lat: 24.994, lon: 121.301, en: 'taoyuan' },
  '中壢': { lat: 24.954, lon: 121.226, en: 'zhongli' },
  '新竹': { lat: 24.804, lon: 120.971, en: 'hsinchu' },
  '竹北': { lat: 24.839, lon: 121.004, en: 'zhubei' },
  '苗栗': { lat: 24.560, lon: 120.821, en: 'miaoli' },
  '台中': { lat: 24.148, lon: 120.674, en: 'taichung' },
  '彰化': { lat: 24.081, lon: 120.538, en: 'changhua' },
  '南投': { lat: 23.910, lon: 120.684, en: 'nantou' },
  '斗六': { lat: 23.712, lon: 120.543, en: 'douliu' },
  '嘉義': { lat: 23.480, lon: 120.449, en: 'chiayi' },
  '台南': { lat: 22.999, lon: 120.227, en: 'tainan' },
  '高雄': { lat: 22.627, lon: 120.302, en: 'kaohsiung' },
  '屏東': { lat: 22.683, lon: 120.489, en: 'pingtung' },
  '宜蘭': { lat: 24.757, lon: 121.753, en: 'yilan' },
  '花蓮': { lat: 23.977, lon: 121.605, en: 'hualien' },
  '台東': { lat: 22.756, lon: 121.144, en: 'taitung' },
  '澎湖': { lat: 23.571, lon: 119.579, en: 'penghu' },
  '金門': { lat: 24.437, lon: 118.318, en: 'kinmen' },
};

// 越南語別名（漢越音 → 中文名；沿用 traTrain 已匯出的 toAscii 摺疊規則）
// 不 import traTrain（避免天氣依賴台鐵服務；表小、直接在本檔維護一份天氣用別名）
const VN_PLACES = {
  'co long': '基隆', 'dai bac': '台北', 'tan bac': '新北', 'ban kieu': '板橋',
  'dao vien': '桃園', 'trung lich': '中壢', 'trung ly': '中壢', 'trung li': '中壢',
  'tan truc': '新竹', 'truc bac': '竹北', 'mieu lat': '苗栗', 'dai trung': '台中',
  'chuong hoa': '彰化', 'nam dau': '南投', 'dau luc': '斗六', 'gia nghia': '嘉義',
  'dai nam': '台南', 'cao hung': '高雄', 'binh dong': '屏東', 'nghi lan': '宜蘭',
  'hoa lien': '花蓮', 'dai dong': '台東', 'banh ho': '澎湖', 'kim mon': '金門',
};

// 去除越南語聲調並小寫（Đ/đ → d）；同 traTrain 實作，複製一份、不跨模組 import 私有函式
function toAscii(s) {
  return String(s).toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// 標準 Levenshtein 編輯距離（DP）；同 traTrain 實作，複製一份
function lev(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

// VN_PLACES 去空白版索引（模組載入時建立一次），供容忍「tantruc」等無空白拼法
const VN_PLACES_NOSPACE = {};
for (const k of Object.keys(VN_PLACES)) VN_PLACES_NOSPACE[k.replace(/\s+/g, '')] = VN_PLACES[k];

// 統一地名解析：內建表（中／英／越南語）優先，查不到才走既有 geocode 鏈。
// 命中回傳形狀與 geocode result 相容：{ name, latitude, longitude, country }。
async function resolvePlace(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;

  // 1. zh 直查：去尾市/縣、臺→台
  const zh = raw.replace(/臺/g, '台');
  const zhStripped = zh.replace(/(市|縣)$/, '');
  if (TW_PLACES[zhStripped]) {
    const p = TW_PLACES[zhStripped];
    return { name: zhStripped, latitude: p.lat, longitude: p.lon, country: '台灣' };
  }

  // 2. vi 別名：直查 → 去空白 → 模糊容錯（lev ≤2，key 長度 ≥4）
  const asciiFull = toAscii(zh.replace(/(市|縣)$/, ''));
  if (VN_PLACES[asciiFull]) {
    const zhName = VN_PLACES[asciiFull];
    const p = TW_PLACES[zhName];
    return { name: zhName, latitude: p.lat, longitude: p.lon, country: '台灣' };
  }
  const asciiNoSpace = asciiFull.replace(/\s+/g, '');
  if (VN_PLACES_NOSPACE[asciiNoSpace]) {
    const zhName = VN_PLACES_NOSPACE[asciiNoSpace];
    const p = TW_PLACES[zhName];
    return { name: zhName, latitude: p.lat, longitude: p.lon, country: '台灣' };
  }
  if (asciiNoSpace) {
    let bestDist = Infinity;
    let bestZh = null;
    for (const key of Object.keys(VN_PLACES)) {
      const keyNoSpace = key.replace(/\s+/g, '');
      if (keyNoSpace.length < 4) continue; // 防短字誤中
      const d = lev(asciiNoSpace, keyNoSpace);
      if (d < bestDist) {
        bestDist = d;
        bestZh = VN_PLACES[key];
      }
    }
    if (bestZh && bestDist <= 2) {
      const p = TW_PLACES[bestZh];
      return { name: bestZh, latitude: p.lat, longitude: p.lon, country: '台灣' };
    }
  }

  // 3. en：完全相等，大小寫不敏感
  const asciiLower = asciiFull.toLowerCase();
  for (const [zhName, p] of Object.entries(TW_PLACES)) {
    if (p.en === asciiLower) {
      return { name: zhName, latitude: p.lat, longitude: p.lon, country: '台灣' };
    }
  }

  // 太短的「純 ASCII 拉丁」字串（多半是聊天字詞，如 anh/xin）不丟給地理編碼，
  // 避免命中無關的世界地名（tester 抓到 anh→衣索比亞）。帶聲調的真實短地名
  //（如越南的 Huế）含非 ASCII 字元，不受此規則影響。
  if (/^[a-zA-Z]{1,3}$/.test(raw)) return null;

  // 4. fallback：沿用既有 geocode 鏈（行為不變）
  let place = await geocode(raw);
  if (!place && /^[一-龥]+$/.test(raw) && !/[市縣區鄉鎮]$/.test(raw)) {
    place = (await geocode(raw + '市')) || (await geocode(raw + '縣'));
  }
  return place || null;
}

// 帶 5 秒逾時的 JSON 抓取；逾時／連線失敗／非 200 一律回 null（比照其他服務）
async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 用 Open-Meteo 地理編碼把地名轉成經緯度，找不到時回傳 null。
async function geocode(name) {
  const url =
    'https://geocoding-api.open-meteo.com/v1/search' +
    `?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`;
  const data = await fetchJson(url);
  return data?.results?.length ? data.results[0] : null;
}

async function getWeather(city) {
  if (!city) return '請告訴我地名，例如：天氣 台北市';

  // 1. 地名解析：內建台灣城市表（中／英／越南語）優先，查不到才走 geocode 鏈
  const place = await resolvePlace(city);

  if (!place) {
    return (
      `找不到「${city}」這個地點 😅\n` +
      '試試看完整名稱（例如「台北市」）或英文（例如「Taipei」）。'
    );
  }

  // 2. 取得當前天氣
  const wUrl =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${place.latitude}&longitude=${place.longitude}` +
    '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m';
  const w = await fetchJson(wUrl);
  const c = w?.current;
  if (!c) return '目前無法取得天氣資料，請稍後再試 🙏';

  const desc = WMO[c.weather_code] || '🌈 天氣狀況未知';
  const name = [place.name, place.country].filter(Boolean).join('、');

  return (
    `📍 ${name}\n` +
    `${desc}\n` +
    `🌡 溫度：${c.temperature_2m}°C\n` +
    `💧 濕度：${c.relative_humidity_2m}%\n` +
    `💨 風速：${c.wind_speed_10m} km/h`
  );
}

// WMO 代碼的英文說明（給 AI 工具用，避免中文字夾進其他語言的回覆）
const WMO_EN = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers', 95: 'Thunderstorm',
  96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail',
};

// 給 AI 工具呼叫用：回傳「現在 + 未來三天」的純文字摘要（英文標籤、含降雨機率），
// 讓模型自己用使用者的語言改寫。查不到回 null。
async function getForecastSummary(city) {
  const place = await resolvePlace(city);
  if (!place) return null;

  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${place.latitude}&longitude=${place.longitude}` +
    '&current=temperature_2m,relative_humidity_2m,weather_code' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=auto&forecast_days=3';
  const w = await fetchJson(url);
  const c = w?.current;
  const d = w?.daily;
  if (!c || !d || !Array.isArray(d.time)) return null; // 取不到就回 null，交給 AI 工具處理
  const name = [place.name, place.country].filter(Boolean).join(', ');
  const labels = ['Today', 'Tomorrow', 'Day after'];
  const days = (d.time || []).map(
    (date, i) =>
      `${labels[i] || date}(${date.slice(5)}): ${Math.round(d.temperature_2m_min[i])}~${Math.round(
        d.temperature_2m_max[i]
      )}°C, ${WMO_EN[d.weather_code[i]] || '—'}, rain chance ${d.precipitation_probability_max[i]}%`
  );
  return (
    `Location: ${name}\n` +
    `Now: ${c.temperature_2m}°C, humidity ${c.relative_humidity_2m}%, ${WMO_EN[c.weather_code] || '—'}\n` +
    days.join('\n')
  );
}

module.exports = { getWeather, getForecastSummary, resolvePlace };

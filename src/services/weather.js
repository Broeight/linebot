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

  // 1. 地理編碼：地名 → 經緯度
  //    免費的 Open-Meteo 地理編碼對部分中文地名比較挑，
  //    所以對中文輸入額外嘗試補上「市 / 縣」再查一次。
  let place = await geocode(city);
  if (!place && /^[一-龥]+$/.test(city) && !/[市縣區鄉鎮]$/.test(city)) {
    place = (await geocode(city + '市')) || (await geocode(city + '縣'));
  }

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
  let place = await geocode(city);
  if (!place && /^[一-龥]+$/.test(city) && !/[市縣區鄉鎮]$/.test(city)) {
    place = (await geocode(city + '市')) || (await geocode(city + '縣'));
  }
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

module.exports = { getWeather, getForecastSummary };

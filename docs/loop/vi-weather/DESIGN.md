# DESIGN — 天氣地名解析修復

## ✅ 需要金鑰：否（內建座標表；geocode fallback 沿用既有免金鑰端點）

## 變更檔案
1. `src/services/weather.js` — 內建城市表 + `resolvePlace` + 兩個查詢函式改用它
2. `src/tools.js` — get_weather 的 location 參數說明

## 1. src/services/weather.js

### 1a. 內建表（市中心座標，寫死常數）
```js
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
```

### 1b. 越南語別名（漢越音 → 中文名；沿用 traTrain 已匯出的 toAscii 摺疊規則）
**不 import traTrain**（避免天氣依賴台鐵服務；表小、直接在本檔維護一份天氣用別名）：
```js
const VN_PLACES = {
  'co long': '基隆', 'dai bac': '台北', 'tan bac': '新北', 'ban kieu': '板橋',
  'dao vien': '桃園', 'trung lich': '中壢', 'trung ly': '中壢', 'trung li': '中壢',
  'tan truc': '新竹', 'truc bac': '竹北', 'mieu lat': '苗栗', 'dai trung': '台中',
  'chuong hoa': '彰化', 'nam dau': '南投', 'dau luc': '斗六', 'gia nghia': '嘉義',
  'dai nam': '台南', 'cao hung': '高雄', 'binh dong': '屏東', 'nghi lan': '宜蘭',
  'hoa lien': '花蓮', 'dai dong': '台東', 'banh ho': '澎湖', 'kim mon': '金門',
};
```
本檔內放小型 `toAscii(s)`（同 traTrain 實作：lowercase、đ→d、NFD 去組合符號）與
`lev(a,b)`（標準 DP；或從設計上允許複製 traTrain 內私有實作——**複製，不跨模組 import 私有函式**）。

### 1c. `resolvePlace(name)`（async；回 `{ name, latitude, longitude } | null`…見下）
```
輸入處理：String(name).trim()；空 → null。
1. zh 直查：t = 去尾 /(市|縣)$/、臺→台 → TW_PLACES[t] 命中 → 回 { name: t, latitude, longitude, builtin: true }
2. vi 別名：a = toAscii(原字串去尾市縣)；
   VN_PLACES[a] → 中文名 → 表；
   VN_PLACES[a.replace(/\s+/g,'')]（用預建 no-space 索引）；
   模糊：對每個 alias key（同樣 no-space 化）計 lev(aNoSpace, keyNoSpace)，
   取距離最小且 ≤2、且 key 長度 ≥4 者（防短字誤中）→ 中文名 → 表。
3. en：a 與 TW_PLACES 各項 .en 比對（完全相等，大小寫不敏感）→ 表。
4. fallback：沿用既有 geocode 鏈（geocode(name) → 中文再試 +市/+縣），
   命中回 geocode 的 result 物件（含 name/latitude/longitude/country）。
5. 皆無 → null。
```
- **注意**：步驟 1–3 命中回的物件要與 geocode result 形狀相容（有 `name/latitude/longitude`；
  `country` 給 `'台灣'`），讓下游組字不用分支。

### 1d. 兩個查詢函式
`getWeather` 與 `getForecastSummary` 開頭的「geocode + 市縣重試」邏輯**整段換成** `await resolvePlace(city)`。
其餘（抓天氣、組輸出）不動。`getWeather` 找不到的訊息維持原句。
`module.exports` 增加 `resolvePlace`（供測試）。

## 2. src/tools.js — get_weather location 說明
改為：`'地點名稱，直接傳使用者原話裡的地名（中文、英文或越南語皆可，例如「新竹市」、「Hsinchu」、越南語直接傳 "Tân Trúc"）。絕對不要自行音譯或翻譯地名，系統會自動解析。'`

## 測試策略（對應 PRD 驗收 1–5）
- `resolvePlace` 表命中案例離線可測（不需網）；`Hà Nội`/亂碼 走 geocode 需網。
- 端到端 `getForecastSummary('tân trúc')`、`getWeather('新竹')` 需網（Open-Meteo forecast）。
- 座標斷言用 ±0.1（高雄需斷言 lat < 25 證明不是四川 31.x；新竹斷言 24.7~24.9 證明不是屏東 22.x）。
- grep tools.js 舊句已無、新句含「不要自行音譯」。
- `node --check` weather.js + tools.js。

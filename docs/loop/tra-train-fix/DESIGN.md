# DESIGN — 修復越南站名辨識

## 變更檔案
1. `src/tools.js`
2. `src/services/traTrain.js`

## 1. src/tools.js — 停止叫模型音譯，改叫它傳原文

### 1a. `get_tra_train` 的 `from`/`to` 參數說明
移除「優先用中文站名」的引導。改為：
- `from`: 「起站站名，**直接用使用者原本說的原文**（中文、英文或越南語皆可，例如越南語直接傳
  `Tân Trúc`、`Trung Lịch`）。**絕對不要自己把它音譯／翻譯成漢字**，以免猜錯；系統會自動辨識中／英／越南語站名。」
- `to`: 「迄站站名，規則同 from。」

### 1b. `timeContext()` 尾句
把「就呼叫 get_tra_train 工具（傳中文站名）。」改為：
「就呼叫 get_tra_train 工具，**站名直接傳使用者原本說的原文（中／英／越南語都可，例如越南語直接傳 Tân Trúc、Trung Lịch），不要自己音譯成漢字**。」

## 2. src/services/traTrain.js — VN 別名補齊 + 容錯

### 2a. 擴充 `VN_ALIAS`（漢越音去聲調小寫 → 中文站名）
補上口語變體與更多站，至少加入：
- 中壢變體：`'trung li': '中壢'`（已有 `trung lich`/`trung ly`）
- 其他主要站的漢越音（若尚缺）：`'dai bac'`（已有）、`'tan bac'`（新北無台鐵主站，略）、
  `'co hung'/'cao hung'→高雄`、`'dai nguyen'/'dao vien'→桃園`、`'tan trang'`（略）。
  以既有表為基礎，**只補明確正確的**，不要亂加。

### 2b. `normalizeStation` 加一層 VN 容錯後備（可選但建議）
在現有 `VN_ALIAS[toAscii(t)]` 直查之後，若仍找不到，做一次「去空白」再查：
```
const asciiNoSpace = toAscii(t).replace(/\s+/g, '');
```
用一份「去空白版」的別名索引（可在模組載入時由 `VN_ALIAS` 一次建立，key 去空白）比對，
以容忍使用者把「trung lich」打成「trunglich」等。**不得改變**既有直查優先序與中文/英文解析行為。

> 保持 `normalizeStation` 仍為 async、回傳 `{name,id}|null`；不動 `fetchStations`、快取、輸出。

## 測試策略（tester 依此驗收）
離線 node 腳本 require `./src/services/traTrain`，對 §驗收條件1 的每個輸入呼叫
`await normalizeStation(x)`，斷言 `.name` 等於預期；並 grep `src/tools.js` 確認已無「傳中文站名」、
已無「優先用中文站名」。`node --check` 兩檔。若 PTX 站表可連，順帶實查一次
`getTraTrainSummary({from:'tân trúc', to:'trung lì', day:'tomorrow'})` 應非 null 且非 "Station not recognized"。

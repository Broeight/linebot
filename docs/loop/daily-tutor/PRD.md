# PRD — 🗣 每日中文小老師

## 背景
越南家人長期在台灣生活，想幫她持續學實用中文。訂閱後每天固定時間（預設 20:00）推一課：
**3 句情境中文**（繁體＋漢語拼音＋越南語意思），主題每天輪替（菜市場/醫院/學校/捷運/郵局/銀行/夜市/藥局/餐廳/超市/火車站/戶政事務所/鄰居寒暄/打電話，共 14 個）。

## 需求
- 指令：`開啟學中文`／vi `học tiếng Trung`（訂閱）；`關閉學中文`／`tắt học tiếng Trung`；
  `今天的中文`／`học hôm nay`（隨時看當日課，未生成則現場生成）。確認訊息依使用者語言。
- **全家共享每日一課**：課程內容每天只用 AI 生成一次（`ai.askJSON`），快取到 `data/tutor-state.json`
  （重啟/redeploy 不重生成——經 store 門面同步雲端）；所有訂閱者收同一課（課文本身就是中＋拼音＋越對照，
  只有包裝字串依語言）。
- 主題輪替**無狀態**：`THEMES[daysSinceEpoch(台北日期) % 14]`——重啟不影響順序。
- 排程比照 house 模式（30 秒 tick、ticking guard、`hm >= config.tutorTime && lastSent !== date`、
  **先標記再發**防重複）；訂閱者 0 人時不生成不呼叫 AI。
- **AI 失敗政策**：當天靜默跳過（lastSent 照標記），「今天的中文」指令＝重試路徑；不推靜態墊檔句。
- `TUTOR_TIME` 環境變數可調（預設 '20:00'）；不新增 AI 工具（省每則訊息 token）。
- `store.js` KNOWN_KEYS 必須加 `tutor.json`、`tutor-state.json`。
- helpMenu 三語各加一行學中文指令。

## 課程格式（lang.tutorLesson 組裝）
```
🗣 今天的中文課 — 菜市場（chợ）
1. 老闆，這個多少錢？
🔤 Lǎobǎn, zhège duōshǎo qián?
🇻🇳 Ông chủ ơi, cái này bao nhiêu tiền?
（×3）
💡 想再看一次？輸入「今天的中文」／Muốn xem lại? Gõ "học hôm nay"
```

## 生成 prompt（ai.askJSON，temperature 0、≤512 tokens）
- system：`你是教越南人學實用繁體中文的老師。主題：{themeZh}（tiếng Việt: {themeVi}）。請出 3 句在台灣「{themeZh}」場景最常用的口語短句（繁體中文，每句≤12字、禮貌自然），附漢語拼音（含聲調符號）與越南語意思。只輸出 JSON：{"phrases":[{"zh":"...","pinyin":"...","vi":"..."}]}`
- user：`今天是 {YYYY-MM-DD}，請給和平常不同的例句。`
- 驗證：`phrases` 為陣列且 ≥3 個含非空 zh/pinyin/vi 的項目 → slice(0,3)；否則視為失敗（回 null，不污染快取）。
- in-flight promise memo：20:00 tick 與同時的「今天的中文」不得重複呼叫 Groq。

## 驗收（可測，全離線 stub）
1. 訂閱/退訂冪等＋zh/vi 確認句；ascii 變體（hoc tieng trung / tat hoc tieng trung / hoc hom nay）路由正確。
2. `ensureLesson`：同日兩次呼叫（含並發）→ Groq 恰 1 次；壞 JSON/不足 3 句 → null、TUTOR_FAIL、狀態不污染；
   成功 → tutor-state.json 持久化（模擬重啟後不重生成）。
3. tick 閘門（stub pushMessage 收集）：時間到＋未發＋有訂閱者 → 每訂閱者 1 push（依各自語言包裝）、lastSent 標記、
   同日第二次 tick 不重發；0 訂閱者 → 不呼叫 AI；ensureLesson null → 不 push 但 lastSent 已標記（跳過政策）。
4. `themeFor` 連續 14 天無重複、循環正確、重啟（重新 require）後同日同主題。
5. KNOWN_KEYS 斷言含兩個新檔。
6. 回歸：「開啟早安」等既有指令不受影響；node --check 全過；測試不 require index.js、不 .start()、結尾 process.exit(0)。

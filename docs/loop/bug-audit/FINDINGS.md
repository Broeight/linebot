# LINE Bot 程式碼稽核：潛在 Bug 清單

稽核日期：2026-06-30
稽核範圍：src/**（webhook、AI、工具迴圈、各 service、排程）
稽核員：資深 QA / 程式碼稽核員（只稽核，未修改任何程式碼）

說明：
- 嚴重度：P0＝會崩潰／資料遺失／安全；P1＝行為錯誤；P2＝小問題。
- 每項標明「已確認可重現」或「理論風險」。
- 不列純風格偏好。

---

## 摘要統計

- P0：3 個
- P1：6 個
- P2：5 個

最關鍵前 5 名（一句話）：
1. (P0) reminder.js 排程器在 await push() 期間持有舊快照再覆寫整個檔，webhook 此時新增的提醒會被靜默吃掉（已重現資料遺失）。
2. (P0) reminder.js／morning.js 用 setInterval 跑 async callback，當推播較慢時會發生 callback 重入，導致一次性提醒重複推播（已重現並發重入）。
3. (P0) ai.js 的 ask／askJSON／transcribe／vision 完全沒有 try/catch，Groq 429（速率限制）或網路錯誤會直接冒泡，翻譯／食譜／語音／圖片功能會回「發生了一點問題」而非友善訊息。
4. (P1) weather.js 的 fetch／.json()／w.current 全無防呆，Open-Meteo 改格式或回錯誤物件時直接 TypeError（已重現）。
5. (P1) ai.js 的 parseFailedToolCalls 正則遇到「JSON 後面還有文字」就抓不到，tool_use_failed 救援會靜默失敗，提醒／記帳沒設成功卻像沒事（已重現）。

---

## P0

### P0-1　reminder 排程器與 webhook 的 read-modify-write 競態 → 提醒遺失
- 位置：src/services/reminder.js:168-191（start() 的 interval callback）；同檔所有 load()→改→save() 的函式（add 60-88、addParsed 91-111、addDailyPreset 130-136、removeByTag 139-144、clear 147-151）。
- 問題描述：排程 callback 先 const list = load()，接著對到期提醒 await push(...)（網路 I/O，會把控制權交回事件迴圈），最後 save(kept) 把當初讀到的快照過濾後整包寫回。在那段 await 期間，若 webhook 流程也 load()→push 新提醒→save()，排程器之後的 save 會用舊快照覆寫，剛新增的提醒整筆消失。
- 為何會發生／如何觸發：Node 單執行緒但高度並發；load/save 是「整檔讀、整檔寫」沒有任何鎖。只要使用者在排程 callback 正在推播的那 30 秒視窗內新增／清除提醒即會中招。
- 證據（已重現）：模擬排程器在 await push 期間 yield、webhook 同時 load→push→save，最終檔案為 []，新提醒 b 遺失（lost the new reminder b? true）。
- 建議修法：寫檔改為「讀-改-寫」最小化並序列化：(a) 排程器在 await 之前先決定要送哪些、await 完成後重新 load() 再以 id 為基準更新狀態而非整包覆寫；(b) 為所有 save 加一個進程內的簡單互斥（async mutex／序列化 queue）；(c) 一次性提醒的「已送」狀態應寫入檔案（見 P0-2）而非只靠記憶體 _done。長期應改用 SQLite/Redis 等具原子性的儲存。

### P0-2　setInterval + async callback 重入 → 一次性提醒重複推播
- 位置：src/services/reminder.js:169（setInterval(async () => {...}, 30*1000)）；同模式 src/services/morning.js:59。
- 問題描述：setInterval 不會等前一個 async callback 完成才排下一個。當提醒筆數多、或 LINE pushMessage／lang.resolve(getProfile) 變慢，單次 callback 執行超過 30 秒時，下一個 tick 會重入並與前一個並發執行。兩個 tick 都在各自 save 前 load() 到「_done 尚未持久化」的同一筆一次性提醒，於是 push() 被呼叫兩次 → 使用者收到重複提醒。_done 只存在記憶體中、且 save(kept) 會把它過濾掉，無法跨 callback 去重。
- 為何會發生／如何觸發：_done 是 in-memory 標記，但每個 callback 都重新 load() 出全新物件（沒有 _done）；重入的兩個 callback 各自持有不同物件實例，互不可見彼此的 _done。
- 證據（已重現）：setInterval 50ms、callback 120ms 的模擬顯示 max concurrent callbacks: 3（callback 重入確實發生）。
- 建議修法：用「自我排程」取代 setInterval：callback 結尾再 setTimeout(tick, 30s)，並用 let running 旗標防重入；一次性提醒送出前先把「已送/刪除」狀態原子性寫檔（先標記再推播，失敗再回補），確保去重以檔案為準。morning.js 的 lastSent 同理應持久化（見 P1-4）。

### P0-3　Groq 呼叫無 try/catch（ask / askJSON / transcribe / vision）→ 429 或網路錯誤冒泡
- 位置：src/ai.js:95-106（ask）、112-128（askJSON，雖 JSON.parse 有保護但 groq.chat...create 本身沒有）、135-142（transcribe）、156-172（vision）。
- 問題描述：這四個函式直接 await groq...create(...)，未捕捉例外。Groq 免費額度遇到 429（rate limit）、5xx、逾時或網路中斷時會丟例外。呼叫端：translate.js、food.js 直接呼叫 ai.ask；handler.handleImage 直接 await ai.vision；handler.handleAudio 直接 await ai.transcribe；reminder.parse 呼叫 ai.askJSON。例外一路冒泡到 index.js handleEvent 的 catch，使用者收到通用「抱歉，發生了一點問題」。
- 為何會發生／如何觸發：家庭多人同時使用、或短時間連發語音/圖片時很容易觸發 Groq 429。剛修好的 chat()（tool_use_failed）只保護了「對話」一條路徑，這四條沒被保護。
- 證據：理論風險為主，但與已發生的真實 bug（tool_use_failed）同源同級——皆為「Groq 回非預期狀態未被接住」。transcribe/vision 連 getContentBuffer 之後的 AI 步驟都沒有 try。
- 建議修法：在 ask／askJSON／transcribe／vision 內各加 try/catch；對 429 特別處理（回「使用人數較多，請稍後再試」之類友善訊息），其餘回 null／預設字串讓上層走既有的 fallback（例如 translate 已有 || '翻譯失敗'）。askJSON 失敗回 null（已有），但要確保 create 本身不丟。

---

## P1

### P1-1　weather.js 外部 API 無防呆 → 格式變動／錯誤回應即崩
- 位置：src/services/weather.js:35-37（geocode 的 fetch/res.json()）、63-67（getWeather 取 w.current 再讀 c.weather_code）、103-113（getForecastSummary 取 w.current、d.temperature_2m_min[i] 等）。
- 問題描述：所有 fetch／.json() 都沒有 try/catch，且直接存取 w.current.xxx、d.temperature_2m_min[i]。當 Open-Meteo 回錯誤物件（如 {error:true,reason:...}）、欄位缺漏、或網路逾時（完全沒設逾時）時會丟 TypeError。
- 為何會發生／如何觸發：API 暫時故障、地點剛好查得到 geocode 卻取不到天氣、回應 schema 變動。
- 證據（已重現）：render({error:true}) → TypeError: Cannot read properties of undefined (reading 'weather_code')；renderForecast({daily:{time:[...]}}) 缺 min 陣列 → TypeError: ...reading '0'。
- 影響範圍：getWeather 由 handleText 直接呼叫（「天氣 台北市」指令），崩潰會回通用錯誤訊息；getForecastSummary 經 tools.run 有 try 包住（較安全）；morning.buildMessage 對 getWeather 有 try（早安推播安全）。但指令路徑不友善。
- 建議修法：geocode/getWeather/getForecastSummary 全部加 try/catch + AbortController 逾時（比照 exchangeRate/holiday/fuelPrice 的 5s 寫法），並在讀 w.current、各 daily 陣列前判空，失敗回友善字串／null。

### P1-2　invoice.js fetchLatest 無 try/catch → 對獎時外部來源故障即冒泡
- 位置：src/services/invoice.js:23（await (await fetch(FEED_URL)).text()，無 try、無逾時）。
- 問題描述：fetchLatest 直接 fetch 財政部 RSS 並 .text()，沒有錯誤處理也沒有逾時。checkInvoice 在 const data = await fetchLatest() 沒有 try 包住（只在 !data 時回友善訊息），故 fetch 本身丟錯（DNS、逾時、5xx）會冒泡。checkInvoice 同時被 handler（指令）與 tools.run（AI 工具，後者有 try）呼叫。
- 為何會發生／如何觸發：該政府網站不穩或逾時時。
- 證據：理論風險（與 weather 同型，fetch().text() 無保護）。
- 建議修法：fetchLatest 內整段 try/catch + AbortController 逾時，失敗回 null（上層已能處理 null）。

### P1-3　parseFailedToolCalls 對「JSON 後仍有文字」抓不到 → 救援靜默失敗
- 位置：src/ai.js:9-19，正則 /<function=([a-zA-Z0-9_]+)[\s\S]*?(\{[\s\S]*?\})\s*<\/function>/g。
- 問題描述：正則要求 } 後緊接（可選空白）</function>。若模型在 JSON 之後、</function> 之前還吐了文字（例如 ...,"amount":120} please confirm</function>），整個比對失敗，recovered.length === 0，於是 fallback 走「不帶工具重試」。結果：模型本來想設提醒/記帳，卻靜默地沒設成功，回給使用者的卻是一般回覆，使用者以為設好了。
- 為何會發生／如何觸發：Llama 在 tool_use_failed 的 failed_generation 中夾雜說明文字是常見情況。
- 證據（已重現）：輸入 <function=add_expense{"item":"lunch","amount":120} please confirm</function> → 解析結果為 undefined（沒抓到）。
- 次要風險：正則用非貪婪 \{[\s\S]*?\}，當 </function> 缺失或被截斷時也抓不到；多個 function 連寫雖可抓到（已驗證），但若其中一個 JSON 截斷則整串可能錯位。
- 建議修法：放寬擷取——抓 <function=NAME 後第一個 { 起，用「括號配對計數」找出對應的 }（而非正則非貪婪），容忍尾端雜訊；解析每段 arguments 時各自 try/catch，單筆失敗不影響其他筆。

### P1-4　morning.js 的 lastSent 僅存記憶體 → 重啟後同日重複推播或漏送
- 位置：src/services/morning.js:57（let lastSent = ''）。
- 問題描述：lastSent 是進程內變數。若伺服器在早安時間附近重啟（Render 免費方案會休眠/重啟），lastSent 歸空，下一個 tick 若仍在 MORNING_TIME 那一分鐘，會再推一次；反之若重啟錯過該分鐘，當天完全漏送（沒有補送邏輯）。同樣地，reminder 的每日提醒也只靠 lastFired（有寫檔，較安全），但每日提醒一旦伺服器在該分鐘沒醒著就整天略過、無補送。
- 為何會發生／如何觸發：Render free 容器冷啟動、部署、休眠喚醒。
- 證據：理論風險（程式邏輯明確）。
- 建議修法：lastSent 持久化到 data/（如 store）；早安與每日提醒改為「若今天尚未送且現在時間 >= 設定時間」就送（時間窗判定而非精確分鐘相等），避免漏送，並以「當日已送」旗標去重。

### P1-5　set_reminder 接受過去時間 → 一次性提醒立刻觸發或無意義
- 位置：src/services/reminder.js:106-110（addParsed，once）、80-87（add，once）；taipeiToEpoch 只檢查可否 parse，不檢查是否未來。
- 問題描述：模型推算錯誤、或使用者講的時間今天已過（例：晚上說「今天早上8點提醒」），fireAt 會是過去時間。排程器 r.fireAt <= nowMs 立即成立，下一個 tick 馬上推播一則「過去的提醒」，使用者困惑。
- 為何會發生／如何觸發：時區換算誤差、相對時間解析、模型把日期算成過去。
- 證據（已重現）：taipeiToEpoch("2020-01-01 08:00") 被接受，會立即觸發。
- 建議修法：addParsed／add 在 once 分支檢查 fireAt > Date.now()（容許數分鐘緩衝），過去時間回 {ok:false} 或提示使用者澄清。

### P1-6　空字串回覆會被 LINE 拒絕（throw）
- 位置：src/index.js:45-48（text: reply.slice(0, 5000)）；上游 handler.handleImage:253（if (!desc) return ... 有保護）。
- 問題描述：LINE Messaging API 不接受空字串 text（會回 400）。handleText 的 AI 對話路徑 chat() 有保底字串；但若任何 service／路徑回傳空字串，replyMessage 會丟錯 → 落入 catch → 嘗試送錯誤訊息。屬於可恢復但會誤觸發錯誤訊息。
- 為何會發生／如何觸發：service 在邊界輸入回空字串。
- 證據：理論風險；多數路徑已有保底字串，屬防禦不足。
- 建議修法：在 handleEvent 送出前判斷 if (!reply || !reply.trim()) return; 或補預設字串，集中防呆。

---

## P2

### P2-1　health.recordBP 參數順序假設過強，且只取前 3 個數字
- 位置：src/services/health.js:10-13。
- 問題描述：text.match(/\d+/g) 取所有數字，[sys, dia, pulse] 直接解構。若使用者輸入含其他數字的句子（如「血壓 120/80 於 2 樓量」），會把多餘數字當 pulse；少於 2 個數字才擋。也沒有對 sys/dia 合理範圍（如 sys 50-260）做基本檢查，極端值仍記錄並做高低判斷。
- 建議修法：限制取前三個、加基本範圍驗證、忽略明顯不合理值。
- 證據：理論風險。

### P2-2　對話記憶以 userId 為 key 無數量上限／無淘汰
- 位置：src/conversation.js:7（const store = new Map()）。
- 問題描述：每位使用者保留最多 20 則（MAX_TURNS*2），單一使用者有上限；但 Map 以 userId 為 key，使用者數量無上限且永不淘汰（除非 /reset）。家庭用量小風險低；若 bot 被加進大群或公開，會無限成長。
- 建議修法：加 LRU 或「最後活躍時間」過期清理。
- 證據：理論風險（小量使用無虞）。

### P2-3　exchangeRate updated 時間解析未防 Invalid Date
- 位置：src/services/exchangeRate.js:99-100（new Date(updatedRaw).toISOString()）。
- 問題描述：若來源 time_last_update_utc 給非標準字串，new Date(...).toISOString() 會丟 RangeError: Invalid time value——在 try 內，會落入 catch 回 {ok:false}，不致崩，但會把整次查詢視為失敗（即便 rates 其實有效）。
- 建議修法：對 new Date(updatedRaw) 加 isNaN(d.getTime()) 保護，無效時 fallback 今天日期，保留可用的 rate。
- 證據：理論風險（已被 try 包住，不致崩）。

### P2-4　LINE 推播額度（免費 200 則/月）與 429 未處理
- 位置：src/services/reminder.js:160-164（push 的 catch 只 console.error）、morning.js:50-53、lang.resolve 的 getProfile。
- 問題描述：超過免費推播額度或被限流時，pushMessage 丟錯只記 log、不重試、不通知，使用者靜默收不到提醒/早安。喝水提醒每人每天 6 則，多位家人很快逼近 200/月上限。
- 建議修法：對額度/429 記錄並（可選）退避重試；文件提醒額度限制；喝水提醒可降頻。
- 證據：理論風險（依方案而定）。

### P2-5　超長訊息截斷可能切斷多位元組字元尾端
- 位置：src/index.js:47、morning.js:50（.slice(0, 5000)）。
- 問題描述：String.prototype.slice 以 UTF-16 code unit 計，5000 上限對中文足夠；但若回覆含 emoji（surrogate pair）剛好落在第 5000 位，會切出半個代理對 → 顯示為亂碼字元。LINE 上限是 5000 字元，極少觸及，影響輕微。
- 建議修法：以 Array.from(str).slice(0,5000).join('') 截斷，避免切在代理對中間。
- 證據：理論風險（邊界極少觸發）。

---

## 附註：已正確處理、無須改的觀察（避免誤判）

- store.taipei() 午夜回 00:00（非 24:00），無 off-by-one。已驗證。
- tools.run（src/tools.js:167-221）整段 try/catch + JSON.parse(argsJson||'{}') 有防呆——AI 工具路徑相對穩健。
- holiday.js、fuelPrice.js、exchangeRate.js 皆有 AbortController 逾時與 try/catch、失敗回友善字串／null——是其他 service 應對齊的範本。
- parseFailedToolCalls 對「巢狀 JSON 在結尾」「多個 function」可正確解析（已驗證）；問題只在「JSON 後有雜訊文字」與「截斷」。
- expense.addItem 對 Number(amount)||0、item||'其他' 有防呆。

## 修復優先順序建議

1. P0-1 + P0-2（reminder 競態 / 重入：同源，建議一起改成「序列化寫檔 + 自我排程防重入 + 已送狀態持久化」）
2. P0-3（ai.js 四個函式加 try/catch，對齊 chat 的韌性）
3. P1-1、P1-2（weather / invoice 補逾時與防呆，對齊 holiday/fuelPrice 範本）
4. P1-3（救援解析改用括號配對）
5. P1-4、P1-5、P1-6（排程持久化、過去時間驗證、空字串防呆）
6. P2 各項視情況收尾

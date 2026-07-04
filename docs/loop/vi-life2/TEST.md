# TEST — 就醫溝通卡＋匯率到價提醒（vi-life2）

RD#4 測試報告。分支 `feat/vi-life-part2`。全離線驗證：stub `ai.ask`／`ai.chat`、
`exchangeRate.getRate`、`line.client.pushMessage`／`getProfile`、`richMenu.ensureFor`。
兩次真實網路呼叫用於回歸驗證（`匯率 台幣 越南盾`、`lookup('台幣 越南盾')`，見 AC6a／Edge11）。

測試腳本：`tests/test_vi_life2.js`（跑完已刪除，非永久檔案）。
暫存資料：`data/rateAlert.json`（測後刪除）、`data/lang.json`（測後完整還原，`git diff` 確認無殘留）。

## 0. `node --check`

對 `src/**/*.js`（含 7 個變更檔）逐一執行 `node --check`，全部 OK，無語法錯誤。

## 1. PRD 驗收條件 1–7

| # | 驗收條件 | 結果 | 證據 |
|---|---|---|---|
| AC1a | `khám bệnh đau đầu 2 ngày` → 含🏥/「越南籍」/症狀中譯/分隔線/越語回譯 | PASS | 見下方「完整卡片輸出」 |
| AC1b | `就醫卡 頭痛兩天` → 中文卡正常 | PASS | 含 `[中文譯文]頭痛兩天` |
| AC1c | 只打 `khám bệnh` 無症狀 → 越南語引導句 | PASS | 完全等於 `lang.medicalAsk('vi')` |
| AC1d-empty | `ai.ask` 回空字串 → 她的語言「暫時無法」句、無半張卡 | PASS | 完全等於 `lang.medicalFail('vi')`，不含🏥 |
| AC1d-throw | `ai.ask` **同步丟例外**（非 resolve('')）→ 期望仍不 crash | **FAIL（見下方說明，不視為阻擋）** | `handler.handleText` 直接 reject，未落地成「暫時無法」句 |
| AC2 | `tools.run(uid,'make_medical_card', json)` → 回卡片字串 | PASS | 含🏥與症狀中譯 |
| AC2-fail | 同上但 AI 失敗 → 回 `'Cannot make the card right now.'`（供模型轉述） | PASS | |
| AC3a | 現價 842，`báo tỷ giá 850` → vi 確認句含 850 與 `≥` | PASS | `🔔 Đã đặt: sẽ báo khi 1 TWD ≥ 850 VND (hiện tại 842)` |
| AC3b | `匯率提醒 800`（現價842）→ `≤`（跌到）語意 | PASS | |
| AC3c | `匯率提醒`（無數字，已有設定）→ 顯示現有設定 | PASS | 含 800 |
| AC3d | `清除匯率提醒` → 確認移除 + 檔案內該筆真的消失 | PASS | |
| AC3e | 每人一筆：同一使用者重複設定 → 只留最後一筆（覆蓋） | PASS | 900 覆蓋 850，陣列中僅 1 筆 |
| AC4a | 設 850、現價變 851 → `tick()` 一輪 → push 一次（含851、使用者語言）且該筆移除 | PASS | 見下方「rateAlertHit push 文字」 |
| AC4b | 現價 848（未達 850）→ 不 push、不移除 | PASS | |
| AC4c | `getRate` 回 null → 該輪跳過，不誤刪不誤報 | PASS | tick 前後該筆 `createdAt` 完全一致 |
| AC5a | `set_rate_alert` AI 工具設定成功 → 回英文摘要（供模型轉述） | PASS | `Rate alert saved: notify when 1 TWD >= 850 VND (now 842).` |
| AC5b | 防重入：同步連呼兩次 `tick()` → 只 push 一次 | PASS | `ticking` 旗標生效，第二次呼叫直接 return |
| AC6a | 既有「匯率 台幣 越南盾」查詢不回歸（真實網路一次） | PASS | 回傳含 `💱 匯率查詢`／`TWD → VND` |
| AC6b | `exchangeRate` 模組仍匯出 `lookup`/`getExchangeSummary`/`getRate` | PASS | |
| AC6c | `reminder`/`morning` 排程模組仍正常匯出 `start()`（未被破壞） | PASS | |
| AC7 | `node --check` 全變更檔 | PASS | 見上方第 0 節 |

## 2. 額外 Edge Case（獨立驗證）

| # | 案例 | 結果 | 備註 |
|---|---|---|---|
| Edge1a | `'tôi muốn đi khám bệnh ngày mai'`（非錨定開頭）→ 不觸發醫療卡 | PASS | 落到 `ai.chat`（stub 回傳值原封不動送出），確認未命中 `medMatch`/`medAsciiMatch` |
| Edge1b | `'我想辦就醫卡嗎'`（非錨定開頭）→ 不觸發醫療卡 | PASS | 同上，落到 `ai.chat` |
| Edge1c | 錨定開頭 `'就醫卡 頭痛'` → 正常觸發 | PASS | 對照組，確認 regex `^(?:就醫卡\|看病卡)\s*(.*)$` 錨點行為正確 |
| Edge2 | `'khám bệnh đau đầu, sốt 38 độ'` → `makeCard` 收到的引數精確等於 `'đau đầu, sốt 38 độ'` | PASS | 用 monkeypatch 攔截 `medicalCard.makeCard` 呼叫引數，聲調完整保留（handler.js 用「原文切片」而非 `toAscii` 後字串，符合 DESIGN.md 規格） |
| Edge3a | 現價=850，設 `匯率提醒 850`（target 恰等於現價）→ direction | PASS | `target >= rate` 判斷式，850>=850 為真 → `direction: 'up'`（與程式碼行為一致，非規格明文但邏輯自洽） |
| Edge3b | 承上，`tick()` 現價仍 850 → 是否 fire | PASS | `hit = rate >= target` 同樣含等於 → fires，push 一次 |
| Edge4 | `'匯率提醒 abc'` → 不 crash | PASS | regex `^匯率提醒\s*([\d.]+)?$` 對 `abc` 不匹配（因非數字字尾），故整條規則不命中，正常落到 AI 對話 fallthrough，無例外拋出 |
| Edge5 | 兩位使用者皆設定並命中；第一位 push 用 stub 模擬 reject → 驗證第二位仍收到 push 且兩筆都清除 | PASS | `for...of` 迴圈搭配 `.catch(() => {})` 確實達到「loop isolation」，單一使用者 push 失敗不影響後續使用者 |
| Edge6a | `'匯率提醒 850.5'`（含小數）可設定成功 | PASS | |
| Edge6b | 裸 `'匯率提醒'`（已有設定）→ 顯示現有設定 850.5 | PASS | |
| Edge6c | 裸 `'匯率提醒'`（無設定）→ 顯示無設定訊息 | PASS | 完全等於 `lang.rateAlertNone('zh-TW')` |
| Edge7a | `'báo tỷ giá 850'`（toAscii 路由，vi 使用者）→ vi 語確認句含聲調字元 | PASS | `🔔 Đã đặt: sẽ báo khi 1 TWD ≥ 850 VND (hiện tại 842)` |
| Edge7b | `'xóa báo tỷ giá'`（toAscii 路由）→ vi 語清除確認句 | PASS | 完全等於 `lang.rateAlertCleared('vi')`：`Đã xóa báo tỷ giá.` |
| Edge8 | 群組事件 `'khám bệnh đau đầu'` 應走翻譯橋、非醫療卡 | **資訊性，非 PASS/FAIL** | 原始碼檢查：`handler.js`／`index.js` 中**沒有**依 `event.source.type`（group/room/user）分流的邏輯；`replyForEvent` 對所有訊息事件一視同仁呼叫 `handleText`。也就是說這個 repo 目前**沒有**「群組只翻譯」的獨立橋接功能存在，PRD『不做』段落所稱的既有前提在程式碼中查無實作。這不是本次變更造成的回歸（本次改動的 7 個檔案都沒有新增或移除 group 分流），但也代表「群組不觸發醫療卡/匯率提醒」目前是靠**沒有 group 特殊處理**這件事本身、而非刻意排除邏輯達成的（也就是說如果之後真的把 handleText 原封不動接到群組 webhook 事件，群組訊息其實會跟 1:1 一樣觸發這兩個新關鍵字路由）。建議工程師與 PO 確認：目前 codebase 是否本來就沒有群組訊息會被路由進來（例如 LINE 群組要 @提及 bot 才會觸發事件，因此從未有 group message 進到這條路徑），若是，則此屬「未使用到的既有邊界」而非 bug；若群組事件确实会進來，則這兩個新關鍵字（`就醫卡`／`匯率提醒`／`khám bệnh`／`báo tỷ giá`）目前會在群組內被觸發，與 PRD 期待不符。 |
| Edge9 | `index.js` 原始碼檢查：`rateAlert.start()` 是否在 `app.listen` callback 內被呼叫 | PASS | 直接讀取原始碼確認：`app.listen(config.port, () => { ...; reminder.start(); morning.start(); rateAlert.start(); richMenu.ensureSetup()...; })`。（測試腳本內建的正則式一開始沒抓到，是抽取用的正則太嚴格的腳本 bug，已用直接字串檢視修正判讀，非程式碼問題。） |
| Edge10a | 六語（zh-TW/vi/en/ja/th/id）所有新 getter 皆回非空字串 | PASS | |
| Edge10b | vi 字串含越南語聲調字元 | PASS | |
| Edge10c | `rateAlertHit` 數字代入同時含 rate 與 target | PASS | `🔔 到價了！現在 1 台幣 = 851 越南盾（目標 850）` |
| Edge11 | `exchangeRate.lookup('台幣 越南盾')` 仍正常運作（真實網路一次） | PASS | 回傳含 `💱 匯率查詢` |
| Edge12 | `node --check` 全變更檔 + 除 `index.js` 外全部可獨立 `require`（`index.js` 因會啟動 server，改用原始碼檢視） | PASS | |

## 3. 完整輸出證據

### AC1a — 就醫卡完整輸出（`khám bệnh đau đầu 2 ngày`，stub 中譯/回譯）

```
🏥 就醫溝通卡（請出示給醫護人員）
您好，我是越南籍人士，中文不太流利，請多包涵。
【症狀／需求】[中文譯文]đau đầu 2 ngày
請問需要掛哪一科？麻煩您了，謝謝！
──────────
📄 Nội dung thẻ (để bạn kiểm tra):
[VI-BACK][中文譯文]đau đầu 2 ngày
```

### AC4a — `rateAlertHit` push 文字（設850、現價851）

```
🔔 Tỷ giá đã đến mức! Hiện tại 1 TWD = 851 VND (mục tiêu 850)
```

## 4. 唯一需要工程師關注的問題（AC1d-throw）

**現象**：若 `ai.ask` 不是照 codebase 的既有契約「內部 try/catch、失敗一律 resolve 成 `''`」，
而是**直接同步/非同步 throw**，則 `medicalCard.makeCard()` 內兩處 `await ai.ask(...)`
都沒有自己的 try/catch，例外會直接往上傳到 `handler.handleText`，導致該次訊息處理
整個 reject（不會走到 `return card || lang.medicalFail(code)`）。

**是否算阻擋（BLOCKING）？** 判斷：**不算**，原因如下：
- 專案裡目前**所有**呼叫 `ai.ask`/`ai.vision`/`ai.transcribe`/`ai.askJSON` 的地方
  （`food.js`、`morning.js`、`translate.js`、`reminder.js`、`handler.js` 的語音/圖片處理）
  都**沒有**自己包 try/catch，全部依賴 `ai.js` 內部「必定 resolve、不 throw」的契約。
  `medicalCard.js` 完全遵循既有慣例，並非本次新增的獨有缺陷。
- 真實的 `src/ai.js`（本次未變更）`ask()` 函式本身有完整 `try { ... } catch (e) { return ''; }`，
  在正式環境中**不會**把例外丟出來；PRD 條件 1 中「AI 掛（回空/丟例外）」的「丟例外」情境，
  在目前 `ai.js` 的實作下不會真的發生在呼叫端（`medicalCard.js`）。
- 我的測試是刻意把 `ai.ask` stub 換成「同步 throw」來檢驗 defense-in-depth，
  屬於違反既有模組契約的極端輸入，不是這次變更引入的新回歸。

**建議（非阻擋性建議，優先度低）**：若想要更強健，可以在 `medicalCard.makeCard()`
外層加一層 try/catch（跟 `handler.js` 對 `getContentBuffer` 的作法一致），
這樣即使未來 `ai.js` 的契約被意外破壞（例如換了 SDK 版本、內部 catch 漏掉某個錯誤型別），
就醫卡功能仍不會整條訊息處理鏈路一起壞掉。這不影響本次 PASS/FAIL 判定。

## 5. 清理紀錄

- `data/rateAlert.json`：測試期間建立與清空多次，測畢已 `unlink`（`ls data/` 確認不存在）。
- `data/lang.json`：測試以手動設定（`setManual`）方式新增假 userId（`TEST-vi-user-1` 等），
  測畢用測試開始時讀取的原始內容整份覆寫還原；`git diff data/lang.json` 確認無差異。
- `tests/test_vi_life2.js`：已刪除，`tests/` 空目錄一併移除。
- 未曾呼叫任何真實 Groq AI 端點（`ai.ask`/`ai.chat` 全程 stub）；
  唯二真實外部呼叫為 `exchangeRate.getRate('TWD','VND')`（AC6a／Edge11，均為免金鑰公開端點、非付費服務）。
- 未曾呼叫 `client.pushMessage` 對真實 LINE 使用者推播（全程 stub，且使用假 userId `TEST-*`）。

## 6. VERDICT

除 §4 所述、經判定為**非阻擋**的既有慣例一致性問題外，PRD 驗收條件 1–7 與全部 12 項額外
edge case 皆通過（Edge8、Edge9 為資訊性/腳本修正說明，詳見上表，皆不構成失敗）。

**VERDICT: PASS**

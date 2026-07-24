# TEST — 農曆生日提醒（RD#4 獨立測試報告）

**分支** `feat/lunar-birthday` | **對應** `docs/loop/lunar-birthday/PRD.md` 驗收 1–12
**測法**：離線單元驗證，直接呼叫真實 `birthday.js` / `lunar.js`（不 stub 引擎），
覆寫 `store.taipei()` 控制「今天」；另跑一支獨立腳本走 `handler.handleText()` 全鏈路。
不 `require index.js`、不 `.start()`、不發真 LINE 訊息、腳本結尾 `process.exit(0)`，
腳本本身放在系統暫存目錄（不進 repo），碰 `data/birthdays.json`、`data/lang.json` 前備份、
測完逐字還原並以 `git status` + 檔案比對確認無殘留。

## 結論

**VERDICT: PASS**

`node --check src/services/birthday.js`、`node --check src/handler.js` 均通過。
兩支測試腳本共 69 項斷言（離線單元 57 項 + handler 全鏈路 12 項）全數 PASS，涵蓋 PRD 驗收 1–12。

## 逐條驗收結果

| # | 驗收條件 | 結果 | 關鍵樣本 |
|---|---|---|---|
| 1 | 新增合法／非法 | PASS | `農曆生日 阿嬤 8/15`（today=2026-09-20）→ `🎂 已記住 阿嬤 的農曆生日：農曆8/15（今年＝國曆 09-25，還有 5 天）`；`阿公 13/40` → 看不懂日期錯誤、未寫入；`阿祖 8/31` → `農曆日期最多到 30（農曆沒有 31 號）。`、未寫入 |
| 2 | 清單倒數混排 | PASS | 混合 `爸爸：12-31`（國曆，遠）與 `阿嬤：農曆8/15（今年＝國曆 09-25）`（農曆，近）→ 農曆行排前；today=2026-09-25 時農曆行顯示 `🎉 就是今天！` |
| 3 | 刪除 | PASS | `刪除生日 阿嬤`（農曆紀錄）→ `🗑 已刪除 阿嬤 的生日。`；找不到 → `找不到「不存在的人」的生日。`（與現行文字一致） |
| 4 | 當天推播命中 | PASS | 農曆八月十五↔2026-09-25：09-24 不含、09-25 含「阿嬤」、09-26 不含 |
| 5 | 閏月語意 | PASS | 2025 六月：`lunar2solar(15,6,2025,1,TZ_TW)` 反查＝`2025-08-08`（吻合協調者權威對照 閏六月十五）→ 該日 `todays()` 不含「媳婦」；正六月十五（引擎算出的國曆日）→ `todays()` 含「媳婦」 |
| 6 | 三十缺日 | PASS | 小月（2026 二月，引擎自證僅 29 天）：存「二月三十」→ 廿八不命中、廿九（該月最後一天）命中、隔天（次月初一）不命中；清單「今年＝國曆」＝廿九日期（非虛構三十）。大月（2026 正月，`lunar2solar(30,1,2026,0)`＝`2026-03-18`，吻合權威對照）：存「一月三十」→ 廿九（03-17）不提前命中、三十（03-18）當天命中 |
| 7 | 台越 tz 語意 | PASS | 兩個假 userId（模擬 zh／vi 使用者）各存 `媳婦 8/15`，`addLunar()` 回覆逐字相同（程式碼本身無語言分支，恆用 `TZ_TW`） |
| 8 | 舊資料相容 | PASS | 手動放入 `{userId,name,md:'11-11'}` 舊格式紀錄，用 `git show HEAD:src/services/birthday.js` 還原成暫存舊版模組實際跑 `list()`/`todays()` 側對側比對，輸出逐字相同 |
| 9 | 既有國曆不回歸 | PASS | 新舊模組對純國曆資料的 `add()`/`list()`/`todays()`/`remove()` 輸出逐字相同；額外抽取比對 `parseMD`/`daysUntil`/`add`/`remove` 四函式原始碼（去除行尾差異後）與 HEAD 版本逐字一致，證實「一行不改」 |
| 10 | KNOWN_KEYS 不變 | PASS | `store.js` 全檔內容（去除行尾差異）與 HEAD 逐字相同；`store._internal.KNOWN_KEYS` 仍只含既有 `birthdays.json`、無新增檔 |
| 11 | 防禦 | PASS | monkey-patch `lunar.lunar2solar` 恆回 `[0,0,0]`：`addLunar()` 不拋例外、仍寫入紀錄、回覆含「（國曆換算暫時無法顯示）」；`list()` 不拋例外，異常筆顯示同樣註記、其餘正常筆（純國曆對照組）不受影響；`todays()` 不拋例外 |
| 12 | 收斂 | PASS | `node --check` 兩檔皆過；測試不 `require index.js`、不 `.start()`、無真實 LINE 送訊（`richMenu.ensureFor` 於 handler 測試中已 stub 為 no-op，避免觸發真實 rich menu API）；`data/birthdays.json`、`data/lang.json` 測後逐字還原（比對通過），暫存的舊版模組檔 `src/services/__old_birthday_tmp.js` 已刪除，`git status` 確認除既定改動檔外無殘留（見下方附註） |

## 額外覆蓋（parent 指定的補強項）

- **handler 路由全鏈路**：透過 `handler.handleText(userId, '農曆生日 阿嬤 8/15')`（種 lang 為鎖定 `zh-TW` 以避免真的呼叫 `client.getProfile()`；`richMenu.ensureFor` 暫時 stub 為 no-op 避免觸發真實 LINE rich menu API）完整跑過路由 → `addLunar()` → 存檔 → 回覆，12 項斷言全過。
- **既有查詢指令不被誤吃**：`handleText(U, '農曆')` 與 `handleText(U, '今天農曆')` 皆正確落入既有 `/^(?:今天)?農曆(?:日期)?$/` 路由（回覆內容相同、不含 `addLunar` 的格式錯誤或確認文案），未被新路由 `/^農曆生日\s+(.+)$/` 誤吃。
- **`生日清單`／`刪除生日`／`生日 X` 既有指令**：透過 handler 全鏈路確認仍正常運作，且能刪除以 `農曆生日` 新增的紀錄。

## 環境與清理紀律

- 測試腳本共兩支，皆放在系統暫存目錄（非 repo 內）：
  - 離線單元測試（57 斷言，驗收 1–11 + 部分 12）
  - handler 全鏈路測試（12 斷言，含路由防誤吃）
- 兩支腳本執行前皆備份 `data/birthdays.json`（原本不存在）與 `data/lang.json`（原本為 `[]`），
  執行後逐字還原／刪除，並以 `fs.readFileSync` 比對內容 + `git status` 確認乾淨。
- 側對側比對用的暫存舊版模組檔（由 `git show HEAD:src/services/birthday.js` 寫入
  `src/services/__old_birthday_tmp.js`）於測試結束後刪除，已確認不殘留。
- 全程未呼叫 Groq AI、未發真實 LINE 訊息；`todays()` 對外簽章與呼叫方式（`morning.js` L98
  `birthday.todays(sub.userId)`）核實未變。

## 附註（非本輪程式碼問題，僅供提醒）

- `git status` 顯示 repo 根目錄有 `regr.js`、`regr2.js` 兩支未追蹤檔案（時間戳早於本次測試開始，
  內容為側對側比對用的除錯腳本，非本測試工程師建立）。這些疑似是實作者（RD#3）自我驗證時留下、
  未依專案慣例清理的暫存測試腳本，建議請其清掉，避免污染 repo（不影響本輪驗收 PASS 結論，
  本測試工程師未修改或刪除這兩支檔案，保持現狀交還）。

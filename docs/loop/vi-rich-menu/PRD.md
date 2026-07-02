# PRD — 越南語無障礙第 2 輪：Rich Menu 圖形選單（每人依語言顯示）

## 背景
越南家人不會打中文指令，靠語音/AI 雖然可用，但「不知道 bot 會什麼、每次都要想怎麼講」。
LINE **Rich Menu**＝聊天室底部常駐的圖片按鈕選單，**點按鈕就送出指令、零打字**，
且可以**依使用者個別連結不同選單**（她看越南語版、其他家人看中文版）。

## 目標
1. 兩套選單：**中文版（預設，所有人）** + **越南語版（自動連結給語言=vi 的使用者）**。
2. **全自動、零手動設定**：bot 啟動時自我建置選單（冪等），語言切換時自動換選單。
   使用者（非技術者）merge 後**什麼都不用做**。

## 範圍（要做）

### F1 選單自我建置（開機冪等）
- 選單圖（PNG，2500×1686，3×2 六格）**預先產生並 commit 進 repo**（`assets/richmenu/menu-zh.png`、`menu-vi.png`）。
- bot 啟動時（`index.js` 啟動後 fire-and-forget，**失敗不影響開機**）：
  以 richmenu **名稱**（`menu-zh-v1` / `menu-vi-v1`）查詢現有清單；缺哪套就
  建立 richmenu → 上傳圖片 → `menu-zh-v1` 設為**全體預設**。已存在就跳過（冪等，重開機不重複建）。
- richmenu ID **不落地**（Render 檔案系統會清空）：執行時以名稱查詢、RAM 快取。

### F2 依語言自動連結
- 使用者語言為 `vi`（自動偵測或手動 `語言 越南語`）→ **自動把越南語選單連到她的 userId**；
  語言改回其他 → 解除連結（回到預設中文選單）。
- 觸發點：處理訊息時檢查（fire-and-forget、RAM 記錄已連結狀態避免重複 API 呼叫）。

### F3 按鈕與路由（每格＝送出一則訊息文字，走既有路由）
越南語版六格：Giờ tàu（`tàu hoả`→新增 vi 台鐵說明）、Trạm xăng（`trạm xăng`→擴充加油站關鍵字）、
Tỷ giá（既有 PR #4）、Giá xăng（既有 PR #4）、Thời tiết（`thời tiết`→新增 vi 引導句）、Trợ giúp（既有）。
中文版六格：台鐵查詢／加油站／油價／今天吃什麼／天氣（引導）／選單——全部走既有路由。
原則：**點了一定有合理回應、不會已讀亂回**。

### F4 選單圖片產生（一次性工具，不進 runtime）
- `scripts/` 下放產圖腳本；簡潔色塊＋大字標籤；中文與越南語 diacritics 必須正確渲染。
- 產圖方法由架構師實測擇一（實測結果：PowerShell + .NET System.Drawing）。產出後 commit PNG。

## 不做（範圍外）
- 不做 postback/多頁選單/richmenu 切換（v1 全部 message action 單頁）。
- 不做 en/ja/th/id 版選單（先 zh + vi；其餘語言看中文版）。
- 不改 LINE Developers Console 手動設定（全程 API）。

## 驗收條件（可測）
1. **SDK 契約**：@line/bot-sdk v11 相關方法實際存在且簽章正確（架構師驗證寫進 DESIGN）。
2. **圖片**：兩張 PNG 存在、2500×1686、<1MB、中文與越南語渲染正確。
3. **richMenu 服務單元**：ensureSetup 冪等、ensureFor link/unlink 去重（mock 驗證）。
4. **真實 API 煙霧測試**：以拋棄式測試選單驗證建立/上傳/列表/刪除（**不設全體預設、不動線上使用者**，
   正式建置由 merge 後開機自動執行——此為安全調整）。
5. **新 vi 路由**：`tàu hoả`／`thời tiết`／`trạm xăng` 各有確定性回應；zh 路由不回歸。
6. **失敗容錯**：token 無效/斷網時 ensureSetup 不丟例外、不影響開機。
7. `node --check` 全變更檔；既有功能不回歸。

> 註：本檔在第一次 loop 執行中曾遺失（疑似 agent 誤刪），依原內容重建；
> 測試依 DESIGN §8 測試策略執行，結論不受影響（VERDICT: PASS）。

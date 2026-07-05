# PRD — Rich Menu v2：8 格選單（納入就醫卡／Tết／農曆）

## 背景
選單是（尤其越南家人的）主要入口，但新功能（就醫卡、Tết 倒數、農曆）不在 6 格選單上。
改 8 格（4×2），並處理 v1→v2 換版。

## F1 新版選單內容（每格＝送出訊息文字，走既有路由；全部已驗證存在）
- **vi v2**（4×2）：`tàu hoả`｜`trạm xăng`｜`tỷ giá`｜`giá xăng`
  ／`thời tiết`｜`khám bệnh`（→回 medicalAsk 引導）｜`tết`（→Tết 倒數）｜`trợ giúp`
  圖上標籤：Giờ tàu／Trạm xăng／Tỷ giá／Giá xăng／Thời tiết／Thẻ khám bệnh／Tết 🧧／Trợ giúp
- **zh v2**：`台鐵查詢`｜`加油站`｜`油價`｜`天氣`（→引導句）
  ／`今天吃什麼`｜`就醫卡`（→引導）｜`農曆`（→今日農曆）｜`選單`
- 每格 625×843（4 欄），總尺寸維持 2500×1686。

## F2 v1→v2 換版（開機冪等）
- richMenu.js 常數改為 `menu-zh-v2`／`menu-vi-v2`＋新 areas。
- `ensureSetup()`：建置 v2（照舊冪等）＋**清理舊版**：列表中若存在 `menu-zh-v1`／`menu-vi-v1`
  → 刪除（deleteRichMenu；失敗只 log 不擋）。v2 zh 設全體預設。
- 越南使用者：v1 刪除後暫時回到預設，**下次傳訊息由既有 ensureFor 自動連 vi v2**（不需新程式）。

## F3 選單圖 v2
- 產圖腳本改 4×2（保持風格、色盤延伸至 8 色）；**長標籤自動縮字**（如 Thẻ khám bệnh），
  用 MeasureString 量寬、超出格寬 90% 就逐步縮小字級，不可溢出或截字。
- 產出兩張 PNG 覆蓋 `assets/richmenu/`（檔名不變 menu-zh.png/menu-vi.png），2500×1686、<1MB，
  中文＋越南語聲調渲染正確（人工看圖）。

## 不做
- 不動 quickReply／既有路由；不做 postback；不做 en/ja 版。

## 驗收
1. 兩張新 PNG：尺寸/大小/簽名正確；**16 格標籤**渲染正確無溢出（人工看圖確認）。
2. 選單 JSON：8 areas 幾何正確（4×2、無重疊、蓋滿畫布）、16 個 action 文字**逐一經
   handler 驗證有確定性回應**（stub AI）——特別是新的 `khám bệnh`（無症狀→vi 引導）、
   `tết`（倒數）、`就醫卡`（zh 引導）、`農曆`（今日農曆）。
3. ensureSetup stub 測試：空列表→建 2 個 v2＋上傳＋設預設；列表含 v1→ 刪除 v1；
   列表已含 v2 → 不重建（冪等）；刪除失敗→不 throw。
4. 真實 API 煙霧（拋棄式 `menu-test-*`）：建立→上傳新 PNG→列表→刪除，零殘留；
   **不動線上預設、不刪線上 v1**（正式換版由 merge 後開機自動執行）。
5. 不回歸：ensureFor link/unlink 邏輯不變（名稱換 v2 後仍以名稱查 id）。
6. node --check；PS 產圖腳本 UTF-8 BOM 保持。

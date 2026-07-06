# TEST — 📄 文件拍照助手＋🧾 收據拍照記帳（RD#4 驗證報告）

## 最終 VERDICT: **PASS**（第 2 輪；第 1 輪抓到的 ##TAG 外漏已修）
第 1 輪 RD#4 對抗測試發現：`parseVisionTag` 成功路徑只剝掉「最後一個」`##TAG` 配對區，
若輸出含更早的重複標籤、或描述本文剛好含 "##TAG" 字樣，會外漏給使用者並進對話記憶
（違反 PRD §驗收1「回傳文字永不含 `##TAG`」）。**修法**：所有回傳 `text` 的路徑
（成功／JSON 截斷／parse 失敗）改用 `stripTagLines` 收尾——移除任何殘留含 `##TAG` 的行。
**複測全綠**（含 tester 兩組原始 repro：雙標籤取最後一個且不外漏、本文含 ##TAG 不外漏）
＋回歸（tag=other 時回傳文字＝描述逐字相同）＋收據/文件正常＋截斷 JSON 不外漏。

以下為第 1 輪原始紀錄（除上述外全 PASS，保留供追溯）。

---

測試方式：`node --check` 全檔案語法檢查 + 一支純 Node 腳本直接呼叫真實模組（`imagePending.js`／`handler.js`／`expense.js`／`reminder.js`／`lang.js`／`tutor.js`／`traChoice.js`／`groupTranslate.js`），全程 stub `ai.vision`／`ai.askJSON`／`ai.ask`／`line.client.pushMessage`／`line.blobClient.getMessageContent`（零真實外部呼叫、零真實 LINE push）。假 userId（`TEST_FAKE_USER_*`）、`data/` 測前備份（scratchpad）、測後 byte-identical 還原（MD5 verified：**OK**）。腳本不 `require('src/index.js')`、不呼叫任何 `.start()`、結尾 `process.exit(0)`。

## node --check

全部 `src/**/*.js`（含 8 個異動檔）皆 `node --check` 通過，無語法錯誤。

## PRD §驗收 逐條結果

| # | 驗收條件 | 結果 | 備註 |
|---|---|---|---|
| 1 | `parseVisionTag` fixture 矩陣 ≥14 組，永不 throw、回傳文字永不含 `##TAG`、無效→`{type:'other'}` | **PASS**（15 組全過，單獨這條沒踩到 bug） | 見下方「發現的問題」，矩陣本身測資未覆蓋到「多個 ##TAG」情境，但額外的對抗測試（EDGE-1/EDGE-4）踩到同一個底層問題 |
| 2 | `computeRemindAt`：+10天→前一天09:00；明天+現在22:00→當天09:00；今天已過09:00→null；+3年→null | **PASS**（4/4 全過） | |
| 3 | `handleImage`（stub vision）：receipt→1顆按鈕label≤20；document→提醒按鈕；other→字串與現行行為一致；空→imageUnclear | **PASS**（4/4 全過） | |
| 4 | tap矩陣（zh+vi）：確認記帳含id+累計+撤銷鈕；撤銷還原；pending過期走記帳文字路由（含7-11清洗）；連點第二下走文字路由；提醒tap寫入reminders.json | **PASS**（7/7 全過，zh+vi 各驗一輪） | |
| 5 | 與 traChoice pending 並存互不誤觸 | **PASS**（2/2） | 數字「1」精準命中 traChoice、imagePending 不受影響；之後按鈕文字仍能正確命中 imagePending |
| 6 | 隱私掃描：文件fixture獨特字串不出現在data/*.json；conversation無`##TAG` | **PASS**（2/2，另加 EDGE-18 二次確認） | |
| 7 | 回歸：一般照片／記帳 午餐 120／提醒我…／node --check | **PASS** | |

## 額外對抗測試（adversarial edge cases）

| # | 情境 | 結果 | 說明 |
|---|---|---|---|
| EDGE-1 | 輸出中出現**兩個** `##TAG` 行，最後一個必須生效 | **FAIL（真實 bug）** | tag 解析正確採用最後一個（NEW），但回傳 `text` 仍殘留第一個（OLD）的完整 `##TAG {...}` 字串，違反 PRD §驗收1「回傳文字永不含 `##TAG`」。詳見下方根因 |
| EDGE-2 | tag JSON 含未預期欄位 `{"evil":true}` | **PASS** | 正常解析，`evil` 欄位被忽略，不出現在回傳 tag 物件 |
| EDGE-3 | `amount` 為字串 `"450"`（模型把數字加引號） | **PASS**（行為記錄） | `validateTag` 用 `typeof obj.amount === 'number'` 嚴格檢查，字串一律判定無效 → `amount: null`（**不做 Number() 強制轉型**）。此為可接受行為之一，已記錄 |
| EDGE-4 | 描述文字中「本來就含有 `##TAG` 字樣」的正常敘述（例如拍到 hashtag 手勢），後面接一個真的 tag 行 | **FAIL（真實 bug，與 EDGE-1 同根因）** | 真正的 tag（真實店家/77元）有正確解析出來，但回傳 `text` 仍保留前面那句含 `##TAG` 字樣的敘述原文，違反「回傳文字永不含 `##TAG`」 |
| EDGE-5 | 期限恰為今天：現在08:00（09:00未過）→ 當天09:00；現在10:00（09:00已過）→ null | **PASS** | 兩種情況都符合 PRD 敘述 |
| EDGE-6 | 金額 450.50 → 保留2位小數；450.505 → 四捨五入到 450.51 | **PASS** | `Math.round(amount*100)/100` 行為符合預期 |
| EDGE-7 | 確認按鈕未點前，第二張**不同**照片抵達 → pending 被覆寫；舊按鈕文字仍走 `記帳` 文字路由完成（優雅降級）；新 pending 完整存在 | **PASS** | |
| EDGE-8 | 金額 9999999（7位數）→ 確認按鈕 label 是否仍 ≤20 字 | **PASS** | 實際 label `"✅ 記帳 9999999元"`（13字） |
| EDGE-9 | stub `reminder.addParsed` 回傳 `{ok:false}` → 應回 `docReminderFail`，不可 crash | **PASS** | |
| EDGE-15 | 一般照片（tag=other）：`handleImage` 回傳字串需與「原始 vision 描述」**完全相等**（無殘留標籤/多餘文字） | **PASS** | 用受控 stub 描述（無 tag 行）驗證，逐字相符 |
| EDGE-16 | 既有路由不受影響：「提醒 每天8點 吃藥」／「今天吃什麼」／群組翻譯橋（stub ai.ask） | **PASS**（3/3） | |
| EDGE-17 | node --check 全過；`require handler.js` 不啟動計時器/不 crash | **PASS** | |
| EDGE-18 | 二次隱私掃描（另一組獨特字串）：data/*.json 不含、conversation 無 `##TAG` | **PASS** | |

## 發現的問題（需要修）— 唯一的根因，影響 2 個測試案例

**檔案**：`src/services/imagePending.js`，函式 `parseVisionTag`（第 236–289 行），成功解析分支（第 274–284 行）。

**問題**：目前程式碼只從「最後一個 `##TAG` 匹配」的起點（`tagStart`）到其配對 JSON 的 `}` 為止做移除：

```js
const removed = text0.slice(0, tagStart) + text0.slice(braceEnd + 1);
```

當原始 vision 回覆裡**在最後一個合法 tag 之前**還出現過任何符合 `/(?:```)?\s*##TAG/gi` 的字串片段（無論是模型多吐了一次舊/壞掉的 tag 行，還是正常敘述文字裡剛好提到「##TAG」這個詞，例如描述一張比 hashtag 手勢的照片），這些「較早的 `##TAG` 殘留內容」完全不會被清掉，會原封不動出現在回傳給使用者的 `text` 裡。

這直接違反 PRD §驗收 1 的硬性條件：**「回傳文字永不含 `##TAG`」**，也違反 DESIGN.md 隱私原則「`##TAG` 不進記憶不落地」的精神（雖然 DESIGN §2 步驟4的文字本身只寫「標記起至配對 } 止」，沒明講多個標記的情況，但 PRD 的驗收條件是絕對值，且已進 `conversation.append` 存進 RAM 對話記憶，等於半個「落地」）。

**重現方式**（測試腳本已記錄，可直接重跑驗證）：

```js
const raw = '描述文字 ##TAG {"type":"receipt","store":"OLD","amount":11}\n更多描述\n##TAG {"type":"receipt","store":"NEW","amount":99}';
imagePending.parseVisionTag(raw);
// 實際回傳：
// { text: '描述文字 ##TAG {"type":"receipt","store":"OLD","amount":11}\n更多描述', tag: {type:'receipt', store:'NEW', amount:99} }
// text 仍含 "##TAG"，違反驗收條件
```

```js
const raw2 = '這張照片裡有人比了一個 ##TAG 的手勢（hashtag 標籤的意思）當作梗圖。\n##TAG {"type":"receipt","store":"真實店家","amount":77}';
imagePending.parseVisionTag(raw2);
// 實際回傳：
// { text: '這張照片裡有人比了一個 ##TAG 的手勢（hashtag 標籤的意思）當作梗圖。', tag: {...店家/77正確...} }
// text 仍含 "##TAG"
```

**建議修法方向**（給工程師參考，不強制）：把「移除」的起點改成「文字中**第一個**符合 `##TAG` pattern 的位置」而非「最後一個 tag 匹配」的位置——但這樣會把敘述文字中無辜提到「##TAG」字樣的正常句子也整段砍掉（可能砍太多）。更保守的作法：解析用「最後一個 tag」照舊，但在回傳 `text` 前，額外跑一次 `stripTagLines`-類似的安全網（目前 `stripTagLines` 只在例外分支/找不到 brace 分支被呼叫，成功分支完全沒套用），把 `text` 中殘留的、獨立成行的 `##TAG ...` 內容也掃掉；若 `##TAG` 出現在句子「中間」（如 EDGE-4）而非獨立一行，則需要額外的行內清除規則（例如把 `##TAG` 這幾個字元本身抹除但保留其餘敘述，或最保守地整句砍掉並在文件中明確記錄此取捨）。

**風險評級**：中——僅在模型輸出「異常」（吐兩次 tag，或描述文字剛好包含 `##TAG` 字樣）時觸發，屬邊界案例而非主流程；但確實是 PRD 明文的硬性驗收條件，且 `##TAG` 外洩到使用者可見文字、甚至進 conversation 對話記憶（雖然不落地到 data/*.json 檔案），已違反「標籤絕不外漏」的設計原則。

## 其他不影響 VERDICT 的說明

- **PRD-tutor 相關的兩個測試腳本問題**已於下方 `daily-tutor/TEST.md` 說明，皆為本測試腳本自身的隔離/斷言瑕疵，非 photo-doc-receipt 程式碼問題。

## VERDICT

**PASS-with-notes** — 7 條 PRD 驗收條件本身全數通過（含 zh/vi 雙語 tap 矩陣、隱私掃描、回歸測試）；但額外對抗測試挖出一個真實的 `parseVisionTag` 邊界 bug（多重/行內 `##TAG` 殘留未清除乾淨），建議工程師修補後由 RD#4 複測。此 bug 屬邊界情境、不影響正常單一 tag 的主流程，但直接違反 PRD 明文的「回傳文字永不含 `##TAG`」硬性條件。

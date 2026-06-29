# 閉環開發流程（AI Dev Team Loop）

用一個「AI 開發團隊」來開發/改進這個 bot：給一個目標，5 個角色接力完成，
review 或測試沒過就退回工程師改，直到全綠。**這是開發階段的流程（用 Claude 跑），
和線上那隻用 Groq 的 bot 無關。**

## 角色（定義在 `.claude/agents/`）

| 角色 | 代號 | 職責 | 權限 |
|------|------|------|------|
| 產品經理 | `pm` | 目標 → PRD（需求、驗收條件） | 唯讀 + 寫文件 |
| 架構師 | `architect`（RD#1） | PRD → 技術設計 | 唯讀 + 寫文件 |
| 工程師 | `coder`（RD#2） | 依設計寫程式碼 | 可改程式 |
| 審查員 | `reviewer`（RD#3） | 對照需求審查 | 唯讀（不改扣） |
| 測試員 | `tester`（RD#4） | 寫並跑測試 | 可寫測試、執行 |

## 閉環流程（由主 Claude 當 orchestrator 串接）

```
1. PM        → docs/loop/<slug>/PRD.md
2. Architect → docs/loop/<slug>/DESIGN.md
3. Coder     → 實作
4. Reviewer  → VERDICT: PASS / CHANGES_REQUESTED
                └ CHANGES_REQUESTED → 回 (3) 給 coder 修（最多 3 次）
5. Tester    → VERDICT: PASS / FAIL
                └ FAIL → 回 (3) 給 coder 修（最多 3 次）
6. 全綠 → orchestrator 總結，列出變更檔與四份文件，交由你決定是否部署
```

每個關卡的產出都留檔在 `docs/loop/<slug>/`（PRD / DESIGN / REVIEW / TEST），方便追溯。

## 怎麼啟動

跟 Claude 說：**「跑開發閉環：<你的目標>」**，例如
「跑開發閉環：新增匯率查詢功能」。

## 兩種節奏

- **分階段（gated）**：每個角色完成後停下來給你看，你說繼續才往下。較安全，建議初期用。
- **全自動（auto）**：一路跑到全綠才回報。較快，適合範圍明確、低風險的任務。

## 安全界線

- 工程師不會 commit/push、不碰 `.env` 或金鑰、不啟動正式伺服器。
- 全綠後「是否部署到 Render」由你決定（部署＝git push，需要你的 GitHub token）。
- 上限：review / 測試各最多重跑 3 次；超過會停下來請你介入。

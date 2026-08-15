# Issue Canvas

「イシューからはじめよ」流にテーマを分解し、**MECE(ダブりなく・モレなく)を機械的に監査しながら**検討を進めるためのボード。
Claude(Claude Code / Claude Desktop)から MCP 経由で操作することを前提に設計しています。

```
メモ(発散)  →  カード(MECEに整理・結論)  →  TODO(実装タスク)
   │                 │                          │
   └ 未反映メモ数     ├ 再判定待ちカード数         └ タスク化されていない結論
                     ├ 越境 / 重複 の警告
                     └ モレ候補
```

## 何を解決するか

AI と壁打ちしながら A を深掘りし、次に B を深掘りすると、B の中に「実は A に含まれる内容」が混ざりがちで、しかも気づかない。
Issue Canvas はそれを **構造(大項目=フレーム、中項目=セクション、カード)** と **判定フラグ** で見えるようにします。

- **ダブり**: 越境(カードが別フレームのスコープに該当) / 重複(ほぼ同一の論点)。移動・統合・却下で解消
- **モレ**: トップイシューに対して欠けている大項目、承認済みスコープに対して未検討の論点を「モレ候補」として提示。採用/不要で解消
- **再判定待ち**: 新規・本文編集・移動したカードには自動でフラグが立ち、判定をやり直すまで消えない(編集して気づかない、を防ぐ)
- **リンクは ID**: メモ↔カード↔TODO の紐づけは本文ではなく ID なので、編集しても壊れない。削除時の連鎖ルールは明示(下記)

## 設計上の判断: 判定は呼び出し側モデルがやる

サーバーは **LLM API を一切呼びません**。`mece_material` で判定材料(スコープ定義・全カード・再判定待ち・既存警告・却下記録)を返し、
会話中の Claude が判定して `mece_report` で書き戻します。ボタンを押すたびに API 費用がかかる構造を避けるためです。

## セットアップ

```bash
npm ci
npm run build
```

Claude Code に登録(ユーザースコープ = どのプロジェクトからでも使える):

```bash
claude mcp add --scope user issue-canvas -- node /absolute/path/to/issue-canvas/dist/mcp/server.js
```

データは既定で `<repo>/data/<boardId>.json`(git 管理外)。`ISSUE_CANVAS_DATA` で変更可。

## MCP ツール一覧

| 分類 | ツール |
|---|---|
| ボード | `board_list` `board_create` `board_get`(summary/full) `board_set_title` |
| 大項目 / 中項目 | `frame_create` `frame_update` `frame_approve_scope` `frame_delete` `section_create` `section_delete` |
| カード | `card_create` `card_update` `card_move` `card_delete` |
| メモ | `note_add` `note_update` `note_delete` `note_to_card` |
| MECE | `mece_material` `mece_report` `flag_resolve` `gap_resolve` |
| TODO | `todo_group_create` `todo_group_update` `todo_group_delete` `todo_task_add` `todo_task_update` `todo_task_delete` |

典型的な流れ(Claude 側):

1. `board_get`(summary)で状態把握 → 未反映メモ・再判定待ち・open 警告を確認
2. 会話で出た論点を `note_add` → 整理フェーズで `note_to_card`(承認済みスコープと照合して配置先を決める)
3. `mece_material` → 判定 → `mece_report`(crossing/duplicate/dependency/gap)
4. ユーザーと確認しながら `flag_resolve` / `gap_resolve`
5. 結論カードに `todo_group_create` → `todo_task_add` で細分化

## 削除の連鎖ルール

| 削除するもの | 何が起きるか |
|---|---|
| カード | 刺さっている警告は閉じる / 出所メモは「未反映」に戻る / TODO グループは残る(孤児表示、`todo_group_update` で付け替え可) |
| メモ | カードは残る |
| フレーム | 配下カードは未分類へ |
| セクション | 配下カードはフレーム直下へ |
| TODO グループ | 要件カードに影響なし |

## 開発

```bash
npm test          # node:test (tsx)
npm run typecheck
npm run mcp       # tsx で直接起動(開発用)
```

構成: `src/core`(型・JSON ストア・コマンド層) / `src/mcp`(stdio サーバー、コマンド層の薄いラッパー)。
UI(キャンバス)を足す場合も同じコマンド層を通す前提です。

## ライセンス

MIT

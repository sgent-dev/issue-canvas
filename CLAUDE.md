# issue-canvas — project rules

- 公開リポジトリ。個人のボードデータ(`data/*.json`)・APIキー・個人パスは絶対に commit しない。
  - commit 前に `gitleaks protect --staged` が pre-commit で走る(`.githooks`、`git config core.hooksPath .githooks` 済み)。CI でも `gitleaks detect` がバックストップ。
- 新タスクは必ず `git worktree add ../issue-canvas-<task> -b <branch>` で別ディレクトリを切って作業する(main repo でブランチ切替しない)。
- main 直 push 禁止。feature branch → PR → CI green → merge。
- 依存追加は `npm install <pkg>@<exact>`(`.npmrc` で save-exact / ignore-scripts 済み)。公開直後のバージョンは数日待つ。
- コマンド層(`src/core/commands.ts`)が唯一の変更経路。MCP も将来の UI もここを通す。判定ロジック(LLM 呼び出し)はサーバーに入れない。
- テスト: `npm test`。型: `npm run typecheck`。

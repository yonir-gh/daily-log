# デイリーログアプリ 仕様書

作成日: 2026-07-16

## 概要

タスクシュート方式のスケジュール管理 + 実績ログアプリ。
予定したタスクに対して「実際に何時から何時までやったか」を記録していく。
タスクシュートクラウドとの違いは、思いついたことを一旦インボックスに溜めてから随時スケジュールに割り当てる点。

## 構成

| 要素 | 技術 | 場所 |
|---|---|---|
| フロントエンド | PWA（HTML/CSS/JS、フレームワークなし） | GitHub Pages（`apps/daily_log`） |
| バックエンド | GAS Webアプリ（JSON API） | `gas/daily_log`（clasp管理） |
| データ保存 | Googleスプレッドシート（GASコンテナバインド） | Googleドライブ |
| Googleカレンダー | 読み込みのみ（Phase 2） | GAS CalendarApp |
| Obsidian出力 | Mac日次スクリプト（launchd）（Phase 3） | iCloud vault `ThinkPad/DailyLog/` |

## 認証

- GAS Webアプリは「自分として実行・全員がアクセス可」でデプロイ
- リクエストごとにトークン（合言葉）を検証。トークンはGASのスクリプトプロパティ `TOKEN` に保存
- フロントエンドは設定画面で入力されたトークンを localStorage に保存。公開リポジトリにトークンは含めない

## 画面構成（Phase 1）

### 1. 今日
- 当日のタスクを予定開始時刻順に表示
- 各タスク: タイトル / 予定開始・見積分数 / 実績開始〜終了・実績分数
- 「開始」ボタン → 実績開始時刻を記録（他に実行中タスクがあれば自動で終了）
- 「終了」ボタン → 実績終了時刻を記録
- 日付の前後移動（過去ログの閲覧、翌日以降への予定入れ）
- タスクの直接追加・編集・削除

### 2. インボックス
- タイトル（+任意メモ）を即追加
- 各項目に「スケジュールへ」ボタン → 日付・開始時刻・見積分数を指定してタスク化
- 編集・削除

### 3. 設定
- GAS APIのURL、トークンの入力・保存（localStorage）
- 接続テスト

## データ構造（スプレッドシート）

### inbox シート
| 列 | 内容 |
|---|---|
| id | 一意ID |
| title | タイトル |
| memo | メモ |
| created_at | 追加日時（ISO） |
| status | open / scheduled / deleted |

### tasks シート
| 列 | 内容 |
|---|---|
| id | 一意ID |
| title | タイトル |
| date | 実施日（YYYY-MM-DD） |
| planned_start | 予定開始（HH:MM、空可） |
| planned_minutes | 見積分数（空可） |
| actual_start | 実績開始（ISO、空可） |
| actual_end | 実績終了（ISO、空可） |
| status | todo / doing / done |
| source | inbox / direct / routine / calendar |
| memo | メモ |
| created_at | 作成日時（ISO） |

## API（GAS doPost）

- POST、ボディはJSON文字列（Content-Type: text/plain でCORSプリフライトを回避）
- リクエスト: `{ token, action, payload }`
- レスポンス: `{ ok: true, data }` / `{ ok: false, error }`

| action | payload | 内容 |
|---|---|---|
| ping | - | 接続テスト |
| getData | { date } | 指定日のタスク一覧 + インボックス一覧をまとめて返す |
| inboxAdd | { title, memo } | インボックス追加 |
| inboxUpdate | { id, title, memo } | インボックス編集 |
| inboxDelete | { id } | インボックス削除（status=deleted） |
| inboxToTask | { id, date, plannedStart, plannedMinutes } | インボックス項目をタスク化 |
| taskAdd | { title, date, plannedStart, plannedMinutes, memo } | タスク直接追加 |
| taskUpdate | { id, ...変更フィールド } | タスク編集 |
| taskStart | { id } | 実績開始を記録。実行中の他タスクは自動終了 |
| taskStop | { id } | 実績終了を記録 |
| taskDelete | { id } | タスク削除（行削除ではなくstatus管理はせず物理削除） |

## Obsidian日次ログ形式（Phase 3で出力）

```markdown
# 2026-07-16 デイリーログ

| 開始 | 終了 | 実績 | タスク | 見積 |
|---|---|---|---|---|
| 09:02 | 09:45 | 43分 | メール処理 | 30分 |

**予定していて未実施**: ○○
**インボックス残**: 3件
```

出力先: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/ThinkPad/DailyLog/YYYY-MM-DD.md`

## フェーズ計画

1. **Phase 1（コア）**: インボックス + 当日スケジュール + 開始/終了ログ + PWA化 ← 今ここ
2. **Phase 2**: Googleカレンダー読み込み表示 + ルーチンタスク（毎日・毎週の繰り返し）
3. **Phase 3**: Mac日次スクリプト（launchd）でObsidianへ自動書き出し

## 決定事項の経緯

- バックエンドにGAS+スプレッドシートを採用: 無料、カレンダー連携が容易、データを直接確認できる
- カレンダーは読み込みのみ: 双方向は重複・競合処理が複雑になるため
- Obsidian vaultはiCloudのまま: Google Drive移行はObsidianモバイル非対応のため見送り
- GitHub Pages採用: GAS単体ではPWA（ホーム画面から全画面起動）が動かないため

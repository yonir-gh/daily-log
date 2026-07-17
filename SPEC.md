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
| status | todo / doing / done / skipped（ルーチン生成タスクの削除時） |
| source | inbox / direct / routine / calendar |
| memo | メモ |
| created_at | 作成日時（ISO） |
| routine_id | 生成元ルーチンのID（重複生成の防止用） |
| event_id | 取り込み元カレンダー予定のID（重複表示の防止用） |
| sort_order | 並び順キー（数値文字列）。未設定なら予定時刻から導出。ドラッグ並び替えで更新 |
| color | 表示色（#rrggbb、空=なし） |

### 挙動のルール
- タスクは並行実行できる（開始しても他の実行中タスクは止めない）
- 完了済みタスクを再度開始すると複製が作られて開始され、元の実績は保持される
- 実績の開始/終了時刻は編集ダイアログから手修正できる（終了あり=done、開始のみ=doing、両方空=todo に自動整合）

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
| inboxStart | { id } | インボックス項目を今日のタスク化して即開始 |
| eventStart | { event_id, title, date, planned_start, planned_minutes } | カレンダー予定をタスク化して即開始 |
| taskAdd | { title, date, plannedStart, plannedMinutes, memo } | タスク直接追加 |
| taskUpdate | { id, ...変更フィールド } | タスク編集 |
| taskStart | { id } | 実績開始を記録。実行中の他タスクは自動終了 |
| taskStop | { id } | 実績終了を記録 |
| taskDelete | { id } | タスク削除。ルーチン生成タスクはstatus=skippedで隠す（物理削除すると再生成されるため） |
| routineAdd | { title, planned_start, planned_minutes, weekdays, memo } | ルーチン追加。weekdaysは "1,2,3,4,5" 形式（0=日〜6=土） |
| routineUpdate | { id, ...変更フィールド } | ルーチン編集 |
| routineDelete | { id } | ルーチン削除（生成済みタスクは残る） |
| dumpAll | - | 全データ取得（デバッグ・Phase 3のエクスポート用） |

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

### routines シート（Phase 2）
| 列 | 内容 |
|---|---|
| id | 一意ID |
| title | タイトル |
| planned_start | 予定開始（HH:MM、空可） |
| planned_minutes | 見積分数（空可） |
| weekdays | 繰り返す曜日（"0,1,2"形式、0=日〜6=土） |
| memo | メモ |
| active | true / false |
| created_at | 作成日時（ISO） |
| interval_weeks | 何週おきか（1=毎週、2=隔週…） |
| anchor_date | 週間隔の基準日（この週から数えてinterval_weeksの倍数の週に生成） |
| color | 生成タスクに引き継ぐ表示色 |

ルーチンは getData 時に当日分のタスクを自動生成する（過去日は生成しない）。
tasksシートの routine_id 列で生成済みかを判定する。

### projects シート
| 列 | 内容 |
|---|---|
| id | 一意ID |
| name | プロジェクト名（仕事・家事など） |
| color | 表示色（タスクのドット・ラベル・グラフに使う） |
| created_at | 作成日時（ISO） |

setup時に空ならデフォルト6件（仕事・成長・家事・健康・休息・雑事）を投入。
tasks/routines の project_id 列で紐付け。タスクの表示色はプロジェクト色を優先し、旧color列はフォールバック。

### 実績サマリー（実績タブ）
- 完了数 / 実績合計 / 見積合計 の統計
- 達成率（完了÷全タスク）を中央に表示したプロジェクト別ドーナツグラフ（実行中は経過分を含む）
- 凡例に必ず名前＋時間＋%を表示（色だけに依存しない）

### 並び替え（taskReorder）
ドロップ時にリスト全体の並び順キーを振り直して一括保存する。
中間値方式では同じキー（時刻なしタスク同士）の間に割り込めないため。
カレンダー予定の位置（時刻由来キー）は固定し、その間で等間隔に再割当する。

### カレンダー読み込み（Phase 2）
- getData のレスポンスに events（{id, title, calendar, allDay, start, end}の配列）が含まれる
- Googleカレンダー側で表示中（isSelected）のカレンダーのみ対象
- 権限未承認の場合は events=[] + warning を返し、タスク機能は動き続ける

## フェーズ計画

1. **Phase 1（コア）**: インボックス + 当日スケジュール + 開始/終了ログ + PWA化 ✅ 2026-07-16
2. **Phase 2**: Googleカレンダー読み込み表示 + ルーチンタスク（毎日・毎週の繰り返し） ← 今ここ
3. **Phase 3**: Mac日次スクリプト（launchd）でObsidianへ自動書き出し

## 決定事項の経緯

- バックエンドにGAS+スプレッドシートを採用: 無料、カレンダー連携が容易、データを直接確認できる
- カレンダーは読み込みのみ: 双方向は重複・競合処理が複雑になるため
- Obsidian vaultはiCloudのまま: Google Drive移行はObsidianモバイル非対応のため見送り
- GitHub Pages採用: GAS単体ではPWA（ホーム画面から全画面起動）が動かないため

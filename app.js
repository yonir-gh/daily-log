'use strict';

// ---- 状態 ----
const SETTINGS_KEY = 'dailylog.settings';
let settings = loadSettings();
let currentDate = todayStr();
let data = { tasks: [], inbox: [], events: [], routines: [] };
let tickTimer = null;

const $ = (id) => document.getElementById(id);

// ---- 設定 ----
function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || { apiUrl: '', token: '' };
  } catch (e) {
    return { apiUrl: '', token: '' };
  }
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ---- API ----
async function api(action, payload, opts = {}) {
  if (!settings.apiUrl || !settings.token) {
    showView('settings');
    throw new Error('先に設定画面でAPI URLとトークンを入力してください');
  }
  if (!opts.silent) $('loading').classList.remove('hidden');
  try {
    const res = await fetch(settings.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: settings.token, action, payload: payload || {} })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'APIエラー');
    return json.data;
  } finally {
    if (!opts.silent) $('loading').classList.add('hidden');
  }
}

async function reload(opts = {}) {
  try {
    data = await api('getData', { date: currentDate }, opts);
    data.events = data.events || [];
    data.routines = data.routines || [];
    renderAll();
    if (data.warning) toast(data.warning);
  } catch (e) {
    toast(e.message);
  }
}

// ---- 日付ユーティリティ ----
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }
function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const youbi = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  const base = `${d.getMonth() + 1}/${d.getDate()}（${youbi}）`;
  return dateStr === todayStr() ? `今日 ${base}` : base;
}
function hhmm(iso) { return iso ? iso.slice(11, 16) : ''; }
function toMins(hhmmStr) {
  const [h, m] = hhmmStr.split(':').map(Number);
  return h * 60 + m;
}
function minutesBetween(startIso, endIso) {
  const ms = new Date(endIso) - new Date(startIso);
  return Math.max(0, Math.round(ms / 60000));
}
function fmtMinutes(min) {
  if (min >= 60) return `${Math.floor(min / 60)}時間${min % 60 ? min % 60 + '分' : ''}`;
  return `${min}分`;
}
function nowIsoLocal() {
  const d = new Date();
  return `${todayStr()}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ---- アイコン ----
const ICON_PLAY = '<path d="M8 5.5v13l11-6.5z"/>';
const ICON_STOP = '<rect x="7" y="7" width="10" height="10" rx="1.5"/>';
const ICON_REPEAT = '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>';
const ICON_GRIP = '<line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="15" x2="17" y2="15"/>';

function icon(inner, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  if (cls) svg.setAttribute('class', cls);
  svg.innerHTML = inner;
  return svg;
}

function colorDot(color) {
  const dot = document.createElement('span');
  dot.className = 'color-dot';
  dot.style.background = color;
  return dot;
}

// ---- 並び順キー ----
// 手動並び替え（sort_order）を最優先。未設定なら予定時刻から導出、時刻なしは末尾
function taskKey(t) {
  if (t.sort_order !== undefined && t.sort_order !== '') return Number(t.sort_order);
  return t.planned_start ? toMins(t.planned_start) * 1000 : 9000000;
}
function eventKey(ev) {
  return ev.allDay ? -1000 : toMins(ev.start) * 1000;
}

// ---- 描画 ----
function renderAll() {
  renderToday();
  renderInbox();
  renderRoutines();
}

function renderToday() {
  $('date-display').textContent = dateLabel(currentDate);
  const list = $('task-list');
  list.innerHTML = '';
  const tasks = data.tasks;
  $('task-empty').classList.toggle('hidden', tasks.length > 0 || data.events.length > 0);

  // タスクとカレンダー予定を並び順キーで混ぜて表示する（終日予定は先頭）
  const items = [];
  for (const ev of data.events) items.push({ key: eventKey(ev), ev });
  for (const t of tasks) items.push({ key: taskKey(t), t });
  items.sort((a, b) => a.key - b.key);

  let doneCount = 0, actualTotal = 0, plannedTotal = 0;

  for (const item of items) {
    if (item.ev) {
      const li = renderEventCard(item.ev);
      li.dataset.key = item.key;
      list.appendChild(li);
      continue;
    }
    const t = item.t;
    if (t.status === 'done') doneCount++;
    if (t.planned_minutes) plannedTotal += Number(t.planned_minutes) || 0;
    if (t.actual_start && t.actual_end) actualTotal += minutesBetween(t.actual_start, t.actual_end);

    const li = renderTaskCard(t);
    li.dataset.key = item.key;
    list.appendChild(li);
  }

  $('today-summary').textContent = tasks.length
    ? `${tasks.length}件中 ${doneCount}件完了 ｜ 実績合計 ${fmtMinutes(actualTotal)}${plannedTotal ? ` ｜ 見積合計 ${fmtMinutes(plannedTotal)}` : ''}`
    : '';
}

function renderTaskCard(t) {
  const li = document.createElement('li');
  li.className = `card ${t.status}`;

  const grip = document.createElement('button');
  grip.className = 'grip';
  grip.setAttribute('aria-label', '並び替え');
  grip.appendChild(icon(ICON_GRIP));
  li.appendChild(grip);
  enableTaskDrag(li, grip, t);

  const body = document.createElement('div');
  body.className = 'body';
  const title = document.createElement('div');
  title.className = 'title';
  if (t.color) title.appendChild(colorDot(t.color));
  title.appendChild(document.createTextNode(t.title));
  body.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'meta';
  if (t.source === 'routine') {
    meta.appendChild(icon(ICON_REPEAT, 'meta-icon'));
  } else if (t.source === 'calendar') {
    const mark = document.createElement('span');
    mark.className = 'tag';
    mark.textContent = '予定';
    meta.appendChild(mark);
  }
  if (t.planned_start || t.planned_minutes) {
    const plan = document.createElement('span');
    plan.textContent = `予定 ${t.planned_start || '--:--'}${t.planned_minutes ? '・' + fmtMinutes(Number(t.planned_minutes)) : ''}`;
    meta.appendChild(plan);
  }
  if (t.actual_start) {
    const actual = document.createElement('span');
    actual.className = 'actual';
    if (t.status === 'doing') {
      const elapsed = minutesBetween(t.actual_start, nowIsoLocal());
      actual.textContent = `実行中 ${hhmm(t.actual_start)}〜（${fmtMinutes(elapsed)}）`;
      actual.dataset.doingStart = t.actual_start;
    } else if (t.actual_end) {
      actual.textContent = `実績 ${hhmm(t.actual_start)}〜${hhmm(t.actual_end)}（${fmtMinutes(minutesBetween(t.actual_start, t.actual_end))}）`;
    }
    meta.appendChild(actual);
  }
  if (meta.children.length) body.appendChild(meta);
  if (t.memo) {
    const memo = document.createElement('div');
    memo.className = 'memo';
    memo.textContent = t.memo;
    body.appendChild(memo);
  }
  body.addEventListener('click', () => openTaskDialog(t));
  li.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'actions';
  if (t.status === 'doing') {
    const stop = document.createElement('button');
    stop.className = 'btn-stop';
    stop.setAttribute('aria-label', '終了');
    stop.appendChild(icon(ICON_STOP));
    stop.addEventListener('click', () => mutate('taskStop', { id: t.id }));
    actions.appendChild(stop);
  } else {
    const start = document.createElement('button');
    start.className = 'btn-start';
    start.setAttribute('aria-label', t.status === 'done' ? '再実行' : '開始');
    start.appendChild(icon(ICON_PLAY));
    start.addEventListener('click', () => mutate('taskStart', { id: t.id }));
    actions.appendChild(start);
  }
  li.appendChild(actions);
  return li;
}

function renderEventCard(ev) {
  const li = document.createElement('li');
  li.className = 'card event';
  const body = document.createElement('div');
  body.className = 'body';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = ev.title;
  body.appendChild(title);
  const meta = document.createElement('div');
  meta.className = 'meta';
  const time = document.createElement('span');
  time.textContent = ev.allDay ? '終日' : `${ev.start}〜${ev.end}`;
  meta.appendChild(time);
  if (ev.calendar) {
    const cal = document.createElement('span');
    cal.textContent = ev.calendar;
    meta.appendChild(cal);
  }
  body.appendChild(meta);
  li.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const start = document.createElement('button');
  start.className = 'btn-start';
  start.setAttribute('aria-label', '開始');
  start.appendChild(icon(ICON_PLAY));
  start.addEventListener('click', () => mutate('eventStart', {
    event_id: ev.id,
    title: ev.title,
    date: currentDate,
    planned_start: ev.allDay ? '' : ev.start,
    planned_minutes: eventMinutes(ev)
  }));
  actions.appendChild(start);
  li.appendChild(actions);
  return li;
}

function eventMinutes(ev) {
  if (ev.allDay || !ev.start || !ev.end) return '';
  const diff = toMins(ev.end) - toMins(ev.start);
  return diff > 0 ? String(diff) : '';
}

// ---- ドラッグ並び替え ----
function enableTaskDrag(li, grip, task) {
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    li.classList.add('dragging');
    const list = $('task-list');

    const onMove = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const over = el && el.closest ? el.closest('#task-list > li') : null;
      if (!over || over === li) return;
      const r = over.getBoundingClientRect();
      if (ev.clientY < r.top + r.height / 2) {
        list.insertBefore(li, over);
      } else {
        list.insertBefore(li, over.nextSibling);
      }
    };
    // ドラッグ中にliをDOM移動するとポインターキャプチャが外れるため、windowで追跡する
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      li.classList.remove('dragging');
      saveNewOrder(li, task);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

function saveNewOrder(li, task) {
  const prev = li.previousElementSibling;
  const next = li.nextElementSibling;
  if (!prev && !next) return;
  const prevKey = prev ? Number(prev.dataset.key) : null;
  const nextKey = next ? Number(next.dataset.key) : null;
  let newKey;
  if (prevKey === null) newKey = nextKey - 1000;
  else if (nextKey === null) newKey = prevKey + 1000;
  else newKey = (prevKey + nextKey) / 2;
  if (newKey === Number(li.dataset.key)) return;
  li.dataset.key = newKey;
  mutate('taskUpdate', { id: task.id, sort_order: String(newKey) });
}

// ---- Inbox ----
function renderInbox() {
  const list = $('inbox-list');
  list.innerHTML = '';
  $('inbox-empty').classList.toggle('hidden', data.inbox.length > 0);

  const badge = $('inbox-badge');
  badge.classList.toggle('hidden', data.inbox.length === 0);
  badge.textContent = data.inbox.length;

  for (const item of data.inbox) {
    const li = document.createElement('li');
    li.className = 'card';

    const body = document.createElement('div');
    body.className = 'body';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = item.title;
    body.appendChild(title);
    if (item.memo) {
      const memo = document.createElement('div');
      memo.className = 'memo';
      memo.textContent = item.memo;
      body.appendChild(memo);
    }
    body.addEventListener('click', () => {
      const newTitle = prompt('タイトルを編集', item.title);
      if (newTitle === null) return;
      if (newTitle.trim() === '') {
        if (confirm('削除しますか？')) mutate('inboxDelete', { id: item.id });
        return;
      }
      mutate('inboxUpdate', { id: item.id, title: newTitle.trim() });
    });
    li.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const sched = document.createElement('button');
    sched.className = 'btn-schedule';
    sched.textContent = '予定へ';
    sched.addEventListener('click', () => openScheduleDialog(item));
    actions.appendChild(sched);
    const start = document.createElement('button');
    start.className = 'btn-start';
    start.setAttribute('aria-label', '今すぐ開始');
    start.appendChild(icon(ICON_PLAY));
    start.addEventListener('click', () => {
      mutate('inboxStart', { id: item.id });
      currentDate = todayStr();
      showView('today');
    });
    actions.appendChild(start);
    li.appendChild(actions);
    list.appendChild(li);
  }
}

// ---- ルーチン ----
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const INTERVAL_LABELS = { 1: '毎週', 2: '隔週', 3: '3週おき', 4: '4週おき' };

function weekdaysLabel(weekdays) {
  const days = weekdays.split(',').filter((s) => s !== '');
  if (days.length === 7) return '毎日';
  return days.map((d) => WEEKDAY_LABELS[Number(d)]).join('・');
}

function routineLabel(r) {
  const interval = Number(r.interval_weeks || '1') || 1;
  const parts = [];
  if (interval > 1) parts.push(INTERVAL_LABELS[interval] || `${interval}週おき`);
  parts.push(weekdaysLabel(r.weekdays));
  if (r.planned_start) parts.push(r.planned_start);
  if (r.planned_minutes) parts.push(fmtMinutes(Number(r.planned_minutes)));
  return parts.join('・');
}

function renderRoutines() {
  const list = $('routine-list');
  list.innerHTML = '';
  const routines = data.routines;
  $('routine-empty').classList.toggle('hidden', routines.length > 0);

  for (const r of routines) {
    const li = document.createElement('li');
    li.className = 'card';
    const body = document.createElement('div');
    body.className = 'body';
    const title = document.createElement('div');
    title.className = 'title';
    if (r.color) title.appendChild(colorDot(r.color));
    title.appendChild(document.createTextNode(r.title));
    body.appendChild(title);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.appendChild(icon(ICON_REPEAT, 'meta-icon'));
    const info = document.createElement('span');
    info.textContent = routineLabel(r);
    meta.appendChild(info);
    body.appendChild(meta);
    body.addEventListener('click', () => openRoutineDialog(r));
    li.appendChild(body);
    list.appendChild(li);
  }
}

// 実行中タスクの経過分を毎秒更新（再取得はしない）
function startTicker() {
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    document.querySelectorAll('[data-doing-start]').forEach((el) => {
      const start = el.dataset.doingStart;
      el.textContent = `実行中 ${hhmm(start)}〜（${fmtMinutes(minutesBetween(start, nowIsoLocal()))}）`;
    });
  }, 1000);
}

// ---- 操作 ----
async function mutate(action, payload) {
  try {
    await api(action, payload);
    await reload();
  } catch (e) {
    toast(e.message);
  }
}

// ---- ビュー切り替え ----
function showView(name) {
  for (const v of ['today', 'inbox', 'settings']) {
    $(`view-${v}`).classList.toggle('hidden', v !== name);
  }
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === name);
  });
}

// ---- カラー選択 ----
function setColorChoice(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((r) => {
    r.checked = r.value === (value || '');
  });
}
function getColorChoice(name) {
  const sel = document.querySelector(`input[name="${name}"]:checked`);
  return sel ? sel.value : '';
}

// ---- ダイアログ: タスク ----
let editingTaskId = null;
function openTaskDialog(task) {
  editingTaskId = task ? task.id : null;
  $('task-dialog-title').textContent = task ? 'タスクを編集' : 'タスクを追加';
  $('task-title').value = task ? task.title : '';
  $('task-date').value = task ? task.date : currentDate;
  $('task-start').value = task ? task.planned_start : '';
  $('task-minutes').value = task ? task.planned_minutes : '';
  $('task-memo').value = task ? task.memo : '';
  $('task-actual-row').classList.toggle('hidden', !task);
  $('task-actual-start').value = task ? hhmm(task.actual_start) : '';
  $('task-actual-end').value = task ? hhmm(task.actual_end) : '';
  setColorChoice('task-color', task ? task.color : '');
  $('btn-task-delete').classList.toggle('hidden', !task);
  $('task-dialog').showModal();
}

// ---- ダイアログ: スケジュール ----
let schedulingInboxId = null;
function openScheduleDialog(item) {
  schedulingInboxId = item.id;
  $('schedule-item-title').textContent = item.title;
  $('schedule-date').value = currentDate;
  $('schedule-start').value = '';
  $('schedule-minutes').value = '';
  $('schedule-dialog').showModal();
}

// ---- ダイアログ: ルーチン ----
let editingRoutine = null;
function openRoutineDialog(routine) {
  editingRoutine = routine || null;
  $('routine-dialog-title').textContent = routine ? 'ルーチンを編集' : 'ルーチンを追加';
  $('routine-title').value = routine ? routine.title : '';
  $('routine-start').value = routine ? routine.planned_start : '';
  $('routine-minutes').value = routine ? routine.planned_minutes : '';
  $('routine-memo').value = routine ? routine.memo : '';
  $('routine-interval').value = routine ? String(Number(routine.interval_weeks || '1') || 1) : '1';
  setColorChoice('routine-color', routine ? routine.color : '');
  const checked = routine ? routine.weekdays.split(',') : ['0', '1', '2', '3', '4', '5', '6'];
  document.querySelectorAll('#routine-weekdays input').forEach((cb) => {
    cb.checked = checked.includes(cb.value);
  });
  $('btn-routine-delete').classList.toggle('hidden', !routine);
  $('routine-dialog').showModal();
}

// ---- トースト ----
let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

// ---- イベント登録 ----
function bindEvents() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  });

  $('btn-prev-day').addEventListener('click', () => { currentDate = shiftDate(currentDate, -1); reload(); });
  $('btn-next-day').addEventListener('click', () => { currentDate = shiftDate(currentDate, 1); reload(); });
  $('btn-today').addEventListener('click', () => { currentDate = todayStr(); reload(); });

  $('btn-add-task').addEventListener('click', () => openTaskDialog(null));

  $('task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    $('task-dialog').close();
    const fields = {
      title: $('task-title').value.trim(),
      date: $('task-date').value,
      planned_start: $('task-start').value,
      planned_minutes: $('task-minutes').value,
      memo: $('task-memo').value,
      color: getColorChoice('task-color')
    };
    if (!fields.title) return;
    if (editingTaskId) {
      // 実績時刻の手修正。終了があれば完了、開始のみなら実行中、両方空なら未着手に揃える
      const as = $('task-actual-start').value;
      const ae = $('task-actual-end').value;
      fields.actual_start = as ? `${fields.date}T${as}:00` : '';
      fields.actual_end = ae ? `${fields.date}T${ae}:00` : '';
      fields.status = ae ? 'done' : as ? 'doing' : 'todo';
      mutate('taskUpdate', { id: editingTaskId, ...fields });
    } else {
      mutate('taskAdd', fields);
    }
  });
  $('btn-task-cancel').addEventListener('click', () => $('task-dialog').close());
  $('btn-task-delete').addEventListener('click', () => {
    if (!confirm('このタスクを削除しますか？')) return;
    $('task-dialog').close();
    mutate('taskDelete', { id: editingTaskId });
  });

  $('inbox-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('inbox-input').value.trim();
    if (!title) return;
    const memo = $('inbox-memo').value.trim();
    $('inbox-input').value = '';
    $('inbox-memo').value = '';
    mutate('inboxAdd', { title, memo });
  });

  $('schedule-form').addEventListener('submit', (e) => {
    e.preventDefault();
    $('schedule-dialog').close();
    mutate('inboxToTask', {
      id: schedulingInboxId,
      date: $('schedule-date').value,
      planned_start: $('schedule-start').value,
      planned_minutes: $('schedule-minutes').value
    });
  });
  $('btn-schedule-cancel').addEventListener('click', () => $('schedule-dialog').close());

  $('btn-add-routine').addEventListener('click', () => openRoutineDialog(null));
  $('routine-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const weekdays = [...document.querySelectorAll('#routine-weekdays input:checked')]
      .map((cb) => cb.value).join(',');
    if (!weekdays) {
      toast('曜日を1つ以上選んでください');
      return;
    }
    $('routine-dialog').close();
    const interval = $('routine-interval').value;
    const fields = {
      title: $('routine-title').value.trim(),
      planned_start: $('routine-start').value,
      planned_minutes: $('routine-minutes').value,
      weekdays,
      memo: $('routine-memo').value,
      interval_weeks: interval,
      color: getColorChoice('routine-color')
    };
    if (!fields.title) return;
    if (editingRoutine) {
      // 頻度を変えた時だけ基準週を今週に取り直す
      if (String(Number(editingRoutine.interval_weeks || '1') || 1) !== interval) {
        fields.anchor_date = todayStr();
      }
      mutate('routineUpdate', { id: editingRoutine.id, ...fields });
    } else {
      fields.anchor_date = todayStr();
      mutate('routineAdd', fields);
    }
  });
  $('btn-routine-cancel').addEventListener('click', () => $('routine-dialog').close());
  $('btn-routine-delete').addEventListener('click', () => {
    if (!confirm('このルーチンを削除しますか？（作成済みのタスクは残ります）')) return;
    $('routine-dialog').close();
    mutate('routineDelete', { id: editingRoutine.id });
  });
  $('btn-routine-everyday').addEventListener('click', () => {
    document.querySelectorAll('#routine-weekdays input').forEach((cb) => { cb.checked = true; });
  });

  $('btn-save-settings').addEventListener('click', () => {
    settings.apiUrl = $('setting-url').value.trim();
    settings.token = $('setting-token').value.trim();
    saveSettings();
    setStatus('保存しました', 'ok');
    reload();
  });
  $('btn-test-connection').addEventListener('click', async () => {
    settings.apiUrl = $('setting-url').value.trim();
    settings.token = $('setting-token').value.trim();
    saveSettings();
    setStatus('接続中…');
    try {
      await api('ping');
      setStatus('接続OK', 'ok');
    } catch (e) {
      setStatus('接続失敗: ' + e.message, 'err');
    }
  });

  // アプリに戻ってきたら最新化
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && settings.apiUrl) reload({ silent: true });
  });
}

function setStatus(msg, cls) {
  const el = $('settings-status');
  el.textContent = msg;
  el.className = 'status' + (cls ? ' ' + cls : '');
}

// ---- 起動 ----
function init() {
  bindEvents();
  startTicker();
  $('setting-url').value = settings.apiUrl;
  $('setting-token').value = settings.token;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  if (settings.apiUrl && settings.token) {
    reload();
  } else {
    showView('settings');
    setStatus('API URLとトークンを入力してください');
  }
}

init();

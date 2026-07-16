'use strict';

// ---- 状態 ----
const SETTINGS_KEY = 'dailylog.settings';
let settings = loadSettings();
let currentDate = todayStr();
let data = { tasks: [], inbox: [] };
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
    renderAll();
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

// ---- 描画 ----
function renderAll() {
  renderToday();
  renderInbox();
}

function renderToday() {
  $('date-display').textContent = dateLabel(currentDate);
  const list = $('task-list');
  list.innerHTML = '';
  const tasks = data.tasks;
  $('task-empty').classList.toggle('hidden', tasks.length > 0);

  let doneCount = 0, actualTotal = 0, plannedTotal = 0;

  for (const t of tasks) {
    if (t.status === 'done') doneCount++;
    if (t.planned_minutes) plannedTotal += Number(t.planned_minutes) || 0;

    const li = document.createElement('li');
    li.className = `card ${t.status}`;

    const body = document.createElement('div');
    body.className = 'body';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = t.title;
    body.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'meta';
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
        const mins = minutesBetween(t.actual_start, t.actual_end);
        actualTotal += mins;
        actual.textContent = `実績 ${hhmm(t.actual_start)}〜${hhmm(t.actual_end)}（${fmtMinutes(mins)}）`;
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
      stop.textContent = '終了';
      stop.addEventListener('click', () => mutate('taskStop', { id: t.id }));
      actions.appendChild(stop);
    } else {
      const start = document.createElement('button');
      start.className = 'btn-start';
      start.textContent = t.status === 'done' ? '再開' : '開始';
      start.addEventListener('click', () => mutate('taskStart', { id: t.id }));
      actions.appendChild(start);
    }
    li.appendChild(actions);
    list.appendChild(li);
  }

  $('today-summary').textContent = tasks.length
    ? `${tasks.length}件中 ${doneCount}件完了 ｜ 実績合計 ${fmtMinutes(actualTotal)}${plannedTotal ? ` ｜ 見積合計 ${fmtMinutes(plannedTotal)}` : ''}`
    : '';
}

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
    li.appendChild(actions);
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
      memo: $('task-memo').value
    };
    if (!fields.title) return;
    if (editingTaskId) {
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
    $('inbox-input').value = '';
    mutate('inboxAdd', { title });
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

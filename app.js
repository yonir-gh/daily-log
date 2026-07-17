'use strict';

// ---- 状態 ----
const SETTINGS_KEY = 'dailylog.settings';
let settings = loadSettings();
let currentDate = todayStr();
let data = { tasks: [], inbox: [], events: [], routines: [], projects: [] };
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
    data.projects = data.projects || [];
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
const ICON_STOP = '<rect x="7" y="7" width="10" height="10" rx="1.5"/>';
const ICON_CHECK = '<polyline points="6.5 12.5 10.5 16.5 17.5 8"/>';
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
  renderProjects();
  renderSummary();
}

// ---- プロジェクト ----
function projectById(id) {
  return data.projects.find((p) => p.id === id) || null;
}

function taskColor(t) {
  const p = t.project_id ? projectById(t.project_id) : null;
  return p ? p.color : t.color || '';
}

// select要素にプロジェクトの選択肢を入れる
function fillProjectSelect(selectEl, selectedId) {
  selectEl.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'なし';
  selectEl.appendChild(none);
  for (const p of data.projects) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    selectEl.appendChild(opt);
  }
  selectEl.value = selectedId && projectById(selectedId) ? selectedId : '';
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
    li.dataset.taskId = t.id;
    list.appendChild(li);
  }

  $('today-summary').textContent = tasks.length
    ? `${tasks.length}件中 ${doneCount}件完了 ｜ 実績合計 ${fmtMinutes(actualTotal)}${plannedTotal ? ` ｜ 見積合計 ${fmtMinutes(plannedTotal)}` : ''}`
    : '';
}

// ステータスサークル: 未着手=グレーの輪（開始）、実行中=青塗り（停止）、完了=緑チェック（再実行=複製）
function statusButton(status, onClick) {
  const btn = document.createElement('button');
  btn.className = `status-btn ${status}`;
  if (status === 'doing') {
    btn.setAttribute('aria-label', '終了');
    btn.appendChild(icon(ICON_STOP));
  } else if (status === 'done') {
    btn.setAttribute('aria-label', 'もう一度実行');
    btn.appendChild(icon(ICON_CHECK));
  } else {
    btn.setAttribute('aria-label', '開始');
  }
  btn.addEventListener('click', onClick);
  return btn;
}

// 右端の時刻目盛り
function rail(timeText, active) {
  const el = document.createElement('div');
  el.className = 'rail';
  if (timeText) {
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = timeText;
    el.appendChild(time);
    const dot = document.createElement('span');
    dot.className = 'dot' + (active ? ' active' : '');
    el.appendChild(dot);
  }
  return el;
}

// 見積との差分（±0分 / +5分 / -5分）
function diffLabel(actualMin, plannedMinutes) {
  if (!plannedMinutes) return '';
  const diff = actualMin - Number(plannedMinutes);
  if (diff === 0) return '・±0分';
  return `・${diff > 0 ? '+' : '−'}${Math.abs(diff)}分`;
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

  li.appendChild(statusButton(t.status, () => {
    mutate(t.status === 'doing' ? 'taskStop' : 'taskStart', { id: t.id });
  }));

  const body = document.createElement('div');
  body.className = 'body';
  const title = document.createElement('div');
  title.className = 'title';
  const color = taskColor(t);
  if (color) title.appendChild(colorDot(color));
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
  const project = t.project_id ? projectById(t.project_id) : null;
  if (project) {
    const pj = document.createElement('span');
    pj.className = 'project-label';
    pj.textContent = project.name;
    if (project.color) pj.style.color = project.color;
    meta.appendChild(pj);
  }
  if (t.status === 'doing' && t.actual_start) {
    const doing = document.createElement('span');
    doing.className = 'doing-meta';
    doing.dataset.doingStart = t.actual_start;
    if (t.planned_minutes) doing.dataset.planned = t.planned_minutes;
    doing.textContent = doingText(t.actual_start, t.planned_minutes);
    meta.appendChild(doing);
  } else if (t.status === 'done' && t.actual_start && t.actual_end) {
    const mins = minutesBetween(t.actual_start, t.actual_end);
    const done = document.createElement('span');
    done.className = 'done-meta';
    done.textContent = `実績 ${hhmm(t.actual_start)}〜${hhmm(t.actual_end)}（${mins}分${diffLabel(mins, t.planned_minutes)}）`;
    meta.appendChild(done);
  } else if (t.planned_minutes) {
    const plan = document.createElement('span');
    plan.textContent = `予想 ${fmtMinutes(Number(t.planned_minutes))}`;
    meta.appendChild(plan);
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

  li.appendChild(rail(t.planned_start, t.status === 'doing'));
  return li;
}

function doingText(startIso, plannedMinutes) {
  const elapsed = minutesBetween(startIso, nowIsoLocal());
  return `経過 ${elapsed}分${plannedMinutes ? `（予想 ${plannedMinutes}分）` : ''}`;
}

function renderEventCard(ev) {
  const li = document.createElement('li');
  li.className = 'card event';

  const spacer = document.createElement('span');
  spacer.className = 'grip';
  li.appendChild(spacer);

  li.appendChild(statusButton('todo', () => mutate('eventStart', {
    event_id: ev.id,
    title: ev.title,
    date: currentDate,
    planned_start: ev.allDay ? '' : ev.start,
    planned_minutes: eventMinutes(ev)
  })));

  const body = document.createElement('div');
  body.className = 'body';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = ev.title;
  body.appendChild(title);
  const meta = document.createElement('div');
  meta.className = 'meta';
  const mark = document.createElement('span');
  mark.className = 'tag';
  mark.textContent = '予定';
  meta.appendChild(mark);
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

  li.appendChild(rail(ev.allDay ? '終日' : ev.start, false));
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
    const orderBefore = [...list.children].map((el) => el.dataset.taskId || 'ev').join(',');

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
      const orderAfter = [...list.children].map((el) => el.dataset.taskId || 'ev').join(',');
      if (orderAfter !== orderBefore) saveNewOrder();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

// ドロップ後にリスト全体の並び順キーを振り直して一括保存する。
// 中間値方式だと同じキーのタスク（時刻なし同士など）の間に割り込めないため、毎回振り直す
function saveNewOrder() {
  const items = [...$('task-list').children];
  const updates = [];
  let i = 0;
  let lower = -2000; // 直前の固定キー（カレンダー予定は時刻由来で動かせない）
  while (i < items.length) {
    if (!items[i].dataset.taskId) {
      lower = Number(items[i].dataset.key);
      i++;
      continue;
    }
    let j = i;
    while (j < items.length && items[j].dataset.taskId) j++;
    const count = j - i;
    let upper = j < items.length ? Number(items[j].dataset.key) : lower + (count + 1) * 1000;
    if (upper <= lower) upper = lower + (count + 1) * 1000;
    const step = (upper - lower) / (count + 1);
    for (let k = i; k < j; k++) {
      const key = lower + step * (k - i + 1);
      if (Number(items[k].dataset.key) !== key) {
        items[k].dataset.key = key;
        updates.push({ id: items[k].dataset.taskId, sort_order: String(key) });
      }
    }
    lower = upper;
    i = j;
  }
  if (updates.length) mutate('taskReorder', { orders: updates });
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
    const startBtn = statusButton('todo', () => {
      mutate('inboxStart', { id: item.id });
      currentDate = todayStr();
      showView('today');
    });
    startBtn.setAttribute('aria-label', '今すぐ開始');
    li.appendChild(startBtn);
    li.appendChild(body);

    const sched = document.createElement('button');
    sched.className = 'text-btn';
    sched.textContent = '予定へ';
    sched.addEventListener('click', () => openScheduleDialog(item));
    li.appendChild(sched);
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
    const rColor = taskColor(r);
    if (rColor) title.appendChild(colorDot(rColor));
    title.appendChild(document.createTextNode(r.title));
    body.appendChild(title);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.appendChild(icon(ICON_REPEAT, 'meta-icon'));
    const rp = r.project_id ? projectById(r.project_id) : null;
    if (rp) {
      const pj = document.createElement('span');
      pj.className = 'project-label';
      pj.textContent = rp.name;
      if (rp.color) pj.style.color = rp.color;
      meta.appendChild(pj);
    }
    const info = document.createElement('span');
    info.textContent = routineLabel(r);
    meta.appendChild(info);
    body.appendChild(meta);
    body.addEventListener('click', () => openRoutineDialog(r));
    li.appendChild(body);
    list.appendChild(li);
  }
}

function renderProjects() {
  const list = $('project-list');
  list.innerHTML = '';
  $('project-empty').classList.toggle('hidden', data.projects.length > 0);

  for (const p of data.projects) {
    const li = document.createElement('li');
    li.className = 'card';
    const body = document.createElement('div');
    body.className = 'body';
    const title = document.createElement('div');
    title.className = 'title';
    if (p.color) title.appendChild(colorDot(p.color));
    title.appendChild(document.createTextNode(p.name));
    body.appendChild(title);
    body.addEventListener('click', () => openProjectDialog(p));
    li.appendChild(body);
    list.appendChild(li);
  }
}

let editingProjectId = null;
function openProjectDialog(project) {
  editingProjectId = project ? project.id : null;
  $('project-dialog-title').textContent = project ? 'プロジェクトを編集' : 'プロジェクトを追加';
  $('project-name').value = project ? project.name : '';
  setColorChoice('project-color', project && project.color ? project.color : '#ff3b30');
  $('btn-project-delete').classList.toggle('hidden', !project);
  $('project-dialog').showModal();
}

// 実行中タスクの経過分を毎秒更新（再取得はしない）
function startTicker() {
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    document.querySelectorAll('[data-doing-start]').forEach((el) => {
      el.textContent = doingText(el.dataset.doingStart, el.dataset.planned || '');
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
  for (const v of ['today', 'inbox', 'summary', 'settings']) {
    $(`view-${v}`).classList.toggle('hidden', v !== name);
  }
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === name);
  });
}

// ---- 実績サマリー ----
function renderSummary() {
  $('sum-date-display').textContent = dateLabel(currentDate);
  const wrap = $('summary-content');
  wrap.innerHTML = '';
  const tasks = data.tasks;
  $('summary-empty').classList.toggle('hidden', tasks.length > 0);
  if (!tasks.length) return;

  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const rate = Math.round((doneCount / tasks.length) * 100);

  // プロジェクト別の実績分数（実行中は経過分を含める）
  let actualTotal = 0;
  let plannedTotal = 0;
  const byProject = new Map();
  for (const t of tasks) {
    if (t.planned_minutes) plannedTotal += Number(t.planned_minutes) || 0;
    let mins = 0;
    if (t.actual_start && t.actual_end) mins = minutesBetween(t.actual_start, t.actual_end);
    else if (t.status === 'doing' && t.actual_start) mins = minutesBetween(t.actual_start, nowIsoLocal());
    if (!mins) continue;
    actualTotal += mins;
    const key = t.project_id && projectById(t.project_id) ? t.project_id : '';
    byProject.set(key, (byProject.get(key) || 0) + mins);
  }

  // 統計
  const stats = document.createElement('div');
  stats.className = 'summary-stats';
  stats.appendChild(statTile(`${doneCount}/${tasks.length}件`, '完了'));
  stats.appendChild(statTile(fmtMinutes(actualTotal), '実績合計'));
  stats.appendChild(statTile(plannedTotal ? fmtMinutes(plannedTotal) : '—', '見積合計'));
  wrap.appendChild(stats);

  if (!actualTotal) {
    const hint = document.createElement('p');
    hint.className = 'empty';
    hint.textContent = '実績が記録されるとプロジェクト別のグラフが表示されます。';
    wrap.appendChild(hint);
    return;
  }

  const segs = [...byProject.entries()]
    .map(([pid, mins]) => {
      const p = pid ? projectById(pid) : null;
      return {
        name: p ? p.name : 'プロジェクトなし',
        color: p && p.color ? p.color : '',
        mins
      };
    })
    .sort((a, b) => b.mins - a.mins);

  wrap.appendChild(renderDonut(segs, actualTotal, rate));

  const legend = document.createElement('ul');
  legend.className = 'legend';
  for (const s of segs) {
    const li = document.createElement('li');
    li.className = 'legend-item';
    const dot = document.createElement('span');
    dot.className = 'color-dot';
    if (s.color) dot.style.background = s.color;
    else dot.style.background = 'var(--ring)';
    li.appendChild(dot);
    const name = document.createElement('span');
    name.className = 'legend-name';
    name.textContent = s.name;
    li.appendChild(name);
    const val = document.createElement('span');
    val.className = 'legend-value';
    val.textContent = `${fmtMinutes(s.mins)}・${Math.round((s.mins / actualTotal) * 100)}%`;
    li.appendChild(val);
    legend.appendChild(li);
  }
  wrap.appendChild(legend);
}

function statTile(value, label) {
  const el = document.createElement('div');
  el.className = 'stat';
  const v = document.createElement('span');
  v.className = 'stat-value';
  v.textContent = value;
  const l = document.createElement('span');
  l.className = 'stat-label';
  l.textContent = label;
  el.appendChild(v);
  el.appendChild(l);
  return el;
}

// プロジェクト別ドーナツグラフ（中央は達成率）。セグメント間は2pxの隙間で区切る
function renderDonut(segs, total, rate) {
  const size = 210;
  const c = size / 2;
  const r = 82;
  const sw = 26;
  const circ = 2 * Math.PI * r;
  const gap = segs.length > 1 ? 3 : 0;

  const wrapEl = document.createElement('div');
  wrapEl.className = 'donut-wrap';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', `rotate(-90 ${c} ${c})`);
  let acc = 0;
  for (const s of segs) {
    const len = (s.mins / total) * circ;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', c);
    circle.setAttribute('cy', c);
    circle.setAttribute('r', r);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke-width', sw);
    circle.setAttribute('stroke-dasharray', `${Math.max(len - gap, 1)} ${circ}`);
    circle.setAttribute('stroke-dashoffset', String(-(acc + gap / 2)));
    circle.setAttribute('stroke-linecap', 'butt');
    if (s.color) circle.setAttribute('stroke', s.color);
    else circle.style.stroke = 'var(--ring)';
    g.appendChild(circle);
    acc += len;
  }
  svg.appendChild(g);
  wrapEl.appendChild(svg);

  const center = document.createElement('div');
  center.className = 'donut-center';
  const num = document.createElement('span');
  num.className = 'donut-rate';
  num.textContent = `${rate}%`;
  const lbl = document.createElement('span');
  lbl.className = 'donut-label';
  lbl.textContent = '達成率';
  center.appendChild(lbl);
  center.appendChild(num);
  wrapEl.appendChild(center);
  return wrapEl;
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
  fillProjectSelect($('task-project'), task ? task.project_id : '');
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
  fillProjectSelect($('schedule-project'), '');
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
  fillProjectSelect($('routine-project'), routine ? routine.project_id : '');
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
      project_id: $('task-project').value
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
      planned_minutes: $('schedule-minutes').value,
      project_id: $('schedule-project').value
    });
  });
  $('btn-schedule-cancel').addEventListener('click', () => $('schedule-dialog').close());

  $('btn-sum-prev').addEventListener('click', () => { currentDate = shiftDate(currentDate, -1); reload(); });
  $('btn-sum-next').addEventListener('click', () => { currentDate = shiftDate(currentDate, 1); reload(); });
  $('btn-sum-today').addEventListener('click', () => { currentDate = todayStr(); reload(); });

  $('btn-add-project').addEventListener('click', () => openProjectDialog(null));
  $('project-form').addEventListener('submit', (e) => {
    e.preventDefault();
    $('project-dialog').close();
    const fields = {
      name: $('project-name').value.trim(),
      color: getColorChoice('project-color')
    };
    if (!fields.name) return;
    if (editingProjectId) {
      mutate('projectUpdate', { id: editingProjectId, ...fields });
    } else {
      mutate('projectAdd', fields);
    }
  });
  $('btn-project-cancel').addEventListener('click', () => $('project-dialog').close());
  $('btn-project-delete').addEventListener('click', () => {
    if (!confirm('このプロジェクトを削除しますか？（タスクは残り、プロジェクトなしになります）')) return;
    $('project-dialog').close();
    mutate('projectDelete', { id: editingProjectId });
  });

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
      project_id: $('routine-project').value
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

// ══════════════════════════════════════════════════════════════
//  タスク管理カレンダー  app.js
//  日/週/月/年ビュー ＋ 種別フィルタ ＋ タグ ＋ ダッシュボード
//  ＋ 繰り返し（プリセット設定UI＋展開・1日ずつ完了管理）
// ══════════════════════════════════════════════════════════════

// ── データ：タスク ───────────────────────────────────────────
const STORAGE_KEY = 'taskapp_v1';
function loadTasks() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  saveTasksToSheets(tasks); // バックグラウンドでSheets同期（未ログイン時は無視）
}
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ── データ：タグマスタ ───────────────────────────────────────
const TAGS_KEY = 'taskapp_tags_v1';
const DEFAULT_TAGS = [
  { id: 'kaikei',  name: '会計',   color: '#4f6ef7' },
  { id: 'zeimu',   name: '税務',   color: '#9333ea' },
  { id: 'hasshin', name: '発信',   color: '#e11d48' },
  { id: 'gakushu', name: '学習',   color: '#0891b2' },
  { id: 'kaji',    name: '家事',   color: '#ea580c' },
  { id: 'shumi',   name: '趣味',   color: '#16a34a' },
  { id: 'sonota',  name: 'その他', color: '#64748b' },
];
// 新規タグに自動で割り当てる色
const PALETTE = ['#4f6ef7','#9333ea','#e11d48','#0891b2','#ea580c','#16a34a','#64748b','#d946ef','#0d9488','#f59e0b','#2563eb','#db2777'];
function loadTags() {
  try {
    const s = JSON.parse(localStorage.getItem(TAGS_KEY));
    return Array.isArray(s) && s.length ? s : DEFAULT_TAGS.slice();
  } catch { return DEFAULT_TAGS.slice(); }
}
function saveTags() {
  localStorage.setItem(TAGS_KEY, JSON.stringify(tagsMaster));
  saveTagsToSheets(tagsMaster); // バックグラウンドでSheets同期
}
function findTag(id) { return tagsMaster.find(t => t.id === id); }

// ── 状態 ────────────────────────────────────────────────────
let tasks = loadTasks();
let tagsMaster = loadTags();
let period = 'day';          // 'day' | 'week' | 'month' | 'year'（起動時はダッシュボード）
let typeFilter = 'all';      // 'all' | 'spot' | 'reg'
let tagFilter = [];          // 選択中タグIDの配列（空＝すべて）
let currentDate = new Date();
let editingId = null;
let dayPanelDate = null;
let modalTags = [];          // モーダル編集中のタグ選択

// ── 定数・ヘルパー ───────────────────────────────────────────
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayStr() { return toDateStr(new Date()); }
function parseDate(s) { return new Date(s + 'T00:00:00'); }
function getWeekDays(base) {
  const d = new Date(base);
  d.setDate(d.getDate() - d.getDay());
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return x; });
}
function formatDate(dateStr) {
  const d = parseDate(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
}
function byTime(a, b) {
  if (!a.time && !b.time) return 0;
  if (!a.time) return 1;
  if (!b.time) return -1;
  return a.time.localeCompare(b.time);
}
// 代表タグ（先頭）の色。タグなしは灰色
function tagColor(t) {
  if (t.tags && t.tags.length) { const g = findTag(t.tags[0]); if (g) return g.color; }
  return '#9aa3b2';
}
// 種別・タグの絞り込みを適用
function applyFilters(arr) {
  return arr.filter(t => {
    if (typeFilter === 'reg' && !t.repeat) return false;   // 定期＝繰り返しあり
    if (typeFilter === 'spot' && t.repeat) return false;   // スポット＝繰り返しなし
    if (tagFilter.length && !(t.tags && t.tags.some(id => tagFilter.includes(id)))) return false;
    return true;
  });
}

// ── 繰り返し：展開ロジック ───────────────────────────────────
function startOfWeek(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }
function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function isLastDayOfMonth(d) { return d.getDate() === daysInMonth(d); }
function matchNthWeekday(d, nth, wd) {
  if (d.getDay() !== wd) return false;
  if (nth === 'last') return d.getDate() + 7 > daysInMonth(d);
  return Math.ceil(d.getDate() / 7) === nth;
}
function dayDiff(a, b) { return Math.round((a - b) / 86400000); }

// その繰り返しタスクが指定日に発生するか
function occursOn(t, ds) {
  const rep = t.repeat;
  if (!rep) return false;
  const start = rep.start || t.date;
  if (ds < start) return false;
  const d = parseDate(ds), s = parseDate(start);
  if (rep.unit === 'day') {
    return dayDiff(d, s) % rep.interval === 0;
  }
  if (rep.unit === 'week') {
    const wds = (rep.weekdays && rep.weekdays.length) ? rep.weekdays : [s.getDay()];
    if (!wds.includes(d.getDay())) return false;
    const wdiff = Math.round((startOfWeek(d) - startOfWeek(s)) / (7 * 86400000));
    return wdiff % rep.interval === 0;
  }
  if (rep.unit === 'month') {
    const mdiff = (d.getFullYear() - s.getFullYear()) * 12 + (d.getMonth() - s.getMonth());
    if (mdiff < 0 || mdiff % rep.interval !== 0) return false;
    if (rep.monthMode === 'lastday') return isLastDayOfMonth(d);
    if (rep.monthMode === 'weekday') return matchNthWeekday(d, rep.monthWeek, rep.monthWeekday);
    return d.getDate() === (rep.monthDate || s.getDate());
  }
  if (rep.unit === 'year') {
    const ydiff = d.getFullYear() - s.getFullYear();
    if (ydiff < 0 || ydiff % rep.interval !== 0) return false;
    const tm = rep.yearMonth || (s.getMonth() + 1), td = rep.monthDate || s.getDate();
    return (d.getMonth() + 1) === tm && d.getDate() === td;
  }
  return false;
}

// 繰り返しの頻度ラベル（グレーバッジに表示）
function repeatLabel(rep) {
  if (!rep) return '';
  if (rep.unit === 'day') return rep.interval === 1 ? '毎日' : `${rep.interval}日毎`;
  if (rep.unit === 'week') {
    const days = (rep.weekdays || []).slice().sort().map(w => WEEKDAYS[w]).join('・');
    if (rep.interval === 2) return days ? `隔週${days}` : '隔週';
    if (rep.interval === 1) return days ? `毎週${days}` : '毎週';
    return `${rep.interval}週毎${days}`;
  }
  if (rep.unit === 'month') {
    const base = rep.interval === 1 ? '毎月' : rep.interval === 3 ? '四半期' : rep.interval === 6 ? '半年' : `${rep.interval}ヶ月毎`;
    if (rep.monthMode === 'lastday') return base === '毎月' ? '毎月末' : base + '末';
    if (rep.monthMode === 'weekday') return base + (rep.monthWeek === 'last' ? '最終' : `第${rep.monthWeek}`) + WEEKDAYS[rep.monthWeekday];
    return base + `${rep.monthDate || ''}日`;
  }
  if (rep.unit === 'year') return rep.interval === 1 ? `毎年${rep.yearMonth}/${rep.monthDate}` : `${rep.interval}年毎`;
  return '繰り返し';
}

// プリセット名 → repeat構造を組み立てる（開始日＝そのタスクの日付）
function buildRepeat(preset, dateStr) {
  if (!preset || preset === 'none' || !dateStr) return null;
  const d = parseDate(dateStr);
  const wd = d.getDay();           // 曜日
  const dom = d.getDate();         // 日（◯日）
  const mon = d.getMonth() + 1;    // 月（◯月）
  switch (preset) {
    case 'daily':     return { unit: 'day',  interval: 1, start: dateStr };
    case 'weekly':    return { unit: 'week', interval: 1, weekdays: [wd], start: dateStr };
    case 'biweekly':  return { unit: 'week', interval: 2, weekdays: [wd], start: dateStr };
    case 'monthly':   return { unit: 'month', interval: 1, monthMode: 'date', monthDate: dom, start: dateStr };
    case 'lastday':   return { unit: 'month', interval: 1, monthMode: 'lastday', start: dateStr };
    case 'monthly-weekday': {
      // 第◯曜日：サブ選択欄（第何週・曜日）から組み立てる
      const wk = document.getElementById('repeat-week').value;
      const wd = parseInt(document.getElementById('repeat-weekday').value, 10);
      return { unit: 'month', interval: 1, monthMode: 'weekday',
        monthWeek: wk === 'last' ? 'last' : parseInt(wk, 10), monthWeekday: wd, start: dateStr };
    }
    case 'quarterly': return { unit: 'month', interval: 3, monthMode: 'date', monthDate: dom, start: dateStr };
    case 'halfyear':  return { unit: 'month', interval: 6, monthMode: 'date', monthDate: dom, start: dateStr };
    case 'yearly':    return { unit: 'year', interval: 1, yearMonth: mon, monthDate: dom, start: dateStr };
    default: return null;
  }
}

// repeat構造 → プリセット名の逆引き（モーダルのselect復元用）
function repeatPreset(rep) {
  if (!rep) return 'none';
  if (rep.unit === 'day'  && rep.interval === 1) return 'daily';
  if (rep.unit === 'week' && rep.interval === 1) return 'weekly';
  if (rep.unit === 'week' && rep.interval === 2) return 'biweekly';
  if (rep.unit === 'month') {
    if (rep.monthMode === 'lastday' && rep.interval === 1) return 'lastday';
    if (rep.monthMode === 'weekday' && rep.interval === 1) return 'monthly-weekday';
    if (rep.interval === 1) return 'monthly';
    if (rep.interval === 3) return 'quarterly';
    if (rep.interval === 6) return 'halfyear';
  }
  if (rep.unit === 'year' && rep.interval === 1) return 'yearly';
  return 'none';
}

// 開始日以降、次のN回の発生日（YYYY-MM-DD）を返す
function nextOccurrences(rep, count) {
  if (!rep) return [];
  const out = [];
  const d = parseDate(rep.start);
  const dummy = { repeat: rep };
  for (let i = 0; i < 366 * 6 && out.length < count; i++) {
    const ds = toDateStr(d);
    if (occursOn(dummy, ds)) out.push(ds);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// beforeDs より前で最も近い発生日（YYYY-MM-DD）。開始日より前に無ければ null
function prevOccurrence(t, beforeDs) {
  const rep = t.repeat;
  if (!rep) return null;
  const start = rep.start || t.date;
  const d = parseDate(beforeDs);
  d.setDate(d.getDate() - 1); // 前日から遡る
  for (let i = 0; i < 366 * 6; i++) {
    const ds = toDateStr(d);
    if (ds < start) return null;   // 開始日より前は発生しない
    if (occursOn(t, ds)) return ds;
    d.setDate(d.getDate() - 1);
  }
  return null;
}

// 「第◯曜日」のサブ欄の表示/非表示を、選択中プリセットに合わせる
function syncRepeatControls() {
  const show = document.getElementById('task-repeat').value === 'monthly-weekday';
  document.getElementById('repeat-weekday-row').style.display = show ? 'flex' : 'none';
}
// サブ欄（第何週・曜日）をその日付の値で初期化
function initWeekdayControlsFromDate() {
  const dateStr = document.getElementById('task-date').value;
  if (!dateStr) return;
  const d = parseDate(dateStr);
  const nth = Math.ceil(d.getDate() / 7);
  document.getElementById('repeat-week').value = nth > 4 ? 'last' : String(nth);
  document.getElementById('repeat-weekday').value = String(d.getDay());
}
// 繰り返しプルダウンを変えた時：第◯曜日なら日付から初期化＋サブ欄表示
function onRepeatChange() {
  if (document.getElementById('task-repeat').value === 'monthly-weekday') initWeekdayControlsFromDate();
  syncRepeatControls();
  updateRepeatPreview();
}

// モーダルの繰り返しプレビューを更新
function updateRepeatPreview() {
  const box = document.getElementById('repeat-preview');
  const preset = document.getElementById('task-repeat').value;
  const dateStr = document.getElementById('task-date').value;
  const rep = buildRepeat(preset, dateStr);
  if (!rep) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const occ = nextOccurrences(rep, 3);
  if (!occ.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const labels = occ.map(ds => {
    const d = parseDate(ds);
    return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
  });
  box.innerHTML = `<span class="rp-label">${esc(repeatLabel(rep))}</span>次回：${labels.join('、')} …`;
  box.style.display = 'block';
}

// 指定日のタスク一覧（スポットはその日付、定期は展開して返す）
function tasksOnDate(ds) {
  const out = [];
  tasks.forEach(t => {
    if (t.repeat) { if (occursOn(t, ds)) out.push(expandOcc(t, ds)); }
    else if (t.date === ds) out.push(t);
  });
  return out;
}
// 繰り返しの1回分を表示用オブジェクトに展開
function expandOcc(t, ds) {
  return { ...t, date: ds, _occ: true, done: (t.doneDates || []).includes(ds), repeatLabel: repeatLabel(t.repeat) };
}

// 今日基準の週・月の範囲判定
function inThisWeek(ds) {
  const days = getWeekDays(new Date());
  return ds >= toDateStr(days[0]) && ds <= toDateStr(days[6]);
}
function inThisMonth(ds) {
  const now = new Date();
  return ds.startsWith(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
}

// ── 全体描画 ─────────────────────────────────────────────────
function renderCalendar() {
  renderHeader();
  syncPeriodUI();
  renderTypeBar();
  renderTagBar();
  const cal = document.getElementById('calendar');
  cal.innerHTML = '';
  if (period === 'day') renderDay();
  else if (period === 'week') renderWeek();
  else if (period === 'month') renderMonth();
  else renderYear();
}

function renderHeader() {
  const titleEl = document.getElementById('header-title');
  const d = currentDate;
  if (period === 'day') {
    titleEl.textContent = `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
  } else if (period === 'week') {
    const days = getWeekDays(d);
    titleEl.textContent = `${days[0].getMonth() + 1}/${days[0].getDate()} 〜 ${days[6].getMonth() + 1}/${days[6].getDate()}`;
  } else if (period === 'month') {
    titleEl.textContent = `${d.getFullYear()}年 ${d.getMonth() + 1}月`;
  } else {
    titleEl.textContent = `${d.getFullYear()}年`;
  }
  // 曜日ラベルは月ビューのみ
  const labels = document.getElementById('weekday-labels');
  if (period === 'month') {
    labels.style.display = 'grid';
    labels.innerHTML = '';
    WEEKDAYS.forEach((w, i) => {
      const e = el('div', 'weekday-label' + (i === 0 ? ' sun' : i === 6 ? ' sat' : ''));
      e.textContent = w;
      labels.appendChild(e);
    });
  } else {
    labels.style.display = 'none';
    labels.innerHTML = '';
  }
}

function syncPeriodUI() {
  document.querySelectorAll('#period-bar .period-btn')
    .forEach(b => b.classList.toggle('on', b.dataset.period === period));
}
function renderTypeBar() {
  document.querySelectorAll('#type-bar .type-btn')
    .forEach(b => b.classList.toggle('on', b.dataset.type === typeFilter));
}
function renderTagBar() {
  const bar = document.getElementById('tag-bar');
  bar.innerHTML = '';
  const all = el('button', 'tag-btn' + (tagFilter.length === 0 ? ' on' : ''));
  all.textContent = 'すべて';
  if (tagFilter.length === 0) { all.style.background = 'var(--text)'; all.style.borderColor = 'var(--text)'; }
  all.onclick = () => { tagFilter = []; renderCalendar(); };
  bar.appendChild(all);
  tagsMaster.forEach(g => {
    const on = tagFilter.includes(g.id);
    const b = el('button', 'tag-btn' + (on ? ' on' : ''));
    if (on) { b.style.background = g.color; b.style.borderColor = g.color; b.textContent = g.name; }
    else { b.innerHTML = `<span class="sw" style="background:${g.color}"></span>${esc(g.name)}`; }
    b.onclick = () => {
      const i = tagFilter.indexOf(g.id);
      if (i >= 0) tagFilter.splice(i, 1); else tagFilter.push(g.id);
      renderCalendar();
    };
    bar.appendChild(b);
  });
}

// ── 日ビュー（ダッシュボード）────────────────────────────────
function renderDay() {
  const cal = document.getElementById('calendar');
  cal.className = 'dash';
  const viewDate = toDateStr(currentDate);
  const today = todayStr();

  // サマリーカード（実際の今日を基準にした指標）
  const todayActive = tasks.filter(t => !t.repeat && t.date === today && !t.done).length;
  // 期限切れ：スポット（過去日・未完了）＋定期（直近の過去回が未完了）
  const overdueSpot = tasks.filter(t => !t.repeat && t.date < today && !t.done);
  const overdueRepeat = [];
  tasks.forEach(t => {
    if (!t.repeat) return;
    const prev = prevOccurrence(t, today);
    if (prev && !(t.doneDates || []).includes(prev)) overdueRepeat.push(expandOcc(t, prev));
  });
  const overdueAll = [...overdueSpot, ...overdueRepeat];
  const weekDone = tasks.filter(t => !t.repeat && t.done && inThisWeek(t.date)).length;
  const monthDone = tasks.filter(t => !t.repeat && t.done && inThisMonth(t.date)).length;

  const cards = el('div', 'dash-cards');
  cards.innerHTML =
    `<div class="dash-card"><div class="lbl">今日</div><div class="num">${todayActive}<small> 件</small></div></div>` +
    `<div class="dash-card danger${overdueAll.length ? ' clickable' : ''}" data-action="overdue"><div class="lbl">期限切れ</div><div class="num">${overdueAll.length}<small> 件</small></div></div>` +
    `<div class="dash-card ok"><div class="lbl">今週完了</div><div class="num">${weekDone}<small> 件</small></div></div>` +
    `<div class="dash-card ok"><div class="lbl">今月完了</div><div class="num">${monthDone}<small> 件</small></div></div>`;
  // 期限切れカードのクリック：一覧にスクロール
  cards.querySelector('[data-action="overdue"]').addEventListener('click', () => {
    if (overdueAll.length === 0) return;
    const box = cal.querySelector('.overdue-box');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  cal.appendChild(cards);

  // 期限切れ（フィルタ適用）
  const overdue = applyFilters(overdueAll).sort((a, b) => a.date.localeCompare(b.date));
  if (overdue.length) {
    const box = el('div', 'overdue-box');
    const ttl = el('div', 'ttl');
    ttl.textContent = `⚠ 期限切れ・やり残し ${overdue.length}件`;
    box.appendChild(ttl);
    overdue.forEach(t => {
      const row = makeTaskRow(t);
      // 行末に日付バッジ（期限切れの日付）
      const dateBadge = el('span', 'task-date-end');
      dateBadge.textContent = t.date.slice(5).replace('-', '/');
      row.appendChild(dateBadge);
      box.appendChild(row);
    });
    cal.appendChild(box);
  }

  // 対象日のタスク
  const list = applyFilters(tasksOnDate(viewDate)).sort(byTime);
  const sec = el('div', 'sec-title');
  const heading = viewDate === today ? '今日のタスク' : `${currentDate.getMonth() + 1}月${currentDate.getDate()}日のタスク`;
  sec.innerHTML = `<span>${heading}</span><small>${list.filter(t => t.done).length}/${list.length} 完了</small>`;
  cal.appendChild(sec);

  const lw = el('div', 'dash-list');
  if (list.length) list.forEach(t => lw.appendChild(makeTaskRow(t)));
  else lw.innerHTML = '<div class="panel-empty">タスクはありません</div>';
  cal.appendChild(lw);
}

// ── 週ビュー ─────────────────────────────────────────────────
function renderWeek() {
  const cal = document.getElementById('calendar');
  cal.className = 'week-list';
  const days = getWeekDays(currentDate);
  const today = todayStr();

  days.forEach((date, i) => {
    const dateStr = toDateStr(date);
    const dayTasks = applyFilters(tasksOnDate(dateStr)).sort(byTime);

    const section = el('div', 'week-day-section' + (dateStr === today ? ' today' : ''));
    const header = el('div', 'week-day-header');
    const label = el('span', 'week-day-label' + (i === 0 ? ' sun' : i === 6 ? ' sat' : ''));
    label.textContent = `${date.getMonth() + 1}/${date.getDate()}（${WEEKDAYS[i]}）`;
    header.appendChild(label);
    const addBtn = el('button', 'week-add-btn');
    addBtn.textContent = '＋';
    addBtn.onclick = e => { e.stopPropagation(); openModal(null, dateStr); };
    header.appendChild(addBtn);
    section.appendChild(header);

    if (dayTasks.length === 0) {
      const empty = el('div', 'week-empty');
      empty.textContent = 'タスクなし';
      section.appendChild(empty);
    } else {
      dayTasks.forEach(t => section.appendChild(makeTaskRow(t)));
    }
    cal.appendChild(section);
  });
}

// ── 月ビュー ─────────────────────────────────────────────────
function renderMonth() {
  const cal = document.getElementById('calendar');
  cal.className = 'month-grid';
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayStr();

  for (let i = 0; i < firstDow; i++) cal.appendChild(el('div', 'day-cell empty'));

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = new Date(year, month, d).getDay();
    const dayTasks = applyFilters(tasksOnDate(dateStr)).sort(byTime);

    const cell = el('div', 'day-cell'
      + (dateStr === today ? ' today' : '')
      + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''));
    const numEl = el('div', 'day-num');
    numEl.textContent = d;
    cell.appendChild(numEl);

    dayTasks.slice(0, 3).forEach(t => {
      const chip = el('div', 'task-chip' + (t.done ? ' done' : ''));
      chip.style.borderLeftColor = tagColor(t);
      chip.textContent = t.time ? `${t.time} ${t.title}` : t.title;
      cell.appendChild(chip);
    });
    if (dayTasks.length > 3) {
      const more = el('div', 'task-chip more');
      more.textContent = `他 ${dayTasks.length - 3} 件`;
      cell.appendChild(more);
    }

    cell.onclick = () => openDayPanel(dateStr);
    cal.appendChild(cell);
  }
}

// ── 年ビュー（月別の件数バー）────────────────────────────────
function renderYear() {
  const cal = document.getElementById('calendar');
  cal.className = 'year-wrap';
  const year = currentDate.getFullYear();
  const now = new Date();

  const months = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0');
    const inMonth = applyFilters(tasks.filter(t => !t.repeat && t.date.startsWith(`${year}-${m}`)));
    return { m: i + 1, total: inMonth.length, done: inMonth.filter(t => t.done).length };
  });
  const max = Math.max(1, ...months.map(x => x.total));
  const totalT = months.reduce((s, x) => s + x.total, 0);
  const totalD = months.reduce((s, x) => s + x.done, 0);

  let h = `<div class="year-head"><span>${year}年</span><small>完了 ${totalD} / 登録 ${totalT} 件</small></div>`;
  months.forEach(x => {
    const w = x.total ? Math.round(x.total / max * 100) : 0;
    const fw = x.total ? Math.round(x.done / x.total * w) : 0;
    const cur = (x.m === now.getMonth() + 1 && year === now.getFullYear()) ? ' cur' : '';
    h += `<div class="ybar${cur}"><span class="mo">${x.m}月</span><div class="track"><div class="fill" style="width:${fw}%"></div></div><span class="cnt">${x.done}/${x.total}</span></div>`;
  });
  h += `<div class="year-note">バーは登録件数、塗りは完了分。月をタップでその月へ</div>`;
  cal.innerHTML = h;

  cal.querySelectorAll('.ybar').forEach((b, i) => {
    b.onclick = () => { currentDate = new Date(year, i, 1); period = 'month'; renderCalendar(); };
  });
}

// ── タスク行の生成（共通）────────────────────────────────────
function makeTaskRow(task) {
  const row = el('div', 'task-row' + (task.done ? ' done' : ''));

  const check = el('button', 'check-btn' + (task.done ? ' checked' : ''));
  check.innerHTML = task.done ? '✓' : '';
  check.onclick = e => { e.stopPropagation(); toggleDone(task.id, task.date); };

  const info = el('div', 'task-info');
  const title = el('div', 'task-title-text');
  title.textContent = task.title;
  info.appendChild(title);
  if (task.memo) {
    const m = el('div', 'task-memo-text');
    m.textContent = task.memo;
    info.appendChild(m);
  }

  row.appendChild(check);
  row.appendChild(info);

  // タグバッジ（色つき・長方形）
  if (task.tags && task.tags.length) {
    const tg = el('div', 'task-tags');
    task.tags.forEach(id => {
      const g = findTag(id);
      if (g) {
        const b = el('span', 'task-tag');
        b.textContent = g.name;
        b.style.background = g.color + '22';
        b.style.color = g.color;
        tg.appendChild(b);
      }
    });
    row.appendChild(tg);
  }
  // 頻度バッジ（定期の目印・グレー。繰り返し実装後に表示）
  if (task.repeatLabel) {
    const bd = el('span', 'task-badge');
    bd.textContent = task.repeatLabel;
    row.appendChild(bd);
  }
  // 時刻（行末）
  if (task.time) {
    const tm = el('span', 'task-time-end');
    tm.textContent = task.time;
    row.appendChild(tm);
  }

  row.onclick = () => openModal(task.id);
  return row;
}

// ── デイパネル ───────────────────────────────────────────────
function openDayPanel(dateStr) {
  dayPanelDate = dateStr;
  document.getElementById('day-panel-date').textContent = formatDate(dateStr);
  renderDayPanelTasks();
  const panel = document.getElementById('day-panel');
  panel.style.display = 'flex';
  requestAnimationFrame(() => panel.classList.add('open'));
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('show');
  overlay.onclick = () => { closeDayPanel(); overlay.onclick = null; };
}
function renderDayPanelTasks() {
  const container = document.getElementById('day-panel-tasks');
  container.innerHTML = '';
  const dayTasks = applyFilters(tasksOnDate(dayPanelDate))
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return byTime(a, b);
    });
  if (dayTasks.length === 0) {
    container.innerHTML = '<div class="panel-empty">タスクはありません<br><span style="font-size:13px">「＋ 追加」から登録できます</span></div>';
    return;
  }
  dayTasks.forEach(t => container.appendChild(makeTaskRow(t)));
}
function closeDayPanel() {
  const panel = document.getElementById('day-panel');
  panel.classList.remove('open');
  panel.addEventListener('transitionend', () => {
    panel.style.display = '';
    dayPanelDate = null;
  }, { once: true });
  closeOverlay();
}

// ── モーダル ─────────────────────────────────────────────────
function openModal(taskId = null, prefillDate = null) {
  editingId = taskId;
  const modal = document.getElementById('modal');
  const overlay = document.getElementById('modal-overlay');
  const titleText = document.getElementById('modal-title-text');
  const editOnly = document.getElementById('edit-only');
  const titleInput = document.getElementById('task-title');
  titleInput.classList.remove('error');

  if (taskId) {
    const t = tasks.find(x => x.id === taskId);
    if (!t) return;
    titleInput.value = t.title;
    document.getElementById('task-date').value = t.date;
    document.getElementById('task-time').value = t.time || '';
    document.getElementById('task-remind').value = t.remind || 'none';
    document.getElementById('task-memo').value = t.memo || '';
    document.getElementById('task-done').checked = t.done;
    document.getElementById('task-repeat').value = repeatPreset(t.repeat);
    if (t.repeat && t.repeat.monthMode === 'weekday') {
      document.getElementById('repeat-week').value = String(t.repeat.monthWeek);
      document.getElementById('repeat-weekday').value = String(t.repeat.monthWeekday);
    }
    modalTags = (t.tags || []).slice();
    titleText.textContent = 'タスクを編集';
    editOnly.style.display = 'flex';
  } else {
    titleInput.value = '';
    document.getElementById('task-date').value = prefillDate || toDateStr(currentDate);
    document.getElementById('task-time').value = '';
    document.getElementById('task-remind').value = 'none';
    document.getElementById('task-memo').value = '';
    document.getElementById('task-repeat').value = 'none';
    modalTags = [];
    titleText.textContent = 'タスクを追加';
    editOnly.style.display = 'none';
  }
  renderTagPicker();
  syncRepeatControls();
  updateRepeatPreview();

  overlay.onclick = () => closeModal();
  overlay.classList.add('show');
  modal.style.display = 'flex';
  modal.style.flexDirection = 'column';
  requestAnimationFrame(() => modal.classList.add('open'));
  setTimeout(() => titleInput.focus(), 300);
}

// モーダル内のタグ選択チップ
function renderTagPicker() {
  const p = document.getElementById('tag-picker');
  p.innerHTML = '';
  tagsMaster.forEach(g => {
    const on = modalTags.includes(g.id);
    const b = el('button', 'pick-tag' + (on ? ' on' : ''));
    b.type = 'button';
    b.textContent = g.name;
    if (on) b.style.background = g.color;
    b.onclick = () => {
      const i = modalTags.indexOf(g.id);
      if (i >= 0) modalTags.splice(i, 1); else modalTags.push(g.id);
      renderTagPicker();
    };
    p.appendChild(b);
  });
  const nb = el('button', 'pick-new');
  nb.type = 'button';
  nb.textContent = '＋ 新規';
  nb.onclick = addNewTag;
  p.appendChild(nb);
}
function addNewTag() {
  const name = prompt('新しいタグの名前を入力');
  if (!name || !name.trim()) return;
  const id = 'tag_' + genId();
  const color = PALETTE[tagsMaster.length % PALETTE.length];
  tagsMaster.push({ id, name: name.trim(), color });
  saveTags();
  modalTags.push(id);
  renderTagPicker();
}

function closeModal() {
  const modal = document.getElementById('modal');
  modal.classList.remove('open');
  modal.addEventListener('transitionend', () => {
    modal.style.display = '';
    editingId = null;
    if (dayPanelDate) {
      document.getElementById('modal-overlay').onclick = () => {
        closeDayPanel();
        document.getElementById('modal-overlay').onclick = null;
      };
    } else {
      closeOverlay();
    }
  }, { once: true });
}
function closeOverlay() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('show');
  overlay.onclick = null;
}

// ── CRUD ─────────────────────────────────────────────────────
function saveTask() {
  const titleInput = document.getElementById('task-title');
  const title = titleInput.value.trim();
  if (!title) { titleInput.classList.add('error'); titleInput.focus(); return; }

  const date = document.getElementById('task-date').value;
  const time = document.getElementById('task-time').value;
  const remind = document.getElementById('task-remind').value;
  const memo = document.getElementById('task-memo').value.trim();
  const repeat = buildRepeat(document.getElementById('task-repeat').value, date);
  const now = new Date().toISOString();

  if (editingId) {
    tasks = tasks.map(t => {
      if (t.id !== editingId) return t;
      const next = { ...t, title, date, time, remind, memo, repeat,
        tags: modalTags.slice(), done: document.getElementById('task-done').checked, updated_at: now };
      // 定期なら完了日リストを保持／新規に定期化したら初期化、スポット化したら削除
      if (repeat) next.doneDates = t.doneDates || [];
      else delete next.doneDates;
      return next;
    });
  } else {
    const task = { id: genId(), title, date, time, remind, memo, repeat,
      tags: modalTags.slice(), done: false, created_at: now, updated_at: now };
    if (repeat) task.doneDates = [];
    tasks.push(task);
  }
  saveTasks();
  closeModal();
  renderCalendar();
  if (dayPanelDate) renderDayPanelTasks();
}
function deleteTask() {
  if (!editingId || !confirm('このタスクを削除しますか？')) return;
  tasks = tasks.filter(t => t.id !== editingId);
  saveTasks();
  closeModal();
  renderCalendar();
  if (dayPanelDate) renderDayPanelTasks();
}
function toggleDone(taskId, occDate) {
  const now = new Date().toISOString();
  tasks = tasks.map(t => {
    if (t.id !== taskId) return t;
    // 繰り返しは「その日だけ」完了を切り替え（doneDatesで管理）
    if (t.repeat && occDate) {
      const dd = new Set(t.doneDates || []);
      if (dd.has(occDate)) dd.delete(occDate); else dd.add(occDate);
      return { ...t, doneDates: [...dd], updated_at: now };
    }
    return { ...t, done: !t.done, updated_at: now };
  });
  saveTasks();
  renderCalendar();
  if (dayPanelDate) renderDayPanelTasks();
}

// ── ナビゲーション・切替 ─────────────────────────────────────
function navigate(dir) {
  if (period === 'day') currentDate.setDate(currentDate.getDate() + dir);
  else if (period === 'week') currentDate.setDate(currentDate.getDate() + dir * 7);
  else if (period === 'month') currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + dir, 1);
  else currentDate.setFullYear(currentDate.getFullYear() + dir);
  renderCalendar();
}
function setPeriod(p) { period = p; renderCalendar(); }
function setType(t) { typeFilter = t; renderCalendar(); }

// ── イベントバインド ─────────────────────────────────────────
document.getElementById('btn-prev').addEventListener('click', () => navigate(-1));
document.getElementById('btn-next').addEventListener('click', () => navigate(1));
document.getElementById('btn-today').addEventListener('click', () => { currentDate = new Date(); renderCalendar(); });
document.getElementById('period-bar').addEventListener('click', e => {
  const b = e.target.closest('.period-btn'); if (b) setPeriod(b.dataset.period);
});
document.getElementById('type-bar').addEventListener('click', e => {
  const b = e.target.closest('.type-btn'); if (b) setType(b.dataset.type);
});
document.getElementById('btn-add').addEventListener('click', () => openModal());
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-save').addEventListener('click', saveTask);
document.getElementById('btn-delete').addEventListener('click', deleteTask);
document.getElementById('day-panel-close').addEventListener('click', closeDayPanel);
document.getElementById('day-panel-add').addEventListener('click', () => {
  const date = dayPanelDate;
  closeDayPanel();
  setTimeout(() => openModal(null, date), 50);
});
document.getElementById('btn-clear-time').addEventListener('click', () => {
  document.getElementById('task-time').value = '';
});
document.getElementById('task-repeat').addEventListener('change', onRepeatChange);
document.getElementById('task-date').addEventListener('change', updateRepeatPreview);
document.getElementById('repeat-week').addEventListener('change', updateRepeatPreview);
document.getElementById('repeat-weekday').addEventListener('change', updateRepeatPreview);
document.getElementById('task-title').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveTask();
});

// ── Service Worker（プッシュはSTEP3で本格利用）──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ── Google Sheets 同期 ────────────────────────────────────────
// ログイン後にSheetsからロードしてUIを更新するコールバック
async function onSheetsSignedIn(ok) {
  if (!ok) return;
  const data = await loadFromSheets();
  if (!data) return;
  if (data.tasks.length === 0 && tasks.length > 0) {
    // 初回同期：Sheetsが空でローカルにデータがある→ローカルをSheetsに上げる
    saveTasksToSheets(tasks);
  } else if (data.tasks.length > 0) {
    // Sheetsにデータあり→Sheetsを正としてローカルを上書き
    tasks = data.tasks;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }
  if (data.tags && data.tags.length) {
    tagsMaster = data.tags;
    localStorage.setItem(TAGS_KEY, JSON.stringify(tagsMaster));
  } else {
    saveTagsToSheets(tagsMaster);
  }
  renderCalendar();
}

// sync-statusボタンの動作（ログイン/ログアウト切替）
document.getElementById('sync-status').addEventListener('click', () => {
  if (sheetsState.loggedIn) {
    if (confirm('Googleからログアウトしますか？\nローカルのデータはそのまま残ります。')) {
      sheetsSignOut();
    }
  } else {
    sheetsSignIn(onSheetsSignedIn);
  }
});

// GISライブラリ読み込み完了後に初期化
window.addEventListener('load', () => {
  if (typeof google !== 'undefined') {
    initGoogleAuth(onSheetsSignedIn);
  }
  // 通知ボタンの初期化
  updatePushUI();
  document.getElementById('btn-push').addEventListener('click', () => {
    if (localStorage.getItem('pushEnabled') === 'true') {
      if (confirm('通知を無効にしますか？')) disablePushNotifications();
    } else {
      enablePushNotifications();
    }
  });
});

// ── 初期描画 ─────────────────────────────────────────────────
renderCalendar();

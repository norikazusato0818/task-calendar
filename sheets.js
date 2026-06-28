// ══════════════════════════════════════════════════════════════
//  sheets.js  Google Sheets 同期モジュール
//  タスク・タグマスタをスプレッドシートに読み書きする
// ══════════════════════════════════════════════════════════════

const SHEETS_CONFIG = {
  clientId:      '462072984987-ksngvsoem76eucea6gd1lhojvkml5gld.apps.googleusercontent.com',
  spreadsheetId: '1xgOOdm_TLlAqXU5w5QbjVf5eDxjbt-s_CoSby82wKtQ',
  scope:         'https://www.googleapis.com/auth/spreadsheets',
  taskSheet:     'タスク',
  tagSheet:      'タグ',
};

// スプレッドシートの列定義
const TASK_COLS = ['id','title','date','time','remind','memo','done','tags','repeat','doneDates','created_at','updated_at'];
const TAG_COLS  = ['id','name','color'];

let _tokenClient   = null;
let _accessToken   = null;
let _tokenExpiry   = 0;
let _pendingCb     = null; // トークン取得後に呼ぶコールバック
let _initialized   = false;

// 外部から参照する同期状態
const sheetsState = {
  loggedIn: false,
  syncing:  false,
  lastSync: null,
  error:    null,
};

// ── トークンレスポンス処理 ───────────────────────────────────
async function _handleToken(resp) {
  if (resp.error) {
    // サイレントログイン失敗は無視（ユーザー操作を待つ）
    if (resp.error !== 'access_denied' && resp.error !== 'interaction_required') {
      sheetsState.error = 'ログインエラー: ' + resp.error;
      updateSyncUI();
    }
    if (_pendingCb) { const cb = _pendingCb; _pendingCb = null; cb(false); }
    return;
  }
  _accessToken  = resp.access_token;
  _tokenExpiry  = Date.now() + (resp.expires_in - 60) * 1000;
  sheetsState.loggedIn = true;
  sheetsState.error    = null;
  localStorage.setItem('sheetsAutoLogin', 'true'); // 次回ページロード時に自動ログイン
  updateSyncUI();
  if (_pendingCb) { const cb = _pendingCb; _pendingCb = null; await cb(true); }
}

// ── GIS初期化（window.load 後に呼ぶ） ───────────────────────
function initGoogleAuth(onSignedIn) {
  if (typeof google === 'undefined') return;
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: SHEETS_CONFIG.clientId,
    scope:     SHEETS_CONFIG.scope,
    callback:  _handleToken,
  });
  _initialized = true;
  updateSyncUI(); // 前回ログイン済みなら「reconnect」状態で表示
}

// ── ログインボタンから呼ぶ ───────────────────────────────────
function sheetsSignIn(callback) {
  if (!_initialized) return;
  _pendingCb = callback;
  _tokenClient.requestAccessToken({ prompt: 'select_account' });
}

// ── ログアウト ───────────────────────────────────────────────
function sheetsSignOut() {
  if (_accessToken) google.accounts.oauth2.revoke(_accessToken, () => {});
  _accessToken = null;
  _tokenExpiry = 0;
  sheetsState.loggedIn = false;
  sheetsState.lastSync = null;
  sheetsState.error    = null;
  localStorage.removeItem('sheetsAutoLogin');
  updateSyncUI();
}

// ── トークンの有効確認・再取得 ───────────────────────────────
async function _ensureToken() {
  if (_accessToken && Date.now() < _tokenExpiry) return true;
  if (!_initialized) return false;
  return new Promise(resolve => {
    _pendingCb = ok => resolve(ok);
    try {
      _tokenClient.requestAccessToken({ prompt: '' });
      setTimeout(() => { if (_pendingCb) { _pendingCb = null; resolve(false); } }, 5000);
    } catch(e) { _pendingCb = null; resolve(false); }
  });
}

// ── Sheets API fetch ヘルパー ────────────────────────────────
async function _get(range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_CONFIG.spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${_accessToken}` } });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || res.status); }
  return res.json();
}
async function _put(range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_CONFIG.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${_accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ range, majorDimension: 'ROWS', values }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || res.status); }
  return res.json();
}
async function _clear(range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_CONFIG.spreadsheetId}/values/${encodeURIComponent(range)}:clear`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${_accessToken}` },
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || res.status); }
  return res.json();
}

// ── シート存在確認・作成・ヘッダー初期化 ──────────────────────
async function _ensureSheets() {
  // スプレッドシートのシート一覧を取得
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_CONFIG.spreadsheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (!metaRes.ok) throw new Error('スプレッドシートにアクセスできません');
  const meta = await metaRes.json();
  const existing = (meta.sheets || []).map(s => s.properties.title);

  // 不足シートを追加
  const requests = [];
  if (!existing.includes(SHEETS_CONFIG.taskSheet)) requests.push({ addSheet: { properties: { title: SHEETS_CONFIG.taskSheet } } });
  if (!existing.includes(SHEETS_CONFIG.tagSheet))  requests.push({ addSheet: { properties: { title: SHEETS_CONFIG.tagSheet  } } });
  if (requests.length) {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_CONFIG.spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${_accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });
  }

  // ヘッダー行がなければ追加
  const th = await _get(`${SHEETS_CONFIG.taskSheet}!A1`);
  if (!th.values?.[0]?.[0]) await _put(`${SHEETS_CONFIG.taskSheet}!A1`, [TASK_COLS]);
  const gh = await _get(`${SHEETS_CONFIG.tagSheet}!A1`);
  if (!gh.values?.[0]?.[0]) await _put(`${SHEETS_CONFIG.tagSheet}!A1`, [TAG_COLS]);
}

// ── Sheetsからデータを読み込む ───────────────────────────────
async function loadFromSheets() {
  if (!await _ensureToken()) return null;
  try {
    sheetsState.syncing = true; updateSyncUI();
    await _ensureSheets();

    // タスク
    const taskRes = await _get(`${SHEETS_CONFIG.taskSheet}!A:L`);
    const taskRows = (taskRes.values || []).slice(1); // 1行目ヘッダーを除く
    const tasks = taskRows.filter(r => r[0]).map(r => {
      const t = {};
      TASK_COLS.forEach((col, i) => { t[col] = r[i] !== undefined ? r[i] : ''; });
      t.done   = t.done === 'true';
      t.time   = t.time   || '';
      t.remind = t.remind || 'none';
      t.memo   = t.memo   || '';
      try { t.tags = t.tags ? JSON.parse(t.tags) : []; } catch { t.tags = []; }
      try { t.repeat = t.repeat ? JSON.parse(t.repeat) : null; } catch { t.repeat = null; }
      if (t.repeat) {
        try { t.doneDates = t.doneDates ? JSON.parse(t.doneDates) : []; } catch { t.doneDates = []; }
      } else {
        delete t.doneDates;
      }
      return t;
    });

    // タグ
    const tagRes = await _get(`${SHEETS_CONFIG.tagSheet}!A:C`);
    const tagRows = (tagRes.values || []).slice(1);
    const tags = tagRows.filter(r => r[0]).map(r => ({
      id: r[0] || '', name: r[1] || '', color: r[2] || '#64748b'
    }));

    sheetsState.syncing  = false;
    sheetsState.lastSync = new Date();
    sheetsState.error    = null;
    updateSyncUI();
    return { tasks, tags: tags.length ? tags : null };
  } catch(e) {
    sheetsState.syncing = false;
    sheetsState.error   = '読み込みエラー';
    updateSyncUI();
    console.error('loadFromSheets:', e);
    return null;
  }
}

// ── タスクをSheetsに保存（バックグラウンド） ─────────────────
async function saveTasksToSheets(tasks) {
  if (!sheetsState.loggedIn) return;
  if (!await _ensureToken()) return;
  try {
    sheetsState.syncing = true; updateSyncUI();
    const rows = tasks.map(t => TASK_COLS.map(col => {
      const v = t[col];
      if (v === undefined || v === null) return '';
      if (typeof v === 'boolean') return String(v);
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    }));
    await _clear(`${SHEETS_CONFIG.taskSheet}!A:L`);
    await _put(`${SHEETS_CONFIG.taskSheet}!A1`, [TASK_COLS, ...rows]);
    sheetsState.syncing  = false;
    sheetsState.lastSync = new Date();
    sheetsState.error    = null;
    updateSyncUI();
  } catch(e) {
    sheetsState.syncing = false;
    sheetsState.error   = '保存エラー';
    updateSyncUI();
    console.error('saveTasksToSheets:', e);
  }
}

// ── タグをSheetsに保存 ───────────────────────────────────────
async function saveTagsToSheets(tags) {
  if (!sheetsState.loggedIn) return;
  if (!await _ensureToken()) return;
  try {
    const rows = tags.map(t => [t.id, t.name, t.color]);
    await _clear(`${SHEETS_CONFIG.tagSheet}!A:C`);
    await _put(`${SHEETS_CONFIG.tagSheet}!A1`, [TAG_COLS, ...rows]);
  } catch(e) {
    console.error('saveTagsToSheets:', e);
  }
}

// ── 同期ステータスUI更新 ─────────────────────────────────────
function updateSyncUI() {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (!sheetsState.loggedIn) {
    if (localStorage.getItem('sheetsAutoLogin') === 'true') {
      el.className = 'sync-btn reconnect';
      el.title     = 'クリックして同期を再開';
    } else {
      el.className = 'sync-btn offline';
      el.title     = 'クリックしてGoogleでログイン（PC・iPhone同期）';
    }
  } else if (sheetsState.syncing) {
    el.className = 'sync-btn syncing';
    el.title     = '同期中...';
  } else if (sheetsState.error) {
    el.className = 'sync-btn has-error';
    el.title     = sheetsState.error + '（クリックで再ログイン）';
  } else {
    el.className = 'sync-btn ok';
    el.title     = `同期済み ${sheetsState.lastSync?.toLocaleTimeString('ja-JP') || ''}（クリックでログアウト）`;
  }
}

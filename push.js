// ══════════════════════════════════════════════════════════════
//  push.js  Firebase Cloud Messaging 購読モジュール
//  FCMトークン取得 → Sheetsの「購読」シートに保存
// ══════════════════════════════════════════════════════════════

const PUSH_CONFIG = {
  subSheet: '購読',
  vapidKey: 'BJxohlw-K29tVxO0jmG8I7d_becr5mXGxycqL-m87BD_KKJ3Zj7OiUfGIBHOyGW4D5NpsHvExI5P-P-h7b6Yy1Y',
};

// Firebase Messaging インスタンス（initFirebase後にセット）
let _messaging = null;

// Firebase を初期化して messaging を返す
function initFirebase() {
  if (_messaging) return _messaging;
  const app = firebase.initializeApp({
    apiKey:            'AIzaSyBf7L09bVFEpPsOY9nth0tet6FQYZgQENE',
    authDomain:        'task-calender-10990.firebaseapp.com',
    projectId:         'task-calender-10990',
    storageBucket:     'task-calender-10990.firebasestorage.app',
    messagingSenderId: '95915166506',
    appId:             '1:95915166506:web:11afad7c7f10dbc8faac53',
  });
  _messaging = firebase.messaging(app);

  // フォアグラウンドでのメッセージ受信（タブが開いているとき）
  _messaging.onMessage(payload => {
    const title = payload.notification?.title || 'タスク管理';
    const body  = payload.notification?.body  || '';
    new Notification(title, { body, icon: './icon-192.png' });
  });

  return _messaging;
}

// FCMトークンをSheetsに保存
async function saveFcmTokenToSheets(token, deviceName) {
  if (!sheetsState.loggedIn) return false;
  if (!await _ensureToken()) return false;

  const COLS = ['deviceId', 'fcmToken', 'deviceName', 'createdAt'];

  try {
    // 購読シートの存在確認・作成
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_CONFIG.spreadsheetId}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${_accessToken}` } }
    );
    const meta = await metaRes.json();
    const existing = (meta.sheets || []).map(s => s.properties.title);

    if (!existing.includes(PUSH_CONFIG.subSheet)) {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_CONFIG.spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${_accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: PUSH_CONFIG.subSheet } } }] }),
      });
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_CONFIG.spreadsheetId}/values/${encodeURIComponent(PUSH_CONFIG.subSheet + '!A1')}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${_accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ range: PUSH_CONFIG.subSheet + '!A1', majorDimension: 'ROWS', values: [COLS] }),
        }
      );
    }

    // このデバイスのID（なければ生成）
    let deviceId = localStorage.getItem('pushDeviceId');
    if (!deviceId) {
      deviceId = 'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      localStorage.setItem('pushDeviceId', deviceId);
    }

    const row = [deviceId, token, deviceName, new Date().toISOString()];

    // 既存行に同じdeviceIdがあれば上書き、なければ追記
    const listRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_CONFIG.spreadsheetId}/values/${encodeURIComponent(PUSH_CONFIG.subSheet + '!A:A')}`,
      { headers: { Authorization: `Bearer ${_accessToken}` } }
    );
    const listData = await listRes.json();
    const rows = listData.values || [];
    const rowIndex = rows.findIndex((r, i) => i > 0 && r[0] === deviceId);

    if (rowIndex >= 1) {
      const range = `${PUSH_CONFIG.subSheet}!A${rowIndex + 1}`;
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_CONFIG.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${_accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ range, majorDimension: 'ROWS', values: [row] }),
        }
      );
    } else {
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_CONFIG.spreadsheetId}/values/${encodeURIComponent(PUSH_CONFIG.subSheet + '!A:A')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${_accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ range: PUSH_CONFIG.subSheet + '!A:A', majorDimension: 'ROWS', values: [row] }),
        }
      );
    }
    return true;
  } catch(e) {
    console.error('saveFcmTokenToSheets:', e);
    return false;
  }
}

// 通知を有効にする
async function enablePushNotifications() {
  if (!('serviceWorker' in navigator)) {
    alert('このブラウザはサービスワーカーに対応していません。');
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    alert('通知が許可されませんでした。ブラウザの設定から許可してください。');
    return;
  }

  try {
    const messaging = initFirebase();
    // 既存のSWを使ってFCMトークンを取得
    const swReg = await navigator.serviceWorker.ready;
    const token = await messaging.getToken({ vapidKey: PUSH_CONFIG.vapidKey, serviceWorkerRegistration: swReg });

    if (!token) {
      alert('FCMトークンの取得に失敗しました。');
      return;
    }

    const deviceName = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'PC';
    const ok = await saveFcmTokenToSheets(token, deviceName);
    if (ok) {
      localStorage.setItem('pushEnabled', 'true');
      updatePushUI();
      alert(`通知を有効にしました（${deviceName}）。\nSheetsの「購読」シートに登録されました。`);
    } else {
      alert('Sheetsへの保存に失敗しました。先にGoogleにログインしてください。');
    }
  } catch(e) {
    console.error('enablePushNotifications:', e);
    alert('通知の設定に失敗しました: ' + e.message);
  }
}

// 通知を無効にする
async function disablePushNotifications() {
  try {
    if (_messaging) await _messaging.deleteToken();
  } catch(e) {
    console.warn('deleteToken:', e);
  }
  localStorage.removeItem('pushEnabled');
  updatePushUI();
}

// 通知ボタンのUI更新
function updatePushUI() {
  const btn = document.getElementById('btn-push');
  if (!btn) return;
  const enabled = localStorage.getItem('pushEnabled') === 'true';
  btn.textContent = enabled ? '🔔' : '🔕';
  btn.title       = enabled ? '通知有効（クリックで無効化）' : '通知を有効にする';
  btn.className   = enabled ? 'push-btn enabled' : 'push-btn';
}

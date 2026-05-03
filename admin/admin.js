const STORAGE_KEY = 'ag_admin_config';

let config = {
    owner: '',
    repo: '',
    branch: 'main',
    token: '',
    filePath: 'events.json'
};

let events = [];
let currentSha = '';
let editingId = null;
let statusTimer = null;
let isDirty = false;
let pendingCount = 0;

// ---- SORT ----
let eventSortKey = 'date';
let eventSortDir = 1; // 1=昇順, -1=降順

// ---- ARCHIVE ----
let archivedEvents = [];
let archivedSha = '';
let isArchivedDirty = false;
let archivedPendingCount = 0;

// ---- FIREBASE ----
const FIREBASE_KEY = 'ag_firebase_config';
let db = null;
let fbUserId = null;
let adminDisplayName = '管理者';
let isFirebaseConnected = false;
let currentPresence = {};

function extractFirebaseConfig(str) {
    const extract = (key) => {
        const m = str.match(new RegExp(key + '\\s*:\\s*["\']([^"\']+)["\']'));
        return m ? m[1] : '';
    };
    return {
        apiKey:            extract('apiKey'),
        authDomain:        extract('authDomain'),
        databaseURL:       extract('databaseURL'),
        projectId:         extract('projectId'),
        storageBucket:     extract('storageBucket'),
        messagingSenderId: extract('messagingSenderId'),
        appId:             extract('appId'),
    };
}

function loadFirebaseConfig() {
    try {
        const saved = localStorage.getItem(FIREBASE_KEY);
        if (!saved) return;
        const { configStr, name } = JSON.parse(saved);
        if (configStr) document.getElementById('input-firebase-config').value = configStr;
        if (name) {
            document.getElementById('input-admin-name').value = name;
            adminDisplayName = name;
        }
        // 自動接続
        const cfg = extractFirebaseConfig(configStr);
        if (cfg.apiKey && cfg.databaseURL) initFirebase(cfg);
    } catch(e) {}
}

function connectFirebase() {
    const configStr = document.getElementById('input-firebase-config').value.trim();
    const name      = document.getElementById('input-admin-name').value.trim() || '管理者';
    if (!configStr) { showStatus('Firebase設定を貼り付けてください', 'error'); return; }
    const cfg = extractFirebaseConfig(configStr);
    if (!cfg.apiKey || !cfg.databaseURL) {
        showStatus('apiKey または databaseURL が見つかりません。設定を確認してください。', 'error');
        return;
    }
    adminDisplayName = name;
    localStorage.setItem(FIREBASE_KEY, JSON.stringify({ configStr, name }));
    initFirebase(cfg);
}

function initFirebase(cfg) {
    try {
        if (!firebase.apps.length) firebase.initializeApp(cfg);
        db       = firebase.database();
        fbUserId = Math.random().toString(36).slice(2, 10);
        setupFirebaseListeners();
        setupPresence();
        isFirebaseConnected = true;
        updateFirebaseBadge(true);
        const body = document.getElementById('firebase-settings-body');
        const icon = document.getElementById('firebase-toggle-icon');
        body.style.display = 'none';
        icon.textContent   = '▼';
        showStatus('Firebaseに接続しました。リアルタイム同期が有効です。', 'success');
    } catch(e) {
        showStatus('Firebase接続エラー: ' + e.message, 'error');
        updateFirebaseBadge(false);
    }
}

function setupFirebaseListeners() {
    db.ref('events').on('value', (snap) => {
        const data = snap.val();
        events = data ? (Array.isArray(data) ? data : Object.values(data)) : [];
        renderEventList();
    });
    db.ref('presence').on('value', (snap) => {
        currentPresence = snap.val() || {};
        renderPresence();
        renderEventList();
    });
    // 未確認の実施報告をリスナー
    db.ref('pendingReports').on('value', (snap) => {
        const data = snap.val();
        pendingReports = data ? data : {};
        renderPendingReports();
    });
    // 確認済みの実施報告をリスナー
    db.ref('confirmedReports').on('value', (snap) => {
        const data = snap.val();
        confirmedReports = data ? data : {};
        renderConfirmedReports();
    });
}

// ---- PENDING REPORTS (実施報告の確認) ----
let pendingReports = {};
let confirmedReports = {};

function renderPendingReports() {
    const section = document.getElementById('pending-reports-section');
    const tbody = document.getElementById('pending-reports-tbody');
    const badge = document.getElementById('pending-reports-badge');
    if (!tbody || !section) return;

    const entries = Object.entries(pendingReports);
    if (badge) badge.textContent = `${entries.length}件`;

    if (entries.length === 0) {
        section.style.display = 'none';
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">実施報告はありません</td></tr>';
        return;
    }

    section.style.display = 'block';
    tbody.innerHTML = entries.map(([key, r]) => {
        const submitted = r.submittedAt ? new Date(r.submittedAt).toLocaleString('ja-JP') : '';
        return `<tr>
            <td>${escapeHtml(r.eventTitle || '')}</td>
            <td style="font-size:0.82rem;">${escapeHtml(r.eventDateText || r.eventDate || '')}</td>
            <td>${escapeHtml(r.reporter || '')}</td>
            <td style="font-size:0.82rem;">${escapeHtml(r.organizer || '—')}</td>
            <td>${escapeHtml(submitted)}</td>
            <td class="action-cell">
                <button class="btn btn-primary btn-sm" onclick="viewPendingReport('${escapeHtml(key)}')">詳細</button>
                <button class="btn btn-success btn-sm" onclick="confirmPendingReport('${escapeHtml(key)}')">確認</button>
            </td>
        </tr>`;
    }).join('');
}

function confirmPendingReport(key) {
    const r = pendingReports[key];
    if (!r) return;
    if (!db) { showStatus('Firebaseに接続してください。', 'error'); return; }
    if (!confirm(`「${r.eventTitle}」の実施報告を確認済みにしますか？\n一覧から外れ、確認済みリストに移動します。`)) return;

    const record = { ...r, confirmedAt: new Date().toISOString(), confirmedBy: adminDisplayName || '' };
    db.ref(`confirmedReports/${key}`).set(record)
        .then(() => db.ref(`pendingReports/${key}`).remove())
        .then(() => {
            showStatus(`「${r.eventTitle}」を確認済みにしました。`, 'success');
            if (document.getElementById('pending-report-overlay').style.display === 'flex') {
                closePendingReport();
            }
        })
        .catch(e => showStatus('確認の保存に失敗しました: ' + e.message, 'error'));
}

let currentReportKey = null;
let currentReportSource = null; // 'pending' | 'confirmed'

function renderReportDetail(r, source) {
    const contents = Array.isArray(r.contents) ? r.contents : [];
    const paragraphs = Array.isArray(r.paragraphs) ? r.paragraphs : [];
    const photos = Array.isArray(r.photos) ? r.photos : [];
    const submitted = r.submittedAt ? new Date(r.submittedAt).toLocaleString('ja-JP') : '';
    const confirmed = r.confirmedAt ? new Date(r.confirmedAt).toLocaleString('ja-JP') : '';

    const infoRows = [
        ['日程', r.eventDateText || r.eventDate || '—'],
        ['主催', r.organizer || '—'],
        ...(r.supporter ? [['協力', r.supporter]] : []),
        ...(r.target ? [['対象', r.target]] : []),
        ['報告者', r.reporter || '—'],
        ['送信日時', submitted],
        ...(source === 'confirmed' ? [
            ['確認日時', confirmed || '—'],
            ['確認者', r.confirmedBy || '—'],
        ] : []),
    ];

    const photosHtml = photos.length === 0
        ? '<p class="pending-report-empty">写真はアップロードされていません</p>'
        : `<div class="pending-report-photos">${photos.map((src, i) => `
            <a href="${escapeHtml(src)}" target="_blank" rel="noopener" class="pending-report-photo">
                <img src="${escapeHtml(src)}" alt="写真${i + 1}" onerror="this.parentElement.classList.add('broken');">
            </a>`).join('')}</div>`;

    document.getElementById('pending-report-title').textContent =
        `${source === 'confirmed' ? '確認済み' : ''}実施報告: ${r.eventTitle || '（タイトルなし）'}`;

    document.getElementById('pending-report-body').innerHTML = `
        <table class="pending-report-table">
            ${infoRows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}
        </table>
        ${contents.length > 0 ? `
            <div class="pending-report-section">
                <h4>内容</h4>
                <ul>${contents.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
            </div>` : ''}
        ${paragraphs.length > 0 ? `
            <div class="pending-report-section">
                <h4>本文</h4>
                ${paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('')}
            </div>` : ''}
        <div class="pending-report-section">
            <h4>写真 (${photos.length}枚)</h4>
            ${photosHtml}
        </div>
    `;

    const actions = document.getElementById('pending-report-actions');
    if (actions) {
        actions.innerHTML = source === 'confirmed'
            ? `<button class="btn btn-delete" onclick="deleteConfirmedReportFromModal()">削除</button>
               <button class="btn btn-secondary" onclick="unconfirmReportFromModal()">未確認に戻す</button>`
            : `<button class="btn btn-success" onclick="confirmPendingReportFromModal()">確認済みにする</button>`;
    }

    document.getElementById('pending-report-overlay').style.display = 'flex';
}

function viewPendingReport(key) {
    const r = pendingReports[key];
    if (!r) return;
    currentReportKey = key;
    currentReportSource = 'pending';
    renderReportDetail(r, 'pending');
}

function viewConfirmedReport(key) {
    const r = confirmedReports[key];
    if (!r) return;
    currentReportKey = key;
    currentReportSource = 'confirmed';
    renderReportDetail(r, 'confirmed');
}

function closePendingReport() {
    document.getElementById('pending-report-overlay').style.display = 'none';
    currentReportKey = null;
    currentReportSource = null;
}

function confirmPendingReportFromModal() {
    if (currentReportKey && currentReportSource === 'pending') confirmPendingReport(currentReportKey);
}

function unconfirmReportFromModal() {
    if (currentReportKey && currentReportSource === 'confirmed') unconfirmReport(currentReportKey);
}

function deleteConfirmedReportFromModal() {
    if (currentReportKey && currentReportSource === 'confirmed') deleteConfirmedReport(currentReportKey);
}

function renderConfirmedReports() {
    const section = document.getElementById('confirmed-reports-section');
    const tbody = document.getElementById('confirmed-reports-tbody');
    const badge = document.getElementById('confirmed-reports-badge');
    if (!tbody || !section) return;

    const entries = Object.entries(confirmedReports);
    if (badge) badge.textContent = `${entries.length}件`;

    if (entries.length === 0) {
        section.style.display = 'none';
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">確認済みの実施報告はありません</td></tr>';
        return;
    }

    section.style.display = 'block';
    const sorted = entries.sort((a, b) => {
        const ta = a[1].confirmedAt || '';
        const tb = b[1].confirmedAt || '';
        return tb.localeCompare(ta);
    });

    tbody.innerHTML = sorted.map(([key, r]) => {
        const confirmed = r.confirmedAt ? new Date(r.confirmedAt).toLocaleString('ja-JP') : '';
        return `<tr>
            <td>${escapeHtml(r.eventTitle || '')}</td>
            <td style="font-size:0.82rem;">${escapeHtml(r.eventDateText || r.eventDate || '')}</td>
            <td>${escapeHtml(r.reporter || '')}</td>
            <td>${escapeHtml(r.confirmedBy || '—')}</td>
            <td>${escapeHtml(confirmed)}</td>
            <td class="action-cell">
                <button class="btn btn-primary btn-sm" onclick="viewConfirmedReport('${escapeHtml(key)}')">詳細</button>
                <button class="btn btn-secondary btn-sm" onclick="unconfirmReport('${escapeHtml(key)}')">未確認に戻す</button>
                <button class="btn btn-delete btn-sm" onclick="deleteConfirmedReport('${escapeHtml(key)}')">削除</button>
            </td>
        </tr>`;
    }).join('');
}

function unconfirmReport(key) {
    const r = confirmedReports[key];
    if (!r) return;
    if (!db) { showStatus('Firebaseに接続してください。', 'error'); return; }
    if (!confirm(`「${r.eventTitle}」を未確認に戻しますか？`)) return;

    const restored = { ...r };
    delete restored.confirmedAt;
    delete restored.confirmedBy;

    db.ref(`pendingReports/${key}`).set(restored)
        .then(() => db.ref(`confirmedReports/${key}`).remove())
        .then(() => {
            showStatus(`「${r.eventTitle}」を未確認に戻しました。`, 'success');
            if (document.getElementById('pending-report-overlay').style.display === 'flex') {
                closePendingReport();
            }
        })
        .catch(e => showStatus('戻す操作に失敗しました: ' + e.message, 'error'));
}

function deleteConfirmedReport(key) {
    const r = confirmedReports[key];
    if (!r) return;
    if (!db) { showStatus('Firebaseに接続してください。', 'error'); return; }
    if (!confirm(`「${r.eventTitle}」を完全に削除しますか？\nこの操作は取り消せません。`)) return;

    db.ref(`confirmedReports/${key}`).remove()
        .then(() => {
            showStatus(`「${r.eventTitle}」を削除しました。`, 'success');
            if (document.getElementById('pending-report-overlay').style.display === 'flex') {
                closePendingReport();
            }
        })
        .catch(e => showStatus('削除に失敗しました: ' + e.message, 'error'));
}

function writeEventsToFirebase() {
    if (!db) return;
    db.ref('events').set(events).catch(e => showStatus('Firebase同期エラー: ' + e.message, 'error'));
}

function setupPresence() {
    const ref = db.ref(`presence/${fbUserId}`);
    db.ref('.info/connected').on('value', (snap) => {
        if (!snap.val()) return;
        ref.onDisconnect().remove();
        ref.set({ name: adminDisplayName, lastSeen: Date.now(), editingId: null });
    });
}

function updatePresence(editingId) {
    if (!db || !fbUserId) return;
    db.ref(`presence/${fbUserId}`).update({ lastSeen: Date.now(), editingId: editingId || null });
}

function renderPresence() {
    const bar = document.getElementById('presence-bar');
    if (!bar) return;
    const others = Object.entries(currentPresence)
        .filter(([uid]) => uid !== fbUserId)
        .map(([, info]) => info);
    if (others.length === 0) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';
    bar.innerHTML = '<span class="presence-label">同時編集中:</span>' + others.map(u => {
        const ev = u.editingId ? events.find(e => e.id === u.editingId) : null;
        const status = ev ? `「${escapeHtml(ev.title)}」を編集中` : 'オンライン';
        return `<span class="presence-chip">👤 <strong>${escapeHtml(u.name)}</strong> <span class="presence-status">${status}</span></span>`;
    }).join('');
}

function updateFirebaseBadge(connected) {
    const badge = document.getElementById('firebase-badge');
    if (!badge) return;
    badge.textContent = connected ? '接続済み' : '未接続';
    badge.className   = `connection-badge ${connected ? 'connected' : 'disconnected'}`;
}

function toggleFirebaseSettings() {
    const body = document.getElementById('firebase-settings-body');
    const icon = document.getElementById('firebase-toggle-icon');
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? 'block' : 'none';
    icon.textContent   = isHidden ? '▲' : '▼';
}

// ---- CONFIG ----

function loadConfig() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return;
        config = { ...config, ...JSON.parse(saved) };
        document.getElementById('input-owner').value = config.owner;
        document.getElementById('input-repo').value = config.repo;
        document.getElementById('input-branch').value = config.branch;
        document.getElementById('input-token').value = config.token;
        document.getElementById('input-filepath').value = config.filePath;

        // Restore repo URL display
        if (config.owner && config.repo) {
            document.getElementById('input-repo-url').value =
                `https://github.com/${config.owner}/${config.repo}`;
            updateConnectionBadge(true);
        }
    } catch (e) {}
}

function saveConfig() {
    config.owner    = document.getElementById('input-owner').value.trim();
    config.repo     = document.getElementById('input-repo').value.trim();
    config.branch   = document.getElementById('input-branch').value.trim() || 'main';
    config.token    = document.getElementById('input-token').value.trim();
    config.filePath = document.getElementById('input-filepath').value.trim() || 'events.json';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    showStatus('設定を保存しました', 'success');
}

function parseRepoUrl() {
    const url = document.getElementById('input-repo-url').value.trim();
    // Match https://github.com/owner/repo or git@github.com:owner/repo
    const match = url.match(/github\.com[:/]([^/]+)\/([^/\s.]+)/);
    if (!match) {
        showStatus('URLの形式が正しくありません。「https://github.com/ユーザー名/リポジトリ名」の形式で入力してください。', 'error');
        return;
    }
    document.getElementById('input-owner').value = match[1];
    document.getElementById('input-repo').value  = match[2].replace(/\.git$/, '');
    if (!document.getElementById('input-branch').value) {
        document.getElementById('input-branch').value = 'main';
    }
    if (!document.getElementById('input-filepath').value) {
        document.getElementById('input-filepath').value = 'events.json';
    }
    showStatus('リポジトリ情報を自動設定しました。アクセストークンを入力して「接続してデータを読み込む」を押してください。', 'success');
}

function toggleSettings() {
    const body = document.getElementById('settings-body');
    const icon = document.getElementById('settings-toggle-icon');
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? 'block' : 'none';
    icon.textContent   = isHidden ? '▲' : '▼';
}

function updateConnectionBadge(connected) {
    const badge = document.getElementById('connection-badge');
    if (connected) {
        badge.textContent = '接続済み';
        badge.className = 'connection-badge connected';
    } else {
        badge.textContent = '未接続';
        badge.className = 'connection-badge disconnected';
    }
}

// ---- STATUS ----

function showStatus(message, type = 'info') {
    const bar = document.getElementById('status-bar');
    bar.textContent = message;
    bar.className = `status-bar ${type}`;
    if (statusTimer) clearTimeout(statusTimer);
    if (type !== 'info') {
        statusTimer = setTimeout(() => { bar.className = 'status-bar'; }, 7000);
    }
}

function getFriendlyError(status, message) {
    if (status === 401) return 'アクセストークンが無効または期限切れです。「取得方法がわからない場合はこちら」から新しいトークンを取得してください。';
    if (status === 403) return 'アクセスが拒否されました。トークンに「repo」スコープの権限があるか確認してください。';
    if (status === 404) return 'ファイルまたはリポジトリが見つかりません。オーナー名・リポジトリ名・ファイルパスを確認してください。';
    if (status === 409) return 'ファイルの競合が発生しました。「接続してデータを読み込む」を押して最新の状態を取得してから再試行してください。';
    if (status === 422) return '設定に誤りがあります。ブランチ名やファイルパスを確認してください。';
    return `エラーが発生しました: ${message}`;
}

// ---- GITHUB API ----

function decodeBase64Utf8(base64) {
    const binary = atob(base64.replace(/\n/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
}

function encodeUtf8Base64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

async function fetchFromGitHub() {
    saveConfig();

    if (!config.owner || !config.repo || !config.token) {
        showStatus('オーナー・リポジトリ名・アクセストークンをすべて入力してください。', 'error');
        return;
    }

    showStatus('GitHubからデータを読み込んでいます...', 'info');
    updateConnectionBadge(false);

    try {
        const res = await fetch(
            `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${config.filePath}?ref=${config.branch}`,
            {
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw { status: res.status, message: err.message || '' };
        }

        const data = await res.json();
        currentSha = data.sha;
        events = JSON.parse(decodeBase64Utf8(data.content));

        markClean();
        updateConnectionBadge(true);
        toggleSettings();

        if (isFirebaseConnected) {
            writeEventsToFirebase(); // onValue が renderEventList() を呼ぶ
            showStatus(`読み込み完了！ ${events.length}件を Firebase に同期しました。`, 'success');
        } else {
            renderEventList();
            showStatus(`読み込み完了！ ${events.length}件のイベントが見つかりました。`, 'success');
        }
        await fetchReportsFromGitHub();
        await fetchArchivedFromGitHub();
        const archivedCount = autoArchiveExpiredEvents();
        if (archivedCount > 0) {
            if (isFirebaseConnected) { writeEventsToFirebase(); } else { renderEventList(); }
            showStatus(`${archivedCount}件の期限切れイベントを自動アーカイブしました。公開サイトへ反映してください。`, 'info');
        }
    } catch (e) {
        const msg = e.status
            ? getFriendlyError(e.status, e.message)
            : `接続できませんでした: ${e.message || e}`;
        showStatus(msg, 'error');
        updateConnectionBadge(false);
    }
}

async function pushToGitHub() {
    if (!config.owner || !config.repo || !config.token) {
        showStatus('GitHubの設定を確認してください。まず「接続してデータを読み込む」を実行してください。', 'error');
        return;
    }

    const btn = document.getElementById('btn-deploy');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '反映中...';
    showStatus('公開サイトに反映しています...', 'info');

    try {
        const jsonContent = JSON.stringify(events, null, 2);
        const body = {
            message: `イベント更新 (${new Date().toLocaleString('ja-JP')})`,
            content: encodeUtf8Base64(jsonContent),
            branch: config.branch
        };
        if (currentSha) body.sha = currentSha;

        const res = await fetch(
            `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${config.filePath}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            }
        );

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw { status: res.status, message: err.message || '' };
        }

        const data = await res.json();
        currentSha = data.content.sha;
        markClean();
        showStatus('公開サイトへの反映が完了しました！数分後にサイトに反映されます。', 'success');
    } catch (e) {
        const msg = e.status
            ? getFriendlyError(e.status, e.message)
            : `反映に失敗しました: ${e.message || e}`;
        showStatus(msg, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
        updateDeployButton();
    }
}

// ---- DIRTY STATE ----

function markDirty(action) {
    isDirty = true;
    pendingCount++;
    updateDeployButton();
    showStatus(`${action}（まだ公開サイトには反映されていません）`, 'info');
}

function markClean() {
    isDirty = false;
    pendingCount = 0;
    updateDeployButton();
}

function updateDeployButton() {
    const btn = document.getElementById('btn-deploy');
    if (!btn) return;
    if (isDirty && pendingCount > 0) {
        btn.textContent = `公開サイトに反映する（未反映: ${pendingCount}件）`;
        btn.classList.add('has-changes');
    } else {
        btn.textContent = '公開サイトに反映する';
        btn.classList.remove('has-changes');
    }
}

window.addEventListener('beforeunload', (e) => {
    if (isDirty || isReportsDirty || isArchivedDirty) {
        e.preventDefault();
        e.returnValue = '保存されていない変更があります。「公開サイトに反映する」を押してから移動してください。';
    }
});

// ---- RENDER ----

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const SNS_LABEL = {
    'allowed':     { text: '掲載可',  cls: 'sns-allowed' },
    'not-allowed': { text: '掲載不可', cls: 'sns-not-allowed' },
    'pending':     { text: '要確認',  cls: 'sns-pending' }
};

// ---- DATE ROWS ----

function getEventDateRanges(ev) {
    if (Array.isArray(ev.dates) && ev.dates.length > 0) {
        return ev.dates.map(d => ({
            startDate: d.startDate,
            endDate:   d.endDate   || d.startDate,
            startTime: d.startTime || '',
            endTime:   d.endTime   || '',
        }));
    }
    return [{
        startDate: ev.startDate || '',
        endDate:   ev.endDate   || ev.startDate || '',
        startTime: ev.startTime || '',
        endTime:   ev.endTime   || '',
    }];
}

function addDateRow(dateData = {}) {
    const list = document.getElementById('f-dates-list');
    const num  = list.children.length + 1;
    const row  = document.createElement('div');
    row.className = 'date-row';
    row.innerHTML = `
        <div class="date-row-header">
            <span class="date-row-num">日程 ${num}</span>
            <button type="button" class="btn-icon-remove" onclick="removeDateRow(this)" title="削除">✕</button>
        </div>
        <div class="date-row-fields">
            <div class="form-group">
                <label>開始日 <span class="required">※</span></label>
                <input type="date" class="f-date-start" value="${escapeHtml(dateData.startDate || '')}">
            </div>
            <div class="form-group">
                <label>終了日</label>
                <input type="date" class="f-date-end" value="${escapeHtml(dateData.endDate && dateData.endDate !== dateData.startDate ? dateData.endDate : '')}">
            </div>
            <div class="form-group">
                <label>開始時刻</label>
                <input type="time" class="f-date-starttime" value="${escapeHtml(dateData.startTime || '')}">
            </div>
            <div class="form-group">
                <label>終了時刻</label>
                <input type="time" class="f-date-endtime" value="${escapeHtml(dateData.endTime || '')}">
            </div>
        </div>
    `;
    list.appendChild(row);
    updateDateRowLabels();
}

function removeDateRow(btn) {
    const list = document.getElementById('f-dates-list');
    if (list.children.length <= 1) { alert('少なくとも1つの日程が必要です'); return; }
    btn.closest('.date-row').remove();
    updateDateRowLabels();
}

function updateDateRowLabels() {
    document.querySelectorAll('#f-dates-list .date-row').forEach((row, i) => {
        const label = row.querySelector('.date-row-num');
        if (label) label.textContent = `日程 ${i + 1}`;
    });
}

function clearDateRows() {
    document.getElementById('f-dates-list').innerHTML = '';
    addDateRow();
}

function getDatesFromForm() {
    return Array.from(document.querySelectorAll('#f-dates-list .date-row'))
        .map(row => ({
            startDate: row.querySelector('.f-date-start').value.trim(),
            endDate:   row.querySelector('.f-date-end').value.trim(),
            startTime: row.querySelector('.f-date-starttime').value.trim(),
            endTime:   row.querySelector('.f-date-endtime').value.trim(),
        }))
        .filter(d => d.startDate);
}

function checkOverlaps(targetEvent, allEvents) {
    const targetRanges = getEventDateRanges(targetEvent);
    const parseTime = (tStr, isEnd) => {
        if (!tStr) return isEnd ? 24 * 60 : 0;
        const parts = tStr.split(':').map(Number);
        return parts[0] * 60 + parts[1];
    };

    return allEvents.filter(e => {
        if (e.id === targetEvent.id) return false;

        const locsT = Array.isArray(targetEvent.locations) ? targetEvent.locations : (targetEvent.location ? [targetEvent.location] : []);
        const locsE = Array.isArray(e.locations) ? e.locations : (e.location ? [e.location] : []);
        const sharedLocs = locsT.filter(l => l !== 'その他' && locsE.includes(l));
        if (sharedLocs.length === 0) return false;

        const eRanges = getEventDateRanges(e);
        return targetRanges.some(tR => eRanges.some(eR => {
            if (tR.startDate > eR.endDate || tR.endDate < eR.startDate) return false;
            if (!tR.startTime || !eR.startTime) return true;
            const tS = parseTime(tR.startTime, false), tE = parseTime(tR.endTime, true);
            const eS = parseTime(eR.startTime, false), eE = parseTime(eR.endTime, true);
            return !(tE <= eS || tS >= eE);
        }));
    });
}

function sortEventList(key) {
    if (eventSortKey === key) {
        eventSortDir = -eventSortDir;
    } else {
        eventSortKey = key;
        eventSortDir = 1;
    }
    renderEventList();
}

function getSortedEvents() {
    return events.slice().sort((a, b) => {
        let av, bv;
        switch (eventSortKey) {
            case 'title':
                av = a.title || '';
                bv = b.title || '';
                break;
            case 'date':
                av = (Array.isArray(a.dates) && a.dates.length > 0 ? a.dates[0].startDate : a.startDate) || '';
                bv = (Array.isArray(b.dates) && b.dates.length > 0 ? b.dates[0].startDate : b.startDate) || '';
                break;
            case 'location':
                av = Array.isArray(a.locations) && a.locations.length > 0 ? a.locations.join('') : (a.location || '');
                bv = Array.isArray(b.locations) && b.locations.length > 0 ? b.locations.join('') : (b.location || '');
                break;
            case 'category':
                av = a.categoryText || '';
                bv = b.categoryText || '';
                break;
            case 'sns':
                av = a.snsPR || '';
                bv = b.snsPR || '';
                break;
            case 'manager':
                av = a.manager || '';
                bv = b.manager || '';
                break;
            default:
                av = (Array.isArray(a.dates) && a.dates.length > 0 ? a.dates[0].startDate : a.startDate) || '';
                bv = (Array.isArray(b.dates) && b.dates.length > 0 ? b.dates[0].startDate : b.startDate) || '';
        }
        if (av < bv) return -1 * eventSortDir;
        if (av > bv) return 1 * eventSortDir;
        return 0;
    });
}

function getEventSortIcon(key) {
    if (eventSortKey !== key) return '<span class="sort-icon">↕</span>';
    return eventSortDir === 1 ? '<span class="sort-icon active">↑</span>' : '<span class="sort-icon active">↓</span>';
}

function updateEventSortHeaders() {
    const cols = ['title', 'date', 'location', 'category', 'sns', 'manager'];
    cols.forEach(key => {
        const el = document.getElementById(`th-event-${key}`);
        if (el) {
            const label = el.getAttribute('data-label');
            el.innerHTML = `${label} ${getEventSortIcon(key)}`;
        }
    });
}

function renderEventList() {
    const tbody = document.getElementById('events-tbody');
    const desc  = document.getElementById('section-desc');

    updateEventSortHeaders();

    if (events.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">イベントがありません。「＋ イベントを追加」から追加してください。</td></tr>`;
        if (desc) desc.textContent = 'イベントはまだありません';
        return;
    }

    if (desc) desc.textContent = `${events.length}件のイベントが登録されています`;

    tbody.innerHTML = getSortedEvents().map(e => {
        const locText = Array.isArray(e.locations) && e.locations.length > 0
            ? e.locations.join('・')
            : (e.location || '—');
        const sns     = SNS_LABEL[e.snsPR] || SNS_LABEL['pending'];
        const snsDate = e.snsPR === 'allowed' && e.snsAvailableFrom
            ? `<div style="font-size:0.74rem; color:var(--text-secondary); margin-top:0.2rem;">${e.snsAvailableFrom}〜</div>`
            : '';
            
        // 重複チェック
        const overlaps = checkOverlaps(e, events);
        const overlapWarning = overlaps.length > 0
            ? `<div class="overlap-badge" title="以下のイベントと重複しています:\n${overlaps.map(o => '- ' + escapeHtml(o.title)).join('\n')}">⚠️ ブッキング</div>`
            : '';

        // 他の管理者が編集中か
        const editingUser = Object.entries(currentPresence)
            .filter(([uid]) => uid !== fbUserId)
            .find(([, info]) => info.editingId === e.id);
        const editingBadge = editingUser
            ? `<div class="editing-badge" title="${escapeHtml(editingUser[1].name)}が編集中">✏️ ${escapeHtml(editingUser[1].name)}</div>`
            : '';

        return `
        <tr class="${overlaps.length > 0 ? 'row-overlap' : ''}">
            <td>
                <div class="event-title-cell">${escapeHtml(e.title)} ${overlapWarning} ${editingBadge}</div>
                ${e.participants ? `<div class="event-sub-cell">👥 ${escapeHtml(e.participants)}</div>` : ''}
            </td>
            <td style="white-space:nowrap; font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(e.date)}</td>
            <td style="font-size:0.82rem;">${escapeHtml(locText)}</td>
            <td><span class="category-badge ${escapeHtml(e.category)}">${escapeHtml(e.categoryText)}</span></td>
            <td>
                <span class="sns-badge ${sns.cls}">${sns.text}</span>
                ${snsDate}
            </td>
            <td style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(e.manager || '—')}</td>
            <td>
                <div class="td-actions">
                    <button class="btn btn-edit" onclick="openEditModal(${Number(e.id)})">編集</button>
                    <button class="btn btn-archive" onclick="archiveEvent(${Number(e.id)})">アーカイブ</button>
                    <button class="btn btn-delete" onclick="deleteEvent(${Number(e.id)})">削除</button>
                </div>
            </td>
        </tr>`;
    }).join('');

    // ダッシュボードも更新
    if (typeof renderDashboard === 'function') renderDashboard();
}

// ---- CRUD ----

function deleteEvent(id) {
    const event = events.find(e => e.id === id);
    if (!event) return;
    if (!confirm(`「${event.title}」を削除してよいですか？\n\n※「公開サイトに反映する」を押すまで実際のサイトは変わりません。`)) return;
    events = events.filter(e => e.id !== id);
    markDirty(`「${event.title}」を削除しました`);
    if (isFirebaseConnected) { writeEventsToFirebase(); } else { renderEventList(); }
}

function openAddModal() {
    editingId = null;
    document.getElementById('modal-title').textContent = 'イベントを追加';
    clearForm();
    document.getElementById('modal-overlay').style.display = 'flex';
}

function openEditModal(id) {
    const event = events.find(e => e.id === id);
    if (!event) return;
    editingId = id;
    document.getElementById('modal-title').textContent = 'イベントを編集';

    document.getElementById('f-title').value          = event.title;
    document.getElementById('f-category-input').value = event.categoryText || '';

    // 日程（複数対応）
    const datesList = document.getElementById('f-dates-list');
    datesList.innerHTML = '';
    getEventDateRanges(event).forEach(d => addDateRow(d));
    document.getElementById('f-card-color').value     = event.cardColor || '#000000';
    document.getElementById('f-participants').value   = event.participants || '';
    document.getElementById('f-manager').value        = event.manager || '';
    document.getElementById('f-notes').value          = event.notes || '';

    // 開催場所チェックボックス
    const predefined = ['室内練習場','ベースボールエリア','アローズエリア','スタジオ','バッティングブースA','バッティングブースB','打撃エリア','投手測定エリア','食堂','多目的室'];
    const locs = Array.isArray(event.locations) ? event.locations : [];
    document.querySelectorAll('.location-checkbox').forEach(cb => {
        cb.checked = locs.includes(cb.value);
    });
    const otherLoc = locs.find(l => !predefined.includes(l));
    if (otherLoc) {
        document.getElementById('cb-location-other').checked = true;
        document.getElementById('f-location-other-text').value = otherLoc;
        document.getElementById('location-other-row').style.display = 'block';
    } else {
        document.getElementById('f-location-other-text').value = '';
        document.getElementById('location-other-row').style.display = 'none';
    }

    // HP/SNS
    const snsVal = event.snsPR || 'not-allowed';
    const snsRadio = document.querySelector(`input[name="f-sns"][value="${snsVal}"]`);
    if (snsRadio) snsRadio.checked = true;
    document.getElementById('f-sns-date').value = event.snsAvailableFrom || '';
    document.getElementById('sns-date-row').style.display = snsVal === 'allowed' ? 'block' : 'none';

    updatePresence(id);
    document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    updatePresence(null);
}

function getCategoryClass(text) {
    const t = (text || '').toLowerCase();
    if (/ヘルス|健康|health|wellness/.test(t)) return 'health';
    if (/研修|学習|training|learning/.test(t))  return 'learning';
    if (/交流|懇親|social/.test(t))              return 'social';
    return 'other';
}

function clearForm() {
    ['f-title', 'f-category-input', 'f-participants', 'f-sns-date', 'f-manager', 'f-notes']
        .forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('f-card-color').value = '#000000';
    document.querySelectorAll('.location-checkbox').forEach(cb => { cb.checked = false; });
    document.getElementById('f-location-other-text').value = '';
    document.getElementById('location-other-row').style.display = 'none';
    const defaultSns = document.querySelector('input[name="f-sns"][value="not-allowed"]');
    if (defaultSns) defaultSns.checked = true;
    document.getElementById('sns-date-row').style.display = 'none';
    clearDateRows();
}

function toggleLocationOther() {
    const checked = document.getElementById('cb-location-other').checked;
    document.getElementById('location-other-row').style.display = checked ? 'block' : 'none';
    if (!checked) document.getElementById('f-location-other-text').value = '';
}

function toggleSnsDate() {
    const val = document.querySelector('input[name="f-sns"]:checked')?.value;
    document.getElementById('sns-date-row').style.display = val === 'allowed' ? 'block' : 'none';
}

function saveEvent() {
    const title = document.getElementById('f-title').value.trim();
    if (!title) { alert('タイトルを入力してください'); return; }

    const datesFromForm = getDatesFromForm();
    if (datesFromForm.length === 0) { alert('開始日を選択してください'); return; }

    // 日程を開始日順に正規化
    const dates = datesFromForm
        .map(d => ({ startDate: d.startDate, endDate: d.endDate || d.startDate, startTime: d.startTime, endTime: d.endTime }))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

    // 後方互換用レガシーフィールド
    const startDate = dates[0].startDate;
    const endDate   = dates[dates.length - 1].endDate;
    const startTime = dates[0].startTime;
    const endTime   = dates[0].endTime;

    // 管理画面テーブル用の表示テキスト
    const fmt = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getMonth()+1}月${d.getDate()}日`; };
    const fmtRange = (d) => {
        const r = d.endDate !== d.startDate ? `${fmt(d.startDate)}〜${fmt(d.endDate)}` : fmt(d.startDate);
        return d.startTime ? `${r} ${d.startTime}${d.endTime ? '〜'+d.endTime : ''}` : r;
    };
    const date = dates.length === 1 ? fmtRange(dates[0]) : `${fmt(dates[0].startDate)} 他${dates.length - 1}件`;

    const categoryText = document.getElementById('f-category-input').value.trim() || 'その他';
    const category     = getCategoryClass(categoryText);
    const locations    = Array.from(document.querySelectorAll('.location-checkbox:checked')).map(cb => {
        if (cb.value === 'その他') {
            const text = document.getElementById('f-location-other-text').value.trim();
            return text || 'その他';
        }
        return cb.value;
    });
    const participants = document.getElementById('f-participants').value.trim();
    const snsPR        = document.querySelector('input[name="f-sns"]:checked')?.value || 'not-allowed';
    const snsAvailableFrom = snsPR === 'allowed' ? document.getElementById('f-sns-date').value.trim() : '';
    const manager      = document.getElementById('f-manager').value.trim();
    const notes        = document.getElementById('f-notes').value.trim();
    let cardColor      = document.getElementById('f-card-color').value;
    if (cardColor === '#000000') cardColor = '';

    const tempId    = editingId !== null ? editingId : -1;
    const eventData = { id: tempId, title, date, dates, startDate, endDate, startTime, endTime, category, categoryText, cardColor, locations, participants, snsPR, snsAvailableFrom, manager, notes };

    const overlaps = checkOverlaps(eventData, events);
    if (overlaps.length > 0) {
        const msg = `⚠️ ブッキング警告\n\n以下のイベントと場所・日時の予約が重なっています:\n`
            + overlaps.map(o => `・${o.title}`).join('\n')
            + `\n\nこのまま保存（登録）してよろしいでしょうか？`;
        if (!confirm(msg)) return;
    }

    if (editingId !== null) {
        const idx = events.findIndex(e => e.id === editingId);
        if (idx !== -1) events[idx] = eventData;
        closeModal();
        markDirty(`「${title}」を編集しました`);
    } else {
        const maxId = events.length > 0 ? Math.max(...events.map(e => e.id)) : 0;
        eventData.id = maxId + 1;
        events.push(eventData);
        closeModal();
        markDirty(`「${title}」を追加しました`);
    }
    if (isFirebaseConnected) { writeEventsToFirebase(); } else { renderEventList(); }
}

// ---- TOKEN GUIDE ----

function openTokenGuide() {
    document.getElementById('token-guide-overlay').style.display = 'flex';
}

function closeTokenGuide() {
    document.getElementById('token-guide-overlay').style.display = 'none';
}

// Close modals on overlay click
['modal-overlay', 'token-guide-overlay', 'report-modal-overlay', 'pending-report-overlay'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            e.currentTarget.style.display = 'none';
        }
    });
});

// ---- REPORTS ----

let reports = [];
let reportsSha = '';
let isReportsDirty = false;
let reportsPendingCount = 0;
let editingReportId = null;

function getReportsPath() {
    return config.filePath.replace(/[^/]+$/, 'reports.json');
}

async function fetchReportsFromGitHub() {
    if (!config.owner || !config.repo || !config.token) return;
    const reportsPath = getReportsPath();
    try {
        const res = await fetch(
            `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${reportsPath}?ref=${config.branch}`,
            { headers: { 'Authorization': `Bearer ${config.token}`, 'Accept': 'application/vnd.github.v3+json' } }
        );
        if (res.status === 404) {
            reports = [];
            reportsSha = '';
            renderReportList();
            return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        reportsSha = data.sha;
        reports = JSON.parse(decodeBase64Utf8(data.content));
        renderReportList();
    } catch (e) {
        reports = [];
        reportsSha = '';
        renderReportList();
    }
}

async function pushReportsToGitHub() {
    if (!config.owner || !config.repo || !config.token) {
        showStatus('GitHubの設定を確認してください。まず「接続してデータを読み込む」を実行してください。', 'error');
        return;
    }
    const btn = document.getElementById('btn-reports-deploy');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '反映中...';
    showStatus('実績を公開しています...', 'info');
    try {
        const reportsPath = getReportsPath();
        const body = {
            message: `実績更新 (${new Date().toLocaleString('ja-JP')})`,
            content: encodeUtf8Base64(JSON.stringify(reports, null, 2)),
            branch: config.branch
        };
        if (reportsSha) body.sha = reportsSha;
        const res = await fetch(
            `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${reportsPath}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            }
        );
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw { status: res.status, message: err.message || '' };
        }
        const data = await res.json();
        reportsSha = data.content.sha;
        markReportsClean();
        showStatus('実績の公開が完了しました！', 'success');
    } catch (e) {
        const msg = e.status
            ? getFriendlyError(e.status, e.message)
            : `反映に失敗しました: ${e.message || e}`;
        showStatus(msg, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
        updateReportsDeployButton();
    }
}

function markReportsDirty(action) {
    isReportsDirty = true;
    reportsPendingCount++;
    updateReportsDeployButton();
    showStatus(`${action}（まだ公開されていません）`, 'info');
}

function markReportsClean() {
    isReportsDirty = false;
    reportsPendingCount = 0;
    updateReportsDeployButton();
}

function updateReportsDeployButton() {
    const btn = document.getElementById('btn-reports-deploy');
    if (!btn) return;
    if (isReportsDirty && reportsPendingCount > 0) {
        btn.textContent = `実績を公開する（未反映: ${reportsPendingCount}件）`;
        btn.classList.add('has-changes');
    } else {
        btn.textContent = '実績を公開する';
        btn.classList.remove('has-changes');
    }
}

function renderReportList() {
    const tbody = document.getElementById('reports-tbody');
    const desc  = document.getElementById('reports-section-desc');
    if (!tbody) return;

    if (reports.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">実績はまだありません。「＋ 実績を追加」から追加してください。</td></tr>`;
        if (desc) desc.textContent = '実績はまだありません';
        return;
    }

    if (desc) desc.textContent = `${reports.length}件の実績が登録されています`;

    const fmtD = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`; };

    tbody.innerHTML = reports
        .slice().sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate))
        .map(r => {
            const photoCount = Array.isArray(r.photos) ? r.photos.length : 0;
            return `
            <tr>
                <td><div class="event-title-cell">${escapeHtml(r.eventTitle)}</div></td>
                <td style="white-space:nowrap; font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(fmtD(r.eventDate))}</td>
                <td><span class="category-badge ${escapeHtml(r.category || 'other')}">${escapeHtml(r.categoryText || '')}</span></td>
                <td style="font-size:0.85rem;">${escapeHtml(r.actualParticipants || '—')}</td>
                <td style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(r.manager || '—')}</td>
                <td style="font-size:0.85rem; color:var(--text-secondary);">${photoCount > 0 ? `📷 ${photoCount}枚` : '—'}</td>
                <td>
                    <div class="td-actions">
                        <button class="btn btn-secondary btn-sm" onclick="viewReport(${Number(r.id)})">詳細</button>
                        <button class="btn btn-edit" onclick="openEditReportModal(${Number(r.id)})">編集</button>
                        <button class="btn btn-delete" onclick="deleteReport(${Number(r.id)})">削除</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
}

function openAddReportModal() {
    editingReportId = null;
    document.getElementById('report-modal-title').textContent = '実績を追加';
    clearReportForm();
    document.getElementById('report-modal-overlay').style.display = 'flex';
}

function openEditReportModal(id) {
    const r = reports.find(rep => rep.id === id);
    if (!r) return;
    editingReportId = id;
    document.getElementById('report-modal-title').textContent = '実績を編集';
    document.getElementById('rf-title').value           = r.eventTitle || '';
    document.getElementById('rf-date').value            = r.eventDate || '';
    document.getElementById('rf-category-input').value  = r.categoryText || '';
    document.getElementById('rf-card-color').value      = r.cardColor || '#000000';
    document.getElementById('rf-participants').value    = r.actualParticipants || '';
    document.getElementById('rf-summary').value         = r.summary || '';
    document.getElementById('rf-comments').value        = r.comments || '';
    document.getElementById('rf-manager').value         = r.manager || '';
    document.getElementById('rf-photos-list').innerHTML = '';
    (r.photos || []).forEach(url => addPhotoRow(url));
    document.getElementById('report-modal-overlay').style.display = 'flex';
}

function closeReportModal() {
    document.getElementById('report-modal-overlay').style.display = 'none';
}

// ---- 実績詳細・コピー ----

function buildReportArticleText(r) {
    const title = r.eventTitle || '';
    const dateText = r.eventDateText || r.eventDate || '';
    const organizer = r.organizer || '';
    const supporter = r.supporter || '';
    const target = r.target || '';
    const contents = Array.isArray(r.contents) ? r.contents : [];
    const paragraphs = Array.isArray(r.paragraphs) ? r.paragraphs : [];

    // ヘッダー行（日程短縮形+タイトル）は手動で記入するため省略し、ブロックのみ生成
    let text = '';
    text += `当施設を利用するイベントとして、下記が開催されました。\n\n`;
    text += `イベント名：${title}\n`;
    text += `日程　　　：${dateText}\n`;
    text += `主催　　　：${organizer}\n`;
    if (supporter) text += `協力　　　：${supporter}\n`;
    if (target)    text += `対象　　　：${target}\n`;
    if (contents.length > 0) {
        text += `内容　　　：${contents.join('、')}\n`;
    }
    if (paragraphs.length > 0) {
        text += '\n';
        paragraphs.forEach(p => { text += `${p}\n\n`; });
    }
    text += `単に場所をご利用いただくだけでなく、主催者が希望する内容に合わせて様々なご支援が可能ですので、ぜひお気軽にお問い合わせフォームよりご連絡ください。`;
    return text;
}

function viewReport(id) {
    const r = reports.find(rep => rep.id === id);
    if (!r) return;

    document.getElementById('report-detail-title').textContent = r.eventTitle || '実績詳細';

    // テキストエリア
    document.getElementById('report-detail-textarea').value = buildReportArticleText(r);

    // プレビュー
    const contents = Array.isArray(r.contents) ? r.contents : [];
    const paragraphs = Array.isArray(r.paragraphs) ? r.paragraphs : [];
    const rows = [
        ['イベント名', r.eventTitle || ''],
        ['日程', r.eventDateText || r.eventDate || ''],
        ['主催', r.organizer || ''],
        ...(r.supporter ? [['協力', r.supporter]] : []),
        ...(r.target    ? [['対象', r.target]]    : []),
        ...(contents.length > 0 ? [['内容', contents.join('、')]] : []),
    ];
    const tableRows = rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('');
    const paraHtml = paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('');
    const photos = Array.isArray(r.photos) ? r.photos : [];
    const photosHtml = photos.length === 0 ? '' : `
        <div class="rd-photos-section">
            <h4>写真 (${photos.length}枚)</h4>
            <div class="pending-report-photos">
                ${photos.map((src, i) => `
                    <a href="${escapeHtml(src)}" target="_blank" rel="noopener" class="pending-report-photo">
                        <img src="${escapeHtml(src)}" alt="写真${i + 1}" onerror="this.parentElement.classList.add('broken');">
                    </a>`).join('')}
            </div>
        </div>`;
    document.getElementById('report-detail-preview-body').innerHTML = `
        <p class="rd-intro">当施設を利用するイベントとして、下記が開催されました。</p>
        <table class="rd-table">${tableRows}</table>
        ${paraHtml}
        ${photosHtml}
        <p class="rd-closing">単に場所をご利用いただくだけでなく、主催者が希望する内容に合わせて様々なご支援が可能ですので、ぜひお気軽にお問い合わせフォームよりご連絡ください。</p>
    `;

    document.getElementById('report-detail-overlay').style.display = 'flex';
}

function closeReportDetail() {
    document.getElementById('report-detail-overlay').style.display = 'none';
}

function copyReportText() {
    const ta = document.getElementById('report-detail-textarea');
    ta.select();
    navigator.clipboard.writeText(ta.value).then(() => {
        const toast = document.getElementById('report-copy-toast');
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 2000);
    }).catch(() => {
        document.execCommand('copy');
    });
}

function clearReportForm() {
    ['rf-title', 'rf-date', 'rf-category-input', 'rf-participants', 'rf-summary', 'rf-comments', 'rf-manager']
        .forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('rf-card-color').value = '#000000';
    document.getElementById('rf-photos-list').innerHTML = '';
    addPhotoRow();
}

function addPhotoRow(url = '') {
    const list = document.getElementById('rf-photos-list');
    const row = document.createElement('div');
    row.className = 'date-row';
    row.style.cssText = 'display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem;';
    row.innerHTML = `
        <input type="url" class="rf-photo-url" value="${escapeHtml(url)}" placeholder="https://..." style="flex:1;">
        <button type="button" class="btn-icon-remove" onclick="this.parentElement.remove()" title="削除">✕</button>
    `;
    list.appendChild(row);
}

function getPhotosFromForm() {
    return Array.from(document.querySelectorAll('.rf-photo-url'))
        .map(inp => inp.value.trim())
        .filter(url => url);
}

function saveReport() {
    const title = document.getElementById('rf-title').value.trim();
    if (!title) { alert('イベント名を入力してください'); return; }
    const eventDate = document.getElementById('rf-date').value;
    if (!eventDate) { alert('開催日を選択してください'); return; }

    const categoryText = document.getElementById('rf-category-input').value.trim() || 'その他';
    const category     = getCategoryClass(categoryText);
    let cardColor      = document.getElementById('rf-card-color').value;
    if (cardColor === '#000000') cardColor = '';

    const reportData = {
        id:                editingReportId !== null ? editingReportId : -1,
        eventTitle:        title,
        eventDate,
        category,
        categoryText,
        cardColor,
        actualParticipants: document.getElementById('rf-participants').value.trim(),
        summary:           document.getElementById('rf-summary').value.trim(),
        photos:            getPhotosFromForm(),
        comments:          document.getElementById('rf-comments').value.trim(),
        manager:           document.getElementById('rf-manager').value.trim(),
    };

    if (editingReportId !== null) {
        const idx = reports.findIndex(r => r.id === editingReportId);
        if (idx !== -1) reports[idx] = reportData;
        markReportsDirty(`「${title}」を編集しました`);
    } else {
        const maxId = reports.length > 0 ? Math.max(...reports.map(r => r.id)) : 0;
        reportData.id = maxId + 1;
        reports.push(reportData);
        markReportsDirty(`「${title}」を追加しました`);
    }

    closeReportModal();
    renderReportList();
}

function deleteReport(id) {
    const r = reports.find(rep => rep.id === id);
    if (!r) return;
    if (!confirm(`「${r.eventTitle}」を削除してよいですか？`)) return;
    reports = reports.filter(rep => rep.id !== id);
    markReportsDirty(`「${r.eventTitle}」を削除しました`);
    renderReportList();
}

// ---- ARCHIVE ----

function getArchivedPath() {
    return config.filePath.replace(/[^/]+$/, 'archived_events.json');
}

function getTodayDateString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getEventLastDate(ev) {
    return getEventDateRanges(ev)
        .map(d => d.endDate || d.startDate || '')
        .filter(Boolean)
        .sort()
        .pop() || '';
}

function isEventExpired(ev, todayStr = getTodayDateString()) {
    const lastDate = getEventLastDate(ev);
    return !!lastDate && lastDate < todayStr;
}

function getNextArchivedId() {
    const ids = archivedEvents.map(e => Number(e.id)).filter(Number.isFinite);
    return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

function autoArchiveExpiredEvents() {
    const todayStr = getTodayDateString();
    const expired = events.filter(e => isEventExpired(e, todayStr));
    if (expired.length === 0) return 0;

    let nextId = getNextArchivedId();
    const archivedAt = new Date().toISOString();
    let addedToArchive = 0;
    expired.forEach(event => {
        const alreadyArchived = archivedEvents.some(e => e.originalEventId === event.id);
        if (alreadyArchived) return;
        archivedEvents.push({ ...event, id: nextId++, originalEventId: event.id, archivedAt });
        addedToArchive++;
    });

    const expiredIds = new Set(expired.map(e => e.id));
    events = events.filter(e => !expiredIds.has(e.id));
    if (addedToArchive > 0) {
        markArchivedDirty(`${addedToArchive}件の期限切れイベントを自動アーカイブしました`);
        renderArchivedList();
    }
    markDirty(`${expired.length}件の期限切れイベントをイベント一覧から移動しました`);
    return expired.length;
}

async function fetchArchivedFromGitHub() {
    if (!config.owner || !config.repo || !config.token) return;
    const path = getArchivedPath();
    try {
        const res = await fetch(
            `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}?ref=${config.branch}`,
            { headers: { 'Authorization': `Bearer ${config.token}`, 'Accept': 'application/vnd.github.v3+json' } }
        );
        if (res.status === 404) {
            archivedEvents = [];
            archivedSha = '';
            renderArchivedList();
            return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        archivedSha = data.sha;
        archivedEvents = JSON.parse(decodeBase64Utf8(data.content));
        renderArchivedList();
    } catch (e) {
        archivedEvents = [];
        archivedSha = '';
        renderArchivedList();
    }
}

async function pushArchivedToGitHub() {
    if (!config.owner || !config.repo || !config.token) {
        showStatus('GitHubの設定を確認してください。', 'error');
        return;
    }
    const btn = document.getElementById('btn-archived-deploy');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '反映中...';
    showStatus('アーカイブを公開しています...', 'info');
    try {
        const path = getArchivedPath();
        const body = {
            message: `アーカイブ更新 (${new Date().toLocaleString('ja-JP')})`,
            content: encodeUtf8Base64(JSON.stringify(archivedEvents, null, 2)),
            branch: config.branch
        };
        if (archivedSha) body.sha = archivedSha;
        const res = await fetch(
            `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            }
        );
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw { status: res.status, message: err.message || '' };
        }
        const data = await res.json();
        archivedSha = data.content.sha;
        markArchivedClean();
        showStatus('アーカイブの公開が完了しました！', 'success');
    } catch (e) {
        const msg = e.status
            ? getFriendlyError(e.status, e.message)
            : `反映に失敗しました: ${e.message || e}`;
        showStatus(msg, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
        updateArchivedDeployButton();
    }
}

function markArchivedDirty(action) {
    isArchivedDirty = true;
    archivedPendingCount++;
    updateArchivedDeployButton();
    showStatus(`${action}（まだ公開されていません）`, 'info');
}

function markArchivedClean() {
    isArchivedDirty = false;
    archivedPendingCount = 0;
    updateArchivedDeployButton();
}

function updateArchivedDeployButton() {
    const btn = document.getElementById('btn-archived-deploy');
    if (!btn) return;
    if (isArchivedDirty && archivedPendingCount > 0) {
        btn.textContent = `アーカイブを公開する（未反映: ${archivedPendingCount}件）`;
        btn.classList.add('has-changes');
    } else {
        btn.textContent = 'アーカイブを公開する';
        btn.classList.remove('has-changes');
    }
}

function archiveEvent(id) {
    const event = events.find(e => e.id === id);
    if (!event) return;
    if (!confirm(`「${event.title}」をアーカイブに移動しますか？\n\nイベント一覧から削除され、アーカイブ一覧に移動します。`)) return;

    // アーカイブに追加
    const archivedData = { ...event, originalEventId: event.id, archivedAt: new Date().toISOString() };
    const maxId = archivedEvents.length > 0 ? Math.max(...archivedEvents.map(e => e.id)) : 0;
    archivedData.id = maxId + 1;
    archivedEvents.push(archivedData);
    markArchivedDirty(`「${event.title}」をアーカイブに移動しました`);
    renderArchivedList();

    // イベント一覧から削除
    events = events.filter(e => e.id !== id);
    markDirty(`「${event.title}」をアーカイブに移動しました`);
    if (isFirebaseConnected) { writeEventsToFirebase(); } else { renderEventList(); }
}

function restoreEvent(id) {
    const archived = archivedEvents.find(e => e.id === id);
    if (!archived) return;
    if (!confirm(`「${archived.title}」をイベント一覧に戻しますか？`)) return;

    // イベント一覧に復元
    const restored = { ...archived };
    delete restored.archivedAt;
    delete restored.originalEventId;
    const maxId = events.length > 0 ? Math.max(...events.map(e => e.id)) : 0;
    restored.id = maxId + 1;
    events.push(restored);
    markDirty(`「${archived.title}」をイベント一覧に復元しました`);
    if (isFirebaseConnected) { writeEventsToFirebase(); } else { renderEventList(); }

    // アーカイブから削除
    archivedEvents = archivedEvents.filter(e => e.id !== id);
    markArchivedDirty(`「${archived.title}」をイベント一覧に復元しました`);
    renderArchivedList();
}

function deleteArchivedEvent(id) {
    const event = archivedEvents.find(e => e.id === id);
    if (!event) return;
    if (!confirm(`「${event.title}」をアーカイブから完全に削除しますか？\n\nこの操作は取り消せません。`)) return;
    archivedEvents = archivedEvents.filter(e => e.id !== id);
    markArchivedDirty(`「${event.title}」を完全に削除しました`);
    renderArchivedList();
}

function renderArchivedList() {
    const tbody = document.getElementById('archived-tbody');
    const desc  = document.getElementById('archived-section-desc');
    if (!tbody) return;

    if (archivedEvents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">アーカイブされたイベントはありません。</td></tr>`;
        if (desc) desc.textContent = 'アーカイブはまだありません';
        return;
    }

    if (desc) desc.textContent = `${archivedEvents.length}件のイベントがアーカイブされています`;

    tbody.innerHTML = archivedEvents
        .slice().sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''))
        .map(e => {
            const locText = Array.isArray(e.locations) && e.locations.length > 0
                ? e.locations.join('・')
                : (e.location || '—');
            const archivedDate = e.archivedAt ? new Date(e.archivedAt).toLocaleDateString('ja-JP') : '—';
            return `
            <tr>
                <td><div class="event-title-cell">${escapeHtml(e.title)}</div></td>
                <td style="white-space:nowrap; font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(e.date)}</td>
                <td style="font-size:0.82rem;">${escapeHtml(locText)}</td>
                <td><span class="category-badge ${escapeHtml(e.category)}">${escapeHtml(e.categoryText)}</span></td>
                <td style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(e.manager || '—')}</td>
                <td style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(archivedDate)}</td>
                <td>
                    <div class="td-actions">
                        <button class="btn btn-edit" onclick="restoreEvent(${Number(e.id)})">復元</button>
                        <button class="btn btn-delete" onclick="deleteArchivedEvent(${Number(e.id)})">削除</button>
                    </div>
                </td>
            </tr>`;
        }).join('');

    // ダッシュボードも更新
    if (typeof renderDashboard === 'function') renderDashboard();
}

// ---- DASHBOARD (施設稼働率) ----

const FACILITY_LIST = [
    '室内練習場', 'ベースボールエリア', 'アローズエリア', 'スタジオ',
    'バッティングブースA', 'バッティングブースB', '打撃エリア',
    '投手測定エリア', '食堂', '多目的室', 'パワーエリア'
];

const FACILITY_COLORS = [
    '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
    '#ef4444', '#ec4899', '#06b6d4', '#14b8a6',
    '#f97316', '#6366f1', '#84cc16'
];

let dashboardYear = new Date().getFullYear();
let dashboardMonth = new Date().getMonth(); // 0-indexed


function prevDashboardMonth() {
    dashboardMonth--;
    if (dashboardMonth < 0) { dashboardMonth = 11; dashboardYear--; }
    renderDashboard();
}

function nextDashboardMonth() {
    dashboardMonth++;
    if (dashboardMonth > 11) { dashboardMonth = 0; dashboardYear++; }
    renderDashboard();
}

function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

function parseDashboardTime(tStr, fallbackMinutes) {
    if (!tStr) return fallbackMinutes;
    const parts = tStr.split(':').map(Number);
    if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
        return fallbackMinutes;
    }
    return parts[0] * 60 + parts[1];
}

function formatUtilizationHours(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours}時間${minutes}分` : `${hours}時間`;
}


function getRateClass(rate) {
    if (rate === 0) return 'rate-zero';
    if (rate >= 30) return 'rate-high';
    if (rate >= 10) return 'rate-medium';
    return 'rate-low';
}


// ---- DASHBOARD: 曜日別ビュー ----

let currentDashboardView = 'facility';

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const WEEKDAY_NAMES_ORDERED = ['月', '火', '水', '木', '金', '土', '日']; // 月曜始まり
const WEEKDAY_INDEX_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Date.getDay() → 月曜始まり

function switchDashboardView(view) {
    currentDashboardView = view;
    document.querySelectorAll('.dashboard-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.dashboard-view').forEach(v => v.style.display = 'none');

    if (view === 'facility') {
        document.getElementById('tab-facility').classList.add('active');
        document.getElementById('view-facility').style.display = 'block';
    } else if (view === 'weekday') {
        document.getElementById('tab-weekday').classList.add('active');
        document.getElementById('view-weekday').style.display = 'block';
    } else if (view === 'time') {
        document.getElementById('tab-time').classList.add('active');
        document.getElementById('view-time').style.display = 'block';
    }
}


function getHeatColor(rate) {
    if (rate === 0) return 'rgba(255,255,255,0.02)';
    if (rate <= 20) return 'rgba(59,130,246,0.15)'; // Blue
    if (rate <= 40) return 'rgba(14,165,233,0.25)'; // Sky/Teal
    if (rate <= 60) return 'rgba(234,179,8,0.25)';  // Yellow
    if (rate <= 80) return 'rgba(249,115,22,0.3)';  // Orange
    return 'rgba(239,68,68,0.4)';                   // Red
}

function getHeatTextColor(rate) {
    if (rate === 0) return 'rgba(255,255,255,0.2)';
    if (rate <= 20) return '#93c5fd';
    if (rate <= 40) return '#7dd3fc';
    if (rate <= 60) return '#fde047';
    if (rate <= 80) return '#fdba74';
    return '#fca5a5';
}


// ---- DASHBOARD: 時間帯別ビュー ----

const TIME_SLOTS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]; // 8:00 - 21:00 (1時間刻み)



// ---- DASHBOARD: time-based facility utilization ----

const BUSINESS_START_MINUTES = 8 * 60;
const BUSINESS_END_MINUTES = 21 * 60;
const BUSINESS_MINUTES_PER_DAY = BUSINESS_END_MINUTES - BUSINESS_START_MINUTES;
const WEEKDAY_LABELS_ORDERED = ['月', '火', '水', '木', '金', '土', '日'];

const FACILITY_DISPLAY_NAMES = [
    '室内練習場',
    'ベースボールエリア',
    'アローズエリア',
    'スタジオ',
    'バッティングブースA',
    'バッティングブースB',
    '打席エリア',
    '投球測定エリア',
    '食堂',
    '多目的室',
    'パワーエリア'
];

function getFacilityLabel(name) {
    const idx = FACILITY_LIST.indexOf(name);
    return idx >= 0 ? FACILITY_DISPLAY_NAMES[idx] : name;
}

function getUniqueFacilities(ev) {
    const locs = Array.isArray(ev.locations) ? ev.locations : (ev.location ? [ev.location] : []);
    return [...new Set(locs)].filter(loc => FACILITY_LIST.includes(loc));
}

function clampMinutes(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function getRangeMinutesWithinBusinessHours(range) {
    const startMinutes = parseDashboardTime(range.startTime, BUSINESS_START_MINUTES);
    const endMinutes = parseDashboardTime(range.endTime, BUSINESS_END_MINUTES);
    const start = clampMinutes(startMinutes, BUSINESS_START_MINUTES, BUSINESS_END_MINUTES);
    const end = clampMinutes(endMinutes, BUSINESS_START_MINUTES, BUSINESS_END_MINUTES);
    return Math.max(end - start, 0);
}

function setupDashboardLabels() {
    const section = document.getElementById('dashboard-section');
    if (!section || section.dataset.labelsReady === 'true') return;

    const title = section.querySelector('.settings-panel-header h3');
    if (title && title.childNodes.length > 0) {
        title.childNodes[title.childNodes.length - 1].nodeValue = ' 施設稼働率ダッシュボード';
    }

    const toggleIcon = document.getElementById('dashboard-toggle-icon');
    if (toggleIcon) toggleIcon.textContent = '▲';

    const monthButtons = section.querySelectorAll('.month-nav button');
    if (monthButtons[0]) monthButtons[0].textContent = '← 前月';
    if (monthButtons[1]) monthButtons[1].textContent = '次月 →';

    const labels = section.querySelectorAll('.kpi-label');
    ['当月イベント数', '稼働施設数', '最も利用された施設', '平均稼働率'].forEach((text, i) => {
        if (labels[i]) labels[i].textContent = text;
    });

    const tabs = [
        ['tab-facility', '施設別'],
        ['tab-weekday', '曜日別'],
        ['tab-time', '時間帯別']
    ];
    tabs.forEach(([id, text]) => {
        const tab = document.getElementById(id);
        if (!tab) return;
        const textNode = [...tab.childNodes].reverse().find(node => node.nodeType === Node.TEXT_NODE);
        if (textNode) textNode.nodeValue = ` ${text}`;
    });

    const facilityHeaders = document.querySelectorAll('#view-facility th');
    ['施設名', '稼働日数', '利用時間', '稼働率', '利用イベント数'].forEach((text, i) => {
        if (facilityHeaders[i]) facilityHeaders[i].textContent = text;
    });

    const weekdayHeaders = document.querySelectorAll('#view-weekday th');
    ['施設名', '月', '火', '水', '木', '金', '土', '日', '合計'].forEach((text, i) => {
        if (weekdayHeaders[i]) weekdayHeaders[i].textContent = text;
    });

    const timeLabel = document.querySelector('label[for="time-facility-select"]');
    if (timeLabel) timeLabel.textContent = '対象施設:';
    section.dataset.labelsReady = 'true';
}

function toggleDashboard() {
    const body = document.getElementById('dashboard-body');
    const icon = document.getElementById('dashboard-toggle-icon');
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? 'block' : 'none';
    if (icon) icon.textContent = isHidden ? '▲' : '▼';
}

function populateTimeFacilitySelect() {
    const select = document.getElementById('time-facility-select');
    if (!select || select.dataset.populated === 'true') return;
    const current = select.value || 'all';
    select.innerHTML = '<option value="all">全施設平均</option>' +
        FACILITY_LIST.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(getFacilityLabel(name))}</option>`).join('');
    select.value = FACILITY_LIST.includes(current) ? current : 'all';
    select.dataset.populated = 'true';
}

function calcUtilization(year, month) {
    const allEvents = [...events, ...archivedEvents];
    const daysInMonth = getDaysInMonth(year, month);
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const availableMinutes = daysInMonth * BUSINESS_MINUTES_PER_DAY;
    const monthEvents = [];
    const facilityData = {};

    FACILITY_LIST.forEach(f => {
        facilityData[f] = { days: new Set(), eventIds: new Set(), totalMinutes: 0 };
    });

    allEvents.forEach(ev => {
        const ranges = getEventDateRanges(ev);
        const locs = getUniqueFacilities(ev);
        let touchesMonth = false;

        ranges.forEach(r => {
            if (!r.startDate) return;
            const start = new Date(r.startDate + 'T00:00:00');
            const end = new Date((r.endDate || r.startDate) + 'T00:00:00');
            const durationMinutes = getRangeMinutesWithinBusinessHours(r);
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || durationMinutes <= 0) return;

            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                if (dateStr !== monthStr) continue;
                const dayNum = d.getDate();
                touchesMonth = true;
                locs.forEach(loc => {
                    facilityData[loc].days.add(dayNum);
                    facilityData[loc].totalMinutes += durationMinutes;
                    facilityData[loc].eventIds.add(ev.id || `${ev.title || ''}-${r.startDate}-${r.startTime || ''}`);
                });
            }
        });

        if (touchesMonth) monthEvents.push(ev);
    });

    const results = FACILITY_LIST.map((name, i) => {
        const data = facilityData[name];
        const rate = availableMinutes > 0 ? Math.round((data.totalMinutes / availableMinutes) * 100) : 0;
        return {
            name,
            color: FACILITY_COLORS[i],
            activeDays: data.days.size,
            daysInMonth,
            availableMinutes,
            availableHoursText: formatUtilizationHours(availableMinutes),
            rate: Math.min(rate, 100),
            rawRate: rate,
            totalMinutes: data.totalMinutes,
            totalHoursText: formatUtilizationHours(data.totalMinutes),
            eventCount: data.eventIds.size
        };
    });

    const activeFacilities = results.filter(r => r.totalMinutes > 0).length;
    const topFacility = results.reduce((max, r) => r.totalMinutes > max.totalMinutes ? r : max, results[0]);
    const avgRate = results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.rate, 0) / results.length)
        : 0;

    return { monthEvents, results, activeFacilities, topFacility, avgRate, daysInMonth, availableMinutes };
}

function renderDashboard() {
    const label = document.getElementById('dashboard-month-label');
    const badge = document.getElementById('dashboard-badge');
    const tbody = document.getElementById('utilization-tbody');

    setupDashboardLabels();
    if (label) label.textContent = `${dashboardYear}年${dashboardMonth + 1}月`;
    populateTimeFacilitySelect();

    const allEvents = [...events, ...archivedEvents];
    if (allEvents.length === 0) {
        document.getElementById('kpi-event-count').textContent = '—';
        document.getElementById('kpi-active-facilities').textContent = '—';
        document.getElementById('kpi-top-facility').textContent = '—';
        document.getElementById('kpi-avg-rate').textContent = '—';
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="empty-state">イベントデータを読み込むと稼働率が表示されます</td></tr>';
        if (badge) badge.style.display = 'none';
        renderWeekdayView();
        renderTimeView();
        return;
    }

    if (badge) {
        badge.style.display = 'inline-block';
        badge.textContent = 'データあり';
    }

    const data = calcUtilization(dashboardYear, dashboardMonth);
    document.getElementById('kpi-event-count').textContent = data.monthEvents.length;
    document.getElementById('kpi-active-facilities').textContent = `${data.activeFacilities} / ${FACILITY_LIST.length}`;

    const topEl = document.getElementById('kpi-top-facility');
    if (data.topFacility && data.topFacility.totalMinutes > 0) {
        topEl.textContent = getFacilityLabel(data.topFacility.name);
        topEl.className = 'kpi-value kpi-small';
    } else {
        topEl.textContent = '—';
        topEl.className = 'kpi-value';
    }
    document.getElementById('kpi-avg-rate').textContent = `${data.avgRate}%`;

    if (!tbody) return;
    if (data.results.every(r => r.totalMinutes === 0)) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">この月にはイベントがありません</td></tr>';
        renderWeekdayView();
        renderTimeView();
        return;
    }

    const sorted = data.results.slice().sort((a, b) => b.rate - a.rate || b.totalMinutes - a.totalMinutes);
    tbody.innerHTML = sorted.map(r => {
        const rateClass = getRateClass(r.rate);
        const rawNote = r.rawRate > 100 ? '（100%超過）' : '';
        return `
        <tr>
            <td>
                <div class="facility-name">
                    <span class="facility-dot" style="background:${r.color};"></span>
                    ${escapeHtml(getFacilityLabel(r.name))}
                </div>
            </td>
            <td><span class="days-count"><strong>${r.activeDays}</strong> / ${r.daysInMonth}日</span></td>
            <td><span class="usage-hours"><strong>${r.totalHoursText}</strong> / ${r.availableHoursText}</span></td>
            <td class="utilization-bar-cell">
                <div class="utilization-bar-wrapper" title="利用時間 ÷ 利用可能時間（8:00-21:00）${rawNote}">
                    <div class="utilization-bar-track">
                        <div class="utilization-bar-fill ${rateClass}" style="width:${r.rate}%;"></div>
                    </div>
                    <span class="utilization-percent ${rateClass}">${r.rate}%</span>
                </div>
            </td>
            <td><span class="event-count-badge ${r.eventCount > 0 ? 'has-events' : ''}">${r.eventCount}件</span></td>
        </tr>`;
    }).join('');

    renderWeekdayView();
    renderTimeView();
}

function calcWeekdayUtilization(year, month) {
    const allEvents = [...events, ...archivedEvents];
    const daysInMonth = getDaysInMonth(year, month);
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const weekdayCounts = new Array(7).fill(0);

    for (let d = 1; d <= daysInMonth; d++) {
        weekdayCounts[new Date(year, month, d).getDay()]++;
    }

    const facilityWeekday = {};
    FACILITY_LIST.forEach(f => {
        facilityWeekday[f] = {
            minutes: new Array(7).fill(0),
            days: [new Set(), new Set(), new Set(), new Set(), new Set(), new Set(), new Set()]
        };
    });

    allEvents.forEach(ev => {
        const locs = getUniqueFacilities(ev);
        getEventDateRanges(ev).forEach(r => {
            if (!r.startDate) return;
            const start = new Date(r.startDate + 'T00:00:00');
            const end = new Date((r.endDate || r.startDate) + 'T00:00:00');
            const durationMinutes = getRangeMinutesWithinBusinessHours(r);
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || durationMinutes <= 0) return;

            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                if (dateStr !== monthStr) continue;
                const dow = d.getDay();
                const dayNum = d.getDate();
                locs.forEach(loc => {
                    facilityWeekday[loc].minutes[dow] += durationMinutes;
                    facilityWeekday[loc].days[dow].add(dayNum);
                });
            }
        });
    });

    const results = FACILITY_LIST.map((name, i) => {
        const data = facilityWeekday[name];
        const weekdayData = WEEKDAY_INDEX_ORDER.map(dow => {
            const available = weekdayCounts[dow] * BUSINESS_MINUTES_PER_DAY;
            const rawRate = available > 0 ? Math.round((data.minutes[dow] / available) * 100) : 0;
            return {
                minutes: data.minutes[dow],
                days: data.days[dow].size,
                availableMinutes: available,
                rate: Math.min(rawRate, 100),
                rawRate
            };
        });
        const totalMinutes = data.minutes.reduce((sum, minutes) => sum + minutes, 0);
        const availableMinutes = daysInMonth * BUSINESS_MINUTES_PER_DAY;
        const totalRate = availableMinutes > 0 ? Math.min(Math.round((totalMinutes / availableMinutes) * 100), 100) : 0;
        return { name, color: FACILITY_COLORS[i], weekdayData, totalMinutes, totalRate };
    });

    const weekdaySummary = WEEKDAY_INDEX_ORDER.map((dow, idx) => {
        const totalMinutes = results.reduce((sum, r) => sum + r.weekdayData[idx].minutes, 0);
        const maxPossible = weekdayCounts[dow] * BUSINESS_MINUTES_PER_DAY * FACILITY_LIST.length;
        return {
            label: WEEKDAY_LABELS_ORDERED[idx],
            minutes: totalMinutes,
            maxCount: weekdayCounts[dow],
            avgRate: maxPossible > 0 ? Math.min(Math.round((totalMinutes / maxPossible) * 100), 100) : 0
        };
    });

    return { results, weekdaySummary, weekdayCounts, daysInMonth };
}

function renderWeekdayView() {
    const tbody = document.getElementById('weekday-tbody');
    const summaryGrid = document.getElementById('weekday-summary-grid');
    if (!tbody) return;

    const allEvents = [...events, ...archivedEvents];
    if (allEvents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-state">イベントデータを読み込むと曜日別稼働率が表示されます</td></tr>';
        if (summaryGrid) summaryGrid.innerHTML = '';
        return;
    }

    const data = calcWeekdayUtilization(dashboardYear, dashboardMonth);
    if (summaryGrid) {
        summaryGrid.innerHTML = data.weekdaySummary.map((ws, idx) => {
            const isWeekend = idx >= 5;
            const barHeight = Math.max(ws.avgRate, 2);
            return `
            <div class="weekday-summary-card ${isWeekend ? 'weekend' : ''}">
                <div class="weekday-bar-container">
                    <div class="weekday-bar" style="height:${barHeight}%;background:${ws.avgRate > 0 ? (isWeekend ? 'linear-gradient(180deg, #f59e0b, #fbbf24)' : 'linear-gradient(180deg, #3b82f6, #60a5fa)') : 'rgba(255,255,255,0.08)'};"></div>
                </div>
                <div class="weekday-summary-label">${ws.label}</div>
                <div class="weekday-summary-rate">${ws.avgRate}%</div>
                <div class="weekday-summary-count">${formatUtilizationHours(ws.minutes)}</div>
            </div>`;
        }).join('');
    }

    if (data.results.every(r => r.totalMinutes === 0)) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-state">この月にはイベントがありません</td></tr>';
        return;
    }

    const sorted = data.results.slice().sort((a, b) => b.totalMinutes - a.totalMinutes);
    tbody.innerHTML = sorted.map(r => {
        const weekdayCells = r.weekdayData.map(wd => {
            const bg = getHeatColor(wd.rate);
            const textColor = getHeatTextColor(wd.rate);
            const displayValue = wd.rate > 0 ? `${wd.rate}<span style="font-size:0.65em">%</span>` : '<span style="opacity:0.3">-</span>';
            return `<td class="weekday-heat-cell" style="background:${bg};" title="利用時間: ${formatUtilizationHours(wd.minutes)} / 利用可能: ${formatUtilizationHours(wd.availableMinutes)}">
                <div class="weekday-heat-value" style="color:${textColor};">${displayValue}</div>
            </td>`;
        }).join('');
        const totalRateClass = getRateClass(r.totalRate);
        return `
        <tr>
            <td>
                <div class="facility-name">
                    <span class="facility-dot" style="background:${r.color};"></span>
                    ${escapeHtml(getFacilityLabel(r.name))}
                </div>
            </td>
            ${weekdayCells}
            <td>
                <div class="weekday-total">
                    <strong>${formatUtilizationHours(r.totalMinutes)}</strong>
                    <span class="utilization-percent ${totalRateClass}" style="font-size:0.75rem;">${r.totalRate}%</span>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function calcTimeUtilization(year, month, targetFacility) {
    const allEvents = [...events, ...archivedEvents];
    const daysInMonth = getDaysInMonth(year, month);
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const weekdayCounts = new Array(7).fill(0);

    for (let d = 1; d <= daysInMonth; d++) {
        weekdayCounts[new Date(year, month, d).getDay()]++;
    }

    const timeData = WEEKDAY_INDEX_ORDER.map(() => {
        const hourMap = {};
        TIME_SLOTS.forEach(h => hourMap[h] = new Set());
        return hourMap;
    });

    const checkOverlap = (h, startMinutes, endMinutes) => {
        const slotStart = h * 60;
        const slotEnd = (h + 1) * 60;
        return startMinutes < slotEnd && endMinutes > slotStart;
    };

    allEvents.forEach(ev => {
        const locs = getUniqueFacilities(ev);
        const validLocs = locs.filter(l => targetFacility === 'all' ? true : l === targetFacility);
        if (validLocs.length === 0) return;

        getEventDateRanges(ev).forEach(r => {
            if (!r.startDate) return;
            const start = new Date(r.startDate + 'T00:00:00');
            const end = new Date((r.endDate || r.startDate) + 'T00:00:00');
            const startMinutes = clampMinutes(parseDashboardTime(r.startTime, BUSINESS_START_MINUTES), BUSINESS_START_MINUTES, BUSINESS_END_MINUTES);
            const endMinutes = clampMinutes(parseDashboardTime(r.endTime, BUSINESS_END_MINUTES), BUSINESS_START_MINUTES, BUSINESS_END_MINUTES);
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || endMinutes <= startMinutes) return;

            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                if (dateStr !== monthStr) continue;
                const dayNum = d.getDate();
                const dowIndex = WEEKDAY_INDEX_ORDER.indexOf(d.getDay());
                if (dowIndex === -1) continue;
                TIME_SLOTS.forEach(h => {
                    if (!checkOverlap(h, startMinutes, endMinutes)) return;
                    if (targetFacility === 'all') {
                        validLocs.forEach(loc => timeData[dowIndex][h].add(`${dayNum}-${loc}`));
                    } else {
                        timeData[dowIndex][h].add(dayNum);
                    }
                });
            }
        });
    });

    return { timeData, weekdayCounts };
}

function renderTimeView() {
    const table = document.getElementById('time-table');
    if (!table) return;
    populateTimeFacilitySelect();

    const allEvents = [...events, ...archivedEvents];
    if (allEvents.length === 0) {
        table.innerHTML = '<tbody><tr><td class="empty-state">イベントデータを読み込むと時間帯別稼働率が表示されます</td></tr></tbody>';
        return;
    }

    const selectEl = document.getElementById('time-facility-select');
    const targetFacility = selectEl ? selectEl.value : 'all';
    const { timeData, weekdayCounts } = calcTimeUtilization(dashboardYear, dashboardMonth, targetFacility);

    let theadHtml = '<thead><tr><th>曜日 \\ 時間</th>';
    TIME_SLOTS.forEach(h => {
        theadHtml += `<th><div style="font-size:0.75rem;">${h}:00</div></th>`;
    });
    theadHtml += '</tr></thead>';

    let tbodyHtml = '<tbody>';
    WEEKDAY_INDEX_ORDER.forEach((dow, idx) => {
        const dowLabel = WEEKDAY_LABELS_ORDERED[idx];
        const isWeekend = idx >= 5;
        tbodyHtml += `<tr><td style="font-weight:600; color:${isWeekend ? '#fbbf24' : 'var(--text-primary)'};">${dowLabel}</td>`;

        const daysThisMonth = weekdayCounts[dow];
        const maxPossible = targetFacility === 'all' ? daysThisMonth * FACILITY_LIST.length : daysThisMonth;
        TIME_SLOTS.forEach(h => {
            const count = timeData[idx][h].size;
            const rate = maxPossible > 0 ? Math.min(Math.round((count / maxPossible) * 100), 100) : 0;
            const displayValue = rate > 0 ? `${rate}<span style="font-size:0.65em">%</span>` : '<span style="opacity:0.3">-</span>';
            const titleText = targetFacility === 'all'
                ? `利用枠: ${count} / 最大${maxPossible}（全施設合計）`
                : `利用日数: ${count}日 / 最大${maxPossible}日`;
            tbodyHtml += `<td class="weekday-heat-cell" style="background:${getHeatColor(rate)}; padding: 0.4rem 0.2rem !important;" title="${titleText}">
                <div class="weekday-heat-value" style="color:${getHeatTextColor(rate)}; font-size:0.85rem;">${displayValue}</div>
            </td>`;
        });
        tbodyHtml += '</tr>';
    });
    tbodyHtml += '</tbody>';
    table.innerHTML = theadHtml + tbodyHtml;
}

// ---- INIT ----
loadConfig();
loadFirebaseConfig();
renderEventList();
renderReportList();
renderArchivedList();
renderDashboard();



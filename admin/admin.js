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
        renderEventList();
        toggleSettings(); // Collapse settings after successful connection
        showStatus(`読み込み完了！ ${events.length}件のイベントが見つかりました。`, 'success');
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
    if (isDirty) {
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

function checkOverlaps(targetEvent, allEvents) {
    return allEvents.filter(e => {
        // 自分自身は除外
        if (e.id === targetEvent.id) return false;

        // 1. 場所の被りチェック（どちらか空、または「その他」のみは除外）
        const locsT = Array.isArray(targetEvent.locations) ? targetEvent.locations : (targetEvent.location ? [targetEvent.location] : []);
        const locsE = Array.isArray(e.locations) ? e.locations : (e.location ? [e.location] : []);
        const sharedLocs = locsT.filter(l => l !== 'その他' && locsE.includes(l));
        if (sharedLocs.length === 0) return false;

        // 2. 日付の被りチェック
        const tStart = targetEvent.startDate;
        const tEnd = targetEvent.endDate || targetEvent.startDate;
        const eStart = e.startDate;
        const eEnd = e.endDate || e.startDate;
        if (tStart > eEnd || tEnd < eStart) return false;

        // 3. 時間帯の被りチェック
        if (!targetEvent.startTime || !e.startTime) return true; // 終日イベントがあれば重なりとみなす

        const parseTime = (tStr, isEnd) => {
            if (!tStr) return isEnd ? 24 * 60 : 0;
            const parts = tStr.split(':').map(Number);
            return parts[0] * 60 + parts[1];
        };
        const tTimeStart = parseTime(targetEvent.startTime, false);
        const tTimeEnd   = parseTime(targetEvent.endTime, true);
        const eTimeStart = parseTime(e.startTime, false);
        const eTimeEnd   = parseTime(e.endTime, true);

        // 重ならない条件: 前者が後者の開始以下、または前者の開始が後者の終了以上
        if (tTimeEnd <= eTimeStart || tTimeStart >= eTimeEnd) return false;

        return true;
    });
}

function renderEventList() {
    const tbody = document.getElementById('events-tbody');
    const desc  = document.getElementById('section-desc');

    if (events.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">イベントがありません。「＋ イベントを追加」から追加してください。</td></tr>`;
        if (desc) desc.textContent = 'イベントはまだありません';
        return;
    }

    if (desc) desc.textContent = `${events.length}件のイベントが登録されています`;

    tbody.innerHTML = events.map(e => {
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
            ? `<div class="overlap-badge" title="以下のイベントと重複しています:\n${overlaps.map(o => '- ' + o.title).join('\n')}">⚠️ ブッキング</div>` 
            : '';

        return `
        <tr class="${overlaps.length > 0 ? 'row-overlap' : ''}">
            <td>
                <div class="event-title-cell">${escapeHtml(e.title)} ${overlapWarning}</div>
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
                    <button class="btn btn-delete" onclick="deleteEvent(${Number(e.id)})">削除</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ---- CRUD ----

function deleteEvent(id) {
    const event = events.find(e => e.id === id);
    if (!event) return;
    if (!confirm(`「${event.title}」を削除してよいですか？\n\n※「公開サイトに反映する」を押すまで実際のサイトは変わりません。`)) return;
    events = events.filter(e => e.id !== id);
    renderEventList();
    markDirty(`「${event.title}」を削除しました`);
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
    document.getElementById('f-startDate').value      = event.startDate;
    document.getElementById('f-endDate').value        = (event.endDate && event.endDate !== event.startDate) ? event.endDate : '';
    document.getElementById('f-startTime').value      = event.startTime || '';
    document.getElementById('f-endTime').value        = event.endTime   || '';
    document.getElementById('f-category-input').value = event.categoryText || '';
    document.getElementById('f-card-color').value     = event.cardColor || '#000000';
    document.getElementById('f-participants').value   = event.participants || '';
    document.getElementById('f-manager').value        = event.manager || '';
    document.getElementById('f-notes').value          = event.notes || '';

    // 開催場所チェックボックス
    const locs = Array.isArray(event.locations) ? event.locations : [];
    document.querySelectorAll('.location-checkbox').forEach(cb => {
        cb.checked = locs.includes(cb.value);
    });

    // HP/SNS
    const snsVal = event.snsPR || 'not-allowed';
    const snsRadio = document.querySelector(`input[name="f-sns"][value="${snsVal}"]`);
    if (snsRadio) snsRadio.checked = true;
    document.getElementById('f-sns-date').value = event.snsAvailableFrom || '';
    document.getElementById('sns-date-row').style.display = snsVal === 'allowed' ? 'block' : 'none';

    document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
}

function getCategoryClass(text) {
    const t = (text || '').toLowerCase();
    if (/ヘルス|健康|health|wellness/.test(t)) return 'health';
    if (/研修|学習|training|learning/.test(t))  return 'learning';
    if (/交流|懇親|social/.test(t))              return 'social';
    return 'other';
}

function clearForm() {
    ['f-title','f-startDate','f-endDate','f-startTime','f-endTime',
     'f-category-input','f-participants','f-sns-date','f-manager','f-notes']
        .forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('f-card-color').value = '#000000';
    document.querySelectorAll('.location-checkbox').forEach(cb => { cb.checked = false; });
    const defaultSns = document.querySelector('input[name="f-sns"][value="not-allowed"]');
    if (defaultSns) defaultSns.checked = true;
    document.getElementById('sns-date-row').style.display = 'none';
}

function toggleSnsDate() {
    const val = document.querySelector('input[name="f-sns"]:checked')?.value;
    document.getElementById('sns-date-row').style.display = val === 'allowed' ? 'block' : 'none';
}

function saveEvent() {
    const title     = document.getElementById('f-title').value.trim();
    const startDate = document.getElementById('f-startDate').value.trim();

    if (!title)     { alert('タイトルを入力してください'); return; }
    if (!startDate) { alert('開始日を選択してください'); return; }

    const endDate      = document.getElementById('f-endDate').value.trim() || startDate;
    const startTime    = document.getElementById('f-startTime').value.trim();
    const endTime      = document.getElementById('f-endTime').value.trim();
    const categoryText = document.getElementById('f-category-input').value.trim() || 'その他';
    const category     = getCategoryClass(categoryText);

    const locations    = Array.from(document.querySelectorAll('.location-checkbox:checked')).map(cb => cb.value);
    const participants = document.getElementById('f-participants').value.trim();
    const snsPR        = document.querySelector('input[name="f-sns"]:checked')?.value || 'not-allowed';
    const snsAvailableFrom = snsPR === 'allowed' ? document.getElementById('f-sns-date').value.trim() : '';
    const manager      = document.getElementById('f-manager').value.trim();
    const notes        = document.getElementById('f-notes').value.trim();
    let cardColor      = document.getElementById('f-card-color').value;
    if (cardColor === '#000000') cardColor = '';

    // 日付・時刻の表示テキストを自動生成
    const fmt = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getMonth()+1}月${d.getDate()}日`; };
    let date = endDate !== startDate ? `${fmt(startDate)} - ${fmt(endDate)}` : fmt(startDate);
    if (startTime) date += ` ${startTime}${endTime ? ' - ' + endTime : ''}`;

    const tempId = editingId !== null ? editingId : -1;
    const eventData = { id: tempId, title, date, startDate, endDate, startTime, endTime, category, categoryText, cardColor, locations, participants, snsPR, snsAvailableFrom, manager, notes };

    // 保存前の重複チェック
    const overlaps = checkOverlaps(eventData, events);
    if (overlaps.length > 0) {
        const msg = `⚠️ ブッキング警告\n\n以下のイベントと場所・日時の予約が重なっています:\n` 
            + overlaps.map(o => `・${o.title}`).join('\n') 
            + `\n\nこのまま保存（登録）してよろしいでしょうか？`;
        if (!confirm(msg)) {
            return; // 保存中止
        }
    }

    if (editingId !== null) {
        const idx = events.findIndex(e => e.id === editingId);
        if (idx !== -1) events[idx] = eventData;
        closeModal();
        renderEventList();
        markDirty(`「${title}」を編集しました`);
    } else {
        const maxId = events.length > 0 ? Math.max(...events.map(e => e.id)) : 0;
        eventData.id = maxId + 1;
        events.push(eventData);
        closeModal();
        renderEventList();
        markDirty(`「${title}」を追加しました`);
    }
}

// ---- TOKEN GUIDE ----

function openTokenGuide() {
    document.getElementById('token-guide-overlay').style.display = 'flex';
}

function closeTokenGuide() {
    document.getElementById('token-guide-overlay').style.display = 'none';
}

// Close modals on overlay click
['modal-overlay', 'token-guide-overlay'].forEach(id => {
    document.getElementById(id).addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            e.currentTarget.style.display = 'none';
        }
    });
});

// ---- INIT ----
loadConfig();
renderEventList();

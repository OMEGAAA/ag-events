let events = [];

const SNS_LABEL = {
    'allowed':     { text: '掲載可',  cls: 'sns-allowed',     icon: '✅' },
    'not-allowed': { text: '掲載不可', cls: 'sns-not-allowed', icon: '🚫' },
    'pending':     { text: '要確認',  cls: 'sns-pending',     icon: '⚠️' }
};

const today = new Date();
let currentGanttStartDate = new Date(today.getFullYear(), today.getMonth(), 1);
let currentGanttDays = 30;
let currentDayDate   = new Date();
let calendarMode     = 'gantt'; // 'gantt' | 'day'
let dayViewTimer     = null;

function startDayViewTimer() {
    stopDayViewTimer();
    dayViewTimer = setInterval(() => {
        if (currentDayDate.toDateString() !== new Date().toDateString()) return;
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        document.querySelectorAll('.day-current-time').forEach(line => {
            line.style.top = `${nowMin}px`;
        });
    }, 30000); // 30秒ごとに更新
}

function stopDayViewTimer() {
    if (dayViewTimer) { clearInterval(dayViewTimer); dayViewTimer = null; }
}

// ---- UTILS ----
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ---- FETCH ----
async function init() {
    try {
        const res = await fetch('./events.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        events = await res.json();
    } catch (e) {
        console.warn('events.json の読み込みに失敗しました:', e);
        events = [];
    }
    renderEvents();
}

// ---- HOME VIEW ----
function renderEvents() {
    const eventGrid = document.getElementById('event-grid');
    if (!eventGrid) return;
    eventGrid.innerHTML = '';

    const filtered = [...events].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    if (filtered.length === 0) {
        eventGrid.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:4rem 0;grid-column:1/-1;">イベントがありません</p>';
        return;
    }

    filtered.forEach(e => {
        const locationText = Array.isArray(e.locations) && e.locations.length > 0
            ? e.locations.join(' / ')
            : (e.location || '');
        const participantsText = e.participants || e.capacity || '';
        const isFull   = participantsText.includes('満席');
        const btnText  = isFull ? 'キャンセル待ち' : '予約する';
        const timeText = e.startTime
            ? `${e.startTime}${e.endTime ? ' 〜 ' + e.endTime : ''}`
            : '';

        const card = document.createElement('div');
        card.className = `event-card ${escapeHtml(e.category)}`;
        card.innerHTML = `
            <div class="card-visual">
                <div class="visual-gradient ${escapeHtml(e.category)}"></div>
                <div class="category-tag">${escapeHtml(e.categoryText)}</div>
            </div>
            <div class="card-content">
                <div class="event-date">${escapeHtml(e.date)}</div>
                ${timeText ? `<div class="event-time">🕐 ${escapeHtml(timeText)}</div>` : ''}
                <h3 class="event-title">${escapeHtml(e.title)}</h3>
                ${locationText    ? `<div class="event-meta">📍 ${escapeHtml(locationText)}</div>`    : ''}
                ${participantsText? `<div class="event-meta">👥 ${escapeHtml(participantsText)}</div>` : ''}
                ${e.manager       ? `<div class="event-meta">👤 担当: ${escapeHtml(e.manager)}</div>` : ''}
                ${(() => { const s = SNS_LABEL[e.snsPR]; return s ? `<div class="event-meta"><span class="sns-badge ${s.cls}">${s.icon} HP/SNS: ${s.text}</span>${e.snsPR === 'allowed' && e.snsAvailableFrom ? `<span class="sns-date-hint">(${escapeHtml(e.snsAvailableFrom)}〜)</span>` : ''}</div>` : ''; })()}
                <div class="card-footer">
                    <button class="detail-btn" onclick="openDetail(${e.id})">詳細を見る</button>
                </div>
            </div>
        `;
        eventGrid.appendChild(card);
    });
}

// ---- DETAIL MODAL ----
function openDetail(id) {
    const e = events.find(ev => ev.id === id);
    if (!e) return;

    const locHtml = Array.isArray(e.locations) && e.locations.length > 0
        ? e.locations.map(l => `<span class="detail-loc-tag">${escapeHtml(l)}</span>`).join('')
        : (e.location ? `<span class="detail-loc-tag">${escapeHtml(e.location)}</span>` : '');

    const timeRange = e.startTime
        ? `${escapeHtml(e.startTime)}${e.endTime ? ' 〜 ' + escapeHtml(e.endTime) : ''}`
        : '';

    document.getElementById('detail-content').innerHTML = `
        <div class="detail-banner visual-gradient ${escapeHtml(e.category)}"></div>
        <div class="detail-body">
            <span class="detail-cat-badge category-tag" style="position:static; display:inline-block; margin-bottom:0.75rem;">${escapeHtml(e.categoryText)}</span>
            <h2 class="detail-title">${escapeHtml(e.title)}</h2>
            <div class="detail-grid">
                <div class="detail-row">
                    <div class="detail-label">日程</div>
                    <div class="detail-value">
                        ${escapeHtml(e.date)}
                        ${timeRange ? `<span class="detail-time">${timeRange}</span>` : ''}
                    </div>
                </div>
                ${locHtml ? `
                <div class="detail-row">
                    <div class="detail-label">開催場所</div>
                    <div class="detail-value detail-locs">${locHtml}</div>
                </div>` : ''}
                ${e.participants ? `
                <div class="detail-row">
                    <div class="detail-label">参加人数</div>
                    <div class="detail-value">${escapeHtml(e.participants)}</div>
                </div>` : ''}
                ${e.manager ? `
                <div class="detail-row">
                    <div class="detail-label">担当者</div>
                    <div class="detail-value">${escapeHtml(e.manager)}</div>
                </div>` : ''}
                ${(() => {
                    const s = SNS_LABEL[e.snsPR];
                    if (!s) return '';
                    let dateHint = '';
                    if (e.snsPR === 'allowed' && e.snsAvailableFrom) {
                        dateHint = `<div style="font-size:0.85rem; color:var(--text-secondary); margin-top:0.25rem;">${escapeHtml(e.snsAvailableFrom)} 以降に告知可能</div>`;
                    }
                    return `
                <div class="detail-row">
                    <div class="detail-label">HP/SNS掲載</div>
                    <div class="detail-value"><span class="sns-badge ${s.cls}">${s.icon} ${s.text}</span>${dateHint}</div>
                </div>`;
                })()}
                ${e.notes ? `
                <div class="detail-row full">
                    <div class="detail-label">備考</div>
                    <div class="detail-value detail-notes">${escapeHtml(e.notes)}</div>
                </div>` : ''}
            </div>

        </div>
    `;

    document.getElementById('detail-overlay').style.display = 'flex';
}

function closeDetail() {
    document.getElementById('detail-overlay').style.display = 'none';
}

document.getElementById('detail-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeDetail();
});

// ---- GANTT CHART ----
function updateGanttDateLabel() {
    const label = document.getElementById('gantt-current-date-label');
    if (!label) return;
    const end = new Date(currentGanttStartDate);
    end.setDate(end.getDate() + currentGanttDays - 1);
    const s = `${currentGanttStartDate.getMonth() + 1}/${currentGanttStartDate.getDate()}`;
    const t = `${end.getMonth() + 1}/${end.getDate()}`;
    label.textContent = `${currentGanttStartDate.getFullYear()}年 ${s} - ${t}`;
}

document.getElementById('gantt-prev')?.addEventListener('click', () => {
    currentGanttStartDate.setDate(currentGanttStartDate.getDate() - Math.max(1, Math.floor(currentGanttDays / 2)));
    updateGanttDateLabel();
    renderGantt();
});

document.getElementById('gantt-next')?.addEventListener('click', () => {
    currentGanttStartDate.setDate(currentGanttStartDate.getDate() + Math.max(1, Math.floor(currentGanttDays / 2)));
    updateGanttDateLabel();
    renderGantt();
});

function renderGantt() {
    const container = document.getElementById('gantt-tracks');
    const header    = document.getElementById('gantt-header-days');
    if (!container || !header) return;

    container.innerHTML = '';
    header.innerHTML    = '';

    const startDate = new Date(currentGanttStartDate);
    const totalDays = currentGanttDays;
    const endDate   = new Date(startDate);
    endDate.setDate(startDate.getDate() + totalDays - 1);

    const todayStr = new Date().toDateString();

    for (let i = 0; i < totalDays; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        const isToday = d.toDateString() === todayStr;
        const str = `${d.getMonth() + 1}/${d.getDate()}`;
        header.innerHTML += `<div class="gantt-day${isToday ? ' gantt-day-today' : ''}">${str}</div>`;
    }

    // 今日の赤い縦線の位置を計算
    const todayDate = new Date();
    todayDate.setHours(0,0,0,0);
    const startClean = new Date(startDate);
    startClean.setHours(0,0,0,0);
    const todayDiff = (todayDate - startClean) / 86400000;
    const showTodayLine = todayDiff >= 0 && todayDiff <= totalDays;
    const todayLeft = ((todayDiff + 0.5) / totalDays) * 100; // 日付セルの中央

    [...events]
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
        .forEach(e => {
            const eStart = new Date(e.startDate);
            let eEnd = new Date(e.endDate);
            if (eStart > eEnd) eEnd = eStart;
            if (eEnd < startDate || eStart > endDate) return;

            const vStart = eStart < startDate ? startDate : eStart;
            const vEnd   = eEnd   > endDate   ? endDate   : eEnd;
            const diff   = (vStart - startDate) / 86400000;
            const dur    = ((vEnd - vStart) / 86400000) + 1;
            const left   = (diff / totalDays) * 100;
            const width  = (dur  / totalDays) * 100;
            const lFade  = eStart < startDate ? 'border-top-left-radius:0;border-bottom-left-radius:0;opacity:0.7;' : '';
            const rFade  = eEnd   > endDate   ? 'border-top-right-radius:0;border-bottom-right-radius:0;opacity:0.7;' : '';
            const locLabel = Array.isArray(e.locations) && e.locations.length > 0
                ? e.locations.join('・')
                : (e.location || '');

            const track = document.createElement('div');
            track.className = 'gantt-track';
            track.innerHTML = `
                <div class="gantt-label">
                    ${escapeHtml(e.title)}
                    <span>${escapeHtml(e.date)}${locLabel ? ' / ' + escapeHtml(locLabel) : ''}</span>
                </div>
                <div class="gantt-bars-container" style="min-width: ${totalDays * 38}px;">
                    ${showTodayLine ? `<div class="gantt-today-line" style="left:${todayLeft}%"></div>` : ''}
                    <div class="gantt-bar ${escapeHtml(e.category)}"
                        style="left:${left}%;width:${width}%;${lFade}${rFade}"
                        title="${escapeHtml(e.title)}"
                        onclick="openDetail(${e.id})">
                        ${escapeHtml(e.categoryText)}
                    </div>
                </div>
            `;
            container.appendChild(track);
        });
}

// ---- 1日 VIEW ----
function updateDayLabel() {
    const label = document.getElementById('day-date-label');
    if (!label) return;
    const DAYS = ['日', '月', '火', '水', '木', '金', '土'];
    const d = currentDayDate;
    label.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${DAYS[d.getDay()]})`;
}

document.getElementById('day-prev')?.addEventListener('click', () => {
    currentDayDate = new Date(currentDayDate);
    currentDayDate.setDate(currentDayDate.getDate() - 1);
    renderDayView();
});

document.getElementById('day-next')?.addEventListener('click', () => {
    currentDayDate = new Date(currentDayDate);
    currentDayDate.setDate(currentDayDate.getDate() + 1);
    renderDayView();
});

document.getElementById('day-today')?.addEventListener('click', () => {
    currentDayDate = new Date();
    renderDayView();
});

function renderDayView() {
    updateDayLabel();

    const container = document.getElementById('day-timeline-container');
    const alldayDiv = document.getElementById('day-allday-events');
    if (!container) return;

    alldayDiv.innerHTML = '';
    container.innerHTML = '';

    const dayStr    = currentDayDate.toISOString().slice(0, 10);
    const dayEvents = events.filter(e => e.startDate <= dayStr && e.endDate >= dayStr);

    // Separate all-day and timed events
    const allDayEvents = dayEvents.filter(e => !e.startTime);
    const timedEvents  = dayEvents.filter(e => e.startTime);

    allDayEvents.forEach(e => {
        const block = document.createElement('div');
        block.className   = `day-allday-event ${escapeHtml(e.category)}`;
        block.textContent = e.title;
        block.onclick     = () => openDetail(e.id);
        alldayDiv.appendChild(block);
    });

    // Collect unique locations (preserve insertion order)
    const locationSet = new Set();
    timedEvents.forEach(e => {
        const locs = Array.isArray(e.locations) && e.locations.length > 0 ? e.locations : ['その他'];
        locs.forEach(l => locationSet.add(l));
    });
    const locations = [...locationSet];

    // Time labels column (with spacer for location header row)
    const labelsDiv = document.createElement('div');
    labelsDiv.className = 'day-time-labels';
    const spacer = document.createElement('div');
    spacer.className = 'day-loc-header-spacer';
    labelsDiv.appendChild(spacer);
    for (let h = 0; h < 24; h++) {
        const lbl = document.createElement('div');
        lbl.className   = 'day-time-label';
        lbl.textContent = `${String(h).padStart(2, '0')}:00`;
        labelsDiv.appendChild(lbl);
    }
    container.appendChild(labelsDiv);

    // Location columns wrapper
    const colsWrapper = document.createElement('div');
    colsWrapper.className = 'day-location-columns';

    const now = new Date();
    locations.forEach(loc => {
        const colDiv = document.createElement('div');
        colDiv.className = 'day-location-col';

        const header = document.createElement('div');
        header.className   = 'day-location-header';
        header.textContent = loc;
        colDiv.appendChild(header);

        const eventsCol = document.createElement('div');
        eventsCol.className = 'day-events-col';

        for (let h = 0; h < 24; h++) {
            const slot = document.createElement('div');
            slot.className = 'day-time-slot';
            eventsCol.appendChild(slot);
        }

        if (currentDayDate.toDateString() === now.toDateString()) {
            const nowMin = now.getHours() * 60 + now.getMinutes();
            const line = document.createElement('div');
            line.className = 'day-current-time';
            line.style.top = `${nowMin}px`;
            eventsCol.appendChild(line);
        }

        timedEvents.forEach(e => {
            const eLocs = Array.isArray(e.locations) && e.locations.length > 0 ? e.locations : ['その他'];
            if (!eLocs.includes(loc)) return;

            const [sh, sm] = e.startTime.split(':').map(Number);
            const etStr    = e.endTime || `${Math.min(sh + 1, 23)}:00`;
            const [eh, em] = etStr.split(':').map(Number);
            const topPx    = sh * 60 + sm;
            const heightPx = Math.max(32, (eh * 60 + em) - topPx);

            const block = document.createElement('div');
            block.className    = `day-event-block ${escapeHtml(e.category)}`;
            block.style.top    = `${topPx}px`;
            block.style.height = `${heightPx}px`;
            block.innerHTML    = `
                <div class="day-event-time">${escapeHtml(e.startTime)}${e.endTime ? ' - ' + escapeHtml(e.endTime) : ''}</div>
                <div class="day-event-title">${escapeHtml(e.title)}</div>
            `;
            block.onclick = () => openDetail(e.id);
            eventsCol.appendChild(block);
        });

        colDiv.appendChild(eventsCol);
        colsWrapper.appendChild(colDiv);
    });

    container.appendChild(colsWrapper);

    // Scroll to current time or 8am
    const scrollTo = currentDayDate.toDateString() === now.toDateString()
        ? Math.max(0, now.getHours() * 60 - 60)
        : 8 * 60;
    setTimeout(() => { container.scrollTop = scrollTo; }, 50);

    startDayViewTimer();
}

// ---- VIEW BUTTONS ----
document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', e => {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');

        const days = parseInt(e.target.dataset.days);

        if (days === 1) {
            calendarMode = 'day';
            document.getElementById('gantt-view-container').style.display = 'none';
            document.getElementById('day-view-container').style.display   = 'block';
            document.getElementById('gantt-nav').style.display            = 'none';
            document.getElementById('day-nav').style.display              = 'flex';
            document.getElementById('calendar-title').textContent         = '1日スケジュール';
            document.getElementById('calendar-desc').textContent          = '選択した日のイベントを時系列で確認できます。';
            renderDayView();
        } else {
            calendarMode = 'gantt';
            stopDayViewTimer();
            document.getElementById('gantt-view-container').style.display = 'block';
            document.getElementById('day-view-container').style.display   = 'none';
            document.getElementById('gantt-nav').style.display            = 'flex';
            document.getElementById('day-nav').style.display              = 'none';
            document.getElementById('calendar-title').textContent         = '月間スケジュール';
            document.getElementById('calendar-desc').textContent          = '現在予定されている社内イベントのスケジュール進行（ガントチャート）です。';
            currentGanttDays = days;
            updateGanttDateLabel();
            renderGantt();
        }
    });
});

// ---- NAVIGATION ----
const navHome     = document.getElementById('nav-home');
const navCalendar = document.getElementById('nav-calendar');
const viewHome    = document.getElementById('view-home');
const viewCal     = document.getElementById('view-calendar');

navHome?.addEventListener('click', e => {
    e.preventDefault();
    stopDayViewTimer();
    navHome.classList.add('active');
    navCalendar.classList.remove('active');
    viewHome.style.display = 'block';
    viewCal.style.display  = 'none';
});

navCalendar?.addEventListener('click', e => {
    e.preventDefault();
    navCalendar.classList.add('active');
    navHome.classList.remove('active');
    viewHome.style.display = 'none';
    viewCal.style.display  = 'block';

    if (calendarMode === 'day') {
        renderDayView();
    } else {
        updateGanttDateLabel();
        renderGantt();
    }
});

// ---- START ----
init();

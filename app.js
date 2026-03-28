let events = [];

const SNS_LABEL = {
    'allowed':     { text: '掲載可',  cls: 'sns-allowed',     icon: '✅' },
    'not-allowed': { text: '掲載不可', cls: 'sns-not-allowed', icon: '🚫' },
    'pending':     { text: '要確認',  cls: 'sns-pending',     icon: '⚠️' }
};

const today = new Date();
let currentGanttStartDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
let currentGanttDays = 30;
let currentDayDate   = new Date();
let calendarMode     = 'gantt'; // 'gantt' | 'day'
let dayViewTimer     = null;
let ganttDayWidth    = 38; // px per day column
const GANTT_ZOOM_STEPS = [24, 38, 56, 80, 120];

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
        card.className = `home-list-card ${escapeHtml(e.category)} fade-in`;
        if (e.cardColor) card.style.setProperty('--card-color', e.cardColor);
        card.onclick = () => openDetail(e.id);

        const snsHtml = (() => { const s = SNS_LABEL[e.snsPR]; return s ? `<span class="sns-badge ${s.cls}" style="transform: scale(0.85); transform-origin: left; margin-left:-0.2rem;">${s.icon} ${s.text}</span>` : ''; })();

        card.innerHTML = `
            <div class="list-card-date">
                <div class="lc-date">${escapeHtml(e.date)}</div>
                ${timeText ? `<div class="lc-time">${escapeHtml(timeText)}</div>` : ''}
            </div>
            <div class="list-card-body">
                <div class="lc-badges">
                    <span class="category-badge ${escapeHtml(e.category)}">${escapeHtml(e.categoryText)}</span>
                    ${snsHtml}
                </div>
                <h3 class="lc-title">${escapeHtml(e.title)}</h3>
                <div class="lc-meta">
                    ${locationText    ? `<span>📍 ${escapeHtml(locationText)}</span>` : ''}
                    ${participantsText? `<span>👥 ${escapeHtml(participantsText)}</span>` : ''}
                    ${e.manager       ? `<span>👤 取扱: ${escapeHtml(e.manager)}</span>` : ''}
                </div>
            </div>
            <div class="list-card-actions">
                <button class="detail-btn">詳細を見る</button>
            </div>
        `;
        // 日付エリアをクリックでカレンダーにジャンプ
        const dateArea = card.querySelector('.list-card-date');
        if (dateArea) {
            dateArea.classList.add('lc-date-clickable');
            dateArea.title = 'カレンダーで確認';
            dateArea.addEventListener('click', ev => {
                ev.stopPropagation();
                openCalendarAtDate(e.startDate);
            });
        }

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
        
    const visualStyle = e.cardColor ? `style="background: ${escapeHtml(e.cardColor)} !important;"` : '';

    document.getElementById('detail-content').innerHTML = `
        <div class="detail-banner visual-gradient ${escapeHtml(e.category)}" ${visualStyle}></div>
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

    // ズーム幅をCSS変数に反映
    document.getElementById('gantt-view-container')
        ?.style.setProperty('--gantt-day-width', `${ganttDayWidth}px`);
    updateZoomButtons();

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

    // Collect unique locations (always show default facilities)
    const defaultLocations = ['室内練習場', 'ベースボールエリア', 'アローズエリア', 'スタジオ', 'パワーエリア', '食堂', '多目的室'];
    const locationSet = new Set(defaultLocations);
    events.forEach(e => {
        const locs = Array.isArray(e.locations) && e.locations.length > 0 ? e.locations : (e.location ? [e.location] : ['その他']);
        locs.forEach(l => locationSet.add(l));
    });
    const locations = [...locationSet];

    // For each location, create a track
    locations.forEach(loc => {
        const trackEvents = events.filter(e => {
            const eLocs = Array.isArray(e.locations) && e.locations.length > 0 ? e.locations : (e.location ? [e.location] : ['その他']);
            return eLocs.includes(loc);
        });

        // Skip locations with no visible events in current range if we want,
        // but it's better to show the track to represent the facility.
        
        const track = document.createElement('div');
        track.className = 'gantt-track';
        track.innerHTML = `
            <div class="gantt-label">
                <div class="gantt-label-text">
                    <div class="gantt-label-title">${escapeHtml(loc)}</div>
                </div>
            </div>
            <div class="gantt-bars-container" style="--total-days: ${totalDays}; min-width: ${totalDays * ganttDayWidth}px;">
            </div>
        `;
        
        const barsContainer = track.querySelector('.gantt-bars-container');

        trackEvents
            .sort((a, b) => new Date(a.startDate + 'T00:00:00') - new Date(b.startDate + 'T00:00:00'))
            .forEach(e => {
                const eStart = new Date(e.startDate + 'T00:00:00');
                let eEnd = new Date((e.endDate || e.startDate) + 'T00:00:00');
                if (eStart > eEnd) eEnd = eStart;
                if (eEnd < startDate || eStart > endDate) return;

                // 時刻による日内フラクション（例: 10:30 → 10.5/24）
                let startFrac = 0, endFrac = 1;
                if (e.startTime) {
                    const [sh, sm] = e.startTime.split(':').map(Number);
                    startFrac = (sh * 60 + sm) / 1440;
                }
                if (e.endTime) {
                    const [eh, em] = e.endTime.split(':').map(Number);
                    endFrac = (eh * 60 + em) / 1440;
                }

                const startDiff = (eStart - startDate) / 86400000;
                const endDiff   = (eEnd   - startDate) / 86400000;
                const leftFrac  = Math.max(0,         startDiff + startFrac);
                const rightFrac = Math.min(totalDays, endDiff   + endFrac);
                if (rightFrac <= leftFrac) return;

                const left  = (leftFrac / totalDays) * 100;
                const width = ((rightFrac - leftFrac) / totalDays) * 100;
                const lFade  = eStart < startDate ? 'border-top-left-radius:0;border-bottom-left-radius:0;opacity:0.7;' : '';
                const rFade  = eEnd   > endDate   ? 'border-top-right-radius:0;border-bottom-right-radius:0;opacity:0.7;' : '';

                const colorVars = e.cardColor ? `--card-color: ${escapeHtml(e.cardColor)};` : '';

                const timeText = e.startTime
                    ? `${e.startTime}${e.endTime ? '~' + e.endTime : ''}`
                    : '';
                const locText = Array.isArray(e.locations) && e.locations.length > 0
                    ? e.locations.join(' / ')
                    : (e.location || '');

                const barHtml = `
                    <div class="gantt-bar ${escapeHtml(e.category)}"
                        style="left:${left}%;width:${width}%;${lFade}${rFade}${colorVars}"
                        title="${escapeHtml(e.title)}"
                        onclick="openDetail(${e.id})">
                        ${timeText ? `<div class="gantt-bar-time">${escapeHtml(timeText)}</div>` : ''}
                        <div class="gantt-bar-title">${escapeHtml(e.title)}</div>
                        ${locText ? `<div class="gantt-bar-loc">📍 ${escapeHtml(locText)}</div>` : ''}
                    </div>
                `;
                barsContainer.insertAdjacentHTML('beforeend', barHtml);
            });

        container.appendChild(track);
    });

    if (showTodayLine) {
        const todayLine = document.createElement('div');
        todayLine.className = 'gantt-today-line';
        todayLine.style.left = `calc(var(--gantt-label-width, 250px) + ${todayLeft / 100} * (100% - var(--gantt-label-width, 250px)))`;
        container.appendChild(todayLine);
    }
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

    // Collect unique locations (preserve insertion order, always show defaults)
    const defaultLocations = ['室内練習場', 'ベースボールエリア', 'アローズエリア', 'スタジオ', 'パワーエリア', '食堂', '多目的室'];
    const locationSet = new Set(defaultLocations);
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
            if (e.cardColor) block.style.setProperty('--card-color', e.cardColor);
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

    // ---- Render Mobile Agenda ----
    const agendaContainer = document.getElementById('day-agenda-container');
    if (agendaContainer) {
        agendaContainer.innerHTML = '';
        if (timedEvents.length === 0) {
            agendaContainer.innerHTML = '<div style="color:var(--text-secondary); text-align:center; padding: 2.5rem 1rem;">この日の予定はありません</div>';
        } else {
            const sortedEvents = [...timedEvents].sort((a,b) => (a.startTime||'').localeCompare(b.startTime||''));
            sortedEvents.forEach(e => {
                const locText = Array.isArray(e.locations) && e.locations.length > 0 ? e.locations.join(' / ') : escapeHtml(e.location || '');
                const card = document.createElement('div');
                card.className = `agenda-card ${escapeHtml(e.category)}`;
                if (e.cardColor) card.style.setProperty('--card-color', e.cardColor);
                card.onclick = () => openDetail(e.id);
                card.innerHTML = `
                    <div class="agenda-time">${escapeHtml(e.startTime)} ${e.endTime ? '〜 ' + escapeHtml(e.endTime) : ''}</div>
                    <div class="agenda-title">${escapeHtml(e.title)}</div>
                    ${locText ? `<div class="agenda-loc">📍 ${escapeHtml(locText)}</div>` : ''}
                    ${e.participants ? `<div class="agenda-loc" style="margin-top:0.25rem;">👥 ${escapeHtml(e.participants)}</div>` : ''}
                `;
                agendaContainer.appendChild(card);
            });
        }
    }

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
            document.getElementById('gantt-zoom-group').style.display     = 'none';
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
            document.getElementById('gantt-zoom-group').style.display     = 'flex';
            document.getElementById('calendar-title').textContent         = '月間スケジュール';
            document.getElementById('calendar-desc').textContent          = '現在予定されている社内イベントのスケジュール進行（ガントチャート）です。';
            currentGanttDays = days;
            updateGanttDateLabel();
            renderGantt();
        }
    });
});

// ---- ZOOM ----
function updateZoomButtons() {
    const idx = GANTT_ZOOM_STEPS.indexOf(ganttDayWidth);
    const outBtn = document.getElementById('gantt-zoom-out');
    const inBtn  = document.getElementById('gantt-zoom-in');
    if (outBtn) outBtn.disabled = idx <= 0;
    if (inBtn)  inBtn.disabled  = idx >= GANTT_ZOOM_STEPS.length - 1;
}

document.getElementById('gantt-zoom-in')?.addEventListener('click', () => {
    const idx = GANTT_ZOOM_STEPS.indexOf(ganttDayWidth);
    if (idx < GANTT_ZOOM_STEPS.length - 1) {
        ganttDayWidth = GANTT_ZOOM_STEPS[idx + 1];
        renderGantt();
    }
});

document.getElementById('gantt-zoom-out')?.addEventListener('click', () => {
    const idx = GANTT_ZOOM_STEPS.indexOf(ganttDayWidth);
    if (idx > 0) {
        ganttDayWidth = GANTT_ZOOM_STEPS[idx - 1];
        renderGantt();
    }
});

// ---- DATE JUMP ----
function openCalendarAtDate(dateStr) {
    const target = new Date(dateStr + 'T00:00:00');
    // 対象日付が左から少し余白を持って見えるよう開始日を調整
    const offset = Math.max(1, Math.floor(currentGanttDays * 0.1));
    const start  = new Date(target);
    start.setDate(target.getDate() - offset);
    currentGanttStartDate = start;
    calendarMode = 'gantt';

    stopDayViewTimer();
    navHome.classList.remove('active');
    navCalendar.classList.add('active');
    viewHome.style.display = 'none';
    viewCal.style.display  = 'block';

    document.getElementById('gantt-view-container').style.display = 'block';
    document.getElementById('day-view-container').style.display   = 'none';
    document.getElementById('gantt-nav').style.display            = 'flex';
    document.getElementById('day-nav').style.display              = 'none';
    document.getElementById('gantt-zoom-group').style.display     = 'flex';
    document.getElementById('calendar-title').textContent         = '月間スケジュール';
    document.getElementById('calendar-desc').textContent          = '現在予定されている社内イベントのスケジュール進行（ガントチャート）です。';

    document.querySelectorAll('.view-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.days) === currentGanttDays);
    });

    updateGanttDateLabel();
    renderGantt();
}

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

// ---- MINI CALENDAR PICKER ----
let miniCalDate = new Date(); // currently displayed month in picker

function buildMiniCalPopup() {
    let el = document.getElementById('mini-cal-popup');
    if (!el) {
        el = document.createElement('div');
        el.id = 'mini-cal-popup';
        el.style.display = 'none';
        document.body.appendChild(el);

        // Close on outside click
        document.addEventListener('click', ev => {
            if (!el.contains(ev.target) && ev.target !== document.getElementById('day-date-label')) {
                el.style.display = 'none';
            }
        }, true);
    }
    return el;
}

function renderMiniCal() {
    const el = buildMiniCalPopup();
    const y  = miniCalDate.getFullYear();
    const m  = miniCalDate.getMonth();

    const todayStr = new Date().toDateString();

    // First day of month, day-of-week offset (0=Sun)
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth  = new Date(y, m + 1, 0).getDate();
    const daysInPrev   = new Date(y, m, 0).getDate();

    const DOWS = ['日', '月', '火', '水', '木', '金', '土'];

    let cellsHtml = DOWS.map(d => `<div class="mini-cal-dow">${d}</div>`).join('');

    // Leading cells from prev month
    for (let i = firstDow - 1; i >= 0; i--) {
        cellsHtml += `<div class="mini-cal-day mini-cal-day-other">${daysInPrev - i}</div>`;
    }
    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
        const isToday = new Date(y, m, d).toDateString() === todayStr;
        const dateStr = `${y}-${String(m + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        cellsHtml += `<div class="mini-cal-day${isToday ? ' mini-cal-day-today' : ''}" data-date="${dateStr}">${d}</div>`;
    }
    // Trailing cells
    const total = firstDow + daysInMonth;
    const trailing = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (let d = 1; d <= trailing; d++) {
        cellsHtml += `<div class="mini-cal-day mini-cal-day-other">${d}</div>`;
    }

    el.innerHTML = `
        <div class="mini-cal-header">
            <button class="mini-cal-nav-btn" id="mini-cal-prev">&#8249;</button>
            <div class="mini-cal-year">${y}年</div>
            <div class="mini-cal-month">${m + 1}月</div>
            <button class="mini-cal-nav-btn" id="mini-cal-next">&#8250;</button>
        </div>
        <div class="mini-cal-grid">${cellsHtml}</div>
    `;

    el.querySelector('#mini-cal-prev').addEventListener('click', ev => {
        ev.stopPropagation();
        miniCalDate = new Date(y, m - 1, 1);
        renderMiniCal();
    });
    el.querySelector('#mini-cal-next').addEventListener('click', ev => {
        ev.stopPropagation();
        miniCalDate = new Date(y, m + 1, 1);
        renderMiniCal();
    });
    el.querySelectorAll('.mini-cal-day[data-date]').forEach(cell => {
        cell.addEventListener('click', ev => {
            ev.stopPropagation();
            el.style.display = 'none';
            currentDayDate = new Date(cell.dataset.date + 'T00:00:00');
            renderDayView();
        });
    });
}

function openMiniCal(anchorEl) {
    miniCalDate = new Date(currentDayDate.getFullYear(), currentDayDate.getMonth(), 1);
    renderMiniCal();
    const el   = document.getElementById('mini-cal-popup');
    const rect = anchorEl.getBoundingClientRect();
    el.style.display = 'block';
    // Position below anchor, centered
    const popW = el.offsetWidth || 260;
    let left = rect.left + rect.width / 2 - popW / 2 + window.scrollX;
    left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
    el.style.left = `${left}px`;
    el.style.top  = `${rect.bottom + window.scrollY + 6}px`;
}

// Make day-date-label clickable
document.getElementById('day-date-label')?.addEventListener('click', ev => {
    ev.stopPropagation();
    const el = buildMiniCalPopup();
    if (el.style.display === 'block') {
        el.style.display = 'none';
    } else {
        openMiniCal(ev.currentTarget);
    }
});

// ---- START ----
init();

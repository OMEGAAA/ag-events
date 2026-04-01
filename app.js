let events = [];
let reports = [];

const SNS_LABEL = {
    'allowed': { text: '掲載可', cls: 'sns-allowed', icon: '✅' },
    'not-allowed': { text: '掲載不可', cls: 'sns-not-allowed', icon: '🚫' },
    'pending': { text: '要確認', cls: 'sns-pending', icon: '⚠️' }
};

const today = new Date();
let currentGanttStartDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
let currentGanttDays = 30;
let currentDayDate = new Date();
let calendarMode = 'gantt'; // 'gantt' | 'day' | 'month-cal'
let currentMonthCalDate = new Date(today.getFullYear(), today.getMonth(), 1);
let dayViewTimer = null;
let ganttDayWidth = 80; // px per day column
let dayViewMode = 'vertical'; // 'vertical' | 'horizontal'
const DH_HOUR_WIDTH = 100; // px per hour in horizontal day view
const GANTT_ZOOM_STEPS = [24, 38, 56, 80, 120];

function startDayViewTimer() {
    stopDayViewTimer();
    dayViewTimer = setInterval(() => {
        if (currentDayDate.toDateString() !== new Date().toDateString()) return;
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        document.querySelectorAll('.day-current-time').forEach(line => {
            line.style.top = `${nowMin}px`;
        });
        const nowLeft = (nowMin / 60) * DH_HOUR_WIDTH;
        document.querySelectorAll('.dh-now-line').forEach(line => {
            line.style.left = `${nowLeft}px`;
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

// ---- MULTI-DATE HELPERS ----
function getEventDates(e) {
    if (Array.isArray(e.dates) && e.dates.length > 0) return e.dates;
    return [{ startDate: e.startDate, endDate: e.endDate || e.startDate, startTime: e.startTime, endTime: e.endTime }];
}

function getMatchingDateEntry(e, dayStr) {
    return getEventDates(e).find(d => d.startDate <= dayStr && (d.endDate || d.startDate) >= dayStr)
        || getEventDates(e)[0];
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
    try {
        const res = await fetch('./reports.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        reports = await res.json();
    } catch (e) {
        console.warn('reports.json の読み込みに失敗しました:', e);
        reports = [];
    }
    renderEvents();
}

// ---- REPORTS VIEW ----
function renderReports() {
    const grid = document.getElementById('report-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const sorted = [...reports].sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate));

    if (sorted.length === 0) {
        grid.innerHTML = '<p class="report-empty">実績報告はまだありません</p>';
        return;
    }

    sorted.forEach(r => {
        const fmtD = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
        const firstPhoto = Array.isArray(r.photos) && r.photos.length > 0 ? r.photos[0] : null;
        const photoCount = Array.isArray(r.photos) ? r.photos.length : 0;

        const card = document.createElement('div');
        card.className = `report-card ${escapeHtml(r.category || 'other')} fade-in`;
        if (r.cardColor) card.style.setProperty('--card-color', r.cardColor);

        card.innerHTML = `
            <div class="report-card-photo${firstPhoto ? '' : ' no-photo'}">
                ${firstPhoto ? `<img src="${escapeHtml(firstPhoto)}" alt="${escapeHtml(r.eventTitle)}" onerror="this.parentElement.classList.add('no-photo'); this.remove();">` : ''}
                ${photoCount > 1 ? `<span class="report-photo-count">+${photoCount - 1}</span>` : ''}
            </div>
            <div class="report-card-body">
                <div class="rc-badges">
                    <span class="category-badge ${escapeHtml(r.category || 'other')}">${escapeHtml(r.categoryText || '')}</span>
                </div>
                <h3 class="rc-title">${escapeHtml(r.eventTitle)}</h3>
                <div class="rc-meta">
                    <span>📅 ${escapeHtml(fmtD(r.eventDate))}</span>
                    ${r.actualParticipants ? `<span>👥 ${escapeHtml(r.actualParticipants)}</span>` : ''}
                    ${r.manager ? `<span>👤 ${escapeHtml(r.manager)}</span>` : ''}
                </div>
                ${r.summary ? `<p class="rc-summary">${escapeHtml(r.summary)}</p>` : ''}
            </div>
            <div class="report-card-actions">
                <button class="detail-btn" onclick="openReportDetail(${r.id})">詳細を見る</button>
            </div>
        `;

        grid.appendChild(card);
    });
}

function openReportDetail(id) {
    const r = reports.find(rep => rep.id === id);
    if (!r) return;

    const fmtD = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
    const photoCount = Array.isArray(r.photos) ? r.photos.length : 0;

    const photosHtml = photoCount > 0
        ? `<div class="detail-row full">
            <div class="detail-label">写真</div>
            <div class="detail-value report-photos-gallery">
                ${r.photos.map((url, i) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="report-photo-thumb">
                    <img src="${escapeHtml(url)}" alt="写真${i + 1}" onerror="this.parentElement.classList.add('photo-link-only'); this.remove();">
                    <span class="photo-link-label">写真を開く</span>
                </a>`).join('')}
            </div>
           </div>`
        : '';

    const visualStyle = r.cardColor ? `style="background: ${escapeHtml(r.cardColor)} !important;"` : '';

    document.getElementById('detail-content').innerHTML = `
        <div class="detail-banner visual-gradient ${escapeHtml(r.category || 'other')}" ${visualStyle}></div>
        <div class="detail-body">
            <span class="detail-cat-badge category-tag" style="position:static; display:inline-block; margin-bottom:0.75rem;">${escapeHtml(r.categoryText || '')}</span>
            <h2 class="detail-title">${escapeHtml(r.eventTitle)}</h2>
            <div class="detail-grid">
                <div class="detail-row">
                    <div class="detail-label">開催日</div>
                    <div class="detail-value">${escapeHtml(fmtD(r.eventDate))}</div>
                </div>
                ${r.actualParticipants ? `
                <div class="detail-row">
                    <div class="detail-label">参加人数</div>
                    <div class="detail-value">${escapeHtml(r.actualParticipants)}</div>
                </div>` : ''}
                ${r.manager ? `
                <div class="detail-row">
                    <div class="detail-label">担当者</div>
                    <div class="detail-value">${escapeHtml(r.manager)}</div>
                </div>` : ''}
                ${r.summary ? `
                <div class="detail-row full">
                    <div class="detail-label">概要</div>
                    <div class="detail-value detail-notes">${escapeHtml(r.summary)}</div>
                </div>` : ''}
                ${r.comments ? `
                <div class="detail-row full">
                    <div class="detail-label">コメント</div>
                    <div class="detail-value detail-notes">${escapeHtml(r.comments)}</div>
                </div>` : ''}
                ${photosHtml}
            </div>
        </div>
    `;

    document.getElementById('detail-overlay').style.display = 'flex';
}

// ---- HOME VIEW ----
function renderEvents() {
    const eventGrid = document.getElementById('event-grid');
    if (!eventGrid) return;
    eventGrid.innerHTML = '';

    const filtered = [...events].sort((a, b) => new Date(getEventDates(a)[0].startDate) - new Date(getEventDates(b)[0].startDate));

    if (filtered.length === 0) {
        eventGrid.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:4rem 0;grid-column:1/-1;">イベントがありません</p>';
        return;
    }

    filtered.forEach(e => {
        const locationText = Array.isArray(e.locations) && e.locations.length > 0
            ? e.locations.join(' / ')
            : (e.location || '');
        const participantsText = e.participants || e.capacity || '';
        const isFull = participantsText.includes('満席');
        const btnText = isFull ? 'キャンセル待ち' : '予約する';

        // 複数日程の表示HTML
        const fmtD = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getMonth() + 1}月${d.getDate()}日`; };
        const eDates = getEventDates(e);
        const dateHtml = eDates.length === 1
            ? (() => {
                const d = eDates[0];
                const ds = d.endDate && d.endDate !== d.startDate ? `${fmtD(d.startDate)}〜${fmtD(d.endDate)}` : fmtD(d.startDate);
                const ts = d.startTime ? `${d.startTime}${d.endTime ? ' 〜 ' + d.endTime : ''}` : '';
                return `<div class="lc-date">${escapeHtml(ds)}</div>${ts ? `<div class="lc-time">${escapeHtml(ts)}</div>` : ''}`;
            })()
            : `<div class="lc-date-multi">${eDates.map(d => {
                const ds = d.endDate && d.endDate !== d.startDate ? `${fmtD(d.startDate)}〜${fmtD(d.endDate)}` : fmtD(d.startDate);
                const ts = d.startTime ? `<span class="lc-multi-time"> ${d.startTime}${d.endTime ? '〜' + d.endTime : ''}</span>` : '';
                return `<div class="lc-multi-date">${escapeHtml(ds)}${ts}</div>`;
            }).join('')}</div>`;

        const card = document.createElement('div');
        card.className = `home-list-card ${escapeHtml(e.category)} fade-in`;
        if (e.cardColor) card.style.setProperty('--card-color', e.cardColor);
        card.onclick = () => openDetail(e.id);

        const snsHtml = (() => { const s = SNS_LABEL[e.snsPR]; return s ? `<span class="sns-badge ${s.cls}" style="transform: scale(0.85); transform-origin: left; margin-left:-0.2rem;">${s.icon} ${s.text}</span>` : ''; })();

        card.innerHTML = `
            <div class="list-card-date">
                ${dateHtml}
            </div>
            <div class="list-card-body">
                <div class="lc-badges">
                    <span class="category-badge ${escapeHtml(e.category)}">${escapeHtml(e.categoryText)}</span>
                    ${snsHtml}
                </div>
                <h3 class="lc-title">${escapeHtml(e.title)}</h3>
                <div class="lc-meta">
                    ${locationText ? `<span>📍 ${escapeHtml(locationText)}</span>` : ''}
                    ${participantsText ? `<span>👥 ${escapeHtml(participantsText)}</span>` : ''}
                    ${e.manager ? `<span>👤 取扱: ${escapeHtml(e.manager)}</span>` : ''}
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

    const fmtD2 = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getMonth() + 1}月${d.getDate()}日`; };
    const datesHtml = getEventDates(e).map(d => {
        const ds = d.endDate && d.endDate !== d.startDate ? `${fmtD2(d.startDate)}〜${fmtD2(d.endDate)}` : fmtD2(d.startDate);
        const ts = d.startTime ? `${d.startTime}${d.endTime ? ' 〜 ' + d.endTime : ''}` : '';
        return `<div class="detail-date-entry">${escapeHtml(ds)}${ts ? ` <span class="detail-time">${escapeHtml(ts)}</span>` : ''}</div>`;
    }).join('');

    const visualStyle = e.cardColor ? `style="background: ${escapeHtml(e.cardColor)} !important;"` : '';

    document.getElementById('detail-content').innerHTML = `
        <div class="detail-banner visual-gradient ${escapeHtml(e.category)}" ${visualStyle}></div>
        <div class="detail-body">
            <span class="detail-cat-badge category-tag" style="position:static; display:inline-block; margin-bottom:0.75rem;">${escapeHtml(e.categoryText)}</span>
            <h2 class="detail-title">${escapeHtml(e.title)}</h2>
            <div class="detail-grid">
                <div class="detail-row">
                    <div class="detail-label">日程</div>
                    <div class="detail-value">${datesHtml}</div>
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
    const header = document.getElementById('gantt-header-days');
    if (!container || !header) return;

    // ズーム幅をCSS変数に反映
    document.getElementById('gantt-view-container')
        ?.style.setProperty('--gantt-day-width', `${ganttDayWidth}px`);
    updateZoomButtons();

    container.innerHTML = '';

    const startDate = new Date(currentGanttStartDate);
    const totalDays = currentGanttDays;
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + totalDays - 1);

    const todayStr = new Date().toDateString();

    let headerHtml = '<div class="gantt-corner-cell">エリア</div>';
    for (let i = 0; i < totalDays; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        const isToday = d.toDateString() === todayStr;
        const str = `${d.getMonth() + 1}/${d.getDate()}`;
        headerHtml += `<div class="gantt-day${isToday ? ' gantt-day-today' : ''}">${str}</div>`;
    }
    header.innerHTML = headerHtml;

    // 今日の赤い縦線の位置を計算
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const startClean = new Date(startDate);
    startClean.setHours(0, 0, 0, 0);
    const todayDiff = (todayDate - startClean) / 86400000;
    const showTodayLine = todayDiff >= 0 && todayDiff < totalDays;
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

        const visibleCount = trackEvents.filter(e =>
            getEventDates(e).some(d => {
                const eStart = new Date(d.startDate + 'T00:00:00');
                const eEnd = new Date((d.endDate || d.startDate) + 'T00:00:00');
                return !(eEnd < startDate || eStart > endDate);
            })
        ).length;

        const track = document.createElement('div');
        track.className = 'gantt-track';
        track.innerHTML = `
            <div class="gantt-label">
                <div class="gantt-label-title">${escapeHtml(loc)}</div>
                <span class="gantt-event-count${visibleCount === 0 ? ' count-zero' : ''}">${visibleCount}</span>
            </div>
            <div class="gantt-bars-container" style="--total-days: ${totalDays}; width: ${totalDays * ganttDayWidth}px; min-width: ${totalDays * ganttDayWidth}px; flex: none;">
            </div>
        `;

        const barsContainer = track.querySelector('.gantt-bars-container');

        trackEvents
            .sort((a, b) => new Date(getEventDates(a)[0].startDate + 'T00:00:00') - new Date(getEventDates(b)[0].startDate + 'T00:00:00'))
            .forEach(e => {
                const locText = Array.isArray(e.locations) && e.locations.length > 0
                    ? e.locations.join(' / ')
                    : (e.location || '');
                const colorVars = e.cardColor ? `--card-color: ${escapeHtml(e.cardColor)};` : '';

                getEventDates(e).forEach(dateEntry => {
                    const eStart = new Date(dateEntry.startDate + 'T00:00:00');
                    let eEnd = new Date((dateEntry.endDate || dateEntry.startDate) + 'T00:00:00');
                    if (eStart > eEnd) eEnd = eStart;
                    if (eEnd < startDate || eStart > endDate) return;

                    let startFrac = 0, endFrac = 1;
                    if (dateEntry.startTime) {
                        const [sh, sm] = dateEntry.startTime.split(':').map(Number);
                        startFrac = (sh * 60 + sm) / 1440;
                    }
                    if (dateEntry.endTime) {
                        const [eh, em] = dateEntry.endTime.split(':').map(Number);
                        endFrac = (eh * 60 + em) / 1440;
                    }

                    const startDiff = (eStart - startDate) / 86400000;
                    const endDiff = (eEnd - startDate) / 86400000;
                    const leftFrac = Math.max(0, startDiff + startFrac);
                    const rightFrac = Math.min(totalDays, endDiff + endFrac);
                    if (rightFrac <= leftFrac) return;

                    const left = (leftFrac / totalDays) * 100;
                    const width = ((rightFrac - leftFrac) / totalDays) * 100;
                    const lFade = eStart < startDate ? 'border-top-left-radius:0;border-bottom-left-radius:0;opacity:0.7;' : '';
                    const rFade = eEnd > endDate ? 'border-top-right-radius:0;border-bottom-right-radius:0;opacity:0.7;' : '';
                    const timeText = dateEntry.startTime
                        ? `${dateEntry.startTime}${dateEntry.endTime ? '~' + dateEntry.endTime : ''}`
                        : '';

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

    // ---- Horizontal resource timeline mode ----
    if (dayViewMode === 'horizontal') {
        const alldayDiv = document.getElementById('day-allday-events');
        alldayDiv.innerHTML = '';
        const dayStr = currentDayDate.toISOString().slice(0, 10);
        events.filter(e => e.startDate <= dayStr && (e.endDate || e.startDate) >= dayStr && !e.startTime)
            .forEach(e => {
                const block = document.createElement('div');
                block.className = `day-allday-event ${escapeHtml(e.category)}`;
                block.textContent = e.title;
                block.onclick = () => openDetail(e.id);
                alldayDiv.appendChild(block);
            });
        document.getElementById('day-timeline-container').style.display = 'none';
        document.getElementById('day-agenda-container').style.display = 'none';
        document.getElementById('day-horizontal-container').style.display = 'block';
        renderDayHorizontalView();
        startDayViewTimer();
        return;
    }

    // ---- Vertical timeline mode (default) ----
    document.getElementById('day-horizontal-container').style.display = 'none';
    document.getElementById('day-timeline-container').style.display = '';
    document.getElementById('day-agenda-container').style.display = '';

    const container = document.getElementById('day-timeline-container');
    const alldayDiv = document.getElementById('day-allday-events');
    if (!container) return;

    alldayDiv.innerHTML = '';
    container.innerHTML = '';

    const dayStr = currentDayDate.toISOString().slice(0, 10);
    const dayEvents = events.filter(e => getEventDates(e).some(d => d.startDate <= dayStr && (d.endDate || d.startDate) >= dayStr));

    // Separate all-day and timed events
    const allDayEvents = dayEvents.filter(e => !e.startTime);
    const timedEvents = dayEvents.filter(e => e.startTime);

    allDayEvents.forEach(e => {
        const block = document.createElement('div');
        block.className = `day-allday-event ${escapeHtml(e.category)}`;
        block.textContent = e.title;
        block.onclick = () => openDetail(e.id);
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
        lbl.className = 'day-time-label';
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
        header.className = 'day-location-header';
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

            const de = getMatchingDateEntry(e, dayStr);
            const [sh, sm] = de.startTime.split(':').map(Number);
            const etStr = de.endTime || `${Math.min(sh + 1, 23)}:00`;
            const [eh, em] = etStr.split(':').map(Number);
            const topPx = sh * 60 + sm;
            const heightPx = Math.max(32, (eh * 60 + em) - topPx);

            const block = document.createElement('div');
            block.className = `day-event-block ${escapeHtml(e.category)}`;
            block.style.top = `${topPx}px`;
            block.style.height = `${heightPx}px`;
            if (e.cardColor) block.style.setProperty('--card-color', e.cardColor);
            block.innerHTML = `
                <div class="day-event-time">${escapeHtml(de.startTime)}${de.endTime ? ' - ' + escapeHtml(de.endTime) : ''}</div>
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
            const sortedEvents = [...timedEvents].sort((a, b) => (getMatchingDateEntry(a, dayStr).startTime || '').localeCompare(getMatchingDateEntry(b, dayStr).startTime || ''));
            sortedEvents.forEach(e => {
                const de = getMatchingDateEntry(e, dayStr);
                const locText = Array.isArray(e.locations) && e.locations.length > 0 ? e.locations.join(' / ') : escapeHtml(e.location || '');
                const card = document.createElement('div');
                card.className = `agenda-card ${escapeHtml(e.category)}`;
                if (e.cardColor) card.style.setProperty('--card-color', e.cardColor);
                card.onclick = () => openDetail(e.id);
                card.innerHTML = `
                    <div class="agenda-time">${escapeHtml(de.startTime)} ${de.endTime ? '〜 ' + escapeHtml(de.endTime) : ''}</div>
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

// ---- MONTHLY CALENDAR ----
function updateMonthCalLabel() {
    const label = document.getElementById('month-cal-label');
    if (!label) return;
    label.textContent = `${currentMonthCalDate.getFullYear()}年${currentMonthCalDate.getMonth() + 1}月`;
}

document.getElementById('month-cal-prev')?.addEventListener('click', () => {
    currentMonthCalDate = new Date(currentMonthCalDate.getFullYear(), currentMonthCalDate.getMonth() - 1, 1);
    renderMonthCal();
});

document.getElementById('month-cal-next')?.addEventListener('click', () => {
    currentMonthCalDate = new Date(currentMonthCalDate.getFullYear(), currentMonthCalDate.getMonth() + 1, 1);
    renderMonthCal();
});

function renderMonthCal() {
    const container = document.getElementById('month-cal-container');
    if (!container) return;

    updateMonthCalLabel();

    const y = currentMonthCalDate.getFullYear();
    const m = currentMonthCalDate.getMonth();
    const firstDay = new Date(y, m, 1);
    const firstDow = firstDay.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const DOWS = ['日', '月', '火', '水', '木', '金', '土'];
    const _t = new Date();
    const todayStr = `${_t.getFullYear()}-${String(_t.getMonth()+1).padStart(2,'0')}-${String(_t.getDate()).padStart(2,'0')}`;

    const gridStart = new Date(firstDay);
    gridStart.setDate(1 - firstDow);

    const BAR_H = 20;
    const BAR_GAP = 2;
    const CELL_TOP = 26;
    const numWeeks = Math.ceil((firstDow + daysInMonth) / 7);

    let weeksHtml = '';

    for (let week = 0; week < numWeeks; week++) {
        const weekStart = new Date(gridStart);
        weekStart.setDate(gridStart.getDate() + week * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        const weekStartStr = weekStart.toISOString().slice(0, 10);
        const weekEndStr = weekEnd.toISOString().slice(0, 10);

        // Collect all event entries overlapping this week
        const weekEntries = [];
        events.forEach(e => {
            getEventDates(e).forEach(dateEntry => {
                const eStart = dateEntry.startDate;
                const eEnd = dateEntry.endDate || dateEntry.startDate;
                if (eStart > weekEndStr || eEnd < weekStartStr) return;
                weekEntries.push({ event: e, startDate: eStart, endDate: eEnd, startTime: dateEntry.startTime });
            });
        });

        // Sort: longer events first, then by start date
        weekEntries.sort((a, b) => {
            const ad = (new Date(a.endDate + 'T00:00:00') - new Date(a.startDate + 'T00:00:00')) / 86400000;
            const bd = (new Date(b.endDate + 'T00:00:00') - new Date(b.startDate + 'T00:00:00')) / 86400000;
            if (bd !== ad) return bd - ad;
            return a.startDate.localeCompare(b.startDate);
        });

        // Assign lanes
        const lanes = [];
        const positioned = weekEntries.map(ev => {
            const effStart = ev.startDate < weekStartStr ? weekStartStr : ev.startDate;
            const effEnd = ev.endDate > weekEndStr ? weekEndStr : ev.endDate;
            const startDow = new Date(effStart + 'T00:00:00').getDay();
            const endDow = new Date(effEnd + 'T00:00:00').getDay();
            let lane = 0;
            while (lane < lanes.length && lanes[lane] >= startDow) lane++;
            if (lane === lanes.length) lanes.push(-1);
            lanes[lane] = endDow;
            return { ...ev, lane, startDow, endDow };
        });

        const usedLanes = positioned.length > 0 ? Math.max(...positioned.map(p => p.lane)) + 1 : 0;
        const rowH = Math.max(80, CELL_TOP + usedLanes * (BAR_H + BAR_GAP) + 8);

        // Day cells
        let daysHtml = '';
        for (let d = 0; d < 7; d++) {
            const day = new Date(weekStart);
            day.setDate(weekStart.getDate() + d);
            const dayStr = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
            const isOther = day.getMonth() !== m;
            const isToday = dayStr === todayStr;
            const cls = `mc-cell${isOther ? ' mc-cell-other' : ''}${isToday ? ' mc-cell-today' : ''}${d === 0 ? ' mc-cell-sun' : d === 6 ? ' mc-cell-sat' : ''}`;
            daysHtml += `<div class="${cls}"><div class="mc-date-num">${day.getDate()}</div></div>`;
        }

        // Event bars
        let barsHtml = '';
        positioned.forEach(ev => {
            const leftPct = (ev.startDow / 7) * 100;
            const widthPct = ((ev.endDow - ev.startDow + 1) / 7) * 100;
            const top = CELL_TOP + ev.lane * (BAR_H + BAR_GAP);
            const startsHere = ev.startDate >= weekStartStr;
            const endsHere = ev.endDate <= weekEndStr;
            const colorVars = ev.event.cardColor ? `--card-color:${escapeHtml(ev.event.cardColor)};` : '';
            const lPad = startsHere ? '2px' : '0px';
            const rPad = endsHere ? '2px' : '0px';
            const contCls = `${!startsHere ? ' mc-bar-left-cont' : ''}${!endsHere ? ' mc-bar-right-cont' : ''}`;
            barsHtml += `<div class="mc-event-bar ${escapeHtml(ev.event.category)}${contCls}"
                style="left:calc(${leftPct}% + ${lPad});width:calc(${widthPct}% - ${lPad} - ${rPad});top:${top}px;height:${BAR_H}px;${colorVars}"
                onclick="openDetail(${ev.event.id})"
                title="${escapeHtml(ev.event.title)}">
                <span class="mc-bar-text">${escapeHtml(ev.event.title)}</span>
            </div>`;
        });


        weeksHtml += `<div class="mc-week-row" style="height:${rowH}px;">
            <div class="mc-week-cells">${daysHtml}</div>
            <div class="mc-event-layer">${barsHtml}</div>
        </div>`;
    }

    container.innerHTML = `<div class="mc-grid">
        <div class="mc-dow-header">${DOWS.map((d, i) => `<div class="mc-dow${i === 0 ? ' mc-dow-sun' : i === 6 ? ' mc-dow-sat' : ''}">${d}</div>`).join('')}</div>
        ${weeksHtml}
    </div>`;
}

// ---- VIEW BUTTONS ----
document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', e => {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');

        // Month calendar mode
        if (e.target.dataset.mode === 'month-cal') {
            calendarMode = 'month-cal';
            stopDayViewTimer();
            document.getElementById('gantt-view-container').style.display = 'none';
            document.getElementById('day-view-container').style.display = 'none';
            document.getElementById('month-cal-container').style.display = 'block';
            document.getElementById('gantt-nav').style.display = 'none';
            document.getElementById('day-nav').style.display = 'none';
            document.getElementById('month-cal-nav').style.display = 'flex';
            document.getElementById('calendar-title').textContent = '月カレンダー';
            document.getElementById('calendar-desc').textContent = '月ごとのカレンダー形式でイベントを確認できます。';
            renderMonthCal();
            return;
        }

        const days = parseInt(e.target.dataset.days);

        if (days === 1) {
            calendarMode = 'day';
            document.getElementById('gantt-view-container').style.display = 'none';
            document.getElementById('day-view-container').style.display = 'block';
            document.getElementById('month-cal-container').style.display = 'none';
            document.getElementById('gantt-nav').style.display = 'none';
            document.getElementById('day-nav').style.display = 'flex';
            document.getElementById('month-cal-nav').style.display = 'none';
            document.getElementById('calendar-title').textContent = '1日スケジュール';
            document.getElementById('calendar-desc').textContent = '選択した日のイベントを時系列で確認できます。';
            renderDayView();
        } else {
            calendarMode = 'gantt';
            stopDayViewTimer();
            document.getElementById('gantt-view-container').style.display = 'block';
            document.getElementById('day-view-container').style.display = 'none';
            document.getElementById('month-cal-container').style.display = 'none';
            document.getElementById('gantt-nav').style.display = 'flex';
            document.getElementById('day-nav').style.display = 'none';
            document.getElementById('month-cal-nav').style.display = 'none';
            document.getElementById('calendar-title').textContent = '月間スケジュール';
            document.getElementById('calendar-desc').textContent = '現在予定されているベントのスケジュール進行です。';
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
    const inBtn = document.getElementById('gantt-zoom-in');
    if (outBtn) outBtn.disabled = idx <= 0;
    if (inBtn) inBtn.disabled = idx >= GANTT_ZOOM_STEPS.length - 1;
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
    const start = new Date(target);
    start.setDate(target.getDate() - offset);
    currentGanttStartDate = start;
    calendarMode = 'gantt';

    setActiveNav(navCalendar);
    viewCal.style.display = 'block';

    document.getElementById('gantt-view-container').style.display = 'block';
    document.getElementById('day-view-container').style.display = 'none';
    document.getElementById('gantt-nav').style.display = 'flex';
    document.getElementById('day-nav').style.display = 'none';
    document.getElementById('calendar-title').textContent = '月間スケジュール';
    document.getElementById('calendar-desc').textContent = '現在予定されている社内イベントのスケジュール進行（ガントチャート）です。';

    document.querySelectorAll('.view-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.days) === currentGanttDays);
    });

    updateGanttDateLabel();
    renderGantt();
}

// ---- NAVIGATION ----
const navHome = document.getElementById('nav-home');
const navCalendar = document.getElementById('nav-calendar');
const navReports = document.getElementById('nav-reports');
const viewHome = document.getElementById('view-home');
const viewCal = document.getElementById('view-calendar');
const viewReports = document.getElementById('view-reports');

function setActiveNav(active) {
    [navHome, navCalendar, navReports].forEach(n => n?.classList.remove('active'));
    active?.classList.add('active');
    stopDayViewTimer();
    viewHome.style.display = 'none';
    viewCal.style.display = 'none';
    if (viewReports) viewReports.style.display = 'none';
}

navHome?.addEventListener('click', e => {
    e.preventDefault();
    setActiveNav(navHome);
    viewHome.style.display = 'block';
});

navCalendar?.addEventListener('click', e => {
    e.preventDefault();
    setActiveNav(navCalendar);
    viewCal.style.display = 'block';

    if (calendarMode === 'day') {
        renderDayView();
    } else if (calendarMode === 'month-cal') {
        renderMonthCal();
    } else {
        updateGanttDateLabel();
        renderGantt();
    }
});

navReports?.addEventListener('click', e => {
    e.preventDefault();
    setActiveNav(navReports);
    if (viewReports) viewReports.style.display = 'block';
    renderReports();
});

// ---- DAY HORIZONTAL (RESOURCE) VIEW ----
function renderDayHorizontalView() {
    const container = document.getElementById('day-horizontal-container');
    if (!container) return;

    const HOUR_START = 0;
    const HOUR_END = 24;
    const totalHours = HOUR_END - HOUR_START;
    const timelineW = totalHours * DH_HOUR_WIDTH;

    const dayStr = currentDayDate.toISOString().slice(0, 10);
    const dayEvents = events.filter(e => getEventDates(e).some(d => d.startDate <= dayStr && (d.endDate || d.startDate) >= dayStr));
    const timedEvents = dayEvents.filter(e => getMatchingDateEntry(e, dayStr).startTime);

    const defaultLocations = ['室内練習場', 'ベースボールエリア', 'アローズエリア', 'スタジオ', 'パワーエリア', '食堂', '多目的室'];
    const locationSet = new Set(defaultLocations);
    timedEvents.forEach(e => {
        const locs = Array.isArray(e.locations) && e.locations.length > 0 ? e.locations : ['その他'];
        locs.forEach(l => locationSet.add(l));
    });
    const locations = [...locationSet];

    // Time header ticks
    let timeTicksHtml = '';
    for (let h = HOUR_START; h <= HOUR_END; h++) {
        timeTicksHtml += `<div class="dh-time-tick" style="left:${(h - HOUR_START) * DH_HOUR_WIDTH}px">${String(h).padStart(2, '0')}:00</div>`;
    }

    // Rows
    let rowsHtml = '';
    locations.forEach(loc => {
        const locEvents = timedEvents.filter(e => {
            const eLocs = Array.isArray(e.locations) && e.locations.length > 0 ? e.locations : ['その他'];
            return eLocs.includes(loc);
        });

        let gridHtml = '';
        for (let h = HOUR_START; h <= HOUR_END; h++) {
            gridHtml += `<div class="dh-grid-line" style="left:${(h - HOUR_START) * DH_HOUR_WIDTH}px"></div>`;
        }

        let barsHtml = '';
        locEvents.forEach(e => {
            const de = getMatchingDateEntry(e, dayStr);
            const [sh, sm] = de.startTime.split(':').map(Number);
            const etStr = de.endTime || `${Math.min(sh + 1, 23)}:00`;
            const [eh, em] = etStr.split(':').map(Number);
            const startMin = sh * 60 + sm - HOUR_START * 60;
            const endMin = eh * 60 + em - HOUR_START * 60;
            const left = (startMin / 60) * DH_HOUR_WIDTH;
            const width = Math.max(4, ((endMin - startMin) / 60) * DH_HOUR_WIDTH);
            const locText = Array.isArray(e.locations) && e.locations.length > 0
                ? e.locations.join(' / ') : (e.location || '');
            const cvars = e.cardColor ? `--card-color:${escapeHtml(e.cardColor)};` : '';

            barsHtml += `
                <div class="dh-event-bar ${escapeHtml(e.category)}"
                    style="left:${left}px;width:${width}px;${cvars}"
                    onclick="openDetail(${e.id})" title="${escapeHtml(e.title)}">
                    <div class="dh-bar-time">${escapeHtml(de.startTime)}~${escapeHtml(etStr)}</div>
                    <div class="dh-bar-title">${escapeHtml(e.title)}</div>
                    ${locText ? `<div class="dh-bar-loc">📍 ${escapeHtml(locText)}</div>` : ''}
                </div>`;
        });

        rowsHtml += `
            <div class="dh-data-row">
                <div class="dh-label-cell">
                    <div class="dh-label-name">${escapeHtml(loc)}</div>
                    <span class="dh-event-count${locEvents.length === 0 ? ' dh-count-zero' : ''}">${locEvents.length}</span>
                </div>
                <div class="dh-events-area" style="width:${timelineW}px;">${gridHtml}${barsHtml}</div>
            </div>`;
    });

    container.innerHTML = `
        <div class="dh-outer">
            <div class="dh-header-row">
                <div class="dh-corner-cell">エリア</div>
                <div class="dh-time-header" style="width:${timelineW}px;">${timeTicksHtml}</div>
            </div>
            ${rowsHtml}
        </div>`;

    // Current time line
    const now = new Date();
    if (currentDayDate.toDateString() === now.toDateString()) {
        const nowMin = now.getHours() * 60 + now.getMinutes() - HOUR_START * 60;
        const nowLeft = (nowMin / 60) * DH_HOUR_WIDTH;
        container.querySelectorAll('.dh-events-area').forEach(area => {
            const line = document.createElement('div');
            line.className = 'dh-now-line';
            line.style.left = `${nowLeft}px`;
            area.appendChild(line);
        });
    }

    // Scroll to appropriate hour
    const scrollHour = currentDayDate.toDateString() === now.toDateString()
        ? Math.max(HOUR_START, now.getHours() - 1) : 8;
    const dhOuter = container.querySelector('.dh-outer');
    setTimeout(() => { dhOuter.scrollLeft = (scrollHour - HOUR_START) * DH_HOUR_WIDTH; }, 50);
}

// ---- DAY VIEW MODE TOGGLE ----
document.getElementById('day-mode-toggle-btn')?.addEventListener('click', () => {
    const btn = document.getElementById('day-mode-toggle-btn');
    if (dayViewMode === 'vertical') {
        dayViewMode = 'horizontal';
        btn.textContent = '⇄ 縦';
    } else {
        dayViewMode = 'vertical';
        btn.textContent = '⇄ 横';
    }
    renderDayView();
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
    const y = miniCalDate.getFullYear();
    const m = miniCalDate.getMonth();

    const todayStr = new Date().toDateString();

    // First day of month, day-of-week offset (0=Sun)
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const daysInPrev = new Date(y, m, 0).getDate();

    const DOWS = ['日', '月', '火', '水', '木', '金', '土'];

    let cellsHtml = DOWS.map(d => `<div class="mini-cal-dow">${d}</div>`).join('');

    // Leading cells from prev month
    for (let i = firstDow - 1; i >= 0; i--) {
        cellsHtml += `<div class="mini-cal-day mini-cal-day-other">${daysInPrev - i}</div>`;
    }
    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
        const isToday = new Date(y, m, d).toDateString() === todayStr;
        const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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
    const el = document.getElementById('mini-cal-popup');
    const rect = anchorEl.getBoundingClientRect();
    el.style.display = 'block';
    // Position below anchor, centered
    const popW = el.offsetWidth || 260;
    let left = rect.left + rect.width / 2 - popW / 2 + window.scrollX;
    left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
    el.style.left = `${left}px`;
    el.style.top = `${rect.bottom + window.scrollY + 6}px`;
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

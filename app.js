let events = [];
let reports = [];
let fullCal = null;
let locViewDate = new Date();
let locViewType = null; // 'week' | 'day'

const DEFAULT_LOCATIONS = ['室内練習場', 'ベースボールエリア', 'アローズエリア', 'スタジオ', 'パワーエリア', '食堂', '多目的室'];
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

const SNS_LABEL = {
    'allowed': { text: '掲載可（顔出しOK）', cls: 'sns-allowed', icon: '✅' },
    'allowed-face-ok': { text: '掲載可（顔出しOK）', cls: 'sns-allowed', icon: '✅' },
    'allowed-face-ng': { text: '掲載可（顔出しNG）', cls: 'sns-allowed', icon: '✅' },
    'not-allowed': { text: '掲載不可', cls: 'sns-not-allowed', icon: '🚫' },
    'pending': { text: '要確認', cls: 'sns-pending', icon: '⚠️' }
};

function isSnsAllowed(value) {
    return value === 'allowed' || value === 'allowed-face-ok' || value === 'allowed-face-ng';
}

const today = new Date();

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

    const fmtD = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getMonth() + 1}月${d.getDate()}日`; };
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

    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const filtered = [...events]
        .filter(e => getEventDates(e).some(d => (d.endDate || d.startDate) >= todayStr))
        .sort((a, b) => new Date(getEventDates(a)[0].startDate) - new Date(getEventDates(b)[0].startDate));

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

        const dateArea = card.querySelector('.list-card-date');
        if (dateArea) {
            dateArea.classList.add('lc-date-clickable');
            dateArea.title = 'カレンダーで確認';
            dateArea.addEventListener('click', ev => {
                ev.stopPropagation();
                openCalendarAtDate(e.startDate || getEventDates(e)[0].startDate);
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
            if (isSnsAllowed(e.snsPR) && e.snsAvailableFrom) {
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

// ---- FULLCALENDAR ----
function buildCalEvents() {
    const calEvents = [];
    events.forEach(e => {
        getEventDates(e).forEach((d, i) => {
            const hasTime = !!d.startTime;
            const start = d.startDate + (hasTime ? 'T' + d.startTime : '');
            let end;
            if (hasTime && d.endTime) {
                end = d.startDate + 'T' + d.endTime;
            } else if (!hasTime && d.endDate && d.endDate !== d.startDate) {
                const endD = new Date(d.endDate + 'T00:00:00');
                endD.setDate(endD.getDate() + 1);
                end = endD.toISOString().slice(0, 10);
            }
            calEvents.push({
                id: `${e.id}-${i}`,
                title: e.title,
                start,
                end,
                backgroundColor: e.cardColor || '#64748b',
                borderColor: e.cardColor || '#64748b',
                extendedProps: { eventId: e.id }
            });
        });
    });
    return calEvents;
}

function initCalendar() {
    const el = document.getElementById('fullcalendar');
    if (!el || fullCal) return;

    fullCal = new FullCalendar.Calendar(el, {
        initialView: 'dayGridMonth',
        locale: 'ja',
        headerToolbar: false, // カスタムツールバーで一元管理
        events: buildCalEvents(),
        eventClick: function(info) {
            openDetail(info.event.extendedProps.eventId);
        },
        datesSet: function() {
            updateCalTitle();
        },
        height: 'auto',
        eventDisplay: 'block',
        dayMaxEvents: false,
        dayMaxEventRows: false,
        moreLinkText: (n) => `他${n}件`,
        moreLinkClick: 'popover',
        eventTimeFormat: {
            hour: '2-digit',
            minute: '2-digit',
            meridiem: false,
        },
    });

    fullCal.render();
    updateCalTitle();
}

// ---- UNIFIED CALENDAR TOOLBAR ----
let currentCalView = 'dayGridMonth';

function switchCalView(view) {
    currentCalView = view;
    document.querySelectorAll('#cal-view-tabs .cal-view-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.view === view);
    });

    const fcWrap = document.getElementById('fc-wrapper');
    const wkView = document.getElementById('location-week-view');
    const dyView = document.getElementById('location-day-view');

    if (view === 'locationWeek') {
        locViewType = 'week';
        fcWrap.classList.add('fc-hidden');
        wkView.style.display = 'block';
        dyView.style.display = 'none';
        renderLocationWeek();
    } else if (view === 'locationDay') {
        locViewType = 'day';
        fcWrap.classList.add('fc-hidden');
        wkView.style.display = 'none';
        dyView.style.display = 'block';
        renderLocationDay();
    } else {
        locViewType = null;
        fcWrap.classList.remove('fc-hidden');
        wkView.style.display = 'none';
        dyView.style.display = 'none';
        if (fullCal) {
            fullCal.setOption('height', view === 'dayGridMonth' ? 'auto' : 'calc(100vh - 180px)');
            fullCal.changeView(view);
            requestAnimationFrame(() => fullCal.updateSize());
        }
    }
    updateCalTitle();
}

function calPrev() {
    if (locViewType === 'week') {
        locViewDate.setDate(locViewDate.getDate() - 7);
        renderLocationWeek();
        updateCalTitle();
    } else if (locViewType === 'day') {
        locViewDate.setDate(locViewDate.getDate() - 1);
        renderLocationDay();
        updateCalTitle();
    } else if (fullCal) {
        fullCal.prev();
    }
}

function calNext() {
    if (locViewType === 'week') {
        locViewDate.setDate(locViewDate.getDate() + 7);
        renderLocationWeek();
        updateCalTitle();
    } else if (locViewType === 'day') {
        locViewDate.setDate(locViewDate.getDate() + 1);
        renderLocationDay();
        updateCalTitle();
    } else if (fullCal) {
        fullCal.next();
    }
}

function calToday() {
    if (locViewType === 'week' || locViewType === 'day') {
        locViewDate = new Date();
        if (locViewType === 'week') renderLocationWeek();
        else renderLocationDay();
        updateCalTitle();
    } else if (fullCal) {
        fullCal.today();
    }
}

function calJumpToDate() {
    const val = document.getElementById('cal-jump-date').value;
    if (!val) return;
    if (locViewType === 'week' || locViewType === 'day') {
        locViewDate = new Date(val + 'T00:00:00');
        if (locViewType === 'week') renderLocationWeek();
        else renderLocationDay();
        updateCalTitle();
    } else if (fullCal) {
        fullCal.gotoDate(val);
    }
}

function updateCalTitle() {
    const titleEl = document.getElementById('cal-title');
    if (!titleEl) return;
    if (locViewType === 'week') {
        const lbl = document.getElementById('loc-week-label');
        titleEl.textContent = lbl ? lbl.textContent : '';
    } else if (locViewType === 'day') {
        const lbl = document.getElementById('loc-day-label');
        titleEl.textContent = lbl ? lbl.textContent : '';
    } else if (fullCal) {
        titleEl.textContent = fullCal.view.title;
    }
}

// ---- 場所別ビュー共通 ----
function getLocations() {
    const set = new Set(DEFAULT_LOCATIONS);
    events.forEach(e => {
        const locs = Array.isArray(e.locations) && e.locations.length > 0 ? e.locations : (e.location ? [e.location] : []);
        locs.forEach(l => set.add(l));
    });
    return [...set];
}

function eventHasLocation(e, loc) {
    const locs = Array.isArray(e.locations) && e.locations.length > 0 ? e.locations : (e.location ? [e.location] : []);
    return locs.includes(loc);
}

// ---- 場所/週ビュー ----
function getWeekMonday(date) {
    const d = new Date(date);
    const dow = d.getDay();
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    d.setHours(0, 0, 0, 0);
    return d;
}

function toDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function renderLocationWeek() {
    const container = document.getElementById('location-week-grid');
    if (!container) return;

    const monday = getWeekMonday(locViewDate);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const fmt = d => `${d.getMonth()+1}/${d.getDate()}`;
    document.getElementById('loc-week-label').textContent =
        `${monday.getFullYear()}年 ${fmt(monday)}(月) 〜 ${fmt(sunday)}(日)`;

    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        days.push({ d, str: toDateStr(d) });
    }

    const todayStr = toDateStr(new Date());
    const locations = getLocations();

    let html = '<table class="loc-week-table"><thead><tr><th class="loc-th-area">エリア</th>';
    days.forEach(({ d, str }) => {
        const isToday = str === todayStr;
        html += `<th class="loc-th-day${isToday ? ' loc-today-col' : ''}">${d.getMonth()+1}/${d.getDate()}<br><span class="loc-dow">${DAY_NAMES[d.getDay()]}</span></th>`;
    });
    html += '</tr></thead><tbody>';

    locations.forEach(loc => {
        html += `<tr><td class="loc-td-area">${escapeHtml(loc)}</td>`;
        days.forEach(({ str }) => {
            const isToday = str === todayStr;
            const dayEvents = events.filter(e =>
                eventHasLocation(e, loc) &&
                getEventDates(e).some(d => d.startDate <= str && (d.endDate || d.startDate) >= str)
            );
            html += `<td class="loc-td-cell${isToday ? ' loc-today-col' : ''}">`;
            dayEvents.forEach(e => {
                const de = getMatchingDateEntry(e, str);
                const timeStr = de.startTime ? `<span class="loc-chip-time">${de.startTime}</span>` : '';
                const cvars = e.cardColor ? `style="--card-color:${escapeHtml(e.cardColor)}"` : '';
                html += `<div class="loc-ev-chip ${escapeHtml(e.category)}" ${cvars} onclick="openDetail(${e.id})" title="${escapeHtml(e.title)}">${timeStr}<span class="loc-chip-title">${escapeHtml(e.title)}</span></div>`;
            });
            html += '</td>';
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// ---- 場所/日ビュー ----
const LOC_DAY_HOUR_START = 6;
const LOC_DAY_HOUR_END = 22;
const LOC_DAY_PX_PER_HOUR = 60;

function renderLocationDay() {
    const timeline = document.getElementById('loc-day-timeline');
    const alldaySection = document.getElementById('loc-day-allday-section');
    const alldayEvents = document.getElementById('loc-day-allday-events');
    if (!timeline) return;

    const dayStr = toDateStr(locViewDate);
    document.getElementById('loc-day-label').textContent =
        `${locViewDate.getFullYear()}年${locViewDate.getMonth()+1}月${locViewDate.getDate()}日(${DAY_NAMES[locViewDate.getDay()]})`;

    const dayEvs = events.filter(e => getEventDates(e).some(d => d.startDate <= dayStr && (d.endDate || d.startDate) >= dayStr));
    const timed = dayEvs.filter(e => getMatchingDateEntry(e, dayStr).startTime);
    const allDay = dayEvs.filter(e => !getMatchingDateEntry(e, dayStr).startTime);

    // All-day section
    if (allDay.length > 0) {
        alldayEvents.innerHTML = allDay.map(e =>
            `<div class="day-allday-event ${escapeHtml(e.category)}" onclick="openDetail(${e.id})">${escapeHtml(e.title)}</div>`
        ).join('');
        alldaySection.style.display = 'flex';
    } else {
        alldaySection.style.display = 'none';
    }

    const totalH = LOC_DAY_HOUR_END - LOC_DAY_HOUR_START;
    const totalPx = totalH * LOC_DAY_PX_PER_HOUR;

    const locations = getLocations();

    // Time labels
    let labelsHtml = '<div class="day-time-labels"><div class="day-loc-header-spacer"></div>';
    for (let h = LOC_DAY_HOUR_START; h <= LOC_DAY_HOUR_END; h++) {
        labelsHtml += `<div class="day-time-label">${String(h).padStart(2,'0')}:00</div>`;
    }
    labelsHtml += '</div>';

    // Location columns
    let colsHtml = '<div class="day-location-columns">';
    const now = new Date();
    const isToday = locViewDate.toDateString() === now.toDateString();

    locations.forEach(loc => {
        const locEvs = timed.filter(e => eventHasLocation(e, loc));

        let slotsHtml = '';
        for (let h = LOC_DAY_HOUR_START; h <= LOC_DAY_HOUR_END; h++) {
            slotsHtml += '<div class="day-time-slot"></div>';
        }

        let evHtml = '';
        locEvs.forEach(e => {
            const de = getMatchingDateEntry(e, dayStr);
            const [sh, sm] = de.startTime.split(':').map(Number);
            const etStr = de.endTime || `${Math.min(sh + 1, 23)}:00`;
            const [eh, em] = etStr.split(':').map(Number);
            const top = (sh * 60 + sm - LOC_DAY_HOUR_START * 60);
            const height = Math.max(28, (eh * 60 + em) - (sh * 60 + sm));
            if (top < 0 || top > totalPx) return;
            const cvars = e.cardColor ? `--card-color:${escapeHtml(e.cardColor)};` : '';
            evHtml += `<div class="day-event-block ${escapeHtml(e.category)}" style="top:${top}px;height:${height}px;${cvars}" onclick="openDetail(${e.id})">
                <div class="day-event-time">${escapeHtml(de.startTime)}${de.endTime ? '-'+escapeHtml(de.endTime) : ''}</div>
                <div class="day-event-title">${escapeHtml(e.title)}</div>
            </div>`;
        });

        let nowLineHtml = '';
        if (isToday) {
            const nowMin = now.getHours() * 60 + now.getMinutes() - LOC_DAY_HOUR_START * 60;
            if (nowMin >= 0 && nowMin <= totalPx) {
                nowLineHtml = `<div class="day-current-time" style="top:${nowMin}px;"></div>`;
            }
        }

        colsHtml += `<div class="day-location-col">
            <div class="day-location-header">${escapeHtml(loc)}</div>
            <div class="day-events-col" style="height:${totalPx}px;">${slotsHtml}${evHtml}${nowLineHtml}</div>
        </div>`;
    });
    colsHtml += '</div>';

    timeline.innerHTML = labelsHtml + colsHtml;

    // Scroll to 8am
    const scrollTo = (8 - LOC_DAY_HOUR_START) * LOC_DAY_PX_PER_HOUR;
    setTimeout(() => { timeline.scrollTop = scrollTo; }, 50);
}

function openCalendarAtDate(dateStr) {
    setActiveNav(navCalendar);
    viewCal.style.display = 'block';
    initCalendar();
    // 場所ビューを抜けて通常ビューに戻す
    if (locViewType) switchCalView('dayGridMonth');
    if (fullCal) {
        fullCal.gotoDate(dateStr);
    }
}

// ---- REPORT FORM (Firebase) ----
const RF_FIREBASE_KEY = 'ag_report_firebase_config';
let rfDb = null;
let rfFirebaseConnected = false;

function extractRfFirebaseConfig(str) {
    const extract = (key) => {
        const m = str.match(new RegExp(key + '\\s*:\\s*["\']([^"\']+)["\']'));
        return m ? m[1] : '';
    };
    return {
        apiKey: extract('apiKey'),
        authDomain: extract('authDomain'),
        databaseURL: extract('databaseURL'),
        projectId: extract('projectId'),
        storageBucket: extract('storageBucket'),
        messagingSenderId: extract('messagingSenderId'),
        appId: extract('appId'),
    };
}

function loadReportFirebaseConfig() {
    try {
        const saved = localStorage.getItem(RF_FIREBASE_KEY);
        if (!saved) return;
        const { configStr } = JSON.parse(saved);
        const el = document.getElementById('rf-firebase-config');
        if (el && configStr) el.value = configStr;
        const cfg = extractRfFirebaseConfig(configStr);
        if (cfg.apiKey && cfg.databaseURL) initReportFirebase(cfg);
    } catch (e) {}
}

function connectReportFirebase() {
    const configStr = document.getElementById('rf-firebase-config').value.trim();
    if (!configStr) { showReportMessage('Firebase設定を貼り付けてください', 'error'); return; }
    const cfg = extractRfFirebaseConfig(configStr);
    if (!cfg.apiKey || !cfg.databaseURL) {
        showReportMessage('apiKey または databaseURL が見つかりません。', 'error');
        return;
    }
    localStorage.setItem(RF_FIREBASE_KEY, JSON.stringify({ configStr }));
    initReportFirebase(cfg);
}

function initReportFirebase(cfg) {
    try {
        if (typeof firebase === 'undefined') {
            showReportMessage('Firebase SDKが読み込まれていません。', 'error');
            return;
        }
        if (!firebase.apps.length) firebase.initializeApp(cfg);
        rfDb = firebase.database();
        rfFirebaseConnected = true;
        updateRfBadge(true);
        document.getElementById('rf-firebase-body').style.display = 'none';
        document.getElementById('rf-firebase-toggle').textContent = '▼';
    } catch (e) {
        showReportMessage('Firebase接続エラー: ' + e.message, 'error');
        updateRfBadge(false);
    }
}

function updateRfBadge(connected) {
    const badge = document.getElementById('rf-firebase-badge');
    if (!badge) return;
    badge.textContent = connected ? '接続済み' : '未接続';
    badge.className = connected ? 'rf-badge rf-badge-connected' : 'rf-badge rf-badge-disconnected';
}

function toggleReportFirebaseSettings() {
    const body = document.getElementById('rf-firebase-body');
    const icon = document.getElementById('rf-firebase-toggle');
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? 'block' : 'none';
    icon.textContent = isHidden ? '▲' : '▼';
}

function renderReportEventSelect() {
    const select = document.getElementById('rf-event-select');
    if (!select) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    const pastEvents = events.filter(e => {
        const dates = getEventDates(e);
        return dates.some(d => (d.startDate || '') <= todayStr);
    });
    pastEvents.sort((a, b) => {
        const aDate = getEventDates(a)[0]?.startDate || '';
        const bDate = getEventDates(b)[0]?.startDate || '';
        return bDate.localeCompare(aDate);
    });
    select.innerHTML = '<option value="">-- 選択すると下の項目が自動入力されます --</option>';
    pastEvents.forEach(e => {
        const dates = getEventDates(e);
        const dateStr = dates[0]?.startDate || '';
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = `${dateStr} - ${e.title}`;
        select.appendChild(opt);
    });
}

function onReportEventSelect() {
    const select = document.getElementById('rf-event-select');
    const eventId = parseInt(select?.value);
    if (!eventId) return;
    const ev = events.find(e => e.id === eventId);
    if (!ev) return;

    const titleEl = document.getElementById('rf-event-title');
    if (titleEl && !titleEl.value) titleEl.value = ev.title || '';

    const dateEl = document.getElementById('rf-event-date-text');
    if (dateEl && !dateEl.value) {
        const dates = getEventDates(ev);
        const fmt = (s) => {
            const d = new Date(s + 'T00:00:00');
            const DOW = ['日', '月', '火', '水', '木', '金', '土'];
            return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${DOW[d.getDay()]}）`;
        };
        if (dates.length === 1) {
            dateEl.value = fmt(dates[0].startDate);
        } else {
            dateEl.value = dates.map(d => fmt(d.startDate)).join('、');
        }
    }
}

function addContentRow(text) {
    const list = document.getElementById('rf-contents-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'rf-photo-row';
    row.innerHTML = `<input type="text" class="rf-content-item" placeholder="例: 守備指導、スローイング指導" value="${escapeHtml(text || '')}">
        <button type="button" class="rf-photo-remove" onclick="this.parentElement.remove()">✕</button>`;
    list.appendChild(row);
}

function addParagraphRow(text) {
    const list = document.getElementById('rf-paragraphs-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'rf-paragraph-row';
    row.innerHTML = `<textarea class="rf-paragraph-item" rows="4" placeholder="本文の段落を入力してください">${escapeHtml(text || '')}</textarea>
        <button type="button" class="rf-photo-remove rf-para-remove" onclick="this.parentElement.remove()">✕</button>`;
    list.appendChild(row);
}

function addReportPhotoRow(url) {
    const list = document.getElementById('rf-photos-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'rf-photo-row rf-photo-row-url';
    row.innerHTML = `<input type="text" class="rf-photo-url" placeholder="https://..." value="${escapeHtml(url || '')}">
        <button type="button" class="rf-photo-remove" onclick="this.parentElement.remove()">✕</button>`;
    list.appendChild(row);
}

function addReportPhotoFileRow(url, name) {
    const list = document.getElementById('rf-photos-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'rf-photo-row rf-photo-row-file';
    row.dataset.url = url;
    row.innerHTML = `<img class="rf-photo-thumb" src="${escapeHtml(url)}" alt="">
        <span class="rf-photo-filename">${escapeHtml(name || '写真')}</span>
        <button type="button" class="rf-photo-remove" onclick="this.parentElement.remove()">✕</button>`;
    list.appendChild(row);
}

function compressReportImage(file, maxSize = 1600, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > maxSize || height > maxSize) {
                if (width >= height) {
                    height = Math.round(height * maxSize / width);
                    width = maxSize;
                } else {
                    width = Math.round(width * maxSize / height);
                    height = maxSize;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像の読み込みに失敗しました')); };
        img.src = url;
    });
}

async function handleReportPhotoFiles(input) {
    const files = Array.from(input.files || []);
    if (files.length === 0) return;
    const status = document.getElementById('rf-photo-uploading');
    if (status) { status.textContent = `写真を処理中… (0/${files.length})`; status.style.display = 'block'; }
    let done = 0;
    for (const file of files) {
        if (!file.type.startsWith('image/')) { done++; continue; }
        try {
            const dataUrl = await compressReportImage(file);
            addReportPhotoFileRow(dataUrl, file.name);
        } catch (e) {
            showReportMessage(`${file.name} の処理に失敗しました: ${e.message}`, 'error');
        }
        done++;
        if (status) status.textContent = `写真を処理中… (${done}/${files.length})`;
    }
    input.value = '';
    if (status) status.style.display = 'none';
}

function showReportMessage(msg, type) {
    const el = document.getElementById('rf-submit-message');
    if (!el) return;
    el.textContent = msg;
    el.className = `rf-submit-message ${type}`;
    el.style.display = 'block';
    if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function submitReport() {
    if (!rfFirebaseConnected || !rfDb) {
        showReportMessage('Firebaseに接続してください。', 'error');
        return;
    }

    const title = document.getElementById('rf-event-title').value.trim();
    if (!title) { showReportMessage('イベント名を入力してください。', 'error'); return; }

    const dateText = document.getElementById('rf-event-date-text').value.trim();
    if (!dateText) { showReportMessage('日程を入力してください。', 'error'); return; }

    const organizer = document.getElementById('rf-organizer').value.trim();
    if (!organizer) { showReportMessage('主催を入力してください。', 'error'); return; }

    const reporter = document.getElementById('rf-reporter-name').value.trim();
    if (!reporter) { showReportMessage('報告者名を入力してください。', 'error'); return; }

    const selectEl = document.getElementById('rf-event-select');
    const eventId = selectEl ? parseInt(selectEl.value) : null;
    const ev = eventId ? events.find(e => e.id === eventId) : null;
    const rawDate = ev ? (getEventDates(ev)[0]?.startDate || '') : '';

    const contents = [];
    document.querySelectorAll('#rf-contents-list .rf-content-item').forEach(input => {
        const v = input.value.trim();
        if (v) contents.push(v);
    });

    const paragraphs = [];
    document.querySelectorAll('#rf-paragraphs-list .rf-paragraph-item').forEach(ta => {
        const v = ta.value.trim();
        if (v) paragraphs.push(v);
    });

    const photos = [];
    document.querySelectorAll('#rf-photos-list .rf-photo-row').forEach(row => {
        if (row.classList.contains('rf-photo-row-file')) {
            if (row.dataset.url) photos.push(row.dataset.url);
        } else {
            const input = row.querySelector('.rf-photo-url');
            if (input && input.value.trim()) photos.push(input.value.trim());
        }
    });

    const reportData = {
        eventId: ev ? ev.id : null,
        eventTitle: title,
        eventDateText: dateText,
        eventDate: rawDate,
        category: ev ? (ev.category || 'other') : 'other',
        categoryText: ev ? (ev.categoryText || '') : '',
        cardColor: ev ? (ev.cardColor || '') : '',
        organizer: organizer,
        supporter: document.getElementById('rf-supporter').value.trim(),
        target: document.getElementById('rf-target').value.trim(),
        contents: contents,
        paragraphs: paragraphs,
        photos: photos,
        reporter: reporter,
        submittedAt: new Date().toISOString(),
    };

    rfDb.ref('pendingReports').push(reportData)
        .then(() => {
            showReportMessage('実施報告を送信しました。管理者の承認をお待ちください。', 'success');
            selectEl.value = '';
            document.getElementById('rf-event-title').value = '';
            document.getElementById('rf-event-date-text').value = '';
            document.getElementById('rf-organizer').value = '';
            document.getElementById('rf-supporter').value = '';
            document.getElementById('rf-target').value = '';
            document.getElementById('rf-contents-list').innerHTML = '';
            document.getElementById('rf-paragraphs-list').innerHTML = '';
            document.getElementById('rf-photos-list').innerHTML = '';
            document.getElementById('rf-reporter-name').value = '';
        })
        .catch(e => {
            showReportMessage('送信に失敗しました: ' + e.message, 'error');
        });
}

// ---- NAVIGATION ----
const navHome = document.getElementById('nav-home');
const navCalendar = document.getElementById('nav-calendar');
const navReports = document.getElementById('nav-reports');
const navReportForm = document.getElementById('nav-report-form');
const viewHome = document.getElementById('view-home');
const viewCal = document.getElementById('view-calendar');
const viewReports = document.getElementById('view-reports');
const viewReportForm = document.getElementById('view-report-form');

function setActiveNav(active) {
    [navHome, navCalendar, navReports, navReportForm].forEach(n => n?.classList.remove('active'));
    active?.classList.add('active');
    viewHome.style.display = 'none';
    viewCal.style.display = 'none';
    if (viewReports) viewReports.style.display = 'none';
    if (viewReportForm) viewReportForm.style.display = 'none';
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
    initCalendar();
});

navReports?.addEventListener('click', e => {
    e.preventDefault();
    setActiveNav(navReports);
    if (viewReports) viewReports.style.display = 'block';
    renderReports();
});

navReportForm?.addEventListener('click', e => {
    e.preventDefault();
    setActiveNav(navReportForm);
    if (viewReportForm) viewReportForm.style.display = 'block';
    renderReportEventSelect();
    loadReportFirebaseConfig();
});

// ---- START ----
init();

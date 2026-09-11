import fs from 'node:fs';

const activeEvents = JSON.parse(fs.readFileSync(new URL('../../events.json', import.meta.url), 'utf8'));
const archivedEvents = JSON.parse(fs.readFileSync(new URL('../../archived_events.json', import.meta.url), 'utf8'));

const facilities = [
  '室内練習場',
  'ベースボールエリア',
  'アローズエリア',
  'スタジオ',
  'バッティングブースA',
  'バッティングブースB',
  '打撃エリア',
  '投手測定エリア',
  '食堂',
  '多目的室',
  'パワーエリア',
];

const businessStart = 8 * 60;
const businessEnd = 21 * 60;
const businessMinutesPerDay = businessEnd - businessStart;

function rangesFor(event) {
  if (Array.isArray(event.dates) && event.dates.length > 0) {
    return event.dates.map(date => ({
      startDate: date.startDate || '',
      endDate: date.endDate || date.startDate || '',
      startTime: date.startTime || '',
      endTime: date.endTime || '',
    }));
  }
  return [{
    startDate: event.startDate || '',
    endDate: event.endDate || event.startDate || '',
    startTime: event.startTime || '',
    endTime: event.endTime || '',
  }];
}

function signature(event) {
  return JSON.stringify({
    title: event.title || '',
    ranges: rangesFor(event),
    locations: [...new Set(event.locations || (event.location ? [event.location] : []))].sort(),
    usageType: event.usageType || '',
  });
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function dashboardKey(event) {
  return `${event.originalEventId ?? event.id ?? 'no-id'}:${hash(signature(event))}`;
}

function parseMinutes(value) {
  if (!/^\d{1,2}:\d{2}$/.test(value || '')) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function eachDate(startDate, endDate) {
  const dates = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate || startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return dates;
  for (let date = start; date <= end; date = new Date(date.getTime() + 86_400_000)) {
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function mergeMinutes(intervals) {
  if (intervals.length === 0) return 0;
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let [start, end] = sorted[0];
  for (const [nextStart, nextEnd] of sorted.slice(1)) {
    if (nextStart <= end) end = Math.max(end, nextEnd);
    else {
      total += end - start;
      [start, end] = [nextStart, nextEnd];
    }
  }
  return total + end - start;
}

const seen = new Set();
const allEvents = [...activeEvents.map(event => ({ ...event, source: 'active' })), ...archivedEvents.map(event => ({ ...event, source: 'archived' }))]
  .filter(event => {
    const key = dashboardKey(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

function calculateMonth(year, month) {
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const facilityIntervals = new Map(facilities.map(facility => [facility, new Map()]));
  const eventRows = [];
  let scheduleDays = 0;
  let ignoredTimeScheduleDays = 0;

  for (const event of allEvents) {
    const eventIntervals = [];
    let eventScheduleDays = 0;
    let eventIgnoredDays = 0;
    const eventLocations = [...new Set(event.locations || (event.location ? [event.location] : []))]
      .filter(location => facilities.includes(location));

    for (const range of rangesFor(event)) {
      const dates = eachDate(range.startDate, range.endDate || range.startDate).filter(date => date.startsWith(monthKey));
      if (dates.length === 0) continue;
      eventScheduleDays += dates.length;
      scheduleDays += dates.length;

      const rawStart = parseMinutes(range.startTime);
      const rawEnd = parseMinutes(range.endTime);
      const start = rawStart === null ? null : Math.min(Math.max(rawStart, businessStart), businessEnd);
      const end = rawEnd === null ? null : Math.min(Math.max(rawEnd, businessStart), businessEnd);
      if (start === null || end === null || end <= start) {
        eventIgnoredDays += dates.length;
        ignoredTimeScheduleDays += dates.length;
        continue;
      }

      for (const date of dates) {
        for (const facility of eventLocations) {
          const dayMap = facilityIntervals.get(facility);
          if (!dayMap.has(date)) dayMap.set(date, []);
          dayMap.get(date).push([start, end]);
          eventIntervals.push({ facility, date, start, end });
        }
      }
    }

    if (eventScheduleDays > 0) {
      eventRows.push({
        source: event.source,
        id: event.id,
        originalEventId: event.originalEventId ?? null,
        title: event.title,
        usageType: event.usageType || 'unset',
        scheduleDays: eventScheduleDays,
        ignoredTimeScheduleDays: eventIgnoredDays,
        facilities: eventLocations,
        scheduledFacilityHours: eventIntervals.reduce((sum, interval) => sum + interval.end - interval.start, 0) / 60,
      });
    }
  }

  const facilityRows = facilities.map(facility => {
    const dayMap = facilityIntervals.get(facility);
    const occupiedMinutes = [...dayMap.values()].reduce((sum, intervals) => sum + mergeMinutes(intervals), 0);
    const availableMinutes = daysInMonth * businessMinutesPerDay;
    return {
      facility,
      occupiedHours: occupiedMinutes / 60,
      availableHours: availableMinutes / 60,
      activeDays: dayMap.size,
      ratePct: Math.round((occupiedMinutes / availableMinutes) * 100),
    };
  });

  const occupiedFacilityHours = facilityRows.reduce((sum, row) => sum + row.occupiedHours, 0);
  const totalCapacityHours = facilities.length * daysInMonth * businessMinutesPerDay / 60;
  const displayedAverageRatePct = Math.round(facilityRows.reduce((sum, row) => sum + row.ratePct, 0) / facilities.length);
  const activeFacilityRows = facilityRows.filter(row => row.occupiedHours > 0);

  return {
    month: monthKey,
    daysInMonth,
    registeredEvents: eventRows.length,
    activeRecords: eventRows.filter(row => row.source === 'active').length,
    archivedRecords: eventRows.filter(row => row.source === 'archived').length,
    scheduleDays,
    ignoredTimeScheduleDays,
    occupiedFacilityHours,
    totalCapacityHours,
    aggregateRatePct: occupiedFacilityHours / totalCapacityHours * 100,
    displayedAverageRatePct,
    activeFacilities: activeFacilityRows.length,
    activeFacilityOnlyRatePct: occupiedFacilityHours / (activeFacilityRows.length * daysInMonth * businessMinutesPerDay / 60) * 100,
    eventRows,
    facilityRows,
  };
}

const monthly = [3, 4, 5, 6, 7, 8].map(month => calculateMonth(2026, month));
const july = monthly.find(row => row.month === '2026-07');
const archivedHours = july.eventRows.filter(row => row.source === 'archived').reduce((sum, row) => sum + row.scheduledFacilityHours, 0);
const missingUsageHours = july.eventRows.filter(row => row.usageType === 'unset').reduce((sum, row) => sum + row.scheduledFacilityHours, 0);
const unknownLocations = [...new Set(allEvents.flatMap(event => event.locations || (event.location ? [event.location] : [])).filter(location => !facilities.includes(location)))];

console.log(JSON.stringify({
  sourceCounts: {
    active: activeEvents.length,
    archived: archivedEvents.length,
    deduplicatedCombined: allEvents.length,
  },
  monthly: monthly.map(row => ({
    month: row.month,
    registeredEvents: row.registeredEvents,
    activeRecords: row.activeRecords,
    archivedRecords: row.archivedRecords,
    scheduleDays: row.scheduleDays,
    occupiedFacilityHours: Number(row.occupiedFacilityHours.toFixed(1)),
    aggregateRatePct: Number(row.aggregateRatePct.toFixed(2)),
    displayedAverageRatePct: row.displayedAverageRatePct,
  })),
  july: {
    ...july,
    occupiedFacilityHours: Number(july.occupiedFacilityHours.toFixed(1)),
    totalCapacityHours: Number(july.totalCapacityHours.toFixed(1)),
    aggregateRatePct: Number(july.aggregateRatePct.toFixed(2)),
    activeFacilityOnlyRatePct: Number(july.activeFacilityOnlyRatePct.toFixed(2)),
    archivedHours: Number(archivedHours.toFixed(1)),
    archivedSharePct: Number((archivedHours / july.occupiedFacilityHours * 100).toFixed(1)),
    missingUsageHours: Number(missingUsageHours.toFixed(1)),
    missingUsageSharePct: Number((missingUsageHours / july.occupiedFacilityHours * 100).toFixed(1)),
  },
  quality: {
    unknownLocations,
    julyMissingUsageEvents: july.eventRows.filter(row => row.usageType === 'unset').length,
    julyMissingTimeScheduleDays: july.ignoredTimeScheduleDays,
  },
}, null, 2));

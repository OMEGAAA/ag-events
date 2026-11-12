import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const facilities = [
  '室内練習場', 'ベースボールエリア', 'アローズエリア', 'スタジオ',
  'バッティングブースA', 'バッティングブースB', '打撃エリア',
  '投手測定エリア', '食堂', '多目的室', 'パワーエリア',
];

function showJson(commit, path) {
  if (commit === 'current') return JSON.parse(fs.readFileSync(path, 'utf8'));
  try {
    return JSON.parse(execFileSync('git', ['show', `${commit}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return [];
  }
}

function rangesFor(event) {
  return Array.isArray(event.dates) && event.dates.length > 0
    ? event.dates
    : [{ startDate: event.startDate, endDate: event.endDate || event.startDate, startTime: event.startTime, endTime: event.endTime }];
}

function datesInJuly(range) {
  const start = new Date(`${range.startDate}T00:00:00Z`);
  const end = new Date(`${range.endDate || range.startDate}T00:00:00Z`);
  const dates = [];
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return dates;
  for (let date = start; date <= end; date = new Date(date.getTime() + 86_400_000)) {
    const key = date.toISOString().slice(0, 10);
    if (key.startsWith('2026-07')) dates.push(key);
  }
  return dates;
}

function minutes(value) {
  if (!/^\d{1,2}:\d{2}$/.test(value || '')) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
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

function eventIdentity(event) {
  return JSON.stringify({
    id: event.originalEventId ?? event.id ?? null,
    title: event.title || '',
    dates: rangesFor(event).map(range => ({
      startDate: range.startDate || '', endDate: range.endDate || range.startDate || '',
      startTime: range.startTime || '', endTime: range.endTime || '',
    })),
    locations: [...new Set(event.locations || (event.location ? [event.location] : []))].sort(),
  });
}

function snapshot(commit, label) {
  const active = showJson(commit, 'events.json').map(event => ({ ...event, source: 'active' }));
  const archived = showJson(commit, 'archived_events.json').map(event => ({ ...event, source: 'archived' }));
  const seen = new Set();
  const events = [...active, ...archived].filter(event => {
    const key = eventIdentity(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return rangesFor(event).some(range => datesInJuly(range).length > 0);
  });
  const intervalMap = new Map(facilities.map(facility => [facility, new Map()]));
  let scheduleDays = 0;
  let additiveFacilityHours = 0;
  const eventRows = [];

  for (const event of events) {
    let eventScheduleDays = 0;
    let eventFacilityHours = 0;
    const locations = [...new Set(event.locations || (event.location ? [event.location] : []))].filter(location => facilities.includes(location));
    for (const range of rangesFor(event)) {
      const dates = datesInJuly(range);
      eventScheduleDays += dates.length;
      const start = minutes(range.startTime);
      const end = minutes(range.endTime);
      if (start === null || end === null) continue;
      const clippedStart = Math.min(Math.max(start, 480), 1260);
      const clippedEnd = Math.min(Math.max(end, 480), 1260);
      if (clippedEnd <= clippedStart) continue;
      for (const date of dates) {
        for (const location of locations) {
          const dayMap = intervalMap.get(location);
          if (!dayMap.has(date)) dayMap.set(date, []);
          dayMap.get(date).push([clippedStart, clippedEnd]);
          eventFacilityHours += (clippedEnd - clippedStart) / 60;
        }
      }
    }
    scheduleDays += eventScheduleDays;
    additiveFacilityHours += eventFacilityHours;
    eventRows.push({
      source: event.source,
      id: event.id,
      originalEventId: event.originalEventId ?? null,
      title: event.title,
      scheduleDays: eventScheduleDays,
      facilityHours: Number(eventFacilityHours.toFixed(1)),
      identity: eventIdentity(event),
    });
  }

  const occupiedFacilityHours = [...intervalMap.values()].reduce((sum, dayMap) =>
    sum + [...dayMap.values()].reduce((daySum, intervals) => daySum + mergeMinutes(intervals), 0), 0) / 60;

  return {
    commit,
    label,
    registeredEvents: events.length,
    activeRecords: events.filter(event => event.source === 'active').length,
    archivedRecords: events.filter(event => event.source === 'archived').length,
    scheduleDays,
    additiveFacilityHours: Number(additiveFacilityHours.toFixed(1)),
    occupiedFacilityHours: Number(occupiedFacilityHours.toFixed(1)),
    displayedRatePct: Math.round(occupiedFacilityHours / 4433 * 100),
    eventRows,
  };
}

const snapshots = [
  snapshot('8981db9', '7月29日 08:32（最多）'),
  snapshot('c50c11c', '7月29日 12:38（大量削除後）'),
  snapshot('66765a3', '7月29日 14:16（当日最終）'),
  snapshot('3d6b196', '8月1日 10:44'),
  snapshot('6084947', '8月7日 11:18'),
  snapshot('current', '現在'),
];

const peak = snapshots[0];
const current = snapshots.at(-1);
const currentIdentities = new Set(current.eventRows.map(event => event.identity));
const currentTitles = new Set(current.eventRows.map(event => event.title));
const missingFromPeak = peak.eventRows
  .filter(event => !currentIdentities.has(event.identity))
  .map(({ identity, ...event }) => ({
    ...event,
    status: currentTitles.has(event.title) ? '同名データは残るが日程・内容が異なる' : '現在の7月データに同名イベントなし',
  }))
  .sort((a, b) => b.facilityHours - a.facilityHours || a.title.localeCompare(b.title, 'ja'));

const output = {
  snapshots: snapshots.map(({ eventRows, ...row }) => row),
  peakToCurrent: {
    registeredEventChange: current.registeredEvents - peak.registeredEvents,
    scheduleDayChange: current.scheduleDays - peak.scheduleDays,
    occupiedFacilityHourChange: Number((current.occupiedFacilityHours - peak.occupiedFacilityHours).toFixed(1)),
    displayedRatePointChange: current.displayedRatePct - peak.displayedRatePct,
    missingExactRecords: missingFromPeak.length,
  },
  missingFromPeak,
};

if (process.argv.includes('--summary')) delete output.missingFromPeak;
console.log(JSON.stringify(output, null, 2));

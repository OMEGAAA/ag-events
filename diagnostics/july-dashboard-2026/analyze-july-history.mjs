import { execFileSync } from 'node:child_process';

function showJson(commit, path) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${commit}:${path}`], { encoding: 'utf8' }));
  } catch {
    return [];
  }
}

function rangesFor(event) {
  return Array.isArray(event.dates) && event.dates.length > 0
    ? event.dates
    : [{ startDate: event.startDate, endDate: event.endDate || event.startDate }];
}

function touchesJuly(event) {
  return rangesFor(event).some(range =>
    range.startDate && range.startDate <= '2026-07-31' && (range.endDate || range.startDate) >= '2026-07-01');
}

function identity(event) {
  return JSON.stringify({
    sourceId: event.originalEventId ?? event.id ?? 'no-id',
    title: event.title || '',
    ranges: rangesFor(event).map(range => ({
      startDate: range.startDate || '',
      endDate: range.endDate || range.startDate || '',
      startTime: range.startTime || '',
      endTime: range.endTime || '',
    })),
    locations: [...new Set(event.locations || (event.location ? [event.location] : []))].sort(),
    usageType: event.usageType || '',
  });
}

const log = execFileSync('git', [
  'log',
  '--format=%H|%cI|%s',
  '--',
  'events.json',
  'archived_events.json',
], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);

const snapshots = [];
for (const line of log) {
  const [commit, committedAt, ...subjectParts] = line.split('|');
  const active = showJson(commit, 'events.json').map(event => ({ ...event, source: 'active' }));
  const archived = showJson(commit, 'archived_events.json').map(event => ({ ...event, source: 'archived' }));
  const seen = new Set();
  const july = [...active, ...archived].filter(event => {
    const key = identity(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return touchesJuly(event);
  });
  snapshots.push({
    commit: commit.slice(0, 7),
    committedAt,
    subject: subjectParts.join('|'),
    julyCount: july.length,
    titles: july.map(event => `${event.source}:${event.title}`).sort(),
  });
}

const chronological = snapshots.reverse();
const changes = chronological.filter((snapshot, index) => {
  if (index === 0) return true;
  const previous = chronological[index - 1];
  return snapshot.julyCount !== previous.julyCount || JSON.stringify(snapshot.titles) !== JSON.stringify(previous.titles);
});

console.log(JSON.stringify({
  inspectedSnapshots: snapshots.length,
  maximumJulyCount: Math.max(...snapshots.map(snapshot => snapshot.julyCount)),
  minimumJulyCount: Math.min(...snapshots.map(snapshot => snapshot.julyCount)),
  changes,
}, null, 2));

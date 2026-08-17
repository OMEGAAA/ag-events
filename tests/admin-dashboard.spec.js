const { test, expect } = require('@playwright/test');

async function openAdmin(page) {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 204, body: '' }));
  await page.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 204, body: '' }));
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: '',
  }));
  await page.goto('/admin/index.html');
  await expect(page).toHaveTitle(/AG\.Admin/);
}

async function loadRepositoryEvents(page, year = 2026, month = 6) {
  await page.evaluate(async ({ year, month }) => {
    const [active, archived] = await Promise.all([
      fetch('/events.json').then(response => response.json()),
      fetch('/archived_events.json').then(response => response.json()),
    ]);
    events = normalizeEventLocations(active);
    archivedEvents = normalizeEventLocations(archived);
    archivedLoadError = '';
    dashboardYear = year;
    dashboardMonth = month;
    dashboardUsageFilter = 'all';
    renderEventList();
    renderArchivedList();
    renderDashboard();
  }, { year, month });
}

test.describe('施設稼働率ダッシュボード', () => {
  test('7月はアーカイブを含む4件・20日程・平均6%と表示する', async ({ page }) => {
    await openAdmin(page);
    await loadRepositoryEvents(page);

    await expect(page.locator('#dashboard-month-label')).toHaveText('2026年7月');
    await expect(page.locator('#kpi-event-count')).toHaveText('4件 / 20日程');
    await expect(page.locator('#kpi-avg-rate')).toHaveText('6%');
    await expect(page.locator('#dashboard-badge')).toHaveText('データあり');

    await page.locator('[data-usage="unset"]').click();
    await expect(page.locator('#kpi-event-count')).toHaveText('2件 / 12日程');
    await expect(page.locator('#dashboard-data-warning')).toContainText('利用区分未設定: 2件');

    await page.locator('[data-usage="all"]').click();
    await page.locator('#dashboard-section').screenshot({ path: 'test-results/admin-dashboard-july.png' });

    const overflow = await page.evaluate(() => {
      const dashboard = document.getElementById('dashboard-section');
      const kpis = document.querySelector('.kpi-grid');
      const elementEscapes = (container, elements) => {
        const bounds = container.getBoundingClientRect();
        return elements.some(element => {
          const rect = element.getBoundingClientRect();
          return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
        });
      };
      return {
        page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        dashboard: dashboard.scrollWidth > dashboard.clientWidth + 1,
        kpis: kpis.scrollWidth > kpis.clientWidth + 1,
        kpiCards: elementEscapes(kpis, [...kpis.children]),
        filterButtons: elementEscapes(document.getElementById('usage-filter'), [...document.querySelectorAll('.usage-filter-btn')]),
      };
    });
    expect(overflow).toEqual({ page: false, dashboard: false, kpis: false, kpiCards: false, filterButtons: false });
  });

  test('同一施設の重複時間は二重加算しない', async ({ page }) => {
    await openAdmin(page);
    const result = await page.evaluate(() => {
      const makeEvent = (id, startTime, endTime) => ({
        id,
        title: `重複テスト${id}`,
        dates: [{ startDate: '2026-07-01', endDate: '2026-07-01', startTime, endTime }],
        locations: ['室内練習場'],
        usageType: 'internal',
      });
      events = [makeEvent(1, '09:00', '12:00'), makeEvent(2, '10:00', '13:00')];
      archivedEvents = [];
      dashboardUsageFilter = 'all';
      const data = calcUtilization(2026, 6);
      const facility = data.results.find(row => row.name === '室内練習場');
      return {
        totalMinutes: facility.totalMinutes,
        eventCount: facility.eventCount,
        monthEvents: data.monthEvents.length,
        schedules: data.monthScheduleCount,
      };
    });

    expect(result).toEqual({ totalMinutes: 240, eventCount: 2, monthEvents: 2, schedules: 2 });
  });

  test('時刻未入力はイベント・日程として数えるが稼働時間には加えない', async ({ page }) => {
    await openAdmin(page);
    const result = await page.evaluate(() => {
      events = [{
        id: 1,
        title: '時刻未入力',
        dates: [{ startDate: '2026-07-02', endDate: '2026-07-02', startTime: '', endTime: '' }],
        locations: ['投手測定エリア'],
      }];
      archivedEvents = [];
      dashboardUsageFilter = 'all';
      const data = calcUtilization(2026, 6);
      return {
        events: data.monthEvents.length,
        schedules: data.monthScheduleCount,
        ignored: data.ignoredTimeScheduleCount,
        totalMinutes: data.results.reduce((sum, row) => sum + row.totalMinutes, 0),
      };
    });

    expect(result).toEqual({ events: 1, schedules: 1, ignored: 1, totalMinutes: 0 });
  });
});

test.describe('アーカイブの安全性', () => {
  test('イベントとアーカイブを同じGitコミットで公開する', async ({ page }) => {
    const requests = [];
    let blobIndex = 0;
    await page.route('https://api.github.com/repos/test-owner/test-repo/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const body = request.postDataJSON?.() || null;
      requests.push({ method: request.method(), pathname: url.pathname, body });

      if (request.method() === 'GET' && url.pathname.endsWith('/git/ref/heads/main')) {
        await route.fulfill({ json: { object: { sha: 'base-commit' } } });
      } else if (request.method() === 'GET' && url.pathname.endsWith('/git/commits/base-commit')) {
        await route.fulfill({ json: { tree: { sha: 'base-tree' } } });
      } else if (request.method() === 'POST' && url.pathname.endsWith('/git/blobs')) {
        blobIndex++;
        await route.fulfill({ json: { sha: `blob-${blobIndex}` } });
      } else if (request.method() === 'POST' && url.pathname.endsWith('/git/trees')) {
        await route.fulfill({ json: { sha: 'next-tree' } });
      } else if (request.method() === 'POST' && url.pathname.endsWith('/git/commits')) {
        await route.fulfill({ json: { sha: 'next-commit' } });
      } else if (request.method() === 'PATCH' && url.pathname.endsWith('/git/refs/heads/main')) {
        await route.fulfill({ json: { object: { sha: 'next-commit' } } });
      } else {
        await route.fulfill({ status: 404, json: { message: 'unexpected test request' } });
      }
    });
    await openAdmin(page);

    const state = await page.evaluate(async () => {
      config = { owner: 'test-owner', repo: 'test-repo', branch: 'main', token: 'test-token', filePath: 'events.json' };
      events = [{ id: 1, title: '公開イベント' }];
      archivedEvents = [{ id: 2, title: '公開アーカイブ', originalEventId: 1 }];
      isDirty = true;
      isArchivedDirty = true;
      pendingCount = 1;
      archivedPendingCount = 1;
      await pushEventsAndArchiveAtomically();
      return { isDirty, isArchivedDirty, currentSha, archivedSha };
    });

    const treeRequest = requests.find(request => request.method === 'POST' && request.pathname.endsWith('/git/trees'));
    expect(treeRequest.body.tree).toEqual([
      { path: 'events.json', mode: '100644', type: 'blob', sha: 'blob-1' },
      { path: 'archived_events.json', mode: '100644', type: 'blob', sha: 'blob-2' },
    ]);
    expect(requests.filter(request => request.method === 'PATCH')).toHaveLength(1);
    expect(state).toEqual({ isDirty: false, isArchivedDirty: false, currentSha: 'blob-1', archivedSha: 'blob-2' });
  });

  test('originalEventIdが同じでも内容が違えば新しいイベントを失わない', async ({ page }) => {
    await openAdmin(page);
    const result = await page.evaluate(() => {
      events = [{
        id: 171,
        title: '現在の別イベント',
        dates: [{ startDate: '2026-01-02', endDate: '2026-01-02', startTime: '09:00', endTime: '12:00' }],
        locations: ['室内練習場'],
        usageType: 'internal',
      }];
      archivedEvents = [{
        id: 69,
        originalEventId: 171,
        title: '過去のイベント',
        dates: [{ startDate: '2025-01-02', endDate: '2025-01-02', startTime: '09:00', endTime: '12:00' }],
        locations: ['室内練習場'],
        archivedAt: '2025-01-03T00:00:00.000Z',
      }];
      isDirty = false;
      isArchivedDirty = false;
      pendingChanges = [];
      pendingCount = 0;
      archivedPendingCount = 0;
      const moved = autoArchiveExpiredEvents();
      return {
        moved,
        activeCount: events.length,
        archivedCount: archivedEvents.length,
        titles: archivedEvents.map(event => event.title),
        hasSourceKey: Boolean(archivedEvents.find(event => event.title === '現在の別イベント')?.archiveSourceKey),
      };
    });

    expect(result).toEqual({
      moved: 1,
      activeCount: 0,
      archivedCount: 2,
      titles: ['過去のイベント', '現在の別イベント'],
      hasSourceKey: true,
    });
  });

  test('アーカイブ取得失敗時は既存データを保持して警告する', async ({ page }) => {
    await page.route('https://api.github.com/repos/test-owner/test-repo/contents/archived_events.json?ref=main', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'server error' }),
    }));
    await openAdmin(page);

    const result = await page.evaluate(async () => {
      config = { owner: 'test-owner', repo: 'test-repo', branch: 'main', token: 'test-token', filePath: 'events.json' };
      archivedEvents = [{ id: 1, title: '保持対象', dates: [] }];
      const loaded = await fetchArchivedFromGitHub();
      return { loaded, count: archivedEvents.length, title: archivedEvents[0].title, error: archivedLoadError };
    });

    expect(result.loaded).toBe(false);
    expect(result.count).toBe(1);
    expect(result.title).toBe('保持対象');
    expect(result.error).toContain('アーカイブの読み込みに失敗しました');
    await expect(page.locator('#dashboard-data-warning')).toContainText('アーカイブの読み込みに失敗しました');
  });
});

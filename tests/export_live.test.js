import { test, expect, openListPage } from './fixtures.js';

// Export including live: the file is what archive all followed by
// export would have produced, but nothing is archived -- the stored
// list and the live windows are untouched.

test('export including live puts live windows first and changes nothing', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    await saveGroups([
      { created: 0, tabs: [{ title: 'A', url: 'https://a.example/' }] },
    ]);

    // Live windows: the default window (about:blank), one with a data
    // tab plus a list page (the list page is skipped), and one holding
    // only a list page (recordable: nothing, so it contributes no
    // group).
    const listPageUrl = await getListPageUrl();
    const dataUrl = 'data:text/html,<title>L</title>live';
    await chrome.windows.create({ url: [dataUrl, listPageUrl] });
    await chrome.windows.create({ url: [listPageUrl] });
    for (let i = 0; i < 50; i++) {
      const tabs = await chrome.tabs.query({});
      if (tabs.every((t) => t.url && t.status === 'complete')) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const before = Date.now();
    let captured = null;
    const calls = [];
    const origBlob = createExportBlobUrl;
    const origDownload = chrome.downloads.download;
    const origWait = waitForDownloadCompletion;
    createExportBlobUrl = (text) => {
      captured = text;
      return Promise.resolve('blob:stub');
    };
    chrome.downloads.download = (opts) => {
      calls.push(opts);
      return Promise.resolve(1);
    };
    waitForDownloadCompletion = () => Promise.resolve('complete');
    let outcome;
    try {
      outcome = await exportIncludingLiveDownload();
    } finally {
      createExportBlobUrl = origBlob;
      chrome.downloads.download = origDownload;
      waitForDownloadCompletion = origWait;
    }
    const after = Date.now();

    const storedAfter = await getGroups();
    const windowsAfter = (await chrome.windows.getAll({ populate: true }))
      .filter((w) => w.type === 'normal')
      .map((w) => w.tabs.length);
    return {
      outcome, captured, call: calls[0], before, after,
      dataUrl, storedAfter, windowsAfter,
    };
  });

  // 2 live groups (about:blank and the data tab; the list-page-only
  // window contributes none) plus 1 stored group.
  expect(result.outcome).toEqual({ status: 'exported', groupCount: 3, liveCount: 2 });

  // Same download path and default filename as a plain export.
  expect(result.call.saveAs).toBe(true);
  expect(result.call.filename).toMatch(/^tab-groups-\d\d-\d\d-\d{4}\.txt$/);
  expect(result.call.url).toBe('blob:stub');

  // All three URLs are present, live groups first, the stored group
  // last.  (Presence is asserted separately: indexOf's -1 for a
  // missing URL would satisfy the ordering comparisons vacuously.)
  const storedAt = result.captured.indexOf('https://a.example/');
  const blankAt = result.captured.indexOf('about:blank');
  const dataAt = result.captured.indexOf(result.dataUrl);
  expect(blankAt).toBeGreaterThanOrEqual(0);
  expect(dataAt).toBeGreaterThanOrEqual(0);
  expect(storedAt).toBeGreaterThan(blankAt);
  expect(storedAt).toBeGreaterThan(dataAt);

  // The live groups carry the export time (formatCreated has second
  // resolution, so allow a second of slack on each side).
  const header = result.captured.split('\n')[0];
  const stamp = Date.parse(header.replace('Time created: ', ''));
  expect(stamp).toBeGreaterThanOrEqual(result.before - 1000);
  expect(stamp).toBeLessThanOrEqual(result.after + 1000);

  // Nothing was archived: the stored list still has exactly the one
  // group, and all three windows still hold all their tabs.
  expect(result.storedAfter).toHaveLength(1);
  expect(result.storedAfter[0].tabs[0].url).toBe('https://a.example/');
  expect(result.windowsAfter.sort()).toEqual([1, 1, 2].sort());
});

// A canceled Save As dialog surfaces as canceled, exactly as for a
// plain export.  (The Edge-style cancel and the interrupted-download
// error live in the shared download helper, which the plain-export
// tests already pin.)
test('a canceled export including live reports canceled', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    await saveGroups([
      { created: 0, tabs: [{ title: 'A', url: 'https://a.example/' }] },
    ]);
    const origDownload = chrome.downloads.download;
    chrome.downloads.download = () =>
      Promise.reject(new Error('Download canceled by the user'));
    let outcome;
    try {
      outcome = await exportIncludingLiveDownload();
    } finally {
      chrome.downloads.download = origDownload;
    }
    return { outcome, hasDoc: await chrome.offscreen.hasDocument() };
  });

  expect(result.outcome).toEqual({ status: 'canceled' });
  expect(result.hasDoc).toBe(false);
});

// End-to-end through the list page: the status line reports success
// with the live count, and a canceled Save As dialog.
test('Export including live reports success and cancel in the status line', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(() =>
    saveGroups([
      { created: 1, tabs: [{ title: 'A', url: 'https://a.example/' }] },
    ]),
  );
  const listPage = await openListPage(context, serviceWorker);

  // Success: stub the download machinery so no native dialog appears.
  // Live: the default window's about:blank (the list page is skipped),
  // so 1 live group plus the 1 stored group.
  await serviceWorker.evaluate(() => {
    chrome.downloads.download = () => Promise.resolve(1);
    waitForDownloadCompletion = () => Promise.resolve('complete');
  });
  await listPage.locator('#export-including-live-link').click();
  await expect(listPage.locator('.status')).toHaveText(
    'Exported 2 groups (including 1 live).');
  await expect(listPage.locator('.status')).not.toHaveClass(/error/);

  // The export changed nothing rendered: still one stored group.
  await expect(listPage.locator('.tab-group')).toHaveCount(1);

  // Cancel: the Save As rejection maps to a calm status message.
  await serviceWorker.evaluate(() => {
    chrome.downloads.download = () =>
      Promise.reject(new Error('Download canceled by the user'));
  });
  await listPage.locator('#export-including-live-link').click();
  await expect(listPage.locator('.status')).toHaveText('Export canceled.');
  await expect(listPage.locator('.status')).not.toHaveClass(/error/);
});

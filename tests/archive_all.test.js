import { test, expect, openListPage } from './fixtures.js';

// Waits until every tab everywhere has finished loading, so tab URLs
// and titles are stable before archiving.  Throws on timeout: a count
// mismatch from unsettled tabs would be much harder to diagnose.
async function settleAllWindows(serviceWorker) {
  const settled = await serviceWorker.evaluate(async () => {
    for (let i = 0; i < 50; i++) {
      const tabs = await chrome.tabs.query({});
      if (tabs.every((t) => t.status === 'complete')) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  });
  if (!settled) throw new Error('tabs never finished loading');
}

// Archive all, end to end: every normal window becomes its own group
// (skipping the extension's own pages), the other windows close, and
// the window the click came from survives holding only the list page.
test('Archive all archives every window and leaves only the list page', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(() => saveGroups([]));

  // Window 1 is the default context window (one about:blank tab); the
  // list page opens as a second tab in it.  Windows 2 and 3 hold data
  // tabs.
  const listPage = await openListPage(context, serviceWorker);
  const dataA = 'data:text/html,<title>A</title>aaa';
  const dataB = 'data:text/html,<title>B</title>bbb';
  const dataC = 'data:text/html,<title>C</title>ccc';
  await serviceWorker.evaluate(
    (urls) => chrome.windows.create({ url: urls }), [dataA, dataB]);
  await serviceWorker.evaluate(
    (urls) => chrome.windows.create({ url: urls }), [dataC]);
  await settleAllWindows(serviceWorker);

  // The confirm appears only after the preview's message round trip,
  // so the click alone is no barrier: wait for the dialog explicitly.
  let confirmText = null;
  const sawDialog = new Promise((resolve) => {
    listPage.on('dialog', (dialog) => {
      confirmText = dialog.message();
      dialog.accept();
      resolve();
    });
  });
  await listPage.locator('#archive-all-link').click();
  await sawDialog;

  // 3 windows, 4 recordable tabs (about:blank + A + B + C; the list
  // page itself is skipped), each window producing a group.
  expect(confirmText).toBe('Archive all 3 windows, saving 4 tabs in 3 groups?');

  await expect(listPage.locator('.tab-group')).toHaveCount(3);
  await expect(listPage.locator('.status')).toHaveText('Saved 3 groups containing 4 tabs.');

  // Storage: one group per window, tabs in order within each group.
  const stored = await serviceWorker.evaluate(() => getGroups());
  const urlLists = stored.map((g) => g.tabs.map((t) => t.url)).sort();
  expect(urlLists).toEqual([[dataA, dataB], [dataC], ['about:blank']].sort());

  // Only the list-page window remains, holding only the list page.
  const finalState = await serviceWorker.evaluate(async () => {
    const wins = await chrome.windows.getAll({ populate: true });
    return wins
      .filter((w) => w.type === 'normal')
      .map((w) => w.tabs.map((t) => t.url));
  });
  expect(finalState).toHaveLength(1);
  expect(finalState[0]).toHaveLength(1);
  expect(finalState[0][0]).toMatch(/tab_groups_list_page\.html$/);
});

// A dismissed confirmation changes nothing: no groups, no closed
// windows.
test('a canceled Archive all changes nothing', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(() => saveGroups([]));

  const listPage = await openListPage(context, serviceWorker);
  await serviceWorker.evaluate(
    (url) => chrome.windows.create({ url }), 'data:text/html,<title>A</title>aaa');
  await settleAllWindows(serviceWorker);

  // Dismiss the first confirm, accept the second (the barrier below).
  let firstDialog = true;
  const sawDialog = new Promise((resolve) => {
    listPage.on('dialog', (dialog) => {
      if (firstDialog) dialog.dismiss();
      else dialog.accept();
      firstDialog = false;
      resolve();
    });
  });
  await listPage.locator('#archive-all-link').click();
  await sawDialog;

  // The empty state never leaves and both windows survive.
  await expect(listPage.locator('.empty')).toBeVisible();
  await expect(listPage.locator('.status')).toHaveText('');

  // Barrier: a second, accepted Archive all must find both windows
  // still there.  Had the dismissed one landed anyway, it would have
  // archived them first and this one would report 0 groups.
  await listPage.locator('#archive-all-link').click();
  await expect(listPage.locator('.status')).toHaveText('Saved 2 groups containing 2 tabs.');
  await expect(listPage.locator('.tab-group')).toHaveCount(2);

  const windows = await serviceWorker.evaluate(async () =>
    (await chrome.windows.getAll()).filter((w) => w.type === 'normal').length);
  expect(windows).toBe(1);
});

// The preview counts every normal window, the recordable tabs (own
// pages excluded), and the groups that would be produced -- a window
// with nothing recordable adds to windowCount but not groupCount --
// without changing anything.
test('archiveAllPreview counts windows, recordable tabs, and groups', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    const listPageUrl = await getListPageUrl();
    // Second window: one data tab plus a list page (to be skipped).
    // Third window: only a list page, so it would produce no group.
    const win2 = await chrome.windows.create({
      url: ['data:text/html,<title>A</title>aaa', listPageUrl],
    });
    const win3 = await chrome.windows.create({ url: [listPageUrl] });
    for (let i = 0; i < 50; i++) {
      const tabs2 = await chrome.tabs.query({ windowId: win2.id });
      const tabs3 = await chrome.tabs.query({ windowId: win3.id });
      if (tabs2.length === 2 && tabs2.every((t) => t.url) &&
          tabs3.length === 1 && tabs3.every((t) => t.url)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const preview = await archiveAllPreview();
    const windowsAfter =
      (await chrome.windows.getAll()).filter((w) => w.type === 'normal').length;
    return { preview, windowsAfter };
  });

  // Recordable: the default window's about:blank plus the data tab.
  // The third window counts as a window but produces no group.
  expect(result.preview).toEqual({ windowCount: 3, tabCount: 2, groupCount: 2 });
  expect(result.windowsAfter).toBe(3);
});

// A window containing only the extension's own pages is closed without
// producing a group.  The confirmation announces it in the window
// count but not in the group count, and the completion message repeats
// the same group and tab counts, so the numbers agree.
test('Archive all closes an own-pages-only window without a group', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(() => saveGroups([]));

  const listPage = await openListPage(context, serviceWorker);
  await serviceWorker.evaluate(async () => {
    const listPageUrl = await getListPageUrl();
    await chrome.windows.create({ url: [listPageUrl] });
  });
  await settleAllWindows(serviceWorker);

  let confirmText = null;
  listPage.on('dialog', (dialog) => {
    confirmText = dialog.message();
    dialog.accept();
  });
  await listPage.locator('#archive-all-link').click();

  // Only the default window's about:blank was recordable: 2 windows
  // are announced, but just 1 group with 1 tab is saved -- the same
  // numbers the completion message shows.
  await expect(listPage.locator('.tab-group')).toHaveCount(1);
  await expect(listPage.locator('.status')).toHaveText('Saved 1 group containing 1 tab.');
  expect(confirmText).toBe('Archive all 2 windows, saving 1 tab in 1 group?');

  const wins = await serviceWorker.evaluate(async () =>
    (await chrome.windows.getAll()).filter((w) => w.type === 'normal').length);
  expect(wins).toBe(1);
});

import { test, expect } from './fixtures.js';

// Archiving records a window's tabs (in order), skips this extension's
// own pages, stores a group, and closes the window.  Here there is also
// the default context window, so the archived window is not the last
// one and no list page is opened.
test('archiving a window stores its tabs in order, skips own pages, closes it', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    const listPageUrl = await getListPageUrl();
    const dataA = 'data:text/html,<title>A</title>aaa';
    const dataB = 'data:text/html,<title>B</title>bbb';

    // Open a window whose middle tab is our own list page (to be skipped).
    const win = await chrome.windows.create({ url: [dataA, listPageUrl, dataB] });

    // Wait for the tabs to finish loading so titles are populated.
    async function settledTabs() {
      for (let i = 0; i < 50; i++) {
        const tabs = await chrome.tabs.query({ windowId: win.id });
        if (tabs.length && tabs.every((t) => t.status === 'complete')) return tabs;
        await new Promise((r) => setTimeout(r, 100));
      }
      return chrome.tabs.query({ windowId: win.id });
    }
    const tabs = await settledTabs();
    const expectedTabs = tabs
      .filter((t) => t.url !== listPageUrl)
      .map((t) => ({ title: t.title, url: t.url }));

    await saveGroups([]);
    await archiveWindow(win.id);

    let windowGone = false;
    try {
      await chrome.windows.get(win.id);
    } catch {
      windowGone = true;
    }

    return { groups: await getGroups(), windowGone, expectedTabs };
  });

  expect(result.windowGone).toBe(true);
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0].tabs).toEqual(result.expectedTabs);
  expect(typeof result.groups[0].created).toBe('number');
});

// Archiving the only browser window opens the list page in a new window
// first, so Chrome does not quit.
test('archiving the last window opens the list page in a new window', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(() => saveGroups([]));

  const [newPage] = await Promise.all([
    context.waitForEvent('page'),
    serviceWorker.evaluate(() => archiveWindow()),
  ]);
  await newPage.waitForLoadState('domcontentloaded');

  expect(newPage.url()).toMatch(/tab_groups_list_page\.html/);

  const groups = await serviceWorker.evaluate(() => getGroups());
  expect(groups).toHaveLength(1);
});

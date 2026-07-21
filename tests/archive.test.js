import { test, expect } from './fixtures.js';

// Archiving captures each tab's icon from Chrome's favicon cache,
// which serves a default icon even for pages it has never seen -- so
// tabs here would otherwise carry an unpredictable `icon`.  These
// tests are about which tabs get recorded, not about icons (that is
// favicon.test.js), so the two that compare tabs exactly fail just the
// cache read and expect iconless tabs.  They stub only _favicon reads:
// getListPageUrl fetches local-config.json, and failing that would
// quietly disable the skip-own-pages rule the first test checks.

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
    const origFetch = self.fetch;
    self.fetch = (input, init) =>
      String(input?.url ?? input).includes('/_favicon/')
        ? Promise.reject(new Error('no favicon cache in tests'))
        : origFetch.call(self, input, init);
    try {
      await archiveWindow(win.id);
    } finally {
      self.fetch = origFetch;
    }

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

// A tab whose navigation has not yet committed has an empty url and the
// real target in pendingUrl; archiving must record the pending URL, not
// a blank.  A tab with neither (rare) is skipped.  Chrome window state
// is stubbed because a reliably-pending navigation cannot be staged.
test('archiving records pendingUrl for tabs that have not committed', async ({
  serviceWorker,
}) => {
  const groups = await serviceWorker.evaluate(async () => {
    await saveGroups([]);
    const origGet = chrome.windows.get;
    const origGetAll = chrome.windows.getAll;
    const origRemove = chrome.windows.remove;
    const origFetch = self.fetch;
    chrome.windows.get = () =>
      Promise.resolve({
        id: 999,
        tabs: [
          { title: 'Committed', url: 'https://a.example/' },
          { title: '', url: '', pendingUrl: 'https://pending.example/' },
          { title: 'no url at all' },
        ],
      });
    chrome.windows.getAll = () =>
      Promise.resolve([{ type: 'normal' }, { type: 'normal' }]);
    chrome.windows.remove = () => Promise.resolve();
    self.fetch = (input, init) =>
      String(input?.url ?? input).includes('/_favicon/')
        ? Promise.reject(new Error('no favicon cache in tests'))
        : origFetch.call(self, input, init);
    try {
      await archiveWindow(999);
    } finally {
      chrome.windows.get = origGet;
      chrome.windows.getAll = origGetAll;
      chrome.windows.remove = origRemove;
      self.fetch = origFetch;
    }
    return getGroups();
  });

  expect(groups).toHaveLength(1);
  expect(groups[0].tabs).toEqual([
    { title: 'Committed', url: 'https://a.example/' },
    { title: '', url: 'https://pending.example/' },
  ]);
});

// A window containing only this extension's own pages has nothing to
// record, but is still closed (for consistency); no group is created.
test('archiving a window of only own pages closes it without a group', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    const listPageUrl = await getListPageUrl();
    await saveGroups([]);

    const win = await chrome.windows.create({ url: [listPageUrl, listPageUrl] });
    for (let i = 0; i < 50; i++) {
      const tabs = await chrome.tabs.query({ windowId: win.id });
      if (tabs.length === 2 && tabs.every((t) => t.url)) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    await archiveWindow(win.id);

    let windowGone = false;
    try {
      await chrome.windows.get(win.id);
    } catch {
      windowGone = true;
    }

    return { groups: await getGroups(), windowGone };
  });

  expect(result.windowGone).toBe(true);
  expect(result.groups).toHaveLength(0);
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

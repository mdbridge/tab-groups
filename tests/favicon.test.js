import { test, expect, openListPage } from './fixtures.js';

// Favicon capture and display.  Capture happens in the worker at
// archive time; the _favicon cache itself cannot be populated
// deterministically in a test, so its fetch is stubbed here and the
// real thing is treated as best-effort (see spec_v2.md, Testing).

// A tiny valid transparent GIF, usable as a real <img> src.
const GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

test('archiving ignores the page favIconUrl and uses the cache; no icon on failure', async ({
  serviceWorker,
}) => {
  const groups = await serviceWorker.evaluate(async (gif) => {
    await saveGroups([]);
    const origGet = chrome.windows.get;
    const origGetAll = chrome.windows.getAll;
    const origRemove = chrome.windows.remove;
    const origFetch = self.fetch;
    chrome.windows.get = () =>
      Promise.resolve({
        id: 999,
        tabs: [
          { title: 'With icon', url: 'https://a.example/', favIconUrl: gif },
          { title: 'No icon', url: 'https://b.example/' },
        ],
      });
    chrome.windows.getAll = () =>
      Promise.resolve([{ type: 'normal' }, { type: 'normal' }]);
    chrome.windows.remove = () => Promise.resolve();
    // Both tabs go to the _favicon cache -- the first one's page-
    // supplied data: URL is deliberately not used -- so failing that
    // read must leave both without any icon (best-effort capture).
    // Only _favicon reads are failed: getListPageUrl fetches
    // local-config.json, and failing that would quietly disable the
    // skip-own-pages rule.
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
  }, GIF);

  // The first tab offered a perfectly good data: favicon and still
  // gets none: page-supplied icons are never stored, so with the
  // cache unavailable both tabs come out iconless.
  expect(groups).toHaveLength(1);
  expect(groups[0].tabs).toEqual([
    { title: 'With icon', url: 'https://a.example/' },
    { title: 'No icon', url: 'https://b.example/' },
  ]);
  expect('icon' in groups[0].tabs[0]).toBe(false);
  expect('icon' in groups[0].tabs[1]).toBe(false);
});

// The cache is the only source, so a tab that supplies its own data:
// favicon still gets the cached one -- this is what makes the stored
// icon bounded in size and type no matter what the page declares.
test('a page-supplied data: favicon is overridden by the cached icon', async ({
  serviceWorker,
}) => {
  const icons = await serviceWorker.evaluate(async (gif) => {
    await saveGroups([]);
    const origGet = chrome.windows.get;
    const origGetAll = chrome.windows.getAll;
    const origRemove = chrome.windows.remove;
    const origFetch = self.fetch;
    chrome.windows.get = () =>
      Promise.resolve({
        id: 999,
        tabs: [{ title: 'Inline icon', url: 'https://e.example/', favIconUrl: gif }],
      });
    chrome.windows.getAll = () =>
      Promise.resolve([{ type: 'normal' }, { type: 'normal' }]);
    chrome.windows.remove = () => Promise.resolve();
    self.fetch = (input, init) => {
      if (!String(input?.url ?? input).includes('/_favicon/')) {
        return origFetch.call(self, input, init);
      }
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Type': 'image/png' },
        }),
      );
    };
    try {
      await archiveWindow(999);
    } finally {
      chrome.windows.get = origGet;
      chrome.windows.getAll = origGetAll;
      chrome.windows.remove = origRemove;
      self.fetch = origFetch;
    }
    return (await getGroups())[0].tabs.map((t) => t.icon);
  }, GIF);

  expect(icons).toEqual(['data:image/png;base64,AQID']);
});

test('a non-data favIconUrl is captured from the _favicon cache as a data: URL', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    await saveGroups([]);
    const origGet = chrome.windows.get;
    const origGetAll = chrome.windows.getAll;
    const origRemove = chrome.windows.remove;
    const origFetch = self.fetch;
    chrome.windows.get = () =>
      Promise.resolve({
        id: 999,
        tabs: [
          {
            title: 'Cached',
            url: 'https://c.example/page',
            favIconUrl: 'https://c.example/favicon.ico',
          },
        ],
      });
    chrome.windows.getAll = () =>
      Promise.resolve([{ type: 'normal' }, { type: 'normal' }]);
    chrome.windows.remove = () => Promise.resolve();
    // Stub the _favicon cache read with known bytes ([1, 2, 3] is
    // "AQID" in base64) so the URL requested and the data:-URL
    // conversion are both pinned.  Other fetches (getListPageUrl's
    // local-config.json) go through untouched, so fetchedUrl records
    // the favicon read rather than whatever happened to be last.
    let fetchedUrl = null;
    self.fetch = (input, init) => {
      const url = String(input?.url ?? input);
      if (!url.includes('/_favicon/')) return origFetch.call(self, input, init);
      fetchedUrl = url;
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Type': 'image/png' },
        }),
      );
    };
    try {
      await archiveWindow(999);
    } finally {
      chrome.windows.get = origGet;
      chrome.windows.getAll = origGetAll;
      chrome.windows.remove = origRemove;
      self.fetch = origFetch;
    }
    return { groups: await getGroups(), fetchedUrl };
  });

  expect(result.fetchedUrl).toContain('/_favicon/');
  expect(result.fetchedUrl).toContain(
    `pageUrl=${encodeURIComponent('https://c.example/page')}`);
  // Requested at 2x the 16px display size, for HiDPI sharpness.
  expect(result.fetchedUrl).toContain('size=32');
  // The whole tab, not just the icon: capturing an icon must not
  // disturb the title or URL stored beside it.
  expect(result.groups[0].tabs[0]).toEqual({
    title: 'Cached',
    url: 'https://c.example/page',
    icon: 'data:image/png;base64,AQID',
  });
});

// The safety invariant behind best-effort capture: an icon problem
// must never cost the user an archive.  A fetch that throws
// synchronously is the harshest version -- if it escaped captureIcons,
// archiveWindow would close the window without having stored a group,
// losing every tab in it.
test('a throwing favicon fetch still archives the window', async ({ serviceWorker }) => {
  const result = await serviceWorker.evaluate(async () => {
    await saveGroups([]);
    const origGet = chrome.windows.get;
    const origGetAll = chrome.windows.getAll;
    const origRemove = chrome.windows.remove;
    const origFetch = self.fetch;
    let removed = false;
    chrome.windows.get = () =>
      Promise.resolve({
        id: 999,
        tabs: [{ title: 'Doomed icon', url: 'https://d.example/' }],
      });
    chrome.windows.getAll = () =>
      Promise.resolve([{ type: 'normal' }, { type: 'normal' }]);
    chrome.windows.remove = () => {
      removed = true;
      return Promise.resolve();
    };
    self.fetch = (input, init) => {
      if (String(input?.url ?? input).includes('/_favicon/')) throw new Error('boom');
      return origFetch.call(self, input, init);
    };
    try {
      await archiveWindow(999);
    } finally {
      chrome.windows.get = origGet;
      chrome.windows.getAll = origGetAll;
      chrome.windows.remove = origRemove;
      self.fetch = origFetch;
    }
    return { groups: await getGroups(), removed };
  });

  expect(result.groups).toHaveLength(1);
  expect(result.groups[0].tabs).toEqual([{ title: 'Doomed icon', url: 'https://d.example/' }]);
  expect(result.removed).toBe(true);
});

test('the list page renders icons in wrappers, transparent when absent', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate((gif) =>
    saveGroups([
      {
        id: 'g-icons',
        created: 1,
        tabs: [
          { title: 'With icon', url: 'https://a.example/', icon: gif },
          { title: 'No icon', url: 'https://b.example/' },
        ],
      },
    ]), GIF);
  const listPage = await openListPage(context, serviceWorker);

  const tabs = listPage.locator('.tab');
  await expect(tabs).toHaveCount(2);

  // Tab with an icon: a 16px img inside the 24px wrapper, opaque
  // background so light icons stay visible.
  const withIcon = tabs.nth(0).locator('.tab-favicon-wrapper');
  await expect(withIcon.locator('img.tab-favicon')).toHaveAttribute('src', GIF);
  await expect(withIcon).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  // Tab without an icon: same wrapper (so titles align) but
  // transparent and empty.
  const noIcon = tabs.nth(1).locator('.tab-favicon-wrapper');
  await expect(noIcon.locator('img')).toHaveCount(0);
  await expect(noIcon).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('a broken icon turns its wrapper transparent', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(() =>
    saveGroups([
      {
        id: 'g-broken',
        created: 1,
        tabs: [
          {
            title: 'Broken icon',
            url: 'https://broken.example/',
            icon: 'data:image/png;base64,notanimage',
          },
        ],
      },
    ]));
  const listPage = await openListPage(context, serviceWorker);

  // The img fails to decode; its error handler blanks the wrapper so
  // no broken-image placeholder sits on a white square.
  const wrapper = listPage.locator('.tab-favicon-wrapper');
  await expect(wrapper).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('exports omit icons and imports produce tabs without them', async ({
  serviceWorker,
}) => {
  const t1 = new Date(2026, 6, 3, 16, 15, 23).getTime();
  const result = await serviceWorker.evaluate(({ t1, gif }) => {
    const text = serializeGroups([
      {
        created: t1,
        tabs: [{ title: 'GitHub', url: 'https://github.com/me/repo', icon: gif }],
      },
    ]);
    const { groups } = parseGroups(text);
    return { text, parsedTab: groups[0].tabs[0] };
  }, { t1, gif: GIF });

  expect(result.text).toBe(
    'Time created: 07/03/2026 16:15:23\n' +
    'https://github.com/me/repo\tGitHub\n');
  expect(result.text).not.toContain('base64');
  expect(result.parsedTab).toEqual({ title: 'GitHub', url: 'https://github.com/me/repo' });
  expect('icon' in result.parsedTab).toBe(false);
});

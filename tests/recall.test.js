import { test, expect, openListPage } from './fixtures.js';

// Plain data: URLs with no reserved characters, so tab.url is preserved
// verbatim and order can be asserted exactly.
const urlA = 'data:text/plain,alpha';
const urlB = 'data:text/plain,bravo';

test('recall opens a new window with the tabs in order and removes the group', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async ({ urlA, urlB }) => {
    await saveGroups([
      { id: 'g1', created: 123, tabs: [{ title: 'A', url: urlA }, { title: 'B', url: urlB }] },
    ]);

    const beforeIds = (await chrome.windows.getAll()).map((w) => w.id);
    await recallGroup('g1');
    const newWin = (await chrome.windows.getAll()).find((w) => !beforeIds.includes(w.id));

    async function settledUrls(windowId) {
      for (let i = 0; i < 50; i++) {
        const tabs = await chrome.tabs.query({ windowId });
        if (tabs.length === 2 && tabs.every((t) => t.url)) {
          return tabs.sort((a, b) => a.index - b.index).map((t) => t.url);
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return (await chrome.tabs.query({ windowId })).map((t) => t.url);
    }

    return {
      urls: await settledUrls(newWin.id),
      remaining: await getGroups(),
    };
  }, { urlA, urlB });

  expect(result.urls).toEqual([urlA, urlB]);
  expect(result.remaining).toHaveLength(0);
});

// A URL that Chrome refuses in an API navigation (javascript:) cannot
// seed or open a tab; recall should skip it, seed the window with the
// next URL, leave no stray tab, and still remove the group.
test('recall skips a URL that cannot open and seeds with the next', async ({
  serviceWorker,
}) => {
  const good = 'data:text/plain,good';
  const bad = 'javascript:void(0)';

  const result = await serviceWorker.evaluate(async ({ good, bad }) => {
    // Bad URL first, so recall must skip it while seeding the window.
    await saveGroups([
      { id: 'g2', created: 777, tabs: [{ title: 'bad', url: bad }, { title: 'good', url: good }] },
    ]);

    const beforeIds = (await chrome.windows.getAll()).map((w) => w.id);
    await recallGroup('g2');
    const newWins = (await chrome.windows.getAll()).filter((w) => !beforeIds.includes(w.id));

    async function settledUrls(windowId) {
      for (let i = 0; i < 50; i++) {
        const tabs = await chrome.tabs.query({ windowId });
        if (tabs.length >= 1 && tabs.every((t) => t.url)) {
          return tabs.sort((a, b) => a.index - b.index).map((t) => t.url);
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return (await chrome.tabs.query({ windowId })).map((t) => t.url);
    }

    return {
      newWindowCount: newWins.length,
      urls: newWins.length === 1 ? await settledUrls(newWins[0].id) : [],
      remaining: await getGroups(),
    };
  }, { good, bad });

  expect(result.newWindowCount).toBe(1);
  expect(result.urls).toEqual([good]);
  expect(result.remaining).toHaveLength(0);
});

// The window is seeded with the first tab, then the rest are added as
// background tabs.  This exercises that append path directly.
test('recall opens later tabs as background tabs in order', async ({ serviceWorker }) => {
  const good1 = 'data:text/plain,one';
  const good2 = 'data:text/plain,two';

  const result = await serviceWorker.evaluate(async ({ good1, good2 }) => {
    await saveGroups([
      {
        id: 'g4',
        created: 888,
        tabs: [{ title: '1', url: good1 }, { title: '2', url: good2 }],
      },
    ]);

    const beforeIds = (await chrome.windows.getAll()).map((w) => w.id);
    await recallGroup('g4');
    const newWin = (await chrome.windows.getAll()).find((w) => !beforeIds.includes(w.id));

    async function settledTabs(windowId) {
      for (let i = 0; i < 60; i++) {
        const tabs = await chrome.tabs.query({ windowId });
        if (tabs.length === 2 && tabs.every((t) => t.url)) {
          return tabs.sort((a, b) => a.index - b.index);
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
    }
    const tabs = await settledTabs(newWin.id);

    return {
      urls: tabs.map((t) => t.url),
      activeStates: tabs.map((t) => t.active),
      remaining: await getGroups(),
    };
  }, { good1, good2 });

  expect(result.urls).toEqual([good1, good2]);
  // First tab is active/foreground; the second was added in the background.
  expect(result.activeStates).toEqual([true, false]);
  expect(result.remaining).toHaveLength(0);
});

test('clicking Recall opens the tabs and removes the group from the list', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(
    (url) => saveGroups([{ created: 555, tabs: [{ title: 'A', url }] }]),
    urlA,
  );

  const listPage = await openListPage(context, serviceWorker);
  await listPage.waitForSelector('.tab-group');

  await listPage.locator('.recall').first().click();

  await expect(listPage.locator('.tab-group')).toHaveCount(0);
  await expect(listPage.locator('.empty')).toBeVisible();

  const groups = await serviceWorker.evaluate(() => getGroups());
  expect(groups).toHaveLength(0);
});

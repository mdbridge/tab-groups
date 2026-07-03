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
      { created: 123, tabs: [{ title: 'A', url: urlA }, { title: 'B', url: urlB }] },
    ]);

    const beforeIds = (await chrome.windows.getAll()).map((w) => w.id);
    await recallGroup(123);
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

// A URL that Chrome refuses in an API navigation (javascript:) makes the
// bulk windows.create throw; recall should fall back to opening tabs one
// at a time, skip the bad URL, leave no stray tab, and still remove the
// group.
test('recall falls back and skips a URL that aborts the bulk open', async ({
  serviceWorker,
}) => {
  const good = 'data:text/plain,good';
  const bad = 'javascript:void(0)';

  const result = await serviceWorker.evaluate(async ({ good, bad }) => {
    await saveGroups([
      { created: 777, tabs: [{ title: 'good', url: good }, { title: 'bad', url: bad }] },
    ]);

    const beforeIds = (await chrome.windows.getAll()).map((w) => w.id);
    await recallGroup(777);
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

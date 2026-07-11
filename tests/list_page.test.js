import { test, expect, openListPage } from './fixtures.js';

const groups = [
  {
    created: 2000,
    tabs: [
      { title: 'Alpha', url: 'https://alpha.example/' },
      { title: 'Beta', url: 'https://beta.example/' },
    ],
  },
  {
    created: 1000,
    tabs: [{ title: 'Gamma', url: 'https://gamma.example/' }],
  },
];

test('list page renders stored groups newest-first with their tabs', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate((g) => saveGroups(g), groups);

  const listPage = await openListPage(context, serviceWorker);
  await listPage.waitForSelector('.tab-group');

  const groupEls = listPage.locator('.tab-group');
  await expect(groupEls).toHaveCount(2);

  const first = groupEls.nth(0);
  await expect(first.locator('.tab-title')).toHaveText(['Alpha', 'Beta']);
  // The URL is not shown; it is available as a tooltip on the title.
  await expect(first.locator('.tab-title').nth(0)).toHaveAttribute(
    'title',
    'https://alpha.example/',
  );
  await expect(first.locator('.tab-title').nth(1)).toHaveAttribute(
    'title',
    'https://beta.example/',
  );
  await expect(first.locator('.group-count')).toContainText('2');
  await expect(first.locator('.group-time')).toHaveText(
    /^\d\d\/\d\d\/\d{4} \d{1,2}:\d\d:\d\d (AM|PM)$/,
  );

  const second = groupEls.nth(1);
  await expect(second.locator('.tab-title')).toHaveText(['Gamma']);
  await expect(second.locator('.group-count')).toContainText('1');

  // Escape closes the page.
  await Promise.all([
    listPage.waitForEvent('close'),
    listPage.keyboard.down('Escape'),
  ]);
});

// A list page left open must not go stale: when the stored list changes
// (e.g., a window is archived elsewhere), every open list page updates.
test('open list pages re-render when the stored list changes', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(() => saveGroups([]));

  const pageA = await openListPage(context, serviceWorker);
  const pageB = await openListPage(context, serviceWorker);
  await pageA.waitForSelector('.empty');
  await pageB.waitForSelector('.empty');

  await serviceWorker.evaluate(() =>
    prependGroup({ created: 1000, tabs: [{ title: 'New', url: 'https://new.example/' }] }),
  );

  for (const page of [pageA, pageB]) {
    await expect(page.locator('.tab-group')).toHaveCount(1);
    await expect(page.locator('.tab-title')).toHaveText(['New']);
    await expect(page.locator('.empty')).toHaveCount(0);
  }
});

test('list page shows an empty-state message when there are no groups', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(() => saveGroups([]));

  const listPage = await openListPage(context, serviceWorker);
  await listPage.waitForSelector('.empty');

  await expect(listPage.locator('.empty')).toBeVisible();
  await expect(listPage.locator('.tab-group')).toHaveCount(0);
});

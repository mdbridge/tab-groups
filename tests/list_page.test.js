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
  await expect(first.locator('.tab-url')).toHaveText([
    'https://alpha.example/',
    'https://beta.example/',
  ]);
  await expect(first.locator('.group-count')).toContainText('2');
  await expect(first.locator('.group-time')).toHaveText(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);

  const second = groupEls.nth(1);
  await expect(second.locator('.tab-title')).toHaveText(['Gamma']);
  await expect(second.locator('.group-count')).toContainText('1');

  // Escape closes the page.
  await Promise.all([
    listPage.waitForEvent('close'),
    listPage.keyboard.down('Escape'),
  ]);
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

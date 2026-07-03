import { test, expect, openListPage } from './fixtures.js';

test('open-list opens the list page and the content script runs on it', async ({
  context,
  serviceWorker,
}) => {
  const listPage = await openListPage(context, serviceWorker);

  await expect(listPage).toHaveTitle('Tab Groups');

  const root = listPage.locator('#__tab_groups_root__');
  await expect(root).toHaveAttribute('data-content-script', 'ready');
  await expect(root.locator('h1')).toHaveText('Tab Groups');
});

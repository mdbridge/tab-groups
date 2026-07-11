import { test, expect, openListPage } from './fixtures.js';
import { mkdtemp, rm, copyFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const listPageSource = fileURLToPath(
  new URL('../src/tab_groups_list_page.html', import.meta.url),
);

// The content script's match pattern is name-based, so a copy of the
// list page at some other path also gets the content script injected.
// The background validates the sender's URL, so such a page must get no
// group data (its DOM is readable by the page) and must not be able to
// change storage.
test('a copy of the list page elsewhere gets no data, only an error', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(() =>
    saveGroups([
      { created: 1000, tabs: [{ title: 'Secret', url: 'https://secret.example/' }] },
    ]),
  );

  const dir = await mkdtemp(join(tmpdir(), 'tab-groups-evil-'));
  try {
    const copyPath = join(dir, 'tab_groups_list_page.html');
    await copyFile(listPageSource, copyPath);

    const page = await context.newPage();
    await page.goto(pathToFileURL(copyPath).href);
    await page.waitForSelector('#__tab_groups_root__[data-content-script="ready"]');

    // The background refuses the sender, so the page shows an error and
    // no group data appears anywhere in its DOM.
    await expect(page.locator('.status.error')).toBeVisible();
    await expect(page.locator('.tab-group')).toHaveCount(0);
    const body = await page.textContent('body');
    expect(body).not.toContain('Secret');
    expect(body).not.toContain('secret.example');

    // The stored groups are untouched.
    const groups = await serviceWorker.evaluate(() => getGroups());
    expect(groups).toHaveLength(1);
    expect(groups[0].tabs[0].title).toBe('Secret');
  } finally {
    // Windows can briefly hold files open after close, so retry.
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

// The status line clears as soon as a new action starts, so a shown
// message always refers to the most recent action.  A slow second
// action leaves a window during which the cleared line is observable.
test('the status line clears when a new action starts', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(() =>
    saveGroups([
      { id: 'g1', created: 1000, tabs: [{ title: 'A', url: 'data:text/plain,a' }] },
    ]),
  );

  const listPage = await openListPage(context, serviceWorker);
  await listPage.waitForSelector('.tab-group');

  // First recall fails: an error appears.
  await serviceWorker.evaluate(() => {
    recallGroup = () => {
      throw new Error('recall boom');
    };
  });
  await listPage.locator('.recall').first().click();
  await expect(listPage.locator('.status.error')).toContainText('recall boom');

  // Second recall is slow: the error clears as soon as the action
  // starts, well before the response arrives.
  await serviceWorker.evaluate(() => {
    recallGroup = () => new Promise((resolve) => setTimeout(resolve, 2000));
  });
  await listPage.locator('.recall').first().click();
  await expect(listPage.locator('.status')).toHaveText('');
  await expect(listPage.locator('.status')).not.toHaveClass(/error/);
});

// A failure inside a background handler must reach the list page as a
// visible error, not hang the page on "Loading..." or fail silently.
test('a background failure is shown on the list page', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(() => {
    getGroups = () => {
      throw new Error('boom');
    };
  });

  const listPage = await openListPage(context, serviceWorker);

  await expect(listPage.locator('.status.error')).toContainText('boom');
  await expect(listPage.locator('.tab-group')).toHaveCount(0);
  await expect(listPage.locator('.empty')).toHaveCount(0);
});

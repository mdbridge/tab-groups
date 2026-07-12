import { test, expect, openListPage } from './fixtures.js';

const groups = [
  {
    id: 'g-newer',
    created: 2000,
    tabs: [
      { title: 'Alpha', url: 'https://alpha.example/' },
      { title: 'Beta', url: 'https://beta.example/' },
    ],
  },
  {
    id: 'g-older',
    created: 1000,
    tabs: [{ title: 'Gamma', url: 'https://gamma.example/' }],
  },
];

// Discard (confirm accepted) removes exactly that group -- from the
// page and from storage -- and reports in the status line.  The
// confirmation shows the group's time and tab count.
test('Discard removes the group after confirmation and reports status', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate((g) => saveGroups(g), groups);

  const listPage = await openListPage(context, serviceWorker);
  await listPage.waitForSelector('.tab-group');
  await expect(listPage.locator('.tab-group')).toHaveCount(2);

  const [timeNewer, timeOlder] = await serviceWorker.evaluate(() =>
    [formatDisplayTime(2000), formatDisplayTime(1000)]);

  let confirmText = null;
  listPage.on('dialog', (dialog) => {
    confirmText = dialog.message();
    dialog.accept();
  });
  await listPage.locator('.tab-group').first().locator('.discard').click();

  await expect(listPage.locator('.tab-group')).toHaveCount(1);
  await expect(listPage.locator('.tab-title')).toHaveText(['Gamma']);
  await expect(listPage.locator('.status')).toHaveText('Discarded 1 group (2 tabs).');
  expect(confirmText).toBe(`Discard the group from ${timeNewer} (2 tabs)?`);

  const stored = await serviceWorker.evaluate(() => getGroups());
  expect(stored.map((g) => g.id)).toEqual(['g-older']);

  // Singular wording, and discarding down to the empty state.
  await listPage.locator('.discard').click();
  await expect(listPage.locator('.tab-group')).toHaveCount(0);
  await expect(listPage.locator('.empty')).toBeVisible();
  await expect(listPage.locator('.status')).toHaveText('Discarded 1 group (1 tab).');
  expect(confirmText).toBe(`Discard the group from ${timeOlder} (1 tab)?`);

  expect(await serviceWorker.evaluate(() => getGroups())).toEqual([]);
});

// A dismissed confirmation changes nothing, anywhere.
test('a canceled Discard leaves the list unchanged', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate((g) => saveGroups(g), groups);

  const listPage = await openListPage(context, serviceWorker);
  await listPage.waitForSelector('.tab-group');

  // Dismiss the first confirm, accept the second (the barrier below).
  let firstDialog = true;
  listPage.on('dialog', (dialog) => {
    if (firstDialog) dialog.dismiss();
    else dialog.accept();
    firstDialog = false;
  });
  await listPage.locator('.tab-group').first().locator('.discard').click();

  // The page still shows both groups and no status message.
  await expect(listPage.locator('.tab-group')).toHaveCount(2);
  await expect(listPage.locator('.status')).toHaveText('');

  // Barrier: complete a discard of the OTHER group.  Its finished
  // round trip proves the dismissed discard never landed (it would
  // have finished first), rather than merely not having landed yet.
  await listPage.locator('.tab-group').nth(1).locator('.discard').click();
  await expect(listPage.locator('.tab-group')).toHaveCount(1);
  await expect(listPage.locator('.tab-title')).toHaveText(['Alpha', 'Beta']);

  const stored = await serviceWorker.evaluate(() => getGroups());
  expect(stored.map((g) => g.id)).toEqual(['g-newer']);
});

// Discarding a group that is already gone -- removed from another list
// page, or a double click -- must not claim a discard happened.  The
// confirm dialog blocks the page's event loop, so the removal is done
// while the dialog is up; accepting then sends a discard for an id
// that no longer exists.
test('discarding an already-removed group says so instead of claiming success', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate((g) => saveGroups(g), groups);

  const listPage = await openListPage(context, serviceWorker);
  await listPage.waitForSelector('.tab-group');

  listPage.on('dialog', async (dialog) => {
    await serviceWorker.evaluate(() => removeGroup('g-newer'));
    await dialog.accept();
  });
  await listPage.locator('.tab-group').first().locator('.discard').click();

  await expect(listPage.locator('.status')).toHaveText('That group was already removed.');
  await expect(listPage.locator('.status')).not.toHaveClass(/error/);
  await expect(listPage.locator('.tab-group')).toHaveCount(1);
  await expect(listPage.locator('.tab-title')).toHaveText(['Gamma']);

  const stored = await serviceWorker.evaluate(() => getGroups());
  expect(stored.map((g) => g.id)).toEqual(['g-older']);
});

// The discard message is refused for senders that are not the
// configured list page, like every other privileged message.
test('a discard message from a foreign sender is refused', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    await saveGroups([
      { id: 'g1', created: 1000, tabs: [{ title: 'A', url: 'https://a.example/' }] },
    ]);
    const response = await routeMessage(
      { action: 'discard', id: 'g1' },
      { url: 'file:///somewhere/else/tab_groups_list_page.html' },
    );
    return { response, groups: await getGroups() };
  });

  expect(result.response.ok).toBe(false);
  // Refused by the sender guard specifically, not as an unknown action.
  expect(result.response.error).toBe('sender is not the tab groups list page');
  expect(result.groups).toHaveLength(1);
});

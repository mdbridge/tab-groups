import { test as base, chromium } from '@playwright/test';
import { fileURLToPath } from 'url';

const extensionPath = fileURLToPath(new URL('..', import.meta.url));

const test = base.extend({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    let worker = context.serviceWorkers()[0];
    if (!worker) {
      worker = await context.waitForEvent('serviceworker');
    }
    await use(worker);
  },
});

async function openListPage(context, serviceWorker) {
  const [listPage] = await Promise.all([
    context.waitForEvent('page'),
    serviceWorker.evaluate(() => openList()),
  ]);
  await listPage.waitForLoadState('domcontentloaded');
  await listPage.waitForSelector('#__tab_groups_root__[data-content-script="ready"]');
  return listPage;
}

const expect = test.expect;

export { test, expect, openListPage };

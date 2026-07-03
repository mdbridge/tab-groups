import { test as base, chromium } from '@playwright/test';
import { fileURLToPath } from 'url';

const extensionPath = fileURLToPath(new URL('..', import.meta.url));

// Launch a browser with the extension loaded.  Pass a userDataDir to use
// a persistent profile (e.g., to test persistence across restarts); the
// default '' uses a fresh throwaway profile.
function launchContext(userDataDir = '') {
  return chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
}

async function getServiceWorker(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker');
  }
  return worker;
}

const test = base.extend({
  context: async ({}, use) => {
    const context = await launchContext();
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    await use(await getServiceWorker(context));
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

export { test, expect, launchContext, getServiceWorker, openListPage };

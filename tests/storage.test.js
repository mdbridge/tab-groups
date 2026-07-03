import { test, expect, launchContext, getServiceWorker } from './fixtures.js';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const sampleGroups = [
  { created: 2000, tabs: [{ title: 'Two', url: 'https://two.example/' }] },
  { created: 1000, tabs: [{ title: 'One', url: 'https://one.example/' }] },
];

test('storage helpers prepend newest-first and remove by created', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    await saveGroups([]);
    await prependGroup({ created: 1, tabs: [{ title: 'one', url: 'https://one/' }] });
    await prependGroup({ created: 2, tabs: [{ title: 'two', url: 'https://two/' }] });
    const afterPrepend = await getGroups();
    await removeGroup(1);
    const afterRemove = await getGroups();
    return { afterPrepend, afterRemove };
  });

  expect(result.afterPrepend.map((g) => g.created)).toEqual([2, 1]);
  expect(result.afterRemove.map((g) => g.created)).toEqual([2]);
});

test('groups persist across a browser restart', async () => {
  test.setTimeout(30000);
  const userDataDir = await mkdtemp(join(tmpdir(), 'tab-groups-test-'));
  let got;
  try {
    // First session: write the groups, then fully close the browser.
    let context = await launchContext(userDataDir);
    try {
      const worker = await getServiceWorker(context);
      await worker.evaluate((groups) => saveGroups(groups), sampleGroups);
    } finally {
      await context.close();
    }

    // Second session on the same profile: the groups are still there.
    context = await launchContext(userDataDir);
    try {
      const worker = await getServiceWorker(context);
      got = await worker.evaluate(() => getGroups());
    } finally {
      await context.close();
    }
  } finally {
    // Windows can briefly hold the profile lock after close, so retry.
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  expect(got).toEqual(sampleGroups);
});

import { test, expect } from './fixtures.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const extensionRoot = fileURLToPath(new URL('..', import.meta.url));

// The toolbar (action) button and the extension's icons are declared in
// the manifest, and every referenced icon file exists.  The same images
// serve as the action icon and the manifest icons.
test('manifest declares the action button and icons, and the files exist', async () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));

  const sizes = ['16', '32', '48', '128'];
  for (const table of [manifest.icons, manifest.action?.default_icon]) {
    expect(table).toBeTruthy();
    for (const size of sizes) {
      const file = table[size];
      expect(file).toBeTruthy();
      expect(fs.existsSync(path.join(extensionRoot, file))).toBe(true);
    }
  }

  // No popup: a click must reach the onClicked handler.
  expect(manifest.action?.default_popup).toBeUndefined();
});

// Clicking the action button archives the window it was clicked in,
// via the same code path as the archive-window command.  Playwright
// cannot click the real toolbar, so the test invokes the handler with
// the tab Chrome would have passed, and separately checks the handler
// is registered on chrome.action.onClicked.
test('clicking the action button archives that window', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    const dataA = 'data:text/html,<title>A</title>aaa';
    const win = await chrome.windows.create({ url: [dataA] });
    for (let i = 0; i < 50; i++) {
      const tabs = await chrome.tabs.query({ windowId: win.id });
      if (tabs.length === 1 && tabs[0].status === 'complete') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const [tab] = await chrome.tabs.query({ windowId: win.id });

    await saveGroups([]);
    await handleActionClick(tab);

    let windowGone = false;
    try {
      await chrome.windows.get(win.id);
    } catch {
      windowGone = true;
    }

    return {
      groups: await getGroups(),
      windowGone,
      // hasListener with the exact function: the direct call above
      // cannot detect a mis-wired addListener by itself.
      listenerRegistered: chrome.action.onClicked.hasListener(handleActionClick),
      url: dataA,
    };
  });

  expect(result.listenerRegistered).toBe(true);
  expect(result.windowGone).toBe(true);
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0].tabs.map((t) => t.url)).toEqual([result.url]);
});

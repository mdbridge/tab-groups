import { test, expect, openListPage } from './fixtures.js';

// Times are built from local Date components so the serialized local
// timestamps are deterministic regardless of the test machine's zone.
const t1 = new Date(2026, 6, 3, 16, 15, 23).getTime();
const t2 = new Date(2026, 6, 2, 9, 30, 0).getTime();

test('serialize produces the tab-group text format', async ({ serviceWorker }) => {
  const text = await serviceWorker.evaluate(
    ({ t1, t2 }) =>
      serializeGroups([
        {
          created: t1,
          tabs: [
            { title: 'GitHub', url: 'https://github.com/me/repo' },
            { title: '', url: 'https://example.com/' },
          ],
        },
        {
          created: t2,
          tabs: [{ title: 'Gmail', url: 'https://mail.google.com/' }],
        },
      ]),
    { t1, t2 },
  );

  const expected =
    'Time created: 07/03/2026 16:15:23\n' +
    'https://github.com/me/repo\tGitHub\n' +
    'https://example.com/\n' +
    '\n' +
    'Time created: 07/02/2026 09:30:00\n' +
    'https://mail.google.com/\tGmail\n';

  expect(text).toBe(expected);
});

test('serialize of an empty list is empty', async ({ serviceWorker }) => {
  const text = await serviceWorker.evaluate(() => serializeGroups([]));
  expect(text).toBe('');
});

test('export downloads the serialized list via a Save As dialog', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    await saveGroups([
      { created: 0, tabs: [{ title: 'A', url: 'https://a.example/' }] },
    ]);
    // Stub the blob-URL builder (so no real offscreen document is
    // created), the download (so no real file/dialog is triggered), and
    // the completion wait (there is no real download to complete);
    // capture the text routed to the blob and the download options.
    let captured = null;
    const origBlob = createExportBlobUrl;
    createExportBlobUrl = (text) => {
      captured = text;
      return Promise.resolve('blob:stub');
    };
    const calls = [];
    const origDownload = chrome.downloads.download;
    chrome.downloads.download = (opts) => {
      calls.push(opts);
      return Promise.resolve(1);
    };
    const origWait = waitForDownloadCompletion;
    waitForDownloadCompletion = () => Promise.resolve('complete');
    let outcome;
    try {
      outcome = await exportDownload();
    } finally {
      createExportBlobUrl = origBlob;
      chrome.downloads.download = origDownload;
      waitForDownloadCompletion = origWait;
    }
    return { call: calls[0], captured, outcome };
  });

  expect(result.call.saveAs).toBe(true);
  expect(result.call.filename).toMatch(/^tab-groups-\d\d-\d\d-\d{4}\.txt$/);
  expect(result.call.url).toBe('blob:stub');
  expect(result.captured).toContain('https://a.example/');
  expect(result.outcome).toEqual({ status: 'exported', groupCount: 1 });
});

test('offscreen document builds a blob: URL carrying the export text', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    const wanted = 'hello ' + String.fromCharCode(0x65e5, 0x672c, 0x8a9e) + ' world';
    const url = await createExportBlobUrl(wanted);
    const hadDoc = await chrome.offscreen.hasDocument();
    let readBack = null;
    try {
      readBack = await (await fetch(url)).text();
    } catch (e) {
      readBack = 'FETCH_FAILED: ' + e.message;
    }
    await closeOffscreenDocument();
    const closed = !(await chrome.offscreen.hasDocument());
    return { url, hadDoc, readBack, wanted, closed };
  });

  expect(result.url).toMatch(/^blob:/);
  expect(result.hadDoc).toBe(true);
  expect(result.closed).toBe(true);
  expect(result.readBack).toBe(result.wanted);
});

// A canceled Save As dialog surfaces as { status: 'canceled' }, and the
// offscreen document (created for real here) is closed afterwards.
test('a canceled Save As dialog reports canceled and frees the offscreen document', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    await saveGroups([
      { created: 0, tabs: [{ title: 'A', url: 'https://a.example/' }] },
    ]);
    const origDownload = chrome.downloads.download;
    chrome.downloads.download = () =>
      Promise.reject(new Error('Download canceled by the user'));
    let outcome;
    try {
      outcome = await exportDownload();
    } finally {
      chrome.downloads.download = origDownload;
    }
    return { outcome, hasDoc: await chrome.offscreen.hasDocument() };
  });

  expect(result.outcome).toEqual({ status: 'canceled' });
  expect(result.hasDoc).toBe(false);
});

// Edge reports a canceled Save As dialog differently from Chrome: the
// download() call succeeds and the download then ends interrupted with
// USER_CANCELED.  That must also surface as canceled, not as an error.
test('an Edge-style cancel (interrupted, USER_CANCELED) reports canceled', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    await saveGroups([
      { created: 0, tabs: [{ title: 'A', url: 'https://a.example/' }] },
    ]);
    const origDownload = chrome.downloads.download;
    const origWait = waitForDownloadCompletion;
    const origSearch = chrome.downloads.search;
    chrome.downloads.download = () => Promise.resolve(7);
    waitForDownloadCompletion = () => Promise.resolve('interrupted');
    chrome.downloads.search = () => Promise.resolve([{ id: 7, error: 'USER_CANCELED' }]);
    let outcome;
    try {
      outcome = await exportDownload();
    } finally {
      chrome.downloads.download = origDownload;
      waitForDownloadCompletion = origWait;
      chrome.downloads.search = origSearch;
    }
    return { outcome, hasDoc: await chrome.offscreen.hasDocument() };
  });

  expect(result.outcome).toEqual({ status: 'canceled' });
  expect(result.hasDoc).toBe(false);
});

// An interrupted download is an error (the file was not written), and
// the offscreen document is still cleaned up.
test('an interrupted download reports an error and frees the offscreen document', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    await saveGroups([
      { created: 0, tabs: [{ title: 'A', url: 'https://a.example/' }] },
    ]);
    const origDownload = chrome.downloads.download;
    const origWait = waitForDownloadCompletion;
    chrome.downloads.download = () => Promise.resolve(7);
    waitForDownloadCompletion = () => Promise.resolve('interrupted');
    let error = null;
    try {
      await exportDownload();
    } catch (e) {
      error = e.message;
    } finally {
      chrome.downloads.download = origDownload;
      waitForDownloadCompletion = origWait;
    }
    return { error, hasDoc: await chrome.offscreen.hasDocument() };
  });

  expect(result.error).toContain('interrupted');
  expect(result.hasDoc).toBe(false);
});

// End-to-end through the list page: the status line reports an export's
// success and a canceled Save As dialog.
test('Export reports success and cancel in the status line', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(() =>
    saveGroups([
      { created: 1, tabs: [{ title: 'A', url: 'https://a.example/' }] },
    ]),
  );
  const listPage = await openListPage(context, serviceWorker);

  // Success: stub the download machinery so no native dialog appears.
  await serviceWorker.evaluate(() => {
    chrome.downloads.download = () => Promise.resolve(1);
    waitForDownloadCompletion = () => Promise.resolve('complete');
  });
  await listPage.locator('#export-link').click();
  await expect(listPage.locator('.status')).toHaveText('Exported 1 group.');
  await expect(listPage.locator('.status')).not.toHaveClass(/error/);

  // Cancel: the Save As rejection maps to a calm status message.
  await serviceWorker.evaluate(() => {
    chrome.downloads.download = () =>
      Promise.reject(new Error('Download canceled by the user'));
  });
  await listPage.locator('#export-link').click();
  await expect(listPage.locator('.status')).toHaveText('Export canceled.');
  await expect(listPage.locator('.status')).not.toHaveClass(/error/);
});

test('export encodes non-ASCII titles as UTF-8 in the download', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    // "cafe(acute) Nihongo party-emoji" from code points (ASCII source).
    const title =
      'caf' + String.fromCharCode(0xe9) +
      ' ' + String.fromCharCode(0x65e5, 0x672c, 0x8a9e) +
      ' ' + String.fromCodePoint(0x1f389);
    await saveGroups([{ created: 0, tabs: [{ title, url: 'https://u.example/' }] }]);

    // Capture the text routed to the blob; the offscreen document turns it
    // into UTF-8 bytes when it constructs the Blob.
    let captured = null;
    const origBlob = createExportBlobUrl;
    createExportBlobUrl = (text) => {
      captured = text;
      return Promise.resolve('blob:stub');
    };
    const origDownload = chrome.downloads.download;
    chrome.downloads.download = () => Promise.resolve(1);
    const origWait = waitForDownloadCompletion;
    waitForDownloadCompletion = () => Promise.resolve('complete');
    try {
      await exportDownload();
    } finally {
      createExportBlobUrl = origBlob;
      chrome.downloads.download = origDownload;
      waitForDownloadCompletion = origWait;
    }
    return { captured, title };
  });

  expect(result.captured).toContain(result.title);
});

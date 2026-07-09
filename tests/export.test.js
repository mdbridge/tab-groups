import { test, expect } from './fixtures.js';

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
    // Stub the blob-URL builder (so no real offscreen document is created)
    // and the download (so no real file/dialog is triggered); capture the
    // text routed to the blob and the download options.
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
    try {
      await exportDownload();
    } finally {
      createExportBlobUrl = origBlob;
      chrome.downloads.download = origDownload;
    }
    return { call: calls[0], captured };
  });

  expect(result.call.saveAs).toBe(true);
  expect(result.call.filename).toMatch(/^tab-groups-\d\d-\d\d-\d{4}\.txt$/);
  expect(result.call.url).toBe('blob:stub');
  expect(result.captured).toContain('https://a.example/');
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
    try {
      await exportDownload();
    } finally {
      createExportBlobUrl = origBlob;
      chrome.downloads.download = origDownload;
    }
    return { captured, title };
  });

  expect(result.captured).toContain(result.title);
});

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
  const call = await serviceWorker.evaluate(async () => {
    await saveGroups([
      { created: 0, tabs: [{ title: 'A', url: 'https://a.example/' }] },
    ]);
    // Stub the download so no real file/dialog is triggered; capture args.
    const calls = [];
    const orig = chrome.downloads.download;
    chrome.downloads.download = (opts) => {
      calls.push(opts);
      return Promise.resolve(1);
    };
    try {
      await exportDownload();
    } finally {
      chrome.downloads.download = orig;
    }
    return calls[0];
  });

  expect(call.saveAs).toBe(true);
  expect(call.filename).toMatch(/^tab-groups-\d\d-\d\d-\d{4}\.txt$/);
  const decoded = decodeURIComponent(call.url.replace('data:text/plain;charset=utf-8,', ''));
  expect(decoded).toContain('https://a.example/');
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

    const calls = [];
    const orig = chrome.downloads.download;
    chrome.downloads.download = (opts) => {
      calls.push(opts);
      return Promise.resolve(1);
    };
    try {
      await exportDownload();
    } finally {
      chrome.downloads.download = orig;
    }
    return { url: calls[0].url, title };
  });

  const decoded = decodeURIComponent(result.url.replace('data:text/plain;charset=utf-8,', ''));
  expect(decoded).toContain(result.title);
});

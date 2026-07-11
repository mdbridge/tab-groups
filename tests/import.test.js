import { test, expect, openListPage } from './fixtures.js';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// created values are whole seconds so the second-granularity text format
// round-trips exactly.
const t1 = new Date(2026, 6, 3, 16, 15, 23).getTime();
const t2 = new Date(2026, 6, 2, 9, 30, 0).getTime();

test('parse round-trips serialize', async ({ serviceWorker }) => {
  const groups = [
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
  ];

  const parsed = await serviceWorker.evaluate(
    (g) => parseGroups(serializeGroups(g)),
    groups,
  );

  expect(parsed.groups).toEqual(groups);
  expect(parsed.warnings).toEqual([]);
});

test('parse round-trips serialize with non-ASCII titles', async ({ serviceWorker }) => {
  // "cafe(acute) Nihongo party-emoji" built from code points so the
  // source stays ASCII while exercising real UTF-8 at runtime.
  const title =
    'caf' + String.fromCharCode(0xe9) +
    ' ' + String.fromCharCode(0x65e5, 0x672c, 0x8a9e) +
    ' ' + String.fromCodePoint(0x1f389);
  const groups = [
    { created: t1, tabs: [{ title, url: 'https://example.com/unicode' }] },
  ];

  const parsed = await serviceWorker.evaluate(
    (g) => parseGroups(serializeGroups(g)),
    groups,
  );

  expect(parsed.groups).toEqual(groups);
});

test('import sorts groups newest-first regardless of file order', async ({
  serviceWorker,
}) => {
  const older = new Date(2026, 0, 1, 8, 0, 0).getTime();
  const newer = new Date(2026, 5, 1, 8, 0, 0).getTime();

  const created = await serviceWorker.evaluate(async ({ older, newer }) => {
    // A file that lists the older group first.
    const text = serializeGroups([
      { created: older, tabs: [{ title: 'Old', url: 'https://old.example/' }] },
      { created: newer, tabs: [{ title: 'New', url: 'https://new.example/' }] },
    ]);
    const { groups } = await importGroups(text);
    return groups.map((g) => g.created);
  }, { older, newer });

  expect(created).toEqual([newer, older]);
});

test('import puts undated groups on top (keeping file order) above dated ones', async ({
  serviceWorker,
}) => {
  // A dated (old) group, then two undated groups, in this file order.
  const text = [
    'Time created: 01/01/2026 08:00:00',
    'https://a.example/\tA dated old',
    '',
    'Time created: not a date',
    'https://b.example/\tB undated',
    '',
    'Time created: also not a date',
    'https://c.example/\tC undated',
    '',
  ].join('\n');

  const urls = await serviceWorker.evaluate(async (text) => {
    const { groups } = await importGroups(text);
    return groups.map((g) => g.tabs[0].url);
  }, text);

  // Undated (b, c) are treated as just-imported -> top, in file order;
  // the dated group (a) sorts below.
  expect(urls).toEqual(['https://b.example/', 'https://c.example/', 'https://a.example/']);
});

test('parse gives headerless tab lines an implicit group at import time', async ({
  serviceWorker,
}) => {
  const text = [
    'https://orphan-a.example/\tOrphan A',
    'https://orphan-b.example/\tOrphan B',
    '',
    'Time created: 07/03/2026 16:15:23',
    'https://c.example/\tC',
    '',
  ].join('\n');

  const result = await serviceWorker.evaluate((text) => parseGroups(text).groups, text);

  expect(result).toHaveLength(2);
  expect(result[0].tabs).toEqual([
    { title: 'Orphan A', url: 'https://orphan-a.example/' },
    { title: 'Orphan B', url: 'https://orphan-b.example/' },
  ]);
  expect(typeof result[0].created).toBe('number');
  expect(result[0].created).toBeGreaterThan(Date.now() - 60000);
  expect(result[1].tabs).toEqual([{ title: 'C', url: 'https://c.example/' }]);
});

test('parse is lenient about whitespace, bare URLs, and bad timestamps', async ({
  serviceWorker,
}) => {
  const sample = [
    '   Time created:   07/04/2026 12:00:00   ',
    'https://a.example/    Site A',
    '   https://b.example/',
    '',
    'Time created: not a date',
    'https://c.example/\tSite C',
    '',
  ].join('\n');

  const parsed = await serviceWorker.evaluate((text) => parseGroups(text).groups, sample);

  expect(parsed).toHaveLength(2);

  expect(parsed[0].created).toBe(new Date(2026, 6, 4, 12, 0, 0).getTime());
  expect(parsed[0].tabs).toEqual([
    { title: 'Site A', url: 'https://a.example/' },
    { title: '', url: 'https://b.example/' },
  ]);

  // Unparseable timestamp falls back to import time (a recent number).
  expect(typeof parsed[1].created).toBe('number');
  expect(parsed[1].created).toBeGreaterThan(Date.now() - 60000);
  expect(parsed[1].tabs).toEqual([{ title: 'Site C', url: 'https://c.example/' }]);
});

test('parse warns about dropped empty groups', async ({ serviceWorker }) => {
  // The first group has a header but no tabs; only the second survives.
  const text = [
    'Time created: 07/03/2026 16:15:23',
    '',
    'Time created: 07/02/2026 09:30:00',
    'https://a.example/\tA',
    '',
  ].join('\n');

  const parsed = await serviceWorker.evaluate((t) => parseGroups(t), text);

  expect(parsed.groups).toHaveLength(1);
  expect(parsed.groups[0].tabs).toEqual([{ title: 'A', url: 'https://a.example/' }]);
  expect(parsed.warnings).toHaveLength(1);
  expect(parsed.warnings[0]).toContain('1 group with no tabs (line 1)');
});

test('parse warns about lines that do not look like URLs but keeps them', async ({
  serviceWorker,
}) => {
  const text = [
    'Time created: 07/03/2026 16:15:23',
    'example.com\tBare hostname',
    'https://ok.example/\tFine',
    'just some words here',
    '',
  ].join('\n');

  const parsed = await serviceWorker.evaluate((t) => parseGroups(t), text);

  // Every line is imported (leniency), but the two schemeless ones draw
  // a warning.
  expect(parsed.groups).toHaveLength(1);
  expect(parsed.groups[0].tabs.map((t) => t.url)).toEqual([
    'example.com',
    'https://ok.example/',
    'just',
  ]);
  expect(parsed.warnings).toHaveLength(1);
  expect(parsed.warnings[0]).toContain('2 lines (first: line 2) do not look like a URL');
});

test('importing an empty file clears the list without warnings', async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    await saveGroups([
      { created: 1, tabs: [{ title: 'Old', url: 'https://old.example/' }] },
    ]);
    const imported = await importGroups('');
    return { imported, stored: await getGroups() };
  });

  expect(result.imported.groups).toEqual([]);
  expect(result.imported.warnings).toEqual([]);
  expect(result.stored).toEqual([]);
});

// End-to-end import through the list page: the file picker, the confirm
// dialog (with real counts), the replacement, and the status line.
test('Import via the file picker confirms with counts and reports status', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(() =>
    saveGroups([
      { created: 1, tabs: [{ title: 'Old', url: 'https://old.example/' }] },
    ]),
  );

  const listPage = await openListPage(context, serviceWorker);
  await listPage.waitForSelector('.tab-group');

  const dir = await mkdtemp(join(tmpdir(), 'tab-groups-import-'));
  try {
    const filePath = join(dir, 'import.txt');
    await writeFile(
      filePath,
      'Time created: 07/03/2026 16:15:23\n' +
        'https://a.example/\tA\n' +
        'https://b.example/\tB\n',
    );

    let confirmText = null;
    listPage.on('dialog', (dialog) => {
      confirmText = dialog.message();
      dialog.accept();
    });

    const [chooser] = await Promise.all([
      listPage.waitForEvent('filechooser'),
      listPage.locator('#import-link').click(),
    ]);
    await chooser.setFiles(filePath);

    await expect(listPage.locator('.tab-group')).toHaveCount(1);
    await expect(listPage.locator('.tab-title')).toHaveText(['A', 'B']);
    await expect(listPage.locator('.status')).toHaveText('Imported 1 group (2 tabs).');
    expect(confirmText).toBe(
      'Replace the current 1 tab group with the imported 1 group (2 tabs)?',
    );

    const stored = await serviceWorker.evaluate(() => getGroups());
    expect(stored).toHaveLength(1);
    expect(stored[0].tabs.map((t) => t.url)).toEqual([
      'https://a.example/',
      'https://b.example/',
    ]);
  } finally {
    // Windows can briefly hold files open after close, so retry.
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

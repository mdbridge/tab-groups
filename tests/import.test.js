import { test, expect } from './fixtures.js';

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

  expect(parsed).toEqual(groups);
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

  const parsed = await serviceWorker.evaluate((text) => parseGroups(text), sample);

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

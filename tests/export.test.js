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

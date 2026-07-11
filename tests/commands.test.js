import { test, expect } from './fixtures.js';

// A keyboard command can race the world changing under it -- e.g., the
// active window closing between the keypress and the handler running.
// The handler must not leave an unhandled rejection (there is no UI
// surface to show one; it is logged instead).
test('a command whose window is already gone does not reject', async ({
  serviceWorker,
}) => {
  const outcome = await serviceWorker.evaluate(async () => {
    try {
      await handleCommand('archive-window', { windowId: 987654321 });
      return 'resolved';
    } catch (e) {
      return `rejected: ${e.message}`;
    }
  });

  expect(outcome).toBe('resolved');
});

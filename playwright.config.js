import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Test files run in parallel workers, each a headed Chrome; under
  // that load a multi-window test can take several times its solo
  // duration, so the cap needs generous headroom.
  timeout: 30000,
  use: {
    headless: false,
  },
});

import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173/G3M-MCE/',
    headless: true,
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/G3M-MCE/',
    reuseExistingServer: !process.env.CI,
  },
});

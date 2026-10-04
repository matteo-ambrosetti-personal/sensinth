import { defineConfig, devices } from '@playwright/test';

const port = 4319;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort`,
    url: `http://localhost:${port}/render-test.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

import { defineConfig, devices } from '@playwright/test';

const port = 4319;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Chromium's built-in fake camera and microphone, with no permission prompt UI.
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
    // Safari's engine, for the Mac. CI installs WebKit and sets E2E_WEBKIT=1.
    ...(process.env.E2E_WEBKIT
      ? [
          {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
            testMatch: /(render|lab|flow)\.spec\.ts/,
          },
        ]
      : []),
  ],
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort`,
    url: `http://localhost:${port}/render-test.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

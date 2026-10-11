import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// The cloud dev container ships Chromium at a fixed path; locally Playwright downloads its own.
const preinstalled = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p))

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    ...devices['Pixel 7'],
    ...(preinstalled ? { launchOptions: { executablePath: preinstalled } } : {}),
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})

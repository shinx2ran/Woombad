import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// The cloud dev container ships Chromium at a fixed path; locally Playwright downloads its own.
const preinstalled = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p))

/** specs that also run with page and dialog motion on (SPEC 7.9): the transitions, and the flows richest in sheets and navigation */
const MOTION_SPECS = /(transitions|quick-buttons|redate|rencana|keluar|kendaraan|undo-delete)\.spec\.ts/

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
  projects: [
    // the whole suite with "reduce motion": pages and dialogs change at once, so steps and screenshots are exact
    { name: 'phone', testIgnore: /transitions\.spec\.ts/, use: { reducedMotion: 'reduce' } },
    // the same phone as people use it: slides, sheets rising and sliding away
    { name: 'phone-motion', testMatch: MOTION_SPECS, use: { reducedMotion: 'no-preference' } },
    // the live site's address (GitHub Pages serves the app under /Woombad/): the transitions there
    { name: 'pages-motion', testMatch: /transitions\.spec\.ts/, use: { reducedMotion: 'no-preference', baseURL: 'http://localhost:4174/Woombad/' } },
  ],
  webServer: [
    {
      command: 'npm run preview -- --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // a Mode Demo build under the GitHub Pages base path, next to the normal one
      command: 'VITE_BASE_PATH=/Woombad/ VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-sub --logLevel warn && npx vite preview --outDir dist-sub --base /Woombad/ --port 4174 --strictPort',
      url: 'http://localhost:4174/Woombad/',
      reuseExistingServer: true,
      timeout: 240_000,
    },
  ],
})

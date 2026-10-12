import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { AppErrorBoundary, DeviceDataGate } from './components/ErrorBoundary'
import { isSupabaseConfigured } from './lib/supabase'
import { requestPersistentStorage } from './features/settings/data/backupReminder'
import { appUpdater, watchForUpdates } from './app/appUpdate'
import { UpdateBanner } from './app/UpdateBanner'

// Service worker: a new version reloads the page at once, or waits for "Muat ulang" while a reload would lose work.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () => appUpdater.needRefresh(() => updateSW()),
  onNeedReload: () => appUpdater.needReload(),
  onRegisteredSW: (_url, registration) => {
    if (registration) watchForUpdates(registration)
  },
})

// Mode Demo keeps everything in this browser: ask it not to evict the data when storage runs low.
if (!isSupabaseConfigured) void requestPersistentStorage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <DeviceDataGate>
        <App />
      </DeviceDataGate>
    </AppErrorBoundary>
    <UpdateBanner />
  </StrictMode>,
)

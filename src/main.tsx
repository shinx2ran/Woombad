import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { AppErrorBoundary, DeviceDataGate } from './components/ErrorBoundary'
import { isSupabaseConfigured } from './lib/supabase'
import { requestPersistentStorage } from './features/settings/data/backupReminder'

// Service worker: auto-update in the background so both phones always run the latest version.
registerSW({ immediate: true })

// Mode Demo keeps everything in this browser: ask it not to evict the data when storage runs low.
if (!isSupabaseConfigured) void requestPersistentStorage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <DeviceDataGate>
        <App />
      </DeviceDataGate>
    </AppErrorBoundary>
  </StrictMode>,
)

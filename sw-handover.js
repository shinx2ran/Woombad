const MARKER = 'woombad-sw-prompt'
self.addEventListener('install', (event) => {
  event.waitUntil(caches.has(MARKER).then((prompt) => (prompt ? undefined : self.skipWaiting())))
})
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.open(MARKER))
})

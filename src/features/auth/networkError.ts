/** Same wording as translateDbError in SupabaseRepo. */
export const NETWORK_ERROR_MESSAGE = 'Tidak dapat terhubung ke server. Periksa koneksi internet.'

// Chrome "Failed to fetch", Firefox "NetworkError…", Safari/iOS "Load failed" (postgrest-js prefixes "TypeError: "),
// or a message SupabaseRepo already translated.
const NETWORK_RE = /Failed to fetch|Load failed|NetworkError|Tidak dapat terhubung ke server/i

/** True when the request most likely never got an answer from the server. */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return err instanceof Error && NETWORK_RE.test(err.message)
}

/** Text to show for a failed repo/auth call: a network failure in any browser's wording becomes one Indonesian message. */
export function errorMessage(err: unknown, fallback: string): string {
  if (isNetworkError(err)) return NETWORK_ERROR_MESSAGE
  return err instanceof Error && err.message ? err.message : fallback
}

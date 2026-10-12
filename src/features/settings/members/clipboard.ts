/** copied = on the clipboard; selected = highlighted in the field for the user to copy by hand. */
export type CopyResult = 'copied' | 'selected' | 'failed'

/**
 * Copy text. navigator.clipboard is missing on plain http and refused by some older iPhones, so the
 * fallback selects the (readonly) field showing the same text and tries the legacy copy command.
 */
export async function copyText(text: string, field?: HTMLInputElement | null): Promise<CopyResult> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return 'copied'
    } catch {
      /* fall back to selecting the field */
    }
  }
  if (!field) return 'failed'
  field.focus()
  field.select()
  // iOS Safari ignores select() on readonly inputs
  field.setSelectionRange(0, field.value.length)
  try {
    if (typeof document.execCommand === 'function' && document.execCommand('copy')) return 'copied'
  } catch {
    /* not supported */
  }
  return 'selected'
}

export const COPY_SELECTED_HINT = 'Teks sudah ditandai. Tekan lama lalu pilih Salin.'
export const COPY_FAILED_HINT = 'Tidak dapat menyalin otomatis. Tekan lama teksnya lalu pilih Salin.'

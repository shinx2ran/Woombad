import { useRef, useState } from 'react'
import { Copy, MessageCircle, Share2 } from 'lucide-react'
import { Button, Modal, Textarea, useToast } from '../../components/ui'
import { COPY_SELECTED_HINT, copyText } from '../settings/members/clipboard'
import { whatsappShareLink } from './boardSummary'

const canShareText = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function'

/**
 * Ringkasan WhatsApp (SPEC 7.18): the board's news as a message, editable before it goes out. "Buka WhatsApp" opens
 * WhatsApp (or WhatsApp Business) with the text, and the owner picks his wife or the staff group there; "Bagikan…" is
 * the phone's own share sheet (useful when both WhatsApp apps are installed); "Salin" for anywhere else.
 */
export function BoardSummarySheet({ text: initial, onClose }: { text: string; onClose: () => void }) {
  const [text, setText] = useState(initial)
  const field = useRef<HTMLTextAreaElement>(null)
  const toast = useToast()
  const empty = text.trim() === ''

  const share = async () => {
    try {
      await navigator.share({ text })
    } catch {
      /* the owner closed the share sheet */
    }
  }
  const copy = async () => {
    const result = await copyText(text, field.current)
    if (result === 'copied') toast.success('Ringkasan disalin.')
    else toast.toast(COPY_SELECTED_HINT)
  }

  return (
    <Modal open onClose={onClose} title="Kirim ringkasan ke WhatsApp" size="sm">
      <div className="space-y-3" data-testid="board-summary">
        <Textarea
          ref={field}
          label="Pesan"
          rows={12}
          value={text}
          onChange={(e) => setText(e.target.value)}
          hint={`Bisa diubah dulu. Di WhatsApp pilih istri atau grup kos, lalu kirim.${canShareText() ? ' Yang terbuka WhatsApp biasa, bukan Business? Pakai Bagikan… lalu pilih WhatsApp Business.' : ''}`}
          className="text-sm leading-snug"
          data-testid="board-summary-text"
        />
        <a
          // an <a> without href has no role, so the disabled state would not be announced
          role="link"
          href={empty ? undefined : whatsappShareLink(text)}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={empty}
          data-testid="board-summary-whatsapp"
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700 aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          <MessageCircle className="h-5 w-5" aria-hidden /> Buka WhatsApp
        </a>
        <div className="grid grid-cols-2 gap-2">
          {canShareText() && (
            <Button variant="outline" icon={<Share2 className="h-4 w-4" />} onClick={() => void share()} disabled={empty}>
              Bagikan…
            </Button>
          )}
          <Button variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => void copy()} disabled={empty} className={canShareText() ? undefined : 'col-span-2'}>
            Salin
          </Button>
        </div>
      </div>
    </Modal>
  )
}

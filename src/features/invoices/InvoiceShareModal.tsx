import { useEffect, useMemo, useState } from 'react'
import { Download, MessageCircle, Share2 } from 'lucide-react'
import { Button, LoadingState, Modal, useToast } from '../../components/ui'
import type { Invoice, Lease, LeaseAddon, Payment, Property, Room, Tenant } from '../../types/db'
import { buildInvoiceDocument, invoiceFileName, invoiceShareText } from '../../domain/invoiceDocument'
import { whatsappLink } from '../../lib/format'
import { renderInvoiceImage } from './renderInvoiceImage'
import { useKosLogo } from './useKosLogo'

export interface InvoiceShareModalProps {
  open: boolean
  onClose: () => void
  invoice: Invoice
  lease: Lease
  tenant?: Tenant
  room?: Room
  property?: Property
  /** all payments (superset is fine) */
  payments: Payment[]
  /** add-ons of the lease (names the add-on lines) */
  leaseAddons: LeaseAddon[]
}

interface Rendered {
  blob: Blob
  url: string
  file: File
}

/** Web Share with files: Android Chrome / installed PWA and iOS Safari; desktop browsers mostly not. */
function canShareFile(file: File): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

/**
 * "Kirim tagihan": renders the invoice as a PNG (SPEC 7.2), previews it and hands it to the OS share sheet
 * so the owner picks WhatsApp and the tenant. wa.me links carry text only, so the fallbacks are a download
 * of the image and the text-only WhatsApp message (invoiceShareText).
 */
export function InvoiceShareModal({ open, onClose, invoice, lease, tenant, room, property, payments, leaseAddons }: InvoiceShareModalProps) {
  const toast = useToast()
  const { logo, loading: logoLoading } = useKosLogo(open ? property : null)
  const doc = useMemo(
    () => buildInvoiceDocument({ invoice, lease, tenant, room, property, payments, leaseAddons }),
    [invoice, lease, tenant, room, property, payments, leaseAddons],
  )
  const [rendered, setRendered] = useState<Rendered | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  // Invoice notes may be internal ('Sisa dianggap hangus (…)' is written by the app itself), so the image leaves
  // them out unless the owner asks for them, each time the modal opens.
  const [withNotes, setWithNotes] = useState(false)
  useEffect(() => {
    if (open) setWithNotes(false)
  }, [open])
  const shownDoc = useMemo(() => (withNotes ? doc : { ...doc, notes: null }), [doc, withNotes])

  // Render once the logo is known (cached after the first open); re-render when the data changes while open.
  useEffect(() => {
    if (!open || logoLoading) return
    let cancelled = false
    let url: string | null = null
    renderInvoiceImage(shownDoc, logo)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setRendered({ blob, url, file: new File([blob], invoiceFileName(doc), { type: 'image/png' }) })
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Gagal membuat gambar tagihan.')
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
      setRendered(null)
    }
  }, [open, logoLoading, logo, shownDoc])

  const shareText = useMemo(() => invoiceShareText(doc), [doc])
  const waLink = whatsappLink(tenant?.phone, shareText)
  const shareSupported = rendered ? canShareFile(rendered.file) : null

  const share = async () => {
    if (!rendered) return
    setSharing(true)
    try {
      await navigator.share({ files: [rendered.file], title: `Tagihan ${doc.number}`, text: shareText })
    } catch (err) {
      // AbortError = the owner closed the share sheet
      if (!(err instanceof Error && err.name === 'AbortError')) {
        toast.error(`Gagal membagikan gambar: ${err instanceof Error ? err.message : 'kesalahan tak dikenal'}`)
      }
    } finally {
      setSharing(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Kirim tagihan ${invoice.invoice_number}`}
      size="md"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Tutup
        </Button>
      }
    >
      <div className="space-y-4">
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        ) : rendered ? (
          <img src={rendered.url} alt="Pratinjau tagihan" className="w-full rounded-lg border border-slate-200" />
        ) : (
          <LoadingState label="Menyiapkan gambar…" />
        )}
        {doc.notes && (
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={withNotes} onChange={(e) => setWithNotes(e.target.checked)} />
            <span>
              Sertakan catatan tagihan di gambar
              <span className="block truncate text-xs text-slate-500">{doc.notes}</span>
            </span>
          </label>
        )}
        {rendered && shareSupported && (
          <p className="text-xs text-slate-500">
            Di lembar bagikan, pilih <strong>WhatsApp</strong> lalu pilih {doc.tenant.name}.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {shareSupported === false ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Browser ini tidak bisa membagikan gambar; unduh gambarnya lalu lampirkan di WhatsApp.</p>
          ) : (
            <Button icon={<Share2 className="h-4 w-4" />} onClick={share} loading={sharing} disabled={!rendered} fullWidth>
              Bagikan ke WhatsApp
            </Button>
          )}
          {rendered ? (
            <a
              href={rendered.url}
              download={rendered.file.name}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" /> Unduh gambar
            </a>
          ) : (
            <Button variant="outline" disabled fullWidth icon={<Download className="h-4 w-4" />}>
              Unduh gambar
            </Button>
          )}
          {waLink ? (
            <a
              href={waLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <MessageCircle className="h-4 w-4" /> Kirim teks saja via WhatsApp
            </a>
          ) : (
            <p className="text-xs text-slate-500">Nomor HP penyewa belum diisi, pesan teks tidak bisa dikirim via WhatsApp.</p>
          )}
        </div>
      </div>
    </Modal>
  )
}

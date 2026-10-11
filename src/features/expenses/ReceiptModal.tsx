import { useQuery } from '@tanstack/react-query'
import { ImageOff } from 'lucide-react'
import { Button, LoadingState, Modal } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'

/** Shows the receipt photo of an expense (signed URL in Supabase mode; demo mode has no storage). */
export function ReceiptModal({ path, onClose }: { path: string | null; onClose: () => void }) {
  const { repo, org, isLocalMode } = useOrg()
  const urlQuery = useQuery({
    queryKey: ['org', org.id, 'receipt-url', path],
    queryFn: () => repo.getFileUrl('receipts', path),
    enabled: path !== null,
    // signed URLs are short-lived: refetch when the modal is reopened later
    staleTime: 60_000,
  })
  const url = urlQuery.data ?? null

  return (
    <Modal
      open={path !== null}
      onClose={onClose}
      title="Foto struk"
      size="sm"
      footer={
        <>
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-brand-700 hover:bg-brand-50">
              Buka ukuran penuh
            </a>
          )}
          <Button variant="outline" onClick={onClose}>
            Tutup
          </Button>
        </>
      }
    >
      {urlQuery.isPending ? (
        <LoadingState label="Memuat foto…" />
      ) : urlQuery.isError ? (
        <p className="text-sm text-red-700">{urlQuery.error instanceof Error ? urlQuery.error.message : 'Gagal memuat foto struk.'}</p>
      ) : url ? (
        <img src={url} alt="Foto struk" className="mx-auto max-h-[60vh] w-auto rounded-lg border border-slate-200 object-contain" />
      ) : (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-slate-500">
          <ImageOff className="h-8 w-8 text-slate-300" />
          {isLocalMode ? 'Mode Demo tidak menyimpan foto struk. Hubungkan Supabase untuk mengunggah struk.' : 'Foto struk tidak ditemukan.'}
        </div>
      )}
    </Modal>
  )
}

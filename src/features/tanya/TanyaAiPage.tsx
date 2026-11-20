import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { RotateCcw, SendHorizontal, ShieldOff, Sparkles } from 'lucide-react'
import { Button, Card, CardBody, EmptyState, ErrorState, LoadingState, PageHeader, Textarea } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useTable } from '../../hooks/useTable'
import { formatUsd, todayISO } from '../../lib/format'
import { MAX_MESSAGES, MAX_MESSAGE_CHARS, type ChatMessage } from '../../../supabase/functions/tanya-ai/chat.ts'
import { buildAiSnapshot } from './snapshot'
import { AskAiError, DEMO_ANSWER_COST_USD, SUGGESTED_QUESTIONS, askAi, demoAnswer } from './tanyaAi'

interface Turn extends ChatMessage {
  /** what the answer cost (owner/admin see it; null when the function did not say) */
  costUsd?: number | null
  truncated?: boolean
}

/**
 * Tanya AI (SPEC 7.29): the owner or an admin asks Claude about the kos data in plain words. The conversation lives in
 * this page only (it is gone on reload); the data summary is made once per conversation, so follow-up questions read
 * the same figures and the summary is billed at the cached rate.
 */
export function TanyaAiPage() {
  const { selectedPropertyId } = useOrg()
  // another kos chosen in the header: the conversation was about the other one's figures, so it starts over
  return <TanyaAiConversation key={selectedPropertyId} />
}

function TanyaAiConversation() {
  const { org, role, properties, financePropertyIds, selectedPropertyId, isLocalMode } = useOrg()
  const rooms = useTable('rooms')
  const tenants = useTable('tenants')
  const leases = useTable('leases')
  const invoices = useTable('invoices')
  const payments = useTable('payments')
  const expenses = useTable('expenses')
  const tables = [rooms, tenants, leases, invoices, payments, expenses]

  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** the summary of the running conversation: text for the server, object for the demo answer */
  const frozen = useRef<{ text: string; object: ReturnType<typeof buildAiSnapshot> } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const ready = tables.every((t) => t.data !== undefined)
  const loadError = tables.find((t) => t.error)?.error
  const today = todayISO()
  const live = useMemo(() => {
    if (!ready) return null
    return buildAiSnapshot({
      today,
      orgName: org.name,
      properties,
      rooms: rooms.data!,
      tenants: tenants.data!,
      leases: leases.data!,
      invoices: invoices.data!,
      payments: payments.data!,
      expenses: expenses.data!,
      propertyIds: financePropertyIds,
    })
  }, [ready, today, org.name, properties, rooms.data, tenants.data, leases.data, invoices.data, payments.data, expenses.data, financePropertyIds])

  useEffect(() => {
    if (turns.length > 0 || asking) endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [turns.length, asking])

  if (role === 'staff') {
    return (
      <>
        <PageHeader title="Tanya AI" />
        <EmptyState
          icon={<ShieldOff className="h-10 w-10" />}
          title="Tidak memiliki akses"
          description="Tanya AI membaca data keuangan, jadi hanya untuk pemilik dan admin."
          action={
            <Link to="/dashboard" className="text-sm font-medium text-brand-700 hover:underline">
              Kembali ke dashboard
            </Link>
          }
        />
      </>
    )
  }

  const kosLabel = selectedPropertyId === 'all' ? 'semua kos' : (properties.find((p) => p.id === selectedPropertyId)?.name ?? 'satu kos')
  const full = turns.length >= MAX_MESSAGES - 1
  const tooLong = draft.length > MAX_MESSAGE_CHARS

  const reset = () => {
    setTurns([])
    setError(null)
    frozen.current = null
  }

  const ask = async (text: string) => {
    const question = text.trim()
    if (!question || asking || !live || full || question.length > MAX_MESSAGE_CHARS) return
    // the first question of a conversation fixes the summary; later ones reuse it
    if (!frozen.current) frozen.current = { text: JSON.stringify(live), object: live }
    const history: Turn[] = [...turns, { role: 'user', content: question }]
    setTurns(history)
    setDraft('')
    setError(null)
    setAsking(true)
    try {
      if (isLocalMode) {
        setTurns([...history, { role: 'assistant', content: demoAnswer(frozen.current.object), costUsd: DEMO_ANSWER_COST_USD }])
      } else {
        const reply = await askAi(
          org.id,
          frozen.current.text,
          history.map(({ role, content }) => ({ role, content })),
        )
        setTurns([...history, { role: 'assistant', content: reply.answer, costUsd: reply.cost?.cost_usd ?? null, truncated: reply.truncated }])
      }
    } catch (err) {
      // the question stays in the box to try again; it is taken back out of the conversation
      setTurns(turns)
      // a first question that failed leaves no conversation: the next try reads the data afresh
      if (turns.length === 0) frozen.current = null
      setDraft(question)
      setError(err instanceof AskAiError ? err.message : 'Claude tidak dapat menjawab saat ini. Coba lagi.')
    } finally {
      setAsking(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Tanya AI"
        subtitle={`Tanyakan apa saja tentang data ${kosLabel}: pendapatan, tunggakan, kamar, proyeksi.`}
        actions={
          turns.length > 0 ? (
            <Button variant="outline" size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={reset} disabled={asking}>
              Percakapan baru
            </Button>
          ) : undefined
        }
      />
      {loadError ? (
        <ErrorState error={loadError} />
      ) : !ready ? (
        <LoadingState />
      ) : (
        <Card>
          <CardBody className="space-y-4">
            {turns.length === 0 && (
              <div className="space-y-3" data-testid="tanya-intro">
                <p className="flex items-start gap-2 text-sm text-slate-700">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                  <span>Claude membaca ringkasan data kos Anda saat ini lalu menjawab. Ia tidak bisa mengubah data apa pun.</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void ask(q)}
                      disabled={asking}
                      className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.length > 0 && (
              <ol className="space-y-3" aria-label="Percakapan" aria-live="polite" data-testid="tanya-turns">
                {turns.map((t, i) => (
                  <li key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                    <div
                      data-role={t.role}
                      className={
                        t.role === 'user'
                          ? 'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-700 px-3.5 py-2 text-sm text-white'
                          : 'max-w-[95%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-slate-100 px-3.5 py-2.5 text-sm leading-relaxed text-slate-900'
                      }
                    >
                      {t.content}
                      {t.role === 'assistant' && (t.truncated || t.costUsd != null) && (
                        <p className="mt-2 text-xs text-slate-500">
                          {t.truncated && 'Jawaban terpotong karena terlalu panjang. '}
                          {t.costUsd != null && `Biaya jawaban ini ${formatUsd(t.costUsd)}${isLocalMode ? ' (contoh)' : ''}.`}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {asking && (
              <p role="status" className="flex items-center gap-2 text-sm text-slate-600" data-testid="tanya-wait">
                <span className="h-2 w-2 animate-pulse rounded-full bg-brand-600" aria-hidden />
                Claude sedang membaca data dan menghitung. Biasanya 10–40 detik.
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <div ref={endRef} />

            {full ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Percakapan ini sudah panjang. Ketuk <strong>Percakapan baru</strong> untuk lanjut bertanya (data dibaca ulang).
              </p>
            ) : (
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void ask(draft)
                }}
              >
                <div className="min-w-0 flex-1">
                  <Textarea
                    label="Pertanyaan"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter sends on a keyboard; Shift+Enter (and the phone's return key) adds a line
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia?.('(pointer: fine)').matches) {
                        e.preventDefault()
                        void ask(draft)
                      }
                    }}
                    rows={2}
                    placeholder="mis. Berapa proyeksi pendapatan bulan ini?"
                    error={tooLong ? `Terlalu panjang (maks ${MAX_MESSAGE_CHARS} huruf).` : undefined}
                    disabled={asking}
                  />
                </div>
                <Button type="submit" icon={<SendHorizontal className="h-4 w-4" />} loading={asking} disabled={draft.trim() === '' || tooLong}>
                  Kirim
                </Button>
              </form>
            )}

            <p className="text-xs text-slate-500" data-testid="tanya-privacy">
              {isLocalMode
                ? 'Mode Demo: pertanyaan tidak dikirim ke mana pun; jawabannya contoh dari data di perangkat ini.'
                : 'Pertanyaan dan ringkasan data kos (nama penyewa, kamar, tagihan, pembayaran, pengeluaran) dikirim ke Claude (Anthropic) untuk dijawab. NIK, alamat, nomor HP dan foto KTP tidak ikut. Tiap jawaban memakai kredit Claude, sekitar US$0,05–0,20; rinciannya di Pengaturan → Kredit Claude.'}{' '}
              Jawaban AI bisa keliru: cocokkan angka penting dengan Laporan.
            </p>
          </CardBody>
        </Card>
      )}
    </>
  )
}

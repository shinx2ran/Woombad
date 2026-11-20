/**
 * Edge Function "tanya-ai" (SPEC 7.29): the owner or an admin asks Claude about the kos. The app sends the question,
 * the conversation so far and a summary of the data it already holds (src/features/tanya/snapshot.ts); this function
 * adds the instructions and the Claude key and returns the answer. Claude gets no tool and no database access: it
 * reads the summary and answers. Nothing is saved here except what the reply cost (scan_usage, kind 'chat', SPEC 7.17),
 * written with the project's secret key after the reply is sent; the log keeps counts only, never a question or a name.
 *
 * The same shape as scan-nota and scan-ktp: a signed-in member of the organisation named in the request (checked with
 * the caller's own token against organization_members, so RLS decides), here only an owner or admin (the summary holds
 * income); verify_jwt = false because this project uses publishable keys; the Claude key only in this function's
 * secrets (ANTHROPIC_API_KEY; without it: 503 "not_configured").
 */
import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0'
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { describeScanFailure, scanCost, usageRow, type ScanApiFailure, type ScanOutcome } from '../scan-nota/scan.ts'
import { CHAT_DATA_HEADING, CHAT_SYSTEM_PROMPT, ChatRequestError, MAX_SNAPSHOT_CHARS, parseChatMessages, questionCount, type ChatMessage } from './chat.ts'

const MODEL = 'claude-opus-5-5'
/** a refused request is re-run server-side on the model Anthropic recommends for that refusal category */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'
const ALLOWED_ORIGINS = ['https://shinx2ran.github.io', 'http://localhost:5173', 'http://localhost:4173']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function reply(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } })
}

const fail = (req: Request, status: number, error: string, message: string) => reply(req, status, { error, message })

/** the project's publishable key (new key model), else the legacy anon key, else the key the app sent */
function publicKey(req: Request): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}') as Record<string, string>
    if (keys.default) return keys.default
  } catch {
    /* not set: fall through */
  }
  return Deno.env.get('SUPABASE_ANON_KEY') ?? req.headers.get('apikey') ?? ''
}

/** the project's default secret key (new key model): bypasses RLS, server-side only, never logged or returned */
function secretKey(): string | null {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>
    return keys.default || null
  } catch {
    return null
  }
}

/** Append one scan_usage row (SPEC 7.17). Never fails the answer: a missing key or a refused insert is only logged. */
async function recordUsage(url: string, row: ReturnType<typeof usageRow>): Promise<void> {
  const key = secretKey()
  if (!key) {
    console.warn('tanya-ai usage not recorded: SUPABASE_SECRET_KEYS has no default key')
    return
  }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const { error } = await admin.from('scan_usage').insert(row).abortSignal(AbortSignal.timeout(5_000))
  if (error) console.error('tanya-ai usage not recorded', error.code ?? '', error.message)
}

/** run after the reply is sent; the runtime keeps the worker alive until the job settles (Supabase: background tasks) */
function inBackground(job: Promise<void>): void {
  const safe = job.catch((e) => console.error('tanya-ai usage not recorded', e instanceof Error ? e.message : String(e)))
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (runtime) runtime.waitUntil(safe)
}

/** the wording of scan failures speaks of photos; the same causes, for a question */
function chatFailure(f: ScanApiFailure): { status: number; error: string; message: string } {
  const base = describeScanFailure(f)
  if (base.error === 'not_configured') return base
  if (base.error === 'timeout') return { ...base, message: 'Jawaban terlalu lama. Coba lagi, atau ajukan pertanyaan yang lebih sempit.' }
  if (base.error === 'busy') return { ...base, message: 'Claude sedang sibuk. Coba lagi sebentar lagi.' }
  if (base.error === 'too_large') return { ...base, message: 'Data atau percakapan terlalu besar. Mulai percakapan baru.' }
  if (base.error === 'internal') return base
  return { status: base.status === 400 ? 502 : base.status, error: 'upstream', message: 'Claude tidak dapat menjawab saat ini. Coba lagi.' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return fail(req, 405, 'method', 'Gunakan POST.')

  // ---- who is asking (before anything else: a stranger learns nothing and costs nothing) ----
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const apikey = publicKey(req)
  if (!token || token.startsWith('sb_') || !supabaseUrl || !apikey) return fail(req, 401, 'unauthorized', 'Silakan masuk lagi.')
  const sb = createClient(supabaseUrl, apikey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await sb.auth.getUser(token)
  if (userError || !userData.user) return fail(req, 401, 'unauthorized', 'Sesi berakhir. Silakan masuk lagi.')

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return fail(req, 503, 'not_configured', 'Tanya AI belum aktif: pemilik perlu memasang kunci API Claude di Supabase (secret ANTHROPIC_API_KEY).')
  }

  // ---- what was sent ----
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail(req, 400, 'bad_request', 'Permintaan tidak valid.')
  }
  const { orgId, snapshot, messages: rawMessages } = (body ?? {}) as { orgId?: unknown; snapshot?: unknown; messages?: unknown }
  if (typeof orgId !== 'string' || !UUID_RE.test(orgId)) return fail(req, 400, 'bad_request', 'Organisasi tidak valid.')
  if (typeof snapshot !== 'string' || snapshot.length === 0) return fail(req, 400, 'bad_request', 'Ringkasan data tidak ada.')
  if (snapshot.length > MAX_SNAPSHOT_CHARS) return fail(req, 413, 'too_large', 'Data terlalu besar untuk dikirim. Pilih satu kos lalu coba lagi.')
  let messages: ChatMessage[]
  try {
    messages = parseChatMessages(rawMessages)
  } catch (err) {
    return fail(req, 400, 'bad_request', err instanceof ChatRequestError ? err.message : 'Permintaan tidak valid.')
  }

  // ---- an owner or admin of that organisation (RLS: members only see their own organisations' rows) ----
  const { data: member, error: memberError } = await sb
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userData.user.id)
    .maybeSingle()
  if (memberError) return fail(req, 502, 'upstream', 'Tidak dapat memeriksa keanggotaan. Coba lagi.')
  if (!member) return fail(req, 403, 'forbidden', 'Anda bukan anggota kos ini.')
  if (member.role !== 'owner' && member.role !== 'admin') return fail(req, 403, 'forbidden', 'Tanya AI hanya untuk pemilik dan admin.')

  // ---- ask ----
  // one attempt that ends before the platform's 150 s request limit, so the person gets this function's own message
  const client = new Anthropic({ apiKey, timeout: 130_000, maxRetries: 0 })
  let response: Anthropic.Beta.Messages.BetaMessage
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      // thinking is adaptive on this model (it cannot be turned off); medium is its default depth
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: CHAT_SYSTEM_PROMPT },
        // the same summary text through one conversation: cached after the first question
        { type: 'text', text: CHAT_DATA_HEADING + snapshot, cache_control: { type: 'ephemeral' } },
      ],
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    })
  } catch (err) {
    const failure: ScanApiFailure =
      err instanceof Anthropic.APIConnectionTimeoutError
        ? { kind: 'timeout' }
        : err instanceof Anthropic.APIConnectionError
          ? { kind: 'connection' }
          : err instanceof Anthropic.APIError
            ? { kind: 'api', status: err.status ?? null, type: err.type, message: err.apiMessage }
            : { kind: 'other' }
    // never the question, the data or the key: the SDK's own message, status and type only
    console.error('tanya-ai', failure.kind, failure.status ?? '', failure.type ?? '', err instanceof Error ? err.message : String(err))
    const replyFor = chatFailure(failure)
    return fail(req, replyFor.status, replyFor.error, replyFor.message)
  }

  // every reply that came back is recorded before any return below (a refusal that is not billed, at US$0)
  const cost = scanCost(response, MODEL)
  const userId = userData.user.id
  const asked = questionCount(messages)
  const record = (outcome: ScanOutcome) => {
    // what the answer cost, for the owner's records: counts only
    console.log(
      'tanya-ai usage',
      JSON.stringify({ outcome, model: cost.model, input_tokens: cost.input_tokens, output_tokens: cost.output_tokens, cost_usd: cost.cost_usd, fell_back: cost.fell_back, question: asked }),
    )
    inBackground(recordUsage(supabaseUrl, usageRow(orgId, userId, cost, outcome, outcome === 'ok' ? { kind: 'chat', lines: asked } : null)))
  }

  if (response.stop_reason === 'refusal') {
    record('refused')
    return fail(req, 422, 'refused', 'Claude tidak dapat menjawab pertanyaan ini. Coba tanyakan dengan cara lain.')
  }
  const answer = response.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
  if (response.stop_reason === 'max_tokens' && answer === '') {
    record('max_tokens')
    return fail(req, 502, 'upstream', 'Jawaban terpotong. Coba pertanyaan yang lebih sempit.')
  }
  if (answer === '') {
    record('invalid')
    return fail(req, 502, 'upstream', 'Jawaban kosong. Coba lagi.')
  }
  record('ok')
  return reply(req, 200, {
    answer,
    truncated: response.stop_reason === 'max_tokens',
    model: response.model,
    usage: { input_tokens: cost.input_tokens, output_tokens: cost.output_tokens },
    cost: { cost_usd: cost.cost_usd, fell_back: cost.fell_back },
  })
})

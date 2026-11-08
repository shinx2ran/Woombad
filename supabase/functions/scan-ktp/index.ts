/**
 * Edge Function "scan-ktp" (SPEC 7.19): reads a photo of an identity document (an Indonesian e-KTP or a passport) with
 * Claude and returns the printed fields as data for the app's document scanner, which shows them for the person to tick
 * before anything lands in the tenant form. Nothing is saved here. What each billed reply cost is recorded in scan_usage
 * (SPEC 7.17) with the project's secret key, after the reply is sent; the log keeps counts only, never the fields.
 *
 * The same shape as scan-nota: a signed-in member of the organisation named in the request (checked with the caller's
 * own token against organization_members, so RLS decides), verify_jwt = false because this project uses publishable
 * keys, the Claude key only in this function's secrets (ANTHROPIC_API_KEY; without it: 503 "not_configured"). The
 * shared pieces (image limits, cost, failure wording) are imported from scan-nota's module.
 */
import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0'
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import {
  MAX_IMAGE_BASE64_CHARS,
  SCAN_MEDIA_TYPES,
  describeScanFailure,
  scanCost,
  usageRow,
  type ScanApiFailure,
  type ScanMediaType,
  type ScanOutcome,
} from '../scan-nota/scan.ts'
import { KTP_SCAN_SCHEMA, KTP_SCAN_SYSTEM_PROMPT, KTP_SCAN_USER_TEXT, KtpScanOutputError, countFilledFields, parseKtpScanOutput, type KtpScanResult } from './ktp.ts'

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

/**
 * Append one scan_usage row (SPEC 7.17). A separate client that carries only the secret key: with the member's token
 * PostgREST would run the insert as `authenticated`, which may not insert. Never fails the scan: a missing key or a
 * refused insert is only logged (the "scan-ktp usage" log line keeps the figures).
 */
async function recordUsage(url: string, row: ReturnType<typeof usageRow>): Promise<void> {
  const key = secretKey()
  if (!key) {
    console.warn('scan-ktp usage not recorded: SUPABASE_SECRET_KEYS has no default key')
    return
  }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const { error } = await admin.from('scan_usage').insert(row).abortSignal(AbortSignal.timeout(5_000))
  if (error) console.error('scan-ktp usage not recorded', error.code ?? '', error.message)
}

/** run after the reply is sent; the runtime keeps the worker alive until the job settles (Supabase: background tasks) */
function inBackground(job: Promise<void>): void {
  const safe = job.catch((e) => console.error('scan-ktp usage not recorded', e instanceof Error ? e.message : String(e)))
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (runtime) runtime.waitUntil(safe)
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
    return fail(req, 503, 'not_configured', 'Scan KTP lewat Claude belum aktif: pemilik perlu memasang kunci API Claude di Supabase (secret ANTHROPIC_API_KEY).')
  }

  // ---- what was sent ----
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail(req, 400, 'bad_request', 'Permintaan tidak valid.')
  }
  const { orgId, image, mediaType } = (body ?? {}) as { orgId?: unknown; image?: unknown; mediaType?: unknown }
  if (typeof orgId !== 'string' || !UUID_RE.test(orgId)) return fail(req, 400, 'bad_request', 'Organisasi tidak valid.')
  if (typeof image !== 'string' || image.length === 0) return fail(req, 400, 'bad_request', 'Foto tidak ada.')
  if (image.length > MAX_IMAGE_BASE64_CHARS) return fail(req, 413, 'too_large', 'Foto terlalu besar. Ambil ulang fotonya.')
  if (typeof mediaType !== 'string' || !SCAN_MEDIA_TYPES.includes(mediaType as ScanMediaType)) {
    return fail(req, 400, 'bad_request', 'Format foto tidak didukung (pakai JPG, PNG, atau WebP).')
  }

  // ---- a member of that organisation (RLS: members only see their own organisations' rows) ----
  const { data: member, error: memberError } = await sb
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userData.user.id)
    .maybeSingle()
  if (memberError) return fail(req, 502, 'upstream', 'Tidak dapat memeriksa keanggotaan. Coba lagi.')
  if (!member) return fail(req, 403, 'forbidden', 'Anda bukan anggota kos ini.')

  // ---- read the document ----
  // one attempt that ends before the platform's 150 s request limit, so the person gets this function's own message
  const client = new Anthropic({ apiKey, timeout: 130_000, maxRetries: 0 })
  let response: Anthropic.Beta.Messages.BetaMessage
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: KTP_SCAN_SCHEMA } },
      system: KTP_SCAN_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType as ScanMediaType, data: image } },
            { type: 'text', text: KTP_SCAN_USER_TEXT },
          ],
        },
      ],
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
    // never the image or the key: the SDK's own message, status and type only
    console.error('scan-ktp', failure.kind, failure.status ?? '', failure.type ?? '', err instanceof Error ? err.message : String(err))
    const replyFor = describeScanFailure(failure)
    return fail(req, replyFor.status, replyFor.error, replyFor.message)
  }

  // every reply that came back is recorded before any return below (a refusal that is not billed, at US$0)
  const cost = scanCost(response, MODEL)
  const userId = userData.user.id
  const record = (outcome: ScanOutcome, read: KtpScanResult | null = null) => {
    // what the scan cost, for the owner's records: counts only, never the photo or what was read
    const lines = read ? countFilledFields(read) : null
    console.log(
      'scan-ktp usage',
      JSON.stringify({
        outcome,
        model: cost.model,
        input_tokens: cost.input_tokens,
        output_tokens: cost.output_tokens,
        cost_usd: cost.cost_usd,
        fell_back: cost.fell_back,
        kind: read?.kind ?? null,
        lines,
      }),
    )
    inBackground(recordUsage(supabaseUrl, usageRow(orgId, userId, cost, outcome, read && lines !== null ? { kind: read.kind, lines } : null)))
  }

  // refusal before reading content: nothing usable came back
  if (response.stop_reason === 'refusal') {
    record('refused')
    return fail(req, 422, 'refused', 'Foto ini tidak dapat dibaca. Pastikan isinya KTP atau halaman data paspor.')
  }
  if (response.stop_reason === 'max_tokens') {
    record('max_tokens')
    return fail(req, 502, 'upstream', 'Pembacaan terpotong. Coba lagi dengan foto yang hanya berisi dokumennya.')
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    record('invalid')
    return fail(req, 502, 'upstream', 'Hasil baca kosong. Coba lagi.')
  }
  let result: KtpScanResult
  try {
    result = parseKtpScanOutput(JSON.parse(textBlock.text))
  } catch (err) {
    console.error('scan-ktp output', err instanceof KtpScanOutputError ? err.message : err)
    record('invalid')
    return fail(req, 502, 'upstream', 'Hasil baca tidak lengkap. Coba lagi atau ambil ulang fotonya.')
  }
  record('ok', result)
  return reply(req, 200, {
    result,
    model: response.model,
    usage: { input_tokens: cost.input_tokens, output_tokens: cost.output_tokens },
    cost: { cost_usd: cost.cost_usd, fell_back: cost.fell_back },
  })
})

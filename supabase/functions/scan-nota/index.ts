/**
 * Edge Function "scan-nota" (SPEC 7.16): reads a photo of an expense record (a handwritten monthly list or a shop
 * receipt) with Claude and returns the lines as data for the app's review screen. Nothing is saved here: the app
 * shows the lines, the person checks them, and the app writes the expenses with the member's own rights.
 *
 * Who may call it: a signed-in member of the organisation named in the request (checked with the caller's own token
 * against organization_members, so RLS decides). Deployed with verify_jwt = false: the platform's check only knows the
 * legacy JWT keys and this project uses publishable keys, so the function verifies the session itself (Supabase docs,
 * "Migrating to publishable and secret API keys"). The Claude key lives only in this function's secrets
 * (ANTHROPIC_API_KEY); without it the function answers 503 "not_configured".
 */
import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0'
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import {
  MAX_IMAGE_BASE64_CHARS,
  SCAN_MEDIA_TYPES,
  SCAN_SCHEMA,
  SCAN_SYSTEM_PROMPT,
  SCAN_USER_TEXT,
  ScanOutputError,
  describeScanFailure,
  parseScanOutput,
  type ScanApiFailure,
  type ScanMediaType,
} from './scan.ts'

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
    return fail(req, 503, 'not_configured', 'Scan nota belum aktif: pemilik perlu memasang kunci API Claude di Supabase (secret ANTHROPIC_API_KEY).')
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

  // ---- read the photo ----
  // one attempt that ends before the platform's 150 s request limit, so the person gets this function's own message
  // (a retry inside the call would only run past the limit and be cut off without one)
  const client = new Anthropic({ apiKey, timeout: 130_000, maxRetries: 0 })
  let response: Anthropic.Beta.Messages.BetaMessage
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCAN_SCHEMA } },
      system: SCAN_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType as ScanMediaType, data: image } },
            { type: 'text', text: SCAN_USER_TEXT },
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
    console.error('scan-nota', failure.kind, failure.status ?? '', failure.type ?? '', err instanceof Error ? err.message : String(err))
    const replyFor = describeScanFailure(failure)
    return fail(req, replyFor.status, replyFor.error, replyFor.message)
  }

  // refusal before reading content: nothing usable came back
  if (response.stop_reason === 'refusal') return fail(req, 422, 'refused', 'Foto ini tidak dapat dibaca. Pastikan isinya catatan pengeluaran atau nota.')
  if (response.stop_reason === 'max_tokens') return fail(req, 502, 'upstream', 'Catatan terlalu panjang untuk sekali scan. Foto per halaman.')

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') return fail(req, 502, 'upstream', 'Hasil baca kosong. Coba lagi.')
  try {
    const result = parseScanOutput(JSON.parse(textBlock.text))
    return reply(req, 200, {
      result,
      model: response.model,
      usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    })
  } catch (err) {
    console.error('scan-nota output', err instanceof ScanOutputError ? err.message : err)
    return fail(req, 502, 'upstream', 'Hasil baca tidak lengkap. Coba lagi atau ambil ulang fotonya.')
  }
})

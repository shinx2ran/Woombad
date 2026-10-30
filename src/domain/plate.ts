/**
 * Nomor kendaraan (SPEC 7.11): the licence plate of a tenant's vehicle, kept on the lease. Typed by hand in many ways
 * ("KB.1442.Gz.", "kb1442gz", "B 2845 TYY."), stored the one way plates are written: "KB 1442 GZ". Several vehicles
 * are kept apart by a comma: "KB 1442 GZ, B 1251 SGA".
 */

/** the longest text the inputs take: room for four plates */
export const PLATE_MAX_LENGTH = 60

/** one plate as typed -> "KB 1442 GZ": upper case, dots and dashes as spaces, a space where letters meet digits */
function normalizeOne(part: string): string {
  return part
    .toUpperCase()
    .replace(/[.\-_]+/g, ' ')
    .replace(/([A-Z])(?=\d)/g, '$1 ')
    .replace(/(\d)(?=[A-Z])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** one written plate: region letters, up to four digits, up to three letters; then an optional "DAN" ("and") and a space */
const PLATE_IN_RUN = /([A-Z]{1,2} \d{1,4}(?: [A-Z]{1,3})?)(?: DAN)?(?: |$)/y

/**
 * Several whole plates typed one after the other without a comma ("KB1442GZ B1251SGA", "KB 1442 GZ dan B 1251 SGA") are
 * several plates; anything else stays as typed.
 */
function splitRun(part: string): string[] {
  const plates: string[] = []
  PLATE_IN_RUN.lastIndex = 0
  while (PLATE_IN_RUN.lastIndex < part.length) {
    const m = PLATE_IN_RUN.exec(part)
    if (!m) return [part]
    plates.push(m[1])
  }
  return plates.length > 1 ? plates : [part]
}

/** What was typed, written as plates are written, each plate once; null when nothing is left (an empty field clears it). */
export function normalizePlate(input: string | null | undefined): string | null {
  if (!input) return null
  const plates = [...new Set(input.split(/[,;/\n&+]+/).map(normalizeOne).filter(Boolean).flatMap(splitRun))]
  return plates.length > 0 ? plates.join(', ') : null
}

/** A stored value as its plates, one per vehicle (the room board writes each on its own line); [] for none. */
export function splitPlates(value: string | null | undefined): string[] {
  return value ? value.split(',').map((p) => p.trim()).filter(Boolean) : []
}

/** letters and digits only, lower case: "KB 1442 GZ" and "kb1442" compare alike */
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * The lease list's search (SPEC 7.11): does one of the plates contain what was typed, spaces and dots ignored ("kb1442",
 * "1442 gz")? At least four letters or digits, so a room search like "b1" or "A10" does not turn up plates.
 */
export function plateMatches(value: string | null | undefined, query: string): boolean {
  const q = compact(query)
  return q.length >= 4 && splitPlates(value).some((p) => compact(p).includes(q))
}

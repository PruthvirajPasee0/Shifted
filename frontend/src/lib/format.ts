// Coerce anything numeric-ish (including numeric strings the API may send for
// Decimal-backed fields). Returns null when missing/invalid so UI can show "—".
function toNumber(n: number | string | undefined | null): number | null {
  if (n === undefined || n === null || n === '') return null
  const v = typeof n === 'string' ? Number(n) : n
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function money(n: number | string | undefined | null, currency = '₹'): string {
  const v = toNumber(n)
  if (v === null) return '—'
  return `${currency}${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

export function num(n: number | string | undefined | null, digits = 0): string {
  const v = toNumber(n)
  if (v === null) return '—'
  return v.toLocaleString('en-IN', { maximumFractionDigits: digits })
}

export function dateLabel(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function timeLabel(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

// Haversine distance in km between two lat/lng points.
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

import type { LatLng } from '../components/MapView'
import { haversineKm } from './format'

/**
 * Road routing strategy (free-tier friendly):
 * 1. OSRM public router — $0, no Google Routes/Directions SKU
 * 2. Google DirectionsService (Maps JS, TRAFFIC_UNAWARE) — only if OSRM fails;
 *    Essentials free monthly quota; heavily session-cached
 * 3. Straight line — last resort
 */

export interface RoadRouteOption {
  id: string
  path: LatLng[]
  distanceKm: number
  durationMin: number
  /** Shortest distance among alternatives — preferred for fuel / sustainability. */
  recommended: boolean
}

const memoryCache = new Map<string, RoadRouteOption[]>()
const OSRM_TIMEOUT_MS = 4500

function roundKey(n: number): string {
  return n.toFixed(4)
}

export function routeCacheKey(origin: LatLng, dest: LatLng): string {
  return `${roundKey(origin.lat)},${roundKey(origin.lng)}|${roundKey(dest.lat)},${roundKey(dest.lng)}`
}

function straightFallback(origin: LatLng, dest: LatLng): RoadRouteOption[] {
  const distanceKm = haversineKm(origin, dest)
  return [
    {
      id: 'straight',
      path: [origin, dest],
      distanceKm,
      durationMin: Math.max(1, Math.round((distanceKm / 30) * 60)),
      recommended: true,
    },
  ]
}

function finalize(options: RoadRouteOption[]): RoadRouteOption[] {
  const sorted = [...options].sort((a, b) => a.distanceKm - b.distanceKm)
  return sorted.map((o, i) => ({
    ...o,
    id: `r${i}`,
    recommended: i === 0,
  }))
}

type OsrmResponse = {
  code?: string
  routes?: Array<{
    distance: number
    duration: number
    geometry?: { coordinates?: [number, number][] }
  }>
}

async function fetchOsrm(origin: LatLng, dest: LatLng): Promise<RoadRouteOption[]> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${origin.lng},${origin.lat};${dest.lng},${dest.lat}` +
    `?overview=full&geometries=geojson&alternatives=true&steps=false`

  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), OSRM_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`OSRM ${res.status}`)
    const data = (await res.json()) as OsrmResponse
    if (data.code !== 'Ok' || !data.routes?.length) {
      throw new Error(data.code ?? 'no routes')
    }

    return finalize(
      data.routes.map((r, i) => {
        const coords = r.geometry?.coordinates ?? []
        const path: LatLng[] =
          coords.length >= 2
            ? coords.map(([lng, lat]) => ({ lat, lng }))
            : [origin, dest]
        return {
          id: `osrm-${i}`,
          path,
          distanceKm: r.distance / 1000,
          durationMin: Math.max(1, Math.round(r.duration / 60)),
          recommended: false,
        }
      }),
    )
  } finally {
    window.clearTimeout(timer)
  }
}

function fetchGoogleDirections(
  origin: LatLng,
  dest: LatLng,
): Promise<RoadRouteOption[]> {
  return new Promise((resolve, reject) => {
    if (typeof google === 'undefined' || !google.maps?.DirectionsService) {
      reject(new Error('Google Directions unavailable'))
      return
    }
    const svc = new google.maps.DirectionsService()
    svc.route(
      {
        origin,
        destination: dest,
        travelMode: google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: true,
        // Avoid traffic SKUs — stay on basic / Essentials billing.
        drivingOptions: undefined,
      },
      (result, status) => {
        if (status !== google.maps.DirectionsStatus.OK || !result?.routes?.length) {
          reject(new Error(String(status)))
          return
        }
        const options = result.routes.map((r, i) => {
          const path = (r.overview_path ?? []).map((p) => ({
            lat: p.lat(),
            lng: p.lng(),
          }))
          const leg = r.legs[0]
          const distanceKm = (leg?.distance?.value ?? 0) / 1000
          const durationMin = Math.max(
            1,
            Math.round((leg?.duration?.value ?? 0) / 60),
          )
          return {
            id: `g-${i}`,
            path: path.length >= 2 ? path : [origin, dest],
            distanceKm: distanceKm || haversineKm(origin, dest),
            durationMin,
            recommended: false,
          }
        })
        resolve(finalize(options))
      },
    )
  })
}

/** Drop 2-point crow-flies paths and empty geometries. */
function onlyRoadPaths(options: RoadRouteOption[]): RoadRouteOption[] {
  return finalize(options.filter((o) => o.path.length > 2))
}

/**
 * Fetch driving route alternatives. Sorted shortest-first; first is recommended.
 * Prefer Google Directions when Maps JS is loaded (cleaner India coverage),
 * then free OSRM. Never cache the straight-line fallback.
 */
export async function fetchDrivingRoutes(
  origin: LatLng,
  dest: LatLng,
): Promise<RoadRouteOption[]> {
  const key = routeCacheKey(origin, dest)
  const cached = memoryCache.get(key)
  if (cached) return cached

  // Google first when available — avoids OSRM quirks / stray overview segments.
  if (typeof google !== 'undefined' && google.maps?.DirectionsService) {
    try {
      const googleRoutes = onlyRoadPaths(await fetchGoogleDirections(origin, dest))
      if (googleRoutes.length) {
        memoryCache.set(key, googleRoutes)
        return googleRoutes
      }
    } catch {
      /* try OSRM */
    }
  }

  try {
    const osrm = onlyRoadPaths(await fetchOsrm(origin, dest))
    if (osrm.length) {
      memoryCache.set(key, osrm)
      return osrm
    }
  } catch {
    /* fall through */
  }

  // Last attempt: Google even if we tried OSRM first path above failed earlier.
  try {
    const googleRoutes = onlyRoadPaths(await fetchGoogleDirections(origin, dest))
    if (googleRoutes.length) {
      memoryCache.set(key, googleRoutes)
      return googleRoutes
    }
  } catch {
    /* no road route */
  }

  return straightFallback(origin, dest)
}

/** Persist path as compact JSON for ride.route_polyline. */
export function encodeRoutePath(path: LatLng[]): string {
  return JSON.stringify(path.map((p) => [+p.lat.toFixed(5), +p.lng.toFixed(5)]))
}

export function decodeRoutePath(raw: string | null | undefined): LatLng[] | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data) || data.length < 2) return null
    const path: LatLng[] = []
    for (const item of data) {
      if (Array.isArray(item) && item.length >= 2) {
        const lat = Number(item[0])
        const lng = Number(item[1])
        if (Number.isFinite(lat) && Number.isFinite(lng)) path.push({ lat, lng })
      } else if (
        item &&
        typeof item === 'object' &&
        'lat' in item &&
        'lng' in item
      ) {
        const lat = Number((item as LatLng).lat)
        const lng = Number((item as LatLng).lng)
        if (Number.isFinite(lat) && Number.isFinite(lng)) path.push({ lat, lng })
      }
    }
    return path.length >= 2 ? path : null
  } catch {
    return null
  }
}

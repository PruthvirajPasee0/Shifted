import { useEffect, useState } from 'react'
import type { LatLng } from '../components/MapView'
import {
  fetchDrivingRoutes,
  type RoadRouteOption,
  routeCacheKey,
} from './routing'

/**
 * Loads driving alternatives when origin + dest are set.
 * Defaults to the shortest (most sustainable) route.
 * Never exposes a 2-point straight A→B path to the map.
 */
export function useRoadRoute(origin: LatLng | null, dest: LatLng | null) {
  const [options, setOptions] = useState<RoadRouteOption[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!origin || !dest) {
      setOptions([])
      setSelectedId(null)
      setLoading(false)
      setError(null)
      return
    }

    let active = true
    const key = routeCacheKey(origin, dest)

    // Drop previous polylines immediately so old routes don't linger on the map.
    setOptions([])
    setSelectedId(null)
    setLoading(true)
    setError(null)

    void fetchDrivingRoutes(origin, dest)
      .then((routes) => {
        if (!active) return
        // Never keep the crow-flies fallback as a drawable option.
        const roadOnly = routes.filter(
          (r) => r.id !== 'straight' && r.path.length > 2,
        )
        if (!roadOnly.length) {
          setOptions([])
          setSelectedId(null)
          setError('Could not load a road route. Try again in a moment.')
          return
        }
        setOptions(roadOnly)
        const best = roadOnly.find((r) => r.recommended) ?? roadOnly[0]
        setSelectedId(best.id)
      })
      .catch(() => {
        if (!active) return
        setOptions([])
        setSelectedId(null)
        setError('Could not load road route.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      void key
    }
  }, [origin?.lat, origin?.lng, dest?.lat, dest?.lng])

  const selected =
    options.find((o) => o.id === selectedId) ?? options[0] ?? null

  return {
    options,
    selected,
    selectedId: selected?.id ?? null,
    selectRoute: setSelectedId,
    loading,
    error,
    distanceKm: selected?.distanceKm ?? 0,
    durationMin: selected?.durationMin ?? 0,
    // Only a real multi-point road path — never [origin, dest].
    path: selected && selected.path.length > 2 ? selected.path : undefined,
  }
}

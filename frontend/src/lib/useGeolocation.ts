import { useEffect, useState } from 'react'
import type { LatLng } from '../components/MapView'
import { DEFAULT_MAP_CENTER } from './googleMaps'

type GeoState = {
  coords: LatLng
  ready: boolean
  error: string | null
}

/**
 * Request browser GPS once; fall back to DEFAULT_MAP_CENTER (Bengaluru).
 */
export function useGeolocation(auto = true): GeoState & {
  request: () => void
} {
  const [state, setState] = useState<GeoState>({
    coords: DEFAULT_MAP_CENTER,
    ready: false,
    error: null,
  })

  function request() {
    if (!navigator.geolocation) {
      setState({
        coords: DEFAULT_MAP_CENTER,
        ready: true,
        error: 'Geolocation not supported',
      })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState({
          coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          ready: true,
          error: null,
        })
      },
      () => {
        setState({
          coords: DEFAULT_MAP_CENTER,
          ready: true,
          error: 'Location permission denied — using default city',
        })
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    )
  }

  useEffect(() => {
    if (auto) request()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto])

  return { ...state, request }
}

export async function reverseGeocode(coords: LatLng): Promise<string | null> {
  if (typeof google === 'undefined' || !google.maps?.Geocoder) return null
  const geocoder = new google.maps.Geocoder()
  try {
    const { results } = await geocoder.geocode({ location: coords })
    return results[0]?.formatted_address ?? null
  } catch {
    return null
  }
}

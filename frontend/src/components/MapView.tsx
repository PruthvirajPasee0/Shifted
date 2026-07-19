import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api'
import { GOOGLE_MAPS_API_KEY, MAPS_LOADER, DEFAULT_MAP_CENTER } from '../lib/googleMaps'

export interface LatLng {
  lat: number
  lng: number
}

export interface MapMarker extends LatLng {
  label?: string
  kind?: 'origin' | 'dest' | 'vehicle'
}

export interface MapRouteOption {
  id: string
  path: LatLng[]
  label?: string
}

interface Props {
  center?: LatLng
  zoom?: number
  markers?: MapMarker[]
  /** Selected road path (follows streets). */
  route?: LatLng[]
  /** Kept for API compat — not stroked (avoids leftover alt paths). */
  altRoutes?: MapRouteOption[]
  selectedRouteId?: string | null
  onSelectRoute?: (id: string) => void
  onClick?: (p: LatLng) => void
  height?: number | string
  className?: string
  fitRoute?: boolean
}

function pinIcon(kind: MapMarker['kind']): google.maps.Icon {
  const fill = kind === 'vehicle' ? '#FFFFFF' : '#0B0B0C'
  const stroke = kind === 'vehicle' ? '#0B0B0C' : '#FFFFFF'
  const glyph = kind === 'origin' ? 'A' : kind === 'dest' ? 'B' : '▪'
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">
      <path d="M17 0C7.6 0 0 7.6 0 17c0 12 17 27 17 27s17-15 17-27C34 7.6 26.4 0 17 0z" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      <text x="17" y="23" font-family="monospace" font-size="14" font-weight="700" fill="${stroke}" text-anchor="middle">${glyph}</text>
    </svg>`
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(34, 44),
    anchor: new google.maps.Point(17, 44),
  }
}

const MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: false,
  clickableIcons: false,
  streetViewControl: false,
  mapTypeControl: false,
  fullscreenControl: false,
}

function routeSignature(route?: LatLng[], selectedRouteId?: string | null): string {
  if (!route || route.length < 2) return 'none'
  const a = route[0]
  const b = route[route.length - 1]
  const mid = route[Math.floor(route.length / 2)]
  return [
    selectedRouteId ?? 'r',
    route.length,
    a.lat.toFixed(5),
    a.lng.toFixed(5),
    mid.lat.toFixed(5),
    mid.lng.toFixed(5),
    b.lat.toFixed(5),
    b.lng.toFixed(5),
  ].join('|')
}

export default function MapView({
  center = DEFAULT_MAP_CENTER,
  zoom = 12,
  markers = [],
  route,
  altRoutes: _altRoutes = [],
  selectedRouteId,
  onSelectRoute: _onSelectRoute,
  onClick,
  height = 360,
  className = '',
  fitRoute = true,
}: Props) {
  void _altRoutes
  void _onSelectRoute

  const { isLoaded } = useJsApiLoader(MAPS_LOADER)
  const [map, setMap] = useState<google.maps.Map | null>(null)
  const polylineRef = useRef<google.maps.Polyline | null>(null)
  const sig = useMemo(
    () => routeSignature(route, selectedRouteId),
    [route, selectedRouteId],
  )

  const handleClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (e.latLng) onClick?.({ lat: e.latLng.lat(), lng: e.latLng.lng() })
    },
    [onClick],
  )

  // Imperative polyline so old paths are always removed before drawing a new one.
  useEffect(() => {
    if (!map) return

    if (polylineRef.current) {
      polylineRef.current.setMap(null)
      polylineRef.current = null
    }

    if (!route || route.length < 3 || sig === 'none') return

    const line = new google.maps.Polyline({
      path: route.map((p) => ({ lat: p.lat, lng: p.lng })),
      strokeColor: '#0B0B0C',
      strokeOpacity: 0.9,
      strokeWeight: 5,
      geodesic: false,
      map,
      zIndex: 2,
    })
    polylineRef.current = line

    if (fitRoute) {
      const bounds = new google.maps.LatLngBounds()
      route.forEach((p) => bounds.extend(p))
      markers.forEach((m) => bounds.extend(m))
      map.fitBounds(bounds, 48)
    }

    return () => {
      line.setMap(null)
      if (polylineRef.current === line) polylineRef.current = null
    }
  }, [map, sig, route, fitRoute, markers])

  useEffect(() => {
    return () => {
      if (polylineRef.current) {
        polylineRef.current.setMap(null)
        polylineRef.current = null
      }
    }
  }, [])

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div
        className={`gmap-container flex items-center justify-center rounded-card border border-line ${className}`}
        style={{ height }}
      >
        <p className="max-w-[220px] px-4 text-center font-mono text-[12px] text-g-500">
          Set VITE_GOOGLE_MAPS_API_KEY in frontend/.env to enable the map.
        </p>
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div
        className={`gmap-container flex items-center justify-center rounded-card border border-line ${className}`}
        style={{ height }}
      >
        <p className="font-mono text-[12px] text-g-500">Loading map…</p>
      </div>
    )
  }

  return (
    <div
      className={`overflow-hidden rounded-card border border-line ${className}`}
      style={{ height }}
    >
      <GoogleMap
        center={center}
        zoom={zoom}
        mapContainerClassName="gmap-container"
        mapContainerStyle={{ width: '100%', height: '100%' }}
        options={MAP_OPTIONS}
        onClick={handleClick}
        onLoad={setMap}
        onUnmount={() => {
          if (polylineRef.current) {
            polylineRef.current.setMap(null)
            polylineRef.current = null
          }
          setMap(null)
        }}
      >
        {markers.map((m, i) => (
          <Marker
            key={`${m.kind ?? 'm'}-${m.lat.toFixed(5)}-${m.lng.toFixed(5)}-${i}`}
            position={{ lat: m.lat, lng: m.lng }}
            icon={pinIcon(m.kind)}
            title={m.label}
          />
        ))}
      </GoogleMap>
    </div>
  )
}

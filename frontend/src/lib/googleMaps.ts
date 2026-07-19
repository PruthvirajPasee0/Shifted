export const GOOGLE_MAPS_API_KEY =
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || ''

/** Shared loader options so MapView + Places Autocomplete share one script tag. */
export const MAPS_LOADER = {
  id: 'carpool-google-maps',
  googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  libraries: ['places'] as ('places')[],
}

/** Default when geolocation is denied — matches seed rides (Bengaluru). */
export const DEFAULT_MAP_CENTER = { lat: 12.9716, lng: 77.5946 }

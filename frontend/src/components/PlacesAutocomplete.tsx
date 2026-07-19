import { useRef, useState } from 'react'
import { Autocomplete, useJsApiLoader } from '@react-google-maps/api'
import { GOOGLE_MAPS_API_KEY, MAPS_LOADER } from '../lib/googleMaps'
import type { LatLng } from './MapView'

interface Props {
  label: string
  value: string
  onChange: (label: string) => void
  onPlace: (place: { label: string; coords: LatLng }) => void
  placeholder?: string
  hint?: string
}

/**
 * Google Places Autocomplete input. Picks lat/lng when user selects a suggestion.
 */
export default function PlacesAutocomplete({
  label,
  value,
  onChange,
  onPlace,
  placeholder,
  hint,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [ac, setAc] = useState<google.maps.places.Autocomplete | null>(null)
  const { isLoaded } = useJsApiLoader(MAPS_LOADER)

  function onLoad(autocomplete: google.maps.places.Autocomplete) {
    setAc(autocomplete)
  }

  function onPlaceChanged() {
    if (!ac) return
    const place = ac.getPlace()
    const loc = place.geometry?.location
    if (!loc) return
    const labelText =
      place.formatted_address || place.name || inputRef.current?.value || value
    onChange(labelText)
    onPlace({
      label: labelText,
      coords: { lat: loc.lat(), lng: loc.lng() },
    })
  }

  const field = (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      className="w-full rounded-[10px] border border-line-strong bg-paper px-3.5 py-2.5 font-body text-[14px] text-ink outline-none focus:border-ink"
    />
  )

  return (
    <label className="block">
      <span className="eyebrow mb-1.5 block">{label}</span>
      {!GOOGLE_MAPS_API_KEY || !isLoaded ? (
        field
      ) : (
        <Autocomplete
          onLoad={onLoad}
          onPlaceChanged={onPlaceChanged}
          options={{
            fields: ['formatted_address', 'geometry', 'name'],
            componentRestrictions: { country: 'in' },
          }}
        >
          {field}
        </Autocomplete>
      )}
      {hint && (
        <span className="mt-1 block font-mono text-[10px] text-g-500">{hint}</span>
      )}
    </label>
  )
}

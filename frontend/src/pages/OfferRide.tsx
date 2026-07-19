import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import Button from '../components/Button'
import { Input, Select } from '../components/Field'
import MapView, { type LatLng } from '../components/MapView'
import PlacesAutocomplete from '../components/PlacesAutocomplete'
import CommutePresets from '../components/CommutePresets'
import OfferGate from '../components/OfferGate'
import { useAsync } from '../lib/useAsync'
import { useToast } from '../context/ToastContext'
import { useGeolocation, reverseGeocode } from '../lib/useGeolocation'
import { useRoadRoute } from '../lib/useRoadRoute'
import { encodeRoutePath } from '../lib/routing'
import { DEFAULT_MAP_CENTER } from '../lib/googleMaps'
import api from '../lib/api'
import type { Document, Place, Vehicle } from '../types'
import { money } from '../lib/format'

type PickMode = 'origin' | 'dest'
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const RRULE_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

function todayLocalDate(): string {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

export default function OfferRide() {
  const navigate = useNavigate()
  const toast = useToast()
  const geo = useGeolocation(true)
  const vehicles = useAsync<Vehicle[]>(
    () => api.get('/vehicles').then((r) => r.data),
    [],
  )
  const docs = useAsync<Document[]>(
    () => api.get('/documents').then((r) => r.data),
    [],
  )
  const savedPlaces = useAsync<Place[]>(
    () => api.get('/places').then((r) => r.data),
    [],
  )

  const activeVehicles = (vehicles.data ?? []).filter((v) => v.is_active)
  const today = new Date().toISOString().slice(0, 10)
  function hasVerifiedDoc(type: string) {
    return (docs.data ?? []).some((d) => {
      if (d.doc_type !== type || d.status !== 'verified') return false
      if (d.expiry_date && d.expiry_date < today) return false
      return true
    })
  }
  const hasVerifiedLicence = hasVerifiedDoc('driving_license')
  const hasVerifiedRc = hasVerifiedDoc('vehicle_rc')
  const hasVerifiedInsurance = hasVerifiedDoc('vehicle_insurance')
  const gated =
    !hasVerifiedLicence ||
    !hasVerifiedRc ||
    !hasVerifiedInsurance ||
    activeVehicles.length === 0

  const [vehicleId, setVehicleId] = useState('')
  const [origin, setOrigin] = useState<LatLng | null>(null)
  const [dest, setDest] = useState<LatLng | null>(null)
  const [originLabel, setOriginLabel] = useState('')
  const [destLabel, setDestLabel] = useState('')
  const [pickMode, setPickMode] = useState<PickMode>('origin')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [seats, setSeats] = useState(2)
  const [fare, setFare] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [geoApplied, setGeoApplied] = useState(false)
  const [recurring, setRecurring] = useState(false)
  const [repeatDays, setRepeatDays] = useState<number[]>([])

  // Default origin to GPS (or Bengaluru fallback) so user need not click first pin.
  useEffect(() => {
    if (!geo.ready || geoApplied || origin) return
    setOrigin(geo.coords)
    setGeoApplied(true)
    void reverseGeocode(geo.coords).then((label) => {
      if (label) setOriginLabel(label)
    })
  }, [geo.ready, geo.coords, geoApplied, origin])

  const fallbackVehicleId = activeVehicles[0]?.id ?? ''
  const selectedVehicle = activeVehicles.find(
    (v) => String(v.id) === String(vehicleId || fallbackVehicleId),
  )

  const road = useRoadRoute(origin, dest)
  const distance = road.distanceKm
  const savedHome = (savedPlaces.data ?? []).find(
    (p) => p.label.trim().toLowerCase() === 'home',
  )
  const savedOffice = (savedPlaces.data ?? []).find(
    (p) => p.label.trim().toLowerCase() === 'office',
  )

  const suggestedFare = distance > 0.2 ? Math.max(1, Math.round(distance * 8)) : 0
  const parsedFare = fare.trim() === '' ? NaN : Number(fare)
  const fareValid =
    fare.trim() === ''
      ? suggestedFare > 0
      : Number.isFinite(parsedFare) && parsedFare > 0
  const effectiveFare =
    fare.trim() !== '' && Number.isFinite(parsedFare) && parsedFare > 0
      ? parsedFare
      : suggestedFare

  function handleMapClick(p: LatLng) {
    if (pickMode === 'origin') {
      setOrigin(p)
      setPickMode('dest')
      void reverseGeocode(p).then((label) => {
        if (label) setOriginLabel(label)
      })
    } else {
      setDest(p)
      void reverseGeocode(p).then((label) => {
        if (label) setDestLabel(label)
      })
    }
  }

  function applySaved(place: Place) {
    const coords = { lat: Number(place.lat), lng: Number(place.lng) }
    if (pickMode === 'origin') {
      setOrigin(coords)
      setOriginLabel(place.address || place.label)
      setPickMode('dest')
      return
    }
    setDest(coords)
    setDestLabel(place.address || place.label)
  }

  function applyCommute(direction: 'to_office' | 'to_home') {
    if (!savedHome || !savedOffice) return
    const from = direction === 'to_office' ? savedHome : savedOffice
    const to = direction === 'to_office' ? savedOffice : savedHome
    setOrigin({ lat: Number(from.lat), lng: Number(from.lng) })
    setOriginLabel(from.address || from.label)
    setDest({ lat: Number(to.lat), lng: Number(to.lng) })
    setDestLabel(to.address || to.label)
    setPickMode('dest')
  }

  function toggleDay(day: number) {
    setRepeatDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    )
  }

  const markers = [
    ...(origin ? [{ ...origin, kind: 'origin' as const }] : []),
    ...(dest ? [{ ...dest, kind: 'dest' as const }] : []),
  ]

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!origin || !dest) {
      setError('Set pickup and destination (type a place or click the map).')
      return
    }
    if (distance < 0.2) {
      setError('Pickup and destination are too close. Set a real route.')
      return
    }
    if (!selectedVehicle) {
      setError('Select a vehicle to offer this ride.')
      return
    }
    if (!date || !time) {
      setError('Choose a departure date and time.')
      return
    }
    const departureIso = new Date(`${date}T${time}`)
    if (Number.isNaN(departureIso.getTime())) {
      setError('That date/time is invalid.')
      return
    }
    if (departureIso.getTime() < Date.now()) {
      setError('Departure must be in the future.')
      return
    }
    if (!fareValid || effectiveFare <= 0) {
      setError('Fare per seat must be greater than zero.')
      return
    }
    if (seats > selectedVehicle.seating_capacity) {
      setError(
        `${selectedVehicle.model} only seats ${selectedVehicle.seating_capacity}. Lower the seat count.`,
      )
      return
    }
    if (recurring && repeatDays.length === 0) {
      setError('Pick at least one weekday for recurring rides.')
      return
    }

    setError(null)
    setSubmitting(true)
    try {
      const recurrenceRule = recurring
        ? `FREQ=WEEKLY;BYDAY=${repeatDays.map((d) => RRULE_DAYS[d]).join(',')}`
        : null
      const { data } = await api.post('/rides', {
        vehicle_id: selectedVehicle.id,
        origin: originLabel || 'Pickup',
        origin_lat: origin.lat,
        origin_lng: origin.lng,
        destination: destLabel || 'Destination',
        dest_lat: dest.lat,
        dest_lng: dest.lng,
        departure_time: departureIso.toISOString(),
        total_seats: seats,
        fare_per_seat: effectiveFare,
        distance_km: distance || null,
        route_polyline: road.path ? encodeRoutePath(road.path) : null,
        is_recurring: recurring,
        recurrence_rule: recurrenceRule,
      })
      toast.success('Ride published.')
      navigate(`/trips/${data.id ?? ''}`)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response
        ?.data?.detail
      const msg =
        typeof detail === 'string'
          ? detail
          : 'Could not publish the ride — check your details and try again.'
      setError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  if (gated || vehicles.loading || docs.loading) {
    return (
      <div>
        <PageHeader
          eyebrow="03 / Offer a Ride"
          title="Host a trip"
          description="Finish driver setup first — then publish your commute."
        />
        <OfferGate
          loading={vehicles.loading || docs.loading}
          licenceOk={hasVerifiedLicence}
          rcOk={hasVerifiedRc}
          insuranceOk={hasVerifiedInsurance}
          vehicleOk={activeVehicles.length > 0}
        />
        <p className="font-mono text-[12px] text-g-500">
          Need a seat instead?{' '}
          <Link to="/find" className="link-underline text-ink">
            Find a ride
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="03 / Offer a Ride"
        title="Host a trip"
        description="Publish your route and let colleagues book the empty seats."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Card>
            <form onSubmit={onSubmit} className="space-y-5">
              <Select
                label="Vehicle"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                disabled={activeVehicles.length === 0}
                required
              >
                <option value="">
                  {activeVehicles.length === 0
                    ? 'No vehicles available'
                    : 'Select vehicle'}
                </option>
                {activeVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.model} · {v.reg_number} · {v.seating_capacity} seats
                    {v.mileage_kmpl ? ` · ${v.mileage_kmpl} km/l` : ''}
                  </option>
                ))}
              </Select>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPickMode('origin')}
                  className={`flex-1 rounded-[10px] border px-3 py-2 font-mono text-[11px] uppercase tracking-eyebrow ${
                    pickMode === 'origin'
                      ? 'border-ink bg-ink text-paper'
                      : 'border-line-strong text-ink'
                  }`}
                >
                  A · Origin
                </button>
                <button
                  type="button"
                  onClick={() => setPickMode('dest')}
                  className={`flex-1 rounded-[10px] border px-3 py-2 font-mono text-[11px] uppercase tracking-eyebrow ${
                    pickMode === 'dest'
                      ? 'border-ink bg-ink text-paper'
                      : 'border-line-strong text-ink'
                  }`}
                >
                  B · Destination
                </button>
              </div>
              <CommutePresets
                home={savedHome}
                office={savedOffice}
                onCommute={applyCommute}
              />
              {(savedHome || savedOffice) && (
                <div className="flex flex-wrap gap-2">
                  {savedHome && (
                    <button
                      type="button"
                      onClick={() => applySaved(savedHome)}
                      className="min-h-11 rounded-[8px] border border-line-strong px-3 py-1.5 font-mono text-[11px] uppercase tracking-eyebrow hover:border-ink"
                    >
                      Use Home for {pickMode === 'origin' ? 'origin' : 'destination'}
                    </button>
                  )}
                  {savedOffice && (
                    <button
                      type="button"
                      onClick={() => applySaved(savedOffice)}
                      className="min-h-11 rounded-[8px] border border-line-strong px-3 py-1.5 font-mono text-[11px] uppercase tracking-eyebrow hover:border-ink"
                    >
                      Use Office for {pickMode === 'origin' ? 'origin' : 'destination'}
                    </button>
                  )}
                </div>
              )}

              <PlacesAutocomplete
                label="Origin"
                value={originLabel}
                onChange={setOriginLabel}
                onPlace={({ label: lbl, coords }) => {
                  setOriginLabel(lbl)
                  setOrigin(coords)
                  setPickMode('dest')
                }}
                placeholder="Start typing a place…"
                hint={
                  origin
                    ? `${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)}`
                    : 'Uses your location by default'
                }
              />
              <PlacesAutocomplete
                label="Destination"
                value={destLabel}
                onChange={setDestLabel}
                onPlace={({ label: lbl, coords }) => {
                  setDestLabel(lbl)
                  setDest(coords)
                }}
                placeholder="Start typing a place…"
                hint={
                  dest
                    ? `${dest.lat.toFixed(4)}, ${dest.lng.toFixed(4)}`
                    : 'Select a suggestion or click the map'
                }
              />

              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Date"
                  type="date"
                  required
                  min={todayLocalDate()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <Input
                  label="Time"
                  type="time"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
              <div className="rounded-[10px] border border-line px-3.5 py-3">
                <label className="mb-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={recurring}
                    onChange={(e) => setRecurring(e.target.checked)}
                  />
                  <span className="eyebrow">Recurring ride</span>
                </label>
                <p className="font-mono text-[10px] text-g-500">
                  When enabled, upcoming rides are auto-generated for the next 4 weeks.
                </p>
                {recurring && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {WEEKDAYS.map((day, idx) => {
                      const on = repeatDays.includes(idx)
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => toggleDay(idx)}
                          className={`rounded-[8px] border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-eyebrow ${
                            on
                              ? 'border-ink bg-ink text-paper'
                              : 'border-line-strong text-ink'
                          }`}
                        >
                          {day}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Select
                  label="Seats offered"
                  value={seats}
                  onChange={(e) => setSeats(Number(e.target.value))}
                >
                  {Array.from(
                    { length: selectedVehicle?.seating_capacity ?? 6 },
                    (_, i) => i + 1,
                  ).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Fare / seat"
                  type="number"
                  min={1}
                  step="1"
                  value={fare}
                  onChange={(e) => setFare(e.target.value)}
                  placeholder={suggestedFare ? String(suggestedFare) : 'e.g. 120'}
                  error={!fareValid ? 'Fare must be greater than zero.' : undefined}
                />
              </div>

              {error && (
                <div className="rounded-[10px] border border-danger/40 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
                  {error}
                </div>
              )}

              <Button type="submit" block size="lg" disabled={gated || submitting}>
                {submitting ? 'Publishing…' : 'Publish ride →'}
              </Button>
            </form>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <MapView
            center={origin ?? geo.coords ?? DEFAULT_MAP_CENTER}
            markers={markers}
            route={road.path}
            altRoutes={road.options.map((o) => ({
              id: o.id,
              path: o.path,
              label: `${o.distanceKm.toFixed(1)} km`,
            }))}
            selectedRouteId={road.selectedId}
            onSelectRoute={road.selectRoute}
            onClick={handleMapClick}
            height={340}
          />
          {origin && dest && (
            <Card inverted className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="eyebrow !text-g-400">
                    {road.loading ? 'Finding road route…' : 'Road distance'}
                  </div>
                  <div className="numeral mt-1 text-3xl">
                    {distance > 0 ? distance.toFixed(1) : '—'}{' '}
                    <span className="font-mono text-sm text-g-300">km</span>
                  </div>
                  {road.durationMin > 0 && (
                    <div className="mt-1 font-mono text-[11px] text-g-400">
                      ~{road.durationMin} min · shortest path preferred
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="eyebrow !text-g-400">Suggested fare</div>
                  <div className="numeral mt-1 text-3xl">
                    {effectiveFare > 0 ? money(effectiveFare) : '—'}
                  </div>
                </div>
              </div>
              {road.options.length > 1 && (
                <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
                  {road.options.map((o, i) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => road.selectRoute(o.id)}
                      className={`rounded-[8px] border px-3 py-1.5 font-mono text-[11px] uppercase tracking-eyebrow ${
                        o.id === road.selectedId
                          ? 'border-paper bg-paper text-ink'
                          : 'border-white/20 text-g-300 hover:border-paper/60'
                      }`}
                    >
                      {o.recommended || i === 0 ? 'Best ' : 'Alt '}
                      {o.distanceKm.toFixed(1)} km · {o.durationMin} min
                    </button>
                  ))}
                </div>
              )}
              {road.error && (
                <p className="font-mono text-[11px] text-g-400">{road.error}</p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

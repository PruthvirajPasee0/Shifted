import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import Button from '../components/Button'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import EmptyState from '../components/EmptyState'
import CommutePresets from '../components/CommutePresets'
import PolicyNote from '../components/PolicyNote'
import { Input, Select } from '../components/Field'
import MapView, { type LatLng } from '../components/MapView'
import PlacesAutocomplete from '../components/PlacesAutocomplete'
import { useGeolocation, reverseGeocode } from '../lib/useGeolocation'
import { useRoadRoute } from '../lib/useRoadRoute'
import { DEFAULT_MAP_CENTER } from '../lib/googleMaps'
import api from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { useToast } from '../context/ToastContext'
import type { Place, RatingSummary, RideMatch } from '../types'
import { money, dateLabel, timeLabel } from '../lib/format'

type PickMode = 'origin' | 'dest'

export default function FindRide() {
  const navigate = useNavigate()
  const toast = useToast()
  const geo = useGeolocation(true)
  const [origin, setOrigin] = useState<LatLng | null>(null)
  const [dest, setDest] = useState<LatLng | null>(null)
  const [originLabel, setOriginLabel] = useState('')
  const [destLabel, setDestLabel] = useState('')
  const [pickMode, setPickMode] = useState<PickMode>('origin')
  const [date, setDate] = useState('')
  const [seats, setSeats] = useState(1)
  const [geoApplied, setGeoApplied] = useState(false)

  const [results, setResults] = useState<RideMatch[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bookingId, setBookingId] = useState<string | null>(null)
  const [bookError, setBookError] = useState<string | null>(null)
  const [confirmMatch, setConfirmMatch] = useState<RideMatch | null>(null)
  const [driverRatings, setDriverRatings] = useState<Record<string, RatingSummary>>({})
  const savedPlaces = useAsync<Place[]>(
    () => api.get('/places').then((r) => r.data),
    [],
  )

  useEffect(() => {
    if (!geo.ready || geoApplied || origin) return
    setOrigin(geo.coords)
    setGeoApplied(true)
    void reverseGeocode(geo.coords).then((label) => {
      if (label) setOriginLabel(label)
    })
  }, [geo.ready, geo.coords, geoApplied, origin])

  const road = useRoadRoute(origin, dest)
  const distance = road.distanceKm
  const savedHome = (savedPlaces.data ?? []).find(
    (p) => p.label.trim().toLowerCase() === 'home',
  )
  const savedOffice = (savedPlaces.data ?? []).find(
    (p) => p.label.trim().toLowerCase() === 'office',
  )

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

  const markers = [
    ...(origin ? [{ ...origin, kind: 'origin' as const, label: 'Pickup' }] : []),
    ...(dest ? [{ ...dest, kind: 'dest' as const, label: 'Drop' }] : []),
  ]

  async function onSearch(e: FormEvent) {
    e.preventDefault()
    if (!origin || !dest) {
      setError('Set both pickup and destination (type a place or click the map).')
      return
    }
    setError(null)
    setSearching(true)
    try {
      const { data } = await api.get<RideMatch[]>('/rides/search', {
        params: {
          origin_lat: origin.lat,
          origin_lng: origin.lng,
          dest_lat: dest.lat,
          dest_lng: dest.lng,
          date: date || undefined,
          seats,
        },
      })
      setResults(data)
      const ids = Array.from(new Set(data.map((m) => String(m.driver.id))))
      if (ids.length > 0) {
        const rows = await Promise.all(
          ids.map(async (uid) => {
            const { data } = await api.get<RatingSummary>(`/ratings/users/${uid}/summary`)
            return [uid, data] as const
          }),
        )
        const next: Record<string, RatingSummary> = {}
        for (const [uid, summary] of rows) next[uid] = summary
        setDriverRatings(next)
      } else {
        setDriverRatings({})
      }
    } catch {
      setResults([])
      setDriverRatings({})
      setError('Could not reach the ride service. Showing no matches.')
    } finally {
      setSearching(false)
    }
  }

  async function confirmBooking() {
    const match = confirmMatch
    if (!match) return
    if (seats > match.ride.available_seats) {
      setBookError('Not enough seats left on this ride.')
      return
    }
    setBookError(null)
    setBookingId(String(match.ride.id))
    try {
      await api.post('/bookings', {
        ride_id: match.ride.id,
        seats,
        pickup_lat: origin?.lat,
        pickup_lng: origin?.lng,
        drop_lat: dest?.lat,
        drop_lng: dest?.lng,
      })
      toast.success('Seat booked.')
      setConfirmMatch(null)
      navigate(`/trips/${match.ride.id}`)
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail
      setBookError(detail ?? 'Booking failed — please try again.')
      toast.error(detail ?? 'Booking failed')
    } finally {
      setBookingId(null)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="02 / Find a Ride"
        title="Where to?"
        description="Search by place name or map pin and match with verified colleagues heading your way."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="order-2 lg:order-1 lg:col-span-2">
          <Card>
            <form id="find-ride-form" onSubmit={onSearch} className="space-y-5">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPickMode('origin')}
                  className={`min-h-11 flex-1 rounded-[10px] border px-3 py-2 font-mono text-[11px] uppercase tracking-eyebrow ${
                    pickMode === 'origin'
                      ? 'border-ink bg-ink text-paper'
                      : 'border-line-strong text-ink'
                  }`}
                >
                  A · Set pickup
                </button>
                <button
                  type="button"
                  onClick={() => setPickMode('dest')}
                  className={`min-h-11 flex-1 rounded-[10px] border px-3 py-2 font-mono text-[11px] uppercase tracking-eyebrow ${
                    pickMode === 'dest'
                      ? 'border-ink bg-ink text-paper'
                      : 'border-line-strong text-ink'
                  }`}
                >
                  B · Set drop
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
                      Use Home for {pickMode === 'origin' ? 'pickup' : 'drop'}
                    </button>
                  )}
                  {savedOffice && (
                    <button
                      type="button"
                      onClick={() => applySaved(savedOffice)}
                      className="min-h-11 rounded-[8px] border border-line-strong px-3 py-1.5 font-mono text-[11px] uppercase tracking-eyebrow hover:border-ink"
                    >
                      Use Office for {pickMode === 'origin' ? 'pickup' : 'drop'}
                    </button>
                  )}
                </div>
              )}

              <PlacesAutocomplete
                label="Pickup"
                placeholder="e.g. Koramangala"
                value={originLabel}
                onChange={setOriginLabel}
                onPlace={({ label: lbl, coords }) => {
                  setOriginLabel(lbl)
                  setOrigin(coords)
                  setPickMode('dest')
                }}
                hint={
                  origin
                    ? `${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)}`
                    : 'Uses your location by default'
                }
              />
              <PlacesAutocomplete
                label="Destination"
                placeholder="e.g. Whitefield"
                value={destLabel}
                onChange={setDestLabel}
                onPlace={({ label: lbl, coords }) => {
                  setDestLabel(lbl)
                  setDest(coords)
                }}
                hint={
                  dest
                    ? `${dest.lat.toFixed(4)}, ${dest.lng.toFixed(4)}`
                    : 'Select a suggestion or click the map'
                }
              />

              <Input
                label="Date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />

              <Select
                label="Seats"
                value={seats}
                onChange={(e) => setSeats(Number(e.target.value))}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} passenger{n > 1 ? 's' : ''}
                  </option>
                ))}
              </Select>

              {error && (
                <div className="rounded-[10px] border border-danger/40 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
                  {error}
                </div>
              )}

              <Button type="submit" block size="lg" disabled={searching} className="hidden sm:flex">
                {searching ? 'Searching…' : 'Search rides →'}
              </Button>
            </form>
          </Card>
        </div>

        <div className="order-1 lg:order-2 lg:col-span-3">
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
            height={320}
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
                      ~{road.durationMin} min drive
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="eyebrow !text-g-400">Est. fare / seat</div>
                  <div className="numeral mt-1 text-3xl">
                    {distance > 0
                      ? money(Math.max(1, Math.round(distance * 8)))
                      : '—'}
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
            </Card>
          )}
        </div>
      </div>

      {results && (
        <div className="mt-10">
          <div className="mb-4 eyebrow">Matches · {results.length}</div>
          {bookError && (
            <div className="mb-4 rounded-[10px] border border-danger/40 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
              {bookError}
            </div>
          )}
          {results.length === 0 ? (
            <Card padded={false}>
              <EmptyState
                title="No matching rides"
                description="Try another date, widen your pins, or offer a ride for colleagues on your route."
                actionLabel="Offer a ride"
                actionTo="/offer"
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {results.map((m) => {
                const full = m.ride.available_seats < seats
                const rating = driverRatings[String(m.driver.id)]
                return (
                  <Card key={m.ride.id} className="flex flex-col justify-between !p-0 overflow-hidden">
                    <div className="border-b border-line bg-paper-raised px-5 py-4">
                      <div className="font-mono text-[12px] font-medium text-brand-strong">
                        {timeLabel(m.ride.departure_time)}
                        <span className="text-g-400"> · </span>
                        {dateLabel(m.ride.departure_time)}
                      </div>
                      <div className="mt-2 font-display text-xl font-semibold leading-snug">
                        {m.ride.origin}
                        <span className="mx-1.5 text-g-400">→</span>
                        {m.ride.destination}
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col px-5 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-body text-[15px] font-medium">{m.driver.name}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-g-500">
                            {m.vehicle.model}
                            {rating?.total_ratings
                              ? ` · ${rating.average_stars.toFixed(1)}★ (${rating.total_ratings})`
                              : ' · New driver'}
                          </div>
                        </div>
                        <StatusBadge status={m.ride.status} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-g-500">
                        <span>{m.ride.available_seats} seats left</span>
                        <span>{Math.round(m.match_score)}% match</span>
                        <span>Pickup {m.origin_distance_km.toFixed(1)} km</span>
                      </div>
                      <div className="mt-auto flex items-end justify-between gap-3 pt-5">
                        <div>
                          <div className="eyebrow">Per seat</div>
                          <div className="numeral text-3xl">{money(m.ride.fare_per_seat)}</div>
                        </div>
                        <Button
                          size="lg"
                          onClick={() => setConfirmMatch(m)}
                          disabled={full || bookingId === String(m.ride.id)}
                        >
                          {full ? 'Full' : 'Book seat'}
                        </Button>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      <Modal
        open={Boolean(confirmMatch)}
        onClose={() => setConfirmMatch(null)}
        title="Confirm booking"
        footer={
          confirmMatch ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setConfirmMatch(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => void confirmBooking()}
                disabled={bookingId === String(confirmMatch.ride.id)}
              >
                {bookingId === String(confirmMatch.ride.id) ? 'Booking…' : 'Confirm book'}
              </Button>
            </div>
          ) : null
        }
      >
        {confirmMatch && (
          <div className="space-y-4">
            <p className="font-body text-[14px] text-ink-soft">
              You will be confirmed on this ride immediately. Cancel anytime before the trip starts.
            </p>
            <PolicyNote />
            <div className="rounded-[10px] border border-line bg-paper px-4 py-3 font-mono text-[12px]">
              <div>
                {confirmMatch.ride.origin} → {confirmMatch.ride.destination}
              </div>
              <div className="mt-2 text-g-500">
                {dateLabel(confirmMatch.ride.departure_time)} ·{' '}
                {timeLabel(confirmMatch.ride.departure_time)}
              </div>
              <div className="mt-2 text-g-500">
                {confirmMatch.driver.name} · {seats} seat(s) ·{' '}
                {money(confirmMatch.ride.fare_per_seat * seats)} total
              </div>
              {driverRatings[String(confirmMatch.driver.id)]?.total_ratings ? (
                <div className="mt-2 text-g-500">
                  Rating{' '}
                  {driverRatings[String(confirmMatch.driver.id)].average_stars.toFixed(1)}★
                </div>
              ) : null}
            </div>
            {bookError && (
              <div className="rounded-[10px] border border-danger/30 bg-danger-soft px-3 py-2 font-mono text-[12px] text-danger">
                {bookError}
              </div>
            )}
          </div>
        )}
      </Modal>

      {!confirmMatch && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 p-3 backdrop-blur-md sm:hidden">
          <Button
            type="submit"
            form="find-ride-form"
            block
            size="lg"
            disabled={searching || !origin || !dest}
          >
            {searching ? 'Searching…' : 'Search rides →'}
          </Button>
        </div>
      )}
      <div className="h-20 sm:hidden" aria-hidden />
    </div>
  )
}

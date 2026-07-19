import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import Button from '../components/Button'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import { Input, Select } from '../components/Field'
import MapView, { type MapMarker } from '../components/MapView'
import { useAsync } from '../lib/useAsync'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import PolicyNote from '../components/PolicyNote'
import TripChat from '../components/TripChat'
import api, { TOKEN_KEY, wsUrl } from '../lib/api'
import { decodeRoutePath } from '../lib/routing'
import { useRoadRoute } from '../lib/useRoadRoute'
import { openRazorpayCheckout } from '../lib/razorpay'
import type {
  Booking,
  Message,
  PayMethod,
  Payment,
  Rating,
  RatingSummary,
  RazorpayOrder,
  Ride,
  RideDetail,
  RideLocation,
} from '../types'
import { money, dateLabel, timeLabel } from '../lib/format'

const TIMELINE: { key: string; label: string }[] = [
  { key: 'booked', label: 'Booked' },
  { key: 'started', label: 'Started' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'paid', label: 'Payment' },
]

const PAY_METHODS: { label: string; value: PayMethod }[] = [
  { label: 'Wallet — instant', value: 'wallet' },
  { label: 'Razorpay — UPI / Card', value: 'upi' },
  { label: 'Cash — driver confirms', value: 'cash' },
]

const LOC_POLL_MS = 5000
const GPS_PUSH_MS = 8000
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const RRULE_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

interface SeriesException {
  id: string | number
  template_ride_id: string | number
  exception_date: string
  kind: string
  reason?: string | null
}

type TripPanel = 'ops' | 'participants' | 'info'

function stageIndex(status: string, paid: boolean): number {
  if (paid) return 4
  switch (status) {
    case 'started':
      return 1
    case 'in_progress':
      return 2
    case 'completed':
      return 3
    default:
      return 0
  }
}

function errDetail(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data
    ?.detail
  return typeof detail === 'string' ? detail : fallback
}

/** Dedupe by id; swap optimistic tmp-* twins for the real server message. */
function mergeChatMessage(prev: Message[], msg: Message): Message[] {
  if (prev.some((m) => String(m.id) === String(msg.id))) return prev
  const withoutOptimistic = prev.filter(
    (m) =>
      !(
        String(m.id).startsWith('tmp-') &&
        String(m.sender_id) === String(msg.sender_id) &&
        m.body === msg.body
      ),
  )
  return [...withoutOptimistic, msg]
}

function parseRecurrence(rule: string | null | undefined): number[] {
  if (!rule) return []
  let parts: string[] = []
  const upper = rule.toUpperCase()
  const byDayToken = upper.split(';').find((p) => p.startsWith('BYDAY='))
  if (byDayToken) {
    parts = byDayToken
      .slice('BYDAY='.length)
      .split(',')
      .map((p) => p.trim().toUpperCase())
      .filter(Boolean)
  } else {
    const raw = upper.includes(':') ? upper.split(':', 2)[1] : upper
    parts = raw.split(',').map((p) => p.trim().toUpperCase()).filter(Boolean)
  }
  const out: number[] = []
  for (const part of parts) {
    const rruleIdx = RRULE_DAYS.findIndex((d) => d === part)
    if (rruleIdx >= 0) {
      out.push(rruleIdx)
      continue
    }
    const idx = WEEKDAYS.findIndex((d) => d.toUpperCase() === part.slice(0, 3))
    if (idx >= 0) out.push(idx)
  }
  return Array.from(new Set(out)).sort((a, b) => a - b)
}

function toRule(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  return `FREQ=WEEKLY;BYDAY=${sorted.map((d) => RRULE_DAYS[d]).join(',')}`
}

export default function TripDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const toast = useToast()

  const ride = useAsync<RideDetail>(
    () => api.get(`/rides/${id}`).then((r) => r.data),
    [id],
  )
  const [vehicleLoc, setVehicleLoc] = useState<RideLocation | null>(null)
  const [locUpdatedAt, setLocUpdatedAt] = useState<string | null>(null)
  const myBookings = useAsync<Booking[]>(
    () => api.get('/bookings/mine').then((r) => r.data),
    [id],
  )
  const isDriver = ride.data?.driver_id != null && String(ride.data.driver_id) === String(user?.id)
  const rideBookings = useAsync<Booking[]>(
    () =>
      isDriver
        ? api.get<Booking[]>(`/rides/${id}/bookings`).then((r) => r.data)
        : Promise.resolve([]),
    [id, isDriver],
  )

  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [payMethod, setPayMethod] = useState<PayMethod>('wallet')
  const [payment, setPayment] = useState<Payment | null>(null)
  const [rideRatings, setRideRatings] = useState<Rating[]>([])
  const [myRideRatings, setMyRideRatings] = useState<Rating[]>([])
  const [ratingOpen, setRatingOpen] = useState(false)
  const [rateeId, setRateeId] = useState<string | null>(null)
  const [stars, setStars] = useState(5)
  const [comment, setComment] = useState('')
  const [ratingBusy, setRatingBusy] = useState(false)
  const [ratingSummaries, setRatingSummaries] = useState<Record<string, RatingSummary>>({})
  const [seriesRide, setSeriesRide] = useState<Ride | null>(null)
  const [seriesBusy, setSeriesBusy] = useState(false)
  const [seriesOpen, setSeriesOpen] = useState(false)
  const [seriesTime, setSeriesTime] = useState('')
  const [seriesSeats, setSeriesSeats] = useState<string>('')
  const [seriesFare, setSeriesFare] = useState<string>('')
  const [seriesDays, setSeriesDays] = useState<number[]>([])
  const [seriesUpcoming, setSeriesUpcoming] = useState<Ride[]>([])
  const [seriesExceptions, setSeriesExceptions] = useState<SeriesException[]>([])
  const [seriesSkipDate, setSeriesSkipDate] = useState('')
  const [seriesSkipReason, setSeriesSkipReason] = useState('')
  const [tripPanel, setTripPanel] = useState<TripPanel>('ops')
  const [chatOpen, setChatOpen] = useState(false)
  const [peerId, setPeerId] = useState<string | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)
  const [wsStatus, setWsStatus] = useState<'off' | 'connecting' | 'live'>('off')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const r = ride.data
  const myBooking = useMemo(
    () => (myBookings.data ?? []).find((b) => String(b.ride_id) === String(id)),
    [myBookings.data, id],
  )
  const paid = myBooking?.status === 'completed' || payment?.status === 'success'
  const cashPending =
    payment?.method === 'cash' && payment?.status === 'pending' && !paid
  const stage = r ? stageIndex(r.status, paid) : 0
  const trackingActive = r?.status === 'started' || r?.status === 'in_progress'

  const chatPeers = useMemo(() => {
    if (!r || !user || r.status === 'cancelled') return [] as { id: string; name: string }[]
    if (isDriver) {
      return (rideBookings.data ?? [])
        .filter((b) => b.status !== 'cancelled' && b.status !== 'rejected')
        .map((b) => ({
          id: String(b.passenger_id),
          name: b.passenger?.name ?? `Passenger ${String(b.passenger_id).slice(0, 6)}`,
        }))
    }
    if (myBooking?.status === 'cancelled' || myBooking?.status === 'rejected') return []
    return [{ id: String(r.driver_id), name: r.driver?.name ?? 'Driver' }]
  }, [r, user, isDriver, rideBookings.data, myBooking?.status])

  // Poll live location while trip is active.
  useEffect(() => {
    if (!id || !trackingActive) return
    let active = true
    async function pull() {
      try {
        const { data } = await api.get<RideLocation | null>(`/rides/${id}/locations`)
        if (!active) return
        setVehicleLoc(data)
        setLocUpdatedAt(data?.recorded_at ?? (data ? new Date().toISOString() : null))
      } catch {
        /* ignore transient */
      }
    }
    void pull()
    const t = window.setInterval(pull, LOC_POLL_MS)
    return () => {
      active = false
      window.clearInterval(t)
    }
  }, [id, trackingActive])

  // Driver: push GPS while started / in_progress.
  useEffect(() => {
    if (!id || !isDriver || !trackingActive) return
    if (!navigator.geolocation) return

    let lastPush = 0
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now()
        if (now - lastPush < GPS_PUSH_MS) return
        lastPush = now
        void api
          .post(`/rides/${id}/locations`, {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          })
          .then((res) => {
            setVehicleLoc(res.data)
            setLocUpdatedAt(res.data?.recorded_at ?? new Date().toISOString())
            // First ping may advance started → in_progress.
            if (r?.status === 'started') ride.reload()
          })
          .catch(() => {
            /* GPS push failures are non-fatal */
          })
      },
      () => {
        /* permission denied / unavailable */
      },
      { enableHighAccuracy: true, maximumAge: 5000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [id, isDriver, trackingActive, r?.status, ride])

  // Load payment row for this booking (method + cash pending).
  useEffect(() => {
    if (!myBooking?.id) {
      setPayment(null)
      return
    }
    let active = true
    api
      .get<Payment | null>(`/payments/booking/${myBooking.id}`)
      .then((res) => {
        if (active) setPayment(res.data)
      })
      .catch(() => {
        if (active) setPayment(null)
      })
    return () => {
      active = false
    }
  }, [myBooking?.id, myBooking?.status])

  useEffect(() => {
    if (!id) return
    let active = true
    api
      .get<Rating[]>(`/ratings/ride/${id}`)
      .then((res) => {
        if (active) setRideRatings(res.data)
      })
      .catch(() => {
        if (active) setRideRatings([])
      })
    api
      .get<Rating[]>(`/ratings/ride/${id}/mine`)
      .then((res) => {
        if (active) setMyRideRatings(res.data)
      })
      .catch(() => {
        if (active) setMyRideRatings([])
      })
    return () => {
      active = false
    }
  }, [id])

  useEffect(() => {
    if (!id || !isDriver) {
      setSeriesRide(null)
      setSeriesUpcoming([])
      setSeriesExceptions([])
      setSeriesSkipDate('')
      setSeriesSkipReason('')
      return
    }
    let active = true
    async function loadSeries() {
      try {
        const [seriesRes, upcomingRes, exceptionsRes] = await Promise.all([
          api.get<Ride>(`/rides/${id}/series`),
          api.get<Ride[]>(`/rides/${id}/series/upcoming`),
          api.get<SeriesException[]>(`/rides/${id}/series/exceptions`),
        ])
        if (!active) return
        setSeriesRide(seriesRes.data)
        const dep = new Date(seriesRes.data.departure_time)
        setSeriesTime(
          `${String(dep.getHours()).padStart(2, '0')}:${String(dep.getMinutes()).padStart(2, '0')}`,
        )
        setSeriesSeats(String(seriesRes.data.total_seats))
        setSeriesFare(String(seriesRes.data.fare_per_seat))
        setSeriesDays(parseRecurrence(seriesRes.data.recurrence_rule))
        setSeriesUpcoming(upcomingRes.data)
        setSeriesExceptions(exceptionsRes.data)
        const skipped = new Set(exceptionsRes.data.map((x) => x.exception_date))
        const nextSkippable = upcomingRes.data.find(
          (x) => x.status === 'scheduled' && !skipped.has(String(x.departure_time).slice(0, 10)),
        )
        if (nextSkippable) {
          setSeriesSkipDate(String(nextSkippable.departure_time).slice(0, 10))
        } else {
          setSeriesSkipDate('')
        }
      } catch {
        if (!active) return
        setSeriesRide(null)
        setSeriesUpcoming([])
        setSeriesExceptions([])
      }
    }
    void loadSeries()
    return () => {
      active = false
    }
  }, [id, isDriver])

  useEffect(() => {
    const ids = new Set<string>()
    if (r?.driver_id != null) ids.add(String(r.driver_id))
    for (const b of rideBookings.data ?? []) ids.add(String(b.passenger_id))
    if (ids.size === 0) {
      setRatingSummaries({})
      return
    }
    let active = true
    Promise.all(
      [...ids].map(async (uid) => {
        const { data } = await api.get<RatingSummary>(`/ratings/users/${uid}/summary`)
        return [uid, data] as const
      }),
    )
      .then((rows) => {
        if (!active) return
        const next: Record<string, RatingSummary> = {}
        for (const [uid, summary] of rows) next[uid] = summary
        setRatingSummaries(next)
      })
      .catch(() => {
        if (active) setRatingSummaries({})
      })
    return () => {
      active = false
    }
  }, [r?.driver_id, rideBookings.data])

  useEffect(() => {
    if (!chatOpen) return
    if (peerId && chatPeers.some((p) => p.id === peerId)) return
    setPeerId(chatPeers[0]?.id ?? null)
  }, [chatOpen, chatPeers, peerId])

  // Load personal thread + keep a live WebSocket while chat is open.
  useEffect(() => {
    if (!chatOpen || !id || !peerId) {
      wsRef.current?.close()
      wsRef.current = null
      setWsStatus('off')
      return
    }

    let active = true
    let reconnectTimer: number | null = null
    let pingTimer: number | null = null
    let attempt = 0

    setChatError(null)
    api
      .get<Message[]>(`/rides/${id}/messages`, { params: { peer_id: peerId } })
      .then((res) => {
        if (active) setMessages(res.data)
      })
      .catch(() => {
        if (active) {
          setMessages([])
          setChatError('Could not load messages.')
        }
      })

    function clearTimers() {
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer)
      if (pingTimer != null) window.clearInterval(pingTimer)
      reconnectTimer = null
      pingTimer = null
    }

    function connectWs() {
      const token = localStorage.getItem(TOKEN_KEY)
      if (!token) {
        setChatError('Sign in again to use live chat.')
        setWsStatus('off')
        return
      }

      setWsStatus('connecting')
      // Auth via first JSON frame — token stays out of the URL.
      const url = wsUrl(`/ws/rides/${id}/chat`, { peer_id: String(peerId) })
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (!active) return
        ws.send(JSON.stringify({ type: 'auth', token }))
      }

      ws.onmessage = (ev) => {
        if (!active) return
        try {
          const packet = JSON.parse(ev.data as string) as {
            type?: string
            data?: Message
          }
          if (packet.type === 'ready') {
            attempt = 0
            setWsStatus('live')
            setChatError(null)
            return
          }
          if (packet.type === 'message' && packet.data) {
            setMessages((prev) => mergeChatMessage(prev, packet.data as Message))
          }
        } catch {
          /* ignore malformed */
        }
      }

      ws.onerror = () => {
        if (active) setWsStatus('off')
      }

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null
        if (!active) return
        setWsStatus('off')
        // Auto-reconnect while the chat panel stays open.
        attempt += 1
        const delay = Math.min(1000 * 2 ** Math.min(attempt, 4), 15000)
        reconnectTimer = window.setTimeout(() => {
          if (active) connectWs()
        }, delay)
      }

      if (pingTimer != null) window.clearInterval(pingTimer)
      pingTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping')
      }, 25000)
    }

    connectWs()

    return () => {
      active = false
      clearTimers()
      const ws = wsRef.current
      wsRef.current = null
      if (ws) {
        ws.onclose = null
        ws.close()
      }
    }
  }, [chatOpen, id, peerId])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const markers: MapMarker[] = r
    ? [
        { lat: r.origin_lat, lng: r.origin_lng, kind: 'origin' },
        { lat: r.dest_lat, lng: r.dest_lng, kind: 'dest' },
        ...(vehicleLoc
          ? [{ lat: vehicleLoc.lat, lng: vehicleLoc.lng, kind: 'vehicle' as const }]
          : []),
      ]
    : []

  const savedPath = useMemo(
    () => decodeRoutePath(r?.route_polyline),
    [r?.route_polyline],
  )
  const tripOrigin = r
    ? { lat: r.origin_lat, lng: r.origin_lng }
    : null
  const tripDest = r ? { lat: r.dest_lat, lng: r.dest_lng } : null
  const liveRoad = useRoadRoute(savedPath ? null : tripOrigin, savedPath ? null : tripDest)
  const routePath = savedPath ?? liveRoad.path

  async function action(kind: 'start' | 'enroute' | 'complete' | 'cancel') {
    if (busy) return
    setBusy(true)
    setActionError(null)
    try {
      if (kind === 'cancel') {
        await api.post(`/rides/${id}/cancel`, { reason: null })
      } else {
        await api.post(`/rides/${id}/${kind}`)
      }
      ride.reload()
    } catch (err) {
      setActionError(errDetail(err, 'Action failed — please try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function cancelBooking() {
    if (busy || !myBooking) return
    setBusy(true)
    setActionError(null)
    try {
      await api.post(`/bookings/${myBooking.id}/cancel`, { reason: null })
      toast.success('Booking cancelled. Seats released.')
      myBookings.reload()
      ride.reload()
      rideBookings.reload()
    } catch (err) {
      setActionError(errDetail(err, 'Could not cancel booking.'))
    } finally {
      setBusy(false)
    }
  }

  async function pay() {
    if (busy || !myBooking) return
    setBusy(true)
    setActionError(null)
    try {
      if (payMethod === 'upi' || payMethod === 'card') {
        const { data: order } = await api.post<RazorpayOrder>('/payments/order', {
          booking_id: myBooking.id,
          method: payMethod,
        })
        await new Promise<void>((resolve) => {
          void openRazorpayCheckout({
            order,
            name: 'Shifted',
            description: `Ride fare · ${money(myBooking.fare_amount)}`,
            prefill: {
              name: user?.name,
              email: user?.email,
              contact: user?.phone != null ? String(user.phone) : undefined,
            },
            onSuccess: async (resp) => {
              try {
                const { data } = await api.post<Payment>('/payments/verify', {
                  razorpay_order_id: resp.razorpay_order_id,
                  razorpay_payment_id: resp.razorpay_payment_id,
                  razorpay_signature: resp.razorpay_signature,
                })
                setPayment(data)
                myBookings.reload()
                toast.success('Payment successful via Razorpay.')
              } catch (err) {
                setActionError(errDetail(err, 'Payment verification failed.'))
                toast.error(errDetail(err, 'Payment verification failed.'))
              } finally {
                resolve()
              }
            },
            onDismiss: () => resolve(),
          }).catch((err) => {
            const msg =
              err instanceof Error ? err.message : 'Could not open Razorpay checkout.'
            setActionError(msg)
            toast.error(msg)
            resolve()
          })
        })
        return
      }
      const { data } = await api.post<Payment>('/payments', {
        booking_id: myBooking.id,
        method: payMethod,
      })
      setPayment(data)
      myBookings.reload()
      if (payMethod === 'cash') {
        toast.success('Cash marked — waiting for driver to confirm.')
      } else {
        toast.success('Wallet payment successful.')
      }
    } catch (err) {
      setActionError(errDetail(err, 'Payment failed — please try again.'))
      toast.error(errDetail(err, 'Payment failed — please try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function submitRating() {
    if (!id || !rateeId || ratingBusy) return
    setRatingBusy(true)
    setActionError(null)
    try {
      await api.post('/ratings', {
        ride_id: id,
        ratee_id: rateeId,
        stars,
        comment: comment.trim() || null,
      })
      const [allRes, mineRes] = await Promise.all([
        api.get<Rating[]>(`/ratings/ride/${id}`),
        api.get<Rating[]>(`/ratings/ride/${id}/mine`),
      ])
      setRideRatings(allRes.data)
      setMyRideRatings(mineRes.data)
      setRatingOpen(false)
      setComment('')
    } catch (err) {
      setActionError(errDetail(err, 'Could not submit rating.'))
    } finally {
      setRatingBusy(false)
    }
  }

  function toggleSeriesDay(day: number) {
    setSeriesDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    )
  }

  async function reloadSeriesMeta() {
    if (!id) return
    const [upcomingRes, exceptionsRes] = await Promise.all([
      api.get<Ride[]>(`/rides/${id}/series/upcoming`),
      api.get<SeriesException[]>(`/rides/${id}/series/exceptions`),
    ])
    setSeriesUpcoming(upcomingRes.data)
    setSeriesExceptions(exceptionsRes.data)
    const skipped = new Set(exceptionsRes.data.map((x) => x.exception_date))
    const nextSkippable = upcomingRes.data.find(
      (x) => x.status === 'scheduled' && !skipped.has(String(x.departure_time).slice(0, 10)),
    )
    if (!seriesSkipDate || skipped.has(seriesSkipDate)) {
      setSeriesSkipDate(nextSkippable ? String(nextSkippable.departure_time).slice(0, 10) : '')
    }
  }

  async function saveSeries() {
    if (!id || !seriesRide) return
    if (!seriesTime) {
      setActionError('Choose a departure time for series updates.')
      return
    }
    if (seriesDays.length === 0) {
      setActionError('Pick at least one weekday for recurring series.')
      return
    }
    const seatsN = Number(seriesSeats)
    const fareN = Number(seriesFare)
    if (!Number.isFinite(seatsN) || seatsN < 1) {
      setActionError('Series seats must be at least 1.')
      return
    }
    if (!Number.isFinite(fareN) || fareN <= 0) {
      setActionError('Series fare must be greater than 0.')
      return
    }
    const [hh, mm] = seriesTime.split(':').map((x) => Number(x))
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
      setActionError('Invalid series time.')
      return
    }
    const base = new Date(seriesRide.departure_time)
    base.setHours(hh, mm, 0, 0)
    setSeriesBusy(true)
    setActionError(null)
    try {
      const { data } = await api.patch<Ride>(`/rides/${id}/series`, {
        departure_time: base.toISOString(),
        total_seats: seatsN,
        fare_per_seat: fareN,
        recurrence_rule: toRule(seriesDays),
      })
      setSeriesRide(data)
      await reloadSeriesMeta()
      ride.reload()
      setSeriesOpen(false)
    } catch (err) {
      setActionError(errDetail(err, 'Could not update recurring series.'))
    } finally {
      setSeriesBusy(false)
    }
  }

  async function cancelSeries() {
    if (!id || !seriesRide || seriesBusy) return
    if (!window.confirm('Cancel all upcoming rides in this recurring series?')) return
    setSeriesBusy(true)
    setActionError(null)
    try {
      await api.post(`/rides/${id}/series/cancel`, { reason: 'Series cancelled by driver' })
      ride.reload()
      setSeriesOpen(false)
      setSeriesRide(null)
      setSeriesUpcoming([])
      setSeriesExceptions([])
    } catch (err) {
      setActionError(errDetail(err, 'Could not cancel recurring series.'))
    } finally {
      setSeriesBusy(false)
    }
  }

  async function addSeriesSkipDate() {
    if (!id || !seriesRide || !seriesSkipDate || seriesBusy) return
    setSeriesBusy(true)
    setActionError(null)
    try {
      await api.post(`/rides/${id}/series/exceptions/skip`, {
        exception_date: seriesSkipDate,
        reason: seriesSkipReason.trim() || null,
      })
      setSeriesSkipReason('')
      await reloadSeriesMeta()
      ride.reload()
    } catch (err) {
      setActionError(errDetail(err, 'Could not skip this recurring date.'))
    } finally {
      setSeriesBusy(false)
    }
  }

  async function removeSeriesSkipDate(exceptionDate: string) {
    if (!id || seriesBusy) return
    setSeriesBusy(true)
    setActionError(null)
    try {
      await api.delete(`/rides/${id}/series/exceptions/${exceptionDate}`)
      await reloadSeriesMeta()
      ride.reload()
    } catch (err) {
      setActionError(errDetail(err, 'Could not remove skip date.'))
    } finally {
      setSeriesBusy(false)
    }
  }

  async function confirmCash(paymentId: string | number) {
    if (busy) return
    setBusy(true)
    setActionError(null)
    try {
      await api.post(`/payments/${paymentId}/confirm-cash`)
      rideBookings.reload()
      ride.reload()
    } catch (err) {
      setActionError(errDetail(err, 'Could not confirm cash payment.'))
    } finally {
      setBusy(false)
    }
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault()
    if (!draft.trim() || !r || !peerId) return
    if (
      r.status === 'cancelled' ||
      myBooking?.status === 'cancelled' ||
      myBooking?.status === 'rejected'
    ) {
      setChatError('Chat is closed for this trip.')
      return
    }
    const body = draft.trim()
    const optimisticId = `tmp-${Date.now()}`
    const optimistic: Message = {
      id: optimisticId,
      sender_id: user?.id ?? 0,
      receiver_id: peerId,
      sender_name: user?.name,
      body,
      created_at: new Date().toISOString(),
    }
    setDraft('')
    setMessages((m) => [...m, optimistic])
    setChatError(null)
    try {
      const { data } = await api.post<Message>(`/rides/${id}/messages`, {
        body,
        receiver_id: peerId,
      })
      setMessages((m) => {
        const withoutOpt = m.filter((x) => x.id !== optimisticId)
        return mergeChatMessage(withoutOpt, data)
      })
    } catch {
      setMessages((m) => m.filter((x) => x.id !== optimisticId))
      setDraft(body)
      setChatError('Message failed to send.')
    }
  }

  // Only passengers rate the driver — drivers do not rate passengers.
  const ratingTargets = useMemo(() => {
    if (!r || r.status !== 'completed' || isDriver) return [] as { id: string; name: string }[]
    if (!myBooking || myBooking.status === 'cancelled' || myBooking.status === 'rejected') {
      return [] as { id: string; name: string }[]
    }
    return [{ id: String(r.driver_id), name: r.driver?.name ?? 'Driver' }]
  }, [r, isDriver, myBooking])
  const ratedIds = useMemo(
    () => new Set(myRideRatings.map((x) => String(x.ratee_id))),
    [myRideRatings],
  )
  const pendingRatingTargets = ratingTargets.filter((p) => !ratedIds.has(String(p.id)))
  const chatLocked =
    r?.status === 'cancelled' ||
    myBooking?.status === 'cancelled' ||
    myBooking?.status === 'rejected'
  const canChat =
    Boolean(r) &&
    !chatLocked &&
    (isDriver
      ? chatPeers.length > 0
      : Boolean(myBooking && myBooking.status !== 'cancelled' && myBooking.status !== 'rejected'))

  useEffect(() => {
    if (chatLocked && chatOpen) setChatOpen(false)
  }, [chatLocked, chatOpen])

  useEffect(() => {
    if (!chatOpen) return
    const el = document.getElementById('trip-chat')
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [chatOpen])

  const settledMethod = payment?.status === 'success' ? payment.method : null
  const selectedRateeName =
    ratingTargets.find((t) => t.id === rateeId)?.name ?? 'Participant'
  const paymentState = paid
    ? `Paid${settledMethod ? ` · ${settledMethod}` : ''}`
    : cashPending
      ? 'Cash marked — waiting for driver confirm'
      : myBooking && r?.status === 'completed'
        ? `Payment due · ${money(myBooking.fare_amount)}`
        : myBooking?.status === 'booked'
          ? 'Pay after ride completes'
          : 'No payment yet'
  const pendingRatingNames = pendingRatingTargets.map((x) => x.name)
  const showOpsPanel = tripPanel === 'ops'
  const showParticipantsPanel = tripPanel === 'participants'
  const showInfoPanel = tripPanel === 'info'
  const riderCanCancel = !isDriver && myBooking?.status === 'booked' && r?.status === 'scheduled'
  const riderCanPay =
    !isDriver &&
    myBooking?.status === 'booked' &&
    r?.status === 'completed' &&
    !paid &&
    !cashPending
  const driverCanStart = isDriver && r?.status === 'scheduled'
  const driverCanEnroute = isDriver && r?.status === 'started'
  const driverCanComplete = isDriver && (r?.status === 'started' || r?.status === 'in_progress')
  const driverCanCancel = isDriver && r?.status !== 'completed' && r?.status !== 'cancelled'
  const canRate = r?.status === 'completed' && pendingRatingTargets.length > 0
  const showMobileBar = Boolean(
    riderCanCancel || riderCanPay || driverCanStart || driverCanEnroute || driverCanComplete || driverCanCancel || canRate || canChat,
  )

  function openRatingModal() {
    setRateeId(pendingRatingTargets[0]?.id ?? null)
    setStars(5)
    setComment('')
    setRatingOpen(true)
  }

  return (
    <div>
      <PageHeader
        eyebrow={`Trip / #${id}`}
        title={r ? `${r.origin} → ${r.destination}` : 'Trip'}
        description={
          r
            ? `${dateLabel(r.departure_time)} · ${timeLabel(r.departure_time)} · ${money(r.fare_per_seat)} per seat`
            : ride.loading
              ? 'Loading trip…'
              : 'Trip details unavailable.'
        }
        actions={
          r ? (
            <div className="flex items-center gap-2">
              {r.is_recurring && (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 font-mono text-[10px] uppercase tracking-eyebrow text-brand">
                  ↻ Repeats weekly
                </span>
              )}
              <StatusBadge status={paid ? 'paid' : r.status} />
            </div>
          ) : undefined
        }
      />

      <div className="mb-4 flex gap-2 overflow-x-auto lg:hidden">
        <button
          type="button"
          onClick={() => setTripPanel('ops')}
          className={`rounded-[8px] border px-3 py-1.5 font-mono text-[11px] uppercase tracking-eyebrow ${
            showOpsPanel ? 'border-ink bg-ink text-paper' : 'border-line-strong text-ink'
          }`}
        >
          Actions
        </button>
        <button
          type="button"
          onClick={() => setTripPanel('participants')}
          className={`rounded-[8px] border px-3 py-1.5 font-mono text-[11px] uppercase tracking-eyebrow ${
            showParticipantsPanel
              ? 'border-ink bg-ink text-paper'
              : 'border-line-strong text-ink'
          }`}
        >
          People
        </button>
        <button
          type="button"
          onClick={() => setTripPanel('info')}
          className={`rounded-[8px] border px-3 py-1.5 font-mono text-[11px] uppercase tracking-eyebrow ${
            showInfoPanel ? 'border-ink bg-ink text-paper' : 'border-line-strong text-ink'
          }`}
        >
          Trip info
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <MapView
            center={
              vehicleLoc ??
              (r ? { lat: r.origin_lat, lng: r.origin_lng } : undefined)
            }
            markers={markers}
            route={routePath}
            height={360}
          />
          {trackingActive && (
            <p className="mt-2 font-mono text-[11px] text-g-500">
              {vehicleLoc
                ? `Live tracking · last update ${locUpdatedAt ? timeLabel(locUpdatedAt) : 'just now'}`
                : isDriver
                  ? 'Waiting for GPS — allow location access to broadcast your position.'
                  : 'Waiting for driver GPS…'}
            </p>
          )}

          <Card className={`mt-6 ${showOpsPanel ? 'block' : 'hidden'} lg:block`}>
            <div className="eyebrow mb-6">Lifecycle</div>
            <div className="flex items-center justify-between overflow-x-auto pb-1">
              {TIMELINE.map((t, i) => {
                const done = i <= stage
                return (
                  <div key={t.key} className="flex min-w-[56px] flex-1 items-center last:flex-none">
                    <div className="flex flex-col items-center">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-full border font-mono text-[12px] ${
                          done
                            ? 'border-ink bg-ink text-paper'
                            : 'border-line-strong bg-paper-raised text-g-400'
                        }`}
                      >
                        {i + 1}
                      </div>
                      <div className="mt-2 max-w-[64px] text-center font-mono text-[9px] uppercase tracking-eyebrow text-g-500">
                        {t.label}
                      </div>
                    </div>
                    {i < TIMELINE.length - 1 && (
                      <div
                        className={`mx-1 h-[2px] flex-1 ${
                          i < stage ? 'bg-ink' : 'bg-line'
                        }`}
                      />
                    )}
                  </div>
                )
              })}
            </div>

            {actionError && (
              <div className="mt-6 rounded-[10px] border border-danger/40 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
                {actionError}
              </div>
            )}

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div
                className={`rounded-[10px] border px-3 py-2 ${
                  paid
                    ? 'border-success/30 bg-success-soft/50'
                    : cashPending || (myBooking && r?.status === 'completed')
                      ? 'border-warning/40 bg-warning-soft/50'
                      : 'border-line bg-paper-raised'
                }`}
              >
                <div className="eyebrow mb-1">Payment</div>
                <div className="font-body text-[15px] font-medium">{paymentState}</div>
                {myBooking && (
                  <div className="mt-1 font-mono text-[11px] text-g-500">
                    Fare {money(myBooking.fare_amount)}
                    {payment?.method ? ` · method ${payment.method}` : ''}
                  </div>
                )}
              </div>
              <div className="rounded-[10px] border border-line bg-paper-raised px-3 py-2">
                <div className="eyebrow mb-1">Rating state</div>
                {r?.status !== 'completed' ? (
                  <div className="font-body text-[14px]">Available after trip completion.</div>
                ) : isDriver ? (
                  <div className="font-body text-[14px]">
                    Passengers rate you after the trip.
                  </div>
                ) : pendingRatingNames.length > 0 ? (
                  <div className="font-body text-[14px]">
                    Rate your driver to finish.
                  </div>
                ) : (
                  <div className="font-body text-[14px]">Driver rating submitted.</div>
                )}
              </div>
            </div>

            {(riderCanCancel || driverCanCancel) && <PolicyNote className="mt-4" />}

            {/* Primary action — one clear next step */}
            <div className="mt-6 rounded-[14px] border border-brand/25 bg-brand-soft/40 p-4">
              <div className="eyebrow mb-2">Next step</div>
              {driverCanStart && (
                <Button block size="lg" onClick={() => action('start')} disabled={busy}>
                  {busy ? 'Starting…' : 'Start trip'}
                </Button>
              )}
              {driverCanEnroute && (
                <Button block size="lg" onClick={() => action('enroute')} disabled={busy}>
                  {busy ? 'Updating…' : 'Mark en route'}
                </Button>
              )}
              {driverCanComplete && (
                <Button block size="lg" onClick={() => action('complete')} disabled={busy}>
                  {busy ? 'Completing…' : 'Complete trip'}
                </Button>
              )}
              {riderCanPay && !cashPending && (
                <div className="space-y-3">
                  <Select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PayMethod)}
                    disabled={busy}
                  >
                    {PAY_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                  <Button block size="lg" onClick={pay} disabled={busy}>
                    {busy
                      ? 'Processing…'
                      : payMethod === 'cash'
                        ? `Mark cash ${money(myBooking?.fare_amount ?? 0)}`
                        : payMethod === 'wallet'
                          ? `Pay ${money(myBooking?.fare_amount ?? 0)} from wallet →`
                          : `Pay ${money(myBooking?.fare_amount ?? 0)} with Razorpay →`}
                  </Button>
                  <p className="font-mono text-[11px] text-g-500">
                    {payMethod === 'cash'
                      ? 'You mark cash paid — driver confirms receipt to settle.'
                      : payMethod === 'wallet'
                        ? 'Debits your wallet instantly after the trip.'
                        : 'Opens Razorpay Checkout (UPI / card). Settles when payment succeeds.'}
                  </p>
                </div>
              )}
              {riderCanPay && cashPending && (
                <p className="font-body text-[14px] text-ink-soft">
                  Cash marked — waiting for driver to confirm.
                </p>
              )}
              {canRate && !driverCanStart && !driverCanEnroute && !driverCanComplete && !riderCanPay && (
                <Button block size="lg" onClick={openRatingModal}>
                  Rate driver
                </Button>
              )}
              {canChat &&
                !driverCanStart &&
                !driverCanEnroute &&
                !driverCanComplete &&
                !riderCanPay &&
                !canRate && (
                  <Button
                    block
                    size="lg"
                    variant="secondary"
                    onClick={() => setChatOpen(true)}
                    disabled={!chatPeers.length}
                  >
                    Open chat
                  </Button>
                )}
              {!driverCanStart &&
                !driverCanEnroute &&
                !driverCanComplete &&
                !riderCanPay &&
                !canRate &&
                !canChat && (
                  <p className="font-body text-[14px] text-ink-soft">
                    {paid
                      ? `Payment settled via ${settledMethod ?? '—'}.`
                      : r?.status === 'scheduled'
                        ? 'Waiting for departure.'
                        : 'No action needed right now.'}
                  </p>
                )}
            </div>

            <details className="mt-4 rounded-[12px] border border-line">
              <summary className="cursor-pointer list-none px-4 py-3 font-mono text-[11px] uppercase tracking-eyebrow text-g-500 marker:content-none [&::-webkit-details-marker]:hidden">
                More actions
              </summary>
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
                {canChat && (driverCanStart || driverCanEnroute || driverCanComplete || riderCanPay || canRate) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setChatOpen(true)}
                    disabled={!chatPeers.length}
                  >
                    Open chat
                  </Button>
                )}
                {canRate && (driverCanComplete || riderCanPay) && (
                  <Button variant="secondary" size="sm" onClick={openRatingModal}>
                    Rate driver
                  </Button>
                )}
                {driverCanCancel && (
                  <Button variant="danger" size="sm" onClick={() => action('cancel')} disabled={busy}>
                    Cancel trip
                  </Button>
                )}
                {riderCanCancel && (
                  <Button variant="danger" size="sm" onClick={cancelBooking} disabled={busy}>
                    Cancel booking
                  </Button>
                )}
                {isDriver && seriesRide && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSeriesOpen(true)}
                      disabled={busy || seriesBusy}
                    >
                      Edit series
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={cancelSeries}
                      disabled={busy || seriesBusy}
                    >
                      Cancel series
                    </Button>
                  </>
                )}
                {paid && (
                  <span className="font-mono text-[12px] text-g-500">
                    Paid via {settledMethod ?? '—'}
                  </span>
                )}
              </div>
            </details>
          </Card>

          <Card className={`mt-6 ${showParticipantsPanel ? 'block' : 'hidden'} lg:block`}>
            <div className="eyebrow mb-4">Participants</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex items-center gap-3 border border-line rounded-[10px] p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ink font-mono text-[12px] text-paper">
                  {(r?.driver.name ?? 'D')[0]}
                </div>
                <div>
                  <div className="eyebrow">Driver</div>
                  <div className="font-body text-[14px]">{r?.driver.name ?? '—'}</div>
                  {r?.driver_id != null && (
                    <RatingBadge summary={ratingSummaries[String(r.driver_id)]} />
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 border border-line rounded-[10px] p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-line-strong font-mono text-[12px]">
                  {r?.vehicle ? 'V' : '—'}
                </div>
                <div>
                  <div className="eyebrow">Vehicle</div>
                  <div className="font-mono text-[13px]">
                    {r?.vehicle ? `${r.vehicle.model} · ${r.vehicle.reg_number}` : '—'}
                  </div>
                </div>
              </div>
            </div>
            {isDriver && (rideBookings.data?.length ?? 0) > 0 && (
              <div className="mt-4 space-y-2 border-t border-line pt-4">
                <div className="eyebrow">Passengers</div>
                {(rideBookings.data ?? []).map((b) => (
                  <div
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="font-body text-[15px] font-medium">
                        {b.passenger?.name ?? `Passenger ${String(b.passenger_id).slice(0, 6)}`}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-g-500">
                        <span>{b.seats} seat(s)</span>
                        <span>·</span>
                        <span>{money(b.fare_amount)}</span>
                        <StatusBadge status={b.status} />
                        <RatingBadge summary={ratingSummaries[String(b.passenger_id)]} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {b.status === 'booked' && r?.status === 'completed' && (
                        <CashConfirmButton
                          bookingId={b.id}
                          busy={busy}
                          onConfirm={confirmCash}
                        />
                      )}
                      {canChat && b.status !== 'cancelled' && b.status !== 'rejected' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setPeerId(String(b.passenger_id))
                            setChatOpen(true)
                          }}
                        >
                          Chat
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className={`${showInfoPanel ? 'block' : 'hidden'} lg:block`}>
          <Card>
            <div className="eyebrow mb-2">Trip info</div>
            <p className="font-mono text-[12px] text-g-500">
              Chat opens inline on this page — not as a popup. Live GPS runs while the trip is
              started or in progress.
            </p>
            {canChat && !chatOpen && (
              <Button className="mt-4" block onClick={() => setChatOpen(true)}>
                Open chat
              </Button>
            )}
            {chatLocked && (
              <p className="mt-4 font-mono text-[12px] text-g-500">
                Chat disabled — this trip or booking was cancelled.
              </p>
            )}
          </Card>
        </div>
      </div>

      {chatOpen && (
        <TripChat
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          peers={chatPeers}
          peerId={peerId}
          onPeerChange={setPeerId}
          messages={messages}
          draft={draft}
          onDraftChange={setDraft}
          onSend={sendMessage}
          currentUserId={user?.id}
          currentUserName={user?.name}
          wsStatus={wsStatus}
          error={chatError}
          endRef={chatEndRef}
          routeLabel={r ? `${r.origin} → ${r.destination}` : undefined}
          disabled={chatLocked}
          disabledReason={
            r?.status === 'cancelled'
              ? 'This trip was cancelled. Messaging is closed.'
              : 'Your booking was cancelled. Messaging is closed.'
          }
        />
      )}

      {showMobileBar && (
        <>
          <div className="h-16 lg:hidden" />
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 backdrop-blur lg:hidden">
            <div className="flex gap-2 overflow-x-auto px-3 py-2">
              {driverCanStart && (
                <Button size="sm" onClick={() => action('start')} disabled={busy}>
                  Start
                </Button>
              )}
              {driverCanEnroute && (
                <Button size="sm" onClick={() => action('enroute')} disabled={busy}>
                  En route
                </Button>
              )}
              {driverCanComplete && (
                <Button size="sm" onClick={() => action('complete')} disabled={busy}>
                  Complete
                </Button>
              )}
              {driverCanCancel && (
                <Button size="sm" variant="danger" onClick={() => action('cancel')} disabled={busy}>
                  Cancel
                </Button>
              )}
              {riderCanCancel && (
                <Button size="sm" variant="danger" onClick={cancelBooking} disabled={busy}>
                  Cancel booking
                </Button>
              )}
              {riderCanPay && !cashPending && (
                <Button size="sm" onClick={pay} disabled={busy}>
                  {payMethod === 'cash' ? 'Mark cash' : `Pay ${money(myBooking?.fare_amount)}`}
                </Button>
              )}
              {canRate && (
                <Button size="sm" variant="secondary" onClick={openRatingModal}>
                  Rate driver
                </Button>
              )}
              {canChat && (
                <Button size="sm" variant="secondary" onClick={() => setChatOpen(true)}>
                  Chat
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      <Modal
        open={seriesOpen}
        onClose={() => setSeriesOpen(false)}
        eyebrow="Recurring series"
        title="Edit upcoming series rides"
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSeriesOpen(false)}
              disabled={seriesBusy}
            >
              Close
            </Button>
            <Button size="sm" onClick={saveSeries} disabled={seriesBusy}>
              {seriesBusy ? 'Saving…' : 'Save series'}
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            label="Departure time"
            type="time"
            value={seriesTime}
            onChange={(e) => setSeriesTime(e.target.value)}
          />
          <Input
            label="Seats"
            type="number"
            min={1}
            value={seriesSeats}
            onChange={(e) => setSeriesSeats(e.target.value)}
          />
          <Input
            label="Fare / seat"
            type="number"
            min={1}
            value={seriesFare}
            onChange={(e) => setSeriesFare(e.target.value)}
          />
        </div>
        <div className="mt-4">
          <div className="eyebrow mb-2">Repeat days</div>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day, idx) => {
              const on = seriesDays.includes(idx)
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleSeriesDay(idx)}
                  className={`rounded-[8px] border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-eyebrow ${
                    on ? 'border-ink bg-ink text-paper' : 'border-line-strong text-ink'
                  }`}
                >
                  {day}
                </button>
              )
            })}
          </div>
        </div>
        <div className="mt-5 rounded-[10px] border border-line bg-paper-raised p-3">
          <div className="eyebrow mb-2">Skip one date</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              label="Date"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={seriesSkipDate}
              onChange={(e) => setSeriesSkipDate(e.target.value)}
            />
            <Input
              label="Reason (optional)"
              value={seriesSkipReason}
              onChange={(e) => setSeriesSkipReason(e.target.value)}
              placeholder="Holiday, no vehicle..."
            />
            <div className="flex items-end">
              <Button block size="sm" onClick={addSeriesSkipDate} disabled={seriesBusy || !seriesSkipDate}>
                {seriesBusy ? 'Applying…' : 'Skip date'}
              </Button>
            </div>
          </div>
          <div className="mt-3">
            <div className="mb-1 font-mono text-[11px] uppercase tracking-eyebrow text-g-500">Skipped dates</div>
            {seriesExceptions.length === 0 ? (
              <p className="text-[13px] text-g-500">No skip dates yet.</p>
            ) : (
              <div className="space-y-2">
                {seriesExceptions.map((x) => (
                  <div key={x.id} className="flex items-center justify-between gap-2 rounded-[8px] border border-line bg-paper px-3 py-2">
                    <div>
                      <div className="font-mono text-[12px]">{dateLabel(x.exception_date)}</div>
                      {x.reason && <div className="text-[12px] text-g-500">{x.reason}</div>}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={seriesBusy}
                      onClick={() => removeSeriesSkipDate(String(x.exception_date))}
                    >
                      Undo
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4">
          <div className="eyebrow mb-2">Upcoming series rides</div>
          <div className="max-h-[180px] space-y-2 overflow-y-auto rounded-[10px] border border-line p-2">
            {seriesUpcoming.length === 0 ? (
              <p className="px-1 py-2 text-[13px] text-g-500">No upcoming rides found.</p>
            ) : (
              seriesUpcoming.map((row) => (
                <div key={row.id} className="flex items-center justify-between rounded-[8px] border border-line bg-paper px-3 py-2">
                  <div>
                    <div className="font-mono text-[12px]">{dateLabel(row.departure_time)} · {timeLabel(row.departure_time)}</div>
                    <div className="text-[12px] text-g-500">{row.origin} → {row.destination}</div>
                  </div>
                  <StatusBadge status={row.status} />
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>
      <Modal
        open={ratingOpen}
        onClose={() => setRatingOpen(false)}
        eyebrow="Post-trip rating"
        title={`Rate driver · ${selectedRateeName}`}
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRatingOpen(false)} disabled={ratingBusy}>
              Cancel
            </Button>
            <Button size="sm" onClick={submitRating} disabled={ratingBusy || !rateeId}>
              {ratingBusy ? 'Saving…' : 'Submit rating'}
            </Button>
          </div>
        }
      >
        <p className="mb-4 font-body text-[14px] text-ink-soft">
          Passengers rate the driver after the trip. Drivers do not rate passengers.
        </p>
        <div className="mb-2 eyebrow">Stars</div>
        <div className="mb-4 flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setStars(n)}
              className={`rounded-[8px] border px-3 py-1.5 font-mono text-[12px] ${
                stars >= n ? 'border-ink bg-ink text-paper' : 'border-line-strong'
              }`}
            >
              {n}★
            </button>
          ))}
        </div>
        <Input
          label="Comment (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="How was the ride experience?"
        />
      </Modal>
    </div>
  )
}

function CashConfirmButton({
  bookingId,
  busy,
  onConfirm,
}: {
  bookingId: string | number
  busy: boolean
  onConfirm: (paymentId: string | number) => Promise<void>
}) {
  const [paymentId, setPaymentId] = useState<string | number | null>(null)

  useEffect(() => {
    let active = true
    api
      .get<Payment | null>(`/payments/booking/${bookingId}`)
      .then((res) => {
        if (
          active &&
          res.data?.method === 'cash' &&
          res.data.status === 'pending'
        ) {
          setPaymentId(res.data.id)
        }
      })
      .catch(() => {
        /* ignore */
      })
    return () => {
      active = false
    }
  }, [bookingId])

  if (!paymentId) return null
  return (
    <Button size="sm" onClick={() => onConfirm(paymentId)} disabled={busy}>
      Confirm cash
    </Button>
  )
}

function RatingBadge({ summary }: { summary?: RatingSummary }) {
  if (!summary || summary.total_ratings <= 0) return null
  return (
    <span className="ml-1 inline-block font-mono text-[10px] text-g-500">
      {summary.average_stars.toFixed(1)}★ ({summary.total_ratings})
    </span>
  )
}

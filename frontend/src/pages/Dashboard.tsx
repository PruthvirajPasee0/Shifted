import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'
import Card from '../components/Card'
import Button from '../components/Button'
import StatusBadge from '../components/StatusBadge'
import EmptyState from '../components/EmptyState'
import ActivationChecklist from '../components/ActivationChecklist'
import { ListSkeleton, StatSkeleton } from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { useAsync } from '../lib/useAsync'
import api from '../lib/api'
import type { Booking, ReportSummary, Ride } from '../types'
import { money, num, dateLabel, timeLabel } from '../lib/format'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function isUpcoming(iso?: string | null): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && t >= Date.now() - 30 * 60 * 1000
}

export default function Dashboard() {
  const { user } = useAuth()

  const summary = useAsync<ReportSummary>(
    () => api.get('/reports/summary').then((r) => r.data),
    [],
  )
  const bookings = useAsync<Booking[]>(
    () => api.get('/bookings/mine').then((r) => r.data),
    [],
  )
  const myRides = useAsync<Ride[]>(
    () => api.get('/rides/mine').then((r) => r.data),
    [],
  )

  useEffect(() => {
    void api.post('/notifications/check-reminders').catch(() => undefined)
  }, [])

  const s = summary.data
  const recent = (bookings.data ?? []).slice(0, 5)

  const nextTrip = useMemo(() => {
    const asPassenger = (bookings.data ?? [])
      .filter(
        (b) =>
          (b.status === 'booked' || b.status === 'completed') &&
          b.ride &&
          ['scheduled', 'started', 'in_progress'].includes(b.ride.status) &&
          isUpcoming(b.ride.departure_time),
      )
      .map((b) => ({
        kind: 'passenger' as const,
        id: String(b.ride_id),
        origin: b.ride?.origin ?? 'Origin',
        destination: b.ride?.destination ?? 'Destination',
        when: b.ride?.departure_time,
        status: b.ride?.status ?? b.status,
        fare: b.fare_amount,
        meta: `${b.seats} seat(s)`,
      }))

    const asDriver = (myRides.data ?? [])
      .filter(
        (r) =>
          ['scheduled', 'started', 'in_progress'].includes(r.status) &&
          isUpcoming(r.departure_time),
      )
      .map((r) => ({
        kind: 'driver' as const,
        id: String(r.id),
        origin: r.origin,
        destination: r.destination,
        when: r.departure_time,
        status: r.status,
        fare: r.fare_per_seat,
        meta: `${r.available_seats}/${r.total_seats} seats left`,
      }))

    return [...asPassenger, ...asDriver].sort(
      (a, b) => new Date(a.when ?? 0).getTime() - new Date(b.when ?? 0).getTime(),
    )[0]
  }, [bookings.data, myRides.data])

  return (
    <div>
      <PageHeader
        eyebrow="00 / Overview"
        title={`${greeting()}, ${user?.name?.split(' ')[0] ?? 'there'}.`}
        description="Your next commute, savings, and what to finish to stay ride-ready."
        actions={
          <>
            <Link to="/find">
              <Button>Find a Ride</Button>
            </Link>
            <Link to="/offer">
              <Button variant="secondary">Offer a Ride</Button>
            </Link>
          </>
        }
      />

      <ActivationChecklist />

      {nextTrip && (
        <Card className="mb-8 border-brand/30 bg-brand-soft/40">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="eyebrow">Next trip</div>
              <h2 className="mt-1 font-display text-2xl font-semibold leading-tight">
                {nextTrip.origin} → {nextTrip.destination}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[12px] text-g-500">
                <span>
                  {dateLabel(nextTrip.when)} · {timeLabel(nextTrip.when)}
                </span>
                <span>·</span>
                <span>{nextTrip.kind === 'driver' ? 'You drive' : 'You ride'}</span>
                <span>·</span>
                <span>{nextTrip.meta}</span>
                <StatusBadge status={nextTrip.status} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={`/trips/${nextTrip.id}`}>
                <Button>
                  {nextTrip.status === 'started' || nextTrip.status === 'in_progress'
                    ? 'Track live'
                    : 'Open trip'}
                </Button>
              </Link>
              <Link to="/trips">
                <Button variant="secondary">All trips</Button>
              </Link>
            </div>
          </div>
        </Card>
      )}

      {summary.error && (
        <div className="mb-5 rounded-[10px] border border-danger/30 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
          Couldn't load your stats — {summary.error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {summary.loading && !s ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <StatCard
              eyebrow="Total trips"
              index="01"
              value={num(s?.total_trips)}
              hint="Lifetime completed"
              inverted
            />
            <StatCard
              eyebrow="Distance"
              index="02"
              value={num(s?.total_distance_km)}
              unit="km"
              hint="Shared kilometres"
            />
            <StatCard
              eyebrow="Cost / km"
              index="03"
              value={s ? money(s.avg_cost_per_km) : '—'}
              hint="Blended commute rate"
            />
            <StatCard
              eyebrow="CO₂ saved"
              index="04"
              value={num(s?.co2_saved_kg ?? 0)}
              unit="kg"
              hint="Estimated emissions avoided"
            />
          </>
        )}
      </div>

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="eyebrow">05 / Recent bookings</div>
            <Link to="/trips" className="link-underline font-mono text-[12px] text-ink">
              View all →
            </Link>
          </div>
          <Card padded={false}>
            <div className="divide-y divide-line">
              {bookings.error ? (
                <div className="p-8 text-center font-mono text-[13px] text-danger">
                  Couldn't load bookings — {bookings.error}
                </div>
              ) : bookings.loading && recent.length === 0 ? (
                <ListSkeleton rows={3} />
              ) : recent.length === 0 ? (
                <EmptyState
                  title="No bookings yet"
                  description="Find a colleague heading your way, or offer seats on your commute."
                  actionLabel="Find a ride"
                  actionTo="/find"
                />
              ) : null}
              {recent.map((b) => (
                <Link
                  key={b.id}
                  to={`/trips/${b.ride_id}`}
                  className="flex items-center justify-between gap-4 p-5 hover:bg-paper"
                >
                  <div className="min-w-0">
                    <div className="truncate font-body text-[15px]">
                      {b.ride?.origin ?? 'Origin'} →{' '}
                      {b.ride?.destination ?? 'Destination'}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-g-500">
                      {dateLabel(b.ride?.departure_time)} · {b.seats} seat(s) ·{' '}
                      {money(b.fare_amount)}
                    </div>
                  </div>
                  <StatusBadge status={b.status} />
                </Link>
              ))}
            </div>
          </Card>
        </div>

        <div>
          <div className="mb-4 eyebrow">06 / Quick actions</div>
          <Card inverted className="mb-6">
            <div className="eyebrow !text-g-400">You are driving</div>
            <div className="numeral mt-3 text-5xl">
              {num((myRides.data ?? []).length)}
            </div>
            <p className="mt-2 text-sm text-g-300">
              Active & scheduled rides you host.
            </p>
            <Link to="/offer" className="mt-5 inline-block">
              <Button
                variant="secondary"
                className="!border-paper !text-paper hover:!bg-paper hover:!text-ink"
              >
                Offer a new ride
              </Button>
            </Link>
          </Card>

          <Card>
            <div className="eyebrow mb-4">Shortcuts</div>
            <div className="space-y-3">
              {[
                ['/wallet', 'Top up wallet'],
                ['/documents', 'Verify licence'],
                ['/profile', 'Save Home & Office'],
                ['/vehicles', 'Manage vehicles'],
              ].map(([to, label]) => (
                <Link
                  key={to}
                  to={to}
                  className="flex min-h-11 items-center justify-between border-b border-line pb-3 font-body text-[14px] last:border-0 last:pb-0"
                >
                  <span className="link-underline">{label}</span>
                  <span className="font-mono text-g-400">→</span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

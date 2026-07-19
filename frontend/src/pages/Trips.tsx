import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import { ListSkeleton } from '../components/Skeleton'
import Table, { type Column } from '../components/Table'
import { useAsync } from '../lib/useAsync'
import api from '../lib/api'
import type { Booking, Ride } from '../types'
import { money, dateLabel } from '../lib/format'

type Tab = 'passenger' | 'driver'

export default function Trips() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('passenger')

  const bookings = useAsync<Booking[]>(
    () => api.get('/bookings/mine').then((r) => r.data),
    [],
  )
  const rides = useAsync<Ride[]>(
    () => api.get('/rides/mine').then((r) => r.data),
    [],
  )

  const bookingCols: Column<Booking>[] = [
    {
      key: 'route',
      header: 'Route',
      render: (b) => `${b.ride?.origin ?? '—'} → ${b.ride?.destination ?? '—'}`,
    },
    { key: 'date', header: 'Date', render: (b) => dateLabel(b.ride?.departure_time) },
    { key: 'seats', header: 'Seats', align: 'center', render: (b) => b.seats },
    {
      key: 'fare',
      header: 'Fare',
      align: 'right',
      render: (b) => <span className="font-mono">{money(b.fare_amount)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (b) => <StatusBadge status={b.status} />,
    },
  ]

  const rideCols: Column<Ride>[] = [
    {
      key: 'route',
      header: 'Route',
      render: (r) => `${r.origin} → ${r.destination}`,
    },
    { key: 'date', header: 'Date', render: (r) => dateLabel(r.departure_time) },
    {
      key: 'seats',
      header: 'Seats',
      align: 'center',
      render: (r) => `${r.available_seats}/${r.total_seats}`,
    },
    {
      key: 'fare',
      header: 'Fare',
      align: 'right',
      render: (r) => <span className="font-mono">{money(r.fare_per_seat)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (r) => <StatusBadge status={r.status} />,
    },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="04 / My Trips"
        title="Trips"
        description="Track everything you've booked and everything you're driving."
      />

      <div className="mb-6 inline-flex rounded-[10px] border border-line-strong p-1">
        {(['passenger', 'driver'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-[7px] px-5 py-2 font-mono text-[11px] uppercase tracking-eyebrow transition-colors ${
              tab === t ? 'bg-ink text-paper' : 'text-ink'
            }`}
          >
            As {t}
          </button>
        ))}
      </div>

      <Card padded={false}>
        <div className="p-2">
          {tab === 'passenger' ? (
            bookings.loading && (bookings.data ?? []).length === 0 ? (
              <ListSkeleton rows={4} />
            ) : (
              <Table
                columns={bookingCols}
                rows={bookings.data ?? []}
                keyField={(b) => b.id}
                empty="No bookings yet. Find a ride to get started."
                onRowClick={(b) => navigate(`/trips/${b.ride_id}`)}
              />
            )
          ) : rides.loading && (rides.data ?? []).length === 0 ? (
            <ListSkeleton rows={4} />
          ) : (
            <Table
              columns={rideCols}
              rows={rides.data ?? []}
              keyField={(r) => r.id}
              empty="No offered rides yet. Publish your commute from Offer a Ride."
              onRowClick={(r) => navigate(`/trips/${r.id}`)}
            />
          )}
        </div>
      </Card>
    </div>
  )
}

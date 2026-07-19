import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import Button from '../components/Button'
import StatCard from '../components/StatCard'
import Table, { type Column } from '../components/Table'
import { useAsync } from '../lib/useAsync'
import api from '../lib/api'
import type { ReportSummary } from '../types'
import { money, num } from '../lib/format'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'

const BRAND = '#4f46e5'
const ACCENT = '#0d9488'
const GRID = '#e5e9f3'

const axisStyle = {
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: 11,
  fill: '#6a7291',
}

const tooltipStyle = {
  background: '#141a30',
  border: 'none',
  borderRadius: 10,
  color: '#ffffff',
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: 12,
}

type VehicleRow = ReportSummary['per_vehicle'][number]

export default function Reports() {
  const summary = useAsync<ReportSummary>(
    () => api.get('/reports/summary').then((r) => r.data),
    [],
  )
  const s = summary.data
  const monthly = s?.monthly ?? []
  const perVehicle = s?.per_vehicle ?? []

  const vehicleCols: Column<VehicleRow>[] = [
    { key: 'model', header: 'Vehicle', render: (v) => v.model },
    { key: 'trips', header: 'Trips', align: 'right', render: (v) => num(v.trips) },
    {
      key: 'distance',
      header: 'Distance (km)',
      align: 'right',
      render: (v) => num(v.distance, 1),
    },
    {
      key: 'fuel',
      header: 'Fuel (l)',
      align: 'right',
      render: (v) => num(v.fuel, 1),
    },
    {
      key: 'cost',
      header: 'Fuel cost',
      align: 'right',
      render: (v) => <span className="font-mono">{money(v.cost)}</span>,
    },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Analytics / Reports"
        title="Reports"
        description="Trips, distance, fuel and cost efficiency across your fleet."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                void api.get('/reports/export.csv', { responseType: 'blob' }).then((res) => {
                  const url = URL.createObjectURL(res.data)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = 'shifted-report.csv'
                  a.click()
                  URL.revokeObjectURL(url)
                })
              }}
            >
              Export CSV
            </Button>
            <Button
              onClick={() => {
                void api.get('/reports/export.pdf', { responseType: 'blob' }).then((res) => {
                  const url = URL.createObjectURL(res.data)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = 'shifted-report.pdf'
                  a.click()
                  URL.revokeObjectURL(url)
                })
              }}
            >
              Export PDF
            </Button>
          </div>
        }
      />

      {summary.error && (
        <div className="mb-5 rounded-[10px] border border-danger/30 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
          Couldn't load reports — {summary.error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard eyebrow="Total trips" index="01" value={num(s?.total_trips)} inverted />
        <StatCard
          eyebrow="Distance"
          index="02"
          value={num(s?.total_distance_km, 1)}
          unit="km"
        />
        <StatCard
          eyebrow="Fuel used"
          index="03"
          value={num(s?.total_fuel_litres, 1)}
          unit="litres"
        />
        <StatCard
          eyebrow="Cost / km"
          index="04"
          value={s ? money(s.avg_cost_per_km) : '—'}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          eyebrow="CO₂ saved"
          index="05"
          value={num(s?.co2_saved_kg, 1)}
          unit="kg"
          hint="Emissions avoided by ride sharing"
        />
        <StatCard
          eyebrow="Seat utilisation"
          index="06"
          value={s ? `${num(s.utilization_rate, 1)}` : '—'}
          unit="%"
          hint="Booked seats vs offered"
        />
        <StatCard
          eyebrow="Vehicles active"
          index="07"
          value={num(perVehicle.length)}
          hint="Contributing to completed trips"
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-6 eyebrow">Trips &amp; distance / month</div>
          {monthly.length === 0 ? (
            <EmptyChart loading={summary.loading} error={summary.error} />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={monthly} margin={{ left: -10, right: 10 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" tick={axisStyle} stroke={GRID} />
                <YAxis tick={axisStyle} stroke={GRID} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: BRAND }} />
                <Line
                  type="monotone"
                  dataKey="trips"
                  stroke={BRAND}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: BRAND }}
                />
                <Line
                  type="monotone"
                  dataKey="distance_km"
                  stroke={ACCENT}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <div className="mb-6 eyebrow">Fuel cost / month</div>
          {monthly.length === 0 ? (
            <EmptyChart loading={summary.loading} error={summary.error} />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthly} margin={{ left: -10, right: 10 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" tick={axisStyle} stroke={GRID} />
                <YAxis tick={axisStyle} stroke={GRID} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: 'rgba(79,70,229,0.06)' }}
                />
                <Bar dataKey="cost" fill={BRAND} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="mt-10">
        <div className="mb-4 eyebrow">Per-vehicle breakdown</div>
        <Card padded={false}>
          <div className="p-2">
            <Table
              columns={vehicleCols}
              rows={perVehicle}
              keyField={(v, i) => `${v.model}-${i}`}
              empty={
                summary.loading
                  ? 'Loading…'
                  : summary.error
                    ? `Couldn't load — ${summary.error}`
                    : 'No vehicle data yet.'
              }
            />
          </div>
        </Card>
      </div>
    </div>
  )
}

function EmptyChart({ loading, error }: { loading: boolean; error?: string | null }) {
  return (
    <div
      className={`flex h-[260px] items-center justify-center px-6 text-center font-mono text-[12px] ${
        error ? 'text-danger' : 'text-g-500'
      }`}
    >
      {loading ? 'Loading…' : error ? `Couldn't load — ${error}` : 'No data to chart yet.'}
    </div>
  )
}

import { Link } from 'react-router-dom'
import Card from './Card'
import { useAsync } from '../lib/useAsync'
import api from '../lib/api'
import type { Booking, Document, Ride, Vehicle } from '../types'

interface Step {
  id: string
  label: string
  done: boolean
  to: string
  hint: string
}

export default function ActivationChecklist() {
  const docs = useAsync<Document[]>(() => api.get('/documents').then((r) => r.data), [])
  const vehicles = useAsync<Vehicle[]>(() => api.get('/vehicles').then((r) => r.data), [])
  const bookings = useAsync<Booking[]>(() => api.get('/bookings/mine').then((r) => r.data), [])
  const rides = useAsync<Ride[]>(() => api.get('/rides/mine').then((r) => r.data), [])

  const licenceOk = (docs.data ?? []).some(
    (d) => d.doc_type === 'driving_license' && d.status === 'verified',
  )
  const activeVehicle = (vehicles.data ?? []).some((v) => v.is_active)
  const hasBooked = (bookings.data ?? []).some(
    (b) => b.status === 'booked' || b.status === 'completed',
  )
  const hasOffered = (rides.data ?? []).length > 0

  const steps: Step[] = [
    {
      id: 'licence',
      label: 'Verify driving licence',
      done: licenceOk,
      to: '/documents',
      hint: 'Required before you can offer rides',
    },
    {
      id: 'vehicle',
      label: 'Add an active vehicle',
      done: activeVehicle,
      to: '/vehicles',
      hint: 'Needed to publish a ride',
    },
    {
      id: 'first',
      label: 'Book or offer your first ride',
      done: hasBooked || hasOffered,
      to: hasOffered || licenceOk ? '/find' : '/offer',
      hint: 'Complete the commute loop once',
    },
  ]

  const loading = docs.loading || vehicles.loading || bookings.loading || rides.loading
  const doneCount = steps.filter((s) => s.done).length
  if (!loading && doneCount === steps.length) return null

  return (
    <Card className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Get started</div>
          <h2 className="mt-1 font-display text-xl font-semibold">Activation checklist</h2>
          <p className="mt-1 font-body text-[14px] text-g-500">
            Finish these steps so Find and Offer work without surprises.
          </p>
        </div>
        <div className="font-mono text-[12px] text-g-500">
          {loading ? '…' : `${doneCount}/${steps.length} done`}
        </div>
      </div>
      <ul className="mt-5 space-y-3">
        {steps.map((step, i) => (
          <li key={step.id}>
            <Link
              to={step.to}
              className={`flex items-start gap-3 rounded-[10px] border px-4 py-3 transition-colors ${
                step.done
                  ? 'border-success/25 bg-success-soft/40'
                  : 'border-line hover:border-brand/40 hover:bg-brand-soft/30'
              }`}
            >
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] ${
                  step.done ? 'bg-success text-white' : 'bg-ink text-paper'
                }`}
              >
                {step.done ? '✓' : String(i + 1)}
              </span>
              <span className="min-w-0">
                <span className="block font-body text-[15px] font-medium text-ink">
                  {step.label}
                </span>
                <span className="mt-0.5 block font-mono text-[11px] text-g-500">
                  {step.hint}
                </span>
              </span>
              {!step.done && (
                <span className="ml-auto shrink-0 font-mono text-[11px] text-brand">Open →</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

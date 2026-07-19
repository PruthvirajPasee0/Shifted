import { Link } from 'react-router-dom'
import Card from './Card'
import Button from './Button'

interface Step {
  id: string
  label: string
  done: boolean
  to: string
  cta: string
}

interface Props {
  licenceOk: boolean
  rcOk: boolean
  insuranceOk: boolean
  vehicleOk: boolean
  loading?: boolean
}

export default function OfferGate({
  licenceOk,
  rcOk,
  insuranceOk,
  vehicleOk,
  loading,
}: Props) {
  const steps: Step[] = [
    {
      id: 'licence',
      label: 'Verified driving licence',
      done: licenceOk,
      to: '/documents',
      cta: 'Upload licence',
    },
    {
      id: 'rc',
      label: 'Verified vehicle RC',
      done: rcOk,
      to: '/documents',
      cta: 'Upload RC',
    },
    {
      id: 'insurance',
      label: 'Verified vehicle insurance',
      done: insuranceOk,
      to: '/documents',
      cta: 'Upload insurance',
    },
    {
      id: 'vehicle',
      label: 'Active vehicle registered',
      done: vehicleOk,
      to: '/vehicles',
      cta: 'Add vehicle',
    },
  ]
  const next = steps.find((s) => !s.done)

  if (loading) {
    return (
      <Card className="mb-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-40 rounded bg-line" />
          <div className="h-8 w-64 rounded bg-line" />
          <div className="h-16 rounded bg-line" />
        </div>
      </Card>
    )
  }

  return (
    <Card className="mb-8 border-warning/40 bg-warning-soft/30">
      <div className="eyebrow">Before you can host</div>
      <h2 className="mt-1 font-display text-2xl font-semibold">Complete driver setup</h2>
      <p className="mt-2 max-w-xl font-body text-[14px] text-ink-soft">
        Offering rides needs verified papers and a vehicle. Finish the steps below — the form
        unlocks automatically.
      </p>
      <ul className="mt-5 space-y-2">
        {steps.map((step, i) => (
          <li
            key={step.id}
            className={`flex items-center gap-3 rounded-[12px] border px-4 py-3 ${
              step.done
                ? 'border-success/25 bg-success-soft/50'
                : step.id === next?.id
                  ? 'border-brand/40 bg-paper-raised'
                  : 'border-line bg-paper'
            }`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[11px] ${
                step.done ? 'bg-success text-white' : 'bg-ink text-paper'
              }`}
            >
              {step.done ? '✓' : i + 1}
            </span>
            <span className="min-w-0 flex-1 font-body text-[15px]">{step.label}</span>
            {!step.done && (
              <Link to={step.to}>
                <Button size="sm">{step.cta}</Button>
              </Link>
            )}
          </li>
        ))}
      </ul>
      {next && (
        <div className="mt-5">
          <Link to={next.to}>
            <Button block size="lg">
              Continue: {next.cta} →
            </Button>
          </Link>
        </div>
      )}
    </Card>
  )
}

type Tone = 'success' | 'brand' | 'warn' | 'muted' | 'danger'

const SUCCESS = new Set([
  'verified',
  'active',
  'success',
  'completed',
  'paid',
  'granted',
])
const BRAND = new Set(['confirmed', 'in_progress', 'started', 'booked', 'accepted'])
const WARN = new Set(['pending', 'scheduled', 'processing', 'invited', 'requested'])
const DANGER = new Set(['rejected', 'suspended', 'cancelled', 'revoked', 'failed', 'declined'])
const MUTED = new Set(['deleted', 'expired', 'inactive', 'closed'])

function classify(status: string): Tone {
  const s = status.toLowerCase()
  if (SUCCESS.has(s)) return 'success'
  if (BRAND.has(s)) return 'brand'
  if (WARN.has(s)) return 'warn'
  if (DANGER.has(s)) return 'danger'
  if (MUTED.has(s)) return 'muted'
  return 'brand'
}

export default function StatusBadge({
  status,
  className = '',
}: {
  status: string
  className?: string
}) {
  const tone = classify(status)
  const label = status.replace(/_/g, ' ')
  const styles: Record<Tone, string> = {
    success: 'bg-success-soft text-success border border-success/25',
    brand: 'bg-brand-soft text-brand-strong border border-brand/25',
    warn: 'bg-warning-soft text-warning border border-warning/25',
    danger: 'bg-danger-soft text-danger border border-danger/25',
    muted: 'bg-g-300/40 text-ink-soft border border-line-strong',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-eyebrow whitespace-nowrap ${styles[tone]} ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  )
}

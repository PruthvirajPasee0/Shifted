import type { ReactNode } from 'react'

interface Props {
  eyebrow: string
  value: ReactNode
  unit?: string
  hint?: string
  index?: string
  inverted?: boolean
}

export default function StatCard({
  eyebrow,
  value,
  unit,
  hint,
  index,
  inverted = false,
}: Props) {
  return (
    <div
      className={`relative overflow-hidden rounded-card border p-6 ${
        inverted
          ? 'surface-brand border-transparent shadow-lg shadow-brand/20'
          : 'bg-paper-raised border-line'
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`eyebrow ${inverted ? '!text-white/75' : ''}`}
        >
          {eyebrow}
        </span>
        {index && (
          <span
            className={`font-mono text-[11px] ${
              inverted ? 'text-white/55' : 'text-g-400'
            }`}
          >
            {index}
          </span>
        )}
      </div>
      <div className="mt-6 flex items-baseline gap-2">
        <span className="numeral text-[clamp(40px,5vw,58px)]">{value}</span>
        {unit && (
          <span
            className={`font-mono text-sm ${
              inverted ? 'text-g-300' : 'text-g-500'
            }`}
          >
            {unit}
          </span>
        )}
      </div>
      {hint && (
        <p
          className={`mt-2 text-sm ${
            inverted ? 'text-white/80' : 'text-g-500'
          }`}
        >
          {hint}
        </p>
      )}
    </div>
  )
}

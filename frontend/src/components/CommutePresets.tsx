import { Link } from 'react-router-dom'
import type { Place } from '../types'

interface Props {
  home?: Place | null
  office?: Place | null
  onCommute: (direction: 'to_office' | 'to_home') => void
}

/** One-tap Home↔Office commute setup for Find / Offer. */
export default function CommutePresets({ home, office, onCommute }: Props) {
  if (!home && !office) {
    return (
      <div className="rounded-[10px] border border-dashed border-line-strong px-3 py-3 font-mono text-[11px] text-g-500">
        Save Home & Office in{' '}
        <Link to="/profile" className="link-underline text-ink">
          Profile
        </Link>{' '}
        for one-tap commute search.
      </div>
    )
  }

  return (
    <div className="rounded-[10px] border border-line bg-paper-raised px-3 py-2">
      <div className="eyebrow mb-2">Commute presets</div>
      <div className="flex flex-wrap gap-2">
        {home && office && (
          <>
            <button
              type="button"
              onClick={() => onCommute('to_office')}
              className="min-h-11 rounded-[8px] border border-ink bg-ink px-3 py-2 font-mono text-[11px] uppercase tracking-eyebrow text-paper"
            >
              Home → Office
            </button>
            <button
              type="button"
              onClick={() => onCommute('to_home')}
              className="min-h-11 rounded-[8px] border border-line-strong px-3 py-2 font-mono text-[11px] uppercase tracking-eyebrow hover:border-ink"
            >
              Office → Home
            </button>
          </>
        )}
        {home && !office && (
          <span className="font-mono text-[11px] text-g-500">
            Home saved — add Office in Profile for full presets.
          </span>
        )}
        {office && !home && (
          <span className="font-mono text-[11px] text-g-500">
            Office saved — add Home in Profile for full presets.
          </span>
        )}
      </div>
    </div>
  )
}

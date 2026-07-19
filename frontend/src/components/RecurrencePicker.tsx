import { useMemo } from 'react'
import {
  WEEKDAYS,
  occurrenceDates,
  describeDays,
  sortDays,
} from '../lib/recurrence'
import { dateLabel } from '../lib/format'

export interface RecurrenceValue {
  enabled: boolean
  days: string[] // iCal weekday codes
  weeks: number
}

export const DEFAULT_RECURRENCE: RecurrenceValue = {
  enabled: false,
  days: [],
  weeks: 4,
}

const WEEK_OPTIONS = [2, 4, 6, 8, 12]

interface Props {
  value: RecurrenceValue
  onChange: (v: RecurrenceValue) => void
  /** Departure datetime — used to default the first weekday and preview dates. */
  start: Date | null
}

/**
 * Friendly weekly-recurrence control: a toggle, weekday chips, and a
 * "repeat for N weeks" selector, with a live preview of what will be created.
 * Emits a {enabled, days, weeks} value the parent turns into an RRULE.
 */
export default function RecurrencePicker({ value, onChange, start }: Props) {
  const { enabled, days, weeks } = value

  function toggleEnabled() {
    if (enabled) {
      onChange({ ...value, enabled: false })
      return
    }
    // Default to the start day's weekday so the series lines up with departure.
    const seed =
      days.length > 0
        ? days
        : start
          ? [WEEKDAYS[start.getDay()].code]
          : ['MO']
    onChange({ ...value, enabled: true, days: seed })
  }

  function toggleDay(code: string) {
    const next = days.includes(code)
      ? days.filter((d) => d !== code)
      : [...days, code]
    onChange({ ...value, days: next })
  }

  const preview = useMemo(() => {
    if (!enabled || !start || days.length === 0) return null
    const dates = occurrenceDates(start, days, weeks)
    return {
      count: dates.length,
      last: dates[dates.length - 1],
    }
  }, [enabled, start, days, weeks])

  return (
    <div className="rounded-[12px] border border-line-strong">
      {/* Header row with the toggle */}
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <div className="font-body text-[14px] font-medium text-ink">
            Repeat weekly
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-g-500">
            Publish this trip on a schedule
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Repeat this ride weekly"
          onClick={toggleEnabled}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            enabled ? 'bg-brand' : 'bg-g-300'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-paper shadow transition-transform ${
              enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-4 border-t border-line px-4 py-4">
          {/* Weekday chips */}
          <div>
            <span className="eyebrow mb-2 block">Repeat on</span>
            <div className="flex gap-1.5">
              {WEEKDAYS.map((w) => {
                const active = days.includes(w.code)
                return (
                  <button
                    key={w.code}
                    type="button"
                    aria-pressed={active}
                    title={w.label}
                    onClick={() => toggleDay(w.code)}
                    className={`h-9 w-9 rounded-full border font-mono text-[12px] transition-colors ${
                      active
                        ? 'border-ink bg-ink text-paper'
                        : 'border-line-strong text-ink hover:border-ink'
                    }`}
                  >
                    {w.short}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Horizon */}
          <div>
            <span className="eyebrow mb-2 block">Repeat for</span>
            <div className="flex gap-1.5">
              {WEEK_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={weeks === n}
                  onClick={() => onChange({ ...value, weeks: n })}
                  className={`rounded-[8px] border px-3 py-1.5 font-mono text-[11px] uppercase tracking-eyebrow transition-colors ${
                    weeks === n
                      ? 'border-ink bg-ink text-paper'
                      : 'border-line-strong text-ink hover:border-ink'
                  }`}
                >
                  {n} wks
                </button>
              ))}
            </div>
          </div>

          {/* Live preview */}
          {days.length === 0 ? (
            <p className="font-mono text-[11px] text-danger">
              Pick at least one weekday.
            </p>
          ) : preview ? (
            <div className="rounded-[10px] bg-brand-soft px-3.5 py-3">
              <p className="font-body text-[13px] text-ink">
                Creates{' '}
                <span className="font-semibold">{preview.count} rides</span> —
                every {describeDays(days)}.
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-g-500">
                Last ride: {dateLabel(preview.last.toISOString())}
              </p>
            </div>
          ) : (
            <p className="font-mono text-[11px] text-g-500">
              Choose a date &amp; time to preview the schedule (
              {describeDays(sortDays(days))}).
            </p>
          )}
        </div>
      )}
    </div>
  )
}

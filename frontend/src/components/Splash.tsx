import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

const DURATION_MS = 3600
const MODULES = [
  { name: 'Find Ride', hint: 'Match by route and seat' },
  { name: 'Offer Ride', hint: 'Publish trips quickly' },
  { name: 'Track Live', hint: 'Follow trip ETA' },
]

export default function Splash({ onDone }: { onDone: () => void }) {
  const startedAt = useRef<number>(Date.now())
  const completed = useRef(false)
  const [progress, setProgress] = useState(0)
  const [active, setActive] = useState(0)

  useEffect(() => {
    const t = setInterval(() => {
      const elapsed = Date.now() - startedAt.current
      const next = Math.min(100, Math.round((elapsed / DURATION_MS) * 100))
      setProgress(next)
      setActive(Math.min(MODULES.length - 1, Math.floor((next / 100) * MODULES.length)))
      if (next >= 100 && !completed.current) {
        completed.current = true
        clearInterval(t)
        onDone()
      }
    }, 40)
    return () => clearInterval(t)
  }, [onDone])

  function enterNow() {
    if (completed.current) return
    completed.current = true
    onDone()
  }

  return (
    <motion.div
      className="bg-sidebar fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden px-5 text-white"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.5, ease: 'easeInOut' } }}
    >
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-accent/30 blur-3xl" />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="mb-8 text-center"
      >
        <div className="eyebrow !text-white/50">Enterprise Mobility</div>
        <div className="mt-2 font-display text-5xl font-bold tracking-tight sm:text-6xl">
          Shifted
        </div>
        <div className="mt-2 font-mono text-xs uppercase tracking-eyebrow text-white/45">
          CARPOOL<span className="text-accent">/</span>OS
        </div>
        <p className="mt-3 font-body text-sm text-white/80 sm:text-base">
          Ride Together, Save Together.
        </p>
      </motion.div>

      <svg
        viewBox="0 0 320 60"
        className="w-full max-w-[320px]"
        fill="none"
        aria-hidden
      >
        <motion.line
          x1="28"
          y1="30"
          x2="292"
          y2="30"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="2"
          strokeDasharray="6 8"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.1, ease: 'easeInOut', delay: 0.3 }}
        />
        {/* origin pin */}
        <motion.circle
          cx="28"
          cy="30"
          r="7"
          fill="var(--accent)"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.3, type: 'spring', stiffness: 300 }}
        />
        {/* destination pin */}
        <motion.circle
          cx="292"
          cy="30"
          r="7"
          fill="#ffffff"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 1.35, type: 'spring', stiffness: 300 }}
        />
        <motion.circle
          cy="30"
          r="5"
          fill="var(--brand)"
          stroke="#fff"
          strokeWidth="2"
          initial={{ cx: 28, opacity: 0 }}
          animate={{ cx: 292, opacity: 1 }}
          transition={{ duration: 1.1, ease: 'easeInOut', delay: 0.35 }}
        />
      </svg>

      <div className="mt-7 grid w-full max-w-[520px] grid-cols-1 gap-2 sm:grid-cols-3">
        {MODULES.map((m, i) => {
          const isActive = i === active
          return (
            <button
              key={m.name}
              type="button"
              onClick={() => setActive(i)}
              className={`rounded-[12px] border px-3 py-3 text-left transition ${
                isActive
                  ? 'border-accent bg-white/10'
                  : 'border-white/20 bg-white/5 hover:bg-white/10'
              }`}
            >
              <div className="font-mono text-[10px] uppercase tracking-eyebrow text-white/60">
                0{i + 1}
              </div>
              <div className="mt-1 font-body text-sm">{m.name}</div>
              <div className="mt-1 font-mono text-[10px] text-white/60">{m.hint}</div>
            </button>
          )
        })}
      </div>

      <div className="mt-6 w-full max-w-[520px]">
        <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-white/65">
          <span>Initializing platform</span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/15">
          <motion.div
            className="h-full bg-accent"
            animate={{ width: `${progress}%` }}
            transition={{ ease: 'linear', duration: 0.1 }}
          />
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={enterNow}
          className="rounded-[10px] bg-white px-4 py-2 font-mono text-[11px] uppercase tracking-eyebrow text-ink transition hover:bg-white/90"
        >
          Enter platform
        </button>
        <button
          type="button"
          onClick={enterNow}
          className="rounded-[10px] border border-white/35 px-4 py-2 font-mono text-[11px] uppercase tracking-eyebrow text-white/85 transition hover:bg-white/10"
        >
          Skip
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="eyebrow absolute bottom-10 !text-white/40"
      >
        Interactive launch screen
      </motion.div>
    </motion.div>
  )
}

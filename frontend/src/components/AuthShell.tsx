import type { ReactNode } from 'react'

interface Props {
  numeral: string
  tagline: string
  children: ReactNode
}

export default function AuthShell({ numeral, tagline, children }: Props) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Left editorial panel — brand gradient */}
      <div className="bg-sidebar relative hidden flex-col justify-between p-12 text-white lg:flex">
        <div>
          <div className="eyebrow !text-white/50">Enterprise Mobility</div>
          <div className="mt-2 font-display text-3xl font-bold tracking-tight">Shifted</div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-eyebrow text-white/40">
            CARPOOL<span className="text-accent">/</span>OS
          </div>
        </div>

        <div>
          <div className="numeral text-[160px] leading-none text-white/10">
            {numeral}
          </div>
          <p className="mt-6 max-w-md font-display text-3xl leading-tight">
            {tagline}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-6 border-t border-white/10 pt-8">
          {[
            ['−32%', 'Commute cost'],
            ['4.2k', 'Trips / month'],
            ['1.1t', 'CO₂ saved'],
          ].map(([v, l]) => (
            <div key={l}>
              <div className="numeral text-2xl text-accent">{v}</div>
              <div className="eyebrow mt-1 !text-white/50">{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right form on paper */}
      <div className="flex items-center justify-center bg-paper p-6 sm:p-12">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  )
}

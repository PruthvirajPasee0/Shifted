import type { ReactNode } from 'react'

interface Props {
  eyebrow: string
  title: string
  description?: string
  actions?: ReactNode
}

export default function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: Props) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="eyebrow mb-2">{eyebrow}</div>
        <h1 className="numeral text-[clamp(30px,4vw,46px)]">{title}</h1>
        {description && (
          <p className="mt-3 max-w-xl text-[15px] text-g-500">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  )
}

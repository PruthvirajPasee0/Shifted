import { Link } from 'react-router-dom'
import Button from './Button'

interface Props {
  title: string
  description: string
  actionLabel?: string
  actionTo?: string
  onAction?: () => void
}

export default function EmptyState({
  title,
  description,
  actionLabel,
  actionTo,
  onAction,
}: Props) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 font-display text-lg font-semibold text-ink">{title}</div>
      <p className="max-w-sm font-body text-[14px] text-g-500">{description}</p>
      {actionLabel && actionTo && (
        <Link to={actionTo} className="mt-5">
          <Button>{actionLabel}</Button>
        </Link>
      )}
      {actionLabel && onAction && !actionTo && (
        <div className="mt-5">
          <Button onClick={onAction}>{actionLabel}</Button>
        </div>
      )}
    </div>
  )
}

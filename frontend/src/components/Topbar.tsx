import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import StatusBadge from './StatusBadge'
import Avatar from './Avatar'
import NotificationBell from './NotificationBell'

interface Props {
  onMenu: () => void
}

export default function Topbar({ onMenu }: Props) {
  const { user } = useAuth()

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-paper/80 px-5 py-4 backdrop-blur-md sm:px-8">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenu}
          aria-label="Open menu"
          className="rounded-[8px] border border-line-strong px-2.5 py-1.5 font-mono text-sm lg:hidden"
        >
          ☰
        </button>
        <div className="eyebrow hidden sm:block">
          {new Date().toLocaleDateString('en-GB', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {user?.role && (
          <StatusBadge status={user.role === 'admin' ? 'active' : user.status ?? 'active'} />
        )}
        <NotificationBell />
        <Link
          to="/profile"
          className="flex items-center gap-3 rounded-full border border-line bg-paper-raised py-1 pl-1 pr-4 transition-colors hover:border-brand/40"
        >
          <Avatar name={user?.name} src={user?.photo_url} size={32} />
          <div className="hidden text-right sm:block">
            <div className="font-body text-[13px] leading-tight">
              {user?.name ?? 'Guest'}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-eyebrow text-g-500">
              {user?.role ?? 'guest'}
            </div>
          </div>
        </Link>
      </div>
    </header>
  )
}

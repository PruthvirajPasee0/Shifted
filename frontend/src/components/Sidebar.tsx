import { NavLink, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAsync } from '../lib/useAsync'
import api from '../lib/api'
import type { AdminStats } from '../types'
import Avatar from './Avatar'

interface NavItem {
  to: string
  label: string
  index: string
}

const EMPLOYEE_NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', index: '01' },
  { to: '/find', label: 'Find a Ride', index: '02' },
  { to: '/offer', label: 'Offer a Ride', index: '03' },
  { to: '/trips', label: 'My Trips', index: '04' },
  { to: '/vehicles', label: 'My Vehicles', index: '05' },
  { to: '/documents', label: 'Documents', index: '06' },
  { to: '/wallet', label: 'Wallet', index: '07' },
  { to: '/support', label: 'Support', index: '08' },
  { to: '/reports', label: 'Reports', index: '09' },
  { to: '/profile', label: 'Profile', index: '10' },
]

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Company Console', index: '01' },
  { to: '/reports', label: 'Reports', index: '02' },
  { to: '/profile', label: 'Profile', index: '03' },
]

interface Props {
  mobileOpen?: boolean
  onNavigate?: () => void
}

export default function Sidebar({ mobileOpen = false, onNavigate }: Props) {
  const { user, logout } = useAuth()
  const isAdmin = user?.role === 'admin'
  const items = isAdmin ? ADMIN_NAV : EMPLOYEE_NAV
  const adminStats = useAsync<AdminStats>(
    () =>
      isAdmin
        ? api.get('/admin/stats').then((r) => r.data)
        : Promise.resolve({
            total_employees: 0,
            registered_vehicles: 0,
            rides_this_month: 0,
            pending_documents: 0,
            suspended_employees: 0,
          }),
    [isAdmin],
  )
  const pendingDocs = adminStats.data?.pending_documents ?? 0

  return (
    <aside
      className={`bg-sidebar fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col text-white transition-transform duration-300 lg:translate-x-0 ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="border-b border-white/10 px-6 py-7">
        <div className="eyebrow !text-white/50">Enterprise carpooling</div>
        <div className="font-display text-2xl font-bold tracking-tight">Shifted</div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-eyebrow text-white/40">
          CARPOOL<span className="text-accent">/</span>OS
        </div>
        <div className="mt-2 inline-flex rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow text-white/70">
          {isAdmin ? 'Administrator' : 'Employee'}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-4">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/' || item.to === '/admin'}
            onClick={onNavigate}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 px-6 py-3 font-body text-[15px] transition-colors ${
                isActive
                  ? 'bg-white/5 text-white'
                  : 'text-white/55 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`absolute left-0 top-0 h-full w-[3px] bg-accent transition-opacity ${
                    isActive ? 'opacity-100' : 'opacity-0'
                  }`}
                />
                <span
                  className={`font-mono text-[11px] ${
                    isActive ? 'text-accent' : 'text-white/35'
                  }`}
                >
                  {item.index}
                </span>
                <span className="flex items-center gap-2">
                  {item.label}
                  {isAdmin && item.to === '/admin' && pendingDocs > 0 && (
                    <span className="rounded-full bg-warning px-1.5 py-0.5 font-mono text-[9px] text-ink">
                      {pendingDocs}
                    </span>
                  )}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/10 px-5 py-5">
        <Link
          to="/profile"
          onClick={onNavigate}
          className="mb-3 flex items-center gap-3 rounded-[10px] p-1.5 transition-colors hover:bg-white/5"
        >
          <Avatar name={user?.name} src={user?.photo_url} size={38} />
          <div className="min-w-0">
            <div className="truncate font-body text-sm">{user?.name ?? 'Guest'}</div>
            <div className="truncate font-mono text-[11px] text-white/45">
              {user?.email ?? '—'}
            </div>
          </div>
        </Link>
        <button
          onClick={logout}
          className="font-mono text-[11px] uppercase tracking-eyebrow text-white/45 transition-colors hover:text-white"
        >
          Sign out →
        </button>
      </div>
    </aside>
  )
}

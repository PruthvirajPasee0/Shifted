import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const EMPLOYEE_TABS = [
  { to: '/find', label: 'Find' },
  { to: '/trips', label: 'Trips' },
  { to: '/offer', label: 'Offer' },
  { to: '/', label: 'Home' },
]

const ADMIN_TABS = [
  { to: '/admin', label: 'Admin' },
  { to: '/reports', label: 'Reports' },
  { to: '/profile', label: 'Profile' },
]

export default function MobileBottomNav() {
  const { user } = useAuth()
  const tabs = user?.role === 'admin' ? ADMIN_TABS : EMPLOYEE_TABS

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur-md lg:hidden"
      aria-label="Primary"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/' || t.to === '/admin'}
            className={({ isActive }) =>
              `flex min-h-12 min-w-[64px] flex-col items-center justify-center px-2 font-mono text-[11px] uppercase tracking-eyebrow ${
                isActive ? 'text-brand-strong' : 'text-g-500'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

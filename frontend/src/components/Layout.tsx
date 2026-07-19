import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import MobileBottomNav from './MobileBottomNav'

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const hideBottomNav = location.pathname.startsWith('/find')

  return (
    <div className="min-h-screen bg-paper">
      <Sidebar mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-ink/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className="lg:pl-[248px]">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main
          className={`mx-auto w-full max-w-content px-5 py-8 sm:px-8 ${
            hideBottomNav ? 'pb-8' : 'pb-24 lg:pb-8'
          }`}
        >
          <div key={location.pathname} className="animate-fade-up">
            <Outlet />
          </div>
        </main>
      </div>
      {!hideBottomNav && <MobileBottomNav />}
    </div>
  )
}

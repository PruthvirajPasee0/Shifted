import { useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import Layout from './components/Layout'
import ProtectedRoute, { homeForRole } from './components/ProtectedRoute'
import Splash from './components/Splash'
import { useAuth } from './context/AuthContext'

import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import FindRide from './pages/FindRide'
import OfferRide from './pages/OfferRide'
import Trips from './pages/Trips'
import TripDetail from './pages/TripDetail'
import Vehicles from './pages/Vehicles'
import Documents from './pages/Documents'
import Wallet from './pages/Wallet'
import Support from './pages/Support'
import Reports from './pages/Reports'
import Admin from './pages/Admin'
import Profile from './pages/Profile'

const LOGIN_SPLASH_KEY = 'cp_login_splash_seen'

export default function App() {
  const { token, user } = useAuth()
  const location = useLocation()
  const isAuthRoute =
    location.pathname === '/login' || location.pathname === '/signup'
  const signedIn = Boolean(token && user && user.status === 'active')

  const [showSplash, setShowSplash] = useState(() => {
    const seen = sessionStorage.getItem(LOGIN_SPLASH_KEY) === '1'
    const hasToken = Boolean(localStorage.getItem('cp_access_token'))
    return !hasToken && !seen
  })

  function dismissSplash() {
    sessionStorage.setItem(LOGIN_SPLASH_KEY, '1')
    setShowSplash(false)
  }

  return (
    <>
      <AnimatePresence>
        {!token && isAuthRoute && showSplash && (
          <Splash key="splash" onDone={dismissSplash} />
        )}
      </AnimatePresence>

      <Routes>
        <Route
          path="/login"
          element={
            signedIn ? <Navigate to={homeForRole(user?.role)} replace /> : <Login />
          }
        />
        <Route
          path="/signup"
          element={
            signedIn ? <Navigate to={homeForRole(user?.role)} replace /> : <Signup />
          }
        />

        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          {/* Employee (day-to-day ride operations) */}
          <Route
            path="/"
            element={
              <ProtectedRoute roles={['employee']}>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/find"
            element={
              <ProtectedRoute roles={['employee']}>
                <FindRide />
              </ProtectedRoute>
            }
          />
          <Route
            path="/offer"
            element={
              <ProtectedRoute roles={['employee']}>
                <OfferRide />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trips"
            element={
              <ProtectedRoute roles={['employee']}>
                <Trips />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trips/:id"
            element={
              <ProtectedRoute roles={['employee']}>
                <TripDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vehicles"
            element={
              <ProtectedRoute roles={['employee']}>
                <Vehicles />
              </ProtectedRoute>
            }
          />
          <Route
            path="/documents"
            element={
              <ProtectedRoute roles={['employee']}>
                <Documents />
              </ProtectedRoute>
            }
          />
          <Route
            path="/wallet"
            element={
              <ProtectedRoute roles={['employee']}>
                <Wallet />
              </ProtectedRoute>
            }
          />
          <Route
            path="/support"
            element={
              <ProtectedRoute roles={['employee']}>
                <Support />
              </ProtectedRoute>
            }
          />

          {/* Shared */}
          <Route path="/reports" element={<Reports />} />
          <Route path="/profile" element={<Profile />} />

          {/* Admin (company administration only) */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={['admin']}>
                <Admin />
              </ProtectedRoute>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

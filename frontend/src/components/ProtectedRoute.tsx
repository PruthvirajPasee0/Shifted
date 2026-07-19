import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { Role } from '../types'

export const AUTH_NOTICE_KEY = 'cp_auth_notice'

export function homeForRole(role?: Role): string {
  return role === 'admin' ? '/admin' : '/'
}

export default function ProtectedRoute({
  children,
  roles,
}: {
  children: ReactNode
  roles?: Role[]
}) {
  const { token, user, logout } = useAuth()
  const location = useLocation()

  // Must have token AND an active user — token alone is not enough.
  const allowed = Boolean(token && user && user.status === 'active')
  const blockedPending = Boolean(token && user && user.status !== 'active')

  useEffect(() => {
    if (!blockedPending) return
    const notice =
      user?.status === 'invited'
        ? 'Your account is awaiting administrator approval.'
        : 'Your account access has been revoked.'
    sessionStorage.setItem(AUTH_NOTICE_KEY, notice)
    logout()
  }, [blockedPending, user?.status, logout])

  if (!allowed) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Role-gated route: send users to their own home instead of a dead end.
  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to={homeForRole(user.role)} replace />
  }

  return <>{children}</>
}

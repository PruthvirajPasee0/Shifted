import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import api, { TOKEN_KEY, USER_KEY } from '../lib/api'
import type { AuthResponse, RegisterPendingResponse, User } from '../types'

const LOGIN_SPLASH_KEY = 'cp_login_splash_seen'

interface AuthContextValue {
  user: User | null
  token: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<User>
  register: (payload: RegisterPayload) => Promise<RegisterPendingResponse>
  updateProfile: (payload: ProfilePayload) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
}

export interface RegisterPayload {
  org_id: string
  name: string
  email: string
  phone?: number
  password: string
  photo_url?: string | null
  department?: string
  manager?: string
  office_location?: string
}

export interface ProfilePayload {
  name?: string
  phone?: number
  photo_url?: string | null
  department?: string
  manager?: string
  office_location?: string
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function readStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readStoredUser())
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_KEY),
  )
  const [loading, setLoading] = useState<boolean>(false)

  function persist(res: AuthResponse) {
    localStorage.setItem(TOKEN_KEY, res.access_token)
    localStorage.setItem(USER_KEY, JSON.stringify(res.user))
    setToken(res.access_token)
    setUser(res.user)
  }

  async function login(email: string, password: string) {
    setLoading(true)
    try {
      const { data } = await api.post<AuthResponse>('/auth/login', {
        email,
        password,
      })
      // Client-side gate: never persist a session for non-approved accounts.
      if (data.user.status !== 'active') {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_KEY)
        setToken(null)
        setUser(null)
        const err = new Error(
          data.user.status === 'invited'
            ? 'Your account is awaiting administrator approval.'
            : 'Your account access has been revoked.',
        ) as Error & { response?: { data?: { detail?: string } } }
        err.response = { data: { detail: err.message } }
        throw err
      }
      persist(data)
      return data.user
    } finally {
      setLoading(false)
    }
  }

  async function register(payload: RegisterPayload) {
    setLoading(true)
    try {
      // No token — account stays invited until an admin grants access.
      const { data } = await api.post<RegisterPendingResponse>(
        '/auth/register',
        payload,
      )
      return data
    } finally {
      setLoading(false)
    }
  }

  async function updateProfile(payload: ProfilePayload) {
    const { data } = await api.patch<User>('/auth/me', payload)
    setUser(data)
    localStorage.setItem(USER_KEY, JSON.stringify(data))
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    sessionStorage.removeItem(LOGIN_SPLASH_KEY)
    setToken(null)
    setUser(null)
  }

  async function refresh() {
    if (!localStorage.getItem(TOKEN_KEY)) return
    try {
      const { data } = await api.get<User>('/auth/me')
      setUser(data)
      localStorage.setItem(USER_KEY, JSON.stringify(data))
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 401 || status === 403) {
        logout()
      }
      // Network / 5xx: keep cached user so offline demos still work.
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, login, register, updateProfile, logout, refresh }),
    [user, token, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

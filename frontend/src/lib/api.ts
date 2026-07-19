import axios from 'axios'

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:8000/api'

export const TOKEN_KEY = 'cp_access_token'
export const USER_KEY = 'cp_user'

/** Build a WebSocket URL under the same API host (no secrets in query). */
export function wsUrl(path: string, params?: Record<string, string>): string {
  const base = API_BASE_URL.replace(/^http/, 'ws')
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  }
  return url.toString()
}

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
})

let refreshPromise: Promise<string | null> | null = null

async function tryRefreshToken(): Promise<string | null> {
  const token = localStorage.getItem(TOKEN_KEY)
  if (!token) return null
  try {
    const { data } = await axios.post<{ access_token: string }>(
      `${API_BASE_URL}/auth/refresh`,
      {},
      { headers: { Authorization: `Bearer ${token}` } },
    )
    localStorage.setItem(TOKEN_KEY, data.access_token)
    return data.access_token
  } catch {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    return null
  }
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status
    const original = error?.config as
      | (Record<string, unknown> & { headers?: Record<string, string>; _retry?: boolean })
      | undefined
    if (status === 401 && original && !original._retry) {
      original._retry = true
      if (!refreshPromise) {
        refreshPromise = tryRefreshToken().finally(() => {
          refreshPromise = null
        })
      }
      const next = await refreshPromise
      if (next) {
        original.headers = original.headers ?? {}
        original.headers.Authorization = `Bearer ${next}`
        return api.request(original)
      }
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.assign('/login')
      }
    }
    return Promise.reject(error)
  },
)

export default api

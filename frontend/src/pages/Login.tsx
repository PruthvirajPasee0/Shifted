import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import { Input } from '../components/Field'
import Button from '../components/Button'
import { useAuth } from '../context/AuthContext'
import { AUTH_NOTICE_KEY, homeForRole } from '../components/ProtectedRoute'

function readNotice(stateNotice?: string | null): string | null {
  const fromState = stateNotice ?? null
  const fromSession = sessionStorage.getItem(AUTH_NOTICE_KEY)
  if (fromSession) sessionStorage.removeItem(AUTH_NOTICE_KEY)
  return fromState || fromSession
}

export default function Login() {
  const { login, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { from?: { pathname: string }; notice?: string } | null
  const from = state?.from?.pathname ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice] = useState<string | null>(() => readNotice(state?.notice))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const user = await login(email, password)
      navigate(from && from !== '/' ? from : homeForRole(user.role), {
        replace: true,
      })
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? 'Unable to sign in. Check your credentials or try later.'
      setError(msg)
    }
  }

  return (
    <AuthShell numeral="01" tagline="Share the drive. Split the cost. Move as one workforce.">
      <div className="eyebrow mb-3">Sign in</div>
      <h1 className="numeral mb-2 text-4xl">Welcome back</h1>
      <p className="mb-8 text-[15px] text-g-500">
        Access your organisation's carpooling network.
      </p>

      {notice && (
        <div className="mb-5 rounded-[10px] border border-line-strong bg-paper px-4 py-3 font-mono text-[12px] text-ink">
          {notice}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-5">
        <Input
          id="email"
          label="Work email"
          type="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          id="password"
          label="Password"
          type="password"
          required
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <div className="rounded-[10px] border border-danger/30 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
            {error}
          </div>
        )}

        <Button type="submit" block size="lg" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in →'}
        </Button>
      </form>

      <p className="mt-8 font-mono text-[12px] text-g-500">
        No account yet?{' '}
        <Link to="/signup" className="link-underline text-brand-strong">
          Register your profile
        </Link>
      </p>
    </AuthShell>
  )
}

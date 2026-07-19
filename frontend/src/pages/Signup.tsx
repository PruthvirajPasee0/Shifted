import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import { Input, Select } from '../components/Field'
import Button from '../components/Button'
import Avatar from '../components/Avatar'
import { useAuth } from '../context/AuthContext'
import { fileToAvatarDataUrl } from '../lib/image'
import api from '../lib/api'

interface OrgOption {
  id: string
  name: string
  domain: string
}

export default function Signup() {
  const { register, loading } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [orgsLoading, setOrgsLoading] = useState(true)
  const [form, setForm] = useState({
    org_id: '',
    name: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
  })
  const [photo, setPhoto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingMsg, setPendingMsg] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api
      .get<OrgOption[]>('/auth/organizations')
      .then((r) => active && setOrgs(r.data))
      .catch(() => active && setOrgs([]))
      .finally(() => active && setOrgsLoading(false))
    return () => {
      active = false
    }
  }, [])

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setPhoto(await fileToAvatarDataUrl(file))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const phonePattern = /^[6-9][0-9]{9}$/
  // At least 8 chars, one uppercase, one lowercase, one digit, one special char.
  const passwordPattern =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/

  // Strip spaces, +91 prefix and other separators to the raw 10 digits.
  function normalisePhone(raw: string) {
    return raw.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')
  }

  const phoneError =
    form.phone && !phonePattern.test(normalisePhone(form.phone))
      ? 'Enter a valid 10-digit mobile number.'
      : undefined
  const passwordError =
    form.password && !passwordPattern.test(form.password)
      ? 'Min 8 chars with uppercase, lowercase, number and special character.'
      : undefined

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.org_id) {
      setError('Please select your organization.')
      return
    }
    const selectedOrg = orgs.find((o) => String(o.id) === String(form.org_id))
    if (selectedOrg?.domain) {
      const domain = selectedOrg.domain.replace(/^@/, '').toLowerCase()
      if (!form.email.trim().toLowerCase().endsWith('@' + domain)) {
        setError(`Work email must end with @${domain}`)
        return
      }
    }
    if (!passwordPattern.test(form.password)) {
      setError(
        'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number and a special character.',
      )
      return
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match.')
      return
    }
    const normalisedPhone = normalisePhone(form.phone)
    if (!phonePattern.test(normalisedPhone)) {
      setError('Enter a valid 10-digit mobile number.')
      return
    }
    try {
      const { confirm, phone, ...rest } = form
      void confirm
      void phone
      const result = await register({
        ...rest,
        phone: Number(normalisedPhone),
        photo_url: photo,
      })
      setPendingMsg(result.message)
      // Do not auto-login — wait for admin approval, then send user to login.
      window.setTimeout(() => {
        navigate('/login', {
          replace: true,
          state: { notice: result.message },
        })
      }, 2500)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? 'Registration failed. Please verify your details.'
      setError(msg)
    }
  }

  return (
    <AuthShell numeral="02" tagline="Onboard your organisation to smarter, greener commuting.">
      <div className="eyebrow mb-3">Create account</div>
      <h1 className="numeral mb-2 text-4xl">Register</h1>
      <p className="mb-7 text-[15px] text-g-500">
        Join your organisation. An administrator must approve access before you can sign in.
      </p>

      {pendingMsg && (
        <div className="mb-6 rounded-[10px] border border-line-strong bg-paper px-4 py-3 font-mono text-[12px] text-ink">
          {pendingMsg}
          <div className="mt-1 text-g-500">Redirecting to sign in…</div>
        </div>
      )}

      {/* Profile photo */}
      <div className="mb-6 flex items-center gap-4">
        <Avatar name={form.name} src={photo} size={64} />
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickPhoto}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => fileRef.current?.click()}
          >
            {photo ? 'Change photo' : 'Upload photo'}
          </Button>
          <p className="mt-1.5 font-mono text-[10px] text-g-400">
            Optional · helps colleagues recognise you
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <Select
          id="org_id"
          label="Organisation"
          required
          value={form.org_id}
          onChange={(e) => set('org_id', e.target.value)}
          disabled={orgsLoading || orgs.length === 0}
          hint={
            orgsLoading
              ? 'Loading organizations…'
              : orgs.length === 0
                ? 'No organizations available — ask your admin to register your company.'
                : 'Select the company you belong to.'
          }
        >
          <option value="">
            {orgsLoading ? 'Loading…' : 'Select your organization'}
          </option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({o.domain})
            </option>
          ))}
        </Select>
        <Input
          id="name"
          label="Full name"
          required
          placeholder="Jane Doe"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            id="email"
            label="Work email"
            type="email"
            required
            placeholder={
              orgs.find((o) => String(o.id) === String(form.org_id))?.domain
                ? `you@${orgs.find((o) => String(o.id) === String(form.org_id))!.domain}`
                : 'jane@company.com'
            }
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            hint={
              orgs.find((o) => String(o.id) === String(form.org_id))?.domain
                ? `Must use @${orgs.find((o) => String(o.id) === String(form.org_id))!.domain}`
                : undefined
            }
          />
          <Input
            id="phone"
            label="Phone"
            type="tel"
            required
            placeholder="+91 90000 00000"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            error={phoneError}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            id="password"
            label="Password"
            type="password"
            required
            minLength={8}
            placeholder="Min 8 chars, mixed case, number & symbol"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            error={passwordError}
          />
          <Input
            id="confirm"
            label="Confirm password"
            type="password"
            required
            placeholder="Re-enter password"
            value={form.confirm}
            onChange={(e) => set('confirm', e.target.value)}
            error={
              form.confirm && form.confirm !== form.password
                ? 'Passwords do not match.'
                : undefined
            }
          />
        </div>

        {error && (
          <div className="rounded-[10px] border border-danger/30 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
            {error}
          </div>
        )}

        <Button type="submit" block size="lg" disabled={loading || Boolean(pendingMsg)}>
          {loading ? 'Creating…' : pendingMsg ? 'Submitted' : 'Create account →'}
        </Button>
      </form>

      <p className="mt-8 font-mono text-[12px] text-g-500">
        Already registered?{' '}
        <Link to="/login" className="link-underline text-brand-strong">
          Sign in
        </Link>
      </p>
    </AuthShell>
  )
}

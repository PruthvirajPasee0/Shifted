import { useEffect, useRef, useState, type FormEvent } from 'react'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import Button from '../components/Button'
import Avatar from '../components/Avatar'
import { Input } from '../components/Field'
import PlacesAutocomplete from '../components/PlacesAutocomplete'
import { useAuth } from '../context/AuthContext'
import { fileToAvatarDataUrl } from '../lib/image'
import { useAsync } from '../lib/useAsync'
import api from '../lib/api'
import type { Place } from '../types'

export default function Profile() {
  const { user, updateProfile } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const places = useAsync<Place[]>(
    () => api.get('/places').then((r) => r.data),
    [],
  )

  const [photo, setPhoto] = useState<string | null>(user?.photo_url ?? null)
  const [form, setForm] = useState({
    name: user?.name ?? '',
    phone: user?.phone != null ? String(user.phone) : '',
    department: user?.department ?? '',
    manager: user?.manager ?? '',
    office_location: user?.office_location ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [placeBusy, setPlaceBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [homeInput, setHomeInput] = useState('')
  const [officeInput, setOfficeInput] = useState('')
  const [homeCoords, setHomeCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [officeCoords, setOfficeCoords] = useState<{ lat: number; lng: number } | null>(null)

  const homePlace = (places.data ?? []).find(
    (p) => p.label.trim().toLowerCase() === 'home',
  )
  const officePlace = (places.data ?? []).find(
    (p) => p.label.trim().toLowerCase() === 'office',
  )

  useEffect(() => {
    if (homePlace) {
      setHomeInput(homePlace.address || homePlace.label)
      setHomeCoords({ lat: Number(homePlace.lat), lng: Number(homePlace.lng) })
    }
  }, [homePlace?.id])

  useEffect(() => {
    if (officePlace) {
      setOfficeInput(officePlace.address || officePlace.label)
      setOfficeCoords({ lat: Number(officePlace.lat), lng: Number(officePlace.lng) })
    }
  }, [officePlace?.id])

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setMsg(null)
    try {
      const dataUrl = await fileToAvatarDataUrl(file)
      setPhoto(dataUrl)
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    }
  }

  const phonePattern = /^[6-9][0-9]{9}$/
  const phoneValid = !form.phone || phonePattern.test(form.phone)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!phoneValid) {
      setMsg({ ok: false, text: 'Enter a valid phone number.' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await updateProfile({
        ...form,
        phone: form.phone ? Number(form.phone) : undefined,
        photo_url: photo,
      })
      setMsg({ ok: true, text: 'Profile updated.' })
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail
      setMsg({ ok: false, text: typeof detail === 'string' ? detail : 'Could not save — please try again.' })
    } finally {
      setBusy(false)
    }
  }

  async function savePlace(label: 'Home' | 'Office') {
    const input = label === 'Home' ? homeInput : officeInput
    const coords = label === 'Home' ? homeCoords : officeCoords
    if (!coords) {
      setMsg({ ok: false, text: `Select ${label} from suggestions so coordinates are captured.` })
      return
    }
    const existing = (places.data ?? []).find(
      (p) => p.label.trim().toLowerCase() === label.toLowerCase(),
    )
    setPlaceBusy(true)
    setMsg(null)
    try {
      if (existing) await api.delete(`/places/${existing.id}`)
      await api.post('/places', {
        label,
        address: input || label,
        lat: coords.lat,
        lng: coords.lng,
      })
      await places.reload()
      setMsg({ ok: true, text: `${label} saved.` })
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail
      setMsg({
        ok: false,
        text: typeof detail === 'string' ? detail : `Could not save ${label}.`,
      })
    } finally {
      setPlaceBusy(false)
    }
  }

  async function removePlace(label: 'Home' | 'Office') {
    const existing = (places.data ?? []).find(
      (p) => p.label.trim().toLowerCase() === label.toLowerCase(),
    )
    if (!existing) return
    setPlaceBusy(true)
    setMsg(null)
    try {
      await api.delete(`/places/${existing.id}`)
      await places.reload()
      if (label === 'Home') {
        setHomeInput('')
        setHomeCoords(null)
      } else {
        setOfficeInput('')
        setOfficeCoords(null)
      }
      setMsg({ ok: true, text: `${label} removed.` })
    } catch {
      setMsg({ ok: false, text: `Could not remove ${label}.` })
    } finally {
      setPlaceBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Account / Profile"
        title="Your profile"
        description="Manage your identity and profile photo used across ride sharing."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Photo card */}
        <Card className="flex flex-col items-center text-center">
          <Avatar name={form.name || user?.name} src={photo} size={128} />
          <div className="mt-5 font-display text-xl">{form.name || user?.name}</div>
          <div className="mt-1 font-mono text-[12px] text-g-500">{user?.email}</div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-eyebrow text-brand-strong">
            {user?.role}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickPhoto}
          />
          <div className="mt-6 flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
              {photo ? 'Change photo' : 'Upload photo'}
            </Button>
            {photo && (
              <Button size="sm" variant="ghost" onClick={() => setPhoto(null)}>
                Remove
              </Button>
            )}
          </div>
          <p className="mt-3 font-mono text-[10px] text-g-400">
            JPG or PNG · square crop · stored with your profile
          </p>
        </Card>

        {/* Identity form */}
        <Card className="lg:col-span-2">
          <div className="eyebrow mb-5">Personal details</div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                id="name"
                label="Full name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                required
              />
              <Input
                id="phone"
                label="Phone"
                type="tel"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="+91 90000 00000"
                error={!phoneValid ? 'Enter a valid phone number.' : undefined}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                id="department"
                label="Department"
                value={form.department}
                onChange={(e) => set('department', e.target.value)}
                placeholder="Engineering"
              />
              <Input
                id="manager"
                label="Manager"
                value={form.manager}
                onChange={(e) => set('manager', e.target.value)}
                placeholder="A. Shah"
              />
              <Input
                id="office_location"
                label="Office location"
                value={form.office_location}
                onChange={(e) => set('office_location', e.target.value)}
                placeholder="Bengaluru"
              />
            </div>

            {msg && (
              <div
                className={`rounded-[10px] border px-4 py-3 font-mono text-[12px] ${
                  msg.ok
                    ? 'border-success/30 bg-success-soft text-success'
                    : 'border-danger/30 bg-danger-soft text-danger'
                }`}
              >
                {msg.text}
              </div>
            )}

            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </Card>
      </div>
      <Card className="mt-6">
        <div className="eyebrow mb-5">Saved places</div>
        <p className="mb-4 font-mono text-[11px] text-g-500">
          Home and Office appear as quick picks in Find Ride and Offer Ride.
        </p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <PlacesAutocomplete
              label="Home"
              value={homeInput}
              onChange={setHomeInput}
              onPlace={({ label, coords }) => {
                setHomeInput(label)
                setHomeCoords(coords)
              }}
              placeholder="Set your home location"
              hint={
                homeCoords
                  ? `${homeCoords.lat.toFixed(4)}, ${homeCoords.lng.toFixed(4)}`
                  : 'Select from suggestions'
              }
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => savePlace('Home')} disabled={placeBusy}>
                Save Home
              </Button>
              {homePlace && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removePlace('Home')}
                  disabled={placeBusy}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <PlacesAutocomplete
              label="Office"
              value={officeInput}
              onChange={setOfficeInput}
              onPlace={({ label, coords }) => {
                setOfficeInput(label)
                setOfficeCoords(coords)
              }}
              placeholder="Set your office location"
              hint={
                officeCoords
                  ? `${officeCoords.lat.toFixed(4)}, ${officeCoords.lng.toFixed(4)}`
                  : 'Select from suggestions'
              }
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => savePlace('Office')} disabled={placeBusy}>
                Save Office
              </Button>
              {officePlace && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removePlace('Office')}
                  disabled={placeBusy}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import Button from '../components/Button'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import { Input, Select } from '../components/Field'
import EmptyState from '../components/EmptyState'
import { ListSkeleton } from '../components/Skeleton'
import { useAsync } from '../lib/useAsync'
import { useToast } from '../context/ToastContext'
import api from '../lib/api'
import type { FuelType, Vehicle } from '../types'

const FUEL_TYPES: { label: string; value: FuelType }[] = [
  { label: 'Petrol', value: 'petrol' },
  { label: 'Diesel', value: 'diesel' },
  { label: 'CNG', value: 'cng' },
  { label: 'Electric', value: 'ev' },
]

const EMPTY = {
  model: '',
  reg_number: '',
  color: '',
  seating_capacity: 4,
  fuel_type: 'petrol' as FuelType,
  mileage_kmpl: 15,
}

export default function Vehicles() {
  const toast = useToast()
  const vehicles = useAsync<Vehicle[]>(
    () => api.get('/vehicles').then((r) => r.data),
    [],
  )
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY })
    setError(null)
    setOpen(true)
  }
  function openEdit(v: Vehicle) {
    setEditing(v)
    setForm({
      model: v.model,
      reg_number: v.reg_number,
      color: v.color ?? '',
      seating_capacity: v.seating_capacity,
      fuel_type: v.fuel_type,
      mileage_kmpl: v.mileage_kmpl ?? 15,
    })
    setError(null)
    setOpen(true)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (form.seating_capacity < 1) {
      setError('Seating capacity must be at least 1.')
      return
    }
    if (form.mileage_kmpl <= 0) {
      setError('Mileage must be greater than 0.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      if (editing) await api.patch(`/vehicles/${editing.id}`, form)
      else await api.post('/vehicles', form)
      setOpen(false)
      vehicles.reload()
      toast.success(editing ? 'Vehicle updated.' : 'Vehicle added.')
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail
      const msg = detail ?? 'Save failed — please try again.'
      setError(msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  async function softDelete(v: Vehicle) {
    if (!confirm(`Remove ${v.model} (${v.reg_number})?`)) return
    setListError(null)
    try {
      await api.delete(`/vehicles/${v.id}`)
      vehicles.reload()
      toast.success('Vehicle removed.')
    } catch {
      setListError('Delete failed — please try again.')
      toast.error('Delete failed.')
    }
  }

  const list = (vehicles.data ?? []).filter((v) => v.is_active)

  return (
    <div>
      <PageHeader
        eyebrow="05 / Fleet"
        title="Vehicles"
        description="Register the cars you drive. Mileage feeds fuel & cost reporting."
        actions={<Button onClick={openNew}>Add vehicle</Button>}
      />

      {listError && (
        <div className="mb-6 rounded-[10px] border border-danger/30 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
          {listError}
        </div>
      )}

      {vehicles.loading && list.length === 0 ? (
        <Card padded={false}>
          <ListSkeleton rows={3} />
        </Card>
      ) : list.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            title="No vehicles yet"
            description="Add the car you drive so you can offer seats to colleagues."
            actionLabel="Add vehicle"
            onAction={openNew}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {list.map((v) => (
            <Card key={v.id} className="flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between">
                  <div className="eyebrow">{v.reg_number}</div>
                  <StatusBadge status={v.is_active ? 'active' : 'suspended'} />
                </div>
                <div className="mt-3 font-display text-2xl">{v.model}</div>
                <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4">
                  <Metric label="Seats" value={String(v.seating_capacity)} />
                  <Metric
                    label="Mileage"
                    value={v.mileage_kmpl != null ? `${v.mileage_kmpl}` : '—'}
                    unit="km/l"
                  />
                  <Metric label="Fuel" value={v.fuel_type} />
                </div>
              </div>
              <div className="mt-5 flex gap-3">
                <Button size="sm" variant="secondary" onClick={() => openEdit(v)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => softDelete(v)}>
                  Remove
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        eyebrow={editing ? 'Edit vehicle' : 'New vehicle'}
        title={editing ? editing.model : 'Add vehicle'}
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Model"
              required
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
            <Input
              label="Reg. number"
              required
              value={form.reg_number}
              onChange={(e) => setForm({ ...form, reg_number: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Fuel type"
              value={form.fuel_type}
              onChange={(e) => setForm({ ...form, fuel_type: e.target.value as FuelType })}
            >
              {FUEL_TYPES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
            <Input
              label="Colour"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Seats"
              type="number"
              min={1}
              max={8}
              required
              value={form.seating_capacity}
              onChange={(e) =>
                setForm({ ...form, seating_capacity: Number(e.target.value) || 0 })
              }
            />
            <Input
              label="Mileage (km/l)"
              type="number"
              min={0.1}
              step="0.1"
              required
              value={form.mileage_kmpl}
              onChange={(e) =>
                setForm({ ...form, mileage_kmpl: Number(e.target.value) || 0 })
              }
            />
          </div>
          {error && (
            <div className="rounded-[10px] border border-danger/40 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save vehicle'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function Metric({
  label,
  value,
  unit,
}: {
  label: string
  value: string
  unit?: string
}) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mt-1 font-mono text-[14px]">
        {value}
        {unit && <span className="ml-1 text-g-500">{unit}</span>}
      </div>
    </div>
  )
}

import { useRef, useState, type FormEvent } from 'react'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import Button from '../components/Button'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import EmptyState from '../components/EmptyState'
import { ListSkeleton } from '../components/Skeleton'
import { Input, Select } from '../components/Field'
import { useAsync } from '../lib/useAsync'
import { useToast } from '../context/ToastContext'
import api from '../lib/api'
import type { Document } from '../types'
import { dateLabel } from '../lib/format'
import { fileToDataUrl, formatBytes } from '../lib/image'

const DOC_TYPES = [
  { label: 'Driving Licence', value: 'driving_license' },
  { label: 'Vehicle RC', value: 'vehicle_rc' },
  { label: 'Insurance', value: 'vehicle_insurance' },
  { label: 'ID Proof', value: 'id_proof' },
]

const DOC_LABEL: Record<string, string> = Object.fromEntries(
  DOC_TYPES.map((t) => [t.value, t.label]),
)

const EMPTY = {
  doc_type: DOC_TYPES[0].value,
  doc_number: '',
  expiry_date: '',
  file_url: '',
}

export default function Documents() {
  const toast = useToast()
  const docs = useAsync<Document[]>(
    () => api.get('/documents').then((r) => r.data),
    [],
  )
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileMeta, setFileMeta] = useState<{ name: string; size: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function reset() {
    setForm({ ...EMPTY })
    setFileMeta(null)
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const dataUrl = await fileToDataUrl(file)
      setForm((f) => ({ ...f, file_url: dataUrl }))
      setFileMeta({ name: file.name, size: file.size })
    } catch (err) {
      setForm((f) => ({ ...f, file_url: '' }))
      setFileMeta(null)
      if (fileRef.current) fileRef.current.value = ''
      setError((err as Error).message)
    }
  }

  async function upload(e: FormEvent) {
    e.preventDefault()
    if (!form.file_url) {
      setError('Please attach the document file (PDF or image, max 5 MB).')
      return
    }
    if (form.doc_type === 'driving_license' && !form.expiry_date) {
      setError('Expiry date is required for a driving licence.')
      return
    }
    if (form.expiry_date) {
      const today = new Date().toISOString().slice(0, 10)
      if (form.expiry_date < today) {
        setError('Expiry date cannot be in the past.')
        return
      }
    }
    setSaving(true)
    setError(null)
    try {
      await api.post('/documents', {
        ...form,
        expiry_date: form.expiry_date || null,
        file_url: form.file_url || null,
      })
      setOpen(false)
      reset()
      docs.reload()
      toast.success('Submitted for review — usually within 1 business day.')
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail
      const msg = typeof detail === 'string' ? detail : 'Upload failed — please try again.'
      setError(msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const rows = docs.data ?? []
  const isImage = form.file_url.startsWith('data:image')

  return (
    <div>
      <PageHeader
        eyebrow="06 / Compliance"
        title="Documents"
        description="Upload licence and vehicle papers. Admins verify before you can drive."
        actions={
          <Button
            onClick={() => {
              reset()
              setOpen(true)
            }}
          >
            Upload document
          </Button>
        }
      />

      <div className="mb-5 rounded-[12px] border border-line bg-paper-raised px-4 py-3 font-mono text-[12px] text-g-500">
        Pending reviews usually clear within 1 business day. You will get a notification when
        verified or rejected.
      </div>

      {docs.loading && rows.length === 0 ? (
        <Card padded={false}>
          <ListSkeleton rows={3} />
        </Card>
      ) : rows.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            title="No documents yet"
            description="Upload your driving licence first if you plan to offer rides."
            actionLabel="Upload document"
            onAction={() => {
              reset()
              setOpen(true)
            }}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {rows.map((d) => (
            <Card key={d.id} className="!p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="eyebrow">{DOC_LABEL[d.doc_type] ?? d.doc_type}</div>
                  <div className="mt-1 font-mono text-[13px]">{d.doc_number ?? '—'}</div>
                  <div className="mt-2 font-mono text-[11px] text-g-500">
                    Expiry {dateLabel(d.expiry_date ?? undefined)}
                  </div>
                </div>
                <StatusBadge status={d.status} />
              </div>
              {d.status === 'pending' && (
                <p className="mt-3 font-body text-[13px] text-ink-soft">
                  Under review — usually 1 business day.
                </p>
              )}
              {d.status === 'rejected' && d.rejection_reason && (
                <p className="mt-3 rounded-[8px] border border-danger/25 bg-danger-soft px-3 py-2 font-mono text-[11px] text-danger">
                  {d.rejection_reason}
                </p>
              )}
              {d.file_url && (
                <a
                  href={d.file_url.startsWith('/') ? d.file_url : d.file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block link-underline font-mono text-[12px]"
                >
                  View file →
                </a>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="New document"
        title="Upload document"
      >
        <form onSubmit={upload} className="space-y-4">
          <Select
            label="Document type"
            value={form.doc_type}
            onChange={(e) => setForm({ ...form, doc_type: e.target.value })}
          >
            {DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Input
            label="Document number"
            required
            value={form.doc_number}
            onChange={(e) => setForm({ ...form, doc_number: e.target.value })}
          />
          <Input
            label={
              form.doc_type === 'driving_license'
                ? 'Expiry date (required)'
                : 'Expiry date'
            }
            type="date"
            required={form.doc_type === 'driving_license'}
            min={new Date().toISOString().slice(0, 10)}
            value={form.expiry_date}
            onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
          />
          <div>
            <div className="eyebrow mb-2">Document file</div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onPickFile}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                {fileMeta ? 'Change file' : 'Choose file'}
              </Button>
              {fileMeta ? (
                <span className="min-w-0 truncate font-mono text-[12px] text-ink-soft">
                  {fileMeta.name} · {formatBytes(fileMeta.size)}
                </span>
              ) : (
                <span className="font-mono text-[11px] text-g-500">
                  PDF or image · max 5 MB
                </span>
              )}
            </div>
            {isImage && form.file_url && (
              <img
                src={form.file_url}
                alt="Preview"
                className="mt-3 max-h-40 rounded-[10px] border border-line object-contain"
              />
            )}
            {fileMeta && !isImage && form.file_url && (
              <div className="mt-3 rounded-[10px] border border-line bg-paper px-3 py-2 font-mono text-[12px] text-g-500">
                PDF attached — ready to submit.
              </div>
            )}
            {saving && (
              <div className="mt-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="h-full w-2/3 animate-pulse rounded-full bg-brand" />
                </div>
                <p className="mt-1 font-mono text-[11px] text-g-500">Uploading…</p>
              </div>
            )}
          </div>
          {error && (
            <div className="rounded-[10px] border border-danger/30 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Uploading…' : 'Submit for review'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

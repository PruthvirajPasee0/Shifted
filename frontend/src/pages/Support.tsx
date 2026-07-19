import { useState, type FormEvent } from 'react'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import Button from '../components/Button'
import StatusBadge from '../components/StatusBadge'
import { Input, Textarea } from '../components/Field'
import Table, { type Column } from '../components/Table'
import { useAsync } from '../lib/useAsync'
import api from '../lib/api'
import type { SupportTicket, TicketStatus } from '../types'
import { dateLabel } from '../lib/format'

function errDetail(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

export default function Support() {
  const tickets = useAsync<SupportTicket[]>(
    () => api.get('/support/tickets').then((r) => r.data),
    [],
  )
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submitTicket(e: FormEvent) {
    e.preventDefault()
    if (subject.trim().length < 3) {
      setError('Subject must be at least 3 characters.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.post('/support/tickets', {
        subject: subject.trim(),
        body: body.trim() || null,
      })
      setSubject('')
      setBody('')
      tickets.reload()
    } catch (err) {
      setError(errDetail(err, 'Could not create ticket.'))
    } finally {
      setSaving(false)
    }
  }

  async function closeTicket(id: string | number) {
    setBusyId(String(id))
    setError(null)
    try {
      await api.patch(`/support/tickets/${id}`, { status: 'closed' })
      tickets.reload()
    } catch (err) {
      setError(errDetail(err, 'Could not close ticket.'))
    } finally {
      setBusyId(null)
    }
  }

  const cols: Column<SupportTicket>[] = [
    { key: 'subject', header: 'Subject', render: (t) => t.subject },
    { key: 'body', header: 'Details', render: (t) => t.body || '—' },
    {
      key: 'status',
      header: 'Status',
      render: (t) => <StatusBadge status={t.status} />,
    },
    { key: 'created', header: 'Created', render: (t) => dateLabel(t.created_at) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (t) => {
        if (t.status === 'closed') {
          return <span className="font-mono text-[11px] text-g-400">Closed</span>
        }
        return (
          <Button
            size="sm"
            variant="ghost"
            disabled={busyId === String(t.id)}
            onClick={() => closeTicket(t.id)}
          >
            {busyId === String(t.id) ? 'Closing…' : 'Close'}
          </Button>
        )
      },
    },
  ]

  const openCount = (tickets.data ?? []).filter((t) => t.status !== 'closed').length

  return (
    <div>
      <PageHeader
        eyebrow="Support"
        title="Help desk"
        description="Create and track support tickets for payments, booking, and trip issues."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="eyebrow mb-4">Raise ticket</div>
          <form onSubmit={submitTicket} className="space-y-4">
            <Input
              label="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Wallet recharge not reflecting"
            />
            <Textarea
              label="Details"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add steps, trip id, and screenshots context."
            />
            {error && (
              <div className="rounded-[10px] border border-danger/40 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
                {error}
              </div>
            )}
            <Button type="submit" block disabled={saving}>
              {saving ? 'Submitting…' : 'Create ticket'}
            </Button>
          </form>
        </Card>

        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div className="eyebrow">My tickets</div>
            <span className="font-mono text-[11px] uppercase tracking-eyebrow text-g-500">
              {openCount} open
            </span>
          </div>
          <Card padded={false}>
            <div className="p-2">
              <Table
                columns={cols}
                rows={tickets.data ?? []}
                keyField={(t) => t.id}
                empty={tickets.loading ? 'Loading…' : 'No support tickets yet.'}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

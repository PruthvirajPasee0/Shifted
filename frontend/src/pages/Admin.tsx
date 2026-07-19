import { useEffect, useMemo, useState, type FormEvent } from 'react'
import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'
import Card from '../components/Card'
import Button from '../components/Button'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import { Input, Textarea } from '../components/Field'
import Table, { type Column } from '../components/Table'
import { useAsync } from '../lib/useAsync'
import api from '../lib/api'
import type {
  AdminStats,
  AdminVehicle,
  Document,
  Organization,
  SupportTicket,
  User,
} from '../types'
import { dateLabel, num } from '../lib/format'

type Tab = 'employees' | 'vehicles' | 'documents' | 'support' | 'settings'

const TABS: { key: Tab; label: string }[] = [
  { key: 'employees', label: 'Employees' },
  { key: 'vehicles', label: 'Vehicles' },
  { key: 'documents', label: 'Documents' },
  { key: 'support', label: 'Support Tickets' },
  { key: 'settings', label: 'Company Settings' },
]

const DOC_LABEL: Record<string, string> = {
  driving_license: 'Driving Licence',
  vehicle_rc: 'Vehicle RC',
  vehicle_insurance: 'Insurance',
  id_proof: 'ID Proof',
}

export default function Admin() {
  const [tab, setTab] = useState<Tab>('employees')
  const [docsTabPrimed, setDocsTabPrimed] = useState(false)

  const stats = useAsync<AdminStats>(() => api.get('/admin/stats').then((r) => r.data), [])
  const users = useAsync<User[]>(() => api.get('/admin/users').then((r) => r.data), [])
  const vehicles = useAsync<AdminVehicle[]>(
    () => api.get('/admin/vehicles').then((r) => r.data),
    [],
  )
  const org = useAsync<Organization>(() => api.get('/admin/org').then((r) => r.data), [])
  const pendingDocs = useAsync<Document[]>(
    () => api.get('/admin/documents', { params: { status: 'pending' } }).then((r) => r.data),
    [],
  )
  const supportTickets = useAsync<SupportTicket[]>(
    () => api.get('/support/admin/tickets').then((r) => r.data),
    [],
  )

  useEffect(() => {
    if (docsTabPrimed || !stats.data) return
    if ((stats.data.pending_documents ?? 0) > 0) {
      setTab('documents')
      setDocsTabPrimed(true)
    }
  }, [stats.data, docsTabPrimed])

  const nameById = useMemo(() => {
    const m = new Map<string | number, string>()
    ;(users.data ?? []).forEach((u) => m.set(u.id, u.name))
    return m
  }, [users.data])

  // --- Employees ---
  const [addOpen, setAddOpen] = useState(false)
  const emptyEmp = {
    name: '',
    email: '',
    phone: '',
    department: '',
    manager: '',
    office_location: '',
    password: 'Employee@123',
  }
  const [emp, setEmp] = useState({ ...emptyEmp })
  const [empErr, setEmpErr] = useState<string | null>(null)
  const [savingEmp, setSavingEmp] = useState(false)

  const [pendingUserId, setPendingUserId] = useState<string | null>(null)
  const [userErr, setUserErr] = useState<string | null>(null)

  async function setUserStatus(u: User, status: string) {
    setPendingUserId(String(u.id))
    setUserErr(null)
    try {
      await api.patch(`/admin/users/${u.id}`, { status })
      users.reload()
      stats.reload()
    } catch {
      setUserErr('Update failed — please try again.')
    } finally {
      setPendingUserId(null)
    }
  }

  const empPhonePattern = /^[6-9][0-9]{9}$/

  async function addEmployee(e: FormEvent) {
    e.preventDefault()
    if (emp.password.length < 6) {
      setEmpErr('Password must be at least 6 characters.')
      return
    }
    if (emp.phone && !empPhonePattern.test(emp.phone)) {
      setEmpErr('Enter a valid phone number.')
      return
    }
    setSavingEmp(true)
    setEmpErr(null)
    try {
      await api.post('/admin/employees', {
        ...emp,
        phone: emp.phone ? Number(emp.phone) : undefined,
      })
      setAddOpen(false)
      setEmp({ ...emptyEmp })
      users.reload()
      stats.reload()
    } catch (err: unknown) {
      setEmpErr(
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          'Could not add employee.',
      )
    } finally {
      setSavingEmp(false)
    }
  }

  // --- Documents ---
  const [rejectDoc, setRejectDoc] = useState<Document | null>(null)
  const [reason, setReason] = useState('')

  const [pendingDocId, setPendingDocId] = useState<string | null>(null)
  const [docErr, setDocErr] = useState<string | null>(null)
  const [pendingTicketId, setPendingTicketId] = useState<string | null>(null)
  const [ticketErr, setTicketErr] = useState<string | null>(null)

  async function verifyDoc(d: Document, status: 'verified' | 'rejected', rej?: string) {
    setPendingDocId(String(d.id))
    setDocErr(null)
    try {
      await api.patch(`/admin/documents/${d.id}/verify`, { status, rejection_reason: rej })
      pendingDocs.reload()
      stats.reload()
    } catch {
      setDocErr('Verification failed — please try again.')
    } finally {
      setPendingDocId(null)
    }
  }

  async function submitReject(e: FormEvent) {
    e.preventDefault()
    if (!rejectDoc) return
    if (!reason.trim()) {
      setDocErr('Please enter a rejection reason.')
      return
    }
    await verifyDoc(rejectDoc, 'rejected', reason.trim())
    setRejectDoc(null)
    setReason('')
  }

  async function setTicketStatus(id: string | number, status: 'in_progress' | 'closed') {
    setPendingTicketId(String(id))
    setTicketErr(null)
    try {
      await api.patch(`/support/admin/tickets/${id}`, { status })
      supportTickets.reload()
    } catch {
      setTicketErr('Ticket update failed — please try again.')
    } finally {
      setPendingTicketId(null)
    }
  }

  // --- Company settings ---
  const [orgForm, setOrgForm] = useState<Organization | null>(null)
  const [savedOrg, setSavedOrg] = useState(false)
  useEffect(() => {
    if (org.data && !orgForm) setOrgForm(org.data)
  }, [org.data, orgForm])

  const [orgErr, setOrgErr] = useState<string | null>(null)

  async function saveOrg(e: FormEvent) {
    e.preventDefault()
    if (!orgForm) return
    const costFields: [string, number | null | undefined][] = [
      ['Fuel cost / litre', orgForm.fuel_cost_per_litre],
      ['Cost per km', orgForm.cost_per_km],
      ['Travel cost', orgForm.travel_cost],
    ]
    const negative = costFields.find(([, v]) => typeof v === 'number' && v < 0)
    if (negative) {
      setOrgErr(`${negative[0]} cannot be negative.`)
      return
    }
    setOrgErr(null)
    setSavedOrg(false)
    try {
      await api.patch('/admin/org', {
        name: orgForm.name,
        address: orgForm.address,
        industry: orgForm.industry,
        admin_contact: orgForm.admin_contact,
        fuel_cost_per_litre: orgForm.fuel_cost_per_litre,
        cost_per_km: orgForm.cost_per_km,
        travel_cost: orgForm.travel_cost,
      })
      setSavedOrg(true)
    } catch {
      setOrgErr('Save failed — please try again.')
    }
  }

  function orgSet<K extends keyof Organization>(k: K, v: Organization[K]) {
    setOrgForm((f) => (f ? { ...f, [k]: v } : f))
    setSavedOrg(false)
  }

  const userCols: Column<User>[] = [
    { key: 'name', header: 'Name', render: (u) => u.name },
    {
      key: 'email',
      header: 'Email',
      render: (u) => <span className="font-mono text-[12px]">{u.email}</span>,
    },
    { key: 'department', header: 'Department', render: (u) => u.department ?? '—' },
    { key: 'manager', header: 'Manager', render: (u) => u.manager ?? '—' },
    { key: 'office_location', header: 'Location', render: (u) => u.office_location ?? '—' },
    {
      key: 'status',
      header: 'Access',
      render: (u) => (
        <StatusBadge
          status={
            u.status === 'suspended'
              ? 'revoked'
              : u.status === 'invited'
                ? 'pending'
                : 'granted'
          }
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (u) => {
        const busy = pendingUserId === String(u.id)
        if (u.role === 'admin') {
          return <span className="font-mono text-[11px] text-g-400">—</span>
        }
        if (u.status === 'invited' || u.status === 'suspended') {
          return (
            <Button size="sm" disabled={busy} onClick={() => setUserStatus(u, 'active')}>
              {busy
                ? 'Approving…'
                : u.status === 'invited'
                  ? 'Approve'
                  : 'Grant access'}
            </Button>
          )
        }
        return (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => setUserStatus(u, 'suspended')}
          >
            {busy ? 'Revoking…' : 'Revoke'}
          </Button>
        )
      },
    },
  ]

  const vehicleCols: Column<AdminVehicle>[] = [
    {
      key: 'reg',
      header: 'Reg. number',
      render: (v) => <span className="font-mono text-[13px]">{v.reg_number}</span>,
    },
    { key: 'model', header: 'Model', render: (v) => v.model },
    { key: 'seats', header: 'Seating', align: 'right', render: (v) => v.seating_capacity },
    { key: 'driver', header: 'Driver', render: (v) => v.owner_name ?? '—' },
    { key: 'fuel', header: 'Fuel', render: (v) => v.fuel_type },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (v) => <StatusBadge status={v.is_active ? 'active' : 'inactive'} />,
    },
  ]

  const docCols: Column<Document>[] = [
    {
      key: 'user',
      header: 'Employee',
      render: (d) => nameById.get(d.user_id ?? '') ?? `#${d.user_id}`,
    },
    { key: 'type', header: 'Type', render: (d) => DOC_LABEL[d.doc_type] ?? d.doc_type },
    {
      key: 'number',
      header: 'Number',
      render: (d) => <span className="font-mono text-[12px]">{d.doc_number ?? '—'}</span>,
    },
    { key: 'expiry', header: 'Expiry', render: (d) => dateLabel(d.expiry_date ?? undefined) },
    {
      key: 'file',
      header: 'File',
      render: (d) =>
        d.file_url ? (
          <a
            href={d.file_url}
            target="_blank"
            rel="noreferrer"
            className="link-underline font-mono text-[12px] text-brand-strong"
          >
            View →
          </a>
        ) : (
          '—'
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (d) => {
        const busy = pendingDocId === String(d.id)
        return (
          <div className="flex justify-end gap-2">
            <Button size="sm" disabled={busy} onClick={() => verifyDoc(d, 'verified')}>
              {busy ? 'Verifying…' : 'Verify'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setRejectDoc(d)}
            >
              Reject
            </Button>
          </div>
        )
      },
    },
  ]

  const ticketCols: Column<SupportTicket>[] = [
    { key: 'subject', header: 'Subject', render: (t) => t.subject },
    {
      key: 'employee',
      header: 'Employee',
      render: (t) => (
        <div>
          <div>{t.user_name ?? '—'}</div>
          <div className="font-mono text-[11px] text-g-500">{t.user_email ?? '—'}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => <StatusBadge status={t.status} />,
    },
    {
      key: 'created',
      header: 'Created',
      render: (t) => dateLabel(t.created_at),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (t) => {
        const busy = pendingTicketId === String(t.id)
        if (t.status === 'closed') {
          return <span className="font-mono text-[11px] text-g-400">Resolved</span>
        }
        return (
          <div className="flex justify-end gap-2">
            {t.status === 'open' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setTicketStatus(t.id, 'in_progress')}
              >
                {busy ? 'Updating…' : 'Start'}
              </Button>
            )}
            <Button
              size="sm"
              disabled={busy}
              onClick={() => setTicketStatus(t.id, 'closed')}
            >
              {busy ? 'Updating…' : 'Close'}
            </Button>
          </div>
        )
      },
    },
  ]

  const st = stats.data
  const supportOpen = (supportTickets.data ?? []).filter((x) => x.status !== 'closed').length

  return (
    <div>
      <PageHeader
        eyebrow="Company Administration"
        title="Admin console"
        description="Manage employees, vehicles, driver verification and organisation settings."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void api.get('/reports/export.csv', { responseType: 'blob' }).then((res) => {
                  const url = URL.createObjectURL(res.data)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = 'shifted-report.csv'
                  a.click()
                  URL.revokeObjectURL(url)
                })
              }}
            >
              Export CSV
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void api.get('/reports/export.pdf', { responseType: 'blob' }).then((res) => {
                  const url = URL.createObjectURL(res.data)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = 'shifted-report.pdf'
                  a.click()
                  URL.revokeObjectURL(url)
                })
              }}
            >
              Export PDF
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard eyebrow="Total employees" index="01" value={num(st?.total_employees)} inverted />
        <StatCard eyebrow="Registered vehicles" index="02" value={num(st?.registered_vehicles)} />
        <StatCard eyebrow="Rides this month" index="03" value={num(st?.rides_this_month)} />
        <button
          type="button"
          onClick={() => setTab('documents')}
          className="text-left"
        >
          <StatCard
            eyebrow="Pending documents"
            index="04"
            value={num(st?.pending_documents)}
            hint="Tap to verify queue · clear blockers for drivers"
          />
        </button>
      </div>

      {(st?.pending_documents ?? 0) > 0 && tab !== 'documents' && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-warning/40 bg-warning-soft px-4 py-3">
          <div className="font-mono text-[12px] text-warning">
            {st?.pending_documents} document(s) waiting for verification — drivers cannot offer
            rides until approved.
          </div>
          <Button size="sm" onClick={() => setTab('documents')}>
            Review now
          </Button>
        </div>
      )}

      {/* Tabs */}
      <div className="mt-9 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative px-4 py-3 font-mono text-[12px] uppercase tracking-eyebrow transition-colors ${
              tab === t.key ? 'text-brand-strong' : 'text-g-500 hover:text-ink'
            }`}
          >
            {t.label}
            {t.key === 'employees' && (st?.pending_approvals ?? 0) > 0 && (
              <span className="ml-2 rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] text-warning">
                {st?.pending_approvals}
              </span>
            )}
            {t.key === 'documents' && (st?.pending_documents ?? 0) > 0 && (
              <span className="ml-2 rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] text-warning">
                {st?.pending_documents}
              </span>
            )}
            {t.key === 'support' && supportOpen > 0 && (
              <span className="ml-2 rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] text-warning">
                {supportOpen}
              </span>
            )}
            {tab === t.key && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-brand" />
            )}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === 'employees' && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div className="eyebrow">Employee directory</div>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                + Add employee
              </Button>
            </div>
            {userErr && (
              <div className="mb-4 rounded-[10px] border border-danger/30 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
                {userErr}
              </div>
            )}
            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {(users.data ?? []).length === 0 ? (
                <Card className="!p-5">
                  <p className="font-mono text-[12px] text-g-500">
                    {users.loading ? 'Loading…' : 'No employees found.'}
                  </p>
                </Card>
              ) : (
                (users.data ?? []).map((u) => {
                  const busy = pendingUserId === String(u.id)
                  return (
                    <Card key={u.id} className="!p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-body text-[15px] font-medium">{u.name}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-g-500">{u.email}</div>
                          <div className="mt-1 font-mono text-[11px] text-g-500">
                            {[u.department, u.office_location].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </div>
                        <StatusBadge
                          status={
                            u.status === 'suspended'
                              ? 'revoked'
                              : u.status === 'invited'
                                ? 'pending'
                                : 'granted'
                          }
                        />
                      </div>
                      {u.role !== 'admin' && (
                        <div className="mt-3 flex gap-2">
                          {u.status === 'invited' || u.status === 'suspended' ? (
                            <Button size="sm" disabled={busy} onClick={() => setUserStatus(u, 'active')}>
                              {busy
                                ? 'Approving…'
                                : u.status === 'invited'
                                  ? 'Approve'
                                  : 'Grant access'}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => setUserStatus(u, 'suspended')}
                            >
                              {busy ? 'Revoking…' : 'Revoke'}
                            </Button>
                          )}
                        </div>
                      )}
                    </Card>
                  )
                })
              )}
            </div>
            <Card padded={false} className="hidden md:block">
              <div className="p-2">
                <Table
                  columns={userCols}
                  rows={users.data ?? []}
                  keyField={(u) => u.id}
                  empty={users.loading ? 'Loading…' : 'No employees found.'}
                />
              </div>
            </Card>
          </>
        )}

        {tab === 'vehicles' && (
          <>
            <div className="space-y-3 md:hidden">
              {(vehicles.data ?? []).length === 0 ? (
                <Card className="!p-5">
                  <p className="font-mono text-[12px] text-g-500">
                    {vehicles.loading ? 'Loading…' : 'No vehicles registered.'}
                  </p>
                </Card>
              ) : (
                (vehicles.data ?? []).map((v) => (
                  <Card key={v.id} className="!p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-body text-[15px] font-medium">{v.model}</div>
                        <div className="mt-0.5 font-mono text-[12px]">{v.reg_number}</div>
                        <div className="mt-1 font-mono text-[11px] text-g-500">
                          {v.owner_name ?? '—'} · {v.seating_capacity} seats · {v.fuel_type}
                        </div>
                      </div>
                      <StatusBadge status={v.is_active ? 'active' : 'inactive'} />
                    </div>
                  </Card>
                ))
              )}
            </div>
            <Card padded={false} className="hidden md:block">
              <div className="p-2">
                <Table
                  columns={vehicleCols}
                  rows={vehicles.data ?? []}
                  keyField={(v) => v.id}
                  empty={vehicles.loading ? 'Loading…' : 'No vehicles registered.'}
                />
              </div>
            </Card>
          </>
        )}

        {tab === 'documents' && (
          <>
            {docErr && (
              <div className="mb-4 rounded-[10px] border border-danger/30 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
                {docErr}
              </div>
            )}
            <div className="space-y-3 md:hidden">
              {(pendingDocs.data ?? []).length === 0 ? (
                <Card className="!p-5">
                  <p className="font-mono text-[12px] text-g-500">
                    {pendingDocs.loading
                      ? 'Loading…'
                      : 'No documents awaiting verification.'}
                  </p>
                </Card>
              ) : (
                (pendingDocs.data ?? []).map((d) => {
                  const busy = pendingDocId === String(d.id)
                  return (
                    <Card key={d.id} className="!p-4">
                      <div className="font-body text-[15px] font-medium">
                        {nameById.get(d.user_id ?? '') ?? `#${d.user_id}`}
                      </div>
                      <div className="mt-1 font-mono text-[12px] text-g-600">
                        {DOC_LABEL[d.doc_type] ?? d.doc_type}
                        {d.doc_number ? ` · ${d.doc_number}` : ''}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-g-500">
                        Expiry {dateLabel(d.expiry_date ?? undefined)}
                      </div>
                      {d.file_url && (
                        <a
                          href={d.file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-block font-mono text-[12px] text-brand-strong"
                        >
                          View file →
                        </a>
                      )}
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" disabled={busy} onClick={() => verifyDoc(d, 'verified')}>
                          {busy ? 'Verifying…' : 'Verify'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setRejectDoc(d)}
                        >
                          Reject
                        </Button>
                      </div>
                    </Card>
                  )
                })
              )}
            </div>
            <Card padded={false} className="hidden md:block">
              <div className="p-2">
                <Table
                  columns={docCols}
                  rows={pendingDocs.data ?? []}
                  keyField={(d) => d.id}
                  empty={pendingDocs.loading ? 'Loading…' : 'No documents awaiting verification.'}
                />
              </div>
            </Card>
          </>
        )}

        {tab === 'support' && (
          <>
            {ticketErr && (
              <div className="mb-4 rounded-[10px] border border-danger/30 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
                {ticketErr}
              </div>
            )}
            <div className="space-y-3 md:hidden">
              {(supportTickets.data ?? []).length === 0 ? (
                <Card className="!p-5">
                  <p className="font-mono text-[12px] text-g-500">
                    {supportTickets.loading ? 'Loading…' : 'No support tickets.'}
                  </p>
                </Card>
              ) : (
                (supportTickets.data ?? []).map((t) => {
                  const busy = pendingTicketId === String(t.id)
                  return (
                    <Card key={t.id} className="!p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-body text-[15px] font-medium">{t.subject}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-g-500">
                            {t.user_name ?? '—'} · {dateLabel(t.created_at)}
                          </div>
                        </div>
                        <StatusBadge status={t.status} />
                      </div>
                      {t.status !== 'closed' && (
                        <div className="mt-3 flex gap-2">
                          {t.status === 'open' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => setTicketStatus(t.id, 'in_progress')}
                            >
                              {busy ? 'Updating…' : 'Start'}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => setTicketStatus(t.id, 'closed')}
                          >
                            {busy ? 'Updating…' : 'Close'}
                          </Button>
                        </div>
                      )}
                    </Card>
                  )
                })
              )}
            </div>
            <Card padded={false} className="hidden md:block">
              <div className="p-2">
                <Table
                  columns={ticketCols}
                  rows={supportTickets.data ?? []}
                  keyField={(t) => t.id}
                  empty={supportTickets.loading ? 'Loading…' : 'No support tickets.'}
                />
              </div>
            </Card>
          </>
        )}

        {tab === 'settings' && orgForm && (
          <form onSubmit={saveOrg} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <div className="eyebrow mb-5">Company details</div>
              <div className="space-y-4">
                <Input
                  label="Company name"
                  value={orgForm.name ?? ''}
                  onChange={(e) => orgSet('name', e.target.value)}
                />
                <Input
                  label="Industry"
                  value={orgForm.industry ?? ''}
                  onChange={(e) => orgSet('industry', e.target.value)}
                />
                <Input
                  label="Registered address"
                  value={orgForm.address ?? ''}
                  onChange={(e) => orgSet('address', e.target.value)}
                />
                <Input
                  label="Admin contact"
                  value={orgForm.admin_contact ?? ''}
                  onChange={(e) => orgSet('admin_contact', e.target.value)}
                />
              </div>
            </Card>

            <Card>
              <div className="eyebrow mb-5">Carpooling configuration</div>
              <div className="space-y-4">
                <Input
                  label="Fuel cost / litre (₹)"
                  type="number"
                  step="0.01"
                  min={0}
                  value={String(orgForm.fuel_cost_per_litre ?? '')}
                  onChange={(e) => orgSet('fuel_cost_per_litre', Number(e.target.value))}
                />
                <Input
                  label="Cost per km (₹)"
                  type="number"
                  step="0.01"
                  min={0}
                  value={String(orgForm.cost_per_km ?? '')}
                  onChange={(e) => orgSet('cost_per_km', Number(e.target.value))}
                />
                <Input
                  label="Travel cost — operational (₹ / km)"
                  type="number"
                  step="0.01"
                  min={0}
                  value={String(orgForm.travel_cost ?? '')}
                  onChange={(e) => orgSet('travel_cost', Number(e.target.value))}
                />
                {orgErr && (
                  <div className="rounded-[10px] border border-danger/30 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
                    {orgErr}
                  </div>
                )}
                <div className="flex items-center justify-between pt-2">
                  {savedOrg ? (
                    <span className="font-mono text-[12px] text-success">Saved ✓</span>
                  ) : (
                    <span className="font-mono text-[11px] text-g-400">
                      Used across cost &amp; fuel reports
                    </span>
                  )}
                  <Button type="submit">Save settings</Button>
                </div>
              </div>
            </Card>
          </form>
        )}
      </div>

      {/* Add employee modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        eyebrow="New employee"
        title="Add employee"
      >
        <form onSubmit={addEmployee} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Full name"
              required
              value={emp.name}
              onChange={(e) => setEmp({ ...emp, name: e.target.value })}
            />
            <Input
              label="Work email"
              type="email"
              required
              value={emp.email}
              onChange={(e) => setEmp({ ...emp, email: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Phone"
              type="tel"
              value={emp.phone}
              onChange={(e) => setEmp({ ...emp, phone: e.target.value })}
              error={
                emp.phone && !empPhonePattern.test(emp.phone)
                  ? 'Enter a valid phone number.'
                  : undefined
              }
            />
            <Input
              label="Department"
              value={emp.department}
              onChange={(e) => setEmp({ ...emp, department: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Manager"
              value={emp.manager}
              onChange={(e) => setEmp({ ...emp, manager: e.target.value })}
            />
            <Input
              label="Office location"
              value={emp.office_location}
              onChange={(e) => setEmp({ ...emp, office_location: e.target.value })}
            />
          </div>
          <Input
            label="Temporary password"
            hint="Share with the employee; they can change it later."
            minLength={6}
            value={emp.password}
            onChange={(e) => setEmp({ ...emp, password: e.target.value })}
            error={
              emp.password && emp.password.length < 6
                ? 'At least 6 characters.'
                : undefined
            }
          />
          {empErr && (
            <div className="rounded-[10px] border border-danger/30 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
              {empErr}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={savingEmp}>
              {savingEmp ? 'Adding…' : 'Add employee'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Reject document modal */}
      <Modal
        open={!!rejectDoc}
        onClose={() => setRejectDoc(null)}
        eyebrow="Reject document"
        title={rejectDoc ? DOC_LABEL[rejectDoc.doc_type] ?? 'Reject' : 'Reject'}
      >
        <form onSubmit={submitReject} className="space-y-4">
          <Textarea
            label="Rejection reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why this document is being rejected…"
          />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setRejectDoc(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger">
              Confirm rejection
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

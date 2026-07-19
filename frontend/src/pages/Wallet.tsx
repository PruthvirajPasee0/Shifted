import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import Button from '../components/Button'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import { ListSkeleton } from '../components/Skeleton'
import { Input } from '../components/Field'
import Table, { type Column } from '../components/Table'
import { useAsync } from '../lib/useAsync'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import api from '../lib/api'
import type {
  RazorpayOrder,
  SavedPaymentMethod,
  SavedPaymentMethodType,
  Wallet as WalletT,
  WalletTxn,
} from '../types'
import { openRazorpayCheckout } from '../lib/razorpay'
import { money, dateLabel } from '../lib/format'

const METHOD_OPTIONS: { label: string; value: SavedPaymentMethodType; placeholder: string }[] = [
  { label: 'UPI', value: 'upi', placeholder: 'name@bank' },
  { label: 'Card', value: 'card', placeholder: '4111 1111 1111 1111' },
]

export default function Wallet() {
  const { user } = useAuth()
  const toast = useToast()
  const wallet = useAsync<WalletT>(
    () => api.get('/wallet').then((r) => r.data),
    [],
  )
  const savedMethods = useAsync<SavedPaymentMethod[]>(
    () => api.get('/payment-methods').then((r) => r.data),
    [],
  )
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('500')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [simNote, setSimNote] = useState(false)
  const [methodOpen, setMethodOpen] = useState(false)
  const [methodType, setMethodType] = useState<SavedPaymentMethodType>('upi')
  const [methodDetail, setMethodDetail] = useState('')
  const [methodLabel, setMethodLabel] = useState('')
  const [methodDefault, setMethodDefault] = useState(false)
  const [methodSaving, setMethodSaving] = useState(false)
  const [methodErr, setMethodErr] = useState<string | null>(null)
  const [methodBusyId, setMethodBusyId] = useState<string | null>(null)

  const parsedAmount = Number(amount)
  const amountValid = amount.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0
  const detailValid = methodDetail.trim().length >= 3

  function apiErr(err: unknown, fallback: string): string {
    const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    return typeof detail === 'string' ? detail : fallback
  }

  async function simulatedRecharge() {
    await api.post('/wallet/recharge', { amount: parsedAmount, method: 'upi' })
    setSimNote(true)
    setOpen(false)
    wallet.reload()
    toast.success(`Added ${money(parsedAmount)} to wallet.`)
  }

  async function recharge(e: FormEvent) {
    e.preventDefault()
    if (!amountValid) {
      setError('Enter an amount greater than 0.')
      return
    }
    setError(null)
    setSimNote(false)
    setSaving(true)
    try {
      const { data: order } = await api.post<RazorpayOrder>('/wallet/recharge/order', {
        amount: parsedAmount,
      })
      await openRazorpayCheckout({
        order,
        name: 'Shifted',
        description: `Wallet recharge · ${money(parsedAmount)}`,
        prefill: {
          name: user?.name,
          email: user?.email,
          contact: user?.phone != null ? String(user.phone) : undefined,
        },
        onSuccess: async (resp) => {
          try {
            await api.post('/wallet/recharge/verify', resp)
            setOpen(false)
            wallet.reload()
            toast.success(`Added ${money(parsedAmount)} to wallet.`)
          } catch {
            setError('Payment captured but could not be verified. Please contact support.')
            toast.error('Could not verify payment.')
          } finally {
            setSaving(false)
          }
        },
        onDismiss: () => setSaving(false),
      })
    } catch (err: unknown) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      // Razorpay not configured (503) or order failed → simulated credit for demos.
      if (status === 503 || status === 400 || status === 501) {
        try {
          await simulatedRecharge()
        } catch {
          setError('Could not recharge wallet. Please try again.')
        } finally {
          setSaving(false)
        }
        return
      }
      setError('Could not start payment. Please try again.')
      setSaving(false)
    }
  }

  function resetMethodForm() {
    setMethodType('upi')
    setMethodDetail('')
    setMethodLabel('')
    setMethodDefault(false)
    setMethodErr(null)
  }

  async function saveMethod(e: FormEvent) {
    e.preventDefault()
    if (!detailValid) {
      setMethodErr('Enter valid method detail.')
      return
    }
    setMethodSaving(true)
    setMethodErr(null)
    try {
      await api.post('/payment-methods', {
        type: methodType,
        detail: methodDetail.trim(),
        label: methodLabel.trim() || null,
        is_default: methodDefault,
      })
      setMethodOpen(false)
      resetMethodForm()
      savedMethods.reload()
    } catch (err) {
      setMethodErr(apiErr(err, 'Could not save payment method.'))
    } finally {
      setMethodSaving(false)
    }
  }

  async function markDefault(methodId: string | number) {
    setMethodBusyId(String(methodId))
    setMethodErr(null)
    try {
      await api.patch(`/payment-methods/${methodId}`, { is_default: true })
      savedMethods.reload()
    } catch (err) {
      setMethodErr(apiErr(err, 'Could not update default method.'))
    } finally {
      setMethodBusyId(null)
    }
  }

  async function removeMethod(methodId: string | number) {
    if (!window.confirm('Remove this saved payment method?')) return
    setMethodBusyId(String(methodId))
    setMethodErr(null)
    try {
      await api.delete(`/payment-methods/${methodId}`)
      savedMethods.reload()
    } catch (err) {
      setMethodErr(apiErr(err, 'Could not remove payment method.'))
    } finally {
      setMethodBusyId(null)
    }
  }

  const txns = wallet.data?.transactions ?? []
  const recent = txns.slice(0, 5)

  const cols: Column<WalletTxn>[] = [
    { key: 'date', header: 'Date', render: (t) => dateLabel(t.created_at) },
    {
      key: 'desc',
      header: 'Description',
      render: (t) =>
        t.type === 'recharge'
          ? 'Wallet recharge'
          : t.type === 'debit'
            ? 'Ride payment'
            : 'Credit',
    },
    {
      key: 'type',
      header: 'Type',
      render: (t) => (
        <StatusBadge status={t.type === 'recharge' ? 'active' : t.type} />
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (t) => (
        <span className="font-mono">
          {t.type === 'debit' ? '−' : '+'}
          {money(t.amount)}
        </span>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="07 / Wallet"
        title="Wallet"
        description="Top up once, pay for rides seamlessly across your organisation."
        actions={<Button onClick={() => setOpen(true)}>Recharge</Button>}
      />

      {simNote && (
        <div className="mb-4 rounded-[10px] border border-line bg-paper-raised px-4 py-3 font-mono text-[12px] text-g-600">
          Razorpay unavailable — credited via simulated recharge for this demo.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card inverted className="lg:col-span-1">
          <div className="eyebrow !text-g-400">Available balance</div>
          {wallet.loading && wallet.data == null ? (
            <div className="mt-6 h-16 w-40 animate-pulse rounded bg-white/20" />
          ) : (
            <div className="numeral mt-6 text-[clamp(48px,7vw,72px)]">
              {money(wallet.data?.balance ?? 0)}
            </div>
          )}
          <p className="mt-3 text-sm text-g-300">
            Use wallet for instant fare settlement after trips.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Button
              onClick={() => setOpen(true)}
              variant="secondary"
              className="!border-paper !text-paper hover:!bg-paper hover:!text-ink"
            >
              Add money
            </Button>
            <Link to="/trips">
              <Button
                variant="ghost"
                block
                className="!text-paper hover:!bg-white/10"
              >
                Pay next fare →
              </Button>
            </Link>
          </div>
        </Card>

        <div className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="eyebrow">Recent activity</div>
          </div>
          {wallet.loading && recent.length === 0 ? (
            <Card padded={false}>
              <ListSkeleton rows={3} />
            </Card>
          ) : recent.length === 0 ? (
            <Card className="!p-5">
              <p className="font-body text-[14px] text-g-500">
                No transactions yet. Top up to pay rides from wallet.
              </p>
            </Card>
          ) : (
            <div className="mb-6 space-y-2">
              {recent.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-[12px] border border-line bg-paper-raised px-4 py-3"
                >
                  <div>
                    <div className="font-body text-[14px]">
                      {t.type === 'recharge'
                        ? 'Wallet recharge'
                        : t.type === 'debit'
                          ? 'Ride payment'
                          : 'Credit'}
                    </div>
                    <div className="font-mono text-[11px] text-g-500">
                      {dateLabel(t.created_at)}
                    </div>
                  </div>
                  <div
                    className={`font-mono text-[14px] font-medium ${
                      t.type === 'debit' ? 'text-danger' : 'text-success'
                    }`}
                  >
                    {t.type === 'debit' ? '−' : '+'}
                    {money(t.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mb-4 flex items-center justify-between">
            <div className="eyebrow">Saved payment methods</div>
            <Button size="sm" variant="secondary" onClick={() => setMethodOpen(true)}>
              + Add method
            </Button>
          </div>
          {methodErr && (
            <div className="mb-3 rounded-[10px] border border-danger/40 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
              {methodErr}
            </div>
          )}
          {(savedMethods.data ?? []).length === 0 ? (
            <Card className="!p-4">
              <p className="text-[14px] text-g-600">No saved methods yet. Add card or UPI for quick checkout.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(savedMethods.data ?? []).map((m) => {
                const busy = methodBusyId === String(m.id)
                return (
                  <Card key={m.id} className="!p-4">
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-[12px] uppercase">{m.type}</div>
                      {m.is_default && (
                        <span className="rounded-full bg-brand-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow text-brand">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="mt-2 text-[14px]">{m.masked_detail ?? '—'}</div>
                    <div className="mt-1 text-[12px] text-g-500">{m.label || 'No label'}</div>
                    <div className="mt-3 flex gap-2">
                      {!m.is_default && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => markDefault(m.id)}>
                          Set default
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => removeMethod(m.id)}>
                        Remove
                      </Button>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mt-10">
        <div className="mb-4 eyebrow">Transactions</div>
        <Card padded={false}>
          <div className="p-2">
            <Table
              columns={cols}
              rows={txns}
              keyField={(t) => t.id}
              empty={wallet.loading ? 'Loading…' : 'No transactions yet.'}
            />
          </div>
        </Card>
      </div>

      <Modal
        open={methodOpen}
        onClose={() => {
          setMethodOpen(false)
          resetMethodForm()
        }}
        eyebrow="Saved payment method"
        title="Add card or UPI"
      >
        <form onSubmit={saveMethod} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {METHOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMethodType(opt.value)}
                className={`rounded-[10px] border px-3 py-2 font-mono text-[12px] uppercase tracking-eyebrow ${
                  methodType === opt.value ? 'border-ink bg-ink text-paper' : 'border-line-strong'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Input
            label={methodType === 'upi' ? 'UPI id' : 'Card number'}
            value={methodDetail}
            onChange={(e) => setMethodDetail(e.target.value)}
            placeholder={METHOD_OPTIONS.find((x) => x.value === methodType)?.placeholder}
            error={!detailValid && methodDetail.length > 0 ? 'Enter at least 3 characters.' : undefined}
          />
          <Input
            label="Label (optional)"
            value={methodLabel}
            onChange={(e) => setMethodLabel(e.target.value)}
            placeholder="Personal UPI / Company card"
          />
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={methodDefault}
              onChange={(e) => setMethodDefault(e.target.checked)}
            />
            Make default
          </label>
          {methodErr && (
            <div className="rounded-[10px] border border-danger/40 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
              {methodErr}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setMethodOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={methodSaving || !detailValid}>
              {methodSaving ? 'Saving…' : 'Save method'}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Recharge wallet"
        title="Add money"
      >
        <form onSubmit={recharge} className="space-y-4">
          <div className="flex gap-2">
            {['200', '500', '1000', '2000'].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(v)}
                className={`flex-1 rounded-[10px] border px-3 py-2 font-mono text-[13px] ${
                  amount === v
                    ? 'border-ink bg-ink text-paper'
                    : 'border-line-strong'
                }`}
              >
                {money(Number(v))}
              </button>
            ))}
          </div>
          <Input
            label="Amount"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={!amountValid ? 'Enter an amount greater than 0.' : undefined}
          />
          <p className="font-mono text-[11px] text-g-500">
            Opens Razorpay when configured; otherwise credits the wallet instantly for demos.
          </p>
          {error && (
            <div className="rounded-[10px] border border-danger/40 bg-danger-soft px-4 py-3 font-mono text-[12px] text-danger">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !amountValid}>
              {saving ? 'Processing…' : `Add ${money(amountValid ? parsedAmount : 0)}`}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

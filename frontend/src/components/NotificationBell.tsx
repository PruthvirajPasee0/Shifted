import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import type { Notification } from '../types'
import { timeLabel, dateLabel } from '../lib/format'

const POLL_MS = 30000

function routeForNotification(n: Notification): string | null {
  const t = (n.type ?? '').toLowerCase()
  const ref = n.ref_id ? String(n.ref_id) : null
  if (
    t.startsWith('ride_') ||
    t.startsWith('booking_') ||
    t === 'payment_received' ||
    t === 'payment_confirmed'
  ) {
    return ref ? `/trips/${ref}` : '/trips'
  }
  if (t.startsWith('document_')) {
    return '/documents'
  }
  if (t.includes('approval') || t.includes('user_pending')) {
    return '/admin'
  }
  return null
}

export default function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  async function loadCount() {
    try {
      const { data } = await api.get<{ count: number }>('/notifications/unread-count')
      setUnread(data.count)
    } catch {
      /* ignore — bell just shows no badge if offline */
    }
  }

  async function loadList() {
    try {
      const { data } = await api.get<Notification[]>('/notifications', {
        params: { limit: 20 },
      })
      setItems(data)
    } catch {
      setItems([])
    }
  }

  useEffect(() => {
    loadCount()
    const t = setInterval(loadCount, POLL_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) loadList()
  }

  async function markAllRead() {
    setItems((xs) => xs.map((x) => ({ ...x, is_read: true })))
    setUnread(0)
    try {
      await api.post('/notifications/read-all')
    } catch {
      /* optimistic — reload on next poll */
    }
  }

  async function openItem(n: Notification) {
    if (!n.is_read) {
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)))
      setUnread((c) => Math.max(0, c - 1))
      try {
        await api.patch(`/notifications/${n.id}/read`)
      } catch {
        /* ignore */
      }
    }
    const to = routeForNotification(n)
    setOpen(false)
    if (to) navigate(to)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-line bg-paper-raised text-ink transition-colors hover:border-brand/40"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 3a6 6 0 0 0-6 6v3.5L4.5 15.5A1 1 0 0 0 5.4 17h13.2a1 1 0 0 0 .9-1.5L18 12.5V9a6 6 0 0 0-6-6Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M9.5 20a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 font-mono text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[340px] overflow-hidden rounded-[14px] border border-line bg-paper-raised shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="eyebrow">Notifications</div>
            {items.some((i) => !i.is_read) && (
              <button
                type="button"
                onClick={markAllRead}
                className="link-underline font-mono text-[11px] text-brand-strong"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[380px] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center font-mono text-[12px] text-g-500">
                No notifications yet.
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openItem(n)}
                  className={`flex w-full flex-col items-start gap-1 border-b border-line px-4 py-3 text-left transition-colors hover:bg-paper ${
                    n.is_read ? '' : 'bg-brand-soft/40'
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="font-body text-[13px] font-semibold text-ink">
                      {n.title ?? 'Notification'}
                    </span>
                    {!n.is_read && <span className="h-2 w-2 flex-none rounded-full bg-brand" />}
                  </div>
                  {n.body && (
                    <span className="font-body text-[12px] leading-snug text-ink-soft">
                      {n.body}
                    </span>
                  )}
                  <span className="font-mono text-[10px] uppercase tracking-eyebrow text-g-400">
                    {dateLabel(n.created_at ?? undefined)} · {timeLabel(n.created_at ?? undefined)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

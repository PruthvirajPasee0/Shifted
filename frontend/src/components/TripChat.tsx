import { useEffect, useMemo, useRef, type FormEvent, type RefObject } from 'react'
import Avatar from './Avatar'
import type { Message } from '../types'
import { dateLabel, timeLabel } from '../lib/format'

type WsStatus = 'off' | 'idle' | 'connecting' | 'live' | 'offline'

interface Peer {
  id: string
  name: string
}

interface Props {
  open: boolean
  onClose: () => void
  peers: Peer[]
  peerId: string | null
  onPeerChange: (id: string) => void
  messages: Message[]
  draft: string
  onDraftChange: (v: string) => void
  onSend: (e: FormEvent) => void
  currentUserId?: string | number | null
  currentUserName?: string | null
  wsStatus: WsStatus
  error?: string | null
  endRef: RefObject<HTMLDivElement | null>
  routeLabel?: string
  /** When true, composer + send are locked (cancelled trip/booking). */
  disabled?: boolean
  disabledReason?: string
}

function dayKey(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toDateString()
}

export default function TripChat({
  open,
  onClose,
  peers,
  peerId,
  onPeerChange,
  messages,
  draft,
  onDraftChange,
  onSend,
  currentUserId,
  currentUserName,
  wsStatus,
  error,
  endRef,
  routeLabel,
  disabled = false,
  disabledReason,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const peer = peers.find((p) => p.id === peerId)

  useEffect(() => {
    if (!open || disabled) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => window.clearTimeout(t)
  }, [open, peerId, disabled])

  const grouped = useMemo(() => {
    const rows: { day: string; items: Message[] }[] = []
    for (const m of messages) {
      const key = dayKey(m.created_at) || 'Today'
      const last = rows[rows.length - 1]
      if (!last || last.day !== key) rows.push({ day: key, items: [m] })
      else last.items.push(m)
    }
    return rows
  }, [messages])

  if (!open) return null

  const live = wsStatus === 'live'
  const canCompose = Boolean(peerId) && !disabled

  return (
    <section
      id="trip-chat"
      className="mt-6 overflow-hidden rounded-[14px] border border-line bg-paper-raised"
      aria-label="Trip chat"
    >
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
        <Avatar name={peer?.name ?? 'Chat'} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-base font-semibold tracking-tight sm:text-lg">
            {peer?.name ?? 'Select a person'}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] uppercase tracking-eyebrow text-g-500">
            <span className={`inline-flex items-center gap-1.5 ${live ? 'text-success' : 'text-g-500'}`}>
              <span
                className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-success animate-pulse' : 'bg-g-400'}`}
              />
              {disabled
                ? 'Closed'
                : live
                  ? 'Live'
                  : wsStatus === 'connecting'
                    ? 'Connecting'
                    : 'API mode'}
            </span>
            {routeLabel && (
              <>
                <span className="text-g-300">·</span>
                <span className="truncate normal-case tracking-normal text-g-500">{routeLabel}</span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-line text-g-500 transition-colors hover:border-ink hover:text-ink"
        >
          ✕
        </button>
      </header>

      {peers.length > 1 && (
        <div className="flex gap-2 overflow-x-auto border-b border-line px-4 py-2.5 sm:px-5">
          {peers.map((p) => {
            const active = p.id === peerId
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPeerChange(p.id)}
                disabled={disabled}
                className={`flex h-10 shrink-0 items-center gap-2 rounded-[10px] border px-3 transition-colors disabled:opacity-50 ${
                  active
                    ? 'border-brand bg-brand-soft text-brand-strong'
                    : 'border-line-strong text-ink-soft hover:border-brand/40'
                }`}
              >
                <Avatar name={p.name} size={22} />
                <span className="max-w-[110px] truncate font-body text-[13px]">
                  {p.name.split(' ')[0]}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Messages + composer as one column so input stays flush */}
      <div className="flex h-[min(58vh,480px)] flex-col sm:h-[420px]">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {error && (
            <div className="mb-3 rounded-[10px] border border-danger/30 bg-danger-soft px-3 py-2 font-mono text-[11px] text-danger">
              {error}
            </div>
          )}

          {disabled && (
            <div className="mb-3 rounded-[10px] border border-line bg-paper px-3 py-2 font-mono text-[11px] text-g-600">
              {disabledReason ?? 'Chat is closed for this trip.'}
            </div>
          )}

          {!peerId ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <p className="font-display text-base font-semibold">Pick someone to chat</p>
              <p className="mt-1 max-w-xs font-body text-[13px] text-g-500">
                Choose a passenger above to open a private thread.
              </p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <Avatar name={peer?.name ?? '?'} size={48} className="mb-3" />
              <p className="font-display text-base font-semibold">
                {disabled ? 'No messages' : `Message ${peer?.name?.split(' ')[0]}`}
              </p>
              <p className="mt-1 max-w-xs font-body text-[13px] text-g-500">
                {disabled
                  ? 'This thread is closed because the trip was cancelled.'
                  : 'Coordinate pickup, gate, or a quick ETA.'}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map((group) => (
                <div key={group.day}>
                  <div className="mb-3 flex justify-center">
                    <span className="rounded-[8px] border border-line bg-paper px-2.5 py-1 font-mono text-[10px] uppercase tracking-eyebrow text-g-500">
                      {dateLabel(group.items[0]?.created_at) === dateLabel(new Date().toISOString())
                        ? 'Today'
                        : dateLabel(group.items[0]?.created_at)}
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {group.items.map((m) => {
                      const mine = String(m.sender_id) === String(currentUserId)
                      const pending = String(m.id).startsWith('tmp-')
                      return (
                        <div
                          key={m.id}
                          className={`flex gap-2 ${mine ? 'flex-row-reverse' : 'flex-row'}`}
                        >
                          {!mine && (
                            <div className="mt-auto shrink-0">
                              <Avatar name={m.sender_name ?? peer?.name} size={28} />
                            </div>
                          )}
                          <div
                            className={`flex max-w-[80%] flex-col ${mine ? 'items-end' : 'items-start'}`}
                          >
                            <div
                              className={`rounded-[14px] px-3.5 py-2.5 text-[14px] leading-relaxed ${
                                mine
                                  ? 'rounded-br-[4px] bg-brand text-white'
                                  : 'rounded-bl-[4px] border border-line bg-paper text-ink'
                              } ${pending ? 'opacity-70' : ''}`}
                            >
                              {m.body}
                            </div>
                            <div
                              className={`mt-1 px-1 font-mono text-[10px] text-g-400 ${
                                mine ? 'text-right' : 'text-left'
                              }`}
                            >
                              {mine
                                ? currentUserName?.split(' ')[0] ?? 'You'
                                : m.sender_name?.split(' ')[0] ?? 'Them'}
                              {' · '}
                              {timeLabel(m.created_at)}
                              {pending ? ' · Sending' : ''}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
              <div ref={endRef as RefObject<HTMLDivElement>} />
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-line bg-paper px-3 py-3 sm:px-4">
          {disabled ? (
            <p className="py-1 text-center font-mono text-[11px] text-g-500">
              Messaging disabled after cancellation.
            </p>
          ) : (
            <form onSubmit={onSend} className="flex items-center gap-2">
              <label className="sr-only" htmlFor="trip-chat-input">
                Message
              </label>
              <input
                id="trip-chat-input"
                ref={inputRef}
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                disabled={!canCompose}
                placeholder={peerId ? 'Write a message…' : 'Select a person first'}
                className="min-h-11 flex-1 rounded-[10px] border border-line-strong bg-paper-raised px-3.5 font-body text-[15px] text-ink outline-none placeholder:text-g-400 focus:border-brand disabled:opacity-50"
                autoComplete="off"
              />
              <button
                type="submit"
                disabled={!canCompose || !draft.trim()}
                aria-label="Send message"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-brand text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M3.4 11.2 20.2 3.6c.7-.3 1.4.4 1.1 1.1l-7.6 16.8c-.3.7-1.3.7-1.6 0l-2.4-6.3-6.3-2.4c-.7-.3-.7-1.3 0-1.6Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </form>
          )}
        </footer>
      </div>
    </section>
  )
}

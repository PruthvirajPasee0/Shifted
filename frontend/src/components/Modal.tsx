import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  eyebrow?: string
  children: ReactNode
  footer?: ReactNode
}

export default function Modal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
}: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const node = (
    <div
      className="fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="fixed inset-0 bg-ink/45 backdrop-blur-[2px]"
        aria-label="Close dialog"
        onClick={onClose}
      />

      {/* Scroll the overlay — not the page — so tall confirm dialogs stay reachable */}
      <div className="relative z-10 h-full overflow-y-auto overscroll-y-contain">
        <div className="flex min-h-full justify-center px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:py-10">
          <div
            className="relative my-auto w-full max-w-lg rounded-card border border-line bg-paper-raised shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-7 sm:pt-7">
              <div className="min-w-0">
                {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
                {title && (
                  <h3 className="font-display text-xl tracking-tight sm:text-2xl">{title}</h3>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 font-mono text-lg leading-none text-g-500 hover:text-ink"
              >
                ✕
              </button>
            </div>
            <div className="px-5 py-5 sm:px-7">{children}</div>
            {footer && (
              <div className="border-t border-line px-5 py-4 sm:px-7">{footer}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(node, document.body)
}

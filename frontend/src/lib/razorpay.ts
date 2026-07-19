import type { RazorpayOrder } from '../types'

export interface RazorpaySuccess {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

// The Razorpay Checkout script attaches a global constructor.
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void }
  }
}

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

function loadCheckoutScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true)
    const existing = document.querySelector(`script[src="${CHECKOUT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(true))
      existing.addEventListener('error', () => resolve(false))
      return
    }
    const script = document.createElement('script')
    script.src = CHECKOUT_SRC
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

export async function openRazorpayCheckout(opts: {
  order: RazorpayOrder
  name?: string
  description?: string
  prefill?: { name?: string; email?: string; contact?: string }
  onSuccess: (resp: RazorpaySuccess) => void
  onDismiss?: () => void
}): Promise<void> {
  const loaded = await loadCheckoutScript()
  if (!loaded || !window.Razorpay) {
    throw new Error('Could not load Razorpay Checkout')
  }
  const rzp = new window.Razorpay({
    key: opts.order.key_id,
    amount: opts.order.amount,
    currency: opts.order.currency,
    order_id: opts.order.order_id,
    name: opts.name ?? 'Shifted',
    description: opts.description ?? 'Ride payment',
    prefill: opts.prefill ?? {},
    theme: { color: '#4f46e5' },
    // Let Razorpay show UPI + card; server accepts whichever method succeeds.
    handler: (resp: RazorpaySuccess) => opts.onSuccess(resp),
    modal: { ondismiss: () => opts.onDismiss?.() },
  })
  rzp.open()
}

export default function PolicyNote({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-[10px] border border-line bg-paper-raised px-3 py-2.5 font-mono text-[11px] leading-relaxed text-g-500 ${className}`}
    >
      <span className="font-medium text-ink-soft">Cancel policy: </span>
      Full wallet/UPI/card refund if you cancel before the ride starts. After start, passenger
      cancels are not auto-refunded. Driver cancel refunds paid passengers.
    </div>
  )
}

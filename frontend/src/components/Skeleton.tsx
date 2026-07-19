export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[8px] bg-line/80 ${className}`}
      aria-hidden
    />
  )
}

export function StatSkeleton() {
  return (
    <div className="rounded-[14px] border border-line bg-paper-raised p-5">
      <Skeleton className="mb-3 h-3 w-20" />
      <Skeleton className="h-10 w-28" />
      <Skeleton className="mt-3 h-3 w-32" />
    </div>
  )
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 p-5">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4 max-w-xs" />
            <Skeleton className="h-3 w-1/2 max-w-[180px]" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

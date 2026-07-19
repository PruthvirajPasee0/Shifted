interface Props {
  name?: string | null
  src?: string | null
  size?: number
  className?: string
}

function initials(name?: string | null): string {
  if (!name) return 'U'
  return name
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export default function Avatar({ name, src, size = 36, className = '' }: Props) {
  const dim = { width: size, height: size }
  if (src) {
    return (
      <img
        src={src}
        alt={name ?? 'Profile'}
        style={dim}
        className={`shrink-0 rounded-full object-cover ring-1 ring-black/5 ${className}`}
      />
    )
  }
  return (
    <div
      style={{ ...dim, fontSize: Math.max(11, size * 0.36) }}
      className={`flex shrink-0 items-center justify-center rounded-full bg-brand font-mono font-medium text-white ${className}`}
    >
      {initials(name)}
    </div>
  )
}

import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  block?: boolean
  children: ReactNode
}

const base =
  'inline-flex items-center justify-center gap-2 font-mono text-[13px] uppercase tracking-eyebrow rounded-[10px] transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed select-none'

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-[11px]',
  md: 'px-5 py-2.5',
  lg: 'px-7 py-3.5 text-[14px]',
}

const variants: Record<Variant, string> = {
  // Solid brand — the primary call to action
  primary:
    'bg-brand text-white border border-brand shadow-sm shadow-brand/20 hover:bg-brand-strong hover:border-brand-strong',
  // Neutral outline that warms to a brand tint on hover
  secondary:
    'bg-transparent text-ink border border-line-strong hover:bg-brand-soft hover:border-brand hover:text-brand-strong',
  ghost: 'bg-transparent text-ink-soft border border-transparent hover:bg-brand-soft hover:text-brand-strong',
  danger:
    'bg-transparent text-danger border border-danger/50 hover:bg-danger hover:text-white hover:border-danger',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${
        block ? 'w-full' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
